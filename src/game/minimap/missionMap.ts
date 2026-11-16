import type { ConstructionPayload, OccupiedTile } from '../corridor/CorridorGrid'
import type { ServerGridDimensions, ServerInvestigationCell } from '../corridor/mockServerPayload'
import { FACING_VECTORS, type Facing } from '../player/Facing'

/**
 * Mission map model: plain data and pure helpers shared by the sandbox (which
 * publishes world state) and the `MissionMinimap` HUD (which draws it).
 *
 * World coordinates follow the server: `cellX` grows west → east, `cellY`
 * grows north → south, `(0, 0)` is the north-west cell. Cell `(x, y)` covers the
 * square `[x, x + 1) × [y, y + 1)`, so its centre is at `(x + 0.5, y + 0.5)`.
 */

/** A world cell (integer for tiles, fractional for continuous positions). */
export interface WorldCell {
  readonly cellX: number
  readonly cellY: number
}

/** A constructed cell in world coordinates: the server `ConstructionPayload` without its id. */
export type MissionMapConstruction = Readonly<Pick<ConstructionPayload, 'kind' | 'cellX' | 'cellY'>>

/** The player's continuous world position (cell units, tile centre = integer) and facing. */
export interface MissionMapPlayer extends WorldCell {
  readonly facing: Facing
}

export interface InvestigationSiteStatus extends WorldCell {
  readonly completed: boolean
}

export interface InvestigationProgress {
  readonly sites: ReadonlyArray<InvestigationSiteStatus>
  readonly completed: number
  readonly total: number
}

/** Offset from a cell's north-west corner to its centre, in cell units. */
export const CELL_CENTER_OFFSET = 0.5

/**
 * Converts sandbox scene coordinates to world cells. The sandbox places tile
 * centres on integer `(x, z)` relative to `origin`, so the result keeps the
 * same convention: integer world values are tile centres.
 */
export function sandboxToWorldCell(localX: number, localZ: number, origin: WorldCell): WorldCell {
  return { cellX: localX + origin.cellX, cellY: localZ + origin.cellY }
}

/** Converts `CorridorGrid` occupancy (local tiles) to world-cell constructions. */
export function occupiedTilesToConstructions(
  tiles: ReadonlyArray<OccupiedTile>,
  origin: WorldCell,
): MissionMapConstruction[] {
  return tiles.map(({ gridX, gridZ, kind }) => ({ kind, ...sandboxToWorldCell(gridX, gridZ, origin) }))
}

/**
 * Converts a world cell to a minimap point (one SVG user unit per cell, origin
 * at the map's north-west corner), placing integer cells at their centre.
 */
export function worldCellToMinimapPoint(cell: WorldCell): { x: number; y: number } {
  return { x: cell.cellX + CELL_CENTER_OFFSET, y: cell.cellY + CELL_CENTER_OFFSET }
}

/** Keeps a minimap point inside the map rectangle `[0, width] × [0, height]`. */
export function clampMinimapPoint(
  point: { x: number; y: number },
  grid: ServerGridDimensions,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(point.x, 0), grid.width),
    y: Math.min(Math.max(point.y, 0), grid.height),
  }
}

/** True when an integer cell lies inside the world grid. */
export function isCellInsideGrid(cell: WorldCell, grid: ServerGridDimensions): boolean {
  return (
    Number.isInteger(cell.cellX) &&
    Number.isInteger(cell.cellY) &&
    cell.cellX >= 0 &&
    cell.cellY >= 0 &&
    cell.cellX < grid.width &&
    cell.cellY < grid.height
  )
}

/** Clockwise rotation in degrees for a north-up marker, so 'up' (north) is 0. */
export function facingToMinimapRotation(facing: Facing): number {
  const { x, z } = FACING_VECTORS[facing]
  // Scene -Z is north and the minimap's +Y is south, so north maps to atan2(0, 1) = 0.
  const degrees = (Math.atan2(x, -z) * 180) / Math.PI
  return (degrees + 360) % 360
}

function toCellKey(cell: WorldCell): string {
  return `${cell.cellX},${cell.cellY}`
}

/**
 * Applies the server rule: an investigation site is completed when a
 * construction occupies its cell. Sites outside the grid are ignored.
 */
export function resolveInvestigationProgress(
  investigation: ReadonlyArray<ServerInvestigationCell>,
  constructions: ReadonlyArray<MissionMapConstruction>,
  grid: ServerGridDimensions,
): InvestigationProgress {
  const occupied = new Set(constructions.map(toCellKey))
  const sites = investigation
    .filter((site) => isCellInsideGrid(site, grid))
    .map((site) => ({ cellX: site.cellX, cellY: site.cellY, completed: occupied.has(toCellKey(site)) }))

  return {
    sites,
    completed: sites.filter((site) => site.completed).length,
    total: sites.length,
  }
}
