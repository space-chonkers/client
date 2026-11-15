/** Deterministic randomness and small math helpers shared by every procedural asset. */

/** Inclusive `[min, max]` bounds, spread into {@link Rng.range} or {@link Rng.int}. */
export type Range = readonly [number, number]

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  range(min: number, max: number): number
  int(min: number, maxInclusive: number): number
  pick<T>(items: readonly T[]): T
  chance(probability: number): boolean
}

/** Mixes any number of integers into one well-distributed unsigned 32-bit hash. */
export function hash(...values: number[]): number {
  let h = 0x2545f491
  for (const value of values) {
    h ^= Math.imul(value | 0, 0x9e3779b1)
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    h ^= h >>> 16
  }
  return h >>> 0
}

/** Stateless random value in [0, 1) derived from integer coordinates. */
export function hash01(...values: number[]): number {
  return hash(...values) / 4294967296
}

/** Mulberry32 generator: fast, tiny, and fully reproducible for a given seed. */
export function createRng(seed: number): Rng {
  let state = hash(seed)
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (probability) => next() < probability,
  }
}

export type Noise2D = (x: number, z: number) => number

/** Smooth value noise in roughly [-1, 1]. */
export function createNoise2D(seed: number): Noise2D {
  return (x, z) => {
    const xi = Math.floor(x)
    const zi = Math.floor(z)
    const fx = x - xi
    const fz = z - zi
    const u = fx * fx * (3 - 2 * fx)
    const v = fz * fz * (3 - 2 * fz)
    const a = hash01(xi, zi, seed)
    const b = hash01(xi + 1, zi, seed)
    const c = hash01(xi, zi + 1, seed)
    const d = hash01(xi + 1, zi + 1, seed)
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1
  }
}

/** Fractal sum of noise octaves, normalized back to roughly [-1, 1]. */
export function fbm(noise: Noise2D, x: number, z: number, octaves = 3): number {
  let sum = 0
  let amplitude = 1
  let frequency = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise(x * frequency + i * 17.3, z * frequency - i * 9.1)
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2.03
  }
  return sum / norm
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Hermite step; edges may be given in descending order for a falling ramp. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
