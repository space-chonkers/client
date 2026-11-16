import { describe, expect, test } from 'bun:test'
import { CorridorGrid, type OccupiedTile } from '../../src/game/corridor/CorridorGrid'
import { INITIAL_BASE_ORIGIN, INITIAL_SERVER_CONSTRUCTIONS } from '../../src/game/corridor/mockServerPayload'

function byPosition(a: OccupiedTile, b: OccupiedTile): number {
  return a.gridZ - b.gridZ || a.gridX - b.gridX
}

/** A grid with the initial 3×3 base loaded and a counter of occupancy notifications. */
function createInitialBase() {
  const grid = new CorridorGrid()
  grid.loadConstructions(INITIAL_SERVER_CONSTRUCTIONS, INITIAL_BASE_ORIGIN)
  const counter = { changes: 0 }
  grid.onOccupancyChange(() => counter.changes++)
  return { grid, counter }
}

describe('CorridorGrid occupancy snapshot', () => {
  test('the initial base is 3×3 around the Stash at the local origin', () => {
    const { grid } = createInitialBase()
    const tiles = grid.getOccupiedTiles().sort(byPosition)

    expect(tiles).toHaveLength(9)
    for (const tile of tiles) {
      expect(Math.abs(tile.gridX)).toBeLessThanOrEqual(1)
      expect(Math.abs(tile.gridZ)).toBeLessThanOrEqual(1)
    }
    expect(tiles.filter((tile) => tile.kind === 'stash')).toEqual([{ gridX: 0, gridZ: 0, kind: 'stash' }])
    grid.dispose()
  })

  test('the snapshot is a copy that later changes do not mutate', () => {
    const { grid } = createInitialBase()
    const snapshot = grid.getOccupiedTiles()
    grid.placeTile(0, -2)
    expect(snapshot).toHaveLength(9)
    expect(grid.getOccupiedTiles()).toHaveLength(10)
    grid.dispose()
  })

  test('loading constructions notifies listeners once', () => {
    const grid = new CorridorGrid()
    let changes = 0
    grid.onOccupancyChange(() => changes++)
    grid.loadConstructions(INITIAL_SERVER_CONSTRUCTIONS, INITIAL_BASE_ORIGIN)
    expect(changes).toBe(1)

    // Reloading the same cells adds nothing, so nothing is published.
    grid.loadConstructions(INITIAL_SERVER_CONSTRUCTIONS, INITIAL_BASE_ORIGIN)
    expect(changes).toBe(1)
    grid.dispose()
  })
})

describe('CorridorGrid occupancy notifications', () => {
  test('a successful placement adds the tile and notifies once', () => {
    const { grid, counter } = createInitialBase()
    expect(grid.placeTile(0, -2)).toBe(true)
    expect(counter.changes).toBe(1)
    expect(grid.getOccupiedTiles()).toContainEqual({ gridX: 0, gridZ: -2, kind: 'base_tile' })
    grid.dispose()
  })

  test('a duplicate placement is rejected without notifying', () => {
    const { grid, counter } = createInitialBase()
    expect(grid.placeTile(1, 1)).toBe(false)
    expect(grid.placeTile(0, 0)).toBe(false)
    expect(counter.changes).toBe(0)
    expect(grid.getOccupiedTiles()).toHaveLength(9)
    grid.dispose()
  })

  test('removing a tile notifies and drops it from the snapshot', () => {
    const { grid, counter } = createInitialBase()
    grid.placeTile(0, -2)
    expect(grid.removeTile(0, -2)).toBe(true)
    expect(counter.changes).toBe(2)
    expect(grid.hasTile(0, -2)).toBe(false)
    expect(grid.getOccupiedTiles()).toHaveLength(9)
    grid.dispose()
  })

  test('rejected removals (empty cell or protected Stash) do not notify', () => {
    const { grid, counter } = createInitialBase()
    expect(grid.removeTile(5, 5)).toBe(false)
    expect(grid.removeTile(0, 0)).toBe(false)
    expect(counter.changes).toBe(0)
    grid.dispose()
  })

  test('unsubscribing and disposing stop notifications', () => {
    const grid = new CorridorGrid()
    let unsubscribed = 0
    let disposed = 0
    const unsubscribe = grid.onOccupancyChange(() => unsubscribed++)
    grid.onOccupancyChange(() => disposed++)

    unsubscribe()
    grid.placeTile(0, 0)
    expect(unsubscribed).toBe(0)
    expect(disposed).toBe(1)

    grid.dispose()
    grid.placeTile(0, 0)
    expect(disposed).toBe(1)
  })
})
