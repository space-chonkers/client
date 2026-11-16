import { describe, expect, test } from 'bun:test'
import { cornerIndex } from '../../src/terrain-kit/elevation'
import { MARS_SCENERY, createMarsTerrainScenery, isMeasuredCell, measuredSamples } from '../../src/terrain-kit/marsTerrainScenery'
import { syntheticMarsTerrain } from './syntheticMarsTerrain'

const B = MARS_SCENERY.borderCells
const SIZE = 50 + 2 * B

/** SYNTHETIC hilly ground (not Mars data). */
const hills = (col: number, row: number) => -2000 + 30 * Math.sin(col * 0.35) * Math.cos(row * 0.3) + 12 * Math.sin(col * 0.9 + row * 0.4)

describe('createMarsTerrainScenery', () => {
  const payload = syntheticMarsTerrain({ elevationAt: hills })
  const original = structuredClone(payload)
  const map = createMarsTerrainScenery(payload)
  const sample = (col: number, row: number) => map.elevation!.samplesMeters[cornerIndex(SIZE, col, row)]

  test('copies the measured samples unchanged into the centre and marks the footprint', () => {
    expect(map.cols).toBe(SIZE)
    expect(map.rows).toBe(SIZE)
    expect(map.elevation!.measuredFootprint).toEqual({ col: B, row: B, cols: 50, rows: 50 })
    expect(measuredSamples(map)).toEqual(original.elevation.samplesMeters as number[])
    expect(payload).toEqual(original)
    // Same orientation: display corner (B + col, B + row) is payload corner (col, row).
    expect(sample(B + 7, B + 31)).toBe(hills(7, 31))
    expect(isMeasuredCell(map, B, B)).toBe(true)
    expect(isMeasuredCell(map, B - 1, B)).toBe(false)
    expect(isMeasuredCell(map, B + 49, B + 49)).toBe(true)
    expect(isMeasuredCell(map, B + 50, B + 10)).toBe(false)
  })

  test('the synthetic ring meets every boundary sample with matching height and slope (no seam)', () => {
    // Along each side, compare the step just outside the footprint with the measured step just inside it.
    const sides = [
      { at: (k: number, d: number) => sample(B - d, B + k) }, // west: d cells outside
      { at: (k: number, d: number) => sample(B + 50 + d, B + k) }, // east
      { at: (k: number, d: number) => sample(B + k, B - d) }, // north
      { at: (k: number, d: number) => sample(B + k, B + 50 + d) }, // south
    ]
    let seamKink = 0
    let measuredKink = 0
    for (const { at } of sides) {
      for (let k = 0; k <= 50; k++) {
        const kink = (d: number) => Math.abs(at(k, d + 1) - at(k, d) - (at(k, d) - at(k, d - 1)))
        seamKink = Math.max(seamKink, kink(0))
        measuredKink = Math.max(measuredKink, kink(-1), kink(-2))
      }
    }
    // The change of slope across the seam stays within what the measured surface itself does next to it.
    expect(seamKink).toBeLessThanOrEqual(measuredKink)
  })

  test('the outer ring is procedural terrain, not a flat apron or a frozen extrapolation', () => {
    const flat = createMarsTerrainScenery(syntheticMarsTerrain({ elevationAt: () => -1000 }))
    const flatSample = (col: number, row: number) => flat.elevation!.samplesMeters[cornerIndex(SIZE, col, row)]
    // Seam: exactly the measured value.
    expect(flatSample(B, B + 20)).toBe(-1000)
    expect(flatSample(B - 1, B + 20)).toBeCloseTo(-1000, 0)
    // Outer edge: varied procedural relief.
    const outer = Array.from({ length: SIZE + 1 }, (_, k) => flatSample(0, k))
    expect(Math.max(...outer) - Math.min(...outer)).toBeGreaterThan(0.5)
  })

  test('is deterministic and classified as game art', () => {
    expect(createMarsTerrainScenery(payload)).toEqual(map)
    expect(map.classification).toBe('procedural')
    expect(map.cells.some((cell) => cell.feature !== 'none')).toBe(true)
  })
})
