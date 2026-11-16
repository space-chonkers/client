import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import * as THREE from 'three'
import { INITIAL_BASE_ORIGIN, INITIAL_SERVER_CONSTRUCTIONS } from '../../src/game/corridor/mockServerPayload'
import { occupiedTilesToConstructions } from '../../src/game/minimap/missionMap'
import type { MarsTerrainDataV1 } from '../../src/terrain-kit/marsTerrainContract'
import { UNCLASSIFIED } from '../../src/terrain-kit/reliefMap'
import { TERRAIN_SKIRT_NAME } from '../../src/terrain-kit/terrain'
import { syntheticMarsTerrain } from '../terrain/syntheticMarsTerrain'
import { createMissionLayers, geometryHash, worldVertices } from './terrainGeometry'

// Each case builds a full 50×50 (real) or 70×70 (procedural) terrain.
setDefaultTimeout(60_000)

/** Mined ground height and the mined square's half-width (see MarsMapLayer). */
const FLOOR_Y = -0.18
const CORE = 0.75
/** World units per metre: 10 m cells drawn 1 world unit wide. */
const UNITS_PER_METER = 0.1

/**
 * SYNTHETIC steep slope (not Mars data): 8 m per cell eastward and 3 m per
 * cell southward, so the playable grid spans about ±20 world units around
 * the base: much steeper than any HiRISE window served today.
 */
const steepPlane = (col: number, row: number) => -1500 + 8 * col + 3 * row
/** SYNTHETIC near-flat ground: ±0.3 m ripples. */
const gentleRipples = (col: number, row: number) => -2400 + 0.3 * Math.sin(col * 0.7) * Math.cos(row * 0.5)

const realPayload = (elevationAt: (col: number, row: number) => number): MarsTerrainDataV1 => ({
  ...syntheticMarsTerrain({ elevationAt }),
  source: { datasetId: 'synthetic-test-fixture', provider: 'space-chonkers tests (synthetic)', resolutionMeters: 1, productId: 'SYNTHETIC_PRODUCT_ID' },
})

/** World (scene) coordinates of a server cell centre. */
const toWorld = (cellX: number, cellY: number) => ({ x: cellX - INITIAL_BASE_ORIGIN.cellX, z: cellY - INITIAL_BASE_ORIGIN.cellY })

const surfaceVertices = (layer: ReturnType<typeof createMissionLayers>['mapLayer']) =>
  worldVertices(layer.terrain.root)
    .filter(({ mesh }) => layer.terrain.chunks.includes(mesh))
    .flatMap(({ points }) => points)

const within = (point: THREE.Vector3, x: number, z: number, half: number) => Math.abs(point.x - x) <= half && Math.abs(point.z - z) <= half

/** Height of the rendered surface straight below (x, z). */
function surfaceHeightAt(layer: ReturnType<typeof createMissionLayers>['mapLayer'], x: number, z: number): number {
  layer.terrain.root.updateMatrixWorld(true)
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0))
  const [hit] = ray.intersectObjects(layer.terrain.chunks, false)
  if (!hit) throw new Error(`no terrain under (${x}, ${z})`)
  return hit.point.y
}

describe('procedural terrain (PR #43 baseline)', () => {
  test('rendered geometry is identical to PR #43 after the base and after building corridors', () => {
    // Hashes recorded from origin/main (b8c06f0, PR #43's MarsMapLayer) with this same build sequence.
    const { mapLayer, build } = createMissionLayers()
    expect(geometryHash(mapLayer.object)).toBe('19cc635a')
    for (const [x, z] of [[0, -2], [0, -3], [1, -3], [-2, 0], [12, 8], [-20, -20]]) build(x, z)
    expect(geometryHash(mapLayer.object)).toBe('90e63c89')
    expect(mapLayer.isRealTerrain).toBe(false)
    expect(mapLayer.boundaryApron).toBeNull()
    expect(mapLayer.map.cols).toBe(70)
    mapLayer.dispose()
  })
})

describe('real terrain in the mission (synthetic steep slope)', () => {
  let payload: MarsTerrainDataV1
  let originalSamples: (number | null)[]
  let layers: ReturnType<typeof createMissionLayers>
  /** Surface heights before any corridor beyond the base was built. */
  let before: Map<string, number>

  beforeAll(() => {
    payload = realPayload(steepPlane)
    originalSamples = payload.elevation.samplesMeters.slice()
    layers = createMissionLayers({ terrainData: payload })
    before = new Map(surfaceVertices(layers.mapLayer).map((p) => [`${p.x.toFixed(4)},${p.z.toFixed(4)}`, p.y]))
  })

  test('is drawn unclassified over exactly the measured 50×50 footprint, with no dressing', () => {
    const { mapLayer } = layers
    expect(mapLayer.isRealTerrain).toBe(true)
    expect(mapLayer.map.cols).toBe(50)
    expect(mapLayer.map.rows).toBe(50)
    expect(mapLayer.map.classification).toBe('none')
    expect(mapLayer.map.cells.every((cell) => cell.geology === UNCLASSIFIED && cell.feature === 'none')).toBe(true)
    expect(mapLayer.terrain.placements.filter((placement) => placement.placed)).toHaveLength(0)
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
    expect(heightOfCell(east) - heightOfCell(west)).toBeCloseTo(expectedRise(east, west), 4)
    expect(heightOfCell(west) - heightOfCell(north)).toBeCloseTo(expectedRise(west, north), 4)
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

  test('no terrain protrudes inside any built cell, base included', () => {
    const { corridors, mapLayer } = layers
    const vertices = surfaceVertices(mapLayer)
    for (const { gridX, gridZ } of corridors.getOccupiedTiles()) {
      const inside = vertices.filter((p) => within(p, gridX, gridZ, 0.5))
      for (const p of inside) expect(p.y).toBeLessThanOrEqual(FLOOR_Y + 1e-5)
    }
  })

  test('terrain beyond the grading band is untouched and the surface stays continuous', () => {
    const { corridors, mapLayer } = layers
    const reach = 0.76 + 2
    const built = corridors.getOccupiedTiles()
    const vertices = surfaceVertices(mapLayer)
    let farChecked = 0
    for (const p of vertices) {
      const near = built.some(({ gridX, gridZ }) => within(p, gridX, gridZ, reach + 1e-6))
      if (near) continue
      expect(p.y).toBe(before.get(`${p.x.toFixed(4)},${p.z.toFixed(4)}`)!)
      farChecked++
    }
    expect(farChecked).toBeGreaterThan(10_000)
    // The cut wall out of the uphill cell (~12 units deep here) is a graded slope, not a cliff: flat inside
    // the corridor walls (±0.5), then rising steadily, with no 0.25-unit step taking more than a quarter of the depth.
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

  test('the skirt keeps its bottom when an edge cell is graded', () => {
    const { mapLayer, build } = layers
    const skirt = mapLayer.terrain.root.getObjectByName(TERRAIN_SKIRT_NAME)!
    const bottom = new THREE.Box3().setFromObject(skirt).min.y
    const edge = toWorld(0, 30)
    expect(build(edge.x, edge.z)).toBe(true)
    expect(new THREE.Box3().setFromObject(skirt).min.y).toBeCloseTo(bottom, 6)
  })

  test('the HiRISE samples are never modified, by the map or by excavation', () => {
    const { mapLayer } = layers
    expect(payload.elevation.samplesMeters).toEqual(originalSamples)
    expect(mapLayer.map.elevation?.samplesMeters).toEqual(originalSamples as number[])
    // The map's cells are not levelled either: the base cells keep their measured elevation.
    const baseCell = mapLayer.map.cells[25 * 50 + 29]
    expect(baseCell.elevationMeters).toBeCloseTo(steepPlane(29.5, 25.5), 9)
  })

  test('a neutral apron lies below the whole measured terrain, outside the data', () => {
    const { mapLayer } = layers
    const apron = mapLayer.boundaryApron!
    expect(apron.name).toBe('terrain-boundary-apron')
    const terrainBottom = new THREE.Box3().setFromObject(mapLayer.terrain.root).min.y
    expect(apron.position.y).toBeLessThan(terrainBottom)
    const footprint = new THREE.Box3().setFromObject(apron)
    expect(footprint.max.x - footprint.min.x).toBeGreaterThan(50)
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
    const { corridors, mapLayer, build } = createMissionLayers({ terrainData: realPayload(steepPlane) })
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

  test('dispose frees the terrain and the apron', () => {
    const { mapLayer } = createMissionLayers({ terrainData: realPayload(gentleRipples) })
    let disposed = 0
    mapLayer.boundaryApron!.geometry.addEventListener('dispose', () => disposed++)
    mapLayer.terrain.chunks[0].geometry.addEventListener('dispose', () => disposed++)
    mapLayer.dispose()
    expect(disposed).toBe(2)
  })
})
