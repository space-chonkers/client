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

/**
 * Crater morphology vocabulary:
 * - fresh: crisp, irregular raised rim, ejecta blanket and rays, central peak when large;
 * - eroded: degraded, partly breached rim and a sediment-filled flat floor;
 * - shallow: a subtle bowl with almost no rim;
 * - overlapping: a younger impact that modifies an older crater or escarpment
 *   instead of replacing it.
 */
export const CRATER_KINDS = ['fresh', 'eroded', 'shallow', 'overlapping'] as const
export type CraterKind = (typeof CRATER_KINDS)[number]

export interface Crater {
  /** Centre in continuous cell coordinates. */
  readonly col: number
  readonly row: number
  /** Rim-crest radius in cells (before outline irregularity). */
  readonly radius: number
  readonly kind: CraterKind
  /** Drives the crater's irregular outline, rim and breaches. */
  readonly seed: number
}

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

/** Cell lookup with edge clamping, so neighbourhood queries never fall off the map. */
export function cellAt(map: ReliefMap, col: number, row: number): TerrainCell {
  const c = clamp(col, 0, map.cols - 1)
  const r = clamp(row, 0, map.rows - 1)
  return map.cells[r * map.cols + c]
}

export const isMineral = (feature: TerrainFeature): feature is MineralFeature =>
  (MINERAL_FEATURES as readonly string[]).includes(feature)

/** Features that occupy most of a cell and need breathing room around them. */
const LARGE_FEATURES: ReadonlySet<TerrainFeature> = new Set(['butte', 'pillar', 'mesa', ...MINERAL_FEATURES])

/** One prevailing wind per map (radians on the X/Z plane): dunes and wind-carved rock share it. */
export function prevailingWind(seed: number): number {
  return createRng(hash(seed, 0xa4)).range(0, Math.PI)
}

// ---------------------------------------------------------------------------
// Crater morphology

interface CraterForm {
  /** Bowl depth below the pre-impact level, in relief units. */
  depth: number
  /** Fraction of the radius that is flat floor (sediment infill). */
  floor: number
  rim: number
  /** 0 = even rim height, ~0.6 = strongly uneven. */
  irregularity: number
  /** Rim falloff widths (in radii) toward the bowl and toward the outside. */
  inner: number
  outer: number
  ejecta: number
  peak: number
  /** Adds to the existing landform instead of levelling its own floor. */
  additive: boolean
  outline: number
  phases: number[]
  breaches: { angle: number; width: number }[]
}

/** A relief amount that grows with crater radius `r` (in cells): `base + perRadius × r`. */
interface RadiusScaled {
  base: number
  perRadius: number
}

/** A value that differs for craters above {@link BIG_CRATER_RADIUS}. */
interface BySize {
  small: number
  big: number
}

/**
 * Tunable shape of one crater kind; see {@link CRATER_KINDS} for what each
 * kind looks like. Relief amounts are in relief units, widths in rim radii.
 */
interface CraterMorphology {
  depth: RadiusScaled
  rim: RadiusScaled
  ejecta: RadiusScaled
  floor: BySize
  peak: BySize
  irregularity: number
  inner: number
  outer: number
  additive: boolean
  /** Amplitude of the outline's deviation from a circle. */
  outline: number
  /** Number of collapsed rim sections. */
  breaches: { min: number; max: number }
}

/** Craters above this radius (in cells) are complex: wider floor and a central peak. */
const BIG_CRATER_RADIUS = 3.4
/** Angular half-width range of a rim breach, in radians. */
const BREACH_WIDTH = { min: 0.35, max: 0.6 }
/** Phase offsets for rim wobble (3) and outline irregularity (2). */
const CRATER_PHASES = 5

const CRATER_MORPHOLOGY: Record<CraterKind, CraterMorphology> = {
  fresh: {
    depth: { base: 0.5, perRadius: 0.06 },
    rim: { base: 0.2, perRadius: 0.025 },
    ejecta: { base: 0.05, perRadius: 0.01 },
    floor: { small: 0.12, big: 0.35 },
    peak: { small: 0, big: 0.24 },
    irregularity: 0.4,
    inner: 0.2,
    outer: 0.5,
    additive: false,
    outline: 0.07,
    breaches: { min: 0, max: 0 },
  },
  eroded: {
    depth: { base: 0.32, perRadius: 0.05 },
    rim: { base: 0.1, perRadius: 0.02 },
    ejecta: { base: 0, perRadius: 0 },
    floor: { small: 0.58, big: 0.58 },
    peak: { small: 0, big: 0.08 },
    irregularity: 0.6,
    inner: 0.34,
    outer: 0.7,
    additive: false,
    outline: 0.11,
    breaches: { min: 1, max: 2 },
  },
  shallow: {
    depth: { base: 0.14, perRadius: 0.03 },
    rim: { base: 0.035, perRadius: 0 },
    ejecta: { base: 0, perRadius: 0 },
    floor: { small: 0, big: 0 },
    peak: { small: 0, big: 0 },
    irregularity: 0.5,
    inner: 0.5,
    outer: 0.6,
    additive: true,
    outline: 0.1,
    breaches: { min: 0, max: 0 },
  },
  overlapping: {
    depth: { base: 0.36, perRadius: 0.05 },
    rim: { base: 0.13, perRadius: 0.02 },
    ejecta: { base: 0.025, perRadius: 0 },
    floor: { small: 0.25, big: 0.25 },
    peak: { small: 0, big: 0 },
    irregularity: 0.5,
    inner: 0.24,
    outer: 0.5,
    additive: true,
    outline: 0.09,
    breaches: { min: 1, max: 1 },
  },
}

const FORMS = new WeakMap<Crater, CraterForm>()

/** Resolves a crater's morphology for its size and seed (cached per crater). */
function craterForm(crater: Crater): CraterForm {
  const cached = FORMS.get(crater)
  if (cached) return cached
  const rng = createRng(crater.seed)
  const morphology = CRATER_MORPHOLOGY[crater.kind]
  const r = crater.radius
  const size: keyof BySize = r > BIG_CRATER_RADIUS ? 'big' : 'small'
  const scaled = ({ base, perRadius }: RadiusScaled) => base + perRadius * r
  // Draw order matters for determinism: phases first, then breaches.
  const phases = Array.from({ length: CRATER_PHASES }, () => rng.range(0, Math.PI * 2))
  const { min, max } = morphology.breaches
  const breachCount = min === max ? min : rng.int(min, max)
  const breaches = Array.from({ length: breachCount }, () => ({
    angle: rng.range(0, Math.PI * 2),
    width: rng.range(BREACH_WIDTH.min, BREACH_WIDTH.max),
  }))
  const form: CraterForm = {
    depth: scaled(morphology.depth),
    floor: morphology.floor[size],
    rim: scaled(morphology.rim),
    irregularity: morphology.irregularity,
    inner: morphology.inner,
    outer: morphology.outer,
    ejecta: scaled(morphology.ejecta),
    peak: morphology.peak[size],
    additive: morphology.additive,
    outline: morphology.outline,
    phases,
    breaches,
  }
  FORMS.set(crater, form)
  return form
}

/** Polar position relative to a crater: `d` is distance in rim radii, with the irregular outline applied. */
export function craterPolar(crater: Crater, col: number, row: number): { d: number; angle: number } {
  const dx = col - crater.col
  const dz = row - crater.row
  const angle = Math.atan2(dz, dx)
  const { outline, phases } = craterForm(crater)
  const shape = 1 + outline * (0.6 * Math.sin(2 * angle + phases[3]) + 0.4 * Math.sin(3 * angle + phases[4]))
  return { d: Math.hypot(dx, dz) / (crater.radius * shape), angle }
}

/** Rim height at an angle: uneven all round, collapsed where breached. */
function rimHeight(form: CraterForm, angle: number): number {
  const [p0, p1, p2] = form.phases
  const wobble = 0.55 * Math.sin(2 * angle + p0) + 0.35 * Math.sin(3 * angle + p1) + 0.2 * Math.sin(5 * angle + p2)
  let h = form.rim * clamp(1 + form.irregularity * wobble, 0.2, 1.7)
  for (const breach of form.breaches) {
    const diff = Math.atan2(Math.sin(angle - breach.angle), Math.cos(angle - breach.angle))
    h *= 1 - 0.85 * Math.exp(-((diff / breach.width) ** 2))
  }
  return h
}

/** Applies one crater to the relief value `v` of the cell at (col, row). */
function applyCrater(crater: Crater, base: number, v: number, col: number, row: number): number {
  const form = craterForm(crater)
  const { d, angle } = craterPolar(crater, col, row)
  if (d > 2.4) return v
  const rim = rimHeight(form, angle)
  // Asymmetric rim: steeper toward the bowl, a long gentle flank outside.
  const rimLift = rim * Math.exp(-(((d - 1) / (d < 1 ? form.inner : form.outer)) ** 2))
  const ejecta = d > 1 ? form.ejecta * Math.exp(-(d - 1) / 0.6) : 0
  const bowlShape =
    crater.kind === 'shallow' ? (d < 1 ? (1 - d * d) ** 2 : 0) : d < form.floor ? 1 : 1 - smoothstep(form.floor, 1, d)
  const bowl = -form.depth * bowlShape + form.peak * Math.exp(-((d / 0.2) ** 2))
  if (form.additive) return v + bowl + rimLift + ejecta
  // Inside the rim the impact levels its own floor; outside it only adds rim and ejecta.
  return v + rimLift + ejecta + (base + bowl - v) * smoothstep(1.02, 0.72, d)
}

/** Crater population tunables; crater density is the main difference between young and old terrain. */
const CRATER_POPULATION = {
  /** One crater per this many cells of map area. */
  cellsPerCrater: 210,
  /** Hero impact radius as a share of the shorter map side. */
  heroRadiusShare: { min: 0.085, max: 0.11 },
  /** Other craters: `min + span × u^exponent` for uniform u, capped at `heroShare` × hero radius. */
  radius: { min: 1.2, span: 3.4, exponent: 2.6, heroShare: 0.75 },
  /** Chance of keeping a candidate far outside crater-field regions. */
  outsideFieldChance: 0.15,
}

/**
 * Crater count scales with map area and sizes follow a steep power law (many
 * small, few large). Every map gets one large "hero" impact so the macro
 * composition always has a major impact structure. Candidates are thinned
 * outside crater-field regions; partial overlaps become `overlapping`
 * craters, and impacts on escarpments modify rather than replace them.
 */
function placeCraters(
  rng: Rng,
  field: (x: number, z: number) => number,
  cols: number,
  rows: number,
  highland: (col: number, row: number) => number,
): Crater[] {
  const { cellsPerCrater, heroRadiusShare, radius: size, outsideFieldChance } = CRATER_POPULATION
  const target = Math.max(1, Math.round((cols * rows) / cellsPerCrater))
  const craters: Crater[] = []
  const heroRadius = Math.min(cols, rows) * rng.range(heroRadiusShare.min, heroRadiusShare.max)
  for (let attempt = 0; attempt < target * 10 && craters.length < target; attempt++) {
    const hero = craters.length === 0
    const radius = hero ? heroRadius : Math.min(heroRadius * size.heroShare, size.min + size.span * rng.next() ** size.exponent)
    const margin = hero ? radius + 2 : 1
    const col = rng.range(margin, cols - 1 - margin)
    const row = rng.range(margin, rows - 1 - margin)
    if (!hero) {
      const inField = smoothstep(-0.2, 0.3, fbm(field, col * 0.04, row * 0.04, 2))
      if (rng.next() > outsideFieldChance + (1 - outsideFieldChance) * inField) continue
    }
    // A strong overlap would erase the older crater; a partial one overprints it.
    const overlaps = craters.filter((c) => Math.hypot(c.col - col, c.row - row) < (c.radius + radius) * 1.05)
    if (overlaps.some((c) => Math.hypot(c.col - col, c.row - row) < Math.max(c.radius, radius) * 0.9)) continue
    const onScarp = highland(Math.round(col), Math.round(row))
    const roll = rng.next()
    let kind: CraterKind
    if (overlaps.length > 0 || (onScarp > 0.15 && onScarp < 0.85)) kind = 'overlapping'
    else if (hero) kind = roll < 0.55 ? 'fresh' : 'eroded'
    else if (radius < 2) kind = roll < 0.45 ? 'fresh' : roll < 0.8 ? 'shallow' : 'eroded'
    else kind = roll < 0.35 ? 'fresh' : roll < 0.8 ? 'eroded' : 'shallow'
    craters.push({ col, row, radius, kind, seed: hash(rng.int(0, 0x7fffffff), 0xc7a)})
  }
  // Every map shows at least one fresh impact; promote the largest plain-ground small crater if needed.
  if (!craters.some((c) => c.kind === 'fresh')) {
    const index = craters.findIndex((c, i) => i > 0 && c.kind !== 'overlapping')
    if (index > 0) craters[index] = { ...craters[index], kind: 'fresh' }
  }
  // Older (larger) impacts first, so younger small craters overprint them.
  return craters.sort((a, b) => b.radius - a.radius)
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

/** Relief values only; see {@link generateLandforms}. */
export function generateRelief(seed: number, cols: number, rows: number): number[] {
  return generateLandforms(seed, cols, rows).relief
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
  placeMinerals(measured, nearest, features, cols, rng)

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
export function generateReliefMap(seed: number, cols = MAP_SIZE, rows = MAP_SIZE): ReliefMap {
  const { relief, craters } = generateLandforms(seed, cols, rows)
  return createReliefMap(seed, cols, rows, relief, craters)
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

/**
 * Where each mineral family may occur, loosely following where rovers found it:
 * hematite concretions in sedimentary plains and basin margins; gypsum veins
 * cutting flat-lying lakebed mudstone (as in Gale crater) and infilled crater
 * floors; olivine in basaltic plains and fresh crater floors;
 * sulfur, rare, on flat basin or crater floors like a channel floor. Deposits
 * need fairly even ground, and the same family keeps its distance so finds
 * stay scattered. Fewer, larger deposits read better than many small ones.
 */
const MINERAL_RULES: {
  feature: MineralFeature
  where: (geology: Geology, region: Region, kind: CraterKind | undefined) => boolean
  chance: number
  spacing: number
  maxSlope: number
}[] = [
  {
    feature: 'hematite',
    where: (g, r) => (g === 'sediment' && r !== 'highlands') || (g === 'plain' && r === 'plains'),
    chance: 0.03,
    spacing: 7,
    maxSlope: 0.2,
  },
  {
    feature: 'gypsum',
    where: (g, r, k) => (r === 'basin' && (g === 'basin' || g === 'sediment')) || (g === 'crater' && k === 'eroded'),
    chance: 0.035,
    spacing: 7,
    maxSlope: 0.14,
  },
  {
    // Dune fields are basaltic too, but their ridges are no ground for a deposit.
    feature: 'olivine',
    where: (g, r, k) => (r === 'volcanic' && g === 'plain') || (g === 'crater' && k === 'fresh'),
    chance: 0.035,
    spacing: 7,
    maxSlope: 0.2,
  },
  {
    feature: 'sulfur',
    where: (g, r) => (r === 'basin' && g === 'basin') || g === 'crater',
    chance: 0.02,
    spacing: 12,
    maxSlope: 0.12,
  },
]

function placeMinerals(
  measured: readonly { col: number; row: number; slope: number; geology: Geology; region: Region }[],
  nearest: readonly (CraterHit | null)[],
  features: TerrainFeature[],
  cols: number,
  rng: Rng,
) {
  const order = shuffle(measured.map((_, index) => index), rng)
  for (const rule of MINERAL_RULES) {
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
