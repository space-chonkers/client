import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { createMesa, createRockPillar, createSedimentaryFormation } from '../terrain-kit/formations'
import { octagonPrism, painted } from '../terrain-kit/geometry'
import { createGypsumDeposit, createHematiteDeposit, createOlivineDeposit, createSulfurDeposit } from '../terrain-kit/minerals'
import { createNoise2D, fbm, hash, smoothstep } from '../terrain-kit/noise'
import { materials } from '../terrain-kit/palette'
import { createMartianRock, createRockCluster } from '../terrain-kit/rocks'
import {
  SURFACE_TYPES,
  craterProfile,
  createCrackDecals,
  createTerrain,
  type SurfaceType,
  type SurfaceWeights,
  type TerrainField,
} from '../terrain-kit/terrain'
import type { ShowcaseContent } from './ShowcaseStage'

const COLUMN_SPACING = 4
const ROW_SPACING = 4.6
const PLINTH_HEIGHT = 0.16
const SWATCH_DEPTH = 0.5

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
  const noise = createNoise2D(hash(seed, 9))
  const weights: SurfaceWeights = {}
  weights[type] = 1
  const field: TerrainField = {
    heightAt: (x, z) =>
      0.07 * fbm(noise, x * 0.9, z * 0.9, 2) + (type === 'sedimentary' ? 0.14 * smoothstep(1.3, 0, Math.hypot(x, z)) : 0),
    surfaceAt: () => weights,
  }
  const swatch = createTerrain({ grid: { cols: 2, rows: 2, cellSize: 1 }, field, seed, skirtDepth: SWATCH_DEPTH })
  if (type === 'cracked') {
    swatch.add(createCrackDecals({ seed, heightAt: field.heightAt, center: { x: 0, z: 0 }, radius: 0.95, spacing: 0.34 }))
  }
  return swatch
}

function craterSwatch(seed: number): THREE.Object3D {
  const noise = createNoise2D(hash(seed, 12))
  const radius = 1.05
  const field: TerrainField = {
    heightAt: (x, z) => 0.05 * fbm(noise, x, z, 2) + craterProfile(Math.hypot(x, z), radius, 0.42, 0.14),
    surfaceAt: (x, z) => {
      const d = Math.hypot(x, z)
      const rim = Math.exp(-(((d - radius) / 0.35) ** 2))
      const cracked = smoothstep(radius, radius * 0.55, d)
      return { sand: 0.6 * (1 - Math.max(rim, cracked)), rocky: rim * 0.8, cracked }
    },
  }
  const swatch = createTerrain({ grid: { cols: 3, rows: 3, cellSize: 1 }, field, seed, skirtDepth: SWATCH_DEPTH })
  swatch.add(createCrackDecals({ seed, heightAt: field.heightAt, center: { x: 0, z: 0 }, radius: radius * 0.85, spacing: 0.32 }))
  return swatch
}

function plinth(): THREE.Mesh {
  const mesh = new THREE.Mesh(painted(octagonPrism(1.25, PLINTH_HEIGHT), '#4b3b4d'), materials.matte())
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
    ],
    [
      { label: 'Sedimentary formation', build: () => createSedimentaryFormation({ seed: s(20), scale: 1.1 }), mount: 'plinth' },
      { label: 'Rock pillar', build: () => createRockPillar({ seed: s(21), height: 1.7 }), mount: 'plinth' },
      { label: 'Mesa', build: () => createMesa({ seed: s(22), width: 2.1, depth: 1.7, height: 0.9 }), mount: 'plinth' },
      { label: 'Crater', build: () => craterSwatch(s(23)), mount: 'swatch' },
    ],
    [
      { label: 'Hematite concretions', build: () => createHematiteDeposit({ seed: s(30), size: 1.6 }), mount: 'plinth' },
      { label: 'Gypsum veins', build: () => createGypsumDeposit({ seed: s(31), size: 1.6 }), mount: 'plinth' },
      { label: 'Olivine basalt', build: () => createOlivineDeposit({ seed: s(32), size: 1.6 }), mount: 'plinth' },
      { label: 'Sulfur crystals', build: () => createSulfurDeposit({ seed: s(33), size: 1.6 }), mount: 'plinth' },
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
      tag.position.set(0, 0, 1.55)
      slot.add(tag)
      root.add(slot)
    })
  })

  const bounds = new THREE.Box3().setFromObject(root)
  return { root, bounds, floorY: 0 }
}
