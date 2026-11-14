import * as THREE from 'three'
import type { Pickable } from '../pickups/Pickable'

/**
 * TEST ONLY: a colored cube used to try out picking things up.
 * Replace with the team's real objects (they just need to implement Pickable).
 */
export class PlaceholderItem implements Pickable {
  readonly object: THREE.Mesh
  private readonly geometry = new THREE.BoxGeometry(0.35, 0.35, 0.35)
  private readonly material: THREE.MeshStandardMaterial
  private readonly baseY = 0.35
  private readonly phase = Math.random() * Math.PI * 2

  constructor(
    readonly id: string,
    readonly label: string,
    color: THREE.ColorRepresentation,
    x: number,
    z: number,
  ) {
    this.material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, flatShading: true })
    this.object = new THREE.Mesh(this.geometry, this.material)
    this.object.name = `Placeholder:${id}`
    this.object.castShadow = true
    this.object.position.set(x, this.baseY, z)
  }

  /** Gentle idle bob and spin so the item reads as collectible. */
  update(elapsed: number): void {
    this.object.position.y = this.baseY + Math.sin(elapsed * 2.5 + this.phase) * 0.08
    this.object.rotation.y = elapsed * 0.9 + this.phase
  }

  /** Removes the cube from the scene as soon as it goes into the backpack. */
  onPickedUp(): void {
    this.object.removeFromParent()
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
