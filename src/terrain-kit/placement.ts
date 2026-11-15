import * as THREE from 'three'
import { UP } from './geometry'
import type { TerrainSurface } from './terrain'

/**
 * Grounds assets on the *rendered* terrain ({@link TerrainSurface}), never on
 * the analytic field: the faceted mesh can sit above or below the field
 * between vertices.
 */

export interface PlacementOptions {
  /**
   * rest: sits on a plane fitted to the ground under its footprint and is lifted
   *   until no contact sample is above its base (deposits, boulders).
   * root: base at the lowest ground so the object grows out of slopes (tall formations).
   */
  mode?: 'rest' | 'root'
  rotationY?: number
  /** Largest tilt toward the ground normal, in radians; 0 keeps the object upright. */
  maxTilt?: number
  /** Reject ground that strays further than this from the fitted plane (bumpy footprint). */
  maxRoughness?: number
  /** Reject ground that drops more than this across the footprint (too steep). */
  maxDrop?: number
  /**
   * Largest fraction of vertices of meshes flagged `userData.exposed` allowed
   * below the surface after placement; the placement is rejected otherwise.
   */
  maxBuried?: number
}

const _box = new THREE.Box3()

/** Horizontal reach of an object from its origin at its current scale (position and rotation ignored). */
function footprintRadius(object: THREE.Object3D): number {
  const { position, quaternion } = object
  const saved = { position: position.clone(), quaternion: quaternion.clone() }
  position.set(0, 0, 0)
  quaternion.identity()
  object.updateMatrixWorld(true)
  _box.setFromObject(object)
  position.copy(saved.position)
  quaternion.copy(saved.quaternion)
  object.updateMatrixWorld(true)
  return Math.max(-_box.min.x, _box.max.x, -_box.min.z, _box.max.z, 0.05)
}

/** Contact samples: centre plus two rings, symmetric so the plane fit stays simple. */
const RINGS = [0.5, 1]
const SPOKES = 8

/**
 * Tries each candidate X/Z in order and places the object at the first one
 * whose ground passes the checks. Returns false (object untouched) when none does.
 */
export function placeOnSurface(
  object: THREE.Object3D,
  surface: TerrainSurface,
  candidates: readonly { x: number; z: number }[],
  { mode = 'rest', rotationY = 0, maxTilt = 0, maxRoughness = Infinity, maxDrop = Infinity, maxBuried = 1 }: PlacementOptions = {},
): boolean {
  const radius = footprintRadius(object)
  // A candidate can be rejected after the object was moved onto it (buried check), so the
  // original transform is restored when no candidate passes.
  const originalPosition = object.position.clone()
  const originalQuaternion = object.quaternion.clone()
  const spin = new THREE.Quaternion().setFromAxisAngle(UP, rotationY)
  const tilt = new THREE.Quaternion()
  const normal = new THREE.Vector3()
  const downhill = new THREE.Vector3()

  for (const { x, z } of candidates) {
    // Least-squares plane h = a + b·dx + c·dz; symmetric samples make it closed-form.
    const samples: [number, number, number][] = [[0, 0, surface.heightAt(x, z)]]
    for (const ring of RINGS) {
      for (let k = 0; k < SPOKES; k++) {
        const angle = (k / SPOKES) * Math.PI * 2
        const dx = Math.cos(angle) * radius * ring
        const dz = Math.sin(angle) * radius * ring
        samples.push([dx, dz, surface.heightAt(x + dx, z + dz)])
      }
    }
    let sumH = 0
    let sumXH = 0
    let sumZH = 0
    let sumXX = 0
    let sumZZ = 0
    let minH = Infinity
    let maxH = -Infinity
    for (const [dx, dz, h] of samples) {
      sumH += h
      sumXH += dx * h
      sumZH += dz * h
      sumXX += dx * dx
      sumZZ += dz * dz
      minH = Math.min(minH, h)
      maxH = Math.max(maxH, h)
    }
    const a = sumH / samples.length
    let b = sumXH / sumXX
    let c = sumZH / sumZZ
    const roughness = Math.max(...samples.map(([dx, dz, h]) => Math.abs(h - (a + b * dx + c * dz))))
    if (roughness > maxRoughness || maxH - minH > maxDrop) continue

    if (mode === 'root') {
      object.quaternion.copy(spin)
      object.position.set(x, minH, z)
    } else {
      // Tilt toward the ground normal, capped; then lift the base plane clear of every sample.
      normal.set(-b, 1, -c).normalize()
      if (normal.angleTo(UP) > maxTilt) {
        downhill.set(normal.x, 0, normal.z).normalize()
        normal.copy(UP).multiplyScalar(Math.cos(maxTilt)).addScaledVector(downhill, Math.sin(maxTilt))
      }
      tilt.setFromUnitVectors(UP, normal)
      b = -normal.x / normal.y
      c = -normal.z / normal.y
      const lift = Math.max(0, ...samples.map(([dx, dz, h]) => h - (a + b * dx + c * dz)))
      object.quaternion.copy(tilt).multiply(spin)
      object.position.set(x, a + lift, z)
    }
    object.updateMatrixWorld(true)
    if (maxBuried < 1 && buriedFraction(object, surface) > maxBuried) continue
    return true
  }
  object.position.copy(originalPosition)
  object.quaternion.copy(originalQuaternion)
  object.updateMatrixWorld(true)
  return false
}

const _v = new THREE.Vector3()

/** Fraction of vertices (of `userData.exposed` meshes) lying below the rendered surface. */
export function buriedFraction(object: THREE.Object3D, surface: TerrainSurface, tolerance = 0.005): number {
  let total = 0
  let buried = 0
  object.updateMatrixWorld(true)
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.userData.exposed) return
    const position = child.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      _v.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld)
      total++
      if (_v.y < surface.heightAt(_v.x, _v.z) - tolerance) buried++
    }
  })
  return total === 0 ? 0 : buried / total
}
