import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { facetize, merge, placement } from './geometry'
import { createRng, hash, hash01, smoothstep, type Range } from './noise'
import { PALETTE, materials } from './palette'

export type RockVariant = 'angular' | 'boulder' | 'eroded'

export interface RockOptions {
  seed: number
  /** Approximate footprint diameter in world units (≈ cells). */
  scale?: number
  variant?: RockVariant
  /** Base colours to pick from; defaults to Martian rust rock. */
  palette?: readonly string[]
}

const VARIANTS: Record<RockVariant, { id: number; detail: number; jitter: number; cuts: Range; dims: readonly [Range, Range, Range] }> = {
  // Few faces + deep plane cuts = crisp chiselled chunks.
  angular: { id: 1, detail: 0, jitter: 0.2, cuts: [2, 3], dims: [[0.85, 1.2], [0.55, 0.8], [0.75, 1.05]] },
  // Rounder, heavier silhouette with a couple of fractured faces.
  boulder: { id: 2, detail: 1, jitter: 0.12, cuts: [1, 2], dims: [[0.95, 1.15], [0.68, 0.85], [0.85, 1.0]] },
  // Wind-carved: flat top, pinched undercut base, horizontal banding.
  eroded: { id: 3, detail: 1, jitter: 0.09, cuts: [2, 3], dims: [[1.0, 1.2], [0.95, 1.15], [0.85, 0.98]] },
}

/** Plane cuts that turn the lumpy sphere into fractured faces (unit-sphere units). */
const ROCK_CUT = {
  /** Cut normals lean upward, so most flat faces show from the gameplay camera. */
  normalY: [-0.2, 0.9] as Range,
  /** Distance of each cut plane from the centre. */
  offset: [0.55, 0.8] as Range,
}

/** Shape of every rock and of the wind-carved `eroded` variant, as shares of the half-height. */
const ROCK_SHAPE = {
  /** The buried underside is cut flat this far below the centre. */
  baseCut: 0.5,
  /** Eroded: how much the undercut base narrows toward the bottom. */
  erodedPinch: 0.3,
  /** Eroded: the top is cut flat at this height. */
  erodedTop: 0.62,
}

/** Per-facet colour of rocks. */
const ROCK_SHADING = {
  /** Brightness of each facet: base + random share of range. */
  tone: { base: 0.9, range: 0.18 },
  /** Eroded rocks: horizontal bands per half-height, and how dark alternate bands are. */
  bands: { perHeight: 5, darken: 0.86 },
  /** Dust on upward-facing facets: blend from `from` to `to` normal.y, up to `amount`. */
  dust: { from: 0.5, to: 0.95, amount: 0.55 },
  /** Overhangs (normal.y below `below`) stay dark. */
  overhang: { below: -0.3, darken: 0.78 },
}

/** Keeps the band index positive for facets below the rock's centre. */
const BAND_INDEX_OFFSET = 10

/** The unit icosahedron spans 2 units; dividing by this makes `scale` ≈ footprint diameter. */
const UNIT_ROCK_SPAN = 2

const DUST = new THREE.Color(PALETTE.dust)

/** Rock geometry with its base at y = 0, centred on X/Z, with per-face vertex colours. */
export function createMartianRockGeometry({
  seed,
  scale = 1,
  variant = 'boulder',
  palette = PALETTE.rock,
}: RockOptions): THREE.BufferGeometry {
  const settings = VARIANTS[variant]
  const rng = createRng(hash(seed, settings.id))

  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, settings.detail)
  geometry.deleteAttribute('normal')
  geometry.deleteAttribute('uv')
  geometry = mergeVertices(geometry)

  const sx = rng.range(...settings.dims[0])
  const sy = rng.range(...settings.dims[1])
  const sz = rng.range(...settings.dims[2])
  const cuts = Array.from({ length: rng.int(...settings.cuts) }, () => ({
    normal: new THREE.Vector3(rng.range(-1, 1), rng.range(...ROCK_CUT.normalY), rng.range(-1, 1)).normalize(),
    offset: rng.range(...ROCK_CUT.offset),
  }))

  const position = geometry.getAttribute('position')
  const v = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize().multiplyScalar(1 + rng.range(-settings.jitter, settings.jitter))
    for (const cut of cuts) {
      const excess = v.dot(cut.normal) - cut.offset
      if (excess > 0) v.addScaledVector(cut.normal, -excess)
    }
    v.set(v.x * sx, v.y * sy, v.z * sz)
    if (variant === 'eroded') {
      if (v.y < 0) {
        const pinch = 1 - ROCK_SHAPE.erodedPinch * Math.min(1, -v.y / sy)
        v.x *= pinch
        v.z *= pinch
      }
      v.y = Math.min(v.y, sy * ROCK_SHAPE.erodedTop)
    }
    v.y = Math.max(v.y, -sy * ROCK_SHAPE.baseCut)
    position.setXYZ(i, v.x, v.y, v.z)
  }
  geometry.rotateY(rng.range(0, Math.PI * 2))

  const base = new THREE.Color(rng.pick(palette))
  const color = new THREE.Color()
  const { tone, bands, dust, overhang } = ROCK_SHADING
  const faceted = facetize(geometry, (centroid, normal, face) => {
    color.copy(base).multiplyScalar(tone.base + hash01(seed, face, settings.id) * tone.range)
    if (variant === 'eroded' && Math.floor((centroid.y / sy) * bands.perHeight + BAND_INDEX_OFFSET) % 2 === 0) color.multiplyScalar(bands.darken)
    // Dust settles on upward-facing facets; overhangs stay dark.
    if (normal.y > dust.from) color.lerp(DUST, smoothstep(dust.from, dust.to, normal.y) * dust.amount)
    if (normal.y < overhang.below) color.multiplyScalar(overhang.darken)
    return color
  })
  geometry.dispose()

  faceted.computeBoundingBox()
  faceted.translate(0, -faceted.boundingBox!.min.y, 0)
  const footprint = scale / UNIT_ROCK_SPAN
  faceted.scale(footprint, footprint, footprint)
  faceted.computeBoundingBox()
  faceted.computeBoundingSphere()
  return faceted
}

export function createMartianRock(options: RockOptions): THREE.Mesh {
  const mesh = new THREE.Mesh(createMartianRockGeometry(options), materials.matte())
  mesh.name = `rock-${options.variant ?? 'boulder'}`
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export interface RockClusterOptions {
  seed: number
  size?: number
  palette?: readonly string[]
}

/** One anchor boulder ringed by smaller satellites; sizes and distances scale with `size`. */
const ROCK_CLUSTER = {
  anchor: { scale: 0.6, sink: 0.02 },
  satellites: {
    count: [3, 5] as Range,
    /** Radians of jitter around an even spacing. */
    angleJitter: 0.4,
    distance: [0.3, 0.45] as Range,
    scale: [0.18, 0.34] as Range,
    /** Share of satellites that are angular chips rather than boulders. */
    angularChance: 0.7,
    sink: 0.015,
  },
}

/** One anchor boulder with smaller satellites, merged into a single mesh. */
export function createRockCluster({ seed, size = 1, palette }: RockClusterOptions): THREE.Mesh {
  const { anchor, satellites } = ROCK_CLUSTER
  const rng = createRng(hash(seed, 0x77))
  const parts = [createMartianRockGeometry({ seed: hash(seed, 0), scale: anchor.scale * size, variant: 'boulder', palette })]
  parts[0].translate(0, -anchor.sink * size, 0)
  const count = rng.int(...satellites.count)
  const start = rng.range(0, Math.PI * 2)
  for (let k = 1; k <= count; k++) {
    const angle = start + (k / count) * Math.PI * 2 + rng.range(-satellites.angleJitter, satellites.angleJitter)
    const distance = rng.range(...satellites.distance) * size
    const rock = createMartianRockGeometry({
      seed: hash(seed, k),
      scale: rng.range(...satellites.scale) * size,
      variant: rng.chance(satellites.angularChance) ? 'angular' : 'boulder',
      palette,
    })
    rock.translate(Math.cos(angle) * distance, -satellites.sink * size, Math.sin(angle) * distance)
    parts.push(rock)
  }
  const mesh = new THREE.Mesh(merge(parts), materials.matte())
  mesh.name = 'rock-cluster'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export interface ScatterPoint {
  x: number
  z: number
  /** Footprint diameter, as in {@link RockOptions.scale}. */
  scale: number
}

export interface ScatterOptions {
  seed: number
  points: readonly ScatterPoint[]
  heightAt: (x: number, z: number) => number
}

/** Instanced small-rock scatter. */
const INSTANCED_SCATTER = {
  /** Distinct rock shapes shared across all instances. */
  variants: 5,
  /** How deep each rock sits in the ground, as a share of its footprint. */
  sink: 0.1,
  /** Per-instance brightness: base + random share of range. */
  tint: { base: 0.88, range: 0.2 },
}

/** Many small rocks drawn as a handful of InstancedMeshes (one per shape variant). */
export function createScatteredRocks({ seed, points, heightAt }: ScatterOptions): THREE.Group {
  const { variants, sink, tint: tintRange } = INSTANCED_SCATTER
  const group = new THREE.Group()
  group.name = 'scattered-rocks'
  const buckets: ScatterPoint[][] = Array.from({ length: variants }, () => [])
  points.forEach((point, index) => buckets[Math.floor(hash01(seed, index, 17) * variants)].push(point))

  const tint = new THREE.Color()
  buckets.forEach((bucket, variantIndex) => {
    if (bucket.length === 0) return
    const geometry = createMartianRockGeometry({
      seed: hash(seed, variantIndex, 23),
      // Low-detail shape only: pebbles are too small for the 80-face boulder to read, and there are thousands.
      variant: 'angular',
    })
    const mesh = new THREE.InstancedMesh(geometry, materials.matte(), bucket.length)
    bucket.forEach((point, i) => {
      const rotation = hash01(seed, variantIndex, i, 29) * Math.PI * 2
      const y = heightAt(point.x, point.z) - sink * point.scale
      mesh.setMatrixAt(i, placement(point.x, y, point.z, rotation, point.scale))
      mesh.setColorAt(i, tint.setScalar(tintRange.base + hash01(seed, variantIndex, i, 31) * tintRange.range))
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    group.add(mesh)
  })
  return group
}
