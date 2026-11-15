import { useSyncExternalStore } from 'react'
import type { EconomyState, EconomyStore } from './EconomyStore'

export function useEconomy(store: EconomyStore): EconomyState {
  return useSyncExternalStore(store.subscribe, store.getState)
}
