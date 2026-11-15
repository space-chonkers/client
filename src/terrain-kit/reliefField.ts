import { craterPolar, type CraterKind } from './craters'
import { cornerIndex, type ElevationModel } from './elevation'
import { worldUnitsPerMeter } from './marsCoordinates'
import { clamp, createNoise2D, createRng, fbm, hash, lerp, smoothstep } from './noise'
import { cellAt, prevailingWind, type Geology, type Region, type ReliefMap, type TerrainCell } from './reliefMap'
import type { GridSpec, SurfaceWeights, TerrainField } from './terrain'

/**
 * The continuous Layer −1 landscape derived from a {@link ReliefMap}: height
 * (interpolated cell relief plus landform micro-relief), surface material
 * mix (cell geology and region) and landform shading. `reliefTerrain.ts`
 * meshes it and dresses it.
 */

/** Relief → world height (world units per relief unit unless noted). */
const RELIEF_HEIGHT = {
  /** World height of the deepest crater floor (relief −1). */
  basinDepth: 1.25,
  /** Above 1, shallow depressions stay nearly flat and only deep ones plunge. */
  bowlExponent: 1.35,
  /** Height of one raised shelf; terraced relief climbs in escarpment-bounded steps. */
  shelfHeight: 0.85,
  /** Shelves per unit of positive relief: escarpments sit near relief 0.3 and 0.68. */
  shelfRate: 2.6,
  /** Part of each shelf step (0..1) where the escarpment rises. */
  scarpFrom: 0.6,
  scarpTo: 0.88,
  /** Gentle rise across each shelf, so tops are not perfectly flat. */
  shelfSlope: 0.12,
  /** Untiered rise for rims and swells: `gain × relief^exponent`. */
  riseGain: 1.45,
  riseExponent: 1.1,
}

/**
 * Relief → height. Negative relief sinks into bowls and near-zero stays a
 * plain. Positive relief either rises smoothly (crater rims, swells) or, with
 * `terrace` = 1, as flat shelves separated by steep escarpments: the terraced
 * look of eroded Martian layered highlands. Only highland provinces and
 * erosional knobs are terraced, so crater rims never turn into walls.
 */
export function reliefHeight(relief: number, terrace = 1): number {
  const h = RELIEF_HEIGHT
  if (relief <= 0) return -h.basinDepth * (-relief) ** h.bowlExponent
  const s = relief * h.shelfRate
  const step = Math.floor(s)
  const terraced = h.shelfHeight * (step + smoothstep(h.scarpFrom, h.scarpTo, s - step)) + h.shelfSlope * relief
  const smooth = h.riseGain * relief ** h.riseExponent
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
  /** Real elevation without classification: one neutral ground, so colour carries no geological claim. */
  unclassified: { soil: 1 },
}

/** Province tint layered over the local mix, so regions read at the macro scale. */
const REGION_SURFACE: Record<Region, SurfaceWeights> = {
  plains: { sand: 0.35 },
  highlands: { sedimentary: 0.15 },
  basin: { lakebed: 0.55 },
  dunefield: { duneSand: 0.45 },
  volcanic: { basalt: 1.3 },
  craterfield: {},
  unclassified: {},
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
 * Ejecta rays: the bright streaks of crushed rock that radiate from young
 * impact craters (a geological feature, unrelated to ray-traced rendering).
 * Each crater gets a seeded number of streaks: fresh impacts show them fully,
 * overlapping craters faintly, eroded and shallow craters not at all.
 */
const EJECTA_RAYS = {
  strength: { fresh: 1, overlapping: 0.4, eroded: 0, shallow: 0 } satisfies Record<CraterKind, number>,
  count: { min: 7, max: 11 },
  /** Rays start just inside the rim and end by `outer`, in rim radii. */
  inner: 0.9,
  outer: 2.7,
  /** Fade-in across the rim crest, then exponential decay outward (rim radii). */
  fadeFrom: 0.92,
  fadeTo: 1.12,
  decay: 0.75,
  /** Higher values make thinner, sharper streaks. */
  sharpness: 5,
  /** How far streaks wander off a straight spoke, and the wander noise frequency. */
  wander: 0.8,
  wanderFrequency: 0.9,
  /** Cover between streaks, and the extra cover on a streak. */
  floor: 0.35,
  streak: 0.65,
  /** World height of a full-strength ray, and how strongly it paints the bright ejecta surface. */
  height: 0.035,
  surface: 1.6,
}

/** Surface detail on crater rims and on the floors of degraded craters. */
const CRATER_DETAIL = {
  /** Craters further than this many radii from a point (per axis) are skipped. */
  reach: 2.8,
  /** Half-width of the hummocky band around each rim crest, in rim radii. */
  crestWidth: 0.16,
  /** World height of the rim-crest hummocks. */
  crestRoughness: 0.07,
  /** Eroded craters hold sediment inside `outer`, fully inside `inner` (rim radii). */
  infill: { outer: 0.72, inner: 0.4 },
  /** How strongly infilled floors take the pale lakebed surface. */
  infillSurface: 1.3,
}

/** Domain warp of the sample points (cells), so contours and class borders never follow the grid. */
const FIELD_SAMPLING = {
  warpFrequency: 0.55,
  /** Warp applied when interpolating relief, and the stronger one when blending geology and region. */
  reliefWarp: 0.22,
  classWarp: 0.45,
  /** Bicubic overshoot allowed beyond the [-1, 1] relief range. */
  reliefLimit: 1.05,
}

/** Transverse dunes across the prevailing wind; lengths in world units. */
const DUNES = {
  /** Along-wind phase advance per world unit: sets the crest spacing. */
  frequency: 2.1,
  /** Sinuous crests: along-wind warp amount and its noise frequency. */
  wander: 0.9,
  wanderFrequency: 0.18,
  /** Crest profile over one wavelength: stoss slope up to `brink`, slip face down to `slipFaceEnd`. */
  brink: 0.74,
  slipFaceEnd: 0.86,
  stossExponent: 1.4,
  /** Crests break into segments: noise frequencies across and along the wind, ramp, and height range. */
  segmentAcross: 0.3,
  segmentAlong: 0.1,
  segmentFrom: -0.35,
  segmentTo: 0.3,
  segmentMin: 0.55,
  segmentRange: 0.45,
  height: 0.3,
  ripples: { height: 0.015, frequency: 3.2, offset: 0.35 },
}

/** Small landform relief added on top of the interpolated cell relief (world units). */
const MICRO_RELIEF = {
  /** Lava plains end in a low lobate flow front, so the province edge is a landform, not a stain. */
  flowFront: { height: 0.09, from: 0.3, to: 0.7 },
  /** Rough ground: rubble at full weight, ridges and buttes less. */
  roughness: { ridgeWeight: 0.6, butteWeight: 0.4, amplitude: 0.06, frequency: 2.4 },
  /** Rim-crest hummocks: skipped below `minCrest`, noise at `frequency`. */
  rimHummocks: { minCrest: 0.01, frequency: 1.5 },
  /** Fine detail everywhere. */
  detail: { amplitude: 0.018, frequency: 1.3 },
}

/** Landform shading baked into vertex colours (brightness multipliers ≈ 1). */
const LANDFORM_SHADING = {
  /** Hollows a touch darker, knobs a touch lighter, clamped. */
  curvatureGain: 0.35,
  curvatureMin: 0.88,
  curvatureMax: 1.06,
  /** High ground a touch lighter than low ground. */
  reliefBase: 0.95,
  reliefGain: 0.08,
  reliefFrom: -0.8,
  reliefTo: 0.9,
  /** Sunlit dune crests, darker troughs; `midCrest` is the neutral crest height. */
  duneGain: 0.42,
  duneMidCrest: 0.4,
}

/**
 * Visual height of a real-elevation map: corner samples relative to the
 * normalization reference, at true scale in world units, bilinear across each
 * cell (no overshoot beyond the measured values).
 */
function elevationHeightField(elevation: ElevationModel, grid: GridSpec) {
  const { cols, rows, cellSize } = grid
  const scale = worldUnitsPerMeter(cellSize, elevation.cellSizeMeters)
  const { referenceMeters } = elevation.normalization
  const heights = elevation.samplesMeters.map((meters) => (meters - referenceMeters) * scale)
  const corner = (col: number, row: number) => heights[cornerIndex(cols, col, row)]
  return (x: number, z: number) => {
    // Corner (col, row) sits at world ((col − cols/2) × cellSize, (row − rows/2) × cellSize).
    const u = clamp(x / cellSize + cols / 2, 0, cols)
    const v = clamp(z / cellSize + rows / 2, 0, rows)
    const i = Math.min(Math.floor(u), cols - 1)
    const j = Math.min(Math.floor(v), rows - 1)
    return lerp(lerp(corner(i, j), corner(i + 1, j), u - i), lerp(corner(i, j + 1), corner(i + 1, j + 1), u - i), v - j)
  }
}

/**
 * Continuous field built only from cell data. Relief is bicubically
 * interpolated across neighbouring cells, sample points are gently
 * domain-warped so contours never follow the grid, and each geology adds its
 * own micro-relief: wind-aligned dunes, rubble roughness, crater rims and the
 * ejecta rays of fresh impacts.
 */
export function createReliefField(map: ReliefMap, grid: GridSpec): TerrainField {
  // Real elevation is drawn as measured; surface mix and shading still read cell data.
  const measuredHeight = map.elevation ? elevationHeightField(map.elevation, grid) : null
  const warp = createNoise2D(hash(map.seed, 0xa1))
  const detail = createNoise2D(hash(map.seed, 0xa2))
  const rough = createNoise2D(hash(map.seed, 0xa3))
  const duneBreak = createNoise2D(hash(map.seed, 0xa5))
  // One prevailing wind for the whole map keeps every dune field (and yardang) aligned.
  const wind = prevailingWind(map.seed)
  const windX = Math.cos(wind)
  const windZ = Math.sin(wind)
  const ejectaRays = map.craters.map((crater) => {
    const rng = createRng(hash(crater.seed, 0x7a))
    return {
      count: rng.int(EJECTA_RAYS.count.min, EJECTA_RAYS.count.max),
      phase: rng.range(0, TAU),
      strength: EJECTA_RAYS.strength[crater.kind],
    }
  })

  /** World → continuous cell space, where cell (c, r) has its centre at (c, r). */
  const toCell = (x: number, z: number, amount: number) => ({
    u: x / grid.cellSize + map.cols / 2 - 0.5 + warp(x * FIELD_SAMPLING.warpFrequency, z * FIELD_SAMPLING.warpFrequency) * amount,
    v: z / grid.cellSize + map.rows / 2 - 0.5 + warp(z * FIELD_SAMPLING.warpFrequency + 31, x * FIELD_SAMPLING.warpFrequency - 17) * amount,
  })

  const reliefAt = (x: number, z: number) => {
    const { u, v } = toCell(x, z, FIELD_SAMPLING.reliefWarp)
    const i = Math.floor(u)
    const j = Math.floor(v)
    const rows = [-1, 0, 1, 2].map((dj) => {
      const r = (di: number) => cellAt(map, i + di, j + dj).relief
      return catmullRom(r(-1), r(0), r(1), r(2), u - i)
    })
    return clamp(catmullRom(rows[0], rows[1], rows[2], rows[3], v - j), -FIELD_SAMPLING.reliefLimit, FIELD_SAMPLING.reliefLimit)
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
    const { u, v } = toCell(x, z, FIELD_SAMPLING.classWarp)
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

  /** Ejecta-ray cover (0..1), rim crenulation weight, and the sediment infill of eroded craters. */
  const craterDetail = (x: number, z: number) => {
    let ejecta = 0
    let crest = 0
    let infill = 0
    if (map.craters.length === 0) return { ejecta, crest, infill }
    const u = x / grid.cellSize + map.cols / 2 - 0.5
    const v = z / grid.cellSize + map.rows / 2 - 0.5
    map.craters.forEach((crater, k) => {
      if (Math.abs(u - crater.col) > crater.radius * CRATER_DETAIL.reach || Math.abs(v - crater.row) > crater.radius * CRATER_DETAIL.reach) return
      const { d, angle } = craterPolar(crater, u, v)
      crest += Math.exp(-(((d - 1) / CRATER_DETAIL.crestWidth) ** 2))
      if (crater.kind === 'eroded') infill = Math.max(infill, smoothstep(CRATER_DETAIL.infill.outer, CRATER_DETAIL.infill.inner, d))
      const rays = ejectaRays[k]
      const e = EJECTA_RAYS
      if (rays.strength === 0 || d < e.inner || d > e.outer) return
      // Angular streak pattern, warped so the rays wander instead of radiating as perfect spokes.
      const streak = (0.5 + 0.5 * Math.cos(rays.count * angle + rays.phase + e.wander * warp(x * e.wanderFrequency, z * e.wanderFrequency))) ** e.sharpness
      const fade = smoothstep(e.fadeFrom, e.fadeTo, d) * Math.exp(-(d - 1) / e.decay)
      ejecta = Math.max(ejecta, rays.strength * fade * (e.floor + e.streak * streak))
    })
    return { ejecta, crest: Math.min(crest, 1), infill }
  }

  /**
   * Transverse dunes: long sinuous crests run across the wind. Each dune has a
   * gentle stoss slope, a sharp brink, a steep slip face and a flat interdune
   * corridor; crest height varies along the ridge. Returns crest height (0..1)
   * and the along-wind phase used for ripples.
   */
  const duneAt = (x: number, z: number) => {
    const d = DUNES
    const along = (x * windX + z * windZ) * d.frequency + warp(x * d.wanderFrequency, z * d.wanderFrequency) * d.wander
    const phase = along / TAU - Math.floor(along / TAU)
    const crestShape = phase < d.brink ? (phase / d.brink) ** d.stossExponent : phase < d.slipFaceEnd ? 1 - smoothstep(d.brink, d.slipFaceEnd, phase) : 0
    const across = -x * windZ + z * windX
    const segment = smoothstep(d.segmentFrom, d.segmentTo, duneBreak(across * d.segmentAcross, (x * windX + z * windZ) * d.segmentAlong))
    return { crest: crestShape * (d.segmentMin + d.segmentRange * segment), along }
  }

  return {
    heightAt(x, z) {
      if (measuredHeight) return measuredHeight(x, z)
      sampleCells(x, z)
      const terrace = clamp((region.get('highlands') ?? 0) + (geology.get('butte') ?? 0), 0, 1)
      // Noise terms are only evaluated where their landform exists: they dominate meshing cost.
      const dunes = geology.get('dunes') ?? 0
      let duneHeight = 0
      if (dunes > 0) {
        const dune = duneAt(x, z)
        const { ripples } = DUNES
        duneHeight = dunes * (DUNES.height * dune.crest + ripples.height * ((1 - Math.abs(Math.sin(dune.along * ripples.frequency))) ** 2 - ripples.offset))
      }
      const { flowFront: front, roughness: roughGround, rimHummocks, detail: fine } = MICRO_RELIEF
      const flowFront = front.height * smoothstep(front.from, front.to, region.get('volcanic') ?? 0)
      const roughness = (geology.get('rubble') ?? 0) + roughGround.ridgeWeight * (geology.get('ridge') ?? 0) + roughGround.butteWeight * (geology.get('butte') ?? 0)
      const { crest, ejecta } = craterDetail(x, z)
      return (
        reliefHeight(reliefAt(x, z), terrace) +
        flowFront +
        duneHeight +
        (roughness > 0 ? roughGround.amplitude * roughness * fbm(rough, x * roughGround.frequency, z * roughGround.frequency, 2) : 0) +
        // Uneven rim crests and hummocky ejecta, so rims never read as a lathe-turned ring.
        (crest > rimHummocks.minCrest
          ? crest * CRATER_DETAIL.crestRoughness * fbm(rough, x * rimHummocks.frequency + 11, z * rimHummocks.frequency, 2)
          : 0) +
        ejecta * EJECTA_RAYS.height +
        fine.amplitude * fbm(detail, x * fine.frequency, z * fine.frequency, 2)
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
      const { ejecta, infill } = craterDetail(x, z)
      if (ejecta > 0) out.ejecta = (out.ejecta ?? 0) + EJECTA_RAYS.surface * ejecta
      // Degraded craters hold pale, layered sediment on their flat floors.
      if (infill > 0) out.lakebed = (out.lakebed ?? 0) + CRATER_DETAIL.infillSurface * infill
      return out
    },
    shadeAt(x, z) {
      // Smoothed (B-spline) relief is plenty for shading and far cheaper than the bicubic height.
      const { curvature, relief } = sampleCells(x, z)
      const dunes = geology.get('dunes') ?? 0
      // Sunlit sand on dune crests, darker sand gathered in the troughs: dune fields read as ridged, not stained.
      const s = LANDFORM_SHADING
      const duneShade = dunes > 0 ? 1 + dunes * s.duneGain * (duneAt(x, z).crest - s.duneMidCrest) : 1
      // Hollows and crater bowls a touch darker, crests and high ground a touch lighter.
      return (
        clamp(1 + s.curvatureGain * curvature, s.curvatureMin, s.curvatureMax) *
        (s.reliefBase + s.reliefGain * smoothstep(s.reliefFrom, s.reliefTo, relief)) *
        duneShade
      )
    },
  }
}
