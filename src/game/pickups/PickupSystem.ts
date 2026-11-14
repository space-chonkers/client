import * as THREE from 'three'
import type { Player } from '../player/Player'
import type { Backpack } from './Backpack'
import type { Pickable } from './Pickable'

/** How far in front of the player an item can be picked up from. */
const REACH_DISTANCE = 1.4
/** Items closer than this can be picked up whichever way the player faces. */
const TOUCH_DISTANCE = 0.6
/** Minimum alignment with the facing direction (cos of ~65°). */
const FACING_THRESHOLD = 0.42

export type PickupResult =
  | { status: 'picked'; item: Pickable }
  | { status: 'nothing-in-reach' }
  | { status: 'backpack-full'; item: Pickable }

/**
 * Finds the item in front of the player and puts it in the backpack when the
 * player presses the pickup key.
 */
export class PickupSystem {
  private readonly items = new Set<Pickable>()

  private readonly toItem = new THREE.Vector3()
  private readonly facing = new THREE.Vector3()
  private readonly itemPosition = new THREE.Vector3()

  constructor(
    private readonly player: Player,
    private readonly backpack: Backpack,
  ) {}

  register(item: Pickable): void {
    this.items.add(item)
  }

  unregister(item: Pickable): void {
    this.items.delete(item)
  }

  /** Try to pick up the item the player is facing. */
  tryPickUp(): PickupResult {
    const item = this.findTarget()
    if (!item) return { status: 'nothing-in-reach' }
    if (!this.backpack.add({ id: item.id, label: item.label })) {
      return { status: 'backpack-full', item }
    }

    this.unregister(item)
    this.player.playPickupReach()
    item.onPickedUp()
    return { status: 'picked', item }
  }

  /** The closest item within reach, preferring ones straight ahead. */
  findTarget(): Pickable | null {
    this.player.getFacingVector(this.facing)
    let best: Pickable | null = null
    let bestScore = Infinity

    for (const item of this.items) {
      item.object.getWorldPosition(this.itemPosition)
      this.toItem.subVectors(this.itemPosition, this.player.position).setY(0)
      const distance = this.toItem.length()
      if (distance > REACH_DISTANCE) continue

      const alignment = distance > 1e-4 ? this.toItem.dot(this.facing) / distance : 1
      if (distance > TOUCH_DISTANCE && alignment < FACING_THRESHOLD) continue

      const score = distance - alignment * 0.5
      if (score < bestScore) {
        bestScore = score
        best = item
      }
    }
    return best
  }
}
