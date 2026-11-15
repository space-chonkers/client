/**
 * The four directions the player can face. "up" means away from the camera
 * (toward -Z in world space), "down" means toward the camera (+Z).
 */
export type Facing = 'up' | 'down' | 'left' | 'right'

/** Unit vector on the ground plane (X/Z) for each facing. */
export const FACING_VECTORS: Readonly<Record<Facing, { readonly x: number; readonly z: number }>> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
}

/**
 * Y rotation that makes a model built facing +Z look toward `facing`.
 */
export function facingToYaw(facing: Facing): number {
  const v = FACING_VECTORS[facing]
  return Math.atan2(v.x, v.z)
}
