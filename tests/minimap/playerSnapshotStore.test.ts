import { describe, expect, test } from 'bun:test'
import type { MissionMapPlayer } from '../../src/game/minimap/missionMap'
import { PlayerSnapshotStore } from '../../src/game/minimap/PlayerSnapshotStore'

const north: MissionMapPlayer = { cellX: 29, cellY: 24, facing: 'up' }

describe('PlayerSnapshotStore', () => {
  test('starts empty and returns the latest snapshot', () => {
    const store = new PlayerSnapshotStore()
    expect(store.getSnapshot()).toBeNull()
    store.set(north)
    expect(store.getSnapshot()).toBe(north)
  })

  test('notifies subscribers on change, but not when the same snapshot is set again', () => {
    const store = new PlayerSnapshotStore()
    let notifications = 0
    store.subscribe(() => notifications++)

    store.set(north)
    store.set(north)
    store.set({ ...north, facing: 'right' })
    expect(notifications).toBe(2)
  })

  test('unsubscribed listeners are no longer called', () => {
    const store = new PlayerSnapshotStore()
    let notifications = 0
    const unsubscribe = store.subscribe(() => notifications++)
    unsubscribe()
    store.set(north)
    expect(notifications).toBe(0)
  })

  test('methods are bound, so they work when passed as bare callbacks', () => {
    const store = new PlayerSnapshotStore()
    const { set, getSnapshot } = store
    set(north)
    expect(getSnapshot()).toBe(north)
  })
})
