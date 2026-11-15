import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

export { mergeVertices }

export const UP = new THREE.Vector3(0, 1, 0)
export const DOWN = new THREE.Vector3(0, -1, 0)

const _ab = new THREE.Vector3()
const _ac = new THREE.Vector3()
const _normal = new THREE.Vector3()

/**
 * Accumulates flat-coloured triangles into a non-indexed geometry.
 * Passing an `outward` hint fixes the winding so faces always point that way.
 */
export class FacetBuilder {
  private readonly positions: number[] = []
  private readonly colors: number[] = []

  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color, outward?: THREE.Vector3): this {
    _ab.subVectors(b, a)
    _ac.subVectors(c, a)
    _normal.crossVectors(_ab, _ac)
    if (_normal.lengthSq() < 1e-12) return this
    if (outward && _normal.dot(outward) < 0) [b, c] = [c, b]
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    for (let i = 0; i < 3; i++) this.colors.push(color.r, color.g, color.b)
    return this
  }

  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.Color,
    outward?: THREE.Vector3,
  ): this {
    return this.triangle(a, b, c, color, outward).triangle(a, c, d, color, outward)
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    geometry.computeVertexNormals()
    return geometry
  }
}

/** Converts any geometry into a non-indexed geometry with one colour per face. */
export function facetize(
  source: THREE.BufferGeometry,
  colorOf: (centroid: THREE.Vector3, normal: THREE.Vector3, face: number) => THREE.Color,
): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  geometry.deleteAttribute('uv')
  geometry.deleteAttribute('normal')
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let face = 0; face < position.count / 3; face++) {
    a.fromBufferAttribute(position, face * 3)
    b.fromBufferAttribute(position, face * 3 + 1)
    c.fromBufferAttribute(position, face * 3 + 2)
    centroid.copy(a).add(b).add(c).divideScalar(3)
    normal.crossVectors(_ab.subVectors(b, a), _ac.subVectors(c, a)).normalize()
    const color = colorOf(centroid, normal, face)
    for (let k = 0; k < 3; k++) colors.set([color.r, color.g, color.b], (face * 3 + k) * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Solid-coloured, optionally transformed copy of a primitive, ready to merge. */
export function painted(
  source: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  matrix?: THREE.Matrix4,
): THREE.BufferGeometry {
  const solid = new THREE.Color(color)
  const geometry = facetize(source, () => solid)
  source.dispose()
  if (matrix) geometry.applyMatrix4(matrix)
  return geometry
}

/** Merges facet geometries (position/normal/color) and frees the inputs. */
export function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(geometries, false)
  geometries.forEach((geometry) => geometry.dispose())
  if (!merged) throw new Error('merge(): geometries have incompatible attributes')
  return merged
}

/**
 * Bakes every static, non-instanced mesh under `root` into one merged mesh per
 * (material, spatial key). Hundreds of props collapse into a handful of draw
 * calls while the key (e.g. a terrain chunk) keeps frustum culling useful.
 * Source geometries are disposed; materials are reused as-is.
 */
export function bakeStaticMeshes(root: THREE.Object3D, keyOf: (x: number, z: number) => string): THREE.Group {
  root.updateMatrixWorld(true)
  const buckets = new Map<string, { material: THREE.Material; parts: THREE.BufferGeometry[]; castShadow: boolean; receiveShadow: boolean }>()
  const sources = new Set<THREE.BufferGeometry>()
  const origin = new THREE.Vector3()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || Array.isArray(object.material)) return
    origin.setFromMatrixPosition(object.matrixWorld)
    const key = `${object.material.uuid}|${keyOf(origin.x, origin.z)}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { material: object.material, parts: [], castShadow: object.castShadow, receiveShadow: object.receiveShadow }
      buckets.set(key, bucket)
    }
    bucket.parts.push(object.geometry.clone().applyMatrix4(object.matrixWorld))
    sources.add(object.geometry)
  })
  sources.forEach((geometry) => geometry.dispose())

  const baked = new THREE.Group()
  buckets.forEach(({ material, parts, castShadow, receiveShadow }, key) => {
    const mesh = new THREE.Mesh(merge(parts), material)
    mesh.name = `baked:${key.split('|')[1]}`
    mesh.castShadow = castShadow
    mesh.receiveShadow = receiveShadow
    baked.add(mesh)
  })
  return baked
}

/**
 * Translation + Y rotation + (optionally non-uniform) scale.
 *
 * Non-uniform scale has no render cost here: kit assets apply this matrix to
 * vertices at build time (`painted`, `bakeStaticMeshes`), so the GPU only sees
 * static, already-merged geometry and the draw-call count is unchanged.
 * Instanced scatter (`createScatteredRocks`) only passes uniform scales.
 */
export function placement(x: number, y: number, z: number, rotationY = 0, scale: number | THREE.Vector3Like = 1) {
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3().copy(scale)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, rotationY),
    s,
  )
}

/** A regular octagonal prism whose flat sides face the X and Z axes. */
export function octagonPrism(apothem: number, height: number): THREE.BufferGeometry {
  const radius = apothem / Math.cos(Math.PI / 8)
  return new THREE.CylinderGeometry(radius, radius, height, 8).rotateY(Math.PI / 8)
}

export function shade(color: THREE.Color, factor: number): THREE.Color {
  return color.clone().multiplyScalar(factor)
}
