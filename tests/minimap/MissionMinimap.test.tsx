import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { INITIAL_SERVER_PAYLOAD } from '../../src/game/corridor/mockServerPayload'
import type { MissionMapConstruction, MissionMapPlayer } from '../../src/game/minimap/missionMap'
import { MissionMinimap, type MissionMinimapProps } from '../../src/ui/MissionMinimap'

const initialBase: MissionMapConstruction[] = INITIAL_SERVER_PAYLOAD.constructions.map(({ kind, cellX, cellY }) => ({
  kind,
  cellX,
  cellY,
}))

function render(overrides: Partial<MissionMinimapProps> = {}): string {
  return renderToStaticMarkup(
    <MissionMinimap
      grid={INITIAL_SERVER_PAYLOAD.grid}
      constructions={initialBase}
      investigation={INITIAL_SERVER_PAYLOAD.investigation}
      player={null}
      {...overrides}
    />,
  )
}

function count(markup: string, className: string): number {
  return markup.split(`class="${className}"`).length - 1
}

describe('MissionMinimap', () => {
  test('draws the full 50×50 world with a north-up map', () => {
    const markup = render()
    expect(markup).toContain('viewBox="-1.2 -1.2 52.4 52.4"')
    expect(markup).toContain('class="mission-minimap__world-border" x="0" y="0" width="50" height="50"')
    expect(markup).toContain('North is up')
  })

  test('renders the initial 3×3 base with the Stash badge on cell (29, 25)', () => {
    const markup = render()
    expect(count(markup, 'mission-minimap__base-cell')).toBe(9)
    expect(markup).toContain('x="28.08" y="24.08"') // north-west base cell
    expect(markup).toContain('class="mission-minimap__stash" transform="translate(29.5 25.5)"')
  })

  test('shows newly constructed cells and drops removed ones', () => {
    const expanded = render({ constructions: [...initialBase, { kind: 'base_tile', cellX: 29, cellY: 23 }] })
    expect(count(expanded, 'mission-minimap__base-cell')).toBe(10)
    expect(expanded).toContain('x="29.08" y="23.08"')

    const shrunk = render({ constructions: initialBase.filter((cell) => !(cell.cellX === 30 && cell.cellY === 26)) })
    expect(count(shrunk, 'mission-minimap__base-cell')).toBe(8)
    expect(shrunk).not.toContain('x="30.08" y="26.08"')
  })

  test('skips constructions outside the world', () => {
    const markup = render({ constructions: [{ kind: 'base_tile', cellX: 50, cellY: 0 }] })
    expect(count(markup, 'mission-minimap__base-cell')).toBe(0)
  })

  test('marks pending and completed investigation sites and counts progress', () => {
    const pending = render()
    expect(count(pending, 'mission-minimap__site mission-minimap__site--pending')).toBe(10)
    expect(pending).toContain('mission-minimap__progress-count">0 / 10<')

    const completedSite = INITIAL_SERVER_PAYLOAD.investigation[1]
    const markup = render({ constructions: [...initialBase, { kind: 'base_tile', ...completedSite }] })
    expect(count(markup, 'mission-minimap__site mission-minimap__site--pending')).toBe(9)
    expect(count(markup, 'mission-minimap__site mission-minimap__site--completed')).toBe(1)
    expect(markup).toContain('class="mission-minimap__site-check"')
    expect(markup).toContain('mission-minimap__progress-count">1 / 10<')
    expect(markup).toContain('aria-valuenow="1"')
    expect(markup).toContain('style="width:10%"')
  })

  test('places the player at its continuous position, rotated to its facing', () => {
    const player: MissionMapPlayer = { cellX: 29.25, cellY: 23.5, facing: 'right' }
    const markup = render({ player })
    expect(markup).toContain('transform:translate(29.75px, 24px)')
    expect(markup).toContain('transform="rotate(90)"')
  })

  test('keeps the player marker inside the map', () => {
    const markup = render({ player: { cellX: 60, cellY: -4, facing: 'up' } })
    expect(markup).toContain('transform:translate(50px, 0px)')
  })

  test('renders an empty map without player, base or sites', () => {
    const markup = render({ constructions: [], investigation: [], player: null })
    expect(count(markup, 'mission-minimap__base-cell')).toBe(0)
    expect(markup).not.toContain('mission-minimap__player')
    expect(markup).not.toContain('mission-minimap__site ')
    expect(markup).toContain('mission-minimap__progress-count">0 / 0<')
    expect(markup).toContain('style="width:0%"')
  })
})
