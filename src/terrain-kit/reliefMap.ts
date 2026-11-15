import { DEFAULT_MINERAL_RULES, type MineralRule } from './mineralDistribution'
import { applyCrater, craterInfluenceRadius, craterPolar, placeCraters, type Crater } from './craters'
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
 * Macro and meso relief composition, in relief units unless noted. Shares are
 * fractions of the map, picked per seed between `min` and `max`.
 */
const LANDFORMS = {
  /** Domain warp that bends the macro field, in cells. */
  warp: { amplitude: 6, frequency: 0.05 },
  macro: { frequency: 0.032, octaves: 3 },
  /** Small-scale wobble on the threshold field: lobes and embayments along escarpments. */
  edgeWobble: { amplitude: 0.1, frequency: 0.16 },
  highlandShare: { min: 0.16, max: 0.28 },
  /** Share of the highlands that rises to the upper tier. */
  topTierShare: 0.42,
  basinShare: { min: 0.12, max: 0.2 },
  /** Half-width of the escarpment ramp, in threshold-field units. */
  edgeSoftness: 0.025,
  /** Basin margin ramp, from just above to just below the basin threshold. */
  basinEdge: { above: 0.05, below: 0.03 },
  /** Ridged-noise canyons: deep through the highlands, shallow channels across the plains. */
  canyon: { frequency: 0.07, ridgeFrom: 0.88, ridgeTo: 0.97, highlandDepth: 0.36, plainsDepth: 0.06 },
  /** Erosional outliers in a band just below the escarpment threshold. */
  knob: { bandFrom: 0.12, bandTo: 0.03, frequency: 0.3, thresholdFrom: 0.3, thresholdTo: 0.6, height: 0.46 },
  /** Gentle undulation everywhere, plus a hint of the macro field. */
  base: { amplitude: 0.09, frequency: 0.08, octaves: 3, macroWeight: 0.06 },
  highland: { lift: 0.4, roughness: 0.04, roughnessFrequency: 0.2, topLift: 0.36 },
  /** Near-flat sediment floor of basins. */
  basinFloor: { level: -0.3, roughness: 0.025, frequency: 0.15 },
}

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
  const warpNoise = createNoise2D(hash(seed, 0x4e7))
  const canyonNoise = createNoise2D(hash(seed, 0x4e8))
  const knobNoise = createNoise2D(hash(seed, 0x4e9))

  const { warp, edgeWobble, edgeSoftness, basinEdge, canyon: canyons, knob: knobs, base, highland, basinFloor } = LANDFORMS
  const count = cols * rows
  const macro = new Float64Array(count)
  const edge = new Float64Array(count)
  for (let index = 0; index < count; index++) {
    const col = index % cols
    const row = Math.floor(index / cols)
    const wx = col + warp.amplitude * warpNoise(col * warp.frequency, row * warp.frequency)
    const wz = row + warp.amplitude * warpNoise(row * warp.frequency + 40, col * warp.frequency - 20)
    macro[index] = fbm(macroNoise, wx * LANDFORMS.macro.frequency, wz * LANDFORMS.macro.frequency, LANDFORMS.macro.octaves)
    edge[index] = macro[index] + edgeWobble.amplitude * fbm(edgeNoise, col * edgeWobble.frequency, row * edgeWobble.frequency, 2)
  }
  const sorted = Array.from(edge).sort((a, b) => a - b)
  const quantile = (p: number) => sorted[Math.floor(clamp(p, 0, 1) * (count - 1))]
  const highShare = rng.range(LANDFORMS.highlandShare.min, LANDFORMS.highlandShare.max)
  const tHigh = quantile(1 - highShare)
  const tTop = quantile(1 - highShare * LANDFORMS.topTierShare)
  const tBasin = quantile(rng.range(LANDFORMS.basinShare.min, LANDFORMS.basinShare.max))

  const highlandAt = (col: number, row: number) =>
    smoothstep(tHigh - edgeSoftness, tHigh + edgeSoftness, edge[clamp(row, 0, rows - 1) * cols + clamp(col, 0, cols - 1)])
  const relief = new Array<number>(count)
  for (let index = 0; index < count; index++) {
    const col = index % cols
    const row = Math.floor(index / cols)
    const e = edge[index]
    const high = smoothstep(tHigh - edgeSoftness, tHigh + edgeSoftness, e)
    const top = smoothstep(tTop - edgeSoftness, tTop + edgeSoftness, e)
    const basin = smoothstep(tBasin + basinEdge.above, tBasin - basinEdge.below, e)
    // Ridged noise lines: canyons through the massif, faint channels across the plains.
    const canyon = smoothstep(
      canyons.ridgeFrom,
      canyons.ridgeTo,
      1 - Math.abs(canyonNoise(col * canyons.frequency + 3.7, row * canyons.frequency - 1.3)),
    )
    // Erosional outliers stand just in front of the escarpment.
    const knob =
      (1 - high) *
      smoothstep(tHigh - knobs.bandFrom, tHigh - knobs.bandTo, e) *
      smoothstep(knobs.thresholdFrom, knobs.thresholdTo, knobNoise(col * knobs.frequency, row * knobs.frequency))
    let v = base.amplitude * fbm(medium, col * base.frequency, row * base.frequency, base.octaves) + base.macroWeight * macro[index]
    v += high * (highland.lift + highland.roughness * fbm(medium, col * highland.roughnessFrequency + 9, row * highland.roughnessFrequency, 2)) + highland.topLift * top
    v -= canyon * (canyons.highlandDepth * high + canyons.plainsDepth * (1 - high))
    v += knobs.height * knob
    // Basins hold a near-flat sediment floor.
    v += (basinFloor.level + basinFloor.roughness * fbm(medium, col * basinFloor.frequency, row * basinFloor.frequency - 7, 2) - v) * basin
    relief[index] = v
  }

  const craters = placeCraters(rng, craterField, cols, rows, highlandAt)
  for (const crater of craters) {
    const floorRelief = relief[clamp(Math.round(crater.row), 0, rows - 1) * cols + clamp(Math.round(crater.col), 0, cols - 1)]
    const reach = Math.ceil(craterInfluenceRadius(crater))
    for (let row = Math.max(0, Math.floor(crater.row - reach)); row <= Math.min(rows - 1, Math.ceil(crater.row + reach)); row++) {
      for (let col = Math.max(0, Math.floor(crater.col - reach)); col <= Math.min(cols - 1, Math.ceil(crater.col + reach)); col++) {
        relief[row * cols + col] = applyCrater(crater, floorRelief, relief[row * cols + col], col, row)
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
    const reach = GEOLOGY_THRESHOLDS.scarpNeighbourhood
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        if (regions[clamp(row + dr, 0, rows - 1) * cols + clamp(col + dc, 0, cols - 1)] === 'highlands') return true
      }
    }
    return false
  })
  const cluster = createNoise2D(hash(seed, 0xc1))
  const features: TerrainFeature[] = measured.map((cell, index) =>
    baseFeature(cell, nearest[index], nearScarp[index], value, fbm(cluster, cell.col * FEATURE_ODDS.clump.frequency, cell.row * FEATURE_ODDS.clump.frequency, 2), rng.next(), rng.next()),
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

/** Thresholds that turn a cell's relief, slope and neighbourhood into its geology. */
const GEOLOGY_THRESHOLDS = {
  /** A cell belongs to the nearest crater within this distance, in rim radii. */
  craterReach: 1.45,
  /** Inside this distance a rimmed crater's cell is floor; beyond it, rim. */
  craterFloor: 0.82,
  /** Shallow craters have no rim; only their floor counts. */
  shallowCraterFloor: 0.8,
  /** Deep bowls read as craters even without a crater record (authored relief). */
  bowlMaxRelief: -0.45,
  /** Isolated knobs outside crater fields are erosional remnants. */
  butte: { minRelief: 0.35, minCurvature: 0.2 },
  highlands: { ridgeSlope: 0.3, plateauRelief: 0.6, sedimentRelief: 0.25 },
  basinSedimentSlope: 0.1,
  duneRubbleSlope: 0.35,
  /** Steep plains are rubble; moderately steep ones next to highlands are a talus apron. */
  plains: { rubbleSlope: 0.4, scarpFootSlope: 0.22 },
  /** Low ground within this many cells of highlands can hold detached mesas and buttes. */
  scarpNeighbourhood: 3,
}

interface CraterHit {
  crater: Crater
  d: number
}

function nearestCrater(craters: readonly Crater[], col: number, row: number): CraterHit | null {
  let best: CraterHit | null = null
  for (const crater of craters) {
    const { d } = craterPolar(crater, col, row)
    if (d < GEOLOGY_THRESHOLDS.craterReach && (!best || d < best.d)) best = { crater, d }
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
const REGION_RULES = {
  /** Gaussian smoothing of relief before thresholding: kernel half-size in cells and spread. */
  smoothing: { radius: 2, spread: 4 },
  /** Frequency of the broad masks that split open plains into volcanic plains and dune fields. */
  volcanicMaskFrequency: 0.045,
  duneMaskFrequency: 0.06,
  /** Sand gathers in low ground: how strongly the dune mask favours lower smoothed relief. */
  duneLowGroundBias: 0.8,
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
  const { smoothing, volcanicMaskFrequency, duneMaskFrequency } = REGION_RULES
  const smooth = relief.map((_, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    let sum = 0
    let weight = 0
    for (let dr = -smoothing.radius; dr <= smoothing.radius; dr++) {
      for (let dc = -smoothing.radius; dc <= smoothing.radius; dc++) {
        const w = Math.exp(-(dc * dc + dr * dr) / smoothing.spread)
        sum += w * relief[clamp(row + dr, 0, rows - 1) * cols + clamp(col + dc, 0, cols - 1)]
        weight += w
      }
    }
    return sum / weight
  })
  const volcanicNoise = createNoise2D(hash(seed, 0x60a))
  const sandNoise = createNoise2D(hash(seed, 0x5a))
  const volcanic = relief.map((_, i) => fbm(volcanicNoise, (i % cols) * volcanicMaskFrequency, Math.floor(i / cols) * volcanicMaskFrequency, 2))
  const sand = relief.map(
    (_, i) => fbm(sandNoise, (i % cols) * duneMaskFrequency, Math.floor(i / cols) * duneMaskFrequency, 2) - REGION_RULES.duneLowGroundBias * smooth[i],
  )

  const regions: Region[] = relief.map((_, i) => {
    const hit = nearest[i]
    if (hit && hit.crater.kind !== 'shallow' && hit.d < REGION_RULES.craterFieldReach) return 'craterfield'
    if (smooth[i] >= REGION_RULES.highlandsMinRelief) return 'highlands'
    if (smooth[i] <= REGION_RULES.basinMaxRelief) return 'basin'
    return 'plains'
  })
  const open = regions.map((region, i) => (region === 'plains' ? i : -1)).filter((i) => i >= 0)
  const cut = (values: readonly number[], share: number) => {
    const list = open.map((i) => values[i]).sort((a, b) => b - a)
    return list.length ? list[Math.floor(clamp(share, 0, 1) * (list.length - 1))] : Infinity
  }
  const volcanicCut = cut(volcanic, REGION_RULES.volcanicShare)
  const sandCut = cut(sand, REGION_RULES.dunefieldShare)
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
  const t = GEOLOGY_THRESHOLDS
  if (hit && hit.crater.kind !== 'shallow') return hit.d < t.craterFloor ? 'crater' : 'rim'
  if (hit && hit.d < t.shallowCraterFloor) return 'crater'
  // Authored relief has no crater list: fall back to deep bowls.
  if (relief <= t.bowlMaxRelief && curvature < 0) return 'crater'
  if (relief >= t.butte.minRelief && curvature > t.butte.minCurvature) return 'butte'
  switch (region) {
    case 'highlands':
      if (slope >= t.highlands.ridgeSlope) return 'ridge'
      return relief >= t.highlands.plateauRelief ? 'plateau' : relief >= t.highlands.sedimentRelief ? 'sediment' : 'plain'
    case 'basin':
      return slope >= t.basinSedimentSlope ? 'sediment' : 'basin'
    case 'dunefield':
      return slope >= t.duneRubbleSlope ? 'rubble' : 'dunes'
    default: {
      if (slope >= t.plains.rubbleSlope) return 'rubble'
      // Talus apron at the foot of an escarpment.
      const belowScarp = slope >= t.plains.scarpFootSlope && [-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => regions[clamp(row + dr, 0, rows - 1) * cols + clamp(col + dc, 0, cols - 1)] === 'highlands'))
      return belowScarp ? 'rubble' : 'plain'
    }
  }
}

/**
 * Odds of each feature hint per geology. Odds are cumulative thresholds on
 * one uniform roll, checked in order: `{ rockCluster: 0.14, boulder: 0.3 }`
 * gives 14% clusters and 16% boulders. Clump-dependent odds add
 * `perClump × clumped` to their `base`.
 */
const FEATURE_ODDS = {
  /** Debris and crack networks gather in patches: the clump mask and its ramp. */
  clump: { frequency: 0.18, from: -0.05, to: 0.35 },
  /** Eroded crater floors crack where they are flat and clumped. */
  crater: { crackMaxSlope: 0.12, crackMinClump: 0.4, cracks: 0.25, boulder: 0.05 },
  /** Fresh rims carry ejecta blocks; degraded ones only the odd boulder. */
  rim: { fresh: { rockCluster: 0.14, boulder: 0.3, pebbles: 0.45 }, boulder: 0.05 },
  /** Dried lakebed: polygonal mud cracks in contiguous patches. */
  basin: { crackMinClump: 0.7, cracks: 0.3 },
  /** Outliers left behind as the escarpment retreated, then sparse boulders. */
  plain: { outlierMaxSlope: 0.15, outlier: 0.05, mesaShare: 0.45, boulder: { base: 0.006, perClump: 0.02 } },
  rubble: { rockCluster: 0.22, boulder: 0.38, pebbles: { base: 0.38, perClump: 0.5 } },
  sediment: { outcrop: 0.06, boulder: 0.09 },
  /** Outcrops only on broad high ground: every orthogonal neighbour at least `broadRelief`. */
  plateau: { broadRelief: 0.55, outcrop: 0.04, boulder: 0.06 },
  ridge: { pillar: 0.04, boulder: 0.14, rockCluster: 0.2, pebbles: { base: 0.2, perClump: 0.3 } },
  butte: { butteShare: 0.6 },
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
  const odds = FEATURE_ODDS
  const clumped = smoothstep(odds.clump.from, odds.clump.to, cluster)
  switch (cell.geology) {
    case 'crater': {
      const { crackMaxSlope, crackMinClump, cracks, boulder } = odds.crater
      if (hit?.crater.kind === 'eroded' && cell.slope < crackMaxSlope && clumped > crackMinClump) return roll < cracks ? 'cracks' : 'none'
      return roll < boulder ? 'boulder' : 'none'
    }
    case 'rim': {
      const { fresh, boulder } = odds.rim
      if (hit?.crater.kind === 'fresh') return roll < fresh.rockCluster ? 'rockCluster' : roll < fresh.boulder ? 'boulder' : roll < fresh.pebbles ? 'pebbles' : 'none'
      return roll < boulder ? 'boulder' : 'none'
    }
    case 'basin':
      return clumped > odds.basin.crackMinClump && roll < odds.basin.cracks ? 'cracks' : 'none'
    case 'plain': {
      const { outlierMaxSlope, outlier, mesaShare, boulder } = odds.plain
      if (nearScarp && cell.slope < outlierMaxSlope && roll < outlier) return pick < mesaShare ? 'mesa' : 'butte'
      return roll < boulder.base + boulder.perClump * clumped ? 'boulder' : 'none'
    }
    case 'dunes':
      return 'none'
    case 'rubble': {
      const { rockCluster, boulder, pebbles } = odds.rubble
      return roll < rockCluster ? 'rockCluster' : roll < boulder ? 'boulder' : roll < pebbles.base + pebbles.perClump * clumped ? 'pebbles' : 'none'
    }
    case 'sediment':
      return roll < odds.sediment.outcrop ? 'outcrop' : roll < odds.sediment.boulder ? 'boulder' : 'none'
    case 'plateau': {
      const { broadRelief, outcrop, boulder } = odds.plateau
      const { col, row } = cell
      const broad = [value(col - 1, row), value(col + 1, row), value(col, row - 1), value(col, row + 1)].every((v) => v >= broadRelief)
      // The highland itself is the table; only small residual outcrops stand on it.
      if (broad && roll < outcrop) return 'outcrop'
      return roll < boulder ? 'boulder' : 'none'
    }
    case 'ridge': {
      const { pillar, boulder, rockCluster, pebbles } = odds.ridge
      return roll < pillar ? 'pillar' : roll < boulder ? 'boulder' : roll < rockCluster ? 'rockCluster' : roll < pebbles.base + pebbles.perClump * clumped ? 'pebbles' : 'none'
    }
    case 'butte':
      return pick < odds.butte.butteShare ? 'butte' : 'pillar'
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
