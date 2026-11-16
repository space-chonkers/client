import { memo, useId, useMemo, useSyncExternalStore, type CSSProperties } from 'react'
import type { ServerGridDimensions, ServerInvestigationCell } from '../game/corridor/mockServerPayload'
import {
  clampMinimapPoint,
  facingToMinimapRotation,
  isCellInsideGrid,
  resolveInvestigationProgress,
  worldCellToMinimapPoint,
  type InvestigationSiteStatus,
  type MissionMapConstruction,
} from '../game/minimap/missionMap'
import type { MissionMapPlayerSource } from '../game/minimap/PlayerSnapshotStore'
import './missionMinimap.css'

export interface MissionMinimapProps {
  /** World size in cells (the authoritative map is 50x50). */
  grid: ServerGridDimensions
  /** Constructed cells in world coordinates. */
  constructions: ReadonlyArray<MissionMapConstruction>
  /** Investigation sites in world coordinates. */
  investigation: ReadonlyArray<ServerInvestigationCell>
  /**
   * Live local player. Read through a subscription so position updates only
   * re-render the marker. Omitted (or a null snapshot) hides the marker.
   */
  player?: MissionMapPlayerSource
}

/** Space, in cells, kept around the world edge so edge markers are not clipped. */
const MAP_MARGIN = 1.2
/** Cells between the stronger "sector" grid lines. */
const SECTOR_SIZE = 10
/** Gap left on each side of a base cell so adjacent tiles read as separate modules. */
const BASE_CELL_INSET = 0.08

/**
 * Decorative craters, as fractions of the map size. Purely stylized: they are
 * not measured terrain and do not match the 3D scene.
 */
const DECORATIVE_CRATERS: ReadonlyArray<{ x: number; y: number; radius: number }> = [
  { x: 0.17, y: 0.2, radius: 0.07 },
  { x: 0.7, y: 0.14, radius: 0.045 },
  { x: 0.86, y: 0.62, radius: 0.085 },
  { x: 0.3, y: 0.76, radius: 0.06 },
  { x: 0.56, y: 0.86, radius: 0.035 },
  { x: 0.1, y: 0.52, radius: 0.04 },
  { x: 0.46, y: 0.32, radius: 0.03 },
]

/** One path with every grid line `step` cells apart inside the world rectangle. */
function buildGridLinesPath(grid: ServerGridDimensions, step: number): string {
  const segments: string[] = []
  for (let x = step; x < grid.width; x += step) segments.push(`M${x} 0V${grid.height}`)
  for (let y = step; y < grid.height; y += step) segments.push(`M0 ${y}H${grid.width}`)
  return segments.join('')
}

/** Ground, craters, grid and world border. Only re-renders when the grid size changes. */
const MinimapTerrain = memo(function MinimapTerrain({
  grid,
  groundGradientId,
}: {
  grid: ServerGridDimensions
  groundGradientId: string
}) {
  const mapSize = Math.min(grid.width, grid.height)

  return (
    <g className="mission-minimap__terrain">
      <rect
        x={-MAP_MARGIN}
        y={-MAP_MARGIN}
        width={grid.width + MAP_MARGIN * 2}
        height={grid.height + MAP_MARGIN * 2}
        fill={`url(#${groundGradientId})`}
      />
      {DECORATIVE_CRATERS.map(({ x, y, radius }) => (
        <g key={`${x},${y}`} className="mission-minimap__crater">
          <circle cx={x * grid.width} cy={y * grid.height} r={radius * mapSize} />
          <circle
            className="mission-minimap__crater-floor"
            cx={x * grid.width + radius * mapSize * 0.15}
            cy={y * grid.height + radius * mapSize * 0.15}
            r={radius * mapSize * 0.72}
          />
        </g>
      ))}
      <path className="mission-minimap__grid-line" d={buildGridLinesPath(grid, 1)} />
      <path className="mission-minimap__sector-line" d={buildGridLinesPath(grid, SECTOR_SIZE)} />
      <rect className="mission-minimap__world-border" x={0} y={0} width={grid.width} height={grid.height} />
    </g>
  )
})

/** Constructed base cells, with the Stash drawn as a larger badge on top. */
const MinimapBase = memo(function MinimapBase({
  cells,
}: {
  /** Constructions already filtered to the grid. */
  cells: ReadonlyArray<MissionMapConstruction>
}) {
  const stashes = cells.filter((cell) => cell.kind === 'stash')

  return (
    <g className="mission-minimap__base">
      {cells.map((cell) => (
        <rect
          key={`${cell.cellX},${cell.cellY}`}
          className="mission-minimap__base-cell"
          x={cell.cellX + BASE_CELL_INSET}
          y={cell.cellY + BASE_CELL_INSET}
          width={1 - BASE_CELL_INSET * 2}
          height={1 - BASE_CELL_INSET * 2}
          rx={0.15}
        />
      ))}
      {stashes.map((cell) => {
        const { x, y } = worldCellToMinimapPoint(cell)
        return (
          <g
            key={`stash-${cell.cellX},${cell.cellY}`}
            className="mission-minimap__stash"
            transform={`translate(${x} ${y})`}
          >
            <rect x={-0.6} y={-0.6} width={1.2} height={1.2} rx={0.25} />
            <circle className="mission-minimap__stash-light" r={0.25} />
          </g>
        )
      })}
    </g>
  )
})

/** Pending sites are golden diamonds; completed sites are cream discs with a checkmark. */
const MinimapSites = memo(function MinimapSites({
  sites,
}: {
  sites: ReadonlyArray<InvestigationSiteStatus>
}) {
  return (
    <g className="mission-minimap__sites">
      {sites.map((site) => {
        const { x, y } = worldCellToMinimapPoint(site)
        return (
          <g
            key={`${site.cellX},${site.cellY}`}
            className={`mission-minimap__site mission-minimap__site--${site.completed ? 'completed' : 'pending'}`}
            transform={`translate(${x} ${y})`}
          >
            {site.completed ? (
              <>
                <circle r={0.95} />
                <path className="mission-minimap__site-check" d="M-0.45 0.02L-0.1 0.38L0.48 -0.36" />
              </>
            ) : (
              <>
                <path d="M0 -1.1L1.1 0L0 1.1L-1.1 0Z" />
                <circle className="mission-minimap__site-core" r={0.28} />
              </>
            )}
          </g>
        )
      })}
    </g>
  )
})

/** The only part of the minimap subscribed to player updates. */
function MinimapPlayer({ grid, source }: { grid: ServerGridDimensions; source: MissionMapPlayerSource }) {
  const player = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  if (!player) return null

  const { x, y } = clampMinimapPoint(worldCellToMinimapPoint(player), grid)
  // Translation goes through CSS (eased between the ~10 Hz updates); rotation snaps
  // to the facing, avoiding the long way round between 270° and 0°.
  const positionStyle: CSSProperties = { transform: `translate(${x}px, ${y}px)` }

  return (
    <g className="mission-minimap__player" style={positionStyle}>
      <path
        className="mission-minimap__player-arrow"
        d="M0 -1.4L1.05 1L0 0.45L-1.05 1Z"
        transform={`rotate(${facingToMinimapRotation(player.facing)})`}
      />
    </g>
  )
}

/**
 * Top-right mission HUD map of the full world: stylized Martian ground, a
 * 50x50 grid, the constructed base and Stash, investigation sites and the
 * player's position and facing. Presentation only: it renders the data it is
 * given and never changes game state.
 */
export function MissionMinimap({ grid, constructions, investigation, player }: MissionMinimapProps) {
  const groundGradientId = `mission-minimap-ground-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const progress = useMemo(
    () => resolveInvestigationProgress(investigation, constructions, grid),
    [investigation, constructions, grid],
  )
  const baseCells = useMemo(
    () => constructions.filter((cell) => isCellInsideGrid(cell, grid)),
    [constructions, grid],
  )
  const progressPercent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
  const mapLabel =
    `Mission map: base of ${baseCells.length} cells, ` +
    `${progress.completed} of ${progress.total} investigation sites completed`

  return (
    <section className="mission-minimap" aria-label="Mission map">
      <header className="mission-minimap__header">
        <h2 className="mission-minimap__title">Mission map</h2>
        <span className="mission-minimap__north" title="North is up">
          N
          <svg viewBox="0 0 10 12" aria-hidden="true">
            <path d="M5 0L10 7H6.5V12H3.5V7H0Z" />
          </svg>
        </span>
      </header>

      <svg
        className="mission-minimap__map"
        viewBox={`${-MAP_MARGIN} ${-MAP_MARGIN} ${grid.width + MAP_MARGIN * 2} ${grid.height + MAP_MARGIN * 2}`}
        role="img"
        aria-label={mapLabel}
      >
        <defs>
          <radialGradient id={groundGradientId} cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#d4774a" />
            <stop offset="55%" stopColor="#b55a34" />
            <stop offset="100%" stopColor="#7a3220" />
          </radialGradient>
        </defs>
        <MinimapTerrain grid={grid} groundGradientId={groundGradientId} />
        <MinimapBase cells={baseCells} />
        <MinimapSites sites={progress.sites} />
        {player && <MinimapPlayer grid={grid} source={player} />}
      </svg>

      <footer className="mission-minimap__footer">
        <span className="mission-minimap__progress-label">Sites</span>
        <span className="mission-minimap__progress-count">
          {progress.completed} / {progress.total}
        </span>
        <div
          className="mission-minimap__progress-track"
          role="progressbar"
          aria-label="Investigation sites completed"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${progress.completed} of ${progress.total} sites completed`}
        >
          <div className="mission-minimap__progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </footer>
    </section>
  )
}

export default MissionMinimap
