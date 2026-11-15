import { describe, expect, test } from 'bun:test'
import { MockTransport } from '../net/mockTransport'
import { EconomyStore } from './EconomyStore'
import { applyUpkeep, collect, produce, secondsUntilBroke, upkeepPerSecond } from './rules'
import type { StashState } from './types'

describe('rules', () => {
  const stash: StashState = {
    stored: { food: 0, water: 0, energy: 0, oxygen: 0 },
    capacities: { food: 10, water: 10, energy: 10, oxygen: 10 },
    productionPerSecond: { food: 1.5, water: 1.5, energy: 1.5, oxygen: 1.5 },
  }
  const rates = { food: 3, water: 5, energy: 2, oxygen: 8 }

  test('collect converts whole units and keeps fractional leftovers', () => {
    const result = collect(produce(stash, 3), 'oxygen', rates) // 4.5 stored

    expect(result.units).toBe(4)
    expect(result.money).toBe(32)
    expect(result.stash.stored.oxygen).toBeCloseTo(0.5)
    expect(result.stash.stored.food).toBe(4.5) // other resources untouched
  })

  test('rules never mutate their inputs', () => {
    collect(produce(stash, 5), 'food', rates)
    expect(stash.stored.food).toBe(0)
  })

  test('maintenance grows with base size', () => {
    const small = { money: 100, baseTiles: 2, upkeepPerTilePerSecond: 0.5 }
    const big = { ...small, baseTiles: 10 }

    expect(upkeepPerSecond(small)).toBe(1)
    expect(upkeepPerSecond(big)).toBe(5)
    expect(applyUpkeep(big, 10).money).toBe(50)
    expect(secondsUntilBroke(big)).toBe(20)
  })

  test('maintenance never takes money below zero', () => {
    const pool = { money: 10, baseTiles: 4, upkeepPerTilePerSecond: 1 }
    expect(applyUpkeep(pool, 100).money).toBe(0)
  })
})

// Integration: mock server -> transport -> EconomyStore.
async function setup() {
  let server!: MockTransport
  const store = new EconomyStore((handlers) => (server = new MockTransport(handlers, { tickMs: 0 })))
  const disconnect = store.connect()
  await Promise.resolve() // let the mock deliver the first snapshot
  return { store, server, disconnect }
}

describe('economy', () => {
  test('receives the shared stash and the pool', async () => {
    const { store } = await setup()
    const { status, stash, pool } = store.getState()

    expect(status).toBe('open')
    expect(stash?.stored.food).toBe(0)
    expect(pool?.money).toBe(200)
  })

  test('server ticks generate the stash up to capacity and spend upkeep', async () => {
    const { store, server } = await setup()

    server.tick(10)
    expect(store.getState().stash?.stored.water).toBe(20)
    expect(store.getState().pool?.money).toBe(200 - 4 * 10)

    server.tick(100)
    expect(store.getState().stash?.stored.water).toBe(50)
    expect(store.getState().pool?.money).toBe(0)
  })

  test('collecting a resource converts it into pool money automatically', async () => {
    const { store, server } = await setup()
    server.tick(5) // 10 of each resource, pool at 180

    store.collect('oxygen')
    const { stash, pool, conversionRates, lastCollection } = store.getState()

    expect(pool?.money).toBe(180 + 10 * conversionRates!.oxygen)
    expect(stash?.stored.oxygen).toBe(0)
    expect(stash?.stored.food).toBe(10)
    expect(lastCollection).toMatchObject({ resource: 'oxygen', units: 10 })
  })

  test('a bigger base drains the pool faster', async () => {
    const { store, server } = await setup()

    server.setBaseTiles(10) // 10 tiles x 1/s
    server.tick(5)

    expect(store.getState().pool?.baseTiles).toBe(10)
    expect(store.getState().pool?.money).toBe(200 - 10 * 5)
  })

  test('more indispensable resources are worth more', async () => {
    const { store } = await setup()
    const rates = store.getState().conversionRates!

    expect(rates.oxygen).toBeGreaterThan(rates.water)
    expect(rates.water).toBeGreaterThan(rates.food)
    expect(rates.food).toBeGreaterThan(rates.energy)
  })

  test('collecting an empty resource is rejected and leaves money untouched', async () => {
    const { store } = await setup()

    store.collect('food')

    expect(store.getState().lastRejection).toContain('food')
    expect(store.getState().pool?.money).toBe(200)
  })

  test('disconnect closes the transport', async () => {
    const { store, disconnect } = await setup()
    disconnect()
    expect(store.getState().status).toBe('closed')
  })
})
