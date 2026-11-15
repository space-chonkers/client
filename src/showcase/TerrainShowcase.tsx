import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import type { ReliefMap, TerrainCell } from '../terrain-kit/reliefMap'
import { ShowcaseStage, type CameraPreset, type RenderMode, type StageStats, type ViewMode } from './ShowcaseStage'
import { reliefHex } from './terrainLayerView'

/** Minimap backing-store pixels per cell; CSS scales the canvas to the panel width. */
const MINIMAP_CELL_PX = 5

const DEFAULT_SEED = 42
const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'terrain', label: 'Layer −1' },
  { id: 'assets', label: 'Assets' },
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

const signed = (value: number) => (value > 0 ? '+' : '') + value.toFixed(2)

/** Canvas heatmap of every cell's relief; hovering reports the cell under the pointer, clicking focuses it. */
function ReliefMinimap({
  map,
  hovered,
  onInspect,
  onFocus,
}: {
  map: ReliefMap
  hovered: TerrainCell | null
  onInspect: (cell: TerrainCell | null) => void
  onFocus: (cell: TerrainCell) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const colors = useMemo(() => map.cells.map((cell) => reliefHex(cell.relief)), [map])

  useEffect(() => {
    const context = canvasRef.current!.getContext('2d')!
    const s = MINIMAP_CELL_PX
    map.cells.forEach((cell, index) => {
      context.fillStyle = colors[index]
      context.fillRect(cell.col * s, cell.row * s, s, s)
    })
    if (hovered) {
      context.strokeStyle = '#ffffff'
      context.lineWidth = 2
      context.strokeRect(hovered.col * s - 1, hovered.row * s - 1, s + 2, s + 2)
    }
  }, [map, colors, hovered])

  const cellUnder = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * map.cols)
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * map.rows)
    return map.cells[row * map.cols + col] as TerrainCell | undefined
  }
  const pick = (event: MouseEvent<HTMLCanvasElement>) => {
    const cell = cellUnder(event)
    if (cell && cell !== hovered) onInspect(cell)
  }

  return (
    <canvas
      ref={canvasRef}
      className="relief-map"
      width={map.cols * MINIMAP_CELL_PX}
      height={map.rows * MINIMAP_CELL_PX}
      onMouseMove={pick}
      onMouseLeave={() => onInspect(null)}
      onClick={(event) => {
        const cell = cellUnder(event)
        if (cell) onFocus(cell)
      }}
    />
  )
}

export default function TerrainShowcase() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<ShowcaseStage | null>(null)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [seedDraft, setSeedDraft] = useState(String(DEFAULT_SEED))
  const [view, setView] = useState<ViewMode>('terrain')
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
    setReliefMap(stageRef.current?.load(view, seed) ?? null)
    setHovered(null)
  }, [view, seed])

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

  return (
    <div className="showcase">
      <div ref={containerRef} className="showcase-canvas" aria-label="Martian terrain showcase" />
      <aside className="showcase-panel">
        <header>
          <h1>Space Chonkers</h1>
          <p>Layer −1 · procedural geological substrate</p>
        </header>

        <div className="showcase-row" role="group" aria-label="View">
          {VIEWS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
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

        <div className="showcase-row" role="group" aria-label="Render mode">
          {RENDER_MODES.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={mode === id} disabled={!terrainView} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>

        <label className="showcase-toggle">
          <input type="checkbox" checked={showGrid} disabled={!terrainView} onChange={(event) => setShowGrid(event.target.checked)} />
          Cell grid overlay
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

        <div className="showcase-row" role="group" aria-label="Camera">
          {PRESETS.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => stageRef.current?.setCameraPreset(id)}>
              {label}
            </button>
          ))}
        </div>

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
                  {hovered.region} · {hovered.geology} · {hovered.feature} · slope {hovered.slope.toFixed(2)} · curv {signed(hovered.curvature)}
                </>
              ) : (
                'Hover a cell to inspect its Layer −1 data · click to fly there'
              )}
            </p>
          </section>
        )}

        {stats && (
          <p className="showcase-stats" aria-label="Render stats">
            {stats.fps} fps · {stats.drawCalls} draws · {(stats.triangles / 1000).toFixed(0)}k tris · built in {stats.buildMs} ms
            {stats.info.deposits && (
              <>
                <br />
                {stats.info.deposits}
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
