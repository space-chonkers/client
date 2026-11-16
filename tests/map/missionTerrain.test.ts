import { describe, expect, spyOn, test } from 'bun:test'
import {
  launchMission,
  loadMissionTerrain,
  resolveMissionTerrainConfig,
  type MissionTerrain,
  type MissionTerrainConfig,
} from '../../src/game/map/missionTerrain'
import { syntheticMarsTerrain } from '../terrain/syntheticMarsTerrain'

const SEED = 42
const realConfig: MissionTerrainConfig = { source: 'mars', seed: SEED, apiBaseUrl: '' }

/** A synthetic (not NASA) payload for the requested seed. */
const payloadFor = (seed: number) => ({ ...syntheticMarsTerrain(), seed })
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fetch stub whose response is released manually, so tests control when the terrain arrives. */
function deferredFetch() {
  const calls: { url: string; signal: AbortSignal | null | undefined }[] = []
  let release: (response: Response) => void = () => {}
  const fetchImpl = (url: string, init: RequestInit) => {
    calls.push({ url, signal: init.signal })
    return new Promise<Response>((resolve, reject) => {
      release = resolve
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new DOMException('Aborted', 'AbortError')))
    })
  }
  return { calls, fetchImpl, respond: (response: Response) => release(response) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const quietly = () => [spyOn(console, 'warn').mockImplementation(() => {}), spyOn(console, 'error').mockImplementation(() => {})]

describe('resolveMissionTerrainConfig', () => {
  test('development requests real terrain through the Vite proxy, seed 42', () => {
    expect(resolveMissionTerrainConfig({ dev: true })).toEqual({ source: 'mars', seed: 42, apiBaseUrl: '' })
  })

  test('development query picks the source and seed; invalid values are ignored', () => {
    expect(resolveMissionTerrainConfig({ dev: true, search: '?terrain=procedural&terrainSeed=6' })).toEqual({ source: 'procedural', seed: 6, apiBaseUrl: '' })
    expect(resolveMissionTerrainConfig({ dev: true, search: '?terrain=nasa&terrainSeed=-1' })).toEqual({ source: 'mars', seed: 42, apiBaseUrl: '' })
    expect(resolveMissionTerrainConfig({ dev: true, search: '?terrainSeed=4294967296' }).seed).toBe(42)
    expect(resolveMissionTerrainConfig({ dev: true, search: '?terrainSeed=4294967295' }).seed).toBe(4294967295)
  })

  test('production without an API URL stays procedural and ignores the query', () => {
    expect(resolveMissionTerrainConfig({ dev: false, apiBaseUrl: '', search: '?terrain=mars&terrainSeed=6' })).toEqual({
      source: 'procedural',
      seed: 42,
      apiBaseUrl: '',
    })
  })

  test('production with an API URL requests real terrain from it', () => {
    expect(resolveMissionTerrainConfig({ dev: false, apiBaseUrl: ' https://api.example/ ' })).toEqual({
      source: 'mars',
      seed: 42,
      apiBaseUrl: 'https://api.example/',
    })
  })
})

describe('loadMissionTerrain', () => {
  test('real terrain: fetched from the configured backend and validated', async () => {
    const urls: string[] = []
    const terrain = await loadMissionTerrain(
      { ...realConfig, apiBaseUrl: 'https://api.example/' },
      { fetchImpl: async (url) => (urls.push(url), jsonResponse(payloadFor(SEED))) },
    )
    expect(urls).toEqual(['https://api.example/v1/mars-terrain/42'])
    expect(terrain.source).toBe('mars')
    expect(terrain.source === 'mars' && terrain.data.seed).toBe(SEED)
  })

  test('procedural source sends no request', async () => {
    let requests = 0
    const terrain = await loadMissionTerrain({ ...realConfig, source: 'procedural' }, { fetchImpl: async () => (requests++, jsonResponse({})) })
    expect(terrain).toEqual({ source: 'procedural', seed: SEED })
    expect(requests).toBe(0)
  })

  test.each([
    ['unreachable backend', async () => Promise.reject(new TypeError('Failed to fetch')), 'terrain service unreachable'],
    ['backend down behind the dev proxy', async () => new Response('', { status: 500 }), 'terrain service answered HTTP 500'],
    ['catalog unavailable', async () => new Response('Mars terrain catalog unavailable', { status: 503 }), 'terrain service answered HTTP 503'],
    ['invalid payload', async () => jsonResponse({ ...payloadFor(SEED), version: 2 }), 'invalid terrain data'],
    ['HTML instead of JSON (static server without a route)', async () => new Response('<!doctype html>', { status: 200 }), 'invalid terrain data'],
  ] as const)('%s → procedural fallback with a reason', async (_, fetchImpl, reason) => {
    const [warn, error] = quietly()
    const terrain = await loadMissionTerrain(realConfig, { fetchImpl })
    expect(terrain).toEqual({ source: 'procedural', seed: SEED, fallbackReason: reason })
    warn.mockRestore()
    error.mockRestore()
  })

  test('a backend that never answers falls back after the timeout', async () => {
    const [warn] = quietly()
    const { fetchImpl, calls } = deferredFetch()
    const terrain = await loadMissionTerrain(realConfig, { fetchImpl, timeoutMs: 20 })
    expect(terrain).toEqual({ source: 'procedural', seed: SEED, fallbackReason: 'terrain service timed out' })
    expect(calls[0].signal?.aborted).toBe(true)
    warn.mockRestore()
  })

  test('leaving the mission aborts the request and rejects instead of falling back', async () => {
    const { fetchImpl, calls } = deferredFetch()
    const controller = new AbortController()
    const pending = loadMissionTerrain(realConfig, { fetchImpl, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeDefined()
    expect(calls[0].signal?.aborted).toBe(true)
  })
})

describe('launchMission lifecycle', () => {
  function sceneFactory() {
    const created: MissionTerrain[] = []
    let disposed = 0
    return {
      created,
      disposed: () => disposed,
      createScene: (terrain: MissionTerrain) => {
        created.push(terrain)
        return { dispose: () => disposed++ }
      },
    }
  }

  test('creates the scene from real terrain only after it arrives, and disposes it on stop', async () => {
    const { fetchImpl, respond } = deferredFetch()
    const scenes = sceneFactory()
    const reported: MissionTerrain[] = []
    const stop = launchMission(realConfig, { fetchImpl, createScene: scenes.createScene, onTerrain: (t) => reported.push(t) })

    await settle()
    expect(scenes.created).toHaveLength(0)
    respond(jsonResponse(payloadFor(SEED)))
    await settle()
    await settle()
    expect(scenes.created.map((t) => t.source)).toEqual(['mars'])
    expect(reported).toEqual(scenes.created)

    stop()
    expect(scenes.disposed()).toBe(1)
    stop()
    expect(scenes.disposed()).toBe(1)
  })

  test('backend down: the mission starts on procedural terrain and says why', async () => {
    const [warn] = quietly()
    const scenes = sceneFactory()
    const stop = launchMission(realConfig, { fetchImpl: async () => new Response('', { status: 500 }), createScene: scenes.createScene })
    await settle()
    await settle()
    expect(scenes.created).toEqual([{ source: 'procedural', seed: SEED, fallbackReason: 'terrain service answered HTTP 500' }])
    stop()
    warn.mockRestore()
  })

  test('leaving before the terrain arrives cancels the request; a late response creates nothing', async () => {
    const { fetchImpl, calls, respond } = deferredFetch()
    const scenes = sceneFactory()
    const stop = launchMission(realConfig, { fetchImpl, createScene: scenes.createScene })
    await settle()
    stop()
    expect(calls[0].signal?.aborted).toBe(true)
    respond(jsonResponse(payloadFor(SEED)))
    await settle()
    await settle()
    expect(scenes.created).toHaveLength(0)
    expect(scenes.disposed()).toBe(0)
  })

  test('a scene that cannot be built from real terrain is rebuilt on procedural terrain', async () => {
    const [, error] = quietly()
    const created: MissionTerrain[] = []
    const stop = launchMission(realConfig, {
      fetchImpl: async () => jsonResponse(payloadFor(SEED)),
      createScene: (terrain) => {
        if (terrain.source === 'mars') throw new Error('WebGL context lost')
        created.push(terrain)
        return { dispose: () => {} }
      },
    })
    await settle()
    await settle()
    expect(created).toEqual([{ source: 'procedural', seed: SEED, fallbackReason: 'real terrain could not be built' }])
    stop()
    error.mockRestore()
  })
})
