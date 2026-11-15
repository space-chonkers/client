import { clamp, createRng, fbm, hash, smoothstep, type Rng } from './noise'

/**
 * Impact craters on the Layer −1 relief: their vocabulary, per-kind shape,
 * how a map's crater population is placed, and how one crater is carved into
 * a relief value. Pure data with no Three.js dependency.
 */

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
export function applyCrater(crater: Crater, base: number, v: number, col: number, row: number): number {
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
export function placeCraters(
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
