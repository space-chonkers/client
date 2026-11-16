import { describe, expect, test } from 'bun:test'
import { MarsTerrainRequestError, fetchMarsTerrain } from '../../src/terrain-kit/marsTerrainApi'
import { MarsTerrainDataError, createReliefMapFromMarsTerrain, type MarsTerrainDataV1 } from '../../src/terrain-kit/marsTerrainContract'
import { UNCLASSIFIED } from '../../src/terrain-kit/reliefMap'
import { syntheticMarsTerrain } from './syntheticMarsTerrain'

/** A synthetic payload shaped like the backend's: seed echoed, HiRISE-style product ID (fake). */
function syntheticResponseFor(seed: number): MarsTerrainDataV1 {
  const data = syntheticMarsTerrain()
  return { ...data, seed, source: { ...data.source, productId: 'SYNTHETIC_PRODUCT_ID' } }
}

/** A fetch stub that records the request and answers with `respond()`. */
function stubFetch(respond: () => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return respond()
  }
  return { calls, fetchImpl }
}

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('promise resolved')
}

describe('fetchMarsTerrain: successful fetch', () => {
  test('requests the seed from the terrain route and returns the validated payload', async () => {
    const payload = syntheticResponseFor(42)
    const { calls, fetchImpl } = stubFetch(() => jsonResponse(payload))

    const data = await fetchMarsTerrain(42, { fetchImpl })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/v1/mars-terrain/42')
    expect(data).toEqual(payload)
  })

  test('a configured backend origin prefixes the route (trailing slashes ignored)', async () => {
    const { calls, fetchImpl } = stubFetch(() => jsonResponse(syntheticResponseFor(42)))
    await fetchMarsTerrain(42, { fetchImpl, baseUrl: 'https://api.example//' })
    await fetchMarsTerrain(42, { fetchImpl, baseUrl: '/' })
    expect(calls.map((call) => call.url)).toEqual(['https://api.example/v1/mars-terrain/42', '/v1/mars-terrain/42'])
  })

  test('the largest uint32 seed is accepted', async () => {
    const { calls, fetchImpl } = stubFetch(() => jsonResponse(syntheticResponseFor(4294967295)))
    await fetchMarsTerrain(4294967295, { fetchImpl })
    expect(calls[0].url).toBe('/v1/mars-terrain/4294967295')
  })

  test('the fetched terrain converts to an unclassified map that keeps its provenance', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(syntheticResponseFor(7)))

    const map = createReliefMapFromMarsTerrain(await fetchMarsTerrain(7, { fetchImpl }))

    expect(map.classification).toBe('none')
    expect(map.cells.every((cell) => cell.geology === UNCLASSIFIED && cell.region === UNCLASSIFIED && cell.feature === 'none')).toBe(true)
    expect(map.elevation?.geo?.center).toEqual({ latitude: -4.5, longitudeEast: 137.4 })
    expect(map.elevation?.geo?.provenance.productId).toBe('SYNTHETIC_PRODUCT_ID')
  })
})

describe('fetchMarsTerrain: invalid payloads', () => {
  test('a contract violation rejects with every issue listed', async () => {
    const payload = syntheticResponseFor(42)
    const samplesMeters = [...payload.elevation.samplesMeters]
    samplesMeters[5] = null
    const broken = { ...payload, version: 2, elevation: { ...payload.elevation, samplesMeters } }
    const { fetchImpl } = stubFetch(() => jsonResponse(broken))

    const error = await rejectionOf(fetchMarsTerrain(42, { fetchImpl }))

    expect(error).toBeInstanceOf(MarsTerrainDataError)
    expect((error as MarsTerrainDataError).issues).toEqual([
      'unsupported version 2 (expected 1)',
      '1 elevation samples are NoData or not finite (first at index 5: row 0, column 5)',
    ])
  })

  test('a body that is not JSON is an invalid payload', async () => {
    const { fetchImpl } = stubFetch(() => Promise.resolve(new Response('<html>proxy page</html>', { status: 200 })))

    const error = await rejectionOf(fetchMarsTerrain(42, { fetchImpl }))

    expect(error).toBeInstanceOf(MarsTerrainDataError)
    expect((error as MarsTerrainDataError).issues).toEqual(['response body is not valid JSON'])
  })

  test('terrain for a different seed is rejected', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(syntheticResponseFor(43)))

    const error = await rejectionOf(fetchMarsTerrain(42, { fetchImpl }))

    expect(error).toBeInstanceOf(MarsTerrainDataError)
    expect((error as MarsTerrainDataError).issues).toEqual(['seed 43 does not match the requested seed 42'])
  })
})

describe('fetchMarsTerrain: network and backend failures', () => {
  test('an unreachable backend rejects with a request error without a status', async () => {
    const cause = new TypeError('Failed to fetch')
    const { fetchImpl } = stubFetch(() => Promise.reject(cause))

    const error = await rejectionOf(fetchMarsTerrain(42, { fetchImpl }))

    expect(error).toBeInstanceOf(MarsTerrainRequestError)
    expect((error as MarsTerrainRequestError).status).toBeNull()
    expect((error as MarsTerrainRequestError).cause).toBe(cause)
  })

  test.each([400, 500, 503])('HTTP %d rejects with that status', async (status) => {
    const { fetchImpl } = stubFetch(() => Promise.resolve(new Response('Mars terrain catalog unavailable', { status })))

    const error = await rejectionOf(fetchMarsTerrain(42, { fetchImpl }))

    expect(error).toBeInstanceOf(MarsTerrainRequestError)
    expect((error as MarsTerrainRequestError).status).toBe(status)
  })

  test('an aborted request rejects with the abort error, not a request error', async () => {
    const controller = new AbortController()
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    const { fetchImpl } = stubFetch(() => {
      controller.abort()
      return Promise.reject(abort)
    })

    expect(await rejectionOf(fetchMarsTerrain(42, { fetchImpl, signal: controller.signal }))).toBe(abort)
  })

  test.each([-1, 1.5, 4294967296, Number.NaN])('seed %p is refused before any request', async (seed) => {
    const { calls, fetchImpl } = stubFetch(() => jsonResponse(syntheticResponseFor(0)))

    expect(await rejectionOf(fetchMarsTerrain(seed, { fetchImpl }))).toBeInstanceOf(RangeError)
    expect(calls).toHaveLength(0)
  })
})
