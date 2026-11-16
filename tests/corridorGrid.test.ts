import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { CorridorGrid } from '../src/game/corridor/CorridorGrid'

describe('CorridorGrid', () => {
  test('loadConstructions refreshes neighbors so straight aisles open both ways', () => {
    const grid = new CorridorGrid()
    grid.loadConstructions([
      { id: 'b0', kind: 'base_tile', cellX: 0, cellY: 0 },
      { id: 'b1', kind: 'base_tile', cellX: 0, cellY: -1 },
    ])
    // Initially (0,-1) only opens south toward (0,0), so north edge (-1.2) is closed.
    expect(grid.isWalkable(0, -1.2)).toBe(false)

    // Adding (0,-2) via loadConstructions must refresh neighbor (0,-1) into an aisle.
    grid.loadConstructions([
      { id: 'b0', kind: 'base_tile', cellX: 0, cellY: 0 },
      { id: 'b1', kind: 'base_tile', cellX: 0, cellY: -1 },
      { id: 'b2', kind: 'base_tile', cellX: 0, cellY: -2 },
    ])
    expect(grid.isWalkable(0, -1.2)).toBe(true)
    expect(grid.isWalkable(0, -1.5)).toBe(true)
    grid.dispose()
  })

  test('replaceConstructions removes stale mock tiles and applies the server origin', () => {
    const grid = new CorridorGrid()
    grid.loadConstructions([
      { id: 'mock-stash', kind: 'stash', cellX: 29, cellY: 25 },
      { id: 'mock-tile', kind: 'base_tile', cellX: 30, cellY: 25 },
    ], { cellX: 29, cellY: 25 })

    grid.replaceConstructions([
      { id: 'server-stash', kind: 'stash', cellX: 10, cellY: 10 },
      { id: 'server-tile', kind: 'base_tile', cellX: 10, cellY: 9 },
    ], { cellX: 10, cellY: 10 })

    expect(grid.hasTile(1, 0)).toBe(false)
    expect(grid.getTileKind(0, 0)).toBe('stash')
    expect(grid.getTileKind(0, -1)).toBe('base_tile')
    grid.dispose()
  })

  test('constrainMovement lets a player walk out if placed inside the stash box', () => {
    const grid = new CorridorGrid()
    grid.loadConstructions([
      { id: 's', kind: 'stash', cellX: 0, cellY: 0 },
      { id: 'n', kind: 'base_tile', cellX: 0, cellY: -1 },
    ])
    const prev = new THREE.Vector3(0, 0.08, 0)
    const target = new THREE.Vector3(0, 0.08, -0.2)
    grid.constrainMovement(prev, target, 0.016)
    expect(target.z).toBeLessThan(0)
    grid.dispose()
  })
})
