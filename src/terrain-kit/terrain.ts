import * as THREE from 'three'
import { FacetBuilder, UP, DOWN } from './geometry'
import { clamp, createNoise2D, createRng, fbm, hash, hash01, smoothstep } from './noise'
import { PALETTE, materials } from './palette'

/** Logical gameplay grid. One cell = `cellSize` world units on the X/Z plane, centred on the origin. */
export interface GridSpec {
  cols: number
  rows: number
  cellSize: number
}

/** World-space centre of a logical cell (y = 0). */
export function cellCenter(grid: GridSpec, col: number, row: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(
    (col + 0.5 - grid.cols / 2) * grid.cellSize,
    0,
    (row + 0.5 - grid.rows / 2) * grid.cellSize,
  )
}

export const SURFACE_TYPES = ['sand', 'soil', 'rocky', 'sedimentary', 'cracked', 'duneSand', 'basalt', 'lakebed', 'ejecta'] as const
export type SurfaceType = (typeof SURFACE_TYPES)[number]
export type SurfaceWeights = Partial<Record<SurfaceType, number>>

/** Continuous description of a landscape; the mesh is just a faceted sampling of it. */
export interface TerrainField {
  heightAt(x: number, z: number): number
  surfaceAt(x: number, z: number): SurfaceWeights
  /** Optional brightness multiplier (≈1): landform shading such as darker hollows, lighter crests. */
  shadeAt?(x: number, z: number): number
}

export interface TerrainOptions {
  grid: GridSpec
  field: TerrainField
  seed: number
  /** Facets per cell edge. 3 keeps facets chunky but hides the grid. */
  subdivisions?: number
  /** Depth of the stratified diorama walls below y = 0; 0 disables them. */
  skirtDepth?: number
  /**
   * Splits the surface into square meshes of this many cells so the camera and
   * shadow passes can cull what's off-screen; 0 builds a single mesh.
   */
  chunkCells?: number
}

const COLORS = {
  sand: new THREE.Color(PALETTE.sand),
  sandLight: new THREE.Color(PALETTE.sandLight),
  soil: new THREE.Color(PALETTE.soil),
  rocky: new THREE.Color(PALETTE.rocky),
  rockyLight: new THREE.Color(PALETTE.rockyLight),
  cracked: new THREE.Color(PALETTE.cracked),
  cliff: new THREE.Color(PALETTE.cliff),
  cliffBand: new THREE.Color(PALETTE.cliff).lerp(new THREE.Color(PALETTE.rockyLight), 0.6),
  sediment: PALETTE.sediment.map((hex) => new THREE.Color(hex)),
  skirt: PALETTE.skirt.map((hex) => new THREE.Color(hex)),
  duneSand: new THREE.Color(PALETTE.duneSand),
  duneSandLight: new THREE.Color(PALETTE.duneSandLight),
  basalt: new THREE.Color(PALETTE.basaltPlain[0]),
  basaltDark: new THREE.Color(PALETTE.basaltPlain[1]),
  lakebed: PALETTE.lakebed.map((hex) => new THREE.Color(hex)),
  ejecta: new THREE.Color(PALETTE.ejecta),
}
const mean = (colors: THREE.Color[]) => colors.reduce((sum, c) => sum.add(c), new THREE.Color(0, 0, 0)).multiplyScalar(1 / colors.length)
/** Flat ground shows a layer's average tone; bands only appear where slopes cut through the beds. */
const SEDIMENT_MEAN = mean(COLORS.sediment)
const LAKEBED_MEAN = mean(COLORS.lakebed)

const _typeColor = new THREE.Color()
/**
 * Colour band index that stays valid for any height: real elevation is drawn at
 * true scale and can sit far below the procedural range, where `%` alone would
 * go negative. Identical to `%` for the non-negative indices procedural maps produce.
 */
const bandOf = <T,>(bands: readonly T[], band: number) => bands[((band % bands.length) + bands.length) % bands.length]

function typeColor(type: SurfaceType, point: THREE.Vector3, faceRand: number, broad: number, exposure: number): THREE.Color {
  switch (type) {
    case 'sand':
      return _typeColor.copy(COLORS.sand).lerp(COLORS.sandLight, 0.5 * smoothstep(-0.2, 0.5, broad))
    case 'duneSand':
      return _typeColor.copy(COLORS.duneSand).lerp(COLORS.duneSandLight, smoothstep(-0.3, 0.6, broad) * 0.6)
    case 'basalt':
      // Sparse darker facets read as scattered basalt fragments.
      return _typeColor.copy(faceRand > 0.72 ? COLORS.basaltDark : COLORS.basalt)
    case 'lakebed': {
      // Faint, broad bands: light-toned layered lake sediment.
      const band = Math.floor(point.y * 9 + broad * 1.5 + 100)
      return _typeColor.copy(LAKEBED_MEAN).lerp(bandOf(COLORS.lakebed, band), 0.2 + 0.8 * exposure)
    }
    case 'ejecta':
      return _typeColor.copy(COLORS.ejecta)
    case 'soil':
      return _typeColor.copy(COLORS.soil)
    case 'rocky':
      // Two-tone speckle reads as loose stones at facet scale.
      return _typeColor.copy(faceRand > 0.72 ? COLORS.rockyLight : COLORS.rocky)
    case 'sedimentary': {
      // Bands follow elevation contours, like eroded layered bedrock.
      const band = Math.floor(point.y * 14 + broad * 2 + 100)
      return _typeColor.copy(SEDIMENT_MEAN).lerp(bandOf(COLORS.sediment, band), 0.15 + 0.85 * exposure)
    }
    case 'cracked':
      return _typeColor.copy(COLORS.cracked)
  }
}

function surfaceColor(
  weights: SurfaceWeights,
  point: THREE.Vector3,
  normalY: number,
  faceRand: number,
  broad: number,
  out: THREE.Color,
): THREE.Color {
  out.setRGB(0, 0, 0)
  let total = 0
  const exposure = smoothstep(0.985, 0.85, normalY)
  for (const type of SURFACE_TYPES) {
    const weight = weights[type] ?? 0
    if (weight <= 0) continue
    // Squaring sharpens transitions without making them hard-edged.
    const w = weight * weight
    total += w
    out.add(typeColor(type, point, faceRand, broad, exposure).multiplyScalar(w))
  }
  if (total === 0) out.copy(COLORS.sand)
  else out.multiplyScalar(1 / total)
  // Steep faces expose darker, layered bedrock regardless of surface type.
  const bedrock = Math.floor(point.y * 8 + 100) % 2 === 0 ? COLORS.cliff : COLORS.cliffBand
  out.lerp(bedrock, smoothstep(0.9, 0.6, normalY) * 0.8)
  return out.multiplyScalar(0.98 + faceRand * 0.04 + broad * 0.035)
}

/**
 * Height of the *rendered* faceted surface: the same jittered vertices and
 * triangle diagonals as the mesh, so objects grounded with it can't sink into
 * facets the analytic field doesn't know about.
 */
export interface TerrainSurface {
  heightAt(x: number, z: number): number
}

export interface BuiltTerrain {
  group: THREE.Group
  surface: TerrainSurface
  /** Surface meshes (one per chunk), excluding the skirt. */
  chunks: THREE.Mesh[]
}

/** Quad (i, j) splits along a→c when true, b→d otherwise; shared by mesher and surface queries. */
const splitsAC = (seed: number, i: number, j: number) => hash01(seed, i, j, 7) < 0.5

/** Height on triangle pqr at (x, z) via XZ barycentrics, or null when outside it. */
function triangleHeight(p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, x: number, z: number): number | null {
  const d = (q.z - r.z) * (p.x - r.x) + (r.x - q.x) * (p.z - r.z)
  if (Math.abs(d) < 1e-12) return null
  const w1 = ((q.z - r.z) * (x - r.x) + (r.x - q.x) * (z - r.z)) / d
  const w2 = ((r.z - p.z) * (x - r.x) + (p.x - r.x) * (z - r.z)) / d
  const w3 = 1 - w1 - w2
  const eps = -1e-7
  if (w1 < eps || w2 < eps || w3 < eps) return null
  return w1 * p.y + w2 * q.y + w3 * r.y
}

/**
 * Builds a cohesive, faceted landscape over a logical grid, with its exact
 * surface sampler and chunk meshes. Vertices are jittered and triangulation
 * directions vary so the cell structure never reads as tiles.
 */
export function buildTerrain({ grid, field, seed, subdivisions = 3, skirtDepth = 1.2, chunkCells = 0 }: TerrainOptions): BuiltTerrain {
  const step = grid.cellSize / subdivisions
  const nx = grid.cols * subdivisions
  const nz = grid.rows * subdivisions
  const x0 = (-grid.cols * grid.cellSize) / 2
  const z0 = (-grid.rows * grid.cellSize) / 2

  const vertices: THREE.Vector3[] = []
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      let x = x0 + i * step
      let z = z0 + j * step
      // Border vertices only slide along their edge so the block stays square.
      if (i > 0 && i < nx) x += (hash01(seed, i, j, 1) - 0.5) * step * 0.55
      if (j > 0 && j < nz) z += (hash01(seed, i, j, 2) - 0.5) * step * 0.55
      vertices.push(new THREE.Vector3(x, field.heightAt(x, z), z))
    }
  }
  const vertex = (i: number, j: number) => vertices[j * (nx + 1) + i]

  const quadHeight = (i: number, j: number, x: number, z: number) => {
    const a = vertex(i, j)
    const b = vertex(i + 1, j)
    const c = vertex(i + 1, j + 1)
    const d = vertex(i, j + 1)
    return splitsAC(seed, i, j)
      ? (triangleHeight(a, b, c, x, z) ?? triangleHeight(a, c, d, x, z))
      : (triangleHeight(a, b, d, x, z) ?? triangleHeight(b, c, d, x, z))
  }
  const surface: TerrainSurface = {
    heightAt(x, z) {
      // Jitter moves vertices < 0.3 step, so the containing quad is the nominal one or a neighbour.
      const cx = clamp(x, x0, -x0)
      const cz = clamp(z, z0, -z0)
      const i0 = clamp(Math.floor((cx - x0) / step), 0, nx - 1)
      const j0 = clamp(Math.floor((cz - z0) / step), 0, nz - 1)
      for (const dj of [0, -1, 1]) {
        for (const di of [0, -1, 1]) {
          const i = i0 + di
          const j = j0 + dj
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue
          const h = quadHeight(i, j, cx, cz)
          if (h !== null) return h
        }
      }
      return vertex(i0, j0).y
    },
  }

  const broadNoise = createNoise2D(hash(seed, 5))
  const quadsPerChunk = chunkCells > 0 ? chunkCells * subdivisions : Math.max(nx, nz)
  const chunksX = Math.ceil(nx / quadsPerChunk)
  const builders = Array.from({ length: chunksX * Math.ceil(nz / quadsPerChunk) }, () => new FacetBuilder())
  const centroid = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const color = new THREE.Color()

  const addFace = (builder: FacetBuilder, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, faceId: number) => {
    centroid.copy(a).add(b).add(c).divideScalar(3)
    normal.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize()
    const normalY = Math.abs(normal.y)
    const broad = fbm(broadNoise, centroid.x * 0.45, centroid.z * 0.45, 2)
    surfaceColor(field.surfaceAt(centroid.x, centroid.z), centroid, normalY, hash01(seed, faceId, 3), broad, color)
    if (field.shadeAt) color.multiplyScalar(field.shadeAt(centroid.x, centroid.z))
    builder.triangle(a, b, c, color, UP)
  }

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const builder = builders[Math.floor(j / quadsPerChunk) * chunksX + Math.floor(i / quadsPerChunk)]
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const c = vertex(i + 1, j + 1)
      const d = vertex(i, j + 1)
      const id = (j * nx + i) * 2
      if (splitsAC(seed, i, j)) {
        addFace(builder, a, b, c, id)
        addFace(builder, a, c, d, id + 1)
      } else {
        addFace(builder, a, b, d, id)
        addFace(builder, b, c, d, id + 1)
      }
    }
  }

  const group = new THREE.Group()
  group.name = 'terrain'
  const chunks = builders.map((builder, index) => {
    const mesh = new THREE.Mesh(builder.build(), materials.matte())
    mesh.name = builders.length > 1 ? `terrain-chunk-${index}` : 'terrain-surface'
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  })

  if (skirtDepth > 0) {
    const edges = [
      { points: Array.from({ length: nx + 1 }, (_, i) => vertex(i, 0)), outward: new THREE.Vector3(0, 0, -1) },
      { points: Array.from({ length: nx + 1 }, (_, i) => vertex(i, nz)), outward: new THREE.Vector3(0, 0, 1) },
      { points: Array.from({ length: nz + 1 }, (_, j) => vertex(0, j)), outward: new THREE.Vector3(-1, 0, 0) },
      { points: Array.from({ length: nz + 1 }, (_, j) => vertex(nx, j)), outward: new THREE.Vector3(1, 0, 0) },
    ]
    const corners = [vertex(0, 0), vertex(nx, 0), vertex(nx, nz), vertex(0, nz)]
    group.add(createSkirt(edges, corners, skirtDepth, seed))
  }
  return { group, surface, chunks }
}

/** Absolute heights of the rock strata exposed on the diorama walls. */
const STRATA_LEVELS = [0.42, 0.18, -0.1, -0.38, -0.68, -0.98]
const TOPSOIL = 0.1

/** Cut-away walls showing layered bedrock: the classic diorama "cake slice". */
function createSkirt(
  edges: { points: THREE.Vector3[]; outward: THREE.Vector3 }[],
  corners: THREE.Vector3[],
  depth: number,
  seed: number,
): THREE.Mesh {
  const builder = new FacetBuilder()
  const wobble = createNoise2D(hash(seed, 11))
  const topsoil = COLORS.soil.clone().multiplyScalar(0.85)
  const color = new THREE.Color()

  // Boundaries depend only on world position, so neighbouring edges agree at corners.
  const boundaries = (p: THREE.Vector3) => {
    const top = Math.max(p.y - TOPSOIL, -depth)
    const levels = [top]
    STRATA_LEVELS.forEach((level, k) => {
      levels.push(clamp(level + wobble(p.x * 1.1 + k * 13, p.z * 1.1 - k * 7) * 0.05, -depth, top))
    })
    levels.push(-depth)
    return levels
  }

  let segment = 0
  for (const { points, outward } of edges) {
    for (let s = 0; s < points.length - 1; s++, segment++) {
      const p = points[s]
      const q = points[s + 1]
      const variation = 0.94 + hash01(seed, segment, 13) * 0.1
      builder.quad(
        new THREE.Vector3(p.x, p.y - TOPSOIL, p.z),
        new THREE.Vector3(q.x, q.y - TOPSOIL, q.z),
        q,
        p,
        color.copy(topsoil).multiplyScalar(variation),
        outward,
      )
      const bp = boundaries(p)
      const bq = boundaries(q)
      for (let k = 0; k < bp.length - 1; k++) {
        builder.quad(
          new THREE.Vector3(p.x, bp[k + 1], p.z),
          new THREE.Vector3(q.x, bq[k + 1], q.z),
          new THREE.Vector3(q.x, bq[k], q.z),
          new THREE.Vector3(p.x, bp[k], p.z),
          color.copy(COLORS.skirt[k % COLORS.skirt.length]).multiplyScalar(variation),
          outward,
        )
      }
    }
  }

  const [a, b, c, d] = corners.map((corner) => new THREE.Vector3(corner.x, -depth, corner.z))
  builder.quad(a, b, c, d, color.copy(COLORS.skirt[5]).multiplyScalar(0.6), DOWN)

  const mesh = new THREE.Mesh(builder.build(), materials.matte())
  mesh.name = 'terrain-skirt'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * Radial crater height offset: a bowl with a softly raised rim.
 * Add it to any height function to carve a crater into the terrain.
 */
export function craterProfile(distance: number, radius: number, depth: number, rimHeight: number): number {
  const t = distance / radius
  const bowl = t < 1 ? -depth * (1 - t * t) ** 2 : 0
  const rim = rimHeight * Math.exp(-(((t - 1) / 0.3) ** 2))
  return bowl + rim
}

export interface GroundTint {
  x: number
  z: number
  radius: number
  /** Contact darkening at the centre (0..1), fading to nothing at the radius. */
  darken?: number
  /** Stain colour blended in by `amount` at the centre (mineral halos, ejecta). */
  color?: THREE.Color
  amount?: number
  /** Varies the outline so stains are lobed, not circles. */
  seed?: number
}

/**
 * Bakes soft ground marks into terrain vertex colours, per facet: contact
 * darkening at the foot of rocks and formations (grounding them without
 * extra geometry or lights) and stains such as mineral halos. Zero draw calls.
 */
export function tintSurface(meshes: readonly THREE.Mesh[], tints: readonly GroundTint[]): void {
  const box = new THREE.Box3()
  const blended = new THREE.Color()
  for (const mesh of meshes) {
    const geometry = mesh.geometry
    geometry.computeBoundingBox()
    box.copy(geometry.boundingBox!)
    const local = tints.filter(
      (t) => t.x + t.radius > box.min.x && t.x - t.radius < box.max.x && t.z + t.radius > box.min.z && t.z - t.radius < box.max.z,
    )
    if (local.length === 0) continue
    const position = geometry.getAttribute('position')
    const color = geometry.getAttribute('color') as THREE.BufferAttribute
    for (let face = 0; face < position.count / 3; face++) {
      const i = face * 3
      const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3
      const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3
      let r = color.getX(i)
      let g = color.getY(i)
      let b = color.getZ(i)
      let touched = false
      for (const t of local) {
        const dx = x - t.x
        const dz = z - t.z
        if (Math.abs(dx) > t.radius || Math.abs(dz) > t.radius) continue
        const lobes = t.seed === undefined ? 1 : 1 + 0.22 * Math.sin(3 * Math.atan2(dz, dx) + (t.seed % 628) / 100)
        const f = smoothstep(t.radius * lobes, t.radius * lobes * 0.3, Math.hypot(dx, dz))
        if (f <= 0) continue
        touched = true
        if (t.color && t.amount) {
          const k = t.amount * f
          blended.setRGB(r, g, b).lerp(t.color, k)
          r = blended.r
          g = blended.g
          b = blended.b
        }
        if (t.darken) {
          const k = 1 - t.darken * f
          r *= k
          g *= k
          b *= k
        }
      }
      if (!touched) continue
      for (let k = 0; k < 3; k++) color.setXYZ(i + k, r, g, b)
    }
    color.needsUpdate = true
  }
}

export interface CrackOptions {
  seed: number
  heightAt: (x: number, z: number) => number
  center: { x: number; z: number }
  radius: number
  /** Typical plate size between cracks. */
  spacing?: number
  width?: number
}

/**
 * Polygonal mud-crack network draped over the terrain. Edges of a jittered
 * triangular lattice become fissures: dense near the centre, fragmentary
 * towards the edge so the patch fades out instead of ending in a circle.
 */
export function createCrackDecals({ seed, heightAt, center, radius, spacing = 0.42, width = 0.017 }: CrackOptions): THREE.Mesh {
  const rng = createRng(hash(seed, 0xc4ac))
  const builder = new FacetBuilder()
  const color = new THREE.Color(PALETTE.crack)
  const lift = 0.02
  const rowStep = spacing * 0.866
  const rows = Math.ceil(radius / rowStep)
  const cols = Math.ceil(radius / spacing) + 1

  const nodes = new Map<string, { x: number; z: number }>()
  const key = (i: number, j: number) => `${i},${j}`
  for (let j = -rows; j <= rows; j++) {
    for (let i = -cols; i <= cols; i++) {
      nodes.set(key(i, j), {
        x: center.x + (i + (j & 1) * 0.5) * spacing + rng.range(-0.3, 0.3) * spacing,
        z: center.z + j * rowStep + rng.range(-0.3, 0.3) * spacing,
      })
    }
  }

  const point = (x: number, z: number) => new THREE.Vector3(x, heightAt(x, z) + lift, z)
  const ribbon = (ax: number, az: number, bx: number, bz: number, w: number) => {
    const length = Math.hypot(bx - ax, bz - az)
    const px = (-(bz - az) / length) * w
    const pz = ((bx - ax) / length) * w
    builder.quad(point(ax + px, az + pz), point(ax - px, az - pz), point(bx - px, bz - pz), point(bx + px, bz + pz), color, UP)
  }
  const strength = (p: { x: number; z: number }) => 1 - Math.hypot(p.x - center.x, p.z - center.z) / radius

  for (let j = -rows; j <= rows; j++) {
    for (let i = -cols; i <= cols; i++) {
      const a = nodes.get(key(i, j))!
      const odd = j & 1
      for (const [ni, nj] of [[i + 1, j], [i - 1 + odd, j + 1], [i + odd, j + 1]]) {
        const b = nodes.get(key(ni, nj))
        if (!b) continue
        const s = Math.min(strength(a), strength(b))
        if (s <= 0 || rng.next() > (s > 0.25 ? 0.85 : 0.2)) continue
        // A kinked midpoint keeps the fissures from looking ruled.
        const mx = (a.x + b.x) / 2 + rng.range(-0.12, 0.12) * spacing
        const mz = (a.z + b.z) / 2 + rng.range(-0.12, 0.12) * spacing
        const w = width * (0.55 + 0.45 * s)
        ribbon(a.x, a.z, mx, mz, w)
        ribbon(mx, mz, b.x, b.z, w)
      }
    }
  }

  const mesh = new THREE.Mesh(builder.build(), materials.decal())
  mesh.name = 'cracks'
  mesh.receiveShadow = true
  return mesh
}
