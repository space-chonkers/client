// Contract between client and server for the economy (plain objects, JSON over WebSocket).
// Any change here must be agreed with the backend team.
//
// Flow: the shared Stash generates each resource over time -> any player interacts with a
// resource's section -> the server converts that resource into money -> money goes to the Pool.

export const RESOURCES = ['food', 'water', 'energy', 'oxygen'] as const
export type ResourceType = (typeof RESOURCES)[number]
export type ResourceAmounts = Record<ResourceType, number>

/** One Stash for the whole team, one slot per resource. Anyone can collect from it. */
export interface StashState {
  /** Generated, not yet collected. May be fractional. */
  stored: ResourceAmounts
  capacities: ResourceAmounts
  productionPerSecond: ResourceAmounts
}

/**
 * Team money. Filled by collecting the Stash, spent by base maintenance, events and upgrades.
 * Maintenance per second = baseTiles * upkeepPerTilePerSecond: the bigger the base, the more it costs.
 */
export interface PoolState {
  money: number
  /** Base.constructedTileCount() on the server. */
  baseTiles: number
  upkeepPerTilePerSecond: number
}

/**
 * Money earned per unit of each resource when collected.
 * Set by the server; the more indispensable the resource, the higher its rate.
 */
export type ConversionRates = ResourceAmounts

// ---- server -> client ----

export interface EconomySnapshotMessage {
  type: 'economy.snapshot'
  tick: number
  stash: StashState
  pool: PoolState
  conversionRates: ConversionRates
}

/** Sent after a successful collection, so the client can show feedback (toast, animation). */
export interface StashCollectedMessage {
  type: 'stash.collected'
  resource: ResourceType
  units: number
  money: number
}

export interface EconomyRejectedMessage {
  type: 'economy.rejected'
  reason: string
}

export type ServerMessage = EconomySnapshotMessage | StashCollectedMessage | EconomyRejectedMessage

// ---- client -> server (intents; the server decides) ----

/** A player interacted with a resource's section. Sent by the player interaction code. */
export interface CollectIntent {
  type: 'stash.collect'
  resource: ResourceType
}

export type ClientMessage = CollectIntent
