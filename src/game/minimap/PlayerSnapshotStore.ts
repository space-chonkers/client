import type { MissionMapPlayer } from './missionMap'

/** Read side of the latest player snapshot, shaped for React's `useSyncExternalStore`. */
export interface MissionMapPlayerSource {
  readonly getSnapshot: () => MissionMapPlayer | null
  readonly subscribe: (listener: () => void) => () => void
}

/**
 * Holds the latest player snapshot outside React state, so the ~10 Hz player
 * updates only re-render the components that read it (the minimap's player
 * marker) instead of the whole HUD. Methods are bound arrow functions so they
 * can be passed around directly as callbacks.
 */
export class PlayerSnapshotStore implements MissionMapPlayerSource {
  private snapshot: MissionMapPlayer | null = null
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): MissionMapPlayer | null => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Replaces the snapshot and notifies subscribers (skipped when it is the same object). */
  readonly set = (player: MissionMapPlayer | null): void => {
    if (player === this.snapshot) return
    this.snapshot = player
    for (const listener of this.listeners) listener()
  }
}
