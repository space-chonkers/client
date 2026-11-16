import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import * as THREE from 'three'
import { INITIAL_BASE_ORIGIN, INITIAL_SERVER_CONSTRUCTIONS } from '../../src/game/corridor/mockServerPayload'
import { occupiedTilesToConstructions } from '../../src/game/minimap/missionMap'
import type { BakedPart } from '../../src/terrain-kit/geometry'
import type { MarsTerrainDataV1 } from '../../src/terrain-kit/marsTerrainContract'
import { MARS_SCENERY, measuredSamples } from '../../src/terrain-kit/marsTerrainScenery'
import { MINERAL_FEATURES } from '../../src/terrain-kit/reliefMap'
import { createReliefField } from '../../src/terrain-kit/reliefField'
import { syntheticMarsTerrain } from '../terrain/syntheticMarsTerrain'
import { createMissionLayers, geometryHash, worldVertices } from './terrainGeometry'

// Each case builds a full 75×75 (procedural) or 90×90 (real) terrain with its dressing.
setDefaultTimeout(120_000)

/** Mined ground height and the mined square's half-width (see MarsMapLayer). */
const FLOOR_Y = -0.18
const CORE = 0.75
/** World units per metre: 10 m cells drawn 1 world unit wide. */
const UNITS_PER_METER = 0.1
/** Display grid size of real maps: the measured 50×50 inside the synthetic border. */
const REAL_DISPLAY_SIZE = 50 + 2 * MARS_SCENERY.borderCells

/**
 * SYNTHETIC steep slope (not Mars data): 8 m per cell eastward and 3 m per
 * cell southward, so the playable grid spans about ±20 world units around
 * the base: much steeper than any HiRISE window served today.
 */
const steepPlane = (col: number, row: number) => -1500 + 8 * col + 3 * row
/** SYNTHETIC hilly ground (not Mars data): rolling hills and channels, tens of metres of relief. */
const hills = (col: number, row: number) =>
  -2000 + 30 * Math.sin(col * 0.35) * Math.cos(row * 0.3) + 12 * Math.sin(col * 0.9 + row * 0.4) + 6 * Math.cos(row * 1.3 - col * 0.2)
/** SYNTHETIC near-flat ground: ±0.3 m ripples. */
const gentleRipples = (col: number, row: number) => -2400 + 0.3 * Math.sin(col * 0.7) * Math.cos(row * 0.5)

const realPayload = (elevationAt: (col: number, row: number) => number): MarsTerrainDataV1 => ({
  ...syntheticMarsTerrain({ elevationAt }),
  source: { datasetId: 'synthetic-test-fixture', provider: 'space-chonkers tests (synthetic)', resolutionMeters: 1, productId: 'SYNTHETIC_PRODUCT_ID' },
})

type Layer = ReturnType<typeof createMissionLayers>['mapLayer']

/** World (scene) coordinates of a server cell centre. */
const toWorld = (cellX: number, cellY: number) => ({ x: cellX - INITIAL_BASE_ORIGIN.cellX, z: cellY - INITIAL_BASE_ORIGIN.cellY })

const surfaceVertices = (layer: Layer) =>
  worldVertices(layer.terrain.root)
    .filter(({ mesh }) => layer.terrain.chunks.includes(mesh))
    .flatMap(({ points }) => points)

const within = (point: THREE.Vector3, x: number, z: number, half: number) => Math.abs(point.x - x) <= half && Math.abs(point.z - z) <= half

/** Height of the rendered surface straight below (x, z). */
function surfaceHeightAt(layer: Layer, x: number, z: number): number {
  layer.terrain.root.updateMatrixWorld(true)
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0))
  const [hit] = ray.intersectObjects(layer.terrain.chunks, false)
  if (!hit) throw new Error(`no terrain under (${x}, ${z})`)
  return hit.point.y
}

/** World-space vertices of baked prop `owner` (its parts across every baked dressing mesh). */
function propVertices(layer: Layer, owner: number): THREE.Vector3[] {
  layer.terrain.root.updateMatrixWorld(true)
  const out: THREE.Vector3[] = []
  layer.terrain.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const position = object.geometry.getAttribute('position')
    for (const part of (object.userData.bakedParts as BakedPart[] | undefined) ?? []) {
      if (part.owner !== owner) continue
      for (let i = part.start; i < part.start + part.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld))
    }
  })
  return out
}

/** Visible (non-degenerate) dressing triangles with a vertex strictly inside a built cell's walls, above its floor. */
function dressingInside(layer: Layer, cells: readonly { gridX: number; gridZ: number }[]): number {
  layer.terrain.root.updateMatrixWorld(true)
  let found = 0
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const area = new THREE.Triangle()
  layer.terrain.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || layer.terrain.chunks.includes(object)) return
    if (object.name === 'terrain-skirt') return
    const position = object.geometry.getAttribute('position')
    const index = object.geometry.getIndex()
    const triangles = index ? index.count / 3 : position.count / 3
    const at = (k: number) => (index ? index.getX(k) : k)
    for (let t = 0; t < triangles; t++) {
      a.fromBufferAttribute(position, at(3 * t)).applyMatrix4(object.matrixWorld)
      b.fromBufferAttribute(position, at(3 * t + 1)).applyMatrix4(object.matrixWorld)
      c.fromBufferAttribute(position, at(3 * t + 2)).applyMatrix4(object.matrixWorld)
      if (area.set(a, b, c).getArea() < 1e-9) continue
      for (const v of [a, b, c]) {
        if (v.y > FLOOR_Y + 1e-3 && cells.some(({ gridX, gridZ }) => within(v, gridX, gridZ, 0.48))) found++
      }
    }
  })
  return found
}

describe('procedural terrain (main baseline: PRs #43, #46, #47)', () => {
  test('rendered geometry and colours are identical to main after the base and after building corridors', () => {
    // Hashes recorded from origin/main (f6875c0) with this same build sequence: positions, vertex and instance colours.
    const { mapLayer, build } = createMissionLayers()
    expect(geometryHash(mapLayer.object)).toBe('f5ad82fd')
    for (const [x, z] of [[0, -2], [0, -3], [1, -3], [-2, 0], [12, 8], [-20, -20]]) build(x, z)
    expect(geometryHash(mapLayer.object)).toBe('ceddead1')
    expect(mapLayer.isRealTerrain).toBe(false)
    expect(mapLayer.map.cols).toBe(75)
    mapLayer.dispose()
  })
})

describe('real terrain dressed as game art (synthetic hills)', () => {
  let payload: MarsTerrainDataV1
  let originalSamples: (number | null)[]
  let layers: ReturnType<typeof createMissionLayers>

  beforeAll(() => {
    payload = realPayload(hills)
    originalSamples = payload.elevation.samplesMeters.slice()
    layers = createMissionLayers({ terrainData: payload })
  })

  test('uses the procedural art system: varied geology, formations, rocks and minerals', () => {
    const { mapLayer } = layers
    expect(mapLayer.isRealTerrain).toBe(true)
    expect(mapLayer.map.cols).toBe(REAL_DISPLAY_SIZE)
    expect(mapLayer.map.classification).toBe('procedural')
    const placed = mapLayer.terrain.placements.filter((placement) => placement.placed)
    const kinds = new Set(placed.map((placement) => placement.feature))
    expect(placed.length).toBeGreaterThan(100)
    expect(kinds.size).toBeGreaterThanOrEqual(5)
    expect(MINERAL_FEATURES.some((mineral) => kinds.has(mineral))).toBe(true)
    expect(new Set(mapLayer.map.cells.map((cell) => cell.geology)).size).toBeGreaterThanOrEqual(5)
    // Not every tile is decorated.
    expect(placed.length / mapLayer.map.cells.length).toBeLessThan(0.3)
  })

  test('the measured samples still set the height: classification and dressing add no relief', () => {
    // The heightfield the renderer meshes, for the classified display map: exactly the bilinear measured
    // metres (relative to the normalization reference, 0.1 world units per metre), with no procedural micro-relief.
    const { map } = layers.mapLayer
    const field = createReliefField(map, { cols: map.cols, rows: map.rows, cellSize: 1 })
    const reference = map.elevation!.normalization.referenceMeters
    const B = MARS_SCENERY.borderCells
    for (const [col, row] of [[5, 40], [45, 10], [10, 5], [40, 44], [12, 30], [0, 0], [49, 49]]) {
      for (const [u, v] of [[0.5, 0.5], [0.2, 0.7], [0, 0]]) {
        const expectedMeters =
          hills(col, row) * (1 - u) * (1 - v) + hills(col + 1, row) * u * (1 - v) + hills(col, row + 1) * (1 - u) * v + hills(col + 1, row + 1) * u * v
        const x = B + col + u - map.cols / 2
        const z = B + row + v - map.rows / 2
        expect(field.heightAt(x, z)).toBeCloseTo((expectedMeters - reference) * UNITS_PER_METER, 9)
      }
    }
  })

  test('the base is clear of dressing', () => {
    const { mapLayer, corridors } = layers
    expect(dressingInside(mapLayer, corridors.getOccupiedTiles())).toBe(0)
  })

  test('building where a prop stands hides it whole; a prop on the graded slope moves rigidly', () => {
    const { mapLayer, corridors, build } = layers
    const offset = mapLayer.terrain.root.getWorldPosition(new THREE.Vector3())
    const playable = (x: number, z: number) => Math.abs(x) <= 18 && Math.abs(z) <= 18 && Math.max(Math.abs(x), Math.abs(z)) > 4
    const solid = mapLayer.terrain.props
      .map((prop, owner) => ({ prop, owner, x: prop.anchor.x + offset.x, z: prop.anchor.z + offset.z }))
      .filter(({ prop, x, z }) => !prop.decal && playable(x, z))
    expect(solid.length).toBeGreaterThan(5)

    // 1. Build right on a prop: no part of it (or anything else) remains inside the corridor.
    const target = solid[0]
    const cell = { x: Math.round(target.x), z: Math.round(target.z) }
    expect(build(cell.x, cell.z)).toBe(true)
    expect(dressingInside(mapLayer, corridors.getOccupiedTiles())).toBe(0)

    // 2. A small prop two cells from a new corridor sits on its graded slope: it moves as one piece.
    const small = solid.find(({ prop, x, z }) => {
      const half = Math.max(prop.bounds.maxX - prop.bounds.minX, prop.bounds.maxZ - prop.bounds.minZ) / 2
      return half < 0.4 && Math.abs(x - cell.x) > 6 && Math.abs(z - cell.z) > 6 && playable(x + 2, z)
    })!
    expect(small).toBeDefined()
    const before = propVertices(mapLayer, small.owner)
    expect(build(Math.round(small.x) + 2, Math.round(small.z))).toBe(true)
    const after = propVertices(mapLayer, small.owner)
    const shift = after[0].y - before[0].y
    after.forEach((vertex, i) => {
      expect(vertex.x).toBeCloseTo(before[i].x, 5)
      expect(vertex.z).toBeCloseTo(before[i].z, 5)
      expect(vertex.y - before[i].y).toBeCloseTo(shift, 4)
    })
    expect(dressingInside(mapLayer, corridors.getOccupiedTiles())).toBe(0)
  })

  test('dressing is deterministic for a payload', () => {
    const again = createMissionLayers({ terrainData: realPayload(hills) })
    const fresh = createMissionLayers({ terrainData: realPayload(hills) })
    expect(geometryHash(again.mapLayer.object)).toBe(geometryHash(fresh.mapLayer.object))
    expect(again.mapLayer.terrain.placements).toEqual(fresh.mapLayer.terrain.placements)
    again.mapLayer.dispose()
    fresh.mapLayer.dispose()
  })

  test('the HiRISE samples are never modified, by the scenery or by excavation', () => {
    const { mapLayer } = layers
    expect(payload.elevation.samplesMeters).toEqual(originalSamples)
    expect(mapLayer.map.elevation?.measuredFootprint).toEqual({ col: MARS_SCENERY.borderCells, row: MARS_SCENERY.borderCells, cols: 50, rows: 50 })
    expect(measuredSamples(mapLayer.map)).toEqual(originalSamples as number[])
  })
})

describe('real terrain earthwork (synthetic steep slope)', () => {
  let layers: ReturnType<typeof createMissionLayers>
  /** Surface heights before any corridor beyond the base was built. */
  let before: Map<string, number>

  beforeAll(() => {
    layers = createMissionLayers({ terrainData: realPayload(steepPlane) })
    before = new Map(surfaceVertices(layers.mapLayer).map((p) => [`${p.x.toFixed(4)},${p.z.toFixed(4)}`, p.y]))
  })

  test('cell (cellX, cellY) of the payload sits under world cell (cellX − 29, cellY − 25), north-up', () => {
    const { mapLayer } = layers
    const expectedRise = (a: [number, number], b: [number, number]) => (steepPlane(a[0] + 0.5, a[1] + 0.5) - steepPlane(b[0] + 0.5, b[1] + 0.5)) * UNITS_PER_METER
    const heightOfCell = ([cellX, cellY]: [number, number]) => {
      const { x, z } = toWorld(cellX, cellY)
      return surfaceHeightAt(mapLayer, x, z)
    }
    // Far from the base, so nothing here has been graded.
    const west: [number, number] = [5, 40]
    const east: [number, number] = [45, 10]
    const north: [number, number] = [10, 5]
    expect(heightOfCell(east) - heightOfCell(west)).toBeCloseTo(expectedRise(east, west), 3)
    expect(heightOfCell(west) - heightOfCell(north)).toBeCloseTo(expectedRise(west, north), 3)
  })

  test('the initial 3×3 base is levelled on the mesh at the corridor floor', () => {
    const vertices = surfaceVertices(layers.mapLayer)
    for (const { cellX, cellY } of INITIAL_SERVER_CONSTRUCTIONS) {
      const { x, z } = toWorld(cellX, cellY)
      const inCell = vertices.filter((p) => within(p, x, z, CORE))
      expect(inCell.length).toBeGreaterThan(0)
      for (const p of inCell) expect(p.y).toBeCloseTo(FLOOR_Y, 5)
    }
  })

  test('building uphill cuts and building downhill fills, each to a flat floor', () => {
    const { mapLayer, build } = layers
    const uphill = toWorld(44, 25) // ~12 world units above the base
    const downhill = toWorld(8, 25) // ~17 world units below the base
    expect(surfaceHeightAt(mapLayer, uphill.x, uphill.z)).toBeGreaterThan(5)
    expect(surfaceHeightAt(mapLayer, downhill.x, downhill.z)).toBeLessThan(-5)

    expect(build(uphill.x, uphill.z)).toBe(true)
    expect(build(downhill.x, downhill.z)).toBe(true)

    const vertices = surfaceVertices(mapLayer)
    for (const { x, z } of [uphill, downhill]) {
      const core = vertices.filter((p) => within(p, x, z, CORE))
      expect(core.length).toBeGreaterThan(0)
      for (const p of core) expect(p.y).toBeCloseTo(FLOOR_Y, 5)
      // No hole and no bump anywhere on the corridor's floor.
      for (const [dx, dz] of [[0, 0], [0.45, 0.45], [-0.45, 0.2], [0.3, -0.45]]) {
        expect(surfaceHeightAt(mapLayer, x + dx, z + dz)).toBeCloseTo(FLOOR_Y, 3)
      }
    }
  })

  test('no terrain or dressing protrudes inside any built cell, base included', () => {
    const { corridors, mapLayer } = layers
    const vertices = surfaceVertices(mapLayer)
    for (const { gridX, gridZ } of corridors.getOccupiedTiles()) {
      const inside = vertices.filter((p) => within(p, gridX, gridZ, 0.5))
      for (const p of inside) expect(p.y).toBeLessThanOrEqual(FLOOR_Y + 1e-5)
    }
    expect(dressingInside(mapLayer, corridors.getOccupiedTiles())).toBe(0)
  })

  test('terrain beyond the grading band is untouched and the cut wall is graded, not a cliff', () => {
    const { corridors, mapLayer } = layers
    const reach = 0.76 + 2
    const built = corridors.getOccupiedTiles()
    let farChecked = 0
    for (const p of surfaceVertices(mapLayer)) {
      if (built.some(({ gridX, gridZ }) => within(p, gridX, gridZ, reach + 1e-6))) continue
      expect(p.y).toBe(before.get(`${p.x.toFixed(4)},${p.z.toFixed(4)}`)!)
      farChecked++
    }
    expect(farChecked).toBeGreaterThan(10_000)
    // The cut wall out of the uphill cell (~12 units deep here): flat inside the corridor walls (±0.5),
    // then rising steadily, with no 0.25-unit step taking more than a quarter of the depth.
    const { x, z } = toWorld(44, 25)
    const profile = Array.from({ length: 17 }, (_, k) => surfaceHeightAt(mapLayer, x, z + k * 0.25))
    const depth = profile[profile.length - 1] - FLOOR_Y
    expect(depth).toBeGreaterThan(10)
    profile.slice(0, 3).forEach((height) => expect(height).toBeCloseTo(FLOOR_Y, 3))
    for (let k = 1; k < profile.length; k++) {
      const step = profile[k] - profile[k - 1]
      expect(step).toBeGreaterThan(-1e-3)
      expect(step).toBeLessThan(depth / 4)
    }
  })

  test('building a neighbour later never un-levels a cell mined earlier', () => {
    const { mapLayer, build } = layers
    const first = toWorld(44, 25)
    expect(build(first.x, first.z - 1)).toBe(true)
    expect(build(first.x + 1, first.z - 1)).toBe(true)
    const core = surfaceVertices(mapLayer).filter((p) => within(p, first.x, first.z, CORE))
    for (const p of core) expect(p.y).toBeCloseTo(FLOOR_Y, 5)
  })
})

describe('real terrain: near-flat ground, minimap and cleanup', () => {
  test('excavation still levels built cells on near-flat ground', () => {
    const { mapLayer, build } = createMissionLayers({ terrainData: realPayload(gentleRipples) })
    const target = toWorld(29, 22)
    expect(build(target.x, target.z)).toBe(true)
    const core = surfaceVertices(mapLayer).filter((p) => within(p, target.x, target.z, CORE))
    for (const p of core) expect(p.y).toBeCloseTo(FLOOR_Y, 5)
    mapLayer.dispose()
  })

  test('a successful build is published to the minimap at its world cell and excavated', () => {
    const { corridors, mapLayer, build } = createMissionLayers({ terrainData: realPayload(hills) })
    const published: ReturnType<typeof occupiedTilesToConstructions>[] = []
    corridors.onOccupancyChange(() => published.push(occupiedTilesToConstructions(corridors.getOccupiedTiles(), INITIAL_BASE_ORIGIN)))

    // North of the stash, past the base edge (as the E/Space handler builds it).
    expect(build(0, -2)).toBe(true)
    expect(published).toHaveLength(1)
    expect(published[0]).toContainEqual({ kind: 'base_tile', cellX: 29, cellY: 23 })
    expect(published[0]).toHaveLength(INITIAL_SERVER_CONSTRUCTIONS.length + 1)
    expect(surfaceHeightAt(mapLayer, 0, -2)).toBeCloseTo(FLOOR_Y, 3)

    // An occupied cell is rejected: nothing is published or mined.
    expect(build(0, -2)).toBe(false)
    expect(published).toHaveLength(1)
    corridors.dispose()
    mapLayer.dispose()
  })

  test('dispose frees the terrain and its dressing', () => {
    const { mapLayer } = createMissionLayers({ terrainData: realPayload(gentleRipples) })
    let disposed = 0
    mapLayer.terrain.chunks[0].geometry.addEventListener('dispose', () => disposed++)
    mapLayer.terrain.root.getObjectByName('terrain-dressing')!.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.addEventListener('dispose', () => disposed++)
    })
    const expected = 1 + mapLayer.terrain.root.getObjectByName('terrain-dressing')!.children.length
    mapLayer.dispose()
    expect(disposed).toBeGreaterThanOrEqual(expected)
  })
})
