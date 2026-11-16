import { describe, expect, test } from 'bun:test'
import {
  MARS_MEAN_RADIUS_METERS,
  MAX_MAP_LATITUDE_DEGREES,
  geographicToLocal,
  localToGeographic,
} from '../../src/terrain-kit/marsCoordinates'
import { parseMarsTerrainData } from '../../src/terrain-kit/marsTerrainContract'
import { syntheticMarsTerrain } from './syntheticMarsTerrain'

const center = { latitude: -4.5, longitudeEast: 137.4 }

describe('geographic ↔ local metres', () => {
  test('the centre is the origin', () => {
    const local = geographicToLocal(center, center)
    expect(local.east).toBeCloseTo(0, 12)
    expect(local.north).toBeCloseTo(0, 12)
  })

  test('one degree of latitude is 2πR / 360 metres north', () => {
    const local = geographicToLocal({ latitude: center.latitude + 1, longitudeEast: center.longitudeEast }, center)
    expect(local.north).toBeCloseTo((2 * Math.PI * MARS_MEAN_RADIUS_METERS) / 360, 6)
  })

  test('round-trips within the map', () => {
    const back = geographicToLocal(localToGeographic({ east: 250, north: -175 }, center), center)
    expect(back.east).toBeCloseTo(250, 6)
    expect(back.north).toBeCloseTo(-175, 6)
  })

  test('crosses the 0°/360° meridian, keeping longitudes in [0, 360)', () => {
    const nearZero = { latitude: 0, longitudeEast: 359.999 }
    const local = geographicToLocal({ latitude: 0, longitudeEast: 0.001 }, nearZero)
    expect(local.east).toBeGreaterThan(0)
    expect(local.east).toBeCloseTo(0.002 * (Math.PI / 180) * MARS_MEAN_RADIUS_METERS, 6)
    expect(localToGeographic({ east: local.east, north: 0 }, nearZero).longitudeEast).toBeCloseTo(0.001, 9)
  })

  test('crosses the meridian westward too', () => {
    const justEast = { latitude: 10, longitudeEast: 0.001 }
    const local = geographicToLocal({ latitude: 10, longitudeEast: 359.999 }, justEast)
    expect(local.east).toBeLessThan(0)
    expect(localToGeographic(local, justEast).longitudeEast).toBeCloseTo(359.999, 9)
  })
})

describe('high latitudes', () => {
  test('east distances shrink with cos(latitude) and still round-trip', () => {
    const north = { latitude: 80, longitudeEast: 200 }
    const local = geographicToLocal({ latitude: 80, longitudeEast: 200.01 }, north)
    expect(local.east).toBeCloseTo(0.01 * (Math.PI / 180) * MARS_MEAN_RADIUS_METERS * Math.cos((80 * Math.PI) / 180), 6)
    const back = geographicToLocal(localToGeographic({ east: -250, north: 250 }, north), north)
    expect(back.east).toBeCloseTo(-250, 6)
    expect(back.north).toBeCloseTo(250, 6)
  })

  test('accepts centres up to the limit and rejects polar centres', () => {
    const limit = { latitude: -MAX_MAP_LATITUDE_DEGREES, longitudeEast: 10 }
    expect(Number.isFinite(localToGeographic({ east: 250, north: 250 }, limit).longitudeEast)).toBe(true)
    for (const latitude of [85.01, 90, -90]) {
      expect(() => localToGeographic({ east: 1, north: 0 }, { latitude, longitudeEast: 0 })).toThrow(RangeError)
      expect(() => geographicToLocal({ latitude: 0, longitudeEast: 0 }, { latitude, longitudeEast: 0 })).toThrow(RangeError)
    }
  })

  test('the contract rejects polar map centres', () => {
    expect(() => parseMarsTerrainData(syntheticMarsTerrain({ center: { latitude: 88, longitudeEast: 0 } }))).toThrow('center.latitude must be in [-85, 85]')
  })
})

describe('invalid conversions', () => {
  test('non-finite or out-of-range inputs throw instead of returning NaN', () => {
    expect(() => geographicToLocal({ latitude: Number.NaN, longitudeEast: 0 }, center)).toThrow(RangeError)
    expect(() => geographicToLocal({ latitude: 91, longitudeEast: 0 }, center)).toThrow(RangeError)
    expect(() => geographicToLocal(center, { latitude: 0, longitudeEast: Number.POSITIVE_INFINITY })).toThrow(RangeError)
    expect(() => localToGeographic({ east: Number.NaN, north: 0 }, center)).toThrow(RangeError)
  })
})
