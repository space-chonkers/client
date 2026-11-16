import * as THREE from 'three'
import { disposeObject } from '../../terrain-kit/dispose'
import type { BakedPart } from '../../terrain-kit/geometry'
import type { MarsTerrainDataV1 } from '../../terrain-kit/marsTerrainContract'
import { createMarsTerrainScenery } from '../../terrain-kit/marsTerrainScenery'
import {
  cellAt,
  generateReliefMap,
  MAP_SIZE,
  type ReliefMap,
  type TerrainCell,
} from '../../terrain-kit/reliefMap'
import { createReliefTerrain, type DressingProp, type ReliefTerrain } from '../../terrain-kit/reliefTerrain'

export interface MarsMapLayerOptions {
  /**
   * Real HiRISE elevation from `GET /v1/mars-terrain/{seed}`: it shapes the
   * playable 50x50 cells, which the procedural art system dresses, inside a
   * synthetic procedural border (see `createMarsTerrainScenery`).
   */
  terrainData?: MarsTerrainDataV1
  /** Procedural seed used when `terrainData` is omitted. */
  seed?: number
  cellSize?: number
  skirtDepth?: number
  /** Server cell mapped to world `(0, 0)` so Layer -1 aligns 1:1 with `CorridorGrid`. */
  originCell?: { readonly cellX: number; readonly cellY: number }
  /** Initial base cells (`0..49`) to clear of props and use for average ground height alignment. */
  initialBaseCells?: ReadonlyArray<{ readonly cellX: number; readonly cellY: number }>
}

/** Mission terrain seed until match state carries one: the procedural seed and the real-terrain request seed. */
export const DEFAULT_FALLBACK_SEED = 42
const DEFAULT_CELL_SIZE = 1
const DEFAULT_SKIRT_DEPTH = 1.7
/**
 * Total procedural terrain size (75x75) around the playable 50x50 grid so edges stay out of view
 * (real maps get their own synthetic border, `MARS_SCENERY.borderCells`).
 */
const PROCEDURAL_TERRAIN_SIZE = 75
const GROUND_CLEARANCE = 0.02
/** Half-width of the square mined around a built cell: its ±0.5 walls plus a margin so faces never poke inside. */
const MINE_HALF_SPAN = 0.76
/** World height mined ground is brought to, just below the corridor floor deck. */
const MINE_FLOOR_Y = -0.18

/**
 * Earthwork for real terrain. Measured ground is drawn at true scale, so a
 * flat corridor can sit several units above or below it (Russell crater
 * spans about ±5 units around the base). Built cells are therefore cut *and*
 * filled to `MINE_FLOOR_Y`, and the rendered ground blends back to the
 * original height over `blendWidth` world units around the mined square.
 * Dressing is never squashed: props over the mined square are hidden whole,
 * props on the blend move with the ground. Only rendered geometry changes;
 * the elevation samples are never touched.
 */
const REAL_TERRAIN_GRADING = {
  blendWidth: 2,
}

/** Scatter rocks count as this share of their instance scale around their centre when tested against the mined square. */
const SCATTER_ROCK_RADIUS_SHARE = 0.6

/** A baked prop tracked on real maps, so construction can hide or move it as a whole (world coordinates). */
interface PropState {
  readonly parts: { mesh: THREE.Mesh; start: number; count: number }[]
  readonly anchor: THREE.Vector3
  readonly bounds: DressingProp['bounds']
  readonly decal: boolean
  /** Rendered ground height under the anchor, after earlier grading. */
  groundY: number
  hidden: boolean
}

/** Square of half-width `half` around (x, z) against a horizontal extent: Chebyshev distances to its nearest and farthest points. */
function extentDistances(bounds: DressingProp['bounds'], x: number, z: number) {
  const gap = (min: number, max: number, v: number) => Math.max(min - v, 0, v - max)
  const far = (min: number, max: number, v: number) => Math.max(Math.abs(min - v), Math.abs(max - v))
  return {
    near: Math.max(gap(bounds.minX, bounds.maxX, x), gap(bounds.minZ, bounds.maxZ, z)),
    far: Math.max(far(bounds.minX, bounds.maxX, x), far(bounds.minZ, bounds.maxZ, z)),
  }
}

/** Grading weight at Chebyshev distance `distance` from a built cell: 1 over the mined square, easing to 0 at `reach`. */
function gradingWeight(distance: number, reach: number): number {
  return distance > reach ? 0 : 1 - THREE.MathUtils.smoothstep(distance, MINE_HALF_SPAN, reach)
}

/**
 * Levels the initial base cells to their average relief and removes decorative
 * features so rocks or formations never spawn inside the starting 3x3 base.
 * On procedural maps the cells also become `plain` ground in the `plains`
 * region, because dunes, rubble and volcanic flow fronts add micro-relief on
 * top of the relief (up to 0.3 units for dunes) that would break the flat area.
 * Real maps draw measured metres, not relief, so levelling their relief only
 * affects colour and shading (their features are still cleared); their ground
 * is levelled on the rendered mesh by `mineCell`.
 */
function prepareInitialBaseTerrain(
  map: ReliefMap,
  baseCells: ReadonlyArray<{ readonly cellX: number; readonly cellY: number }>,
  marginX: number,
  marginZ: number,
): ReliefMap {
  if (baseCells.length === 0) return map

  const indices = new Set<number>()
  let reliefSum = 0

  for (const { cellX, cellY } of baseCells) {
    const col = cellX + marginX
    const row = cellY + marginZ
    if (col < 0 || col >= map.cols || row < 0 || row >= map.rows) continue
    const index = row * map.cols + col
    if (!indices.has(index)) {
      indices.add(index)
      reliefSum += cellAt(map, col, row).relief
    }
  }

  if (indices.size === 0) return map
  const avgRelief = reliefSum / indices.size

  const levelGround = map.classification === 'procedural'
  const cells: TerrainCell[] = map.cells.map((cell, index) => {
    if (!indices.has(index)) return cell
    const leveled: TerrainCell = { ...cell, relief: avgRelief, feature: 'none' }
    return levelGround ? { ...leveled, geology: 'plain', region: 'plains' } : leveled
  })

  return { ...map, cells }
}

/**
 * Builds and owns the Layer -1 Martian terrain aligned with `CorridorGrid`,
 * centered on the playable `50x50` grid: either seeded procedural relief
 * (`75x75`) or real `MarsTerrainDataV1` (measured `50x50` heights inside a
 * synthetic procedural border, `90x90`), dressed by the same procedural art system.
 */
export class MarsMapLayer {
  readonly map: ReliefMap
  readonly terrain: ReliefTerrain
  readonly object = new THREE.Group()
  /** Baked props on real maps, which grading hides or moves whole instead of deforming. */
  private readonly props: PropState[] = []
  /** Current ground height under each scatter rock on real maps, after earlier grading. */
  private readonly rockGround = new Map<THREE.InstancedMesh, Float32Array>()

  constructor(options: MarsMapLayerOptions = {}) {
    const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE
    const skirtDepth = options.skirtDepth ?? DEFAULT_SKIRT_DEPTH
    const origin = options.originCell ?? { cellX: MAP_SIZE / 2, cellY: MAP_SIZE / 2 }

    // Real terrain: measured heights, procedural dressing and a synthetic border, as game art.
    const rawMap = options.terrainData
      ? createMarsTerrainScenery(options.terrainData)
      : generateReliefMap(options.seed ?? DEFAULT_FALLBACK_SEED, PROCEDURAL_TERRAIN_SIZE, PROCEDURAL_TERRAIN_SIZE)

    const marginX = Math.floor((rawMap.cols - MAP_SIZE) / 2)
    const marginZ = Math.floor((rawMap.rows - MAP_SIZE) / 2)
    const baseCells = options.initialBaseCells ?? []

    this.map = prepareInitialBaseTerrain(rawMap, baseCells, marginX, marginZ)
    this.terrain = createReliefTerrain({
      map: this.map,
      cellSize,
      skirtDepth,
    })

    // `terrain-kit` centers the grid on `(0, 0)` with cell centers at `(col - cols/2 + 0.5, row - rows/2 + 0.5)`.
    const originCol = origin.cellX + marginX
    const originRow = origin.cellY + marginZ
    const offsetX = (this.map.cols / 2 - originCol - 0.5) * cellSize
    const offsetZ = (this.map.rows / 2 - originRow - 0.5) * cellSize

    // Align the terrain vertically to the average surface height of the initial 3x3 base.
    let heightSum = 0
    let heightCount = 0
    for (const { cellX, cellY } of baseCells) {
      const localX = (cellX - origin.cellX) * cellSize - offsetX
      const localZ = (cellY - origin.cellY) * cellSize - offsetZ
      heightSum += this.terrain.surface.heightAt(localX, localZ)
      heightCount++
    }
    const avgBaseHeight =
      heightCount > 0
        ? heightSum / heightCount
        : this.terrain.surface.heightAt(-offsetX, -offsetZ)

    this.terrain.root.position.set(offsetX, -avgBaseHeight - GROUND_CLEARANCE, offsetZ)
    this.object.name = 'MarsMapLayer'
    this.object.add(this.terrain.root)

    if (this.map.elevation) {
      this.object.updateMatrixWorld(true)
      this.trackDressing()
    }
  }

  /** Whether this layer draws measured elevation (and grades built cells) rather than procedural relief. */
  get isRealTerrain(): boolean {
    return this.map.elevation !== undefined
  }

  /**
   * Excavates ("mines") any terrain or baked rock vertices inside the 1×1 cell
   * centered at `(worldX, worldZ)` (plus a 1-ring margin outside the ±0.5 walls)
   * down below `y = -0.18` so angled triangle faces never poke inside corridors.
   * Real terrain is graded instead (cut and fill, see `REAL_TERRAIN_GRADING`).
   * Only rendered geometry changes; `map` and its elevation samples never do.
   */
  mineCell(worldX: number, worldZ: number): void {
    const x = Math.round(worldX)
    const z = Math.round(worldZ)
    const halfSpan = MINE_HALF_SPAN
    const floorY = MINE_FLOOR_Y

    this.terrain.root.updateMatrixWorld(true)
    if (this.isRealTerrain) {
      this.gradeCell(x, z)
      return
    }
    this.hideInstancesInCell(x, z)

    const cellBox = new THREE.Box3(
      new THREE.Vector3(x - halfSpan, floorY, z - halfSpan),
      new THREE.Vector3(x + halfSpan, Infinity, z + halfSpan),
    )
    const meshBox = new THREE.Box3()
    const invWorld = new THREE.Matrix4()
    const vertex = new THREE.Vector3()

    this.terrain.root.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) return
      if (!(obj instanceof THREE.Mesh)) return
      const pos = obj.geometry.getAttribute('position')
      if (!(pos instanceof THREE.BufferAttribute)) return

      meshBox.setFromObject(obj)
      if (!meshBox.intersectsBox(cellBox)) return

      invWorld.copy(obj.matrixWorld).invert()
      let modified = false

      for (let i = 0; i < pos.count; i++) {
        vertex.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld)
        if (
          Math.abs(vertex.x - x) <= halfSpan &&
          Math.abs(vertex.z - z) <= halfSpan &&
          vertex.y > floorY
        ) {
          vertex.y = floorY
          vertex.applyMatrix4(invWorld)
          pos.setXYZ(i, vertex.x, vertex.y, vertex.z)
          modified = true
        }
      }

      if (modified) {
        pos.needsUpdate = true
        obj.geometry.computeVertexNormals()
        obj.geometry.computeBoundingBox()
        obj.geometry.computeBoundingSphere()
      }
    })
  }

  dispose(): void {
    disposeObject(this.terrain.root)
  }

  /** Records, for real maps, where each baked prop's vertices are and the ground under every scatter rock. */
  private trackDressing(): void {
    const offset = this.terrain.root.getWorldPosition(new THREE.Vector3())
    const states: PropState[] = this.terrain.props.map((prop) => ({
      parts: [],
      anchor: prop.anchor.clone().add(offset),
      bounds: {
        minX: prop.bounds.minX + offset.x,
        maxX: prop.bounds.maxX + offset.x,
        minZ: prop.bounds.minZ + offset.z,
        maxZ: prop.bounds.maxZ + offset.z,
      },
      decal: prop.decal,
      groundY: prop.groundY + offset.y,
      hidden: false,
    }))
    const instanceMat = new THREE.Matrix4()
    this.terrain.root.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) {
        const ground = new Float32Array(obj.count)
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, instanceMat)
          ground[i] = new THREE.Vector3().setFromMatrixPosition(instanceMat.premultiply(obj.matrixWorld)).y
        }
        this.rockGround.set(obj, ground)
        return
      }
      if (!(obj instanceof THREE.Mesh)) return
      const bakedParts = obj.userData.bakedParts as BakedPart[] | undefined
      for (const { owner, start, count } of bakedParts ?? []) states[owner]?.parts.push({ mesh: obj, start, count })
    })
    this.props.push(...states)
  }

  /** Hides instanced rocks whose origin lies inside the mined square above the floor. */
  private hideInstancesInCell(x: number, z: number): void {
    const instanceMat = new THREE.Matrix4()
    const worldMat = new THREE.Matrix4()
    const vertex = new THREE.Vector3()
    this.terrain.root.traverse((obj) => {
      if (!(obj instanceof THREE.InstancedMesh)) return
      let instanceModified = false
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, instanceMat)
        worldMat.multiplyMatrices(obj.matrixWorld, instanceMat)
        vertex.setFromMatrixPosition(worldMat)
        if (
          Math.abs(vertex.x - x) <= MINE_HALF_SPAN &&
          Math.abs(vertex.z - z) <= MINE_HALF_SPAN &&
          vertex.y > MINE_FLOOR_Y
        ) {
          instanceMat.makeScale(0, 0, 0)
          obj.setMatrixAt(i, instanceMat)
          instanceModified = true
        }
      }
      if (instanceModified) {
        obj.instanceMatrix.needsUpdate = true
      }
    })
  }

  /**
   * Real-terrain earthwork for the built cell `(x, z)`: rendered ground in the
   * mined square is cut or filled to `MINE_FLOOR_Y`; within `blendWidth` around
   * it, it moves toward the floor by a smooth weight that falls to zero, so the
   * surface stays continuous. Each call only moves ground toward the floor, so
   * cells mined earlier stay flat when neighbours are built later.
   */
  private gradeCell(x: number, z: number): void {
    const reach = MINE_HALF_SPAN + REAL_TERRAIN_GRADING.blendWidth
    this.gradeGround(x, z, reach)
    this.gradeProps(x, z, reach)
    this.gradeRocks(x, z, reach)
  }

  /**
   * Grades the surface chunks (dressing is handled whole, see `gradeProps`). The
   * diorama skirt lies `MARS_SCENERY.borderCells` beyond the last buildable cell,
   * out of the grading reach.
   */
  private gradeGround(x: number, z: number, reach: number): void {
    const area = new THREE.Box3(
      new THREE.Vector3(x - reach, -Infinity, z - reach),
      new THREE.Vector3(x + reach, Infinity, z + reach),
    )
    const meshBox = new THREE.Box3()
    const invWorld = new THREE.Matrix4()
    const vertex = new THREE.Vector3()
    for (const obj of this.terrain.chunks) {
      const pos = obj.geometry.getAttribute('position')
      if (!(pos instanceof THREE.BufferAttribute)) continue
      meshBox.setFromObject(obj)
      if (!meshBox.intersectsBox(area)) continue

      invWorld.copy(obj.matrixWorld).invert()
      let modified = false

      for (let i = 0; i < pos.count; i++) {
        vertex.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld)
        const weight = gradingWeight(Math.max(Math.abs(vertex.x - x), Math.abs(vertex.z - z)), reach)
        if (weight === 0) continue
        const graded = vertex.y + (MINE_FLOOR_Y - vertex.y) * weight
        if (graded === vertex.y) continue
        vertex.y = graded
        vertex.applyMatrix4(invWorld)
        pos.setXYZ(i, vertex.x, vertex.y, vertex.z)
        modified = true
      }

      if (modified) {
        pos.needsUpdate = true
        obj.geometry.computeVertexNormals()
        obj.geometry.computeBoundingBox()
        obj.geometry.computeBoundingSphere()
      }
    }
  }

  /**
   * Baked props are kept rigid. A prop reaching over the mined square (or a
   * crack decal anywhere on the graded ground) is hidden by collapsing its
   * vertices; one standing on the blend moves vertically with the ground under
   * it, using the weight that seats it into the ground rather than leaving any
   * edge hanging (the nearest point when the ground is cut, the farthest when filled).
   */
  private gradeProps(x: number, z: number, reach: number): void {
    const touched = new Set<THREE.Mesh>()
    const local = new THREE.Vector3()
    for (const prop of this.props) {
      if (prop.hidden) continue
      const { near, far } = extentDistances(prop.bounds, x, z)
      if (near <= MINE_HALF_SPAN || (prop.decal && near <= reach)) {
        for (const { mesh, start, count } of prop.parts) {
          mesh.worldToLocal(local.copy(prop.anchor))
          const pos = mesh.geometry.getAttribute('position')
          for (let i = start; i < start + count; i++) pos.setXYZ(i, local.x, local.y, local.z)
          touched.add(mesh)
        }
        prop.hidden = true
        continue
      }
      const lift = MINE_FLOOR_Y - prop.groundY
      const weight = gradingWeight(lift < 0 ? near : far, reach)
      const dy = lift * weight
      if (dy === 0) continue
      // The dressing hierarchy only translates, so a world-space lift is the same in mesh space.
      for (const { mesh, start, count } of prop.parts) {
        const pos = mesh.geometry.getAttribute('position')
        for (let i = start; i < start + count; i++) pos.setY(i, pos.getY(i) + dy)
        touched.add(mesh)
      }
      prop.groundY += dy
      prop.anchor.y += dy
    }
    for (const mesh of touched) {
      mesh.geometry.getAttribute('position').needsUpdate = true
      mesh.geometry.computeBoundingBox()
      mesh.geometry.computeBoundingSphere()
    }
  }

  /** Scatter rocks: hidden over the mined square, moved with the ground on the blend. */
  private gradeRocks(x: number, z: number, reach: number): void {
    const instanceMat = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    for (const [rocks, ground] of this.rockGround) {
      let modified = false
      for (let i = 0; i < rocks.count; i++) {
        rocks.getMatrixAt(i, instanceMat)
        instanceMat.decompose(position, rotation, scale)
        if (scale.x === 0) continue
        position.applyMatrix4(rocks.matrixWorld)
        const radius = Math.max(scale.x, scale.y, scale.z) * SCATTER_ROCK_RADIUS_SHARE
        const centre = Math.max(Math.abs(position.x - x), Math.abs(position.z - z))
        if (centre - radius <= MINE_HALF_SPAN) {
          rocks.setMatrixAt(i, instanceMat.makeScale(0, 0, 0))
          modified = true
          continue
        }
        const lift = MINE_FLOOR_Y - ground[i]
        const dy = lift * gradingWeight(lift < 0 ? centre - radius : centre + radius, reach)
        if (dy === 0) continue
        instanceMat.elements[13] += dy
        rocks.setMatrixAt(i, instanceMat)
        ground[i] += dy
        modified = true
      }
      if (modified) {
        rocks.instanceMatrix.needsUpdate = true
        rocks.computeBoundingSphere()
      }
    }
  }
}
