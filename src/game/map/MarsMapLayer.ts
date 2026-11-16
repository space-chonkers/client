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

export interface MarsMapLayerOptions {
  /** Authoritative geospatial terrain payload from the backend contract, when available. */
  terrainData?: MarsTerrainDataV1
  /** Fallback procedural seed used while `jam-server` does not yet serve `MarsTerrainDataV1`. */
  seed?: number
  cellSize?: number
  skirtDepth?: number
  /** Server cell mapped to world `(0, 0)` so Layer -1 aligns 1:1 with `CorridorGrid`. */
  originCell?: { readonly cellX: number; readonly cellY: number }
  /** Initial base cells (`0..49`) to clear of props and use for average ground height alignment. */
  initialBaseCells?: ReadonlyArray<{ readonly cellX: number; readonly cellY: number }>
}

const DEFAULT_FALLBACK_SEED = 42
const DEFAULT_CELL_SIZE = 1
const DEFAULT_SKIRT_DEPTH = 1.7
/** Extra non-playable terrain border around the 50x50 grid so map edges stay out of view. */
const TERRAIN_BORDER_CELLS = 10
const GROUND_CLEARANCE = 0.02

/**
 * Levels the initial base cells to their average relief and removes decorative
 * features so rocks or formations never spawn inside the starting 3x3 base.
 * On procedural maps the cells also become `plain` ground in the `plains`
 * region, because dunes, rubble and volcanic flow fronts add micro-relief on
 * top of the relief (up to 0.3 units for dunes) that would break the flat area.
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
 * Uses `MarsTerrainDataV1` when provided, falling back to a temporary seeded
 * procedural `70x70` `ReliefMap` (centered on the playable `50x50` grid) until
 * the backend serves terrain payloads.
 */
export class MarsMapLayer {
  readonly map: ReliefMap
  readonly terrain: ReliefTerrain
  readonly object = new THREE.Group()

  constructor(options: MarsMapLayerOptions = {}) {
    const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE
    const skirtDepth = options.skirtDepth ?? DEFAULT_SKIRT_DEPTH
    const origin = options.originCell ?? { cellX: MAP_SIZE / 2, cellY: MAP_SIZE / 2 }

    // Temporary procedural fallback until `jam-server` sends `MarsTerrainDataV1` or `seed`.
    const proceduralSize = MAP_SIZE + TERRAIN_BORDER_CELLS * 2
    const rawMap = options.terrainData
      ? createReliefMapFromMarsTerrain(options.terrainData, { classification: 'procedural' })
      : generateReliefMap(options.seed ?? DEFAULT_FALLBACK_SEED, proceduralSize, proceduralSize)

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
  }

  /**
   * Excavates ("mines") any terrain or baked rock vertices inside the 1×1 cell
   * centered at `(worldX, worldZ)` (plus a 1-ring margin outside the ±0.5 walls)
   * down below `y = -0.18` so angled triangle faces never poke inside corridors.
   */
  mineCell(worldX: number, worldZ: number): void {
    const x = Math.round(worldX)
    const z = Math.round(worldZ)
    const halfSpan = 0.76
    const floorY = -0.18

    this.terrain.root.updateMatrixWorld(true)

    const cellBox = new THREE.Box3(
      new THREE.Vector3(x - halfSpan, floorY, z - halfSpan),
      new THREE.Vector3(x + halfSpan, Infinity, z + halfSpan),
    )
    const meshBox = new THREE.Box3()
    const invWorld = new THREE.Matrix4()
    const instanceMat = new THREE.Matrix4()
    const worldMat = new THREE.Matrix4()
    const vertex = new THREE.Vector3()

    this.terrain.root.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) {
        let instanceModified = false
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, instanceMat)
          worldMat.multiplyMatrices(obj.matrixWorld, instanceMat)
          vertex.setFromMatrixPosition(worldMat)
          if (
            Math.abs(vertex.x - x) <= halfSpan &&
            Math.abs(vertex.z - z) <= halfSpan &&
            vertex.y > floorY
          ) {
            instanceMat.makeScale(0, 0, 0)
            obj.setMatrixAt(i, instanceMat)
            instanceModified = true
          }
        }
        if (instanceModified) {
          obj.instanceMatrix.needsUpdate = true
        }
        return
      }

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
}
