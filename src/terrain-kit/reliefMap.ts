import { DEFAULT_MINERAL_RULES, type MineralRule } from './mineralDistribution'
import { applyCrater, craterPolar, placeCraters, type Crater } from './craters'
import { clamp, createNoise2D, createRng, fbm, hash, smoothstep, type Rng } from './noise'

/**
 * Layer −1 data model: the non-walkable geological substrate around and under
 * the playable space (Layer 0 = walkable base/corridors, Layer 1 = characters).
 * Pure data with no Three.js dependency; `reliefTerrain.ts` turns it into meshes.
 */
export const TERRAIN_LAYER = -1

/** Planned full map size; any size works (smaller maps are handy for tests). */
export const MAP_SIZE = 50

/** Geological reading of a cell, derived from its relief and its neighbours. */
export const GEOLOGY_TYPES = ['crater', 'rim', 'basin', 'plain', 'dunes', 'rubble', 'sediment', 'plateau', 'ridge', 'butte'] as const
export type Geology = (typeof GEOLOGY_TYPES)[number]

/**
 * Macro-scale geological province a cell belongs to. Regions follow the
 * smoothed relief (highlands above, basins below, crater fields around
 * impacts), so their borders run along landforms rather than across them.
 */
export const REGION_TYPES = ['plains', 'highlands', 'basin', 'dunefield', 'volcanic', 'craterfield'] as const
export type Region = (typeof REGION_TYPES)[number]

export const MINERAL_FEATURES = ['hematite', 'gypsum', 'olivine', 'sulfur'] as const
export type MineralFeature = (typeof MINERAL_FEATURES)[number]

/** The single set-dressing hint a cell carries; `none` means bare ground. */
export type TerrainFeature =
  | 'none'
  | 'pebbles'
  | 'cracks'
  | 'boulder'
  | 'rockCluster'
  | 'outcrop'
  | 'butte'
  | 'pillar'
  | 'mesa'
  | MineralFeature

export interface TerrainCell {
  readonly col: number
  readonly row: number
  readonly layer: typeof TERRAIN_LAYER
  /** Topographic intensity in [-1, 1]: -1 deepest depression, 0 neutral ground, 1 highest rock mass. */
  readonly relief: number
  /** Largest relief difference to any neighbour; high values mark escarpments and crater walls. */
  readonly slope: number
  /** Relief minus the neighbour average: > 0 knobs and ridges, < 0 pits and bowls. */
  readonly curvature: number
  readonly geology: Geology
  readonly region: Region
  readonly feature: TerrainFeature
  /** Layer −1 is environmental: units never walk on it. */
  readonly walkable: false
}

export interface ReliefMap {
  readonly seed: number
  readonly cols: number
  readonly rows: number
  /** Row-major: index = row * cols + col. */
  readonly cells: readonly TerrainCell[]
  /** Impact structures carved into the relief (empty for authored relief). */
  readonly craters: readonly Crater[]
}

/**
 * Generation inputs beyond seed and size. Every option has a default, so a
 * map can override only what differs (for example a mineral composition).
 */
export interface ReliefMapOptions {
  /** Mineral distribution rules; defaults to {@link DEFAULT_MINERAL_RULES}. */
  mineralRules?: readonly MineralRule[]
}

/** Cell lookup with edge clamping, so neighbourhood queries never fall off the map. */
export function cellAt(map: ReliefMap, col: number, row: number): TerrainCell {
  const c = clamp(col, 0, map.cols - 1)
  const r = clamp(row, 0, map.rows - 1)
  return map.cells[r * map.cols + c]
}

/** Features that occupy most of a cell and need breathing room around them. */
const LARGE_FEATURES: ReadonlySet<TerrainFeature> = new Set(['butte', 'pillar', 'mesa', ...MINERAL_FEATURES])

/** One prevailing wind per map (radians on the X/Z plane): dunes and wind-carved rock share it. */
export function prevailingWind(seed: number): number {
  return createRng(hash(seed, 0xa4)).range(0, Math.PI)
}

// ---------------------------------------------------------------------------
// Relief

/**
 * Seeded relief for every cell, composed top-down so every seed reads as a
 * landscape rather than noise:
 * - macro: a warped regional field split by quantiles into highland massifs
 *   (two tiers with lobate escarpments), sedimentary basins with flat floors
 *   and open plains, so each map has comparable proportions of each;
 * - meso: canyons that dissect the highlands (and continue as shallow
 *   channels across the plains), outlier knobs in front of escarpments, and
 *   an impact-crater population built from the crater vocabulary;
 * - micro: left to the field (dunes, rubble roughness, ejecta rays).
 */
export function generateLandforms(seed: number, cols: number, rows: number): { relief: number[]; craters: Crater[] } {
  const rng = createRng(hash(seed, 0x4e1))
  const macroNoise = createNoise2D(hash(seed, 0x4e2))
  const edgeNoise = createNoise2D(hash(seed, 0x4e3))
  const craterField = createNoise2D(hash(seed, 0x4e4))
  const medium = createNoise2D(hash(seed, 0x4e5))
  const warp = createNoise2D(hash(seed, 0x4e7))
  const canyonNoise = createNoise2D(hash(seed, 0x4e8))
  const knobNoise = createNoise2D(hash(seed, 0x4e9))

  const count = cols * rows
  const macro = new Float64Array(count)
  const edge = new Float64Array(count)
  for (let index = 0; index < count; index++) {
    const col = index % cols
    const row = Math.floor(index / cols)
    const wx = col + 6 * warp(col * 0.05, row * 0.05)
    const wz = row + 6 * warp(row * 0.05 + 40, col * 0.05 - 20)
    macro[index] = fbm(macroNoise, wx * 0.032, wz * 0.032, 3)
    // Small-scale wobble on the threshold field gives escarpments lobes and embayments.
    edge[index] = macro[index] + 0.1 * fbm(edgeNoise, col * 0.16, row * 0.16, 2)
  }
  const sorted = Array.from(edge).sort((a, b) => a - b)
  const quantile = (p: number) => sorted[Math.floor(clamp(p, 0, 1) * (count - 1))]
  const highShare = rng.range(0.16, 0.28)
  const tHigh = quantile(1 - highShare)
  const tTop = quantile(1 - highShare * 0.42)
  const tBasin = quantile(rng.range(0.12, 0.2))

  const highlandAt = (col: number, row: number) => smoothstep(tHigh - 0.025, tHigh + 0.025, edge[clamp(row, 0, rows - 1) * cols + clamp(col, 0, cols - 1)])
  const relief = new Array<number>(count)
  for (let index = 0; index < count; index++) {
    const col = index % cols
    const row = Math.floor(index / cols)
    const e = edge[index]
    const high = smoothstep(tHigh - 0.025, tHigh + 0.025, e)
    const top = smoothstep(tTop - 0.025, tTop + 0.025, e)
    const basin = smoothstep(tBasin + 0.05, tBasin - 0.03, e)
    // Ridged noise lines: canyons through the massif, faint channels across the plains.
    const canyon = smoothstep(0.88, 0.97, 1 - Math.abs(canyonNoise(col * 0.07 + 3.7, row * 0.07 - 1.3)))
    // Erosional outliers stand just in front of the escarpment.
    const knob = (1 - high) * smoothstep(tHigh - 0.12, tHigh - 0.03, e) * smoothstep(0.3, 0.6, knobNoise(col * 0.3, row * 0.3))
    let v = 0.09 * fbm(medium, col * 0.08, row * 0.08, 3) + 0.06 * macro[index]
    v += high * (0.4 + 0.04 * fbm(medium, col * 0.2 + 9, row * 0.2, 2)) + 0.36 * top
    v -= canyon * (0.36 * high + 0.06 * (1 - high))
    v += 0.46 * knob
    // Basins hold a near-flat sediment floor.
    v += (-0.3 + 0.025 * fbm(medium, col * 0.15, row * 0.15 - 7, 2) - v) * basin
    relief[index] = v
  }

  const craters = placeCraters(rng, craterField, cols, rows, highlandAt)
  for (const crater of craters) {
    const base = relief[clamp(Math.round(crater.row), 0, rows - 1) * cols + clamp(Math.round(crater.col), 0, cols - 1)]
    const reach = Math.ceil(crater.radius * 2.7)
    for (let row = Math.max(0, Math.floor(crater.row - reach)); row <= Math.min(rows - 1, Math.ceil(crater.row + reach)); row++) {
      for (let col = Math.max(0, Math.floor(crater.col - reach)); col <= Math.min(cols - 1, Math.ceil(crater.col + reach)); col++) {
        relief[row * cols + col] = applyCrater(crater, base, relief[row * cols + col], col, row)
      }
    }
  }
  return { relief: relief.map((v) => round2(clamp(v, -1, 1))), craters }
}

// ---------------------------------------------------------------------------
// Classification

/**
 * Builds the Layer −1 cell map from relief values (generated or authored) and
 * the craters carved into them. Regions come from the smoothed relief plus
 * seeded province masks; geology from each cell's relief, neighbourhood and
 * region; features are seeded dressing hints that follow the geology.
 */
export function createReliefMap(
  seed: number,
  cols: number,
  rows: number,
  relief: readonly number[],
  craters: readonly Crater[] = [],
  { mineralRules = DEFAULT_MINERAL_RULES }: ReliefMapOptions = {},
): ReliefMap {
  const value = (col: number, row: number) => relief[clamp(row, 0, rows - 1) * cols + clamp(col, 0, cols - 1)]
  const rng = createRng(hash(seed, 0xfea))

  const nearest = relief.map((_, index) => nearestCrater(craters, index % cols, Math.floor(index / cols)))
  const regions = classifyRegions(seed, cols, rows, relief, nearest)
  const measured = relief.map((r, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    // Off-map neighbours repeat the edge cell, so border cells aren't read as peaks or pits.
    let slope = 0
    let sum = 0
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue
        const neighbour = value(col + dc, row + dr)
        slope = Math.max(slope, Math.abs(r - neighbour))
        sum += neighbour
      }
    }
    const curvature = r - sum / 8
    const region = regions[index]
    const geology = classify(r, slope, curvature, region, nearest[index], regions, cols, rows, col, row)
    return { col, row, relief: r, slope: round2(slope), curvature: round2(curvature), geology, region }
  })

  // Low ground within a few cells of an escarpment: where detached outliers (mesas, buttes) stand.
  const nearScarp = regions.map((region, index) => {
    if (region === 'highlands' || region === 'craterfield') return false
    const col = index % cols
    const row = Math.floor(index / cols)
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        if (regions[clamp(row + dr, 0, rows - 1) * cols + clamp(col + dc, 0, cols - 1)] === 'highlands') return true
      }
    }
    return false
  })
  const cluster = createNoise2D(hash(seed, 0xc1))
  const features: TerrainFeature[] = measured.map((cell, index) =>
    baseFeature(cell, nearest[index], nearScarp[index], value, fbm(cluster, cell.col * 0.18, cell.row * 0.18, 2), rng.next(), rng.next()),
  )
  placeMinerals(measured, nearest, features, cols, rng, mineralRules)

  // Large formations need a free ring of cells, otherwise they read as a pile.
  for (let index = 0; index < features.length; index++) {
    if (LARGE_FEATURES.has(features[index]) && nearLarge(features, cols, index, index)) features[index] = 'boulder'
  }

  return {
    seed,
    cols,
    rows,
    cells: measured.map((cell, index) => ({ ...cell, layer: TERRAIN_LAYER, feature: features[index], walkable: false })),
    craters,
  }
}

/** Generated relief + classification in one call. */
export function generateReliefMap(seed: number, cols = MAP_SIZE, rows = MAP_SIZE, options: ReliefMapOptions = {}): ReliefMap {
  const { relief, craters } = generateLandforms(seed, cols, rows)
  return createReliefMap(seed, cols, rows, relief, craters, options)
}

interface CraterHit {
  crater: Crater
  d: number
}

function nearestCrater(craters: readonly Crater[], col: number, row: number): CraterHit | null {
  let best: CraterHit | null = null
  for (const crater of craters) {
    const { d } = craterPolar(crater, col, row)
    if (d < 1.45 && (!best || d < best.d)) best = { crater, d }
  }
  return best
}

/**
 * Province per cell. Highlands and basins follow the relief smoothed over a
 * few cells (so borders run along escarpments and basin margins); crater
 * fields surround impacts; the remaining low ground is split by broad masks
 * into volcanic (basaltic) plains, dune fields and dusty plains, using
 * quantiles so every seed gets each province. A majority filter removes
 * speckles so regions read as coherent areas.
 */
const REGION_THRESHOLDS = {
  /** Cells this close to a non-shallow crater (in rim radii) belong to its crater field. */
  craterFieldReach: 1.4,
  /** Smoothed relief at or above this is highland. */
  highlandsMinRelief: 0.3,
  /** Smoothed relief at or below this is basin. */
  basinMaxRelief: -0.17,
  /** Shares of the remaining open plains turned into volcanic plains and dune fields. */
  volcanicShare: 0.26,
  dunefieldShare: 0.2,
}

function classifyRegions(
  seed: number,
  cols: number,
  rows: number,
  relief: readonly number[],
  nearest: readonly (CraterHit | null)[],
): Region[] {
  const smooth = relief.map((_, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    let sum = 0
    let weight = 0
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const w = Math.exp(-(dc * dc + dr * dr) / 4)
        sum += w * relief[clamp(row + dr, 0, rows - 1) * cols + clamp(col + dc, 0, cols - 1)]
        weight += w
      }
    }
    return sum / weight
  })
  const volcanicNoise = createNoise2D(hash(seed, 0x60a))
  const sandNoise = createNoise2D(hash(seed, 0x5a))
  const volcanic = relief.map((_, i) => fbm(volcanicNoise, (i % cols) * 0.045, Math.floor(i / cols) * 0.045, 2))
  // Sand gathers in low ground, so the dune mask favours lower smoothed relief.
  const sand = relief.map((_, i) => fbm(sandNoise, (i % cols) * 0.06, Math.floor(i / cols) * 0.06, 2) - 0.8 * smooth[i])

  const regions: Region[] = relief.map((_, i) => {
    const hit = nearest[i]
    if (hit && hit.crater.kind !== 'shallow' && hit.d < REGION_THRESHOLDS.craterFieldReach) return 'craterfield'
    if (smooth[i] >= REGION_THRESHOLDS.highlandsMinRelief) return 'highlands'
    if (smooth[i] <= REGION_THRESHOLDS.basinMaxRelief) return 'basin'
    return 'plains'
  })
  const open = regions.map((region, i) => (region === 'plains' ? i : -1)).filter((i) => i >= 0)
  const cut = (values: readonly number[], share: number) => {
    const list = open.map((i) => values[i]).sort((a, b) => b - a)
    return list.length ? list[Math.floor(clamp(share, 0, 1) * (list.length - 1))] : Infinity
  }
  const volcanicCut = cut(volcanic, REGION_THRESHOLDS.volcanicShare)
  const sandCut = cut(sand, REGION_THRESHOLDS.dunefieldShare)
  for (const i of open) {
    if (volcanic[i] >= volcanicCut) regions[i] = 'volcanic'
    else if (sand[i] >= sandCut) regions[i] = 'dunefield'
  }

  // Majority filter on the open-ground provinces only; relief-driven ones keep their edges.
  const soft: ReadonlySet<Region> = new Set(['plains', 'volcanic', 'dunefield'])
  for (let pass = 0; pass < 2; pass++) {
    const snapshot = regions.slice()
    for (let i = 0; i < regions.length; i++) {
      if (!soft.has(snapshot[i])) continue
      const col = i % cols
      const row = Math.floor(i / cols)
      const votes = new Map<Region, number>()
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = snapshot[clamp(row + dr, 0, rows - 1) * cols + clamp(col + dc, 0, cols - 1)]
          if (soft.has(r)) votes.set(r, (votes.get(r) ?? 0) + 1)
        }
      }
      let best = snapshot[i]
      for (const [region, n] of votes) if (n > (votes.get(best) ?? 0)) best = region
      regions[i] = best
    }
  }
  return regions
}

function classify(
  relief: number,
  slope: number,
  curvature: number,
  region: Region,
  hit: CraterHit | null,
  regions: readonly Region[],
  cols: number,
  rows: number,
  col: number,
  row: number,
): Geology {
  if (hit && hit.crater.kind !== 'shallow') return hit.d < 0.82 ? 'crater' : 'rim'
  if (hit && hit.d < 0.8) return 'crater'
  // Authored relief has no crater list: fall back to deep bowls.
  if (relief <= -0.45 && curvature < 0) return 'crater'
  // Isolated knobs anywhere outside crater fields are erosional remnants.
  if (relief >= 0.35 && curvature > 0.2) return 'butte'
  switch (region) {
    case 'highlands':
      if (slope >= 0.3) return 'ridge'
      return relief >= 0.6 ? 'plateau' : relief >= 0.25 ? 'sediment' : 'plain'
    case 'basin':
      return slope >= 0.1 ? 'sediment' : 'basin'
    case 'dunefield':
      return slope >= 0.35 ? 'rubble' : 'dunes'
    default: {
      if (slope >= 0.4) return 'rubble'
      // Talus apron at the foot of an escarpment.
      const belowScarp = slope >= 0.22 && [-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => regions[clamp(row + dr, 0, rows - 1) * cols + clamp(col + dc, 0, cols - 1)] === 'highlands'))
      return belowScarp ? 'rubble' : 'plain'
    }
  }
}

function baseFeature(
  cell: { col: number; row: number; relief: number; slope: number; geology: Geology; region: Region },
  hit: CraterHit | null,
  nearScarp: boolean,
  value: (col: number, row: number) => number,
  cluster: number,
  roll: number,
  pick: number,
): TerrainFeature {
  // Debris and crack networks gather in patches instead of sprinkling evenly.
  const clumped = smoothstep(-0.05, 0.35, cluster)
  switch (cell.geology) {
    case 'crater':
      if (hit?.crater.kind === 'eroded' && cell.slope < 0.12 && clumped > 0.4) return roll < 0.25 ? 'cracks' : 'none'
      return roll < 0.05 ? 'boulder' : 'none'
    case 'rim':
      // Fresh rims carry ejecta blocks; degraded ones only the odd boulder.
      if (hit?.crater.kind === 'fresh') return roll < 0.14 ? 'rockCluster' : roll < 0.3 ? 'boulder' : roll < 0.45 ? 'pebbles' : 'none'
      return roll < 0.05 ? 'boulder' : 'none'
    case 'basin':
      // Dried lakebed: polygonal mud cracks in contiguous patches.
      return clumped > 0.7 && roll < 0.3 ? 'cracks' : 'none'
    case 'plain':
      // Outliers left behind as the escarpment retreated.
      if (nearScarp && cell.slope < 0.15 && roll < 0.05) return pick < 0.45 ? 'mesa' : 'butte'
      return roll < 0.006 + 0.02 * clumped ? 'boulder' : 'none'
    case 'dunes':
      return 'none'
    case 'rubble':
      return roll < 0.22 ? 'rockCluster' : roll < 0.38 ? 'boulder' : roll < 0.38 + 0.5 * clumped ? 'pebbles' : 'none'
    case 'sediment':
      return roll < 0.06 ? 'outcrop' : roll < 0.09 ? 'boulder' : 'none'
    case 'plateau': {
      // A mesa cap only rises from broad high ground: every orthogonal neighbour must be raised too.
      const { col, row } = cell
      const broad = [value(col - 1, row), value(col + 1, row), value(col, row - 1), value(col, row + 1)].every((v) => v >= 0.55)
      // The highland itself is the table; only small residual outcrops stand on it.
      if (broad && roll < 0.04) return 'outcrop'
      return roll < 0.06 ? 'boulder' : 'none'
    }
    case 'ridge':
      return roll < 0.04 ? 'pillar' : roll < 0.14 ? 'boulder' : roll < 0.2 ? 'rockCluster' : roll < 0.2 + 0.3 * clumped ? 'pebbles' : 'none'
    case 'butte':
      return pick < 0.6 ? 'butte' : 'pillar'
  }
}

function placeMinerals(
  measured: readonly { col: number; row: number; slope: number; geology: Geology; region: Region }[],
  nearest: readonly (CraterHit | null)[],
  features: TerrainFeature[],
  cols: number,
  rng: Rng,
  rules: readonly MineralRule[],
) {
  const order = shuffle(measured.map((_, index) => index), rng)
  for (const rule of rules) {
    for (const index of order) {
      const cell = measured[index]
      if (!rule.where(cell.geology, cell.region, nearest[index]?.crater.kind) || cell.slope > rule.maxSlope || !rng.chance(rule.chance)) continue
      if (nearLarge(features, cols, index)) continue
      const sameTooClose = features.some(
        (feature, other) =>
          feature === rule.feature &&
          Math.max(Math.abs((other % cols) - cell.col), Math.abs(Math.floor(other / cols) - cell.row)) < rule.spacing,
      )
      if (!sameTooClose) features[index] = rule.feature
    }
  }
}

/** Cells of clearance a large feature needs; mesas spill over their neighbours. */
const clearance = (feature: TerrainFeature) => (feature === 'mesa' ? 2 : 1)

/** Whether any large feature among cells [0, before) is too close to `index`. */
function nearLarge(features: readonly TerrainFeature[], cols: number, index: number, before = features.length): boolean {
  const col = index % cols
  const row = Math.floor(index / cols)
  const reach = 2
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const c = col + dc
      const r = row + dr
      const other = r * cols + c
      if ((dc === 0 && dr === 0) || c < 0 || c >= cols || r < 0 || other >= Math.min(before, features.length)) continue
      if (!LARGE_FEATURES.has(features[other])) continue
      if (Math.max(Math.abs(dc), Math.abs(dr)) <= Math.max(clearance(features[other]), clearance(features[index]))) return true
    }
  }
  return false
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

const round2 = (value: number) => Math.round(value * 100) / 100
