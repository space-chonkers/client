import * as THREE from 'three'
import { isSharedMaterial } from './palette'

/**
 * Releases GPU resources owned by an object tree. Shared kit materials are
 * skipped; free those with `disposeSharedMaterials()` when the renderer goes away.
 */
export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const ownedMaterials = new Set<THREE.Material>()
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      geometries.add(object.geometry)
      const list: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach((material) => {
        if (!isSharedMaterial(material)) ownedMaterials.add(material)
      })
    }
    if (object instanceof THREE.InstancedMesh) object.dispose()
    if (object instanceof THREE.Light) object.dispose()
  })
  geometries.forEach((geometry) => geometry.dispose())
  ownedMaterials.forEach((material) => material.dispose())
}
