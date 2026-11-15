import { describe, expect, test } from 'bun:test'
import { MarsTerrainDataError, createReliefMapFromMarsTerrain, parseMarsTerrainData } from '../../src/terrain-kit/marsTerrainContract'
import { createReliefField } from '../../src/terrain-kit/reliefField'
import * as THREE from 'three'
import { UNCLASSIFIED } from '../../src/terrain-kit/reliefMap'
import { createReliefTerrain } from '../../src/terrain-kit/reliefTerrain'
import { syntheticMarsTerrain, syntheticPlane } from './syntheticMarsTerrain'

const cellOf = (map: ReturnType<typeof createReliefMapFromMarsTerrain>, col: number, row: number) => map.cells[row * map.cols + col]

/** Rejection helper: the issues a payload is rejected with. */
function issuesOf(payload: unknown): readonly string[] {
  try {
    parseMarsTerrainData(payload)
  } catch (error) {
    if (error instanceof MarsTerrainDataError) return error.issues
    throw error
  }
  throw new Error('payload was accepted')
}

describe('51×51 corner samples → 50×50 cells (synthetic plane)', () => {
  const data = syntheticMarsTerrain()
  const map = createReliefMapFromMarsTerrain(data)

  test('builds a 50×50 map that keeps the raw metres', () => {
    expect(data.elevation.samplesMeters).toHaveLength(51 * 51)
    expect(map.cols).toBe(50)
    expect(map.rows).toBe(50)
    expect(map.cells).toHaveLength(2500)
    expect(map.elevation?.samplesMeters).toEqual(data.elevation.samplesMeters as number[])
  })

  test('each cell holds the mean of its four corners', () => {
    // On a plane the corner mean equals the plane at the cell centre.
    for (const [col, row] of [[0, 0], [49, 0], [0, 49], [49, 49], [17, 33]]) {
      expect(cellOf(map, col, row).elevationMeters).toBeCloseTo(syntheticPlane(col + 0.5, row + 0.5), 9)
    }
  })

  test('sample 0 is the north-west corner: east rises, south falls', () => {
    expect(map.elevation?.samplesMeters[0]).toBe(syntheticPlane(0, 0))
    expect(map.elevation?.samplesMeters[50]).toBe(syntheticPlane(50, 0))
    expect(map.elevation?.samplesMeters[51]).toBe(syntheticPlane(0, 1))
    expect(cellOf(map, 49, 0).elevationMeters!).toBeGreaterThan(cellOf(map, 0, 0).elevationMeters!)
    expect(cellOf(map, 0, 49).elevationMeters!).toBeLessThan(cellOf(map, 0, 0).elevationMeters!)
  })

  test('normalized relief stays in [-1, 1] and follows elevation', () => {
    for (const cell of map.cells) {
      expect(cell.relief).toBeGreaterThanOrEqual(-1)
      expect(cell.relief).toBeLessThanOrEqual(1)
    }
    expect(cellOf(map, 49, 0).relief).toBeGreaterThan(cellOf(map, 0, 49).relief)
  })

  test('keeps the geographic metadata and provenance', () => {
    expect(map.elevation?.cellSizeMeters).toBe(10)
    expect(map.elevation?.geo).toEqual({
      center: data.center,
      datum: data.elevation.datum,
      provenance: { datasetId: data.source.datasetId, provider: data.source.provider, resolutionMeters: data.source.resolutionMeters },
    })
    expect(map.seed).toBe(data.seed)
  })

  test('the adapter keeps its own copy of the samples', () => {
    const payload = syntheticMarsTerrain({ columns: 2, rows: 2 })
    const copy = createReliefMapFromMarsTerrain(payload)
    payload.elevation.samplesMeters[0] = 999
    expect(copy.elevation?.samplesMeters[0]).toBe(syntheticPlane(0, 0))
  })
})

describe('normalization', () => {
  test('one extreme sample does not flatten the rest of the map', () => {
    // Synthetic ±20 m slope plus a single 5,000 m spike on one corner.
    const data = syntheticMarsTerrain({ elevationAt: (col, row) => (col === 25 && row === 25 ? 5000 : (col - 25) * 0.8) })
    const map = createReliefMapFromMarsTerrain(data)
    const westEdge = cellOf(map, 0, 10).relief
    const eastEdge = cellOf(map, 49, 10).relief
    // Scaling by the extreme (≈5,000 m) would leave every ordinary cell near 0.
    expect(eastEdge - westEdge).toBeGreaterThan(1.5)
    expect(map.elevation?.samplesMeters).toContain(5000)
  })

  test('nearly flat ground is not stretched into cliffs', () => {
    const map = createReliefMapFromMarsTerrain(syntheticMarsTerrain({ elevationAt: (col) => -2000 + (col % 2) * 0.5 }))
    for (const cell of map.cells) expect(Math.abs(cell.relief)).toBeLessThan(0.05)
  })

  test('is deterministic', () => {
    const data = syntheticMarsTerrain()
    expect(createReliefMapFromMarsTerrain(data)).toEqual(createReliefMapFromMarsTerrain(data))
  })
})

describe('validation', () => {
  test('rejects NoData and non-finite samples, naming where they are', () => {
    const data = syntheticMarsTerrain({ columns: 3, rows: 3 })
    data.elevation.samplesMeters[5] = null
    data.elevation.samplesMeters[6] = Number.NaN
    expect(issuesOf(data)).toContain('2 elevation samples are NoData or not finite (first at index 5: row 1, column 1)')
    expect(() => createReliefMapFromMarsTerrain(data)).toThrow(MarsTerrainDataError)
  })

  test('rejects a sample count or shape that does not match the grid', () => {
    const short = syntheticMarsTerrain({ columns: 3, rows: 3 })
    short.elevation.samplesMeters.pop()
    expect(issuesOf(short)).toContain('elevation.samplesMeters has 15 values, expected 16')

    const cellCentred = syntheticMarsTerrain({ columns: 3, rows: 3 })
    cellCentred.elevation.columns = 3
    expect(issuesOf(cellCentred)).toContain('elevation must be 4×4 corner samples, got 3×4')
  })

  test('reports every broken field at once', () => {
    const data = syntheticMarsTerrain({ columns: 2, rows: 2 }) as unknown as Record<string, any>
    data.version = 2
    data.center = { latitude: 86, longitudeEast: 360 }
    data.grid.cellSizeMeters = 0
    data.elevation.datum = ''
    data.source.provider = ''
    data.seed = -1
    expect(issuesOf(data)).toEqual([
      'unsupported version 2 (expected 1)',
      'center.latitude must be in [-85, 85]',
      'center.longitudeEast must be in [0, 360)',
      'grid.cellSizeMeters must be > 0',
      'elevation.datum is required',
      'source.provider is required',
      'seed must be an integer in [0, 2^32)',
    ])
  })

  test('rejects payloads that are not objects', () => {
    expect(issuesOf(null)).toEqual(['payload is not an object'])
    expect(issuesOf([])).toEqual(['payload is not an object'])
  })
})

describe('rendering real elevation', () => {
  const map = createReliefMapFromMarsTerrain(syntheticMarsTerrain({ columns: 6, rows: 4 }))
  const reference = map.elevation!.normalization.referenceMeters
  const grid = { cols: map.cols, rows: map.rows, cellSize: 1 }

  test('draws true-scale metres at the corners, relative to the reference', () => {
    const field = createReliefField(map, grid)
    // Corner (col, row) sits at world (col − cols/2, row − rows/2); 10 m cells drawn 1 unit wide.
    for (const [col, row] of [[0, 0], [6, 0], [3, 2], [6, 4]]) {
      expect(field.heightAt(col - 3, row - 2)).toBeCloseTo((syntheticPlane(col, row) - reference) / 10, 9)
    }
  })

  test('builds the same meshes every time', () => {
    const positions = () => createReliefTerrain({ map }).chunks.map((chunk) => Array.from(chunk.geometry.getAttribute('position').array))
    expect(positions()).toEqual(positions())
  })
})

describe('real elevation carries no invented geology by default (synthetic flat tile)', () => {
  const FLAT_METERS = -4000
  const flat = syntheticMarsTerrain({ elevationAt: () => FLAT_METERS })
  const map = createReliefMapFromMarsTerrain(flat)
  /** A synthetic tile with slopes and hollows, where slope debris would otherwise collect. */
  const hilly = syntheticMarsTerrain({ elevationAt: (col, row) => 30 * Math.sin(col / 4) * Math.cos(row / 5) })
  const instancedMeshes = (root: THREE.Object3D) => {
    let count = 0
    root.traverse((object) => {
      if ((object as THREE.InstancedMesh).isInstancedMesh) count++
    })
    return count
  }

  test('cells are unclassified, with no features, minerals or craters', () => {
    expect(map.classification).toBe('none')
    expect(map.craters).toEqual([])
    for (const cell of map.cells) {
      expect(cell.geology).toBe(UNCLASSIFIED)
      expect(cell.region).toBe(UNCLASSIFIED)
      expect(cell.feature).toBe('none')
      expect(cell.elevationMeters).toBe(FLAT_METERS)
    }
  })

  test('the rendered terrain has no formations, deposits or scattered rocks', () => {
    for (const data of [flat, hilly]) {
      const terrain = createReliefTerrain({ map: createReliefMapFromMarsTerrain(data) })
      expect(terrain.placements).toEqual([])
      expect(instancedMeshes(terrain.root)).toBe(0)
    }
  })

  test('the drawn surface is the measured surface', () => {
    const field = createReliefField(map, { cols: map.cols, rows: map.rows, cellSize: 1 })
    for (const [x, z] of [[-25, -25], [0, 0], [12.3, -7.9], [25, 25]]) expect(field.heightAt(x, z)).toBe(0)
  })

  test('procedural dressing is opt-in and marked as procedural', () => {
    const dressed = createReliefMapFromMarsTerrain(hilly, { classification: 'procedural' })
    expect(dressed.classification).toBe('procedural')
    expect(dressed.cells.some((cell) => cell.geology !== UNCLASSIFIED)).toBe(true)
    expect(dressed.cells.some((cell) => cell.feature !== 'none')).toBe(true)
    // The measured metres are untouched by the opt-in.
    expect(dressed.elevation?.samplesMeters).toEqual(createReliefMapFromMarsTerrain(hilly).elevation!.samplesMeters)
  })
})
