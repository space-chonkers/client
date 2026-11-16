import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CorridorGrid } from '../../src/game/corridor/CorridorGrid'
import {
  INITIAL_BASE_ORIGIN,
  INITIAL_SERVER_CONSTRUCTIONS,
  INITIAL_SERVER_PAYLOAD,
} from '../../src/game/corridor/mockServerPayload'
import {
  occupiedTilesToConstructions,
  resolveInvestigationProgress,
  type MissionMapConstruction,
} from '../../src/game/minimap/missionMap'
import { MissionMinimap } from '../../src/ui/MissionMinimap'

/**
 * Wires a real `CorridorGrid` to a snapshot exactly like `PlayerSandbox` does
 * (subscribe, load the initial base, convert occupancy with the shared helper),
 * so these tests cover the construction → minimap path end to end.
 */
function createSyncedGrid() {
  const grid = new CorridorGrid()
  const published: MissionMapConstruction[][] = []
  grid.onOccupancyChange(() =>
    published.push(occupiedTilesToConstructions(grid.getOccupiedTiles(), INITIAL_BASE_ORIGIN)),
  )
  grid.loadConstructions(INITIAL_SERVER_CONSTRUCTIONS, INITIAL_BASE_ORIGIN)
  const latest = () => published[published.length - 1] ?? []
  return { grid, published, latest }
}

/** Local sandbox tile for a world cell (inverse of the sandbox origin offset). */
function toLocalTile(cell: { cellX: number; cellY: number }) {
  return { x: cell.cellX - INITIAL_BASE_ORIGIN.cellX, z: cell.cellY - INITIAL_BASE_ORIGIN.cellY }
}

function progressOf(constructions: ReadonlyArray<MissionMapConstruction>) {
  return resolveInvestigationProgress(INITIAL_SERVER_PAYLOAD.investigation, constructions, INITIAL_SERVER_PAYLOAD.grid)
}

function renderMinimap(constructions: ReadonlyArray<MissionMapConstruction>): string {
  return renderToStaticMarkup(
    <MissionMinimap
      grid={INITIAL_SERVER_PAYLOAD.grid}
      constructions={constructions}
      investigation={INITIAL_SERVER_PAYLOAD.investigation}
      player={null}
    />,
  )
}

describe('CorridorGrid → minimap synchronization', () => {
  test('publishes the authoritative 3×3 base at its world cells', () => {
    const { grid, published, latest } = createSyncedGrid()
    expect(published).toHaveLength(1)
    const sortCells = (cells: ReadonlyArray<MissionMapConstruction>) =>
      [...cells].sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX)
    const expected = INITIAL_SERVER_CONSTRUCTIONS.map(({ kind, cellX, cellY }) => ({ kind, cellX, cellY }))
    expect(sortCells(latest())).toEqual(sortCells(expected))
    grid.dispose()
  })

  test('a construction covering an investigation cell completes that objective', () => {
    const { grid, latest } = createSyncedGrid()
    const site = INITIAL_SERVER_PAYLOAD.investigation[1] // (49, 24)
    expect(progressOf(latest()).completed).toBe(0)

    const local = toLocalTile(site)
    expect(grid.placeTile(local.x, local.z)).toBe(true)

    expect(latest()).toContainEqual({ kind: 'base_tile', cellX: site.cellX, cellY: site.cellY })
    const progress = progressOf(latest())
    expect(progress).toMatchObject({ completed: 1, total: 10 })
    expect(progress.sites.find((s) => s.cellX === site.cellX && s.cellY === site.cellY)?.completed).toBe(true)

    const markup = renderMinimap(latest())
    expect(markup).toContain('mission-minimap__progress-count">1 / 10<')
    expect(markup).toContain(
      `class="mission-minimap__site mission-minimap__site--completed" transform="translate(${site.cellX + 0.5} ${site.cellY + 0.5})"`,
    )
    grid.dispose()
  })

  test('a construction next to an investigation cell does not complete it', () => {
    const { grid, latest } = createSyncedGrid()
    const local = toLocalTile({ cellX: 48, cellY: 24 })
    grid.placeTile(local.x, local.z)
    expect(progressOf(latest()).completed).toBe(0)
    grid.dispose()
  })

  test('a duplicate placement publishes nothing and leaves the minimap unchanged', () => {
    const { grid, published } = createSyncedGrid()
    expect(grid.placeTile(0, -1)).toBe(false) // existing base tile (29, 24)
    expect(published).toHaveLength(1)
    grid.dispose()
  })

  test('removing the covering tile reverts the objective to pending', () => {
    const { grid, published, latest } = createSyncedGrid()
    const local = toLocalTile(INITIAL_SERVER_PAYLOAD.investigation[1])
    grid.placeTile(local.x, local.z)
    expect(grid.removeTile(local.x, local.z)).toBe(true)

    expect(published).toHaveLength(3)
    expect(latest()).toHaveLength(9)
    expect(progressOf(latest()).completed).toBe(0)
    expect(renderMinimap(latest())).not.toContain('mission-minimap__site--completed')
    grid.dispose()
  })

  test('nothing is published after dispose', () => {
    const { grid, published } = createSyncedGrid()
    grid.dispose()
    grid.placeTile(0, -2)
    expect(published).toHaveLength(1)
  })
})
