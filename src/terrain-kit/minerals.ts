import * as THREE from 'three'
import { buildStrata, type StrataLayer } from './formations'
import { FacetBuilder, merge, painted, placement, UP } from './geometry'
import { createRng, hash, hash01, type Rng } from './noise'
import { PALETTE, materials } from './palette'
import { createMartianRockGeometry } from './rocks'

/**
 * Mineral deposits modelled on minerals documented on Mars, stylised and
 * exaggerated in size so they read from a gameplay camera. Visual concepts
 * only: no resource economics, just a `userData.kind` tag.
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
 */
export const MINERAL_KINDS = ['hematite', 'gypsum', 'olivine', 'sulfur'] as const
export type MineralKind = (typeof MINERAL_KINDS)[number]

export interface MineralOptions {
  seed: number
  /** Uniform scale; 1 fits comfortably inside one grid cell. */
  size?: number
}

const tones = (hexes: readonly string[]) => hexes.map((hex) => new THREE.Color(hex))

/** Lumpy low-poly ball: a 20-face icosahedron squashed a little. */
function nodule(rng: Rng, x: number, y: number, z: number, radius: number, color: THREE.Color): THREE.BufferGeometry {
  const scale = new THREE.Vector3(rng.range(0.9, 1.1), rng.range(0.82, 1), rng.range(0.9, 1.1)).multiplyScalar(radius)
  return painted(new THREE.IcosahedronGeometry(1, 0), color, placement(x, y, z, rng.range(0, Math.PI * 2), scale))
}

/** Angular grain or crystal: an octahedron, optionally stretched into a bipyramid. */
function grain(rng: Rng, x: number, y: number, z: number, radius: number, elongation: number, color: THREE.Color) {
  const geometry = painted(new THREE.OctahedronGeometry(1, 0), color)
  geometry.scale(radius * rng.range(0.85, 1.15), radius * elongation, radius * rng.range(0.85, 1.15))
  geometry.rotateZ(rng.range(-0.5, 0.5))
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

function deposit(kind: MineralKind, host: THREE.BufferGeometry[], minerals: THREE.BufferGeometry[], size: number): THREE.Group {
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

/** Low, thin-bedded outcrop; returns its geometry and the height of its top. */
function outcrop(rng: Rng, seed: number, beds: { height: number; radius: number; color: THREE.Color }[], cap: THREE.Color, stretch: [number, number]) {
  const layers: StrataLayer[] = beds.map((bed) => ({ ...bed, taper: 0.93 }))
  const geometry = buildStrata({ seed, layers, segments: 9, stretch, lean: 0, capColor: cap, sink: 0.04, roughness: 1.6 })
  geometry.rotateY(rng.range(0, Math.PI * 2))
  geometry.computeBoundingBox()
  return { geometry, top: geometry.boundingBox!.max.y - 0.03 }
}

/** Grey hematite "blueberries" weathering out of pale sandstone, with a lag of loose spheres around it. */
export function createHematiteDeposit({ seed, size = 1 }: MineralOptions): THREE.Group {
  const rng = createRng(hash(seed, 0x4e3a))
  const host = tones(PALETTE.hematiteHost)
  const grey = tones(PALETTE.hematite)
  const stretch: [number, number] = [rng.range(1.05, 1.25), rng.range(0.82, 0.95)]
  // The middle bed is the darker, iron-stained one.
  const { geometry, top } = outcrop(
    rng,
    hash(seed, 1),
    [
      { height: rng.range(0.07, 0.09), radius: 0.44, color: host[1] },
      { height: rng.range(0.06, 0.08), radius: 0.4, color: host[3] },
      { height: rng.range(0.07, 0.09), radius: 0.37, color: host[0] },
    ],
    host[2],
    stretch,
  )
  const berries: THREE.BufferGeometry[] = []
  // A dense bed of concretions embedded in the top, partly exposed: the deposit's signature.
  for (let n = rng.int(14, 18); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = Math.sqrt(rng.next()) * 0.26
    const r = rng.range(0.055, 0.085)
    berries.push(nodule(rng, Math.cos(angle) * distance, top - r * 0.2, Math.sin(angle) * distance, r, rng.pick(grey)))
  }
  // Weathering out of the bed faces.
  for (let n = rng.int(5, 7); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const r = rng.range(0.045, 0.06)
    berries.push(nodule(rng, Math.cos(angle) * 0.37, rng.range(0.06, top - 0.04), Math.sin(angle) * 0.35, r, rng.pick(grey)))
  }
  // Lag fan: loose spheres rolled off one side and thinning out across the ground.
  const fan = rng.range(0, Math.PI * 2)
  for (let n = rng.int(12, 16); n > 0; n--) {
    const spread = rng.range(0, 1)
    const angle = fan + rng.range(-1, 1) * (0.5 + 0.6 * spread)
    const distance = 0.46 + spread * 0.4
    const r = rng.range(0.04, 0.065) * (1 - 0.3 * spread)
    berries.push(nodule(rng, Math.cos(angle) * distance, r * 0.95, Math.sin(angle) * distance, r, rng.pick(grey)))
  }
  return deposit('hematite', [geometry], berries, size)
}

/** Fractured bedrock pavement cut by bright, slightly protruding gypsum veins. */
export function createGypsumDeposit({ seed, size = 1 }: MineralOptions): THREE.Group {
  const rng = createRng(hash(seed, 0x6795))
  const host = tones(PALETTE.gypsumHost)
  const white = tones(PALETTE.gypsum)
  const { geometry, top } = outcrop(
    rng,
    hash(seed, 2),
    [
      { height: rng.range(0.1, 0.13), radius: 0.46, color: host[0] },
      { height: rng.range(0.07, 0.09), radius: 0.42, color: host[1] },
    ],
    host[1],
    [rng.range(1.1, 1.25), 1],
  )
  const hostParts = [geometry]
  const veins: THREE.BufferGeometry[] = []
  /** A vein segment: a low triangular ridge along local X, apex up, base embedded at height `y`. */
  const ridge = (x: number, z: number, length: number, width: number, y: number, angle: number) => {
    const r = width * 0.62
    const prism = new THREE.CylinderGeometry(r, r, length, 3, 1).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1.15, 1)
    veins.push(painted(prism, rng.pick(white), placement(x, y + r * 0.35, z, angle)))
  }

  const main = rng.range(0, Math.PI)
  for (let v = rng.int(3, 4), k = 0; k < v; k++) {
    // Veins cross the slab as kinked lines; each kink is its own block. Gypsum
    // outlasts the host rock, so the veins stand proud of the surface.
    const angle = main + (k === 0 ? 0 : rng.range(0.7, 2.4))
    const offset = rng.range(-0.14, 0.14)
    const reach = k === 0 ? 0.38 : rng.range(0.2, 0.32)
    const width = k === 0 ? rng.range(0.07, 0.085) : rng.range(0.045, 0.06)
    const dir = { x: Math.cos(angle), z: Math.sin(angle) }
    const across = { x: -dir.z * offset, z: dir.x * offset }
    let px = across.x - dir.x * reach
    let pz = across.z - dir.z * reach
    for (let s = 1; s <= 3; s++) {
      const t = -reach + (2 * reach * s) / 3
      const qx = across.x + dir.x * t + rng.range(-0.03, 0.03)
      const qz = across.z + dir.z * t + rng.range(-0.03, 0.03)
      ridge((px + qx) / 2, (pz + qz) / 2, Math.hypot(qx - px, qz - pz) + width * 0.6, width, top, -Math.atan2(qz - pz, qx - px))
      px = qx
      pz = qz
    }
    // The main vein also shows as a bright seam down the fractured slab face.
    if (k === 0) veins.push(painted(new THREE.BoxGeometry(width * 1.1, top + 0.02, width), rng.pick(white), placement(px * 1.04, (top + 0.02) / 2 + 0.005, pz * 1.04, -angle)))
  }
  // Fracture debris and broken vein chips.
  for (let n = rng.int(2, 3); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const rock = createMartianRockGeometry({ seed: hash(seed, n, 0x6d), scale: rng.range(0.12, 0.18), variant: 'angular', palette: PALETTE.gypsumHost })
    hostParts.push(rock.translate(Math.cos(angle) * rng.range(0.42, 0.55), -0.01, Math.sin(angle) * rng.range(0.4, 0.5)))
  }
  for (let n = rng.int(6, 8); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const r = rng.range(0.03, 0.045)
    veins.push(grain(rng, Math.cos(angle) * rng.range(0.45, 0.6), r * 0.72, Math.sin(angle) * rng.range(0.45, 0.6), r, 0.7, rng.pick(white)))
  }
  return deposit('gypsum', hostParts, veins, size)
}

/**
 * Irregular, low sand drift (like the Rocknest sand shadow where Curiosity
 * found olivine): a faceted mound whose rim dips just below y = 0.
 * Returns the geometry and its height profile by distance from the centre.
 */
function sandDrift(rng: Rng, color: THREE.Color) {
  const spokes = 11
  const peak = 0.07
  const shoulder = 0.035
  const mid = 0.32
  const builder = new FacetBuilder()
  const tone = new THREE.Color()
  const apex = new THREE.Vector3(rng.range(-0.05, 0.05), peak, rng.range(-0.05, 0.05))
  const ring = (radius: number, y: number, jitter: number) =>
    Array.from({ length: spokes }, (_, k) => {
      const angle = (k / spokes) * Math.PI * 2
      const r = radius * rng.range(1 - jitter, 1 + jitter)
      return new THREE.Vector3(Math.cos(angle) * r * 1.12, y, Math.sin(angle) * r * 0.9)
    })
  const inner = ring(mid, shoulder, 0.15)
  const rim = ring(0.6, -0.012, 0.18)
  for (let k = 0; k < spokes; k++) {
    const n = (k + 1) % spokes
    builder.triangle(apex, inner[k], inner[n], tone.copy(color).multiplyScalar(rng.range(1, 1.12)), UP)
    builder.quad(inner[k], rim[k], rim[n], inner[n], tone.copy(color).multiplyScalar(rng.range(0.88, 1)), UP)
  }
  const heightAt = (d: number) => (d < mid ? peak + ((shoulder - peak) * d) / mid : shoulder + ((-0.012 - shoulder) * (d - mid)) / (0.6 - mid))
  return { geometry: builder.build(), heightAt }
}

/** Angular dark basalt on a drift of basaltic sand, flecked with olive-green olivine. */
export function createOlivineDeposit({ seed, size = 1 }: MineralOptions): THREE.Group {
  const rng = createRng(hash(seed, 0x011e))
  const olive = tones(PALETTE.olivine)
  const drift = sandDrift(rng, new THREE.Color(PALETTE.basaltSand))
  const hostParts = [drift.geometry]
  const start = rng.range(0, Math.PI * 2)
  const rocks = rng.int(3, 4)
  for (let k = 0; k < rocks; k++) {
    const angle = start + (k / rocks) * Math.PI * 2 + rng.range(-0.4, 0.4)
    const distance = k === 0 ? rng.range(0, 0.08) : rng.range(0.26, 0.36)
    const rock = createMartianRockGeometry({
      seed: hash(seed, k, 0xba5),
      scale: k === 0 ? rng.range(0.5, 0.6) : rng.range(0.26, 0.36),
      variant: 'angular',
      palette: PALETTE.basalt,
    })
    // Phenocrysts: olive facets on the dark basalt; rocks sit in the drift.
    const y = drift.heightAt(distance) - 0.03
    hostParts.push(speckle(rock, hash(seed, k), 0.38, olive).translate(Math.cos(angle) * distance, y, Math.sin(angle) * distance))
  }
  const grains: THREE.BufferGeometry[] = []
  for (let n = rng.int(14, 19); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(0.18, 0.5)
    const r = rng.range(0.035, 0.055)
    const y = Math.max(drift.heightAt(distance), 0) + r * 0.55
    grains.push(grain(rng, Math.cos(angle) * distance * 1.05, y, Math.sin(angle) * distance * 0.85, r, 0.8, rng.pick(olive)))
  }
  return deposit('olivine', hostParts, grains, size)
}

/** A pale rock cracked open around a nest of muted-yellow sulfur crystals. */
export function createSulfurDeposit({ seed, size = 1 }: MineralOptions): THREE.Group {
  const rng = createRng(hash(seed, 0x5f))
  const yellow = tones(PALETTE.sulfur)
  const hostParts: THREE.BufferGeometry[] = []
  const pieces = rng.int(4, 5)
  const start = rng.range(0, Math.PI * 2)
  for (let k = 0; k < pieces; k++) {
    // Fragments of one crushed rock, pushed apart and tipped outward.
    const angle = start + (k / pieces) * Math.PI * 2 + rng.range(-0.3, 0.3)
    const distance = rng.range(0.24, 0.3)
    const rock = createMartianRockGeometry({ seed: hash(seed, k, 0x5f0), scale: rng.range(0.28, 0.36), variant: 'angular', palette: PALETTE.sulfurHost })
    rock.rotateZ(Math.cos(angle) * -0.3).rotateX(Math.sin(angle) * 0.3)
    hostParts.push(rock.translate(Math.cos(angle) * distance, -0.02, Math.sin(angle) * distance))
  }
  const crystals: THREE.BufferGeometry[] = []
  // Bipyramidal crystals in the opened core.
  for (let n = rng.int(8, 11); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(0, 0.15)
    const r = rng.range(0.05, 0.08)
    crystals.push(grain(rng, Math.cos(angle) * distance, r * 2.2, Math.sin(angle) * distance, r, 2.1, rng.pick(yellow)))
  }
  // Yellow fines spilled around the crushed rock.
  for (let n = rng.int(6, 9); n > 0; n--) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(0.38, 0.55)
    const r = rng.range(0.024, 0.038)
    crystals.push(grain(rng, Math.cos(angle) * distance, r * 1.0, Math.sin(angle) * distance, r, 1, rng.pick(yellow)))
  }
  return deposit('sulfur', hostParts, crystals, size)
}

const FACTORIES: Record<MineralKind, (options: MineralOptions) => THREE.Group> = {
  hematite: createHematiteDeposit,
  gypsum: createGypsumDeposit,
  olivine: createOlivineDeposit,
  sulfur: createSulfurDeposit,
}

export function createMineralDeposit(kind: MineralKind, options: MineralOptions): THREE.Group {
  return FACTORIES[kind](options)
}
