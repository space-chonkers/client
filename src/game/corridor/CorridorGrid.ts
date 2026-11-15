import * as THREE from 'three'
import {
  createCorridorSegment,
  layerToWorldY,
  SPATIAL_LAYERS,
  type CardinalSide,
  type CorridorWallVariant,
} from '../../assets/SpaceCorridor'
import { createStash } from '../../assets/Stash'

export type ConstructionKind = 'base_tile' | 'stash'

export interface ConstructionPayload {
  id: string
  kind: ConstructionKind
  cellX: number
  cellY: number
}

export interface CorridorOrientation {
  wallCount: CorridorWallVariant
  isCorner: boolean
  rotationY: number
}

interface StoredTile {
  kind: ConstructionKind
  group: THREE.Group
}

/** Max offset from a tile center before the player hits a closed wall or corner pillar. */
export const WALL_COLLISION_OFFSET = 0.12
/** Half-extent of the solid stash cargo box collision boundary (box is 0.45x0.45 + player radius). */
const STASH_COLLISION_HALF = 0.46
/** Speed at which the player slides around a corner pillar into an open doorway. */
const CORNER_SLIDE_SPEED = 3.2

const NEIGHBOR_OFFSETS: ReadonlyArray<{
  side: CardinalSide
  dx: number
  dz: number
}> = [
  { side: 'north', dx: 0, dz: -1 },
  { side: 'south', dx: 0, dz: 1 },
  { side: 'east', dx: 1, dz: 0 },
  { side: 'west', dx: -1, dz: 0 },
]

/**
 * Resolves the corridor variant (0, 1, 2, or 3 walls, straight vs corner) and
 * Y-axis rotation in radians based on which cardinal neighbors are occupied.
 */
export function resolveCorridorOrientation(
  openSides: ReadonlySet<CardinalSide>,
): CorridorOrientation {
  const openCount = openSides.size

  // 4 open sides -> Cross hub (0 walls)
  if (openCount >= 4) {
    return { wallCount: 0, isCorner: false, rotationY: 0 }
  }

  // 3 open sides -> T-junction (1 closed wall; canonical model has wall on 'north')
  if (openCount === 3) {
    let rotationY = 0
    if (!openSides.has('north')) rotationY = 0
    else if (!openSides.has('west')) rotationY = Math.PI / 2
    else if (!openSides.has('south')) rotationY = Math.PI
    else if (!openSides.has('east')) rotationY = -Math.PI / 2

    return { wallCount: 1, isCorner: false, rotationY }
  }

  // 2 open sides -> Straight corridor or L-corner (2 closed walls)
  if (openCount === 2) {
    const northOpen = openSides.has('north')
    const southOpen = openSides.has('south')
    const eastOpen = openSides.has('east')
    const westOpen = openSides.has('west')

    // Opposite open sides -> Straight segment (canonical open axis is north-south)
    if (northOpen && southOpen) {
      return { wallCount: 2, isCorner: false, rotationY: 0 }
    }
    if (eastOpen && westOpen) {
      return { wallCount: 2, isCorner: false, rotationY: Math.PI / 2 }
    }

    // Adjacent open sides -> Corner segment (canonical closed walls: 'north' & 'west', open: 'south' & 'east')
    let rotationY = 0
    if (southOpen && eastOpen) rotationY = 0
    else if (northOpen && eastOpen) rotationY = Math.PI / 2
    else if (northOpen && westOpen) rotationY = Math.PI
    else if (southOpen && westOpen) rotationY = -Math.PI / 2

    return { wallCount: 2, isCorner: true, rotationY }
  }

  // 1 or 0 open sides -> Border terminal (3 closed walls; canonical open exit is 'south')
  let rotationY = 0
  if (openSides.has('south')) rotationY = 0
  else if (openSides.has('east')) rotationY = Math.PI / 2
  else if (openSides.has('north')) rotationY = Math.PI
  else if (openSides.has('west')) rotationY = -Math.PI / 2

  return { wallCount: 3, isCorner: false, rotationY }
}

/** Top of the corridor floor deck where the stash cargo box rests. */
const CORRIDOR_DECK_TOP = 0.08

function toTileKey(gridX: number, gridZ: number): string {
  return `${Math.round(gridX)},${Math.round(gridZ)}`
}

function moveToward(current: number, target: number, maxStep: number): number {
  const diff = target - current
  if (Math.abs(diff) <= maxStep) return target
  return current + Math.sign(diff) * maxStep
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose())
      } else {
        obj.material.dispose()
      }
    }
  })
}

/**
 * Layer 0 corridor grid manager that places roofless corridor tiles from
 * server construction payloads (`base_tile` and `stash`), auto-orients walls
 * whenever adjacent tiles change, and enforces wall collision.
 */
export class CorridorGrid {
  readonly object = new THREE.Group()
  private readonly tiles = new Map<string, StoredTile>()

  constructor() {
    this.object.name = 'CorridorGrid'
    this.object.position.y = layerToWorldY(SPATIAL_LAYERS.STRUCTURES)
  }

  hasTile(gridX: number, gridZ: number): boolean {
    return this.tiles.has(toTileKey(gridX, gridZ))
  }

  getTileKind(gridX: number, gridZ: number): ConstructionKind | undefined {
    return this.tiles.get(toTileKey(gridX, gridZ))?.kind
  }

  /** Places a corridor tile at (gridX, gridZ) and updates adjacent neighbor walls. */
  placeTile(
    gridX: number,
    gridZ: number,
    kind: ConstructionKind = 'base_tile',
  ): boolean {
    const x = Math.round(gridX)
    const z = Math.round(gridZ)
    const key = toTileKey(x, z)
    if (this.tiles.has(key)) return false

    this.tiles.set(key, { kind, group: new THREE.Group() })
    this.refreshTileAndNeighbors(x, z)
    return true
  }

  /**
   * Loads a list of server `constructions` (`{ id, kind, cellX, cellY }`).
   * An optional `originCell` shifts `(cellX, cellY)` into local scene coordinates.
   */
  loadConstructions(
    constructions: ReadonlyArray<ConstructionPayload>,
    originCell: { readonly cellX: number; readonly cellY: number } = {
      cellX: 0,
      cellY: 0,
    },
  ): void {
    const added: Array<readonly [number, number]> = []
    for (const item of constructions) {
      const x = Math.round(item.cellX - originCell.cellX)
      const z = Math.round(item.cellY - originCell.cellY)
      const key = toTileKey(x, z)
      if (!this.tiles.has(key)) {
        this.tiles.set(key, { kind: item.kind, group: new THREE.Group() })
        added.push([x, z])
      }
    }

    for (const [x, z] of added) {
      this.rebuildTileMesh(x, z)
    }
  }

  /** Removes a corridor tile at (gridX, gridZ) and updates adjacent neighbor walls. */
  removeTile(gridX: number, gridZ: number): boolean {
    const x = Math.round(gridX)
    const z = Math.round(gridZ)
    const key = toTileKey(x, z)
    const existing = this.tiles.get(key)
    if (!existing || existing.kind === 'stash') return false

    this.object.remove(existing.group)
    disposeGroup(existing.group)
    this.tiles.delete(key)

    for (const { dx, dz } of NEIGHBOR_OFFSETS) {
      this.rebuildTileMesh(x + dx, z + dz)
    }
    return true
  }

  /** Toggles a `base_tile` at (gridX, gridZ). Protected `stash` tiles cannot be removed. */
  toggleTile(gridX: number, gridZ: number): boolean {
    if (this.hasTile(gridX, gridZ)) {
      this.removeTile(gridX, gridZ)
      return this.hasTile(gridX, gridZ)
    }
    this.placeTile(gridX, gridZ, 'base_tile')
    return true
  }

  /**
   * Returns true if world coordinate (x, z) lies within the walkable interior
   * of an occupied corridor tile and clear of closed walls, corner pillars,
   * and the central stash cargo box.
   */
  isWalkable(x: number, z: number): boolean {
    const tx = Math.round(x)
    const tz = Math.round(z)
    const tile = this.tiles.get(toTileKey(tx, tz))
    if (!tile) return false

    const dx = x - tx
    const dz = z - tz

    // Solid cargo box on 'stash' tiles blocks the central area around the box.
    if (
      tile.kind === 'stash' &&
      Math.abs(dx) < STASH_COLLISION_HALF &&
      Math.abs(dz) < STASH_COLLISION_HALF
    ) {
      return false
    }

    // Corner pillars occupy the diagonal corners where both |dx| and |dz| exceed the lane offset.
    if (Math.abs(dx) > WALL_COLLISION_OFFSET && Math.abs(dz) > WALL_COLLISION_OFFSET) {
      return false
    }

    if (dx < -WALL_COLLISION_OFFSET && !this.hasTile(tx - 1, tz)) return false
    if (dx > WALL_COLLISION_OFFSET && !this.hasTile(tx + 1, tz)) return false
    if (dz < -WALL_COLLISION_OFFSET && !this.hasTile(tx, tz - 1)) return false
    if (dz > WALL_COLLISION_OFFSET && !this.hasTile(tx, tz + 1)) return false

    return true
  }

  /**
   * Constrains player movement from `prev` to `target` so the player stops
   * cleanly at closed corridor walls, corner pillars, and the stash cargo box.
   */
  constrainMovement(prev: THREE.Vector3, target: THREE.Vector3, delta = 0): void {
    const tx = Math.round(prev.x)
    const tz = Math.round(prev.z)
    if (!this.hasTile(tx, tz)) return

    let resolvedX = prev.x
    let resolvedZ = prev.z

    // 1. Resolve X-axis movement monotonically (never pushes backward)
    if (this.isWalkable(target.x, resolvedZ)) {
      resolvedX = target.x
    } else {
      let low = prev.x
      let high = target.x
      for (let i = 0; i < 6; i++) {
        const mid = (low + high) * 0.5
        if (this.isWalkable(mid, resolvedZ)) low = mid
        else high = mid
      }
      resolvedX = low

      const dirX = Math.sign(target.x - prev.x)
      if (dirX !== 0 && this.getTileKind(tx + dirX, tz) === 'base_tile' && delta > 0) {
        const nudgedZ = moveToward(resolvedZ, tz, CORNER_SLIDE_SPEED * delta)
        if (this.isWalkable(resolvedX, nudgedZ)) resolvedZ = nudgedZ
      }
    }

    // 2. Resolve Z-axis movement monotonically (never pushes backward)
    if (this.isWalkable(resolvedX, target.z)) {
      resolvedZ = target.z
    } else {
      let low = prev.z
      let high = target.z
      for (let i = 0; i < 6; i++) {
        const mid = (low + high) * 0.5
        if (this.isWalkable(resolvedX, mid)) low = mid
        else high = mid
      }
      resolvedZ = low

      const dirZ = Math.sign(target.z - prev.z)
      if (dirZ !== 0 && this.getTileKind(tx, tz + dirZ) === 'base_tile' && delta > 0) {
        const nudgedX = moveToward(resolvedX, tx, CORNER_SLIDE_SPEED * delta)
        if (this.isWalkable(nudgedX, resolvedZ)) resolvedX = nudgedX
      }
    }

    target.x = resolvedX
    target.z = resolvedZ
  }

  dispose(): void {
    for (const tile of this.tiles.values()) {
      this.object.remove(tile.group)
      disposeGroup(tile.group)
    }
    this.tiles.clear()
  }

  private refreshTileAndNeighbors(x: number, z: number): void {
    this.rebuildTileMesh(x, z)
    for (const { dx, dz } of NEIGHBOR_OFFSETS) {
      this.rebuildTileMesh(x + dx, z + dz)
    }
  }

  private rebuildTileMesh(x: number, z: number): void {
    const key = toTileKey(x, z)
    const existing = this.tiles.get(key)
    if (!existing) return

    this.object.remove(existing.group)
    disposeGroup(existing.group)

    const openSides = new Set<CardinalSide>()
    for (const { side, dx, dz } of NEIGHBOR_OFFSETS) {
      if (this.tiles.has(toTileKey(x + dx, z + dz))) {
        openSides.add(side)
      }
    }

    const { wallCount, isCorner, rotationY } = resolveCorridorOrientation(openSides)
    const segment = createCorridorSegment(wallCount, isCorner)
    if (existing.kind === 'stash') {
      const stashBox = createStash()
      stashBox.position.y = CORRIDOR_DECK_TOP
      segment.add(stashBox)
    }
    segment.position.set(x, 0, z)
    segment.rotation.y = rotationY
    segment.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true
        obj.receiveShadow = true
      }
    })

    this.tiles.set(key, { kind: existing.kind, group: segment })
    this.object.add(segment)
  }
}
