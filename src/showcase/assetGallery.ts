import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { createMesa, createRockPillar, createSedimentaryFormation } from '../terrain-kit/formations'
import { octagonPrism, painted } from '../terrain-kit/geometry'
import { createGypsumDeposit, createHematiteDeposit, createOlivineDeposit, createSulfurDeposit } from '../terrain-kit/minerals'
import { createNoise2D, fbm, hash, smoothstep } from '../terrain-kit/noise'
import { PALETTE, materials } from '../terrain-kit/palette'
import { createMartianRock, createRockCluster } from '../terrain-kit/rocks'
import {
  SURFACE_TYPES,
  craterProfile,
  createCrackDecals,
  buildTerrain,
  type SurfaceType,
  type SurfaceWeights,
  type TerrainField,
} from '../terrain-kit/terrain'
import type { ShowcaseContent } from './types'

const COLUMN_SPACING = 4
const ROW_SPACING = 4.6
const PLINTH_HEIGHT = 0.16
/** Wide enough for the largest exhibit (the mesa). */
const PLINTH_APOTHEM = 1.25
const PLINTH_COLOR = '#4b3b4d'
/** Labels sit in front of each exhibit, just past the plinth edge. */
const LABEL_OFFSET_Z = 1.55
const SWATCH_DEPTH = 0.5
/** Deposits are shown larger than in the terrain so their detail reads up close. */
const DEPOSIT_DISPLAY_SIZE = 1.6

/** Seed salts, so swatch noise never correlates with the exhibit's own seed. */
const SURFACE_NOISE_SALT = 9
const CRATER_NOISE_SALT = 12

/** A small terrain chunk showing a single surface type. */
const SURFACE_SWATCH = {
  grid: { cols: 2, rows: 2, cellSize: 1 },
  /** Gentle undulation so the light picks out the facets. */
  undulation: { amplitude: 0.07, frequency: 0.9, octaves: 2 },
  /** Sedimentary ground rises into a low mound so its banding shows. */
  mound: { height: 0.14, radius: 1.3 },
  cracks: { radius: 0.95, spacing: 0.34 },
}

/** A single impact crater: sandy surroundings, rocky rim, cracked floor. */
const CRATER_SWATCH = {
  grid: { cols: 3, rows: 3, cellSize: 1 },
  undulation: { amplitude: 0.05, octaves: 2 },
  radius: 1.05,
  depth: 0.42,
  rimHeight: 0.14,
  /** Half-width of the rocky band around the rim crest. */
  rimWidth: 0.35,
  rimRockiness: 0.8,
  /** Cracked floor begins inside this fraction of the radius. */
  floorFraction: 0.55,
  sandCover: 0.6,
  cracks: { radiusFraction: 0.85, spacing: 0.32 },
}

const SURFACE_LABELS: Record<SurfaceType, string> = {
  sand: 'Martian sand',
  soil: 'Rust soil',
  rocky: 'Rocky ground',
  sedimentary: 'Sedimentary ground',
  cracked: 'Cracked terrain',
  duneSand: 'Dark dune sand',
  basalt: 'Basaltic plain',
  lakebed: 'Lakebed sediment',
  ejecta: 'Crater ejecta',
}

interface Exhibit {
  label: string
  build: () => THREE.Object3D
  /** plinth: sits on a display plinth. swatch: terrain chunk resting on its own stratified base. */
  mount: 'plinth' | 'swatch'
}

const MOUNT_HEIGHT: Record<Exhibit['mount'], number> = { plinth: PLINTH_HEIGHT, swatch: SWATCH_DEPTH }

function surfaceSwatch(type: SurfaceType, seed: number): THREE.Object3D {
  const noise = createNoise2D(hash(seed, SURFACE_NOISE_SALT))
  const { undulation, mound, cracks } = SURFACE_SWATCH
  const weights: SurfaceWeights = {}
  weights[type] = 1
  const field: TerrainField = {
    heightAt: (x, z) => {
      const ground = undulation.amplitude * fbm(noise, x * undulation.frequency, z * undulation.frequency, undulation.octaves)
      if (type !== 'sedimentary') return ground
      return ground + mound.height * smoothstep(mound.radius, 0, Math.hypot(x, z))
    },
    surfaceAt: () => weights,
  }
  const swatch = buildTerrain({ grid: SURFACE_SWATCH.grid, field, seed, skirtDepth: SWATCH_DEPTH }).group
  if (type === 'cracked') {
    swatch.add(createCrackDecals({ seed, heightAt: field.heightAt, center: { x: 0, z: 0 }, ...cracks }))
  }
  return swatch
}

function craterSwatch(seed: number): THREE.Object3D {
  const noise = createNoise2D(hash(seed, CRATER_NOISE_SALT))
  const { undulation, radius, depth, rimHeight, rimWidth, rimRockiness, floorFraction, sandCover, cracks } = CRATER_SWATCH
  const field: TerrainField = {
    heightAt: (x, z) =>
      undulation.amplitude * fbm(noise, x, z, undulation.octaves) + craterProfile(Math.hypot(x, z), radius, depth, rimHeight),
    surfaceAt: (x, z) => {
      const distance = Math.hypot(x, z)
      const rim = Math.exp(-(((distance - radius) / rimWidth) ** 2))
      const cracked = smoothstep(radius, radius * floorFraction, distance)
      return { sand: sandCover * (1 - Math.max(rim, cracked)), rocky: rim * rimRockiness, cracked }
    },
  }
  const swatch = buildTerrain({ grid: CRATER_SWATCH.grid, field, seed, skirtDepth: SWATCH_DEPTH }).group
  swatch.add(
    createCrackDecals({
      seed,
      heightAt: field.heightAt,
      center: { x: 0, z: 0 },
      radius: radius * cracks.radiusFraction,
      spacing: cracks.spacing,
    }),
  )
  return swatch
}

function plinth(): THREE.Mesh {
  const mesh = new THREE.Mesh(painted(octagonPrism(PLINTH_APOTHEM, PLINTH_HEIGHT), PLINTH_COLOR), materials.matte())
  mesh.position.y = PLINTH_HEIGHT / 2
  mesh.receiveShadow = true
  return mesh
}

function label(text: string): CSS2DObject {
  const element = document.createElement('div')
  element.className = 'asset-label'
  element.textContent = text
  return new CSS2DObject(element)
}

/** Every kit asset on its own plinth, grouped by family, for close inspection. */
export function buildAssetGallery(seed: number): ShowcaseContent {
  // Each exhibit has its own fixed seed key, so adding an exhibit never reshuffles the others.
  const s = (k: number) => hash(seed, k)
  const surfaces = SURFACE_TYPES.map((type, k): Exhibit => ({ label: SURFACE_LABELS[type], build: () => surfaceSwatch(type, s(k)), mount: 'swatch' }))
  const rows: Exhibit[][] = [
    surfaces.slice(0, 5),
    surfaces.slice(5),
    [
      { label: 'Small angular rock', build: () => createMartianRock({ seed: s(10), scale: 0.6, variant: 'angular' }), mount: 'plinth' },
      { label: 'Medium boulder', build: () => createMartianRock({ seed: s(11), scale: 0.9, variant: 'boulder' }), mount: 'plinth' },
      { label: 'Large eroded boulder', build: () => createMartianRock({ seed: s(12), scale: 1.4, variant: 'eroded' }), mount: 'plinth' },
      { label: 'Rock cluster', build: () => createRockCluster({ seed: s(13), size: 1.3 }), mount: 'plinth' },
      // Regional rock: the terrain swaps boulder colours by province.
      { label: 'Basalt boulder (volcanic)', build: () => createMartianRock({ seed: s(14), scale: 0.9, variant: 'boulder', palette: PALETTE.basaltRock }), mount: 'plinth' },
      { label: 'Pale boulder (basin)', build: () => createMartianRock({ seed: s(15), scale: 0.9, variant: 'eroded', palette: PALETTE.paleRock }), mount: 'plinth' },
    ],
    [
      { label: 'Sedimentary formation', build: () => createSedimentaryFormation({ seed: s(20), scale: 1.1 }), mount: 'plinth' },
      { label: 'Rock pillar', build: () => createRockPillar({ seed: s(21), height: 1.7 }), mount: 'plinth' },
      { label: 'Mesa', build: () => createMesa({ seed: s(22), width: 2.1, depth: 1.7, height: 0.9 }), mount: 'plinth' },
      { label: 'Crater', build: () => craterSwatch(s(23)), mount: 'swatch' },
    ],
    [
      { label: 'Hematite concretions', build: () => createHematiteDeposit({ seed: s(30), size: DEPOSIT_DISPLAY_SIZE }), mount: 'plinth' },
      { label: 'Gypsum veins', build: () => createGypsumDeposit({ seed: s(31), size: DEPOSIT_DISPLAY_SIZE }), mount: 'plinth' },
      { label: 'Olivine basalt', build: () => createOlivineDeposit({ seed: s(32), size: DEPOSIT_DISPLAY_SIZE }), mount: 'plinth' },
      { label: 'Sulfur crystals', build: () => createSulfurDeposit({ seed: s(33), size: DEPOSIT_DISPLAY_SIZE }), mount: 'plinth' },
    ],
  ]

  const root = new THREE.Group()
  root.name = 'asset-gallery'
  rows.forEach((row, r) => {
    row.forEach((exhibit, c) => {
      const x = (c - (row.length - 1) / 2) * COLUMN_SPACING
      const z = (r - (rows.length - 1) / 2) * ROW_SPACING
      const slot = new THREE.Group()
      slot.position.set(x, 0, z)
      const object = exhibit.build()
      if (exhibit.mount === 'plinth') slot.add(plinth())
      object.position.y = MOUNT_HEIGHT[exhibit.mount]
      slot.add(object)
      const tag = label(exhibit.label)
      tag.position.set(0, 0, LABEL_OFFSET_Z)
      slot.add(tag)
      root.add(slot)
    })
  })

  const bounds = new THREE.Box3().setFromObject(root)
  return { root, bounds, floorY: 0 }
}
