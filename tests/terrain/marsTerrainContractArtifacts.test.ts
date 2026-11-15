import { describe, expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020'
import { readFileSync } from 'node:fs'
import { MAX_MAP_LATITUDE_DEGREES } from '../../src/terrain-kit/marsCoordinates'
import {
  MARS_TERRAIN_CONTRACT_VERSION,
  MarsTerrainDataError,
  createReliefMapFromMarsTerrain,
  parseMarsTerrainData,
} from '../../src/terrain-kit/marsTerrainContract'
import { syntheticMarsTerrain } from './syntheticMarsTerrain'

/**
 * The backend handoff artifacts in docs/mars_terrain_contract/ must stay in
 * step with the TypeScript parser, which remains the source of truth.
 */
const ARTIFACTS_DIR = new URL('../../docs/mars_terrain_contract/', import.meta.url)
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, ARTIFACTS_DIR), 'utf8'))

/** Deliberately arbitrary round-number centre: the fixtures describe no real place. */
const FIXTURE_CENTER = { latitude: 10, longitudeEast: 20 }

const FIXTURES = [
  { file: 'synthetic_2x2.v1.json', columns: 2, rows: 2 },
  { file: 'synthetic_50x50.v1.json', columns: 50, rows: 50 },
] as const

describe.each(FIXTURES)('synthetic fixture $file', ({ file, columns, rows }) => {
  const fixture = readJson(file)

  test('is accepted by the parser unchanged', () => {
    expect(parseMarsTerrainData(fixture)).toEqual(fixture as ReturnType<typeof parseMarsTerrainData>)
  })

  test('is exactly the synthetic formula output, not measured data', () => {
    // Regenerate with syntheticMarsTerrain({ columns, rows, center: FIXTURE_CENTER }) if the generator changes on purpose.
    expect(fixture).toEqual(syntheticMarsTerrain({ columns, rows, center: FIXTURE_CENTER }))
  })

  test(`has ${columns + 1}×${rows + 1} corner samples and builds a ${columns}×${rows} map`, () => {
    const map = createReliefMapFromMarsTerrain(parseMarsTerrainData(fixture))
    expect(map.elevation?.samplesMeters).toHaveLength((columns + 1) * (rows + 1))
    expect(map.cols).toBe(columns)
    expect(map.rows).toBe(rows)
  })
})

describe('JSON Schema', () => {
  const schema = readJson('mars_terrain_data.v1.schema.json') as Record<string, any>
  const { center, grid, elevation, source } = schema.properties

  test('uses the parser constants', () => {
    expect(schema.properties.version.const).toBe(MARS_TERRAIN_CONTRACT_VERSION)
    expect(center.properties.latitude.minimum).toBe(-MAX_MAP_LATITUDE_DEGREES)
    expect(center.properties.latitude.maximum).toBe(MAX_MAP_LATITUDE_DEGREES)
    expect(schema.properties.seed.maximum).toBe(2 ** 32 - 1)
  })

  test('requires the same fields as the TypeScript contract', () => {
    expect(schema.required).toEqual(['version', 'center', 'grid', 'elevation', 'source', 'seed'])
    expect(center.required).toEqual(['latitude', 'longitudeEast'])
    expect(grid.required).toEqual(['columns', 'rows', 'cellSizeMeters'])
    expect(elevation.required).toEqual(['sampling', 'columns', 'rows', 'samplesMeters', 'datum'])
    expect(source.required).toEqual(['datasetId', 'provider', 'resolutionMeters'])
  })
})

describe('JSON Schema validation (Draft 2020-12, as the backend runs it)', () => {
  const validateSchema = new Ajv2020({ allErrors: true }).compile(readJson('mars_terrain_data.v1.schema.json') as object)

  /**
   * The two rules JSON Schema cannot express (docs/mars_terrain_contract.md §7–8).
   * Only called after the schema passed, so the fields exist with the right types.
   */
  const passesCrossFieldChecks = (payload: any) =>
    payload.elevation.columns === payload.grid.columns + 1 &&
    payload.elevation.rows === payload.grid.rows + 1 &&
    payload.elevation.samplesMeters.length === payload.elevation.columns * payload.elevation.rows

  const schemaAndChecksAccept = (payload: unknown) => validateSchema(payload) && passesCrossFieldChecks(payload)

  const parserAccepts = (payload: unknown) => {
    try {
      parseMarsTerrainData(payload)
      return true
    } catch (error) {
      if (error instanceof MarsTerrainDataError) return false
      throw error
    }
  }

  test.each(FIXTURES.map(({ file }) => file))('%s is valid against the schema', (file) => {
    const fixture = readJson(file)
    expect(validateSchema(fixture), JSON.stringify(validateSchema.errors)).toBe(true)
    expect(passesCrossFieldChecks(fixture)).toBe(true)
  })

  /** Variants of the small fixture; `edit` mutates a fresh copy, or returns a replacement payload. */
  const CASES: readonly { name: string; edit: (payload: any) => unknown }[] = [
    { name: 'extra field (allowed by both)', edit: (p) => void (p.note = 'extra') },
    { name: 'productId present', edit: (p) => void (p.source.productId = 'P1') },
    { name: 'productId null', edit: (p) => void (p.source.productId = null) },
    { name: 'version 2', edit: (p) => void (p.version = 2) },
    { name: 'center missing', edit: (p) => void delete p.center },
    { name: 'latitude at the 85° limit', edit: (p) => void (p.center.latitude = 85) },
    { name: 'latitude beyond 85°', edit: (p) => void (p.center.latitude = 85.0001) },
    { name: 'longitude 360', edit: (p) => void (p.center.longitudeEast = 360) },
    { name: 'longitude negative', edit: (p) => void (p.center.longitudeEast = -0.1) },
    { name: 'fractional grid.columns', edit: (p) => void (p.grid.columns = 2.5) },
    { name: 'cellSizeMeters 0', edit: (p) => void (p.grid.cellSizeMeters = 0) },
    { name: 'cell-centre sampling', edit: (p) => void (p.elevation.sampling = 'cell-centres') },
    { name: 'blank datum', edit: (p) => void (p.elevation.datum = '   ') },
    { name: 'NoData sample (null)', edit: (p) => void (p.elevation.samplesMeters[4] = null) },
    { name: 'string sample', edit: (p) => void (p.elevation.samplesMeters[4] = '1') },
    { name: 'empty datasetId', edit: (p) => void (p.source.datasetId = '') },
    { name: 'resolutionMeters 0', edit: (p) => void (p.source.resolutionMeters = 0) },
    { name: 'seed at 2^32 − 1', edit: (p) => void (p.seed = 2 ** 32 - 1) },
    { name: 'seed 2^32', edit: (p) => void (p.seed = 2 ** 32) },
    { name: 'negative seed', edit: (p) => void (p.seed = -1) },
    { name: 'payload is an array', edit: () => [] },
    { name: 'payload is null', edit: () => null },
    // Cross-field cases: only the code checks catch these, never the schema alone.
    { name: 'elevation.columns ≠ grid.columns + 1', edit: (p) => void (p.elevation.columns = 4, p.elevation.samplesMeters.push(0, 0, 0)) },
    { name: 'one sample short', edit: (p) => void p.elevation.samplesMeters.pop() },
  ]

  test.each(CASES)('$name: schema + cross-field checks agree with the parser', ({ edit }) => {
    const copy = structuredClone(readJson('synthetic_2x2.v1.json'))
    const replaced = edit(copy)
    const payload = replaced === undefined ? copy : replaced
    expect(schemaAndChecksAccept(payload)).toBe(parserAccepts(payload))
  })

  test('the schema alone cannot catch the cross-field rules', () => {
    const shortSamples = structuredClone(readJson('synthetic_2x2.v1.json')) as any
    shortSamples.elevation.samplesMeters.pop()
    expect(validateSchema(shortSamples)).toBe(true)
    expect(parserAccepts(shortSamples)).toBe(false)
  })
})
