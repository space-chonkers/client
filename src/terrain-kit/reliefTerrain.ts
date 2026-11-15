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

/** Small-rock scatter (world units unless noted). */
const ROCK_SCATTER = {
  /** Extra density on rims of fresh craters within `reach` rim radii. */
  freshRim: { bonus: 0.35, reach: 1.5 },
  /** Debris collects at the foot of slopes: bonus over a slope ramp, reduced on convex ground. */
  slopeFoot: { bonus: 0.7, from: 0.15, to: 0.6, convexShare: 0.25 },
  pebbleCellBonus: 0.3,
  /** Clump mask (same noise as the feature-hint clumps): density × (base + gain × ramp). */
  clump: { frequency: 0.18, base: 0.2, gain: 1.1, from: -0.15, to: 0.35 },
  /** Placement attempts per cell: density, capped at `maxDensity`, times `attemptsPerDensity`. */
  maxDensity: 1.2,
  attemptsPerDensity: 5,
  /** Points pull toward a per-cell focus (share of the cell) with some jitter (cell units). */
  focusShare: 0.5,
  jitter: 0.3,
  /** Big rocks are likelier on slopes; sizes are footprint diameters. */
  big: { chance: 0.12, perSlope: 0.2, min: 0.22, max: 0.32 },
  small: { min: 0.11, max: 0.19 },
  /** Ring of eroded rock around tall formations: count, distance (share of the ring radius) and sizes. */
  talus: { rocks: 8, from: 0.55, to: 1, min: 0.12, max: 0.26 },
  /** Talus never spills closer than this to the map edge. */
  edgeMargin: 0.12,
  /** Cells around each keep-out area that index it, so lookups stay local. */
  keepOutCells: 2,
  /** Larger pebbles bake a faint contact shadow. */
  contactTint: { minScale: 0.2, radius: 0.7, darken: 0.18 },
  /** Each pebble rests on the lowest of five probes this far apart, so none hang off slopes. */
  restProbe: 0.06,
}

/** Boulder colours follow the province: dark basalt on volcanic plains, pale stone in basins. */
const ROCK_PALETTE: Partial<Record<Region, readonly string[]>> = {
  volcanic: PALETTE.basaltRock,
  basin: PALETTE.paleRock,
}

/**
 * Per-feature asset sizes and placement (world units). `perLift` terms grow
 * assets on higher cells. `footprint` keeps scattered rocks away, `tint` is
 * the baked contact shadow, `windJitter` is how far wind-carved formations
 * may turn from the prevailing wind (radians), and `talus` is the radius of
 * the ring of eroded rock scattered around tall formations.
 */
const FEATURE_PLACEMENT = {
  cracks: { radius: 0.62, spacing: 0.3 },
  pillar: {
    height: { base: 0.9, perLift: 0.7, jitter: 0.25 },
    footprint: 0.3,
    windJitter: 0.3,
    tint: { radius: 0.75, darken: 0.28 },
    talus: 0.75,
  },
  butte: { scale: { base: 0.65, perLift: 0.35 }, footprint: 0.45, windJitter: 0.35, tint: { radius: 1, darken: 0.28 }, talus: 0.9 },
  mesa: {
    width: { min: 1.5, max: 1.9 },
    depth: { min: 1.2, max: 1.5 },
    height: { base: 0.45, perLift: 0.3 },
    footprint: 0.7,
    tint: { radius: 1.35, darken: 0.25 },
    talus: 1.2,
  },
  outcrop: { scale: { min: 0.38, max: 0.5 }, footprint: 0.25, tint: { radius: 0.55, darken: 0.22 } },
  /** Off ridges, buttes and rims, boulders are eroded with this chance; the tint scales with the boulder. */
  boulder: { erodedChance: 0.5, scale: { min: 0.4, max: 0.58, perLift: 0.1 }, footprint: 0.25, tintRadius: 0.85, darken: 0.24 },
  rockCluster: { size: { min: 0.65, max: 0.9 }, footprint: 0.3, tint: { radius: 0.62, darken: 0.24 } },
  /** Mineral halo radius is relative to the deposit size. */
  deposit: { footprint: 0.6, haloRadius: 0.95, darken: 0.06 },
}

/** How each feature looks for a spot inside its cell. */
const PLACEMENT_SEARCH = {
  /** Cells between these relief values grow from small to full-size assets. */
  liftFrom: 0.2,
  liftTo: 1,
  /** Candidate spots: one near the centre, then a widening spiral that stays inside the cell (cell units). */
  candidates: 10,
  firstReach: 0.12,
  reachBase: 0.16,
  reachStep: 0.026,
  /** Extra clearance around each placed asset's footprint. */
  keepOutMargin: 0.08,
}

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
    const lift = smoothstep(PLACEMENT_SEARCH.liftFrom, PLACEMENT_SEARCH.liftTo, cell.relief)
    // Centre-ish first, then a deterministic spiral of fallbacks that stays inside the cell.
    const candidates = Array.from({ length: PLACEMENT_SEARCH.candidates }, (_, k) => {
      const reach = k === 0 ? PLACEMENT_SEARCH.firstReach : PLACEMENT_SEARCH.reachBase + PLACEMENT_SEARCH.reachStep * k
      const angle = rng.range(0, Math.PI * 2)
      return { x: center.x + Math.cos(angle) * reach * grid.cellSize, z: center.z + Math.sin(angle) * reach * grid.cellSize }
    })
    const palette = ROCK_PALETTE[cell.region]

    let object: THREE.Object3D
    let options: PlacementOptions
    let footprint: number
    let tint: Omit<GroundTint, 'x' | 'z'> | null = null
    let talusRadius = 0
    switch (cell.feature) {
      case 'cracks':
        props.add(createCrackDecals({ seed, heightAt: surface.heightAt, center: { x: center.x, z: center.z }, ...FEATURE_PLACEMENT.cracks }))
        continue
      case 'pillar': {
        const { height, windJitter } = FEATURE_PLACEMENT.pillar
        object = createRockPillar({ seed, height: height.base + height.perLift * lift + rng.range(0, height.jitter) })
        options = ROOTED
        footprint = FEATURE_PLACEMENT.pillar.footprint
        // Wind-carved: elongated along the prevailing wind, like a yardang.
        spin = -wind + rng.range(-windJitter, windJitter)
        tint = FEATURE_PLACEMENT.pillar.tint
        talusRadius = FEATURE_PLACEMENT.pillar.talus
        break
      }
      case 'butte': {
        const { scale, windJitter } = FEATURE_PLACEMENT.butte
        object = createSedimentaryFormation({ seed, scale: scale.base + scale.perLift * lift })
        options = ROOTED
        footprint = FEATURE_PLACEMENT.butte.footprint
        spin = -wind + rng.range(-windJitter, windJitter)
        tint = FEATURE_PLACEMENT.butte.tint
        talusRadius = FEATURE_PLACEMENT.butte.talus
        break
      }
      case 'mesa': {
        const { width, depth, height } = FEATURE_PLACEMENT.mesa
        // Centred so its talus spills evenly onto the raised neighbours that justified it.
        object = createMesa({
          seed,
          width: rng.range(width.min, width.max),
          depth: rng.range(depth.min, depth.max),
          height: height.base + height.perLift * lift,
        })
        options = ROOTED
        footprint = FEATURE_PLACEMENT.mesa.footprint
        candidates.unshift({ x: center.x, z: center.z })
        tint = FEATURE_PLACEMENT.mesa.tint
        talusRadius = FEATURE_PLACEMENT.mesa.talus
        break
      }
      case 'outcrop': {
        const { scale } = FEATURE_PLACEMENT.outcrop
        object = createSedimentaryFormation({ seed, scale: rng.range(scale.min, scale.max) })
        options = ROOTED
        footprint = FEATURE_PLACEMENT.outcrop.footprint
        tint = FEATURE_PLACEMENT.outcrop.tint
        break
      }
      case 'boulder': {
        const b = FEATURE_PLACEMENT.boulder
        const variant =
          cell.geology === 'ridge' || cell.geology === 'butte' || cell.geology === 'rim' ? 'angular' : rng.chance(b.erodedChance) ? 'eroded' : 'boulder'
        const scale = rng.range(b.scale.min, b.scale.max) + b.scale.perLift * lift
        object = createMartianRock({ seed, scale, variant, palette })
        options = BOULDER
        footprint = b.footprint
        tint = { radius: scale * b.tintRadius, darken: b.darken }
        break
      }
      case 'rockCluster': {
        const { size } = FEATURE_PLACEMENT.rockCluster
        object = createRockCluster({ seed, size: rng.range(size.min, size.max), palette })
        options = BOULDER
        footprint = FEATURE_PLACEMENT.rockCluster.footprint
        tint = FEATURE_PLACEMENT.rockCluster.tint
        break
      }
      case 'hematite':
      case 'gypsum':
      case 'olivine':
      case 'sulfur': {
        const { haloRadius, darken } = FEATURE_PLACEMENT.deposit
        const size = MINERAL_SIZE[cell.feature]
        object = createMineralDeposit(cell.feature, { seed, size })
        options = DEPOSIT
        footprint = FEATURE_PLACEMENT.deposit.footprint
        // A stain on the ground around the deposit makes it legible from the map view.
        tint = { radius: haloRadius * size, color: HALO_COLOR[cell.feature], amount: MINERAL_APPEARANCE[cell.feature].halo.amount, darken, seed }
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
    keepOut.push({ x, z, r: footprint + PLACEMENT_SEARCH.keepOutMargin })
    if (tint) tints.push({ x, z, ...tint })
    if (talusRadius) talus.push({ x, z, r: talusRadius })
  }

  const dressing = bakeStaticMeshes(props, chunkKey)
  dressing.name = 'terrain-dressing'
  const points = scatterPoints(map, grid, keepOut, talus)
  // Pebbles get a faint contact shadow too, but only the larger ones are worth the tint.
  const { contactTint, restProbe } = ROCK_SCATTER
  for (const p of points) if (p.scale > contactTint.minScale) tints.push({ x: p.x, z: p.z, radius: p.scale * contactTint.radius, darken: contactTint.darken })
  dressing.add(
    createScatteredRocks({
      seed: hash(map.seed, 0x5ca),
      points,
      // Rest each pebble on the low side of its footprint so none hang off slopes.
      heightAt: (x, z) =>
        Math.min(
          surface.heightAt(x, z),
          surface.heightAt(x + restProbe, z),
          surface.heightAt(x - restProbe, z),
          surface.heightAt(x, z + restProbe),
          surface.heightAt(x, z - restProbe),
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
    for (let dr = -ROCK_SCATTER.keepOutCells; dr <= ROCK_SCATTER.keepOutCells; dr++) {
      for (let dc = -ROCK_SCATTER.keepOutCells; dc <= ROCK_SCATTER.keepOutCells; dc++) {
        const key = (r + dr) * map.cols + (c + dc)
        const list = near.get(key)
        if (list) list.push(k)
        else near.set(key, [k])
      }
    }
  }
  const blocked = (x: number, z: number) =>
    (near.get(toCell(z, map.rows) * map.cols + toCell(x, map.cols)) ?? []).some((k) => Math.hypot(x - k.x, z - k.z) < k.r)
  const half = (grid.cellSize * map.cols) / 2 - ROCK_SCATTER.edgeMargin

  for (const cell of map.cells) {
    const rng = createRng(hash(map.seed, cell.col, cell.row, 0x5c))
    cellCenter(grid, cell.col, cell.row, center)
    const { freshRim, slopeFoot, clump } = ROCK_SCATTER
    let density = SCATTER_DENSITY[cell.geology]
    if (cell.geology === 'rim') {
      const fresh = map.craters.some((c) => c.kind === 'fresh' && craterPolar(c, cell.col, cell.row).d < freshRim.reach)
      if (fresh) density += freshRim.bonus
    }
    // Debris collects where the ground stops falling: steep and concave = the foot of a slope.
    density += slopeFoot.bonus * smoothstep(slopeFoot.from, slopeFoot.to, cell.slope) * (cell.curvature < 0 ? 1 : slopeFoot.convexShare)
    if (cell.feature === 'pebbles') density += ROCK_SCATTER.pebbleCellBonus
    density *= clump.base + clump.gain * smoothstep(clump.from, clump.to, fbm(cluster, cell.col * clump.frequency, cell.row * clump.frequency, 2))
    const attempts = Math.round(clamp(density, 0, ROCK_SCATTER.maxDensity) * ROCK_SCATTER.attemptsPerDensity)
    for (let k = 0; k < attempts; k++) {
      // Clumped inside the cell too: points pull toward a per-cell focus.
      const fx = hash01(map.seed, cell.col, cell.row, 0x51) - 0.5
      const fz = hash01(map.seed, cell.col, cell.row, 0x52) - 0.5
      const { focusShare, jitter, big: bigRock, small } = ROCK_SCATTER
      const x = center.x + (fx * focusShare + rng.range(-jitter, jitter)) * grid.cellSize
      const z = center.z + (fz * focusShare + rng.range(-jitter, jitter)) * grid.cellSize
      if (blocked(x, z)) continue
      const big = rng.chance(bigRock.chance + bigRock.perSlope * cell.slope)
      points.push({ x, z, scale: big ? rng.range(bigRock.min, bigRock.max) : rng.range(small.min, small.max) })
    }
  }

  // Talus: debris fallen from tall formations collects in a ring at their feet.
  talus.forEach((t, index) => {
    const rng = createRng(hash(map.seed, index, 0x7a1))
    const ring = ROCK_SCATTER.talus
    for (let k = 0; k < ring.rocks; k++) {
      const angle = rng.range(0, Math.PI * 2)
      const distance = t.r * rng.range(ring.from, ring.to)
      const x = t.x + Math.cos(angle) * distance
      const z = t.z + Math.sin(angle) * distance
      if (Math.abs(x) > half || Math.abs(z) > half || blocked(x, z)) continue
      points.push({ x, z, scale: rng.range(ring.min, ring.max) })
    }
  })
  return points
}
