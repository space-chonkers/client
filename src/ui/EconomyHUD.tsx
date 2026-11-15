import type { EconomyStore } from '../economy/EconomyStore'
import { secondsUntilBroke, upkeepPerSecond } from '../economy/rules'
import { RESOURCES, type ResourceType } from '../economy/types'
import { useEconomy } from '../economy/useEconomy'

/** Warn when the Pool will run out of money within this many seconds. */
const LOW_MONEY_SECONDS = 30

// Placeholder icons until Diego's resource icons land: swap `icon` for an <img> source.
const RESOURCE_META: Record<ResourceType, { label: string; icon: string }> = {
  food: { label: 'Food', icon: 'F' },
  water: { label: 'Water', icon: 'W' },
  energy: { label: 'Energy', icon: 'E' },
  oxygen: { label: 'Oxygen', icon: 'O' },
}

export default function EconomyHUD({ store }: { store: EconomyStore }) {
  const { status, stash, pool, conversionRates, lastCollection, lastRejection } = useEconomy(store)

  if (!stash || !pool || !conversionRates) {
    return <aside className="hud">{status === 'closed' ? 'Disconnected' : 'Connecting…'}</aside>
  }

  const isLow = secondsUntilBroke(pool) <= LOW_MONEY_SECONDS

  return (
    <aside className="hud" aria-label="Economy">
      {status !== 'open' && <p className="hud-status">Reconnecting… values may be stale</p>}
      {lastRejection && <p className="hud-status" role="alert">{lastRejection}</p>}
      {lastCollection && !lastRejection && (
        <p className="hud-status" role="status">
          +{lastCollection.money} money from {lastCollection.units} {lastCollection.resource}
        </p>
      )}

      <section className={isLow ? 'hud-pool hud-low' : 'hud-pool'}>
        <h2>Pool</h2>
        <span className="hud-money">{Math.floor(pool.money)} money</span>
        <span className="hud-rate">
          −{upkeepPerSecond(pool)}/s maintenance ({pool.baseTiles} tiles × {pool.upkeepPerTilePerSecond})
        </span>
        {isLow && <span className="hud-warning">⚠ Low</span>}
      </section>

      <section>
        <h2>Stash</h2>
        <ul className="hud-resources">
          {RESOURCES.map((r) => {
            const { label, icon } = RESOURCE_META[r]
            const stored = stash.stored[r]
            const capacity = stash.capacities[r]
            const isFull = stored >= capacity

            return (
              <li key={r}>
                <span className="hud-icon" aria-hidden>{icon}</span>
                <span className="hud-label">{label}</span>
                <meter min={0} max={capacity} value={stored} aria-label={label} />
                <span className="hud-value">
                  {Math.floor(stored)}/{capacity}
                </span>
                <span className="hud-rate">{isFull ? 'Full' : `+${stash.productionPerSecond[r]}/s`}</span>
                <span className="hud-worth">≈{Math.floor(stored) * conversionRates[r]}</span>
                {/* Debug only: replace with the player interaction once it exists. */}
                <button type="button" onClick={() => store.collect(r)}>
                  Collect
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </aside>
  )
}
