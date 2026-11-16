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
  hull: '#fff3e6',
  coral: '#e5533c',
  teal: '#108a8c',
  tealDark: '#164e52',
  tire: '#3b2a26',
} as const

/** Radius of the circular plain the player can walk on, centered on the base. */
const FLAT_ZONE_RADIUS = 5.5
/**
 * Extra cells leveled around the plain: the terrain height is interpolated
 * from the 2 nearest cells on each side, so without this margin the slopes
 * outside the circle would bend the ground inside it.
 */
const FLAT_ZONE_LEVELING_PADDING = 2

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

/** Tiles the terrain must keep flat: the walkable plain plus the leveling padding. */
export function getFlatZoneTiles(): GridPosition[] {
  const radius = FLAT_ZONE_RADIUS + FLAT_ZONE_LEVELING_PADDING
  const extent = Math.ceil(radius)
  const tiles: GridPosition[] = []
  for (let x = -extent; x <= extent; x++) {
    for (let z = -extent; z <= extent; z++) {
      if (Math.hypot(x, z) <= radius) tiles.push({ x, z })
    }
  }
  return tiles
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
