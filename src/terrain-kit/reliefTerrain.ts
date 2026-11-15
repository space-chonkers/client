import * as THREE from 'three'
import { disposeObject } from './dispose'
import { createMesa, createRockPillar, createSedimentaryFormation } from './formations'
import { bakeStaticMeshes } from './geometry'
import { createMineralDeposit } from './minerals'
import { clamp, createNoise2D, createRng, fbm, hash, hash01, smoothstep } from './noise'
import { PALETTE } from './palette'
import { buriedFraction, placeOnSurface, type PlacementOptions } from './placement'
import {
  cellAt,
  craterPolar,
  isMineral,
  prevailingWind,
  type Geology,
  type Region,
  type ReliefMap,
  type TerrainCell,
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
  type SurfaceWeights,
  type TerrainField,
  type TerrainSurface,
} from './terrain'

/**
 * Turns a Layer −1 {@link ReliefMap} into geometry. Everything here is derived
 * from cell data: the height field interpolates cell relief, surface colour
 * follows cell geology and region, and every placed asset comes from a cell's feature.
 */

export interface ReliefField extends TerrainField {
  /** Smoothly interpolated cell relief at a world position (≈ [-1, 1]). */
  reliefAt(x: number, z: number): number
}

/** World height of the deepest crater floor (relief −1). */
const BASIN_DEPTH = 1.25
/** Height of one raised shelf; terraced relief climbs in escarpment-bounded steps. */
const SHELF_HEIGHT = 0.85
/** Shelves per unit of positive relief: escarpments sit near relief 0.3 and 0.68. */
const SHELF_RATE = 2.6

/**
 * Relief → height. Negative relief sinks into bowls and near-zero stays a
 * plain. Positive relief either rises smoothly (crater rims, swells) or, with
 * `terrace` = 1, as flat shelves separated by steep escarpments: the terraced
 * look of eroded Martian layered highlands. Only highland provinces and
 * erosional knobs are terraced, so crater rims never turn into walls.
 */
export function reliefHeight(relief: number, terrace = 1): number {
  if (relief <= 0) return -BASIN_DEPTH * (-relief) ** 1.35
  const s = relief * SHELF_RATE
  const step = Math.floor(s)
  const terraced = SHELF_HEIGHT * (step + smoothstep(0.6, 0.88, s - step)) + 0.12 * relief
  const smooth = 1.45 * relief ** 1.1
  return smooth + (terraced - smooth) * terrace
}

/** Surface material mix per geology (local reading). */
const GEOLOGY_SURFACE: Record<Geology, SurfaceWeights> = {
  crater: { soil: 0.75, cracked: 0.3 },
  rim: { sand: 0.6, rocky: 0.45 },
  basin: { lakebed: 1 },
  plain: { sand: 1 },
  dunes: { duneSand: 1 },
  rubble: { rocky: 1, soil: 0.2 },
  sediment: { sedimentary: 1 },
  plateau: { sedimentary: 0.45, sand: 0.55 },
  ridge: { rocky: 0.85, sedimentary: 0.35 },
  butte: { sedimentary: 0.8, rocky: 0.4 },
}

/** Province tint layered over the local mix, so regions read at the macro scale. */
const REGION_SURFACE: Record<Region, SurfaceWeights> = {
  plains: { sand: 0.35 },
  highlands: { sedimentary: 0.15 },
  basin: { lakebed: 0.55 },
  dunefield: { duneSand: 0.45 },
  volcanic: { basalt: 1.3 },
  craterfield: {},
}

type SurfaceEntries = readonly (readonly [keyof SurfaceWeights, number])[]
function entriesOf<K extends string>(table: Record<K, SurfaceWeights>): Record<K, SurfaceEntries> {
  const out = {} as Record<K, SurfaceEntries>
  for (const key of Object.keys(table) as K[]) out[key] = Object.entries(table[key]) as [keyof SurfaceWeights, number][]
  return out
}
/** Pre-split tables: the surface query runs ~80k times per build. */
const GEOLOGY_ENTRIES = entriesOf(GEOLOGY_SURFACE)
const REGION_ENTRIES = entriesOf(REGION_SURFACE)

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)

const TAU = Math.PI * 2

/**
 * Continuous field built only from cell data. Relief is bicubically
 * interpolated across neighbouring cells, sample points are gently
 * domain-warped so contours never follow the grid, and each geology adds its
 * own micro-relief: wind-aligned dunes, rubble roughness, crater rims and the
 * ejecta rays of fresh impacts.
 */
export function createReliefField(map: ReliefMap, grid: GridSpec): ReliefField {
  const warp = createNoise2D(hash(map.seed, 0xa1))
  const detail = createNoise2D(hash(map.seed, 0xa2))
  const rough = createNoise2D(hash(map.seed, 0xa3))
  const duneBreak = createNoise2D(hash(map.seed, 0xa5))
  // One prevailing wind for the whole map keeps every dune field (and yardang) aligned.
  const wind = prevailingWind(map.seed)
  const windX = Math.cos(wind)
  const windZ = Math.sin(wind)
  const rays = map.craters.map((crater) => {
    const rng = createRng(hash(crater.seed, 0x7a))
    return { count: rng.int(7, 11), phase: rng.range(0, TAU), strength: crater.kind === 'fresh' ? 1 : crater.kind === 'overlapping' ? 0.4 : 0 }
  })

  /** World → continuous cell space, where cell (c, r) has its centre at (c, r). */
  const toCell = (x: number, z: number, amount: number) => ({
    u: x / grid.cellSize + map.cols / 2 - 0.5 + warp(x * 0.55, z * 0.55) * amount,
    v: z / grid.cellSize + map.rows / 2 - 0.5 + warp(z * 0.55 + 31, x * 0.55 - 17) * amount,
  })

  const reliefAt = (x: number, z: number) => {
    const { u, v } = toCell(x, z, 0.22)
    const i = Math.floor(u)
    const j = Math.floor(v)
    const rows = [-1, 0, 1, 2].map((dj) => {
      const r = (di: number) => cellAt(map, i + di, j + dj).relief
      return catmullRom(r(-1), r(0), r(1), r(2), u - i)
    })
    return clamp(catmullRom(rows[0], rows[1], rows[2], rows[3], v - j), -1.05, 1.05)
  }

  /**
   * Geology and region weights (plus mean curvature) blended over the 4×4
   * nearest cells with a cubic B-spline kernel: smooth enough that class
   * boundaries form organic blobs instead of the square cell staircase.
   * The last sample is memoised: colour queries ask for it twice per facet.
   */
  const geology = new Map<Geology, number>()
  const region = new Map<Region, number>()
  const sample = { x: NaN, z: NaN, curvature: 0, relief: 0 }
  const wu = [0, 0, 0, 0]
  const wv = [0, 0, 0, 0]
  const bspline = (t: number, out: number[]) => {
    const t2 = t * t
    const t3 = t2 * t
    out[0] = (1 - t) ** 3 / 6
    out[1] = (3 * t3 - 6 * t2 + 4) / 6
    out[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6
    out[3] = t3 / 6
  }
  const sampleCells = (x: number, z: number) => {
    if (x === sample.x && z === sample.z) return sample
    const { u, v } = toCell(x, z, 0.45)
    const i = Math.floor(u)
    const j = Math.floor(v)
    bspline(u - i, wu)
    bspline(v - j, wv)
    geology.clear()
    region.clear()
    let curvature = 0
    let relief = 0
    for (let dj = 0; dj < 4; dj++) {
      for (let di = 0; di < 4; di++) {
        const cell: TerrainCell = cellAt(map, i + di - 1, j + dj - 1)
        const w = wu[di] * wv[dj]
        geology.set(cell.geology, (geology.get(cell.geology) ?? 0) + w)
        region.set(cell.region, (region.get(cell.region) ?? 0) + w)
        curvature += cell.curvature * w
        relief += cell.relief * w
      }
    }
    sample.x = x
    sample.z = z
    sample.curvature = curvature
    sample.relief = relief
    return sample
  }

  /** Ejecta rays of fresh impacts (0..1), rim crenulation weight, and the sediment infill of eroded craters. */
  const craterDetail = (x: number, z: number) => {
    let ray = 0
    let crest = 0
    let infill = 0
    if (map.craters.length === 0) return { ray, crest, infill }
    const u = x / grid.cellSize + map.cols / 2 - 0.5
    const v = z / grid.cellSize + map.rows / 2 - 0.5
    map.craters.forEach((crater, k) => {
      if (Math.abs(u - crater.col) > crater.radius * 2.8 || Math.abs(v - crater.row) > crater.radius * 2.8) return
      const { d, angle } = craterPolar(crater, u, v)
      crest += Math.exp(-(((d - 1) / 0.16) ** 2))
      if (crater.kind === 'eroded') infill = Math.max(infill, smoothstep(0.72, 0.4, d))
      const r = rays[k]
      if (r.strength === 0 || d < 0.9 || d > 2.7) return
      const streak = (0.5 + 0.5 * Math.cos(r.count * angle + r.phase + 0.8 * warp(x * 0.9, z * 0.9))) ** 5
      const fade = smoothstep(0.92, 1.12, d) * Math.exp(-(d - 1) / 0.75)
      ray = Math.max(ray, r.strength * fade * (0.35 + 0.65 * streak))
    })
    return { ray, crest: Math.min(crest, 1), infill }
  }

  /**
   * Transverse dunes: long sinuous crests run across the wind. Each dune has a
   * gentle stoss slope, a sharp brink, a steep slip face and a flat interdune
   * corridor; crest height varies along the ridge. Returns crest height (0..1)
   * and the along-wind phase used for ripples.
   */
  const duneAt = (x: number, z: number) => {
    const along = (x * windX + z * windZ) * 2.1 + warp(x * 0.18, z * 0.18) * 0.9
    const phase = along / TAU - Math.floor(along / TAU)
    const crestShape = phase < 0.74 ? (phase / 0.74) ** 1.4 : phase < 0.86 ? 1 - smoothstep(0.74, 0.86, phase) : 0
    const across = -x * windZ + z * windX
    const segment = smoothstep(-0.35, 0.3, duneBreak(across * 0.3, (x * windX + z * windZ) * 0.1))
    return { crest: crestShape * (0.55 + 0.45 * segment), along }
  }

  return {
    reliefAt,
    heightAt(x, z) {
      sampleCells(x, z)
      const terrace = clamp((region.get('highlands') ?? 0) + (geology.get('butte') ?? 0), 0, 1)
      // Noise terms are only evaluated where their landform exists: they dominate meshing cost.
      const dunes = geology.get('dunes') ?? 0
      let duneHeight = 0
      if (dunes > 0) {
        const dune = duneAt(x, z)
        duneHeight = dunes * (0.3 * dune.crest + 0.015 * ((1 - Math.abs(Math.sin(dune.along * 3.2))) ** 2 - 0.35))
      }
      // Lava plains end in a low lobate flow front, so the province edge is a landform, not a stain.
      const flowFront = 0.09 * smoothstep(0.3, 0.7, region.get('volcanic') ?? 0)
      const roughness = (geology.get('rubble') ?? 0) + 0.6 * (geology.get('ridge') ?? 0) + 0.4 * (geology.get('butte') ?? 0)
      const { crest, ray } = craterDetail(x, z)
      return (
        reliefHeight(reliefAt(x, z), terrace) +
        flowFront +
        duneHeight +
        (roughness > 0 ? 0.06 * roughness * fbm(rough, x * 2.4, z * 2.4, 2) : 0) +
        // Uneven rim crests and hummocky ejecta, so rims never read as a lathe-turned ring.
        (crest > 0.01 ? crest * 0.07 * fbm(rough, x * 1.5 + 11, z * 1.5, 2) : 0) +
        ray * 0.035 +
        0.018 * fbm(detail, x * 1.3, z * 1.3, 2)
      )
    },
    surfaceAt(x, z) {
      sampleCells(x, z)
      const out: SurfaceWeights = {}
      const add = (entries: SurfaceEntries, w: number) => {
        for (const [type, amount] of entries) out[type] = (out[type] ?? 0) + amount * w
      }
      for (const [g, w] of geology) add(GEOLOGY_ENTRIES[g], w)
      for (const [r, w] of region) add(REGION_ENTRIES[r], w)
      const { ray, infill } = craterDetail(x, z)
      if (ray > 0) out.ejecta = (out.ejecta ?? 0) + 1.6 * ray
      // Degraded craters hold pale, layered sediment on their flat floors.
      if (infill > 0) out.lakebed = (out.lakebed ?? 0) + 1.3 * infill
      return out
    },
    shadeAt(x, z) {
      // Smoothed (B-spline) relief is plenty for shading and far cheaper than the bicubic height.
      const { curvature, relief } = sampleCells(x, z)
      const dunes = geology.get('dunes') ?? 0
      // Sunlit sand on dune crests, darker sand gathered in the troughs: dune fields read as ridged, not stained.
      const duneShade = dunes > 0 ? 1 + dunes * 0.42 * (duneAt(x, z).crest - 0.4) : 1
      // Hollows and crater bowls a touch darker, crests and high ground a touch lighter.
      return clamp(1 + 0.35 * curvature, 0.88, 1.06) * (0.95 + 0.08 * smoothstep(-0.8, 0.9, relief)) * duneShade
    },
  }
}

export interface PlacementRecord {
  col: number
  row: number
  feature: TerrainFeature
  placed: boolean
  /** Fraction of exposed (mineral) vertices below the rendered surface; 0 when not placed. */
  buried: number
}

export interface ReliefTerrain {
  /** Contains `terrain` (surface chunks + skirt) and `dressing` (baked assets + rock scatter). */
  root: THREE.Group
  terrain: THREE.Group
  dressing: THREE.Group
  field: ReliefField
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
  return { root, terrain, dressing, field, surface, chunks, placements }
}

/**
 * Base small-rock density per geology (0..1). Open ground stays clean; debris
 * belongs to rubble aprons, escarpments, fresh crater rims and formations.
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

/** Formations grow out of the ground; loose rocks and deposits rest on it. */
const ROOTED: PlacementOptions = { mode: 'root', maxDrop: 0.8 }
const BOULDER: PlacementOptions = { mode: 'rest', maxTilt: 0.45, maxRoughness: 0.12 }
/**
 * Deposits must sit on fairly even ground, tilt with gentle slopes, and keep
 * every mineral grain above the rendered surface (2% tolerance for grains
 * that touch the ground). Otherwise the next candidate spot is tried.
 */
const DEPOSIT: PlacementOptions = { mode: 'rest', maxTilt: 0.3, maxRoughness: 0.08, maxDrop: 0.35, maxBuried: 0.02 }
const MINERAL_SIZE = { hematite: 1.3, gypsum: 1.3, olivine: 1.25, sulfur: 1.15 }
const HALO_AMOUNT = { hematite: 0.5, gypsum: 0.55, olivine: 0.42, sulfur: 0.6 }
const HALO = Object.fromEntries(Object.entries(PALETTE.halo).map(([kind, hex]) => [kind, new THREE.Color(hex)])) as Record<
  keyof typeof PALETTE.halo,
  THREE.Color
>

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
        tint = { radius: 0.95 * size, color: HALO[cell.feature], amount: HALO_AMOUNT[cell.feature], darken: 0.06, seed }
        break
      }
    }

    const placed = placeOnSurface(object, surface, candidates, { ...options, rotationY: spin })
    placements.push({
      col: cell.col,
      row: cell.row,
      feature: cell.feature,
      placed,
      buried: placed && isMineral(cell.feature) ? buriedFraction(object, surface) : 0,
    })
    if (!placed) {
      disposeObject(object)
      continue
    }
    props.add(object)
    const { x, z } = object.position
    keepOut.push({ x, z, r: footprint + 0.08 })
    if (tint) tints.push({ x, z, ...tint })
    if (cell.feature === 'pillar') talus.push({ x, z, r: 0.75 })
    if (cell.feature === 'butte') talus.push({ x, z, r: 0.9 })
    if (cell.feature === 'mesa') talus.push({ x, z, r: 1.2 })
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
