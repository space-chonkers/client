import * as THREE from 'three'
import { CorridorGrid } from '../../src/game/corridor/CorridorGrid'
import { INITIAL_BASE_ORIGIN, INITIAL_SERVER_CONSTRUCTIONS } from '../../src/game/corridor/mockServerPayload'
import { MarsMapLayer, type MarsMapLayerOptions } from '../../src/game/map/MarsMapLayer'

/**
 * Builds Layer −1 and Layer 0 exactly as `PlayerSandbox` does: the map layer
 * aligned to the initial base, the base loaded into a `CorridorGrid`, and every
 * base cell mined. `build(x, z)` mirrors the E/Space handler.
 */
export function createMissionLayers(options: Pick<MarsMapLayerOptions, 'terrainData' | 'seed'> = {}) {
  const corridors = new CorridorGrid()
  const mapLayer = new MarsMapLayer({
    ...options,
    originCell: INITIAL_BASE_ORIGIN,
    initialBaseCells: INITIAL_SERVER_CONSTRUCTIONS,
  })
  corridors.loadConstructions(INITIAL_SERVER_CONSTRUCTIONS, INITIAL_BASE_ORIGIN)
  for (const item of INITIAL_SERVER_CONSTRUCTIONS) {
    mapLayer.mineCell(item.cellX - INITIAL_BASE_ORIGIN.cellX, item.cellY - INITIAL_BASE_ORIGIN.cellY)
  }
  const build = (x: number, z: number) => {
    const placed = corridors.placeTile(x, z)
    if (placed) mapLayer.mineCell(x, z)
    return placed
  }
  return { corridors, mapLayer, build }
}

/** Every terrain vertex in world space, per mesh, in traversal order (instanced meshes excluded). */
export function worldVertices(root: THREE.Object3D): { mesh: THREE.Mesh; points: THREE.Vector3[] }[] {
  root.updateMatrixWorld(true)
  const out: { mesh: THREE.Mesh; points: THREE.Vector3[] }[] = []
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return
    const position = object.geometry.getAttribute('position')
    const points: THREE.Vector3[] = []
    for (let i = 0; i < position.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld))
    out.push({ mesh: object, points })
  })
  return out
}

/**
 * FNV-1a over every vertex position and vertex colour (rounded to 1e-4),
 * instance matrix and object transform: a fingerprint of the rendered
 * geometry and its colouring.
 */
export function geometryHash(root: THREE.Object3D): string {
  let hash = 0x811c9dc5
  const mix = (value: number) => {
    const text = (Math.round(value * 1e4) / 1e4).toFixed(4)
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  }
  root.updateMatrixWorld(true)
  root.traverse((object) => {
    object.matrixWorld.elements.forEach(mix)
    if (object instanceof THREE.InstancedMesh) {
      object.instanceMatrix.array.forEach(mix)
      object.instanceColor?.array.forEach(mix)
      return
    }
    if (object instanceof THREE.Mesh) {
      ;(object.geometry.getAttribute('position').array as Float32Array).forEach(mix)
      const color = object.geometry.getAttribute('color')
      if (color) (color.array as Float32Array).forEach(mix)
    }
  })
  return hash.toString(16).padStart(8, '0')
}
