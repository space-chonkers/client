/**
 * TEMPORARY client-side resource simulator for the HUD sandbox.
 *
 * The Go WebSocket server is authoritative over resources: this module must be
 * REPLACED by authoritative server `resources` snapshots (`match.state` /
 * `match.frame` / `base.build` / `stash.collect`) once connected. The costs
 * and yields below are placeholders, not confirmed game rules.
 */
import { MAX_RESOURCE_CAPACITY, type ResourceBarValues } from './ResourceBar'

/** Placeholder cost deducted from the resource bar on every build. */
export const SIMULATED_BUILD_COST: Partial<ResourceBarValues> = { energy: 5, oxygen: 2 }

/** Placeholder Stash output moved into the shared pool on every collect. */
export const SIMULATED_COLLECT_YIELD: Partial<ResourceBarValues> = {
  oxygen: 5,
  water: 5,
  energy: 5,
  food: 5,
}

/** Applies a delta to each listed resource, keeping every value within `0..MAX_RESOURCE_CAPACITY`. */
export function applyResourceDelta(
  resources: ResourceBarValues,
  delta: Partial<ResourceBarValues>,
  direction: 1 | -1,
): ResourceBarValues {
  const next = { ...resources }
  for (const key of Object.keys(delta) as (keyof ResourceBarValues)[]) {
    const amount = direction * (delta[key] ?? 0)
    next[key] = Math.min(MAX_RESOURCE_CAPACITY, Math.max(0, resources[key] + amount))
  }
  return next
}
