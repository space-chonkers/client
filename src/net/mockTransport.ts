import { applyUpkeep, collect, produce } from '../economy/rules'
import {
  RESOURCES,
  type ClientMessage,
  type ConversionRates,
  type PoolState,
  type ResourceAmounts,
  type ServerMessage,
  type StashState,
} from '../economy/types'
import type { GameTransport, TransportHandlers } from './transport'

// Placeholder numbers until the real values come from the server.
const STASH_CAPACITY = 50
const PRODUCTION_PER_SECOND = 2
const STARTING_MONEY = 200
const STARTING_BASE_TILES = 4
const UPKEEP_PER_TILE_PER_SECOND = 1
// The more indispensable for survival, the more it's worth:
// oxygen (minutes) > water (days) > food (weeks) > energy.
const CONVERSION_RATES: ConversionRates = { oxygen: 8, water: 5, food: 3, energy: 2 }

const fill = (value: number): ResourceAmounts =>
  Object.fromEntries(RESOURCES.map((r) => [r, value])) as ResourceAmounts

export interface MockOptions {
  /** Simulated tick interval. 0 disables the timer so tests can call tick() by hand. */
  tickMs?: number
}

/** Fake server for local development and tests. The real rules live in the server. */
export class MockTransport implements GameTransport {
  private tickCount = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private stash: StashState = {
    stored: fill(0),
    capacities: fill(STASH_CAPACITY),
    productionPerSecond: fill(PRODUCTION_PER_SECOND),
  }
  private pool: PoolState = {
    money: STARTING_MONEY,
    baseTiles: STARTING_BASE_TILES,
    upkeepPerTilePerSecond: UPKEEP_PER_TILE_PER_SECOND,
  }

  constructor(
    private readonly handlers: TransportHandlers,
    { tickMs = 1000 }: MockOptions = {},
  ) {
    // Async like a real socket, so callers finish wiring up before the first message.
    queueMicrotask(() => {
      handlers.onStatus('open')
      this.emitSnapshot()
    })
    if (tickMs > 0) this.timer = setInterval(() => this.tick(tickMs / 1000), tickMs)
  }

  tick(seconds: number): void {
    this.tickCount++
    this.stash = produce(this.stash, seconds)
    this.pool = applyUpkeep(this.pool, seconds)
    this.emitSnapshot()
  }

  /** Simulates the base growing or shrinking (expansion isn't wired to the economy yet). */
  setBaseTiles(tiles: number): void {
    this.pool = { ...this.pool, baseTiles: tiles }
    this.emitSnapshot()
  }

  send(message: ClientMessage): void {
    const { resource } = message
    if (!RESOURCES.includes(resource)) return this.reject(`Unknown resource ${resource}`)

    const result = collect(this.stash, resource, CONVERSION_RATES)
    if (result.units === 0) return this.reject(`No ${resource} to collect yet`)

    this.stash = result.stash
    this.pool = { ...this.pool, money: this.pool.money + result.money }
    this.emit({ type: 'stash.collected', resource, units: result.units, money: result.money })
    this.emitSnapshot()
  }

  close(): void {
    clearInterval(this.timer)
    this.handlers.onStatus('closed')
  }

  private reject(reason: string): void {
    this.emit({ type: 'economy.rejected', reason })
  }

  private emitSnapshot(): void {
    // Deep copy so the client never holds references to "server" state.
    this.emit(
      structuredClone({
        type: 'economy.snapshot',
        tick: this.tickCount,
        stash: this.stash,
        pool: this.pool,
        conversionRates: CONVERSION_RATES,
      }),
    )
  }

  private emit(message: ServerMessage): void {
    this.handlers.onMessage(message)
  }
}
