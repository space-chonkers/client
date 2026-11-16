import { MarsTerrainRequestError, fetchMarsTerrain, type FetchMarsTerrainOptions } from '../../terrain-kit/marsTerrainApi'
import { MarsTerrainDataError, type MarsTerrainDataV1 } from '../../terrain-kit/marsTerrainContract'
import { DEFAULT_FALLBACK_SEED } from './MarsMapLayer'

/** Layer −1 source for a mission: real HiRISE elevation from the backend, or seeded procedural relief. */
export type MissionTerrainSource = 'mars' | 'procedural'

export interface MissionTerrainConfig {
  /** Source to try first. */
  source: MissionTerrainSource
  /**
   * Picks the HiRISE window and seeds procedural terrain. Fixed client-side
   * (`DEFAULT_FALLBACK_SEED`) until match state carries a terrain seed.
   */
  seed: number
  /** Backend origin for the terrain route; `''` is same origin (the Vite dev proxy). */
  apiBaseUrl: string
}

/** The terrain a mission scene is built from. */
export type MissionTerrain =
  | { source: 'mars'; seed: number; data: MarsTerrainDataV1 }
  | {
      source: 'procedural'
      seed: number
      /** Set when real terrain was requested but could not be used: a short, user-facing reason. */
      fallbackReason?: string
    }

/** Longest wait for the terrain service before the mission starts on procedural terrain. */
export const MISSION_TERRAIN_TIMEOUT_MS = 8000

const MAX_SEED = 0xffffffff

export interface MissionTerrainEnvironment {
  /** `import.meta.env.DEV`. */
  dev: boolean
  /** `import.meta.env.VITE_MARS_TERRAIN_API_URL`, baked in at build time. */
  apiBaseUrl?: string
  /** `window.location.search`; read only in development. */
  search?: string
}

/**
 * Picks the mission terrain source. Development always reaches the backend
 * through the Vite proxy, so it requests real terrain unless `?terrain=procedural`;
 * `?terrainSeed=N` picks another seed. Production builds request real terrain
 * only when `VITE_MARS_TERRAIN_API_URL` was set (static Nginx has no proxy),
 * and ignore the query.
 */
export function resolveMissionTerrainConfig({ dev, apiBaseUrl = '', search = '' }: MissionTerrainEnvironment): MissionTerrainConfig {
  const base = apiBaseUrl.trim()
  const config: MissionTerrainConfig = {
    source: dev || base !== '' ? 'mars' : 'procedural',
    seed: DEFAULT_FALLBACK_SEED,
    apiBaseUrl: base,
  }
  if (!dev) return config

  const params = new URLSearchParams(search)
  const source = params.get('terrain')
  if (source === 'mars' || source === 'procedural') config.source = source
  const seed = params.get('terrainSeed')
  if (seed !== null && /^\d{1,10}$/.test(seed) && Number(seed) <= MAX_SEED) config.seed = Number(seed)
  return config
}

export interface LoadMissionTerrainOptions {
  /** Aborted when the mission is left; the load then rejects with the abort error. */
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: FetchMarsTerrainOptions['fetchImpl']
}

/** Short reason shown to the player when real terrain is replaced by procedural terrain. */
function fallbackReasonFor(error: unknown, timedOut: boolean): string {
  if (timedOut) return 'terrain service timed out'
  if (error instanceof MarsTerrainRequestError) {
    return error.status === null ? 'terrain service unreachable' : `terrain service answered HTTP ${error.status}`
  }
  if (error instanceof MarsTerrainDataError) return 'invalid terrain data'
  return 'unexpected error'
}

/**
 * Resolves the terrain for a mission. Real terrain that fails (unreachable,
 * HTTP error, invalid payload, timeout) resolves to procedural terrain with a
 * `fallbackReason`, so the mission never waits indefinitely. Rejects only when
 * `signal` aborts, i.e. the mission was left before the terrain arrived.
 */
export async function loadMissionTerrain(config: MissionTerrainConfig, options: LoadMissionTerrainOptions = {}): Promise<MissionTerrain> {
  const { signal, timeoutMs = MISSION_TERRAIN_TIMEOUT_MS, fetchImpl } = options
  signal?.throwIfAborted()
  if (config.source === 'procedural') return { source: 'procedural', seed: config.seed }

  const request = new AbortController()
  let timedOut = false
  const abortRequest = () => request.abort(signal?.reason)
  signal?.addEventListener('abort', abortRequest, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    request.abort()
  }, timeoutMs)

  try {
    const data = await fetchMarsTerrain(config.seed, { signal: request.signal, baseUrl: config.apiBaseUrl, fetchImpl })
    return { source: 'mars', seed: config.seed, data }
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn(`Real Mars terrain unavailable for seed ${config.seed}; using procedural terrain`, error)
    return { source: 'procedural', seed: config.seed, fallbackReason: fallbackReasonFor(error, timedOut) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortRequest)
  }
}

export interface MissionScene {
  dispose(): void
}

export interface LaunchMissionOptions extends Omit<LoadMissionTerrainOptions, 'signal'> {
  /** Builds the scene once the terrain is known. */
  createScene: (terrain: MissionTerrain) => MissionScene
  /** Reports the terrain the scene was actually built from. */
  onTerrain?: (terrain: MissionTerrain) => void
}

/**
 * Mission lifecycle: load the terrain, then create the scene that depends on
 * it. Returns `stop`, for unmount or mission exit: it cancels a pending
 * request (a late response is ignored and no scene is created) or disposes
 * the scene. If the scene cannot be built from real terrain, it is built
 * from procedural terrain instead.
 */
export function launchMission(config: MissionTerrainConfig, options: LaunchMissionOptions): () => void {
  const { createScene, onTerrain, ...loadOptions } = options
  const controller = new AbortController()
  let scene: MissionScene | null = null

  const start = (terrain: MissionTerrain) => {
    scene = createScene(terrain)
    onTerrain?.(terrain)
  }

  loadMissionTerrain(config, { ...loadOptions, signal: controller.signal })
    .then((terrain) => {
      if (controller.signal.aborted) return
      if (terrain.source === 'procedural') return start(terrain)
      try {
        start(terrain)
      } catch (error) {
        console.error(`Could not build the mission from real Mars terrain (seed ${terrain.seed}); using procedural terrain`, error)
        start({ source: 'procedural', seed: terrain.seed, fallbackReason: 'real terrain could not be built' })
      }
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return
      console.error('Failed to start the mission scene', error)
    })

  return () => {
    controller.abort()
    scene?.dispose()
    scene = null
  }
}
