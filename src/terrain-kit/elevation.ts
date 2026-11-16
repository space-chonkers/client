import { clamp, quantile } from './noise'

/**
 * Physical elevation behind a Layer −1 map built from real elevation data.
 * Pure data with no Three.js dependency.
 *
 * Height pipeline for real-elevation maps (each stage is kept, none overwrites another):
 * 1. Raw elevation: `samplesMeters`, metres above `geo.datum`, exactly as received.
 * 2. Relative height: `elevation − normalization.referenceMeters`, in metres.
 * 3. Normalized relief: relative height / `normalization.scaleMeters`, clamped to
 *    [-1, 1]; stored per cell as `TerrainCell.relief`. It feeds classification
 *    and dressing only on maps that opt into them.
 * 4. Visual height: relative height × world units per metre, at true scale
 *    (see `reliefField.ts`).
 */

/** Map centre on Mars: planetocentric latitude and east-positive longitude, in degrees. */
export interface MarsCoordinate {
  /** [-90, 90], positive north. */
  readonly latitude: number
  /** [0, 360), positive east. */
  readonly longitudeEast: number
}

/** Where the elevation came from. Provenance only; the client never reads the dataset itself. */
export interface ElevationProvenance {
  readonly datasetId: string
  readonly provider: string
  /** Ground resolution of the source dataset, in metres (not the grid's cell size). */
  readonly resolutionMeters: number
  readonly productId?: string
}

export interface GeoReference {
  readonly center: MarsCoordinate
  /** Vertical reference of `samplesMeters`, as agreed with the backend (an identifier, not a formula). */
  readonly datum: string
  readonly provenance: ElevationProvenance
}

/** How metres map to normalized relief: `relief = clamp((elevation − referenceMeters) / scaleMeters, −1, 1)`. */
export interface ElevationScale {
  readonly referenceMeters: number
  readonly scaleMeters: number
}

/**
 * Real elevation for a `cols × rows` map, sampled on cell corners:
 * `(cols + 1) × (rows + 1)` samples, row-major from the north-west corner
 * (`index = row * (cols + 1) + col`; row 0 is the north edge, col 0 the west edge).
 */
export interface ElevationModel {
  readonly samplesMeters: readonly number[]
  /** Ground size of one grid cell, in metres. */
  readonly cellSizeMeters: number
  readonly normalization: ElevationScale
  readonly geo: GeoReference
  /**
   * Present on display maps that surround measured terrain with synthetic
   * scenery (`createMarsTerrainScenery`): only the corners of these cells are
   * measured, every other sample is generated. Absent: all samples are measured.
   */
  readonly measuredFootprint?: { readonly col: number; readonly row: number; readonly cols: number; readonly rows: number }
}

/**
 * Normalization: the median sample maps to relief 0, and the scale covers this
 * share of samples by distance from it (the rest clamp to ±1). A high quantile
 * instead of the extreme keeps one spike or pit from flattening the map.
 * Values to revisit once real tiles exist; they shape normalized relief, not
 * rendered heights.
 */
const NORMALIZATION_COVERAGE = 0.98
/** Smallest metre range mapped to ±1, so nearly flat ground is not stretched into cliffs. */
const MIN_NORMALIZATION_SCALE_METERS = 15
const MEDIAN = 0.5

/** Index of corner sample (col, row) in a map `cols` cells wide. */
export const cornerIndex = (cols: number, col: number, row: number) => row * (cols + 1) + col

/** Picks the reference and scale for a set of samples. */
export function normalizeElevation(samplesMeters: readonly number[]): ElevationScale {
  const referenceMeters = quantile([...samplesMeters].sort((a, b) => a - b), MEDIAN)
  const distances = samplesMeters.map((value) => Math.abs(value - referenceMeters)).sort((a, b) => a - b)
  return { referenceMeters, scaleMeters: Math.max(quantile(distances, NORMALIZATION_COVERAGE), MIN_NORMALIZATION_SCALE_METERS) }
}

/** Mean of each cell's four corner samples, row-major `cols × rows`, in metres. */
export function cellElevations(samplesMeters: readonly number[], cols: number, rows: number): number[] {
  const cells = new Array<number>(cols * rows)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells[row * cols + col] =
        (samplesMeters[cornerIndex(cols, col, row)] +
          samplesMeters[cornerIndex(cols, col + 1, row)] +
          samplesMeters[cornerIndex(cols, col, row + 1)] +
          samplesMeters[cornerIndex(cols, col + 1, row + 1)]) /
        4
    }
  }
  return cells
}

/** Normalized relief in [-1, 1] for an elevation in metres. */
export function toRelief(elevationMeters: number, { referenceMeters, scaleMeters }: ElevationScale): number {
  return clamp((elevationMeters - referenceMeters) / scaleMeters, -1, 1)
}
