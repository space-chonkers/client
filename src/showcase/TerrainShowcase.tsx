import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MarsTerrainRequestError, fetchMarsTerrain } from '../terrain-kit/marsTerrainApi'
import { MarsTerrainDataError, createReliefMapFromMarsTerrain } from '../terrain-kit/marsTerrainContract'
import type { ReliefMap, TerrainCell } from '../terrain-kit/reliefMap'
import { ShowcaseStage } from './ShowcaseStage'
import ReliefMinimap from './ReliefMinimap'
import type { CameraPreset, RenderMode, StageStats, TerrainSource, ViewMode } from './types'
import './showcase.css'

const DEFAULT_SEED = 42
const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'terrain', label: 'Layer −1' },
  { id: 'assets', label: 'Assets' },
]
const SOURCES: { id: TerrainSource; label: string }[] = [
  { id: 'procedural', label: 'Procedural' },
  { id: 'mars', label: 'Real Mars' },
]
const RENDER_MODES: { id: RenderMode; label: string }[] = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'relief', label: 'Relief' },
  { id: 'data', label: 'Data' },
]
const PRESETS: { id: CameraPreset; label: string }[] = [
  { id: 'iso', label: 'Iso' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'low', label: 'Low' },
]

/** Shown with backend failures: in development the Vite proxy forwards the terrain route to the local Go server. */
const BACKEND_HINT = 'Is the Go server running on localhost:8080?'
/** HTTP statuses from this one up mean the backend (or the dev proxy in front of it) is unavailable. */
const FIRST_SERVER_ERROR_STATUS = 500

/** Real Mars fetch progress; `null` once a map is shown or when the source is procedural. */
type MarsTerrainStatus = { kind: 'loading' } | { kind: 'error'; message: string } | null

const signed = (value: number) => (value > 0 ? '+' : '') + value.toFixed(2)
const formatLatitude = (degrees: number) => `${Math.abs(degrees).toFixed(4)}° ${degrees >= 0 ? 'N' : 'S'}`
const formatLongitudeEast = (degrees: number) => `${degrees.toFixed(4)}° E`
const formatNumber = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 })
const formatMeters = (meters: number) => `${formatNumber(meters)} m`

function describeMarsTerrainError(error: unknown): string {
  if (error instanceof MarsTerrainRequestError) {
    if (error.status === null) return `Cannot reach the Mars terrain service. ${BACKEND_HINT}`
    if (error.status >= FIRST_SERVER_ERROR_STATUS) return `Mars terrain service unavailable (HTTP ${error.status}). ${BACKEND_HINT}`
    return `Mars terrain request rejected (HTTP ${error.status}).`
  }
  if (error instanceof MarsTerrainDataError) return `The backend sent invalid terrain: ${error.issues.join('; ')}`
  return `Could not build the Mars terrain${error instanceof Error ? `: ${error.message}` : ''}`
}

/**
 * Development tool for the Layer −1 terrain kit (open with `?view=terrain-showcase`
 * under `bun run dev`). Never shipped: `main.tsx` only loads it in dev builds.
 */
export default function TerrainShowcase() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<ShowcaseStage | null>(null)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [seedDraft, setSeedDraft] = useState(String(DEFAULT_SEED))
  const [view, setView] = useState<ViewMode>('terrain')
  const [source, setSource] = useState<TerrainSource>('procedural')
  const [marsStatus, setMarsStatus] = useState<MarsTerrainStatus>(null)
  /** Bumped by the Retry button to refetch the same seed. */
  const [marsAttempt, setMarsAttempt] = useState(0)
  const [mode, setMode] = useState<RenderMode>('terrain')
  const [showGrid, setShowGrid] = useState(false)
  const [showValues, setShowValues] = useState(false)
  const [reliefMap, setReliefMap] = useState<ReliefMap | null>(null)
  const [hovered, setHovered] = useState<TerrainCell | null>(null)
  const [stats, setStats] = useState<StageStats | null>(null)

  useEffect(() => {
    const stage = new ShowcaseStage(containerRef.current!)
    stageRef.current = stage
    const poll = window.setInterval(() => setStats(stage.getStats()), 1000)
    return () => {
      window.clearInterval(poll)
      stage.dispose()
      stageRef.current = null
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    setHovered(null)
    if (view !== 'terrain' || source === 'procedural') {
      setMarsStatus(null)
      setReliefMap(stage.load(view, seed))
      return
    }

    // Real Mars: clear the stage first, so a previous map is never shown as this seed's terrain.
    const controller = new AbortController()
    stage.clear()
    setReliefMap(null)
    setStats(stage.getStats())
    setMarsStatus({ kind: 'loading' })
    fetchMarsTerrain(seed, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return
        // Default options: real terrain stays unclassified and undressed.
        setReliefMap(stage.loadMap(createReliefMapFromMarsTerrain(data)))
        setMarsStatus(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error(`Failed to load Mars terrain for seed ${seed}`, error)
        setMarsStatus({ kind: 'error', message: describeMarsTerrainError(error) })
      })
    return () => controller.abort()
  }, [view, seed, source, marsAttempt])

  useEffect(() => {
    stageRef.current?.setDebug({ mode, grid: showGrid, values: showValues })
  }, [mode, showGrid, showValues])

  const inspect = (cell: TerrainCell | null) => {
    setHovered(cell)
    stageRef.current?.highlightCell(cell)
  }

  const applySeed = (value: number) => {
    const next = Math.abs(Math.trunc(value)) % 4294967296
    setSeed(next)
    setSeedDraft(String(next))
  }

  const submitSeed = (event: FormEvent) => {
    event.preventDefault()
    const parsed = Number(seedDraft)
    if (Number.isFinite(parsed)) applySeed(parsed)
    else setSeedDraft(String(seed))
  }

  const terrainView = view === 'terrain'
  const realElevation = reliefMap?.elevation
  const elevationRange = useMemo(() => {
    if (!realElevation) return null
    const { samplesMeters } = realElevation
    return { min: Math.min(...samplesMeters), max: Math.max(...samplesMeters) }
  }, [realElevation])

  return (
    <div className="showcase">
      <div ref={containerRef} className="showcase-canvas" aria-label="Martian terrain showcase" />
      <aside className="showcase-panel">
        <header>
          <h1>Space Chonkers</h1>
          <p>{terrainView && source === 'mars' ? 'Layer −1 · measured HiRISE elevation' : 'Layer −1 · procedural geological substrate'}</p>
        </header>

        <div className="showcase-row" role="group" aria-label="View">
          {VIEWS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>

        <div className="showcase-row" role="group" aria-label="Terrain source">
          {SOURCES.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={source === id} disabled={!terrainView} onClick={() => setSource(id)}>
              {label}
            </button>
          ))}
        </div>

        <form className="showcase-row" onSubmit={submitSeed}>
          <label htmlFor="showcase-seed">Seed</label>
          <input
            id="showcase-seed"
            inputMode="numeric"
            value={seedDraft}
            onChange={(event) => setSeedDraft(event.target.value)}
          />
          <button type="submit">Apply</button>
          <button type="button" onClick={() => applySeed(Math.random() * 1e6)}>
            Random
          </button>
        </form>

        {terrainView && marsStatus?.kind === 'loading' && (
          <p className="mars-status" role="status">
            Loading real Mars terrain for seed {seed}…
          </p>
        )}
        {terrainView && marsStatus?.kind === 'error' && (
          <div className="mars-status mars-status-error" role="alert">
            <p>{marsStatus.message}</p>
            <button type="button" onClick={() => setMarsAttempt((attempt) => attempt + 1)}>
              Retry
            </button>
          </div>
        )}

        <div className="showcase-row" role="group" aria-label="Render mode">
          {RENDER_MODES.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={mode === id} disabled={!terrainView} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>

        <div className="showcase-toggles">
          <label className="showcase-toggle">
            <input type="checkbox" checked={showGrid} disabled={!terrainView} onChange={(event) => setShowGrid(event.target.checked)} />
            Cell grid
          </label>
          <label className="showcase-toggle">
            <input
              type="checkbox"
              checked={showValues}
              disabled={!terrainView}
              onChange={(event) => setShowValues(event.target.checked)}
            />
            Relief values
          </label>
        </div>

        <div className="showcase-row" role="group" aria-label="Camera">
          {PRESETS.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => stageRef.current?.setCameraPreset(id)}>
              {label}
            </button>
          ))}
        </div>

        {realElevation?.geo && (
          <section className="mars-source" aria-label="Real Mars terrain source">
            <dl>
              <dt>Centre</dt>
              <dd>
                {formatLatitude(realElevation.geo.center.latitude)} · {formatLongitudeEast(realElevation.geo.center.longitudeEast)}
              </dd>
              {elevationRange && (
                <>
                  <dt>Elevation</dt>
                  <dd>
                    {formatNumber(elevationRange.min)} to {formatMeters(elevationRange.max)}
                  </dd>
                </>
              )}
              <dt>Product</dt>
              <dd className="mars-product">{realElevation.geo.provenance.productId ?? 'not provided'}</dd>
            </dl>
            <p className="mars-note">Unclassified: no geology or minerals.</p>
            <details className="mars-details">
              <summary>Source details</summary>
              <p>
                {realElevation.geo.provenance.datasetId} · {realElevation.geo.provenance.resolutionMeters.toFixed(2)} m/px · heights above{' '}
                {realElevation.geo.datum}
                <br />
                {realElevation.geo.provenance.provider}
              </p>
            </details>
          </section>
        )}

        {reliefMap && (
          <section className="relief-panel" aria-label="Layer −1 cell data">
            <ReliefMinimap
              map={reliefMap}
              hovered={hovered}
              onInspect={inspect}
              onFocus={(cell) => stageRef.current?.focusCell(cell)}
            />
            <div className="relief-legend" aria-hidden="true">
              <span>−1 deep</span>
              <span>0</span>
              <span>+1 high</span>
            </div>
            <p className="relief-inspector">
              {hovered ? (
                <>
                  <strong>
                    Cell {hovered.col},{hovered.row}
                  </strong>{' '}
                  · layer {hovered.layer} · relief {signed(hovered.relief)}
                  <br />
                  {/* Unclassified cells carry no region, geology or feature worth repeating on every hover. */}
                  {reliefMap.classification !== 'none' && (
                    <>
                      {hovered.region} · {hovered.geology} · {hovered.feature} ·{' '}
                    </>
                  )}
                  {hovered.elevationMeters !== undefined && <>{formatMeters(hovered.elevationMeters)} · </>}
                  slope {hovered.slope.toFixed(2)} · curv {signed(hovered.curvature)}
                </>
              ) : (
                'Hover a cell to inspect its Layer −1 data · click to fly there'
              )}
            </p>
          </section>
        )}

        {stats && (
          <p className="showcase-stats" aria-label="Render stats">
            {stats.fps} fps
            {stats.content && (
              <>
                {' '}
                · {stats.content.drawCalls} draws · {(stats.content.triangles / 1000).toFixed(0)}k tris · built in {stats.content.buildMs} ms
                {stats.content.info.deposits && (
                  <>
                    <br />
                    {stats.content.info.deposits}
                  </>
                )}
              </>
            )}
          </p>
        )}

        <p className="showcase-hint">
          Drag to orbit · right-drag to pan · scroll to zoom
          {terrainView && showValues && ' · zoom in to read values around the view centre'}
        </p>
      </aside>
    </div>
  )
}
