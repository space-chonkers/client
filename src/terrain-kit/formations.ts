import * as THREE from 'three'
import { DOWN, FacetBuilder, UP } from './geometry'
import { createRng, hash, hash01, smoothstep, type Range, type Rng } from './noise'
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
/** Index of each tone in `PALETTE.strata`. */
const STRATUM = { cream: 0, orange: 1, rust: 2, paleOrange: 3, dark: 4 }
const DUST = new THREE.Color(PALETTE.dust)

/** Brightness of each wall facet: base + random share of range. */
const WALL_TONE = { base: 0.9, range: 0.16 }
/** Brightness of each caprock facet: base + random share of range. */
const CAP_TONE = { base: 0.93, range: 0.12 }

/** Outline and shading of stacked strata (`buildStrata`). */
const STRATA_SHAPE = {
  /** Low harmonics that wobble the shared outline; amplitude falls off as 1 / (k × falloff). */
  harmonics: [2, 3, 5],
  amplitude: [0.03, 0.1] as Range,
  falloff: 0.5,
  /** Angular jitter of each outline vertex, as a share of one segment. */
  angleJitter: 0.25,
  /** Radius noise shared by every layer at one vertex. */
  radiusJitter: 0.05,
  /** Extra radius noise per layer, so beds don't share an exact outline. */
  layerJitter: 0.08,
  /** How far the cap's centre rises above its rim. */
  capRise: 0.03,
  /** Ledge colour: dusted when it faces up, shaded when it is an overhang. */
  ledgeDust: 0.55,
  ledgeShade: 0.65,
}

/**
 * Stacks irregular rings into layered rock. All layers share one angular
 * profile, so the silhouette stays coherent while ledges form where a
 * layer is narrower or wider than its neighbour.
 */
export function buildStrata({ seed, layers, segments, stretch, lean, capColor, sink, roughness }: StrataOptions): THREE.BufferGeometry {
  const shape = STRATA_SHAPE
  const rng = createRng(seed)
  const harmonics = shape.harmonics.map((k) => ({
    k,
    amp: (rng.range(...shape.amplitude) / (k * shape.falloff)) * roughness,
    phase: rng.range(0, Math.PI * 2),
  }))
  const angles = Array.from({ length: segments }, (_, i) => ((i + rng.range(-shape.angleJitter, shape.angleJitter)) / segments) * Math.PI * 2)
  const profile = angles.map(
    (a) => 1 + harmonics.reduce((sum, h) => sum + h.amp * Math.sin(h.k * a + h.phase), 0) + rng.range(-shape.radiusJitter, shape.radiusJitter),
  )
  const leanAngle = rng.range(0, Math.PI * 2)
  const leanX = Math.cos(leanAngle) * lean
  const leanZ = Math.sin(leanAngle) * lean

  const ring = (y: number, radius: number, layer: number) =>
    angles.map((a, i) => {
      const r = radius * profile[i] * (1 + (hash01(seed, layer, i) - 0.5) * shape.layerJitter)
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
      color.copy(layer.color).multiplyScalar(WALL_TONE.base + hash01(seed, k, i, 5) * WALL_TONE.range)
      builder.quad(bottom[i], bottom[i1], top[i1], top[i], color, outward)
    }

    const next = layers[k + 1]
    if (next) {
      // Ledge between this layer's top and the next layer's base.
      const nextBottom = ring(y + layer.height, next.radius, k + 1)
      const facingUp = next.radius < topRadius
      color.copy(facingUp ? layer.color.clone().lerp(DUST, shape.ledgeDust) : layer.color.clone().multiplyScalar(shape.ledgeShade))
      for (let i = 0; i < segments; i++) {
        const i1 = (i + 1) % segments
        builder.quad(top[i], top[i1], nextBottom[i1], nextBottom[i], color, facingUp ? UP : DOWN)
      }
    } else {
      const apex = top.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(segments)
      apex.y += shape.capRise
      for (let i = 0; i < segments; i++) {
        color.copy(capColor).multiplyScalar(CAP_TONE.base + hash01(seed, i, 9) * CAP_TONE.range)
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

/** Outline, joints, bedding and shading of a lofted rock body (`buildRockMass`). */
const ROCK_MASS_SHAPE = {
  /** Low harmonics that wobble the footprint; amplitude falls off as 1 / √k. */
  harmonics: [1, 2, 3, 4],
  amplitude: [0.03, 0.1] as Range,
  /** Angular jitter of each outline vertex, as a share of one segment. */
  angleJitter: 0.3,
  /** Per-vertex outline noise, scaled by roughness. */
  outlineJitter: 0.04,
  /** Vertical joints: angular width (radians), radius bite, and the height share where each starts. */
  joint: { width: [0.16, 0.3] as Range, depth: [0.16, 0.32] as Range, start: [0.2, 0.5] as Range, opening: 0.25 },
  /** Bed tilt, in normalised height across the body. */
  dip: [0.03, 0.08] as Range,
  /** Per-vertex noise on ring heights and radii. */
  heightJitter: 0.04,
  radiusJitter: 0.07,
  /** Cap apex offset: horizontal as a share of radius, vertical as a share of height. */
  apexShift: [-0.05, 0.05] as Range,
  apexRise: [-0.02, 0.05] as Range,
  /** Dust on upward-facing ledges: blend from `from` to `to` normal.y, up to `amount`. */
  dust: { from: 0.45, to: 0.9, amount: 0.5 },
  /** Overhangs (normal.y below `below`) stay in shade. */
  overhang: { below: -0.2, darken: 0.72 },
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
  const shape = ROCK_MASS_SHAPE
  const rng = createRng(seed)
  const harmonics = shape.harmonics.map((k) => ({ k, amp: (rng.range(...shape.amplitude) / Math.sqrt(k)) * roughness, phase: rng.range(0, Math.PI * 2) }))
  const angles = Array.from({ length: segments }, (_, i) => ((i + rng.range(-shape.angleJitter, shape.angleJitter)) / segments) * Math.PI * 2)
  const outline = angles.map(
    (a) => 1 + harmonics.reduce((sum, h) => sum + h.amp * Math.sin(h.k * a + h.phase), 0) + rng.range(-shape.outlineJitter, shape.outlineJitter) * roughness,
  )
  const cuts = Array.from({ length: joints }, () => ({
    angle: rng.range(0, Math.PI * 2),
    width: rng.range(...shape.joint.width),
    depth: rng.range(...shape.joint.depth),
    start: rng.range(...shape.joint.start),
  }))
  const slumpAngle = rng.range(0, Math.PI * 2)
  const leanAngle = rng.range(0, Math.PI * 2)
  const leanX = Math.cos(leanAngle) * lean
  const leanZ = Math.sin(leanAngle) * lean
  // Beds dip gently toward one side: tilted strata read as real geology, flat rings as cake.
  const dipAngle = rng.range(0, Math.PI * 2)
  const dip = rng.range(...shape.dip)

  const topAt = angles.map((a) => height * (1 - slump * Math.max(0, Math.cos(a - slumpAngle)) ** 2))
  const notchAt = (i: number, t: number) =>
    cuts.reduce((f, c) => {
      const diff = Math.atan2(Math.sin(angles[i] - c.angle), Math.cos(angles[i] - c.angle))
      return f * (1 - c.depth * Math.exp(-((diff / c.width) ** 2)) * smoothstep(c.start, c.start + shape.joint.opening, t))
    }, 1)
  const vertex = (i: number, t: number, ring: number) => {
    const y = t * topAt[i] * (1 + (hash01(seed, i, ring, 3) - 0.5) * shape.heightJitter)
    const r = radius * profile(t) * outline[i] * notchAt(i, t) * (1 + (hash01(seed, i, ring) - 0.5) * shape.radiusJitter)
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
  const { dust, overhang } = shape
  const bandAt = (t: number) => (bands.find((b) => t <= b.top) ?? bands[bands.length - 1]).color
  const wall = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, base: THREE.Color, face: number) => {
    outward.set(a.x + b.x, 0, a.z + b.z)
    normal.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a)).normalize()
    if (normal.dot(outward) < 0) normal.negate()
    color.copy(base).multiplyScalar(WALL_TONE.base + hash01(seed, face, 5) * WALL_TONE.range)
    // Dust settles on upward-facing ledges; overhangs stay in shade.
    if (normal.y > dust.from) color.lerp(DUST, smoothstep(dust.from, dust.to, normal.y) * dust.amount)
    if (normal.y < overhang.below) color.multiplyScalar(overhang.darken)
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
  apex.x += rng.range(...shape.apexShift) * radius
  apex.z += rng.range(...shape.apexShift) * radius
  apex.y += rng.range(...shape.apexRise) * height
  for (let i = 0; i < segments; i++) {
    color.copy(capColor).multiplyScalar(CAP_TONE.base + hash01(seed, i, 9) * CAP_TONE.range)
    builder.triangle(top[i], top[(i + 1) % segments], apex, color, UP)
  }
  return builder.build()
}

/** Random-thickness beds (`randomBands`), in normalised height. */
const RANDOM_BANDS = {
  thickness: [0.08, 0.3] as Range,
  /** Palette entries skipped between beds, so neighbours never repeat a tone. */
  paletteStep: [1, 2] as Range,
  /** The last bed may end above the top so the uppermost ring is still coloured. */
  maxTop: 1.2,
}

/** Random-thickness beds from a palette, so strata never repeat at a fixed rhythm. */
function randomBands(rng: Rng, palette: readonly THREE.Color[], from = 0) {
  const bands: { top: number; color: THREE.Color }[] = []
  let t = from
  let index = rng.int(0, palette.length - 1)
  while (t < 1) {
    t += rng.range(...RANDOM_BANDS.thickness)
    index = (index + rng.int(...RANDOM_BANDS.paletteStep)) % palette.length
    bands.push({ top: Math.min(t, RANDOM_BANDS.maxTop), color: palette[index] })
  }
  return bands
}

/**
 * Erosion profile shared by buttes and mesas, as a radius multiplier at
 * normalised height t: a flared talus foot up to `footTop`, flanks tapering
 * by `flankTaper`, and a caprock that overhangs by `capOverhang` from `capFrom`.
 */
interface TaperedProfile {
  footTop: number
  footRadius: number
  footSlope: number
  flankTaper: number
  capFrom: number
  capOverhang: number
}

const taperedProfile =
  ({ footTop, footRadius, footSlope, flankTaper, capFrom, capOverhang }: TaperedProfile) =>
  (t: number) =>
    (t < footTop ? footRadius - footSlope * t : 1 - flankTaper * t) + (t >= capFrom ? capOverhang : 0)

const BASE = new THREE.Color(PALETTE.rock[1])

export interface SedimentaryFormationOptions {
  seed: number
  scale?: number
}

/** Butte recipe (`createSedimentaryFormation`); sizes in world units at scale 1. */
const BUTTE = {
  height: [0.8, 1.1] as Range,
  radius: 0.52,
  // Talus-flared foot, then flanks that taper by a third: a trapezoid, not a drum.
  profile: { footTop: 0.1, footRadius: 1.08, footSlope: 1.1, flankTaper: 0.34, capFrom: 0.88, capOverhang: 0.05 },
  levels: [0, 0.1, 0.28, 0.46, 0.62, 0.76, 0.86, 0.9, 1],
  segments: 11,
  /** Elongated along local X (callers align it with the wind). */
  stretch: { x: [1.15, 1.4] as Range, z: [0.75, 0.92] as Range },
  roughness: 1.8,
  slump: [0.15, 0.38] as Range,
  joints: [1, 2] as Range,
  lean: 0.04,
  sink: 0.22,
  flare: 1.32,
  capDust: 0.45,
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
    height: rng.range(...BUTTE.height),
    radius: BUTTE.radius,
    profile: taperedProfile(BUTTE.profile),
    levels: BUTTE.levels,
    segments: BUTTE.segments,
    stretch: [rng.range(...BUTTE.stretch.x), rng.range(...BUTTE.stretch.z)],
    roughness: BUTTE.roughness,
    slump: rng.range(...BUTTE.slump),
    joints: rng.int(...BUTTE.joints),
    lean: BUTTE.lean,
    sink: BUTTE.sink,
    flare: BUTTE.flare,
    bands: randomBands(rng, STRATA),
    capColor: STRATA[STRATUM.dark].clone().lerp(DUST, BUTTE.capDust),
    baseColor: BASE,
  })
  geometry.scale(scale, scale, scale)
  return formationMesh(geometry, 'sedimentary-formation')
}

export interface RockPillarOptions {
  seed: number
  height?: number
}

/** Rock pillar recipe (`createRockPillar`), heights as shares of the pillar's height. */
const PILLAR = {
  radius: 0.32,
  /** Narrowest radius multiplier, just under the cap. */
  neck: [0.66, 0.76] as Range,
  /** Flared foot radius, narrowing to the neck between `taperFrom` and `taperTo`. */
  footRadius: 1.05,
  taperFrom: 0.04,
  taperTo: 0.78,
  /** The column ends at `columnTop`; the neck holds until `capFrom`, then the cap narrows over `capSpan`. */
  columnTop: 0.8,
  capFrom: 0.85,
  capSpan: 0.15,
  capRadius: 0.82,
  capNarrowing: 0.16,
  levels: [0, 0.1, 0.25, 0.42, 0.58, 0.72, 0.8, 0.85, 1],
  segments: 7,
  /** Elongated along local X, like a yardang. */
  stretch: { x: [1.15, 1.35] as Range, z: [0.8, 0.95] as Range },
  roughness: 1.6,
  slump: [0.1, 0.25] as Range,
  joints: 1,
  lean: [0.08, 0.15] as Range,
  sink: 0.16,
  flare: 1.35,
  /** How far the cap rock's tone moves from the dark stratum toward orange. */
  capRockMix: 0.45,
  /** A thin rust bed under the cap rock; the cap rock band runs past the top. */
  underCapTop: 0.82,
  capBandTop: 2,
  capDust: 0.3,
}

/**
 * Wind-carved spire (yardang-like): a flared foot narrowing to a pinched
 * neck under a darker, wider cap rock, elongated along local X.
 */
export function createRockPillar({ seed, height = 1.6 }: RockPillarOptions): THREE.Mesh {
  const p = PILLAR
  const rng = createRng(hash(seed, 0x9111))
  const neck = rng.range(...p.neck)
  // Cap rock only a little darker than the column: a hoodoo, not a mushroom.
  const capRock = STRATA[STRATUM.dark].clone().lerp(STRATA[STRATUM.orange], p.capRockMix)
  const geometry = buildRockMass({
    seed: hash(seed, 2),
    height,
    radius: p.radius,
    profile: (t) =>
      t < p.columnTop
        ? p.footRadius - (p.footRadius - neck) * smoothstep(p.taperFrom, p.taperTo, t)
        : t < p.capFrom
          ? neck
          : p.capRadius - p.capNarrowing * ((t - p.capFrom) / p.capSpan),
    levels: p.levels,
    segments: p.segments,
    stretch: [rng.range(...p.stretch.x), rng.range(...p.stretch.z)],
    roughness: p.roughness,
    slump: rng.range(...p.slump),
    joints: p.joints,
    lean: rng.range(...p.lean),
    sink: p.sink,
    flare: p.flare,
    bands: [
      // Every tone but the dark one (last in the palette), which is kept for the cap rock.
      ...randomBands(rng, STRATA.slice(0, STRATUM.dark)).filter((b) => b.top < p.columnTop),
      { top: p.underCapTop, color: STRATA[STRATUM.rust] },
      { top: p.capBandTop, color: capRock },
    ],
    capColor: capRock.clone().lerp(DUST, p.capDust),
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

/** Mesa recipe (`createMesa`); the footprint comes from `width` and `depth`. */
const MESA = {
  profile: { footTop: 0.3, footRadius: 1.14, footSlope: 0.47, flankTaper: 0.06, capFrom: 0.9, capOverhang: 0.03 },
  levels: [0, 0.18, 0.3, 0.48, 0.64, 0.8, 0.9, 0.93, 1],
  segments: 18,
  roughness: 1.9,
  slump: [0.05, 0.15] as Range,
  joints: [2, 3] as Range,
  sink: 0.18,
  flare: 1.25,
  /** The talus apron is one rust bed up to this height; light beds start above it. */
  talusTop: 0.28,
  capDust: 0.4,
  /** Random turn about Y, in radians. */
  turn: [-0.3, 0.3] as Range,
}

/**
 * Broad flat-topped table with a lobate, embayed outline: talus apron, then
 * steep banded cliffs (light beds only) under a thin dusty caprock.
 */
export function createMesa({ seed, width = 2.4, depth = 2, height = 1 }: MesaOptions): THREE.Mesh {
  const rng = createRng(hash(seed, 0x3e5a))
  // Light bands only: cream, pale orange, orange (the darkest strata read as a "cake filling").
  const light = [STRATUM.cream, STRATUM.paleOrange, STRATUM.orange].map((k) => STRATA[k])
  const geometry = buildRockMass({
    seed: hash(seed, 3),
    height,
    radius: 1,
    profile: taperedProfile(MESA.profile),
    levels: MESA.levels,
    segments: MESA.segments,
    // Unit radius, so half the requested footprint on each axis.
    stretch: [width / 2, depth / 2],
    roughness: MESA.roughness,
    slump: rng.range(...MESA.slump),
    joints: rng.int(...MESA.joints),
    lean: 0,
    sink: MESA.sink,
    flare: MESA.flare,
    bands: [{ top: MESA.talusTop, color: new THREE.Color(PALETTE.rock[0]) }, ...randomBands(rng, light, MESA.talusTop)],
    capColor: new THREE.Color(PALETTE.rocky).lerp(DUST, MESA.capDust),
    baseColor: BASE,
  })
  geometry.rotateY(rng.range(...MESA.turn))
  return formationMesh(geometry, 'mesa')
}
