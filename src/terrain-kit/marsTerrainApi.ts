import { MarsTerrainDataError, parseMarsTerrainData, type MarsTerrainDataV1 } from './marsTerrainContract'

/** Path of the backend route `GET /v1/mars-terrain/{seed}` (server: internal/terrain). */
export const MARS_TERRAIN_ENDPOINT = '/v1/mars-terrain'

/** The backend accepts any canonical decimal uint32 seed. */
const MAX_SEED = 0xffffffff

/**
 * The terrain could not be retrieved: the request failed before a response
 * (`status` is `null`) or the backend answered with a non-2xx `status`.
 * A response that arrives but breaks the contract is a {@link MarsTerrainDataError}.
 */
export class MarsTerrainRequestError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MarsTerrainRequestError'
    this.status = status
  }
}

export interface FetchMarsTerrainOptions {
  signal?: AbortSignal
  /**
   * Origin (and optional path prefix) of the backend, e.g. `https://api.example`.
   * Defaults to `''`: same origin, which the Vite dev server proxies to the Go server.
   */
  baseUrl?: string
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
}

/**
 * Fetches the real Mars terrain the backend picks for `seed` and validates it
 * against the v1 contract. Rejects with a {@link MarsTerrainRequestError} when
 * the backend cannot be reached or refuses the request, a
 * {@link MarsTerrainDataError} when the payload is invalid, and the fetch's own
 * `AbortError` when `signal` aborts.
 */
export async function fetchMarsTerrain(seed: number, options: FetchMarsTerrainOptions = {}): Promise<MarsTerrainDataV1> {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`Mars terrain seed must be an integer in [0, ${MAX_SEED}], got ${seed}`)
  }
  const { signal, fetchImpl = fetch, baseUrl = '' } = options
  const url = `${baseUrl.trim().replace(/\/+$/, '')}${MARS_TERRAIN_ENDPOINT}/${seed}`

  let response: Response
  try {
    response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new MarsTerrainRequestError('Mars terrain service unreachable', null, { cause: error })
  }
  if (!response.ok) {
    throw new MarsTerrainRequestError(`Mars terrain service answered HTTP ${response.status}`, response.status)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    throw new MarsTerrainDataError(['response body is not valid JSON'])
  }
  const data = parseMarsTerrainData(payload)
  if (data.seed !== seed) throw new MarsTerrainDataError([`seed ${data.seed} does not match the requested seed ${seed}`])
  return data
}
