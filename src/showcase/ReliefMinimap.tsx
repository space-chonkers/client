import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import type { ReliefMap, TerrainCell } from '../terrain-kit/reliefMap'
import { reliefHex } from './terrainLayerView'

/** Minimap backing-store pixels per cell; CSS scales the canvas to the panel width. */
const MINIMAP_CELL_PX = 5

/** Canvas heatmap of every cell's relief; hovering reports the cell under the pointer, clicking focuses it. */
export default function ReliefMinimap({
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
