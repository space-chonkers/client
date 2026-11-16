import * as THREE from 'three'
import { disposeObject } from '../../terrain-kit/dispose'
import {
  createReliefMapFromMarsTerrain,
  type MarsTerrainDataV1,
} from '../../terrain-kit/marsTerrainContract'
import {
  cellAt,
  generateReliefMap,
  MAP_SIZE,
  type ReliefMap,
  type TerrainCell,
} from '../../terrain-kit/reliefMap'
import { createReliefTerrain, type ReliefTerrain } from '../../terrain-kit/reliefTerrain'
import { TERRAIN_SKIRT_NAME } from '../../terrain-kit/terrain'

export interface MarsMapLayerOptions {
  /**
   * Real HiRISE elevation from `GET /v1/mars-terrain/{seed}`. Drawn unclassified
   * (no procedural geology or minerals) over exactly the measured 50x50 footprint.
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
/** Extra non-playable terrain border around the 50x50 grid so map edges stay out of view. */
const TERRAIN_BORDER_CELLS = 10
const GROUND_CLEARANCE = 0.02
/** Half-width of the square mined around a built cell: its ±0.5 walls plus a margin so faces never poke inside. */
const MINE_HALF_SPAN = 0.76
/** World height mined ground is brought to, just below the corridor floor deck. */
const MINE_FLOOR_Y = -0.18

/**
 * Earthwork for real terrain. Measured ground is drawn at true scale, so a
 * flat corridor can sit several units above or below it (Russell crater
 * spans about ±5 units around the base). Built cells are therefore cut *and*
 * filled to `MINE_FLOOR_Y`, and the rendered surface blends back to the
 * original height over `blendWidth` world units around the mined square.
 * Only rendered vertices move; the elevation samples are never touched.
 */
const REAL_TERRAIN_GRADING = {
  blendWidth: 2,
  /** Skirt vertices this close to its bottom stay put, so the diorama walls keep their base. */
  skirtBottomTolerance: 1e-3,
}

/**
 * Real maps cover exactly the measured footprint, so their diorama edge can
 * come into view. A flat, neutral apron just below the skirt reads as "outside
 * the survey" instead of empty space; it is never shaped like terrain.
 */
const REAL_TERRAIN_APRON = { size: 240, color: '#5a4a45', gapBelowSkirt: 0.01 }

/**
 * Levels the initial base cells to their average relief and removes decorative
 * features so rocks or formations never spawn inside the starting 3x3 base.
 * On procedural maps the cells also become `plain` ground in the `plains`
 * region, because dunes, rubble and volcanic flow fronts add micro-relief on
 * top of the relief (up to 0.3 units for dunes) that would break the flat area.
 * Real maps draw measured metres, not relief, so levelling their relief only
 * affects colour and shading; their ground is levelled on the rendered mesh by
 * `mineCell`.
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
 * Builds and owns the Layer -1 Martian terrain aligned with `CorridorGrid`.
 * Uses real `MarsTerrainDataV1` (exactly the `50x50` measured footprint) when
 * provided, otherwise a seeded procedural `70x70` `ReliefMap` centered on the
 * playable `50x50` grid.
 */
export class MarsMapLayer {
  readonly map: ReliefMap
  readonly terrain: ReliefTerrain
  readonly object = new THREE.Group()
  /** Neutral ground under real maps' diorama edge; `null` for procedural maps, whose border is terrain. */
  readonly boundaryApron: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null
  /** World height of the skirt bottom on real maps, which grading must not lift. */
  private readonly skirtBottomY: number = -Infinity

  constructor(options: MarsMapLayerOptions = {}) {
    const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE
    const skirtDepth = options.skirtDepth ?? DEFAULT_SKIRT_DEPTH
    const origin = options.originCell ?? { cellX: MAP_SIZE / 2, cellY: MAP_SIZE / 2 }

    const proceduralSize = MAP_SIZE + TERRAIN_BORDER_CELLS * 2
    // Real terrain keeps the default `classification: 'none'`: measured ground carries no invented geology.
    const rawMap = options.terrainData
      ? createReliefMapFromMarsTerrain(options.terrainData)
      : generateReliefMap(options.seed ?? DEFAULT_FALLBACK_SEED, proceduralSize, proceduralSize)

    const marginX = Math.floor((rawMap.cols - MAP_SIZE) / 2)
    const marginZ = Math.floor((rawMap.rows - MAP_SIZE) / 2)
    const baseCells = options.initialBaseCells ?? []

    this.map = rawMap.elevation ? rawMap : prepareInitialBaseTerrain(rawMap, baseCells, marginX, marginZ)
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
      const skirt = this.terrain.root.getObjectByName(TERRAIN_SKIRT_NAME)
      this.skirtBottomY = skirt ? new THREE.Box3().setFromObject(skirt).min.y : -Infinity
      this.boundaryApron = createBoundaryApron(new THREE.Box3().setFromObject(this.terrain.root))
      this.object.add(this.boundaryApron)
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
    this.hideInstancesInCell(x, z)
    if (this.isRealTerrain) {
      this.gradeCell(x, z)
      return
    }

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
    if (this.boundaryApron) disposeObject(this.boundaryApron)
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
   * Real-terrain earthwork for the built cell `(x, z)`: rendered vertices in the
   * mined square are cut or filled to `MINE_FLOOR_Y`; within `blendWidth` around
   * it they move toward the floor by a smooth weight that falls to zero, so the
   * surface stays continuous. Each call only moves vertices toward the floor, so
   * cells mined earlier stay flat when neighbours are built later.
   */
  private gradeCell(x: number, z: number): void {
    const reach = MINE_HALF_SPAN + REAL_TERRAIN_GRADING.blendWidth
    const area = new THREE.Box3(
      new THREE.Vector3(x - reach, -Infinity, z - reach),
      new THREE.Vector3(x + reach, Infinity, z + reach),
    )
    const meshBox = new THREE.Box3()
    const invWorld = new THREE.Matrix4()
    const vertex = new THREE.Vector3()

    this.terrain.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj instanceof THREE.InstancedMesh) return
      const pos = obj.geometry.getAttribute('position')
      if (!(pos instanceof THREE.BufferAttribute)) return
      meshBox.setFromObject(obj)
      if (!meshBox.intersectsBox(area)) return

      // The skirt's bottom edge and floor stay where they are; its upper edge follows the graded surface.
      const pinnedBelow =
        obj.name === TERRAIN_SKIRT_NAME ? this.skirtBottomY + REAL_TERRAIN_GRADING.skirtBottomTolerance : -Infinity
      invWorld.copy(obj.matrixWorld).invert()
      let modified = false

      for (let i = 0; i < pos.count; i++) {
        vertex.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld)
        const distance = Math.max(Math.abs(vertex.x - x), Math.abs(vertex.z - z))
        if (distance > reach || vertex.y <= pinnedBelow) continue
        const weight = 1 - THREE.MathUtils.smoothstep(distance, MINE_HALF_SPAN, reach)
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
    })
  }
}

/** Flat neutral ground just below a real map's skirt, centred on the terrain footprint. */
function createBoundaryApron(terrainBounds: THREE.Box3): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  const { size, color, gapBelowSkirt } = REAL_TERRAIN_APRON
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 }),
  )
  const center = terrainBounds.getCenter(new THREE.Vector3())
  apron.position.set(center.x, terrainBounds.min.y - gapBelowSkirt, center.z)
  apron.name = 'terrain-boundary-apron'
  apron.receiveShadow = true
  return apron
}
