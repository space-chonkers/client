import * as THREE from 'three'
import {
  createCrossCorridor,
  createStraightCorridorSegment,
} from '../../assets/SpaceCorridor'

/**
 * Tritanopia-friendly low-poly Mars palette: relies on reds, corals, creams
 * and teal, avoiding contrasts that depend on blue vs. yellow or blue vs. green.
 */
export const MARS_PALETTE = {
  sky: '#f3cdb8',
  tileLight: '#f0b48e',
  tileDark: '#e8a47e',
  duneLow: '#dd875f',
  duneMid: '#c9653f',
  duneHigh: '#a94a2e',
  rock: '#8f3b24',
  rockLight: '#b0533a',
  craterFloor: '#b85a3b',
  hull: '#fff3e6',
  coral: '#e5533c',
  teal: '#108a8c',
  tealDark: '#164e52',
  tire: '#3b2a26',
} as const

const TERRAIN_GRID_SIZE = 28
const FLAT_ZONE_RADIUS = 5.5
const TERRAIN_HEIGHT_STEP = 0.25
const TERRAIN_MAX_HEIGHT = 1.75
const TERRAIN_BASE_DEPTH = 1
const ROCK_COUNT = 26
const TERRAIN_SEED = 20261114

/** Radius of the circle the decorative rover drives around the base. */
export const ROVER_PATH_RADIUS = 4.2

/** Tile coordinates on the ground; tile centers sit on integer world X/Z. */
export interface GridPosition {
  x: number
  z: number
}

/** Tiles occupied by the base (corridors, domes, panels, antenna and flag). */
const BASE_BLOCKED_AREAS: readonly { minX: number; maxX: number; minZ: number; maxZ: number }[] = [
  { minX: -1, maxX: 1, minZ: -3, maxZ: 1 },
  { minX: 0, maxX: 0, minZ: 2, maxZ: 2 },
  { minX: 2, maxX: 2, minZ: 0, maxZ: 0 },
  { minX: -2, maxX: -2, minZ: 0, maxZ: 0 },
  { minX: -2, maxX: -2, minZ: -2, maxZ: -2 },
]

/** A tile is walkable if it is on the flat plain and outside the base. */
export function isMarsTileWalkable({ x, z }: GridPosition): boolean {
  if (Math.hypot(x, z) > FLAT_ZONE_RADIUS) return false
  return !BASE_BLOCKED_AREAS.some(
    (area) => x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ,
  )
}

/** Deterministic PRNG (mulberry32) so the landscape is always the same. */
function createSeededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>()

/** Flat-shaded material shared per color; released with `disposeMarsMaterials`. */
function lowPolyMaterial(color: string): THREE.MeshStandardMaterial {
  const cached = materialCache.get(color)
  if (cached) return cached

  const material = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 })
  materialCache.set(color, material)
  return material
}

/** Releases the shared per-color materials; call when the scene unmounts. */
export function disposeMarsMaterials(): void {
  materialCache.forEach((material) => material.dispose())
  materialCache.clear()
}

function mesh(geometry: THREE.BufferGeometry, color: string): THREE.Mesh {
  const result = new THREE.Mesh(geometry, lowPolyMaterial(color))
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function terrainHeightAt(distanceFromCenter: number, random: () => number): number {
  if (distanceFromCenter <= FLAT_ZONE_RADIUS) return 0

  const rawHeight = (distanceFromCenter - FLAT_ZONE_RADIUS) * 0.22 + random() * 0.9
  const steppedHeight = Math.floor(rawHeight / TERRAIN_HEIGHT_STEP) * TERRAIN_HEIGHT_STEP
  return Math.min(TERRAIN_MAX_HEIGHT, steppedHeight)
}

function terrainColorAt(gridX: number, gridZ: number, height: number): string {
  if (height === 0) {
    return (gridX + gridZ) % 2 === 0 ? MARS_PALETTE.tileLight : MARS_PALETTE.tileDark
  }
  if (height < 0.6) return MARS_PALETTE.duneLow
  if (height < 1.2) return MARS_PALETTE.duneMid
  return MARS_PALETTE.duneHigh
}

interface TerrainTile {
  x: number
  z: number
  height: number
}

/** Terraced terrain (Crossy Road style) with rocks scattered outside the base. */
export function createMarsTerrain(): THREE.Group {
  const random = createSeededRandom(TERRAIN_SEED)
  const terrain = new THREE.Group()
  const tiles: TerrainTile[] = []
  const halfGrid = TERRAIN_GRID_SIZE / 2

  for (let gridX = 0; gridX < TERRAIN_GRID_SIZE; gridX++) {
    for (let gridZ = 0; gridZ < TERRAIN_GRID_SIZE; gridZ++) {
      // Tile centers on integer coordinates so terrain, base and character line up
      const x = gridX - halfGrid
      const z = gridZ - halfGrid
      tiles.push({ x, z, height: terrainHeightAt(Math.hypot(x, z), random) })
    }
  }

  const tileMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.95 }),
    tiles.length,
  )
  tileMesh.receiveShadow = true

  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  tiles.forEach((tile, index) => {
    const tileDepth = tile.height + TERRAIN_BASE_DEPTH
    matrix.makeScale(1, tileDepth, 1)
    matrix.setPosition(tile.x, tile.height - tileDepth / 2, tile.z)
    tileMesh.setMatrixAt(index, matrix)
    tileMesh.setColorAt(index, color.set(terrainColorAt(Math.round(tile.x + halfGrid), Math.round(tile.z + halfGrid), tile.height)))
  })
  terrain.add(tileMesh)

  const rockGeometry = new THREE.DodecahedronGeometry(0.3, 0)
  const rockTiles = tiles.filter((tile) => {
    const distance = Math.hypot(tile.x, tile.z)
    return distance > FLAT_ZONE_RADIUS + 0.5 && distance < 12
  })
  for (let i = 0; i < ROCK_COUNT; i++) {
    const tile = rockTiles[Math.floor(random() * rockTiles.length)]
    const rock = mesh(rockGeometry, random() > 0.5 ? MARS_PALETTE.rock : MARS_PALETTE.rockLight)
    const scale = 0.6 + random() * 0.9
    rock.scale.set(scale, scale * 0.7, scale)
    rock.rotation.set(random() * Math.PI, random() * Math.PI, 0)
    rock.position.set(tile.x + (random() - 0.5) * 0.4, tile.height + 0.1 * scale, tile.z + (random() - 0.5) * 0.4)
    terrain.add(rock)
  }

  terrain.add(createCrater(-3.2, 3.6, 0.9), createCrater(3.4, -3.3, 0.6))
  return terrain
}

function createCrater(x: number, z: number, radius: number): THREE.Group {
  const crater = new THREE.Group()
  const rim = mesh(new THREE.CylinderGeometry(radius, radius * 1.15, 0.12, 7), MARS_PALETTE.duneLow)
  const floor = mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, 0.13, 7), MARS_PALETTE.craterFloor)
  rim.position.y = 0.06
  floor.position.y = 0.065
  crater.add(rim, floor)
  crater.position.set(x, 0, z)
  return crater
}

function createDome(radius: number): THREE.Group {
  const dome = new THREE.Group()
  const shell = mesh(new THREE.SphereGeometry(radius, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), MARS_PALETTE.hull)
  const ring = mesh(new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, 0.12, 8), MARS_PALETTE.coral)
  const porthole = mesh(new THREE.BoxGeometry(radius * 0.5, radius * 0.22, 0.06), MARS_PALETTE.teal)
  ring.position.y = 0.06
  porthole.position.set(0, radius * 0.45, radius * 0.88)
  dome.add(shell, ring, porthole)
  return dome
}

function createSolarPanels(): THREE.Group {
  const panels = new THREE.Group()
  for (const offsetZ of [-0.3, 0.3]) {
    const leg = mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), MARS_PALETTE.hull)
    const panel = mesh(new THREE.BoxGeometry(0.75, 0.04, 0.5), MARS_PALETTE.tealDark)
    leg.position.set(0, 0.15, offsetZ)
    panel.position.set(0, 0.32, offsetZ)
    panel.rotation.x = -0.35
    panels.add(leg, panel)
  }
  return panels
}

function createAntennaTower(): THREE.Group {
  const tower = new THREE.Group()
  const mast = mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.1, 5), MARS_PALETTE.hull)
  const dish = mesh(new THREE.ConeGeometry(0.3, 0.16, 7), MARS_PALETTE.hull)
  const beacon = mesh(new THREE.IcosahedronGeometry(0.08, 0), MARS_PALETTE.coral)
  mast.position.y = 0.55
  dish.position.y = 1.05
  dish.rotation.x = Math.PI * 0.8
  beacon.position.y = 1.18
  tower.add(mast, dish, beacon)
  return tower
}

function createFlag(): THREE.Group {
  const flag = new THREE.Group()
  const pole = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 4), MARS_PALETTE.hull)
  const cloth = mesh(new THREE.BoxGeometry(0.34, 0.2, 0.02), MARS_PALETTE.coral)
  pole.position.y = 0.4
  cloth.position.set(0.18, 0.68, 0)
  flag.add(pole, cloth)
  return flag
}

/** Central base: corridors reused from SpaceCorridor + domes and equipment. */
export function createMarsBase(): THREE.Group {
  const base = new THREE.Group()

  base.add(createCrossCorridor())

  const corridorSlots: { x: number; z: number; rotationY: number }[] = [
    { x: 0, z: -1, rotationY: 0 },
    { x: 0, z: 1, rotationY: 0 },
    { x: -1, z: 0, rotationY: Math.PI / 2 },
    { x: 1, z: 0, rotationY: Math.PI / 2 },
  ]
  corridorSlots.forEach(({ x, z, rotationY }) => {
    const corridor = createStraightCorridorSegment()
    corridor.position.x = x
    corridor.position.z = z
    corridor.rotation.y = rotationY
    base.add(corridor)
  })
  base.traverse((object) => {
    object.castShadow = true
    object.receiveShadow = true
  })

  const mainDome = createDome(0.95)
  mainDome.position.set(0, 0, -2.2)
  const smallDome = createDome(0.65)
  smallDome.position.set(0, 0, 2)
  const solarPanels = createSolarPanels()
  solarPanels.position.set(2.1, 0, 0)
  const antenna = createAntennaTower()
  antenna.position.set(-2.1, 0, 0)
  const flag = createFlag()
  flag.position.set(-1.6, 0, -1.6)

  base.add(mainDome, smallDome, solarPanels, antenna, flag)
  return base
}

/** Small decorative rover; its front faces local +X. */
export function createRover(): THREE.Group {
  const rover = new THREE.Group()
  const chassis = mesh(new THREE.BoxGeometry(0.9, 0.3, 0.6), MARS_PALETTE.hull)
  const cabin = mesh(new THREE.BoxGeometry(0.4, 0.22, 0.5), MARS_PALETTE.teal)
  const antenna = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), MARS_PALETTE.hull)
  const antennaTip = mesh(new THREE.IcosahedronGeometry(0.05, 0), MARS_PALETTE.coral)
  chassis.position.y = 0.32
  cabin.position.set(0.15, 0.58, 0)
  antenna.position.set(-0.3, 0.67, 0.18)
  antennaTip.position.set(-0.3, 0.88, 0.18)
  rover.add(chassis, cabin, antenna, antennaTip)

  const wheelGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 6)
  for (const wheelX of [-0.3, 0.3]) {
    for (const wheelZ of [-0.34, 0.34]) {
      const wheel = mesh(wheelGeometry, MARS_PALETTE.tire)
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(wheelX, 0.16, wheelZ)
      rover.add(wheel)
    }
  }
  return rover
}
