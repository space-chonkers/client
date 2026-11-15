import { craterPolar, type CraterKind } from './craters'
import { clamp, createNoise2D, createRng, fbm, hash, smoothstep } from './noise'
import { cellAt, prevailingWind, type Geology, type Region, type ReliefMap, type TerrainCell } from './reliefMap'
import type { GridSpec, SurfaceWeights, TerrainField } from './terrain'

/**
 * The continuous Layer −1 landscape derived from a {@link ReliefMap}: height
 * (interpolated cell relief plus landform micro-relief), surface material
 * mix (cell geology and region) and landform shading. `reliefTerrain.ts`
 * meshes it and dresses it.
 */

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
 * Ejecta rays: the bright streaks of crushed rock that radiate from young
 * impact craters (a geological feature, unrelated to ray-traced rendering).
 * Each crater gets a seeded number of streaks: fresh impacts show them fully,
 * overlapping craters faintly, eroded and shallow craters not at all.
 */
const EJECTA_RAY_STRENGTH: Record<CraterKind, number> = { fresh: 1, overlapping: 0.4, eroded: 0, shallow: 0 }
const EJECTA_RAY_COUNT = { min: 7, max: 11 }
/** Rays start just inside the rim and fade out by this distance, in rim radii. */
const EJECTA_RAY_REACH = { inner: 0.9, outer: 2.7 }
/** World height of a full-strength ray, and how strongly it paints the bright ejecta surface. */
const EJECTA_RAY_HEIGHT = 0.035
const EJECTA_RAY_SURFACE = 1.6

/** Surface detail on crater rims and on the floors of degraded craters. */
const CRATER_DETAIL = {
  /** Half-width of the hummocky band around each rim crest, in rim radii. */
  crestWidth: 0.16,
  /** World height of the rim-crest hummocks. */
  crestRoughness: 0.07,
  /** Eroded craters hold sediment inside `outer`, fully inside `inner` (rim radii). */
  infill: { outer: 0.72, inner: 0.4 },
  /** How strongly infilled floors take the pale lakebed surface. */
  infillSurface: 1.3,
}

/**
 * Continuous field built only from cell data. Relief is bicubically
 * interpolated across neighbouring cells, sample points are gently
 * domain-warped so contours never follow the grid, and each geology adds its
 * own micro-relief: wind-aligned dunes, rubble roughness, crater rims and the
 * ejecta rays of fresh impacts.
 */
export function createReliefField(map: ReliefMap, grid: GridSpec): TerrainField {
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
      count: rng.int(EJECTA_RAY_COUNT.min, EJECTA_RAY_COUNT.max),
      phase: rng.range(0, TAU),
      strength: EJECTA_RAY_STRENGTH[crater.kind],
    }
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

  /** Ejecta-ray cover (0..1), rim crenulation weight, and the sediment infill of eroded craters. */
  const craterDetail = (x: number, z: number) => {
    let ejecta = 0
    let crest = 0
    let infill = 0
    if (map.craters.length === 0) return { ejecta, crest, infill }
    const u = x / grid.cellSize + map.cols / 2 - 0.5
    const v = z / grid.cellSize + map.rows / 2 - 0.5
    map.craters.forEach((crater, k) => {
      if (Math.abs(u - crater.col) > crater.radius * 2.8 || Math.abs(v - crater.row) > crater.radius * 2.8) return
      const { d, angle } = craterPolar(crater, u, v)
      crest += Math.exp(-(((d - 1) / CRATER_DETAIL.crestWidth) ** 2))
      if (crater.kind === 'eroded') infill = Math.max(infill, smoothstep(CRATER_DETAIL.infill.outer, CRATER_DETAIL.infill.inner, d))
      const rays = ejectaRays[k]
      if (rays.strength === 0 || d < EJECTA_RAY_REACH.inner || d > EJECTA_RAY_REACH.outer) return
      // Angular streak pattern, warped so the rays wander instead of radiating as perfect spokes.
      const streak = (0.5 + 0.5 * Math.cos(rays.count * angle + rays.phase + 0.8 * warp(x * 0.9, z * 0.9))) ** 5
      const fade = smoothstep(0.92, 1.12, d) * Math.exp(-(d - 1) / 0.75)
      ejecta = Math.max(ejecta, rays.strength * fade * (0.35 + 0.65 * streak))
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
    const along = (x * windX + z * windZ) * 2.1 + warp(x * 0.18, z * 0.18) * 0.9
    const phase = along / TAU - Math.floor(along / TAU)
    const crestShape = phase < 0.74 ? (phase / 0.74) ** 1.4 : phase < 0.86 ? 1 - smoothstep(0.74, 0.86, phase) : 0
    const across = -x * windZ + z * windX
    const segment = smoothstep(-0.35, 0.3, duneBreak(across * 0.3, (x * windX + z * windZ) * 0.1))
    return { crest: crestShape * (0.55 + 0.45 * segment), along }
  }

  return {
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
      const { crest, ejecta } = craterDetail(x, z)
      return (
        reliefHeight(reliefAt(x, z), terrace) +
        flowFront +
        duneHeight +
        (roughness > 0 ? 0.06 * roughness * fbm(rough, x * 2.4, z * 2.4, 2) : 0) +
        // Uneven rim crests and hummocky ejecta, so rims never read as a lathe-turned ring.
        (crest > 0.01 ? crest * CRATER_DETAIL.crestRoughness * fbm(rough, x * 1.5 + 11, z * 1.5, 2) : 0) +
        ejecta * EJECTA_RAY_HEIGHT +
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
      const { ejecta, infill } = craterDetail(x, z)
      if (ejecta > 0) out.ejecta = (out.ejecta ?? 0) + EJECTA_RAY_SURFACE * ejecta
      // Degraded craters hold pale, layered sediment on their flat floors.
      if (infill > 0) out.lakebed = (out.lakebed ?? 0) + CRATER_DETAIL.infillSurface * infill
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
