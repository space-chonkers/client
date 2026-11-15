import * as THREE from 'three'
import { disposeObject } from './dispose'
import { craterPolar } from './craters'
import { createMesa, createRockPillar, createSedimentaryFormation } from './formations'
import { bakeStaticMeshes } from './geometry'
import { MINERAL_APPEARANCE, createMineralDeposit } from './minerals'
import { clamp, createNoise2D, createRng, fbm, hash, hash01, smoothstep } from './noise'
import { PALETTE } from './palette'
import { placeOnSurface, type PlacementOptions } from './placement'
import { createReliefField } from './reliefField'
import {
  MINERAL_FEATURES,
  prevailingWind,
  type Geology,
  type MineralFeature,
  type Region,
  type ReliefMap,
  type TerrainFeature,
} from './reliefMap'
import { createMartianRock, createRockCluster, createScatteredRocks, type ScatterPoint } from './rocks'
import {
  buildTerrain,
  cellCenter,
  createCrackDecals,
  tintSurface,
  type GridSpec,
  type GroundTint,
  type TerrainSurface,
} from './terrain'

/**
 * Turns a Layer −1 {@link ReliefMap} into geometry: meshes the relief field
 * in chunks and dresses it. Every placed asset comes from a cell's feature.
 */

export interface PlacementRecord {
  col: number
  row: number
  feature: TerrainFeature
  placed: boolean
}

export interface ReliefTerrain {
  /** Surface chunks and skirt, plus baked assets and rock scatter. */
  root: THREE.Group
  /** Exact height of the rendered surface; use it to ground anything on the terrain. */
  surface: TerrainSurface
  chunks: THREE.Mesh[]
  /** One record per cell feature that needed placement (formations, rocks, minerals). */
  placements: PlacementRecord[]
}

export interface ReliefTerrainOptions {
  map: ReliefMap
  cellSize?: number
  /** Facets per cell edge; escarpments need ~4 to stay crisp. */
  subdivisions?: number
  skirtDepth?: number
  /** Cells per square chunk for terrain and baked dressing; 0 = no chunking. */
  chunkCells?: number
}

export function createReliefTerrain({
  map,
  cellSize = 1,
  subdivisions = 4,
  skirtDepth = 1.7,
  chunkCells = 10,
}: ReliefTerrainOptions): ReliefTerrain {
  const grid: GridSpec = { cols: map.cols, rows: map.rows, cellSize }
  const field = createReliefField(map, grid)
  const { group: terrain, surface, chunks } = buildTerrain({ grid, field, seed: map.seed, subdivisions, skirtDepth, chunkCells })
  const span = (chunkCells > 0 ? chunkCells : Math.max(map.cols, map.rows)) * cellSize
  const chunkKey = (x: number, z: number) =>
    `${Math.floor((x + (map.cols * cellSize) / 2) / span)},${Math.floor((z + (map.rows * cellSize) / 2) / span)}`
  const { dressing, placements, tints } = dressTerrain(map, grid, surface, chunkKey)
  tintSurface(chunks, tints)
  const root = new THREE.Group()
  root.name = 'layer-1-terrain'
  root.add(terrain, dressing)
  return { root, surface, chunks, placements }
}

/**
 * Base small-rock density per geology (0..1). Open ground stays clean; debris
 * belongs to rubble aprons, escarpments, fresh crater rims and formations.
 * All of it is static Layer −1 geology generated once from the seed; Layer 0
 * gameplay (building, expansion) never adds or removes it.
 */
const SCATTER_DENSITY: Record<Geology, number> = {
  crater: 0.03,
  rim: 0.12,
  basin: 0,
  plain: 0,
  dunes: 0,
  rubble: 0.7,
  sediment: 0.04,
  plateau: 0.02,
  ridge: 0.3,
  butte: 0.25,
}

/** Boulder colours follow the province: dark basalt on volcanic plains, pale stone in basins. */
const ROCK_PALETTE: Partial<Record<Region, readonly string[]>> = {
  volcanic: PALETTE.basaltRock,
  basin: PALETTE.paleRock,
}

/**
 * Radius of the talus ring (rock fallen from a tall formation by erosion)
 * scattered around each formation, in world units.
 */
const TALUS_RADIUS: Partial<Record<TerrainFeature, number>> = { pillar: 0.75, butte: 0.9, mesa: 1.2 }

/** Formations grow out of the ground; loose rocks and deposits rest on it. */
const ROOTED: PlacementOptions = { mode: 'root', maxDrop: 0.8 }
const BOULDER: PlacementOptions = { mode: 'rest', maxTilt: 0.45, maxRoughness: 0.12 }
/**
 * Deposits must sit on fairly even ground, tilt with gentle slopes, and keep
 * every mineral grain above the rendered surface (2% tolerance for grains
 * that touch the ground). Otherwise the next candidate spot is tried.
 */
const DEPOSIT: PlacementOptions = { mode: 'rest', maxTilt: 0.3, maxRoughness: 0.08, maxDrop: 0.35, maxBuried: 0.02 }
/** Deposit scale on the terrain (1 fits one cell); exaggerated so finds read from the gameplay camera. */
const MINERAL_SIZE: Record<MineralFeature, number> = { hematite: 1.3, gypsum: 1.3, olivine: 1.25, sulfur: 1.15 }
const HALO_COLOR = Object.fromEntries(
  MINERAL_FEATURES.map((kind) => [kind, new THREE.Color(MINERAL_APPEARANCE[kind].halo.color)]),
) as Record<MineralFeature, THREE.Color>

/**
 * Converts cell features into assets. Each asset is grounded on the rendered
 * surface by `placeOnSurface`, trying the cell centre and then deterministic
 * spots inside the cell. Wind-carved formations line up with the prevailing
 * wind; boulders take their province's rock. Each placed asset also leaves a
 * ground tint (contact darkening, mineral halo) for the terrain to bake.
 * Static props are then baked into one mesh per material and chunk.
 */
function dressTerrain(map: ReliefMap, grid: GridSpec, surface: TerrainSurface, chunkKey: (x: number, z: number) => string) {
  const props = new THREE.Group()
  const center = new THREE.Vector3()
  const keepOut: { x: number; z: number; r: number }[] = []
  const talus: { x: number; z: number; r: number }[] = []
  const tints: GroundTint[] = []
  const placements: PlacementRecord[] = []
  const wind = prevailingWind(map.seed)

  for (const cell of map.cells) {
    if (cell.feature === 'none' || cell.feature === 'pebbles') continue
    const rng = createRng(hash(map.seed, cell.col, cell.row, 0xd5))
    cellCenter(grid, cell.col, cell.row, center)
    const seed = hash(map.seed, cell.col, cell.row)
    let spin = rng.range(0, Math.PI * 2)
    // Higher cells carry bigger rock masses.
    const lift = smoothstep(0.2, 1, cell.relief)
    // Centre-ish first, then a deterministic spiral of fallbacks that stays inside the cell.
    const candidates = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => {
      const reach = k === 0 ? 0.12 : 0.16 + 0.026 * k
      const angle = rng.range(0, Math.PI * 2)
      return { x: center.x + Math.cos(angle) * reach * grid.cellSize, z: center.z + Math.sin(angle) * reach * grid.cellSize }
    })
    const palette = ROCK_PALETTE[cell.region]

    let object: THREE.Object3D
    let options: PlacementOptions
    let footprint: number
    let tint: Omit<GroundTint, 'x' | 'z'> | null = null
    switch (cell.feature) {
      case 'cracks':
        props.add(createCrackDecals({ seed, heightAt: surface.heightAt, center: { x: center.x, z: center.z }, radius: 0.62, spacing: 0.3 }))
        continue
      case 'pillar':
        object = createRockPillar({ seed, height: 0.9 + 0.7 * lift + rng.range(0, 0.25) })
        options = ROOTED
        footprint = 0.3
        // Wind-carved: elongated along the prevailing wind, like a yardang.
        spin = -wind + rng.range(-0.3, 0.3)
        tint = { radius: 0.75, darken: 0.28 }
        break
      case 'butte':
        object = createSedimentaryFormation({ seed, scale: 0.65 + 0.35 * lift })
        options = ROOTED
        footprint = 0.45
        spin = -wind + rng.range(-0.35, 0.35)
        tint = { radius: 1, darken: 0.28 }
        break
      case 'mesa':
        // Centred so its talus spills evenly onto the raised neighbours that justified it.
        object = createMesa({ seed, width: rng.range(1.5, 1.9), depth: rng.range(1.2, 1.5), height: 0.45 + 0.3 * lift })
        options = { mode: 'root', maxDrop: 0.8 }
        footprint = 0.7
        candidates.unshift({ x: center.x, z: center.z })
        tint = { radius: 1.35, darken: 0.25 }
        break
      case 'outcrop':
        object = createSedimentaryFormation({ seed, scale: rng.range(0.38, 0.5) })
        options = ROOTED
        footprint = 0.25
        tint = { radius: 0.55, darken: 0.22 }
        break
      case 'boulder': {
        const variant = cell.geology === 'ridge' || cell.geology === 'butte' || cell.geology === 'rim' ? 'angular' : rng.chance(0.5) ? 'eroded' : 'boulder'
        const scale = rng.range(0.4, 0.58) + 0.1 * lift
        object = createMartianRock({ seed, scale, variant, palette })
        options = BOULDER
        footprint = 0.25
        tint = { radius: scale * 0.85, darken: 0.24 }
        break
      }
      case 'rockCluster':
        object = createRockCluster({ seed, size: rng.range(0.65, 0.9), palette })
        options = BOULDER
        footprint = 0.3
        tint = { radius: 0.62, darken: 0.24 }
        break
      case 'hematite':
      case 'gypsum':
      case 'olivine':
      case 'sulfur': {
        const size = MINERAL_SIZE[cell.feature]
        object = createMineralDeposit(cell.feature, { seed, size })
        options = DEPOSIT
        footprint = 0.6
        // A stain on the ground around the deposit makes it legible from the map view.
        tint = { radius: 0.95 * size, color: HALO_COLOR[cell.feature], amount: MINERAL_APPEARANCE[cell.feature].halo.amount, darken: 0.06, seed }
        break
      }
    }

    const placed = placeOnSurface(object, surface, candidates, { ...options, rotationY: spin })
    placements.push({
      col: cell.col,
      row: cell.row,
      feature: cell.feature,
      placed,
    })
    if (!placed) {
      disposeObject(object)
      continue
    }
    props.add(object)
    const { x, z } = object.position
    keepOut.push({ x, z, r: footprint + 0.08 })
    if (tint) tints.push({ x, z, ...tint })
    const talusRadius = TALUS_RADIUS[cell.feature]
    if (talusRadius) talus.push({ x, z, r: talusRadius })
  }

  const dressing = bakeStaticMeshes(props, chunkKey)
  dressing.name = 'terrain-dressing'
  const points = scatterPoints(map, grid, keepOut, talus)
  // Pebbles get a faint contact shadow too, but only the larger ones are worth the tint.
  for (const p of points) if (p.scale > 0.2) tints.push({ x: p.x, z: p.z, radius: p.scale * 0.7, darken: 0.18 })
  dressing.add(
    createScatteredRocks({
      seed: hash(map.seed, 0x5ca),
      points,
      // Rest each pebble on the low side of its footprint so none hang off slopes.
      heightAt: (x, z) =>
        Math.min(
          surface.heightAt(x, z),
          surface.heightAt(x + 0.06, z),
          surface.heightAt(x - 0.06, z),
          surface.heightAt(x, z + 0.06),
          surface.heightAt(x, z - 0.06),
        ),
    }),
  )
  return { dressing, placements, tints }
}

/**
 * Small-rock scatter with intent: debris gathers at the foot of slopes
 * (concave, steep cells), on rubble aprons and fresh crater rims, in clumps
 * driven by a cluster mask, and as talus rings around tall formations.
 * Broad open plains, dunes and lakebeds keep their breathing room.
 * This is environmental decoration baked at build time, not gameplay debris:
 * nothing here spawns or despawns at runtime.
 */
function scatterPoints(
  map: ReliefMap,
  grid: GridSpec,
  keepOut: readonly { x: number; z: number; r: number }[],
  talus: readonly { x: number; z: number; r: number }[],
): ScatterPoint[] {
  const points: ScatterPoint[] = []
  const center = new THREE.Vector3()
  const cluster = createNoise2D(hash(map.seed, 0xc1))
  // Keep-out lookup bucketed by cell, so large maps don't test every point against every prop.
  const toCell = (v: number, count: number) => Math.floor(v / grid.cellSize + count / 2)
  const near = new Map<number, { x: number; z: number; r: number }[]>()
  for (const k of keepOut) {
    const c = toCell(k.x, map.cols)
    const r = toCell(k.z, map.rows)
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const key = (r + dr) * map.cols + (c + dc)
        const list = near.get(key)
        if (list) list.push(k)
        else near.set(key, [k])
      }
    }
  }
  const blocked = (x: number, z: number) =>
    (near.get(toCell(z, map.rows) * map.cols + toCell(x, map.cols)) ?? []).some((k) => Math.hypot(x - k.x, z - k.z) < k.r)
  const half = (grid.cellSize * map.cols) / 2 - 0.12

  for (const cell of map.cells) {
    const rng = createRng(hash(map.seed, cell.col, cell.row, 0x5c))
    cellCenter(grid, cell.col, cell.row, center)
    let density = SCATTER_DENSITY[cell.geology]
    if (cell.geology === 'rim') {
      const fresh = map.craters.some((c) => c.kind === 'fresh' && craterPolar(c, cell.col, cell.row).d < 1.5)
      if (fresh) density += 0.35
    }
    // Debris collects where the ground stops falling: steep and concave = the foot of a slope.
    density += 0.7 * smoothstep(0.15, 0.6, cell.slope) * (cell.curvature < 0 ? 1 : 0.25)
    if (cell.feature === 'pebbles') density += 0.3
    density *= 0.2 + 1.1 * smoothstep(-0.15, 0.35, fbm(cluster, cell.col * 0.18, cell.row * 0.18, 2))
    const attempts = Math.round(clamp(density, 0, 1.2) * 5)
    for (let k = 0; k < attempts; k++) {
      // Clumped inside the cell too: points pull toward a per-cell focus.
      const fx = hash01(map.seed, cell.col, cell.row, 0x51) - 0.5
      const fz = hash01(map.seed, cell.col, cell.row, 0x52) - 0.5
      const x = center.x + (fx * 0.5 + rng.range(-0.3, 0.3)) * grid.cellSize
      const z = center.z + (fz * 0.5 + rng.range(-0.3, 0.3)) * grid.cellSize
      if (blocked(x, z)) continue
      const big = rng.chance(0.12 + 0.2 * cell.slope)
      points.push({ x, z, scale: big ? rng.range(0.22, 0.32) : rng.range(0.11, 0.19) })
    }
  }

  // Talus: debris fallen from tall formations collects in a ring at their feet.
  talus.forEach((t, index) => {
    const rng = createRng(hash(map.seed, index, 0x7a1))
    for (let k = 0; k < 8; k++) {
      const angle = rng.range(0, Math.PI * 2)
      const distance = t.r * rng.range(0.55, 1)
      const x = t.x + Math.cos(angle) * distance
      const z = t.z + Math.sin(angle) * distance
      if (Math.abs(x) > half || Math.abs(z) > half || blocked(x, z)) continue
      points.push({ x, z, scale: rng.range(0.12, 0.26) })
    }
  })
  return points
}
