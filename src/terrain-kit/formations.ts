import * as THREE from 'three'
import { DOWN, FacetBuilder, UP } from './geometry'
import { createRng, hash, hash01, smoothstep } from './noise'
import { PALETTE, materials } from './palette'

export interface StrataLayer {
  height: number
  /** Bottom radius before stretch; the layer narrows to radius × taper at its top. */
  radius: number
  taper: number
  color: THREE.Color
}

export interface StrataOptions {
  seed: number
  layers: StrataLayer[]
  segments: number
  /** Non-uniform footprint (x, z) multipliers. */
  stretch: [number, number]
  /** Horizontal drift per unit of height. */
  lean: number
  capColor: THREE.Color
  /** How far the first layer starts below y = 0 so it sits in slopes. */
  sink: number
  /** Scales outline irregularity; higher reads less like a cylinder. */
  roughness: number
}

const STRATA = PALETTE.strata.map((hex) => new THREE.Color(hex))
const DUST = new THREE.Color(PALETTE.dust)

/**
 * Stacks irregular rings into layered rock. All layers share one angular
 * profile, so the silhouette stays coherent while ledges form where a
 * layer is narrower or wider than its neighbour.
 */
export function buildStrata({ seed, layers, segments, stretch, lean, capColor, sink, roughness }: StrataOptions): THREE.BufferGeometry {
  const rng = createRng(seed)
  const harmonics = [2, 3, 5].map((k) => ({
    k,
    amp: (rng.range(0.03, 0.1) / (k * 0.5)) * roughness,
    phase: rng.range(0, Math.PI * 2),
  }))
  const angles = Array.from({ length: segments }, (_, i) => ((i + rng.range(-0.25, 0.25)) / segments) * Math.PI * 2)
  const profile = angles.map(
    (a) => 1 + harmonics.reduce((sum, h) => sum + h.amp * Math.sin(h.k * a + h.phase), 0) + rng.range(-0.05, 0.05),
  )
  const leanAngle = rng.range(0, Math.PI * 2)
  const leanX = Math.cos(leanAngle) * lean
  const leanZ = Math.sin(leanAngle) * lean

  const ring = (y: number, radius: number, layer: number) =>
    angles.map((a, i) => {
      const r = radius * profile[i] * (1 + (hash01(seed, layer, i) - 0.5) * 0.08)
      return new THREE.Vector3(Math.cos(a) * r * stretch[0] + leanX * y, y, Math.sin(a) * r * stretch[1] + leanZ * y)
    })

  const builder = new FacetBuilder()
  const color = new THREE.Color()
  const outward = new THREE.Vector3()
  let y = -sink
  layers.forEach((layer, k) => {
    const bottom = ring(y, layer.radius, k)
    const topRadius = layer.radius * layer.taper
    const top = ring(y + layer.height, topRadius, k)
    for (let i = 0; i < segments; i++) {
      const i1 = (i + 1) % segments
      outward.set(bottom[i].x + bottom[i1].x, 0, bottom[i].z + bottom[i1].z)
      color.copy(layer.color).multiplyScalar(0.9 + hash01(seed, k, i, 5) * 0.16)
      builder.quad(bottom[i], bottom[i1], top[i1], top[i], color, outward)
    }

    const next = layers[k + 1]
    if (next) {
      // Ledge between this layer's top and the next layer's base.
      const nextBottom = ring(y + layer.height, next.radius, k + 1)
      const facingUp = next.radius < topRadius
      color.copy(facingUp ? layer.color.clone().lerp(DUST, 0.55) : layer.color.clone().multiplyScalar(0.65))
      for (let i = 0; i < segments; i++) {
        const i1 = (i + 1) % segments
        builder.quad(top[i], top[i1], nextBottom[i1], nextBottom[i], color, facingUp ? UP : DOWN)
      }
    } else {
      const apex = top.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(segments)
      apex.y += 0.03
      for (let i = 0; i < segments; i++) {
        color.copy(capColor).multiplyScalar(0.93 + hash01(seed, i, 9) * 0.12)
        builder.triangle(top[i], top[(i + 1) % segments], apex, color, UP)
      }
    }
    y += layer.height
  })
  return builder.build()
}

function formationMesh(geometry: THREE.BufferGeometry, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, materials.matte())
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export interface RockMassOptions {
  seed: number
  height: number
  radius: number
  /** Radius multiplier at normalised height t ∈ [0, 1]: the erosion profile. */
  profile: (t: number) => number
  /** Normalised heights of the vertex rings, ascending from 0 to 1. */
  levels: readonly number[]
  segments: number
  /** Non-uniform footprint (x, z) multipliers. */
  stretch: [number, number]
  /** Footprint irregularity; higher reads less like a lathe-turned solid. */
  roughness: number
  /** How far one side slumps below the top (0..0.4): asymmetric silhouettes. */
  slump: number
  /** Vertical joints: fractures that bite into the upper body. */
  joints: number
  /** Horizontal drift per unit of height. */
  lean: number
  /** Depth of the buried apron ring that blends the base into the ground. */
  sink: number
  flare: number
  /** Strata from the bottom up; `top` is the normalised height where each bed ends. */
  bands: readonly { top: number; color: THREE.Color }[]
  capColor: THREE.Color
  baseColor: THREE.Color
}

/**
 * One continuous, eroded rock body lofted through rings. Unlike stacked
 * drums, strata are painted onto a single surface (with non-uniform bed
 * thickness and a slight dip), so ledges only appear where the erosion
 * profile asks for them. Irregular footprints, vertical joints and a slumped
 * side break the silhouette; a flared, buried apron grows it out of the ground.
 */
export function buildRockMass(options: RockMassOptions): THREE.BufferGeometry {
  const { seed, height, radius, profile, levels, segments, stretch, roughness, slump, joints, lean, sink, flare, bands, capColor, baseColor } = options
  const rng = createRng(seed)
  const harmonics = [1, 2, 3, 4].map((k) => ({ k, amp: (rng.range(0.03, 0.1) / Math.sqrt(k)) * roughness, phase: rng.range(0, Math.PI * 2) }))
  const angles = Array.from({ length: segments }, (_, i) => ((i + rng.range(-0.3, 0.3)) / segments) * Math.PI * 2)
  const outline = angles.map((a) => 1 + harmonics.reduce((sum, h) => sum + h.amp * Math.sin(h.k * a + h.phase), 0) + rng.range(-0.04, 0.04) * roughness)
  const cuts = Array.from({ length: joints }, () => ({
    angle: rng.range(0, Math.PI * 2),
    width: rng.range(0.16, 0.3),
    depth: rng.range(0.16, 0.32),
    start: rng.range(0.2, 0.5),
  }))
  const slumpAngle = rng.range(0, Math.PI * 2)
  const leanAngle = rng.range(0, Math.PI * 2)
  const leanX = Math.cos(leanAngle) * lean
  const leanZ = Math.sin(leanAngle) * lean
  // Beds dip gently toward one side: tilted strata read as real geology, flat rings as cake.
  const dipAngle = rng.range(0, Math.PI * 2)
  const dip = rng.range(0.03, 0.08)

  const topAt = angles.map((a) => height * (1 - slump * Math.max(0, Math.cos(a - slumpAngle)) ** 2))
  const notchAt = (i: number, t: number) =>
    cuts.reduce((f, c) => {
      const diff = Math.atan2(Math.sin(angles[i] - c.angle), Math.cos(angles[i] - c.angle))
      return f * (1 - c.depth * Math.exp(-((diff / c.width) ** 2)) * smoothstep(c.start, c.start + 0.25, t))
    }, 1)
  const vertex = (i: number, t: number, ring: number) => {
    const y = t * topAt[i] * (1 + (hash01(seed, i, ring, 3) - 0.5) * 0.04)
    const r = radius * profile(t) * outline[i] * notchAt(i, t) * (1 + (hash01(seed, i, ring) - 0.5) * 0.07)
    const a = angles[i]
    return new THREE.Vector3(Math.cos(a) * r * stretch[0] + leanX * y, y, Math.sin(a) * r * stretch[1] + leanZ * y)
  }
  const rings = levels.map((t, k) => angles.map((_, i) => vertex(i, t, k)))
  const apron = angles.map((a, i) => {
    const r = radius * profile(0) * outline[i] * flare
    return new THREE.Vector3(Math.cos(a) * r * stretch[0], -sink, Math.sin(a) * r * stretch[1])
  })

  const builder = new FacetBuilder()
  const color = new THREE.Color()
  const outward = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const bandAt = (t: number) => (bands.find((b) => t <= b.top) ?? bands[bands.length - 1]).color
  const wall = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, base: THREE.Color, face: number) => {
    outward.set(a.x + b.x, 0, a.z + b.z)
    normal.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a)).normalize()
    if (normal.dot(outward) < 0) normal.negate()
    color.copy(base).multiplyScalar(0.9 + hash01(seed, face, 5) * 0.16)
    // Dust settles on upward-facing ledges; overhangs stay in shade.
    if (normal.y > 0.45) color.lerp(DUST, smoothstep(0.45, 0.9, normal.y) * 0.5)
    if (normal.y < -0.2) color.multiplyScalar(0.72)
    builder.quad(a, b, c, d, color, outward)
  }

  let face = 0
  for (let i = 0; i < segments; i++) {
    const n = (i + 1) % segments
    wall(apron[i], apron[n], rings[0][n], rings[0][i], baseColor, face++)
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < segments; i++) {
      const n = (i + 1) % segments
      const mid = (levels[k] + levels[k + 1]) / 2
      // The dip shifts bed boundaries around the body.
      const t = mid + dip * Math.cos(angles[i] - dipAngle)
      wall(rings[k][i], rings[k][n], rings[k + 1][n], rings[k + 1][i], bandAt(t), face++)
    }
  }
  const top = rings[rings.length - 1]
  const apex = top.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(segments)
  apex.x += rng.range(-0.05, 0.05) * radius
  apex.z += rng.range(-0.05, 0.05) * radius
  apex.y += rng.range(-0.02, 0.05) * height
  for (let i = 0; i < segments; i++) {
    color.copy(capColor).multiplyScalar(0.93 + hash01(seed, i, 9) * 0.12)
    builder.triangle(top[i], top[(i + 1) % segments], apex, color, UP)
  }
  return builder.build()
}

/** Random-thickness beds from a palette, so strata never repeat at a fixed rhythm. */
function randomBands(rng: ReturnType<typeof createRng>, palette: readonly THREE.Color[], from = 0) {
  const bands: { top: number; color: THREE.Color }[] = []
  let t = from
  let index = rng.int(0, palette.length - 1)
  while (t < 1) {
    t += rng.range(0.08, 0.3)
    index = (index + rng.int(1, 2)) % palette.length
    bands.push({ top: Math.min(t, 1.2), color: palette[index] })
  }
  return bands
}

const BASE = new THREE.Color(PALETTE.rock[1])

export interface SedimentaryFormationOptions {
  seed: number
  scale?: number
}

/**
 * Butte: an eroded block of layered rock with a resistant caprock that
 * slightly overhangs, one slumped flank and joint-cut faces. Elongated along
 * its local X axis; callers align that with the wind.
 */
export function createSedimentaryFormation({ seed, scale = 1 }: SedimentaryFormationOptions): THREE.Mesh {
  const rng = createRng(hash(seed, 0x5ed))
  const geometry = buildRockMass({
    seed: hash(seed, 1),
    height: rng.range(0.8, 1.1),
    radius: 0.52,
    // Talus-flared foot, then flanks that taper by a third: a trapezoid, not a drum.
    profile: (t) => (t < 0.1 ? 1.08 - 1.1 * t : 1 - 0.34 * t) + (t >= 0.88 ? 0.05 : 0),
    levels: [0, 0.1, 0.28, 0.46, 0.62, 0.76, 0.86, 0.9, 1],
    segments: 11,
    stretch: [rng.range(1.15, 1.4), rng.range(0.75, 0.92)],
    roughness: 1.8,
    slump: rng.range(0.15, 0.38),
    joints: rng.int(1, 2),
    lean: 0.04,
    sink: 0.22,
    flare: 1.32,
    bands: randomBands(rng, STRATA),
    capColor: STRATA[4].clone().lerp(DUST, 0.45),
    baseColor: BASE,
  })
  geometry.scale(scale, scale, scale)
  return formationMesh(geometry, 'sedimentary-formation')
}

export interface RockPillarOptions {
  seed: number
  height?: number
}

/**
 * Wind-carved spire (yardang-like): a flared foot narrowing to a pinched
 * neck under a darker, wider cap rock, elongated along local X.
 */
export function createRockPillar({ seed, height = 1.6 }: RockPillarOptions): THREE.Mesh {
  const rng = createRng(hash(seed, 0x9111))
  const neck = rng.range(0.66, 0.76)
  // Cap rock only a little darker than the column: a hoodoo, not a mushroom.
  const capRock = STRATA[4].clone().lerp(STRATA[1], 0.45)
  const geometry = buildRockMass({
    seed: hash(seed, 2),
    height,
    radius: 0.32,
    profile: (t) => (t < 0.8 ? 1.05 - (1.05 - neck) * smoothstep(0.04, 0.78, t) : t < 0.85 ? neck : 0.82 - 0.16 * ((t - 0.85) / 0.15)),
    levels: [0, 0.1, 0.25, 0.42, 0.58, 0.72, 0.8, 0.85, 1],
    segments: 7,
    stretch: [rng.range(1.15, 1.35), rng.range(0.8, 0.95)],
    roughness: 1.6,
    slump: rng.range(0.1, 0.25),
    joints: 1,
    lean: rng.range(0.08, 0.15),
    sink: 0.16,
    flare: 1.35,
    bands: [...randomBands(rng, STRATA.slice(0, 4)).filter((b) => b.top < 0.8), { top: 0.82, color: STRATA[2] }, { top: 2, color: capRock }],
    capColor: capRock.clone().lerp(DUST, 0.3),
    baseColor: BASE,
  })
  return formationMesh(geometry, 'rock-pillar')
}

export interface MesaOptions {
  seed: number
  width?: number
  depth?: number
  height?: number
}

/**
 * Broad flat-topped table with a lobate, embayed outline: talus apron, then
 * steep banded cliffs (light beds only) under a thin dusty caprock.
 */
export function createMesa({ seed, width = 2.4, depth = 2, height = 1 }: MesaOptions): THREE.Mesh {
  const rng = createRng(hash(seed, 0x3e5a))
  // Light bands only: cream, pale orange, orange (the darkest strata read as a "cake filling").
  const light = [0, 3, 1].map((k) => STRATA[k])
  const geometry = buildRockMass({
    seed: hash(seed, 3),
    height,
    radius: 1,
    profile: (t) => (t < 0.3 ? 1.14 - 0.47 * t : 1 - 0.06 * t) + (t >= 0.9 ? 0.03 : 0),
    levels: [0, 0.18, 0.3, 0.48, 0.64, 0.8, 0.9, 0.93, 1],
    segments: 18,
    stretch: [width / 2, depth / 2],
    roughness: 1.9,
    slump: rng.range(0.05, 0.15),
    joints: rng.int(2, 3),
    lean: 0,
    sink: 0.18,
    flare: 1.25,
    bands: [{ top: 0.28, color: new THREE.Color(PALETTE.rock[0]) }, ...randomBands(rng, light, 0.28)],
    capColor: new THREE.Color(PALETTE.rocky).lerp(DUST, 0.4),
    baseColor: BASE,
  })
  geometry.rotateY(rng.range(-0.3, 0.3))
  return formationMesh(geometry, 'mesa')
}
