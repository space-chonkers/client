import type * as THREE from 'three'
import type { ReliefMap } from '../terrain-kit/reliefMap'

/** Contracts shared by the showcase stage, its views and the control panel. */

export type ViewMode = 'terrain' | 'assets'
export type CameraPreset = 'iso' | 'top' | 'front' | 'low'
/** terrain: final render · relief: per-cell relief heatmap draped on it · data: raw cell values as columns. */
export type RenderMode = 'terrain' | 'relief' | 'data'

export interface DebugState {
  mode: RenderMode
  grid: boolean
  values: boolean
}

export interface ShowcaseContent {
  root: THREE.Object3D
  /** World-space bounds used to frame the camera and fit the shadow map. */
  bounds: THREE.Box3
  /** Height of the surface the content rests on; receives its drop shadow. */
  floorY: number
  /** Layer −1 cell data behind the view, when it has any. */
  reliefMap?: ReliefMap
  /** Extra facts for the stats readout and diagnostics. */
  info?: Record<string, number | string>
  applyDebug?(debug: DebugState): void
  highlightCell?(cell: { col: number; row: number } | null): void
  /** World position of a cell's surface centre, for camera focusing. */
  locateCell?(cell: { col: number; row: number }): THREE.Vector3
  /** Called when the orbit target or camera distance changes noticeably. */
  onViewChange?(target: THREE.Vector3, distance: number): void
}

export interface StageStats {
  fps: number
  drawCalls: number
  triangles: number
  buildMs: number
  info: Record<string, number | string>
}
