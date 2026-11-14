import type * as THREE from 'three'

/**
 * Anything the player can pick up and put in the backpack.
 *
 * Teammates' objects (rocks, samples, tools...) implement this interface and
 * are registered with `PickupSystem.register()`.
 */
export interface Pickable {
  /** Unique id, e.g. "rock-sample-3". */
  readonly id: string
  /** Name shown to the player, e.g. "Rock sample". */
  readonly label: string
  /** The object in the scene; its world position is used for distance checks. */
  readonly object: THREE.Object3D
  /** Called when the item goes into the backpack. Hide or remove it here. */
  onPickedUp(): void
}
