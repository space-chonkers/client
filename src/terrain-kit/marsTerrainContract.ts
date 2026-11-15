import { cellElevations, normalizeElevation, toRelief } from './elevation'
import { MAX_MAP_LATITUDE_DEGREES } from './marsCoordinates'
import { round2 } from './noise'
import { createReliefMap, type ReliefMap, type TerrainClassification } from './reliefMap'

/**
 * Proposed v1 payload from the future backend geospatial module (see
 * docs/mars_terrain_contract.md). Not served by any backend yet: this is the
 * client side of a contract still to be agreed with the backend team.
 */
export const MARS_TERRAIN_CONTRACT_VERSION = 1

export interface MarsTerrainDataV1 {
  version: typeof MARS_TERRAIN_CONTRACT_VERSION
  /**
   * Map centre: planetocentric latitude [-85, 85] (polar maps are not
   * supported in v1) and east-positive longitude [0, 360), degrees.
   */
  center: { latitude: number; longitudeEast: number }
  /** Logical cells: `columns` west→east, `rows` north→south, each `cellSizeMeters` on the ground. */
  grid: { columns: number; rows: number; cellSizeMeters: number }
  elevation: {
    /** Samples on cell corners: `columns` = grid.columns + 1, `rows` = grid.rows + 1. */
    sampling: 'cell-corners'
    columns: number
    rows: number
    /**
     * Row-major from the north-west corner: `index = row * columns + column`,
     * row 0 on the north edge, column 0 on the west edge, regular spacing of
     * `grid.cellSizeMeters` along local east and north (the horizontal
     * convention in `marsCoordinates.ts`). Metres above `datum`. `null` marks
     * NoData, which v1 rejects: incomplete tiles are invalid.
     */
    samplesMeters: (number | null)[]
    /** Vertical reference of the samples, as an identifier agreed with the backend. */
    datum: string
  }
  source: {
    datasetId: string
    provider: string
    /** Ground resolution of the source dataset in metres (not the grid's cell size). */
    resolutionMeters: number
    productId?: string
  }
  /**
   * Owned by the backend, so every client builds the same map. Drives any
   * deterministic procedural decoration the client opts into; never data.
   */
  seed: number
}

/** A payload that breaks the contract; `issues` lists every problem found, not just the first. */
export class MarsTerrainDataError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid Mars terrain data: ${issues.join('; ')}`)
    this.name = 'MarsTerrainDataError'
    this.issues = issues
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * Checks untrusted input against the v1 contract and returns it typed.
 * Throws a {@link MarsTerrainDataError} listing every violation.
 */
export function parseMarsTerrainData(input: unknown): MarsTerrainDataV1 {
  const issues: string[] = []
  if (!isRecord(input)) throw new MarsTerrainDataError(['payload is not an object'])
  const { version, center, grid, elevation, source, seed } = input

  if (version !== MARS_TERRAIN_CONTRACT_VERSION) issues.push(`unsupported version ${String(version)} (expected ${MARS_TERRAIN_CONTRACT_VERSION})`)

  if (!isRecord(center)) issues.push('center is missing')
  else {
    if (!isFiniteNumber(center.latitude) || Math.abs(center.latitude) > MAX_MAP_LATITUDE_DEGREES) {
      issues.push(`center.latitude must be in [-${MAX_MAP_LATITUDE_DEGREES}, ${MAX_MAP_LATITUDE_DEGREES}]`)
    }
    if (!isFiniteNumber(center.longitudeEast) || center.longitudeEast < 0 || center.longitudeEast >= 360) {
      issues.push('center.longitudeEast must be in [0, 360)')
    }
  }

  const gridValid = isRecord(grid) && isPositiveInteger(grid.columns) && isPositiveInteger(grid.rows)
  if (!gridValid) issues.push('grid.columns and grid.rows must be positive integers')
  if (!isRecord(grid) || !isFiniteNumber(grid.cellSizeMeters) || grid.cellSizeMeters <= 0) issues.push('grid.cellSizeMeters must be > 0')

  if (!isRecord(elevation)) issues.push('elevation is missing')
  else {
    if (elevation.sampling !== 'cell-corners') issues.push(`unsupported elevation.sampling ${String(elevation.sampling)} (expected cell-corners)`)
    if (gridValid && (elevation.columns !== (grid.columns as number) + 1 || elevation.rows !== (grid.rows as number) + 1)) {
      issues.push(`elevation must be ${(grid.columns as number) + 1}×${(grid.rows as number) + 1} corner samples, got ${String(elevation.columns)}×${String(elevation.rows)}`)
    }
    if (!isNonEmptyString(elevation.datum)) issues.push('elevation.datum is required')
    const samples = elevation.samplesMeters
    if (!Array.isArray(samples)) issues.push('elevation.samplesMeters must be an array')
    else {
      if (isPositiveInteger(elevation.columns) && isPositiveInteger(elevation.rows) && samples.length !== elevation.columns * elevation.rows) {
        issues.push(`elevation.samplesMeters has ${samples.length} values, expected ${elevation.columns * elevation.rows}`)
      }
      let invalidCount = 0
      let firstInvalid = -1
      samples.forEach((sample, index) => {
        if (isFiniteNumber(sample)) return
        if (invalidCount === 0) firstInvalid = index
        invalidCount++
      })
      if (invalidCount > 0) {
        const width = isPositiveInteger(elevation.columns) ? elevation.columns : 1
        issues.push(
          `${invalidCount} elevation samples are NoData or not finite (first at index ${firstInvalid}: row ${Math.floor(firstInvalid / width)}, column ${firstInvalid % width})`,
        )
      }
    }
  }

  if (!isRecord(source)) issues.push('source is missing')
  else {
    if (!isNonEmptyString(source.datasetId)) issues.push('source.datasetId is required')
    if (!isNonEmptyString(source.provider)) issues.push('source.provider is required')
    if (!isFiniteNumber(source.resolutionMeters) || source.resolutionMeters <= 0) issues.push('source.resolutionMeters must be > 0')
    if (source.productId !== undefined && typeof source.productId !== 'string') issues.push('source.productId must be a string')
  }

  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffffffff) issues.push('seed must be an integer in [0, 2^32)')

  if (issues.length > 0) throw new MarsTerrainDataError(issues)
  return input as unknown as MarsTerrainDataV1
}

export interface MarsTerrainOptions {
  /**
   * `none` (default): cells stay `unclassified` and undressed, so measured
   * terrain carries no invented geology, formations or mineral deposits.
   * `procedural`: opt into the seeded classifier and dressing; the map is then
   * marked `classification: 'procedural'`, game decoration, not observation.
   */
  classification?: TerrainClassification
}

/**
 * Builds a Layer −1 map from a contract payload. The received
 * metres are kept unmodified on `map.elevation`; cells get their mean
 * elevation and normalized relief. Classification and dressing are off
 * unless `options.classification` is `procedural`.
 */
export function createReliefMapFromMarsTerrain(data: MarsTerrainDataV1, options: MarsTerrainOptions = {}): ReliefMap {
  // Re-validated here too: payloads assembled in code bypass `parseMarsTerrainData`.
  const valid = parseMarsTerrainData(data)
  const { columns: cols, rows, cellSizeMeters } = valid.grid
  // A copy, so later changes to the payload cannot alter the map. Validation guarantees every sample is finite.
  const samplesMeters = valid.elevation.samplesMeters.slice() as number[]
  const normalization = normalizeElevation(samplesMeters)
  const relief = cellElevations(samplesMeters, cols, rows).map((meters) => round2(toRelief(meters, normalization)))
  return createReliefMap(valid.seed, cols, rows, relief, [], {
    classification: options.classification ?? 'none',
    elevation: {
      samplesMeters,
      cellSizeMeters,
      normalization,
      geo: {
        center: { latitude: valid.center.latitude, longitudeEast: valid.center.longitudeEast },
        datum: valid.elevation.datum,
        provenance: {
          datasetId: valid.source.datasetId,
          provider: valid.source.provider,
          resolutionMeters: valid.source.resolutionMeters,
          ...(valid.source.productId !== undefined ? { productId: valid.source.productId } : {}),
        },
      },
    },
  })
}
