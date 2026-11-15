import * as THREE from 'three'
import { buildStrata, type StrataLayer } from './formations'
import { FacetBuilder, merge, painted, placement, UP } from './geometry'
import { createRng, hash, hash01, type Range, type Rng } from './noise'
import { materials } from './palette'
import type { MineralFeature } from './reliefMap'
import { createMartianRockGeometry } from './rocks'

/**
 * Mineral deposits modelled on minerals documented on Mars, stylised and
 * exaggerated in size so they read from a gameplay camera. Visual concepts
 * only: no resource economics, just a `userData.kind` tag. Where a deposit
 * appears is decided separately by the distribution rules in
 * `mineralDistribution.ts`; procedurally placed deposits are game dressing,
 * not claims about real Martian locations.
 *
 * - hematite: grey hematite concretions ("blueberries") weathering out of
 *   light sulfate-rich sandstone, as Opportunity found at Meridiani Planum.
 * - gypsum: bright calcium-sulfate veins filling fractures in bedrock, like
 *   Opportunity's "Homestake" vein and Curiosity's veins in Gale crater.
 * - olivine: dark basalt and basaltic sand with olive-green grains, after
 *   Curiosity's CheMin detection of olivine in Rocknest soil.
 * - sulfur: pale yellow elemental-sulfur crystals inside a crushed pale rock,
 *   as Curiosity revealed in Gediz Vallis (2024). Kept rare.
 *
 * Each deposit is a group of a matte host mesh and a `materials.mineral()`
 * mesh flagged `userData.exposed`, which placement keeps above the terrain.
 *
 * Sizes below are in deposit units: at `size` 1 a deposit fits inside one
 * grid cell. Counts and sizes given as `[min, max]` are drawn per deposit.
 */

interface MineralAppearance {
  /** The mineral itself: grains, concretions, veins or crystals. */
  mineral: readonly string[]
  /** Rock the mineral sits in. */
  host: readonly string[]
  /** Loose sand the deposit rests in, when it has one. */
  sand?: string
  /** Ground stain around a placed deposit that makes it legible from the map view. */
  halo: { color: string; amount: number }
}

/**
 * Visual definition of each mineral family (sRGB hex). Minerals keep their
 * real visible colours, slightly pushed so they read against the rust
 * terrain, and never glow. They are kept out of the shared landscape palette
 * (`palette.ts`) because they belong to the mineral, not to the landscape.
 */
export const MINERAL_APPEARANCE = {
  /** Hematite concretions ("blueberries", Meridiani Planum): dark steel-grey in light, sulfate-rich sandstone (Burns formation). */
  hematite: {
    mineral: ['#4c5059', '#5f6470', '#3a3d45'],
    host: ['#d9a374', '#c98d61', '#e4b88a', '#a9654a'],
    halo: { color: '#6e4a4f', amount: 0.5 },
  },
  /** Calcium-sulfate (gypsum) veins, e.g. "Homestake": off-white to cream, through darker fractured bedrock. */
  gypsum: {
    mineral: ['#f4eedf', '#e7dcc4', '#fbf7ee'],
    host: ['#9d4c3a', '#b05a40', '#8a4234'],
    halo: { color: '#f1dcc0', amount: 0.55 },
  },
  /** Olivine grains: muted olive, not emerald, in charcoal-brown basalt on dark basaltic sand. */
  olivine: {
    mineral: ['#7a8a40', '#8f9c4f', '#65722f'],
    host: ['#3e3833', '#4a423b', '#332f2c'],
    sand: '#5c4438',
    halo: { color: '#6a4a3c', amount: 0.42 },
  },
  /** Elemental sulfur (Gediz Vallis, 2024): muted yellow in pale, crushed host rock. */
  sulfur: {
    mineral: ['#d8c35c', '#c6ab42', '#eadb8f'],
    host: ['#dcbc94', '#cba37a', '#e6cba6'],
    halo: { color: '#e6cf86', amount: 0.6 },
  },
} as const satisfies Record<MineralFeature, MineralAppearance>

export interface MineralOptions {
  seed: number
  /** Uniform scale; 1 fits comfortably inside one grid cell. */
  size?: number
}

/** One outcrop bed: its thickness range, bottom radius and index into the host palette. */
interface BedSpec {
  height: Range
  radius: number
  tone: number
}

/** Shape of the shared building blocks below. */
const NODULE = {
  /** Squash of a concretion: x/z stay near round, y is slightly flattened. */
  scaleXZ: [0.9, 1.1] as Range,
  scaleY: [0.82, 1] as Range,
}
const GRAIN = {
  /** Width jitter of a grain or crystal. */
  widthJitter: [0.85, 1.15] as Range,
  /** Random tilt off vertical, in radians. */
  tilt: [-0.5, 0.5] as Range,
}
const OUTCROP = {
  /** Each bed narrows to this share of its radius at its top. */
  taper: 0.93,
  segments: 9,
  sink: 0.04,
  roughness: 1.6,
  /** Things set "on top" sit this far below the cap's highest point, among its facets. */
  topInset: 0.03,
}

const tones = (hexes: readonly string[]) => hexes.map((hex) => new THREE.Color(hex))

/** Lumpy low-poly ball: a 20-face icosahedron squashed a little. */
function nodule(rng: Rng, x: number, y: number, z: number, radius: number, color: THREE.Color): THREE.BufferGeometry {
  const scale = new THREE.Vector3(rng.range(...NODULE.scaleXZ), rng.range(...NODULE.scaleY), rng.range(...NODULE.scaleXZ)).multiplyScalar(radius)
  return painted(new THREE.IcosahedronGeometry(1, 0), color, placement(x, y, z, rng.range(0, Math.PI * 2), scale))
}

/** Angular grain or crystal: an octahedron, optionally stretched into a bipyramid. */
function grain(rng: Rng, x: number, y: number, z: number, radius: number, elongation: number, color: THREE.Color) {
  const geometry = painted(new THREE.OctahedronGeometry(1, 0), color)
  geometry.scale(radius * rng.range(...GRAIN.widthJitter), radius * elongation, radius * rng.range(...GRAIN.widthJitter))
  geometry.rotateZ(rng.range(...GRAIN.tilt))
  geometry.rotateY(rng.range(0, Math.PI * 2))
  return geometry.translate(x, y, z)
}

/** Recolours a random share of a rock's faces: inclusions and phenocrysts. */
function speckle(geometry: THREE.BufferGeometry, seed: number, share: number, palette: THREE.Color[]): THREE.BufferGeometry {
  const color = geometry.getAttribute('color')
  for (let face = 0; face < color.count / 3; face++) {
    if (hash01(seed, face, 0x5bec) >= share) continue
    const tone = palette[face % palette.length]
    for (let k = 0; k < 3; k++) color.setXYZ(face * 3 + k, tone.r, tone.g, tone.b)
  }
  return geometry
}

function deposit(kind: MineralFeature, host: THREE.BufferGeometry[], minerals: THREE.BufferGeometry[], size: number): THREE.Group {
  const group = new THREE.Group()
  group.name = `${kind}-deposit`
  group.userData.kind = `mineral:${kind}`
  const hostMesh = new THREE.Mesh(merge(host), materials.matte())
  hostMesh.name = `${kind}-host`
  const mineralMesh = new THREE.Mesh(merge(minerals), materials.mineral())
  mineralMesh.name = `${kind}-mineral`
  mineralMesh.userData.exposed = true
  for (const mesh of [hostMesh, mineralMesh]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  group.scale.setScalar(size)
  return group
}

/** Draws each bed's thickness (in order) and paints it from the host palette. */
const bedsFrom = (rng: Rng, specs: readonly BedSpec[], host: readonly THREE.Color[]) =>
  specs.map((spec) => ({ height: rng.range(...spec.height), radius: spec.radius, color: host[spec.tone] }))

/** Low, thin-bedded outcrop; returns its geometry and the height of its top. */
function outcrop(rng: Rng, seed: number, beds: { height: number; radius: number; color: THREE.Color }[], cap: THREE.Color, stretch: [number, number]) {
  const layers: StrataLayer[] = beds.map((bed) => ({ ...bed, taper: OUTCROP.taper }))
  const geometry = buildStrata({ seed, layers, segments: OUTCROP.segments, stretch, lean: 0, capColor: cap, sink: OUTCROP.sink, roughness: OUTCROP.roughness })
  geometry.rotateY(rng.range(0, Math.PI * 2))
  geometry.computeBoundingBox()
  return { geometry, top: geometry.boundingBox!.max.y - OUTCROP.topInset }
}

/** Hematite recipe (`createHematiteDeposit`). */
const HEMATITE = {
  stretch: { x: [1.05, 1.25] as Range, z: [0.82, 0.95] as Range },
  // The middle bed is the darker, iron-stained one.
  beds: [
    { height: [0.07, 0.09], radius: 0.44, tone: 1 },
    { height: [0.06, 0.08], radius: 0.4, tone: 3 },
    { height: [0.07, 0.09], radius: 0.37, tone: 0 },
  ] satisfies BedSpec[],
  capTone: 2,
  /** Concretions embedded in the top: spread radius, and how much of each sphere is buried. */
  bed: { count: [14, 18] as Range, spread: 0.26, radius: [0.055, 0.085] as Range, embed: 0.2 },
  /** Concretions weathering out of the bed faces, on an ellipse just inside the outcrop. */
  face: { count: [5, 7] as Range, radius: [0.045, 0.06] as Range, reachX: 0.37, reachZ: 0.35, minY: 0.06, belowTop: 0.04 },
  /**
   * Lag fan: loose spheres rolled off one side. `spread` (0 near, 1 far) widens
   * the fan, pushes spheres out and shrinks them; they rest slightly sunk.
   */
  lag: {
    count: [12, 16] as Range,
    fanWidth: { base: 0.5, perSpread: 0.6 },
    distance: { base: 0.46, perSpread: 0.4 },
    radius: [0.04, 0.065] as Range,
    shrink: 0.3,
    rest: 0.95,
  },
}

/** Grey hematite "blueberries" weathering out of pale sandstone, with a lag of loose spheres around it. */
export function createHematiteDeposit({ seed, size = 1 }: MineralOptions): THREE.Group {
  const { bed, face, lag } = HEMATITE
  const rng = createRng(hash(seed, 0x4e3a))
  const host = tones(MINERAL_APPEARANCE.hematite.host)
  const grey = tones(MINERAL_APPEARANCE.hematite.mineral)
  const stretch: [number, number] = [rng.range(...HEMATITE.stretch.x), rng.range(...HEMATITE.stretch.z)]
  const { geometry, top } = outcrop(rng, hash(seed, 1), bedsFrom(rng, HEMATITE.beds, host), host[HEMATITE.capTone], stretch)
  const berries: THREE.BufferGeometry[] = []
  // A dense bed of concretions embedded in the top, partly exposed: the deposit's signature.
  for (let n = rng.int(...bed.count); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = Math.sqrt(rng.next()) * bed.spread
    const r = rng.range(...bed.radius)
    berries.push(nodule(rng, Math.cos(angle) * distance, top - r * bed.embed, Math.sin(angle) * distance, r, rng.pick(grey)))
  }
  // Weathering out of the bed faces.
  for (let n = rng.int(...face.count); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const r = rng.range(...face.radius)
    berries.push(nodule(rng, Math.cos(angle) * face.reachX, rng.range(face.minY, top - face.belowTop), Math.sin(angle) * face.reachZ, r, rng.pick(grey)))
  }
  // Lag fan: loose spheres rolled off one side and thinning out across the ground.
  const fan = rng.range(0, Math.PI * 2)
  for (let n = rng.int(...lag.count); n > 0; n--) {
    const spread = rng.range(0, 1)
    const angle = fan + rng.range(-1, 1) * (lag.fanWidth.base + lag.fanWidth.perSpread * spread)
    const distance = lag.distance.base + spread * lag.distance.perSpread
    const r = rng.range(...lag.radius) * (1 - lag.shrink * spread)
    berries.push(nodule(rng, Math.cos(angle) * distance, r * lag.rest, Math.sin(angle) * distance, r, rng.pick(grey)))
  }
  return deposit('hematite', [geometry], berries, size)
}

/** Gypsum recipe (`createGypsumDeposit`). */
const GYPSUM = {
  beds: [
    { height: [0.1, 0.13], radius: 0.46, tone: 0 },
    { height: [0.07, 0.09], radius: 0.42, tone: 1 },
  ] satisfies BedSpec[],
  capTone: 1,
  /** Footprint stretch along X; Z stays at 1. */
  stretchX: [1.1, 1.25] as Range,
  /**
   * Veins: the first (main) vein is longer and wider; the others cross it at
   * `crossAngle` radians. Each is drawn as `kinks` straight blocks whose joints
   * wander by `wobble`, overlapping by `overlap` × width so the line is unbroken.
   */
  veins: {
    count: [3, 4] as Range,
    crossAngle: [0.7, 2.4] as Range,
    /** Sideways offset from the slab centre. */
    offset: [-0.14, 0.14] as Range,
    mainReach: 0.38,
    reach: [0.2, 0.32] as Range,
    mainWidth: [0.07, 0.085] as Range,
    width: [0.045, 0.06] as Range,
    kinks: 3,
    wobble: [-0.03, 0.03] as Range,
    overlap: 0.6,
  },
  /** Vein cross-section: a triangular prism, slightly taller than wide, partly proud of the top. */
  ridge: { radiusPerWidth: 0.62, heightStretch: 1.15, rise: 0.35 },
  /** The main vein's seam down the slab face: a box a little wider than the vein, pushed just outside the face. */
  seam: { widthScale: 1.1, extraHeight: 0.02, outward: 1.04, lift: 0.005 },
  /** Fracture debris: angular host chips around the slab. */
  debris: { count: [2, 3] as Range, scale: [0.12, 0.18] as Range, distanceX: [0.42, 0.55] as Range, distanceZ: [0.4, 0.5] as Range, sink: 0.01 },
  /** Broken vein chips scattered on the ground. */
  chips: { count: [6, 8] as Range, radius: [0.03, 0.045] as Range, distance: [0.45, 0.6] as Range, rest: 0.72, elongation: 0.7 },
}

/** Fractured bedrock pavement cut by bright, slightly protruding gypsum veins. */
export function createGypsumDeposit({ seed, size = 1 }: MineralOptions): THREE.Group {
  const { veins: vein, ridge: ridgeShape, seam, debris, chips } = GYPSUM
  const rng = createRng(hash(seed, 0x6795))
  const host = tones(MINERAL_APPEARANCE.gypsum.host)
  const white = tones(MINERAL_APPEARANCE.gypsum.mineral)
  const beds = bedsFrom(rng, GYPSUM.beds, host)
  const { geometry, top } = outcrop(rng, hash(seed, 2), beds, host[GYPSUM.capTone], [rng.range(...GYPSUM.stretchX), 1])
  const hostParts = [geometry]
  const veins: THREE.BufferGeometry[] = []
  /** A vein segment: a low triangular ridge along local X, apex up, base embedded at height `y`. */
  const ridge = (x: number, z: number, length: number, width: number, y: number, angle: number) => {
    const r = width * ridgeShape.radiusPerWidth
    const prism = new THREE.CylinderGeometry(r, r, length, 3, 1).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2).scale(1, ridgeShape.heightStretch, 1)
    veins.push(painted(prism, rng.pick(white), placement(x, y + r * ridgeShape.rise, z, angle)))
  }

  const main = rng.range(0, Math.PI)
  for (let v = rng.int(...vein.count), k = 0; k < v; k++) {
    // Veins cross the slab as kinked lines; each kink is its own block. Gypsum
    // outlasts the host rock, so the veins stand proud of the surface.
    const isMain = k === 0
    const angle = main + (isMain ? 0 : rng.range(...vein.crossAngle))
    const offset = rng.range(...vein.offset)
    const reach = isMain ? vein.mainReach : rng.range(...vein.reach)
    const width = isMain ? rng.range(...vein.mainWidth) : rng.range(...vein.width)
    const dir = { x: Math.cos(angle), z: Math.sin(angle) }
    const across = { x: -dir.z * offset, z: dir.x * offset }
    let px = across.x - dir.x * reach
    let pz = across.z - dir.z * reach
    for (let s = 1; s <= vein.kinks; s++) {
      const t = -reach + (2 * reach * s) / vein.kinks
      const qx = across.x + dir.x * t + rng.range(...vein.wobble)
      const qz = across.z + dir.z * t + rng.range(...vein.wobble)
      ridge((px + qx) / 2, (pz + qz) / 2, Math.hypot(qx - px, qz - pz) + width * vein.overlap, width, top, -Math.atan2(qz - pz, qx - px))
      px = qx
      pz = qz
    }
    // The main vein also shows as a bright seam down the fractured slab face.
    if (isMain) {
      const seamHeight = top + seam.extraHeight
      const seamBox = new THREE.BoxGeometry(width * seam.widthScale, seamHeight, width)
      veins.push(painted(seamBox, rng.pick(white), placement(px * seam.outward, seamHeight / 2 + seam.lift, pz * seam.outward, -angle)))
    }
  }
  // Fracture debris and broken vein chips.
  for (let n = rng.int(...debris.count); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const rock = createMartianRockGeometry({ seed: hash(seed, n, 0x6d), scale: rng.range(...debris.scale), variant: 'angular', palette: MINERAL_APPEARANCE.gypsum.host })
    hostParts.push(rock.translate(Math.cos(angle) * rng.range(...debris.distanceX), -debris.sink, Math.sin(angle) * rng.range(...debris.distanceZ)))
  }
  for (let n = rng.int(...chips.count); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const r = rng.range(...chips.radius)
    veins.push(grain(rng, Math.cos(angle) * rng.range(...chips.distance), r * chips.rest, Math.sin(angle) * rng.range(...chips.distance), r, chips.elongation, rng.pick(white)))
  }
  return deposit('gypsum', hostParts, veins, size)
}

/**
 * Sand drift under the olivine deposit: an apex, an inner ring at `mid`
 * radius and `shoulder` height, and a rim ring at `rimRadius` just below
 * ground. Rings are stretched by `aspectX`/`aspectZ` and jittered radially.
 */
const SAND_DRIFT = {
  spokes: 11,
  peak: 0.07,
  /** Horizontal jitter of the apex. */
  apexShift: [-0.05, 0.05] as Range,
  shoulder: 0.035,
  mid: 0.32,
  midJitter: 0.15,
  rimRadius: 0.6,
  rimY: -0.012,
  rimJitter: 0.18,
  aspectX: 1.12,
  aspectZ: 0.9,
  /** Brightness of the sunlit top facets and of the flank facets. */
  topTone: [1, 1.12] as Range,
  flankTone: [0.88, 1] as Range,
}

/**
 * Irregular, low sand drift (like the Rocknest sand shadow where Curiosity
 * found olivine): a faceted mound whose rim dips just below y = 0.
 * Returns the geometry and its height profile by distance from the centre.
 */
function sandDrift(rng: Rng, color: THREE.Color) {
  const { spokes, peak, shoulder, mid, rimRadius, rimY } = SAND_DRIFT
  const builder = new FacetBuilder()
  const tone = new THREE.Color()
  const apex = new THREE.Vector3(rng.range(...SAND_DRIFT.apexShift), peak, rng.range(...SAND_DRIFT.apexShift))
  const ring = (radius: number, y: number, jitter: number) =>
    Array.from({ length: spokes }, (_, k) => {
      const angle = (k / spokes) * Math.PI * 2
      const r = radius * rng.range(1 - jitter, 1 + jitter)
      return new THREE.Vector3(Math.cos(angle) * r * SAND_DRIFT.aspectX, y, Math.sin(angle) * r * SAND_DRIFT.aspectZ)
    })
  const inner = ring(mid, shoulder, SAND_DRIFT.midJitter)
  const rim = ring(rimRadius, rimY, SAND_DRIFT.rimJitter)
  for (let k = 0; k < spokes; k++) {
    const n = (k + 1) % spokes
    builder.triangle(apex, inner[k], inner[n], tone.copy(color).multiplyScalar(rng.range(...SAND_DRIFT.topTone)), UP)
    builder.quad(inner[k], rim[k], rim[n], inner[n], tone.copy(color).multiplyScalar(rng.range(...SAND_DRIFT.flankTone)), UP)
  }
  const heightAt = (d: number) => (d < mid ? peak + ((shoulder - peak) * d) / mid : shoulder + ((rimY - shoulder) * (d - mid)) / (rimRadius - mid))
  return { geometry: builder.build(), heightAt }
}

/** Olivine recipe (`createOlivineDeposit`). */
const OLIVINE = {
  /** Basalt blocks: one near the centre, the rest ringed around it, all sunk into the drift. */
  rocks: {
    count: [3, 4] as Range,
    angleJitter: 0.4,
    centreDistance: [0, 0.08] as Range,
    distance: [0.26, 0.36] as Range,
    centreScale: [0.5, 0.6] as Range,
    scale: [0.26, 0.36] as Range,
    sink: 0.03,
    /** Share of each block's faces recoloured as olive phenocrysts. */
    phenocrystShare: 0.38,
  },
  /** Loose olivine grains on the drift, resting partly above it, spread on a slight ellipse. */
  grains: { count: [14, 19] as Range, distance: [0.18, 0.5] as Range, radius: [0.035, 0.055] as Range, rest: 0.55, stretchX: 1.05, stretchZ: 0.85, elongation: 0.8 },
}

/** Angular dark basalt on a drift of basaltic sand, flecked with olive-green olivine. */
export function createOlivineDeposit({ seed, size = 1 }: MineralOptions): THREE.Group {
  const { rocks: rockSpec, grains: grainSpec } = OLIVINE
  const rng = createRng(hash(seed, 0x011e))
  const olive = tones(MINERAL_APPEARANCE.olivine.mineral)
  const drift = sandDrift(rng, new THREE.Color(MINERAL_APPEARANCE.olivine.sand))
  const hostParts = [drift.geometry]
  const start = rng.range(0, Math.PI * 2)
  const rocks = rng.int(...rockSpec.count)
  for (let k = 0; k < rocks; k++) {
    const isCentre = k === 0
    const angle = start + (k / rocks) * Math.PI * 2 + rng.range(-rockSpec.angleJitter, rockSpec.angleJitter)
    const distance = isCentre ? rng.range(...rockSpec.centreDistance) : rng.range(...rockSpec.distance)
    const rock = createMartianRockGeometry({
      seed: hash(seed, k, 0xba5),
      scale: isCentre ? rng.range(...rockSpec.centreScale) : rng.range(...rockSpec.scale),
      variant: 'angular',
      palette: MINERAL_APPEARANCE.olivine.host,
    })
    // Phenocrysts: olive facets on the dark basalt; rocks sit in the drift.
    const y = drift.heightAt(distance) - rockSpec.sink
    hostParts.push(speckle(rock, hash(seed, k), rockSpec.phenocrystShare, olive).translate(Math.cos(angle) * distance, y, Math.sin(angle) * distance))
  }
  const grains: THREE.BufferGeometry[] = []
  for (let n = rng.int(...grainSpec.count); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(...grainSpec.distance)
    const r = rng.range(...grainSpec.radius)
    const y = Math.max(drift.heightAt(distance), 0) + r * grainSpec.rest
    grains.push(grain(rng, Math.cos(angle) * distance * grainSpec.stretchX, y, Math.sin(angle) * distance * grainSpec.stretchZ, r, grainSpec.elongation, rng.pick(olive)))
  }
  return deposit('olivine', hostParts, grains, size)
}

/** Sulfur recipe (`createSulfurDeposit`). */
const SULFUR = {
  /** Fragments of one crushed rock, pushed apart and tipped outward by `tip` radians. */
  pieces: { count: [4, 5] as Range, angleJitter: 0.3, distance: [0.24, 0.3] as Range, scale: [0.28, 0.36] as Range, tip: 0.3, sink: 0.02 },
  /** Bipyramidal crystals in the opened core, standing `lift` radii up. */
  crystals: { count: [8, 11] as Range, distance: [0, 0.15] as Range, radius: [0.05, 0.08] as Range, lift: 2.2, elongation: 2.1 },
  /** Yellow fines spilled around the crushed rock. */
  fines: { count: [6, 9] as Range, distance: [0.38, 0.55] as Range, radius: [0.024, 0.038] as Range, lift: 1, elongation: 1 },
}

/** A pale rock cracked open around a nest of muted-yellow sulfur crystals. */
export function createSulfurDeposit({ seed, size = 1 }: MineralOptions): THREE.Group {
  const { pieces: pieceSpec, crystals: crystalSpec, fines } = SULFUR
  const rng = createRng(hash(seed, 0x5f))
  const yellow = tones(MINERAL_APPEARANCE.sulfur.mineral)
  const hostParts: THREE.BufferGeometry[] = []
  const pieces = rng.int(...pieceSpec.count)
  const start = rng.range(0, Math.PI * 2)
  for (let k = 0; k < pieces; k++) {
    // Fragments of one crushed rock, pushed apart and tipped outward.
    const angle = start + (k / pieces) * Math.PI * 2 + rng.range(-pieceSpec.angleJitter, pieceSpec.angleJitter)
    const distance = rng.range(...pieceSpec.distance)
    const rock = createMartianRockGeometry({ seed: hash(seed, k, 0x5f0), scale: rng.range(...pieceSpec.scale), variant: 'angular', palette: MINERAL_APPEARANCE.sulfur.host })
    rock.rotateZ(Math.cos(angle) * -pieceSpec.tip).rotateX(Math.sin(angle) * pieceSpec.tip)
    hostParts.push(rock.translate(Math.cos(angle) * distance, -pieceSpec.sink, Math.sin(angle) * distance))
  }
  const crystals: THREE.BufferGeometry[] = []
  // Bipyramidal crystals in the opened core.
  for (let n = rng.int(...crystalSpec.count); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(...crystalSpec.distance)
    const r = rng.range(...crystalSpec.radius)
    crystals.push(grain(rng, Math.cos(angle) * distance, r * crystalSpec.lift, Math.sin(angle) * distance, r, crystalSpec.elongation, rng.pick(yellow)))
  }
  // Yellow fines spilled around the crushed rock.
  for (let n = rng.int(...fines.count); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(...fines.distance)
    const r = rng.range(...fines.radius)
    crystals.push(grain(rng, Math.cos(angle) * distance, r * fines.lift, Math.sin(angle) * distance, r, fines.elongation, rng.pick(yellow)))
  }
  return deposit('sulfur', hostParts, crystals, size)
}

const FACTORIES: Record<MineralFeature, (options: MineralOptions) => THREE.Group> = {
  hematite: createHematiteDeposit,
  gypsum: createGypsumDeposit,
  olivine: createOlivineDeposit,
  sulfur: createSulfurDeposit,
}

export function createMineralDeposit(kind: MineralFeature, options: MineralOptions): THREE.Group {
  return FACTORIES[kind](options)
}
