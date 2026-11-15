// Reference economy rules. The server is authoritative and owns the real implementation;
// the client uses these only in the mock server and as executable documentation for the
// backend team. All functions are pure: they return new objects and never mutate inputs.

import { RESOURCES, type ConversionRates, type PoolState, type ResourceType, type StashState } from './types'

/** Generates every resource for `seconds`, each capped at its capacity. */
export function produce(stash: StashState, seconds: number): StashState {
  const stored = { ...stash.stored }
  for (const r of RESOURCES) {
    stored[r] = Math.min(stored[r] + stash.productionPerSecond[r] * seconds, stash.capacities[r])
  }
  return { ...stash, stored }
}

export interface Collection {
  stash: StashState
  units: number
  money: number
}

/**
 * Takes the whole units of one resource out of the Stash and converts them into money.
 * Fractional leftovers stay in the Stash so no production is lost.
 */
export function collect(stash: StashState, resource: ResourceType, rates: ConversionRates): Collection {
  const units = Math.floor(stash.stored[resource])
  return {
    stash: { ...stash, stored: { ...stash.stored, [resource]: stash.stored[resource] - units } },
    units,
    money: units * rates[resource],
  }
}

/** Base maintenance cost per second: grows with the number of constructed tiles. */
export function upkeepPerSecond(pool: PoolState): number {
  return pool.baseTiles * pool.upkeepPerTilePerSecond
}

/** Spends base maintenance from the Pool. Money never goes below zero. */
export function applyUpkeep(pool: PoolState, seconds: number): PoolState {
  return { ...pool, money: Math.max(pool.money - upkeepPerSecond(pool) * seconds, 0) }
}

/** Seconds until the Pool runs out at the current upkeep (Infinity if it never does). */
export function secondsUntilBroke(pool: PoolState): number {
  const upkeep = upkeepPerSecond(pool)
  return upkeep > 0 ? pool.money / upkeep : Infinity
}
