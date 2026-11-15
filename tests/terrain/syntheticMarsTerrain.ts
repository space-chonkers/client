import type { MarsTerrainDataV1 } from '../../src/terrain-kit/marsTerrainContract'

/**
 * SYNTHETIC test fixtures. Every elevation here is computed from a formula in
 * this file; none of it is NASA, HiRISE or any other real Mars data.
 */

/** Synthetic planar terrain: rises 2 m per column eastward and falls 3 m per row southward. */
export const syntheticPlane = (col: number, row: number) => -4000 + 2 * col - 3 * row

export interface SyntheticOptions {
  columns?: number
  rows?: number
  cellSizeMeters?: number
  elevationAt?: (col: number, row: number) => number
  center?: { latitude: number; longitudeEast: number }
}

/** A contract payload over a synthetic surface, sampled on cell corners. */
export function syntheticMarsTerrain({
  columns = 50,
  rows = 50,
  cellSizeMeters = 10,
  elevationAt = syntheticPlane,
  center = { latitude: -4.5, longitudeEast: 137.4 },
}: SyntheticOptions = {}): MarsTerrainDataV1 {
  const samplesMeters: number[] = []
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) samplesMeters.push(elevationAt(col, row))
  }
  return {
    version: 1,
    center,
    grid: { columns, rows, cellSizeMeters },
    elevation: { sampling: 'cell-corners', columns: columns + 1, rows: rows + 1, samplesMeters, datum: 'synthetic-test-datum' },
    source: { datasetId: 'synthetic-test-fixture', provider: 'space-chonkers tests (synthetic)', resolutionMeters: 1 },
    seed: 1234,
  }
}
