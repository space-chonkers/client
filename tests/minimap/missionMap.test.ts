import { describe, expect, test } from 'bun:test'
import { INITIAL_BASE_ORIGIN, INITIAL_SERVER_PAYLOAD } from '../../src/game/corridor/mockServerPayload'
import {
  clampMinimapPoint,
  facingToMinimapRotation,
  isCellInsideGrid,
  occupiedTilesToConstructions,
  resolveInvestigationProgress,
  sandboxToWorldCell,
  worldCellToMinimapPoint,
  type MissionMapConstruction,
} from '../../src/game/minimap/missionMap'

const grid = INITIAL_SERVER_PAYLOAD.grid

describe('sandbox → world cells', () => {
  test('the sandbox origin is the Stash cell (29, 25)', () => {
    expect(sandboxToWorldCell(0, 0, INITIAL_BASE_ORIGIN)).toEqual({ cellX: 29, cellY: 25 })
  })

  test('local -Z is north (smaller cellY) and +X is east (larger cellX)', () => {
    expect(sandboxToWorldCell(1, -1, INITIAL_BASE_ORIGIN)).toEqual({ cellX: 30, cellY: 24 })
  })

  test('keeps continuous player positions instead of snapping to cells', () => {
    const world = sandboxToWorldCell(0.37, -1.25, INITIAL_BASE_ORIGIN)
    expect(world.cellX).toBeCloseTo(29.37, 10)
    expect(world.cellY).toBeCloseTo(23.75, 10)
  })
})

describe('CorridorGrid occupancy → world constructions', () => {
  test('offsets local tiles by the origin and keeps their kind', () => {
    const tiles = [
      { gridX: 0, gridZ: 0, kind: 'stash' },
      { gridX: -1, gridZ: 2, kind: 'base_tile' },
    ] as const
    expect(occupiedTilesToConstructions(tiles, INITIAL_BASE_ORIGIN)).toEqual([
      { kind: 'stash', cellX: 29, cellY: 25 },
      { kind: 'base_tile', cellX: 28, cellY: 27 },
    ])
  })

  test('returns an empty list for an empty grid', () => {
    expect(occupiedTilesToConstructions([], INITIAL_BASE_ORIGIN)).toEqual([])
  })
})

describe('world → minimap points', () => {
  test('integer cells map to their centre', () => {
    expect(worldCellToMinimapPoint({ cellX: 0, cellY: 0 })).toEqual({ x: 0.5, y: 0.5 })
    expect(worldCellToMinimapPoint({ cellX: 49, cellY: 49 })).toEqual({ x: 49.5, y: 49.5 })
  })

  test('the player spawn matches the server spawn slot 0 position (29.5, 24.5)', () => {
    const spawn = INITIAL_SERVER_PAYLOAD.spawns[0]
    const local = { x: 0, z: -1 } // PlayerSandbox spawn
    const point = worldCellToMinimapPoint(sandboxToWorldCell(local.x, local.z, INITIAL_BASE_ORIGIN))
    expect(point).toEqual({ x: spawn.x, y: spawn.y })
  })

  test('clamps points to the map rectangle', () => {
    expect(clampMinimapPoint({ x: -3, y: 60 }, grid)).toEqual({ x: 0, y: 50 })
    expect(clampMinimapPoint({ x: 12.5, y: 7.25 }, grid)).toEqual({ x: 12.5, y: 7.25 })
  })
})

describe('grid boundaries', () => {
  test('accepts the corners of the 50×50 world', () => {
    expect(isCellInsideGrid({ cellX: 0, cellY: 0 }, grid)).toBe(true)
    expect(isCellInsideGrid({ cellX: 49, cellY: 49 }, grid)).toBe(true)
  })

  test('rejects cells outside the world or with fractional coordinates', () => {
    expect(isCellInsideGrid({ cellX: -1, cellY: 0 }, grid)).toBe(false)
    expect(isCellInsideGrid({ cellX: 50, cellY: 10 }, grid)).toBe(false)
    expect(isCellInsideGrid({ cellX: 10, cellY: 50 }, grid)).toBe(false)
    expect(isCellInsideGrid({ cellX: 10.5, cellY: 10 }, grid)).toBe(false)
  })
})

describe('player marker rotation', () => {
  test('is north-up and clockwise', () => {
    expect(facingToMinimapRotation('up')).toBe(0)
    expect(facingToMinimapRotation('right')).toBe(90)
    expect(facingToMinimapRotation('down')).toBe(180)
    expect(facingToMinimapRotation('left')).toBe(270)
  })
})

describe('investigation progress', () => {
  const initialBase: MissionMapConstruction[] = INITIAL_SERVER_PAYLOAD.constructions.map(({ kind, cellX, cellY }) => ({
    kind,
    cellX,
    cellY,
  }))

  test('starts with every payload site pending', () => {
    const progress = resolveInvestigationProgress(INITIAL_SERVER_PAYLOAD.investigation, initialBase, grid)
    expect(progress.total).toBe(10)
    expect(progress.completed).toBe(0)
    expect(progress.sites.every((site) => !site.completed)).toBe(true)
  })

  test('a site is completed once a construction covers its cell', () => {
    const constructions = [...initialBase, { kind: 'base_tile', cellX: 49, cellY: 24 } as const]
    const progress = resolveInvestigationProgress(INITIAL_SERVER_PAYLOAD.investigation, constructions, grid)
    expect(progress.completed).toBe(1)
    expect(progress.sites.find((site) => site.cellX === 49 && site.cellY === 24)?.completed).toBe(true)
  })

  test('a construction next to a site does not complete it', () => {
    const constructions = [{ kind: 'base_tile', cellX: 48, cellY: 24 } as const]
    expect(resolveInvestigationProgress(INITIAL_SERVER_PAYLOAD.investigation, constructions, grid).completed).toBe(0)
  })

  test('counts every covered site', () => {
    const constructions = INITIAL_SERVER_PAYLOAD.investigation
      .slice(0, 4)
      .map(({ cellX, cellY }) => ({ kind: 'base_tile', cellX, cellY }) as const)
    const progress = resolveInvestigationProgress(INITIAL_SERVER_PAYLOAD.investigation, constructions, grid)
    expect(progress).toMatchObject({ completed: 4, total: 10 })
  })

  test('handles empty data', () => {
    expect(resolveInvestigationProgress([], [], grid)).toEqual({ sites: [], completed: 0, total: 0 })
    expect(resolveInvestigationProgress(INITIAL_SERVER_PAYLOAD.investigation, [], grid).completed).toBe(0)
  })

  test('ignores sites outside the grid', () => {
    const investigation = [
      { cellX: 3, cellY: 3 },
      { cellX: 50, cellY: 3 },
      { cellX: -1, cellY: 3 },
    ]
    const progress = resolveInvestigationProgress(investigation, [], grid)
    expect(progress.total).toBe(1)
    expect(progress.sites).toEqual([{ cellX: 3, cellY: 3, completed: false }])
  })
})
