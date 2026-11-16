import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { painted } from '../terrain-kit/geometry'
import { createGridOverlay } from './gridOverlay'
import { materials } from '../terrain-kit/palette'
import { MINERAL_FEATURES, cellAt, type ReliefMap } from '../terrain-kit/reliefMap'
import { createReliefTerrain } from '../terrain-kit/reliefTerrain'
import { cellCenter, type GridSpec } from '../terrain-kit/terrain'
import type { DebugState, RenderMode, ShowcaseContent } from './types'

const CELL_SIZE = 1
const SKIRT_DEPTH = 1.7
/** World height of relief ±1 in the data view. */
const DATA_SCALE = 1.5
/** Relief values are labelled in a window around the view centre; 2,500 labels would be unreadable and slow. */
const LABEL_WINDOW = 11
/** Beyond this camera distance cells are too small on screen for labels to read. */
const LABEL_MAX_DISTANCE = 32

/** Diverging debug ramp: cool depressions, neutral cream, hot elevations. */
const RAMP: [number, THREE.Color][] = [
  [-1, new THREE.Color('#2c3f9e')],
  [-0.5, new THREE.Color('#4f8fd6')],
  [0, new THREE.Color('#efe3cf')],
  [0.5, new THREE.Color('#f0a04b')],
  [1, new THREE.Color('#c4311c')],
]

export function reliefColor(relief: number, target = new THREE.Color()): THREE.Color {
  for (let k = 1; k < RAMP.length; k++) {
    const [v1, c1] = RAMP[k]
    if (relief <= v1 || k === RAMP.length - 1) {
      const [v0, c0] = RAMP[k - 1]
      return target.lerpColors(c0, c1, THREE.MathUtils.clamp((relief - v0) / (v1 - v0), 0, 1))
    }
  }
  return target
}

export const reliefHex = (relief: number) => `#${reliefColor(relief).getHexString()}`

/** The Layer −1 terrain for one map, from any source, with its debug views. */
export function buildTerrainLayerView(map: ReliefMap): ShowcaseContent {
  const grid: GridSpec = { cols: map.cols, rows: map.rows, cellSize: CELL_SIZE }
  const terrain = createReliefTerrain({ map, cellSize: CELL_SIZE, skirtDepth: SKIRT_DEPTH })
  const { surface } = terrain
  const highlight = createHighlight()

  const root = new THREE.Group()
  root.name = 'terrain-layer-view'
  root.add(terrain.root, highlight)
  const bounds = new THREE.Box3().setFromObject(root)

  const toCell = (x: number, z: number) => ({
    col: THREE.MathUtils.clamp(Math.floor(x / CELL_SIZE + map.cols / 2), 0, map.cols - 1),
    row: THREE.MathUtils.clamp(Math.floor(z / CELL_SIZE + map.rows / 2), 0, map.rows - 1),
  })
  const surfaceY = (col: number, row: number, mode: RenderMode) => {
    if (mode === 'data') return cellAt(map, col, row).relief * DATA_SCALE
    const { x, z } = cellCenter(grid, col, row)
    return surface.heightAt(x, z)
  }

  // Debug views for validating the generator: relief tint and data columns
  // check relief values, the grid overlay checks cell alignment, labels show
  // exact values. They are built on first use: most sessions never open them.
  let tint: { attribute: THREE.BufferAttribute; original: Float32Array; relief: Float32Array }[] | null = null
  let tinted = false
  let columns: THREE.InstancedMesh | null = null
  let gridOverlay: THREE.LineSegments | null = null
  let labels: THREE.Group | null = null

  /** Relief mode recolours the terrain chunks in place: no extra geometry, a perfect drape. */
  const setReliefTint = (on: boolean) => {
    if (on === tinted) return
    tinted = on
    tint ??= terrain.chunks.map((mesh) => {
      const attribute = mesh.geometry.getAttribute('color') as THREE.BufferAttribute
      const position = mesh.geometry.getAttribute('position')
      const original = (attribute.array as Float32Array).slice()
      const relief = new Float32Array(original.length)
      const color = new THREE.Color()
      for (let face = 0; face < position.count / 3; face++) {
        const i = face * 3
        const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3
        const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3
        const { col, row } = toCell(x, z)
        reliefColor(cellAt(map, col, row).relief, color)
        for (let k = 0; k < 3; k++) {
          const o = (i + k) * 3
          // Keep a little of the lit terrain colour so landforms stay readable.
          relief[o] = color.r * 0.8 + original[o] * 0.2
          relief[o + 1] = color.g * 0.8 + original[o + 1] * 0.2
          relief[o + 2] = color.b * 0.8 + original[o + 2] * 0.2
        }
      }
      return { attribute, original, relief }
    })
    for (const { attribute, original, relief } of tint) {
      ;(attribute.array as Float32Array).set(on ? relief : original)
      attribute.needsUpdate = true
    }
  }

  /** Raw data view: one instanced column per cell (a single draw call for all 2,500). */
  const ensureColumns = () => {
    if (columns) return columns
    const box = painted(new THREE.BoxGeometry(CELL_SIZE * 0.9, 1, CELL_SIZE * 0.9), '#ffffff')
    columns = new THREE.InstancedMesh(box, materials.matte(), map.cells.length)
    columns.name = 'relief-columns'
    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()
    map.cells.forEach((cell, index) => {
      const top = cell.relief * DATA_SCALE
      const height = top + SKIRT_DEPTH
      const { x, z } = cellCenter(grid, cell.col, cell.row)
      matrix.makeScale(1, height, 1).setPosition(x, top - height / 2, z)
      columns!.setMatrixAt(index, matrix)
      columns!.setColorAt(index, reliefColor(cell.relief, color))
    })
    columns.castShadow = true
    columns.receiveShadow = true
    columns.computeBoundingSphere()
    root.add(columns)
    return columns
  }

  const ensureGrid = () => {
    if (gridOverlay) return gridOverlay
    gridOverlay = createGridOverlay(grid, surface.heightAt, { samplesPerCell: 3, opacity: 0.4 })
    root.add(gridOverlay)
    return gridOverlay
  }

  let mode: RenderMode = 'terrain'
  let focus = toCell(0, 0)
  let labelsWanted = false
  let zoomedIn = false

  /** Points the pooled labels at the cells around the current focus. */
  const refreshLabels = () => {
    if (labels) labels.visible = labelsWanted && zoomedIn
    if (!labels?.visible) return
    const half = Math.floor(LABEL_WINDOW / 2)
    labels.children.forEach((label, k) => {
      const col = focus.col - half + (k % LABEL_WINDOW)
      const row = focus.row - half + Math.floor(k / LABEL_WINDOW)
      label.visible = col >= 0 && row >= 0 && col < map.cols && row < map.rows
      if (!label.visible) return
      const { relief } = cellAt(map, col, row)
      const element = (label as CSS2DObject).element
      element.textContent = relief.toFixed(2)
      element.style.borderColor = reliefHex(relief)
      const { x, z } = cellCenter(grid, col, row)
      label.position.set(x, surfaceY(col, row, mode) + (mode === 'data' ? 0.12 : 0.22), z)
    })
  }

  const ensureLabels = () => {
    if (labels) return labels
    labels = new THREE.Group()
    labels.name = 'relief-labels'
    for (let k = 0; k < LABEL_WINDOW * LABEL_WINDOW; k++) {
      const element = document.createElement('div')
      element.className = 'relief-label'
      labels.add(new CSS2DObject(element))
    }
    root.add(labels)
    return labels
  }

  let highlighted: { col: number; row: number } | null = null
  const drawHighlight = () => {
    highlight.visible = highlighted !== null
    if (!highlighted) return
    const { col, row } = highlighted
    const x0 = (col - map.cols / 2) * CELL_SIZE
    const z0 = (row - map.rows / 2) * CELL_SIZE
    const s = CELL_SIZE
    const flatY = surfaceY(col, row, mode) + 0.02
    const corners = [[x0, z0], [x0 + s, z0], [x0 + s, z0 + s], [x0, z0 + s], [x0, z0]]
    const points: THREE.Vector3[] = []
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k]
      const [bx, bz] = corners[k + 1]
      for (let t = 0; t < 8; t++) {
        const x = ax + ((bx - ax) * t) / 8
        const z = az + ((bz - az) * t) / 8
        points.push(new THREE.Vector3(x, mode === 'data' ? flatY : surface.heightAt(x, z) + 0.06, z))
      }
    }
    highlight.geometry.setFromPoints(points)
  }

  const placedMinerals = Object.fromEntries(
    MINERAL_FEATURES.map((kind) => [kind, terrain.placements.filter((p) => p.feature === kind && p.placed).length]),
  )

  return {
    root,
    bounds,
    floorY: -SKIRT_DEPTH,
    reliefMap: map,
    // Unclassified maps (real elevation by default) are never dressed, so they have no deposits to count.
    info:
      map.classification === 'none'
        ? {}
        : { deposits: MINERAL_FEATURES.map((kind) => `${kind} ${placedMinerals[kind]}`).join(' · ') },
    applyDebug(debug: DebugState) {
      mode = debug.mode
      const data = mode === 'data'
      terrain.root.visible = !data
      setReliefTint(mode === 'relief')
      if (data) ensureColumns().visible = true
      else if (columns) columns.visible = false
      if (debug.grid && !data) ensureGrid().visible = true
      else if (gridOverlay) gridOverlay.visible = false
      labelsWanted = debug.values
      if (labelsWanted) ensureLabels()
      refreshLabels()
      drawHighlight()
    },
    highlightCell(cell) {
      highlighted = cell
      drawHighlight()
    },
    locateCell({ col, row }) {
      const { x, z } = cellCenter(grid, col, row)
      return new THREE.Vector3(x, surfaceY(col, row, mode), z)
    },
    onViewChange(target, distance) {
      const next = toCell(target.x, target.z)
      const close = distance <= LABEL_MAX_DISTANCE
      if (next.col === focus.col && next.row === focus.row && close === zoomedIn) return
      focus = next
      zoomedIn = close
      refreshLabels()
    },
  }
}

function createHighlight(): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }),
  )
  line.name = 'cell-highlight'
  line.renderOrder = 3
  line.visible = false
  // Geometry moves between cells, so a cached bounding sphere would cull it wrongly.
  line.frustumCulled = false
  return line
}
