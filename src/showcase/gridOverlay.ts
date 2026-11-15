import * as THREE from 'three'
import type { GridSpec } from '../terrain-kit/terrain'

export interface GridOverlayOptions {
  /** Height above the terrain, to keep lines from sinking into facets. */
  lift?: number
  samplesPerCell?: number
  color?: THREE.ColorRepresentation
  opacity?: number
}

/** Logical cell boundaries draped over the terrain surface. */
export function createGridOverlay(
  grid: GridSpec,
  heightAt: (x: number, z: number) => number,
  { lift = 0.04, samplesPerCell = 6, color = '#fff4e2', opacity = 0.55 }: GridOverlayOptions = {},
): THREE.LineSegments {
  const width = grid.cols * grid.cellSize
  const depth = grid.rows * grid.cellSize
  const step = grid.cellSize / samplesPerCell
  const positions: number[] = []
  const segment = (x0: number, z0: number, x1: number, z1: number) => {
    positions.push(x0, heightAt(x0, z0) + lift, z0, x1, heightAt(x1, z1) + lift, z1)
  }
  for (let c = 0; c <= grid.cols; c++) {
    const x = c * grid.cellSize - width / 2
    for (let s = 0; s < grid.rows * samplesPerCell; s++) segment(x, s * step - depth / 2, x, (s + 1) * step - depth / 2)
  }
  for (let r = 0; r <= grid.rows; r++) {
    const z = r * grid.cellSize - depth / 2
    for (let s = 0; s < grid.cols * samplesPerCell; s++) segment(s * step - width / 2, z, (s + 1) * step - width / 2, z)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  )
  lines.name = 'grid-overlay'
  lines.renderOrder = 1
  return lines
}
