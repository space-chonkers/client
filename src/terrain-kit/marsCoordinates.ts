import type { MarsCoordinate } from './elevation'

/**
 * Coordinate conventions of a real-elevation map, and the geographic ↔ local
 * conversion. Pure math with no Three.js dependency.
 *
 * 1. Geographic: planetocentric latitude [-90, 90] and east-positive
 *    longitude [0, 360), in degrees (`MarsCoordinate`).
 * 2. Local: metres east and north of the map centre, on a plane tangent to
 *    Mars at the centre (`LocalPoint`).
 * 3. Grid: continuous cell coordinates; cell (col, row) spans [col, col + 1)
 *    × [row, row + 1), col 0 on the west edge, row 0 on the north edge.
 * 4. World (Three.js): X east, Z south (north is −Z), Y up; the map is
 *    centred on the origin and one cell is `cellSize` world units.
 *
 * Local ↔ geographic is a local equirectangular mapping on a sphere of
 * radius `MARS_MEAN_RADIUS_METERS`, centred on the map centre (φ0, λ0):
 *   east  = Δλ · R · cos φ0      north = Δφ · R      (angles in radians)
 * This is the contract's horizontal convention, not just a client
 * approximation: the backend must place each elevation sample with the same
 * formulas and radius (docs/mars_terrain_contract.md §3), so both sides agree
 * exactly. Against true distances on Mars it is approximate: Mars is ~0.6%
 * oblate, and the flat-map term grows with latitude, about
 * |east| · |north| · tan|φ0| / R (≈ 1.5 mm at 4.5°, 3 cm at 60° and 21 cm at
 * 85° for a corner 250 m east and north). Centres beyond
 * `MAX_MAP_LATITUDE_DEGREES` are rejected: near the poles cos φ0 → 0, so
 * longitudes blow up and "north-up" stops being meaningful.
 */

/** IAU mean radius of Mars, in metres; the sphere radius of the horizontal convention. */
export const MARS_MEAN_RADIUS_METERS = 3_389_500

/**
 * Highest |latitude| a map centre may have. At 85° the flat-map error stays
 * near 2% of a 10 m cell; polar maps would need a polar projection (a future
 * contract version).
 */
export const MAX_MAP_LATITUDE_DEGREES = 85

export interface LocalPoint {
  /** Metres east of the map centre. */
  readonly east: number
  /** Metres north of the map centre. */
  readonly north: number
}

const RADIANS = Math.PI / 180

/** Throws a `RangeError` for a centre the local mapping cannot represent. */
function assertMapCenter(center: MarsCoordinate): void {
  if (!Number.isFinite(center.latitude) || Math.abs(center.latitude) > MAX_MAP_LATITUDE_DEGREES) {
    throw new RangeError(`Map centre latitude must be in [-${MAX_MAP_LATITUDE_DEGREES}, ${MAX_MAP_LATITUDE_DEGREES}], got ${center.latitude}`)
  }
  if (!Number.isFinite(center.longitudeEast)) throw new RangeError(`Map centre longitude must be finite, got ${center.longitudeEast}`)
}

/** Signed shortest longitude difference in degrees, in [-180, 180), so maps across 0°/360° work. */
function longitudeDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

export function geographicToLocal(point: MarsCoordinate, center: MarsCoordinate): LocalPoint {
  assertMapCenter(center)
  if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitudeEast)) {
    throw new RangeError(`Invalid Mars coordinate (${point.latitude}, ${point.longitudeEast})`)
  }
  return {
    east: longitudeDelta(center.longitudeEast, point.longitudeEast) * RADIANS * MARS_MEAN_RADIUS_METERS * Math.cos(center.latitude * RADIANS),
    north: (point.latitude - center.latitude) * RADIANS * MARS_MEAN_RADIUS_METERS,
  }
}

export function localToGeographic(local: LocalPoint, center: MarsCoordinate): MarsCoordinate {
  assertMapCenter(center)
  if (!Number.isFinite(local.east) || !Number.isFinite(local.north)) throw new RangeError(`Invalid local point (${local.east}, ${local.north})`)
  const longitude = center.longitudeEast + local.east / (RADIANS * MARS_MEAN_RADIUS_METERS * Math.cos(center.latitude * RADIANS))
  return {
    latitude: center.latitude + local.north / (RADIANS * MARS_MEAN_RADIUS_METERS),
    longitudeEast: ((longitude % 360) + 360) % 360,
  }
}

/** World units per ground metre when one cell of `cellSizeMeters` is drawn `cellSize` world units wide. */
export const worldUnitsPerMeter = (cellSize: number, cellSizeMeters: number) => cellSize / cellSizeMeters
