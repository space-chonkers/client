import { cellElevations, cornerIndex, type ElevationModel } from './elevation'
import { createReliefMapFromMarsTerrain, type MarsTerrainDataV1 } from './marsTerrainContract'
import { clamp, round2, smoothstep } from './noise'
import { createReliefMap, generateLandforms, type ReliefMap } from './reliefMap'

/**
 * Game scenery around real elevation: the playable map keeps the measured
 * HiRISE heights, the game's procedural art system dresses it, and synthetic
 * procedural terrain surrounds it so the world does not end at the data's edge.
 *
 * Three kinds of geometry meet here and stay distinguishable:
 * - **measured**: the payload's corner samples, copied unchanged into the
 *   centre of the display grid (`elevation.measuredFootprint` says where);
 * - **synthetic**: the surrounding ring, generated, never presented as data;
 * - **construction** edits happen later, on rendered meshes only (`MarsMapLayer`).
 */
export const MARS_SCENERY = {
  /**
   * Synthetic cells on each side of the measured footprint. The mission camera
   * sees ~10 cells past the playable edge at base level and up to ~15 at the
   * screen corners or over lower ground, so 20 keeps the void out of view.
   */
  borderCells: 20,
  /**
   * The ring continues the measured boundary's outward slope, levelling off
   * over this many cells, so the seam has no kink; procedural relief fades in
   * on top across the whole border.
   */
  slopeCarryCells: 3,
  /**
   * Procedural relief in the ring, in multiples of the measured terrain's
   * local relief range: the ring gets the same surface texture as the measured
   * ground rather than the window's (often tilt-dominated) total range.
   */
  ringReliefGain: 2,
  /**
   * Local relief (elevation minus the neighbourhood mean) drives the art
   * classifier. Real windows are dominated by smooth regional trends, which
   * read as near-zero relief contrast and leave the map almost undressed; a
   * ~130 m neighbourhood picks out the hills, channels and scarps instead.
   */
  localReliefRadius: 6,
  /** Share of local relief values that map inside ±1 (the rest clamp), as the elevation normalization. */
  localReliefCoverage: 0.98,
  /** Smallest metre range mapped to ±1, so a perfectly flat window is not stretched into noise. */
  minLocalReliefMeters: 1,
}

function quantile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(share * (sorted.length - 1)))]
}

/**
 * Corner samples for the display grid: the measured samples unchanged in the
 * centre, synthetic samples outside. A synthetic corner starts at its nearest
 * boundary sample, continues the boundary's outward slope (levelling off over
 * `slopeCarryCells`) and blends in procedural relief, scaled to the measured
 * terrain's own relief range, with a weight that is 0 at the seam and 1 at
 * the outer edge. Value and slope therefore both match across the seam.
 */
function surroundSamples(measured: ReliefMap, border: number, proceduralRelief: readonly number[], amplitude: number): number[] {
  const elevation = measured.elevation!
  const mCols = measured.cols
  const mRows = measured.rows
  const cols = mCols + 2 * border
  const rows = mRows + 2 * border
  const at = (c: number, r: number) => elevation.samplesMeters[cornerIndex(mCols, clamp(c, 0, mCols), clamp(r, 0, mRows))]
  const carryLength = MARS_SCENERY.slopeCarryCells
  const carry = (distance: number) => carryLength * (1 - Math.exp(-distance / carryLength))
  // Outward slope per cell at a boundary sample, over two cells so single-sample noise doesn't dominate.
  const outwardSlope = (c: number, r: number, dc: number, dr: number) => (at(c, r) - at(c - 2 * dc, r - 2 * dr)) / 2
  // Procedural relief at a display corner: mean of the cells touching it.
  const cellRelief = (c: number, r: number) => proceduralRelief[clamp(r, 0, rows - 1) * cols + clamp(c, 0, cols - 1)]
  const cornerRelief = (c: number, r: number) => (cellRelief(c - 1, r - 1) + cellRelief(c, r - 1) + cellRelief(c - 1, r) + cellRelief(c, r)) / 4

  const samples: number[] = []
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const mc = col - border
      const mr = row - border
      const c = clamp(mc, 0, mCols)
      const r = clamp(mr, 0, mRows)
      const dx = mc - c
      const dz = mr - r
      if (dx === 0 && dz === 0) {
        samples.push(at(c, r))
        continue
      }
      const trend =
        at(c, r) +
        (dx !== 0 ? outwardSlope(c, r, Math.sign(dx), 0) * carry(Math.abs(dx)) : 0) +
        (dz !== 0 ? outwardSlope(c, r, 0, Math.sign(dz)) * carry(Math.abs(dz)) : 0)
      const weight = smoothstep(0, border, Math.max(Math.abs(dx), Math.abs(dz)))
      samples.push(trend + weight * amplitude * cornerRelief(col, row))
    }
  }
  return samples
}

/** Cell elevation minus its neighbourhood mean, in metres. */
function localResidual(cellMeters: readonly number[], cols: number, rows: number): number[] {
  const radius = MARS_SCENERY.localReliefRadius
  const at = (c: number, r: number) => cellMeters[clamp(r, 0, rows - 1) * cols + clamp(c, 0, cols - 1)]
  const residual = cellMeters.map((meters, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    let sum = 0
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) sum += at(col + dc, row + dr)
    return meters - sum / (2 * radius + 1) ** 2
  })
  return residual
}

/** Metres of local relief mapped to ±1: measured cells only, so the synthetic ring never sets the scale. */
const localReliefScale = (residualMeters: readonly number[]) =>
  Math.max(quantile(residualMeters.map(Math.abs), MARS_SCENERY.localReliefCoverage), MARS_SCENERY.minLocalReliefMeters)

/**
 * Builds the game's display map for real terrain: `borderCells` of synthetic
 * procedural terrain around the measured footprint, classified and dressed by
 * the existing procedural art system. Heights come from the samples (measured
 * in the footprint, synthetic outside); classification, colours and assets
 * are game art, not observations. The payload is not modified.
 */
export function createMarsTerrainScenery(data: MarsTerrainDataV1): ReliefMap {
  // Validates the payload and keeps its own copy of the samples.
  const measured = createReliefMapFromMarsTerrain(data)
  const border = MARS_SCENERY.borderCells
  const cols = measured.cols + 2 * border
  const rows = measured.rows + 2 * border
  const { relief: proceduralRelief } = generateLandforms(measured.seed, cols, rows)
  const measuredScale = localReliefScale(localResidual(measured.cells.map((cell) => cell.elevationMeters!), measured.cols, measured.rows))
  const samplesMeters = surroundSamples(measured, border, proceduralRelief, MARS_SCENERY.ringReliefGain * measuredScale)
  const elevation: ElevationModel = {
    ...measured.elevation!,
    samplesMeters,
    measuredFootprint: { col: border, row: border, cols: measured.cols, rows: measured.rows },
  }
  const residual = localResidual(cellElevations(samplesMeters, cols, rows), cols, rows)
  const footprintResidual = residual.filter((_, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    return col >= border && col < border + measured.cols && row >= border && row < border + measured.rows
  })
  const scale = localReliefScale(footprintResidual)
  const relief = residual.map((value) => round2(clamp(value / scale, -1, 1)))
  return createReliefMap(measured.seed, cols, rows, relief, [], { classification: 'procedural', elevation })
}

/** The measured corner samples of a display map (all of them when it has no synthetic surroundings). */
export function measuredSamples(map: ReliefMap): number[] {
  const elevation = map.elevation
  if (!elevation) return []
  const footprint = elevation.measuredFootprint
  if (!footprint) return elevation.samplesMeters.slice()
  const out: number[] = []
  for (let row = footprint.row; row <= footprint.row + footprint.rows; row++) {
    for (let col = footprint.col; col <= footprint.col + footprint.cols; col++) out.push(elevation.samplesMeters[cornerIndex(map.cols, col, row)])
  }
  return out
}

/** Whether cell (col, row) of a display map lies on measured ground. */
export function isMeasuredCell(map: ReliefMap, col: number, row: number): boolean {
  const footprint = map.elevation?.measuredFootprint
  if (!map.elevation) return false
  if (!footprint) return true
  return col >= footprint.col && col < footprint.col + footprint.cols && row >= footprint.row && row < footprint.row + footprint.rows
}
