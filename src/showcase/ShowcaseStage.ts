import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { disposeObject } from '../terrain-kit/dispose'
import { disposeSharedMaterials } from '../terrain-kit/palette'
import type { ReliefMap } from '../terrain-kit/reliefMap'
import { buildAssetGallery } from './assetGallery'
import { buildTerrainLayerView } from './terrainLayerView'

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
  geometries: number
  buildMs: number
  info: Record<string, number | string>
}

declare global {
  interface Window {
    /** Profiling hook (see the debug-profiler playbook): renderer counters plus stage state. */
    __THREE_GAME_DIAGNOSTICS__?: { renderer: THREE.WebGLInfo; readonly state: StageStats }
  }
}

/**
 * Camera directions (from target) and how much of the viewport the projected
 * bounds should fill; above 1 deliberately crops for a closer look.
 */
const PRESETS: Record<CameraPreset, { direction: [number, number, number]; fill: number }> = {
  iso: { direction: [1, 1.2, 1.3], fill: 0.86 },
  top: { direction: [0, 1, 0.001], fill: 0.9 },
  front: { direction: [0, 0.6, 1], fill: 0.88 },
  low: { direction: [1.25, 0.32, 0.55], fill: 1.3 },
}

/** Camera distance when focusing a single cell: a few cells across, close enough to read deposits. */
const FOCUS_DISTANCE = 9

/**
 * Sun from the upper left of the default view so shadows fall toward the
 * viewer's right; ~45° high, so escarpments and crater walls cast readable
 * shadows without swallowing the plains.
 */
const SUN_DIRECTION = new THREE.Vector3(-0.62, 0.8, 0.36).normalize()

/** Owns the renderer, camera, lights and render loop; content is swapped in via `load`. */
export class ShowcaseStage {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly labelRenderer = new CSS2DRenderer()
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300)
  private readonly controls: OrbitControls
  private readonly sun = new THREE.DirectionalLight('#ffeed6', 3.4)
  private readonly shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>
  private readonly resizeObserver: ResizeObserver
  private readonly timer = new THREE.Timer()
  private content: ShowcaseContent | null = null
  private loadedView: ViewMode | null = null
  private updaters: ((time: number) => void)[] = []
  private debug: DebugState = { mode: 'terrain', grid: false, values: false }
  private preset: CameraPreset = 'iso'
  private sceneRadius = 10
  private readonly viewTarget = new THREE.Vector3(Infinity, 0, 0)
  private viewDistance = 0
  private buildMs = 0
  private fps = 0

  constructor(container: HTMLElement) {
    this.container = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // three resets info after the shadow pass; reset per frame instead so stats include shadow draws.
    this.renderer.info.autoReset = false
    container.appendChild(this.renderer.domElement)

    this.labelRenderer.domElement.className = 'showcase-labels'
    container.appendChild(this.labelRenderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.screenSpacePanning = true
    this.controls.minDistance = 2
    this.controls.maxDistance = 90
    this.controls.maxPolarAngle = Math.PI * 0.49

    // Warm sky over dark rust ground; a cool rim light hints at the thin blue Martian sky.
    // Fill kept moderate so form comes from the sun, not from flat ambient light.
    this.scene.add(new THREE.HemisphereLight('#ffe2c8', '#5e2c22', 0.75))
    const rim = new THREE.DirectionalLight('#9db4ff', 0.6)
    rim.position.set(6, 5, -8)
    this.scene.add(rim)

    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02
    this.scene.add(this.sun, this.sun.target)

    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ color: '#12091c', opacity: 0.28 }),
    )
    this.shadowCatcher.receiveShadow = true
    this.scene.add(this.shadowCatcher)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.renderer.setAnimationLoop((timestamp) => this.frame(timestamp))

    const stage = this
    window.__THREE_GAME_DIAGNOSTICS__ = {
      renderer: this.renderer.info,
      get state() {
        return stage.getStats()
      },
    }
  }

  getStats(): StageStats {
    const { render, memory } = this.renderer.info
    return {
      fps: Math.round(this.fps),
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      buildMs: Math.round(this.buildMs),
      info: this.content?.info ?? {},
    }
  }

  /**
   * Builds and shows a view; the camera is only reframed when the view changes.
   * Returns the view's Layer −1 data, if it has any, for the debug UI.
   */
  load(view: ViewMode, seed: number): ReliefMap | null {
    this.clearContent()
    const start = performance.now()
    const content = view === 'terrain' ? buildTerrainLayerView(seed) : buildAssetGallery(seed)
    this.buildMs = performance.now() - start
    this.content = content
    this.scene.add(content.root)
    content.applyDebug?.(this.debug)

    this.updaters = []
    content.root.traverse((object) => {
      if (typeof object.userData.update === 'function') this.updaters.push(object.userData.update)
    })

    this.shadowCatcher.position.y = content.floorY - 0.002
    const sphere = content.bounds.getBoundingSphere(new THREE.Sphere())
    this.sceneRadius = sphere.radius
    this.fitSun(sphere.center, sphere.radius)
    if (view !== this.loadedView) this.setCameraPreset(this.preset)
    this.loadedView = view
    // Force the per-view camera/shadow refresh on the next frame.
    this.viewTarget.set(Infinity, 0, 0)
    return content.reliefMap ?? null
  }

  setDebug(debug: DebugState): void {
    this.debug = debug
    this.content?.applyDebug?.(debug)
  }

  highlightCell(cell: { col: number; row: number } | null): void {
    this.content?.highlightCell?.(cell)
  }

  /** Re-centres the orbit on a cell and moves in close, keeping the viewing direction. */
  focusCell(cell: { col: number; row: number }): void {
    const point = this.content?.locateCell?.(cell)
    if (!point) return
    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = Math.min(offset.length(), FOCUS_DISTANCE)
    this.controls.target.copy(point)
    this.camera.position.copy(point).addScaledVector(offset.normalize(), distance)
    this.controls.update()
  }

  setCameraPreset(preset: CameraPreset): void {
    this.preset = preset
    if (!this.content) return
    const box = this.content.bounds
    const center = box.getCenter(new THREE.Vector3())
    const { direction, fill } = PRESETS[preset]
    const towardCamera = new THREE.Vector3(...direction).normalize()
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) =>
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ),
    )
    // Fit the projected box corners rather than a bounding sphere, which
    // badly over-estimates flat content, and re-centre on their screen extents
    // (the near corner of a diorama projects much further than the far one).
    // Screen size ~ 1/distance, so a few proportional corrections converge.
    const target = center.clone()
    const projected = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
    let distance = box.getSize(new THREE.Vector3()).length() * 1.5
    for (let iteration = 0; iteration < 6; iteration++) {
      this.camera.position.copy(target).addScaledVector(towardCamera, distance)
      this.camera.lookAt(target)
      this.camera.near = distance / 50
      this.camera.far = distance * 4
      this.camera.updateProjectionMatrix()
      this.camera.updateMatrixWorld()
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const corner of corners) {
        projected.copy(corner).project(this.camera)
        minX = Math.min(minX, projected.x)
        maxX = Math.max(maxX, projected.x)
        minY = Math.min(minY, projected.y)
        maxY = Math.max(maxY, projected.y)
      }
      const halfHeight = distance * tanHalfFov
      right.setFromMatrixColumn(this.camera.matrixWorld, 0)
      up.setFromMatrixColumn(this.camera.matrixWorld, 1)
      target
        .addScaledVector(right, ((minX + maxX) / 2) * halfHeight * this.camera.aspect)
        .addScaledVector(up, ((minY + maxY) / 2) * halfHeight)
      distance *= Math.max(maxX - minX, maxY - minY) / 2 / fill
    }
    this.camera.position.copy(target).addScaledVector(towardCamera, distance)
    this.controls.target.copy(target)
    this.controls.maxDistance = distance * 2.5
    this.controls.update()
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.clearContent()
    this.shadowCatcher.geometry.dispose()
    this.shadowCatcher.material.dispose()
    this.sun.shadow.dispose()
    disposeSharedMaterials()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labelRenderer.domElement.remove()
    delete window.__THREE_GAME_DIAGNOSTICS__
  }

  private clearContent(): void {
    if (!this.content) return
    const { root } = this.content
    root.traverse((object) => {
      if (object instanceof CSS2DObject) object.element.remove()
    })
    this.scene.remove(root)
    disposeObject(root)
    this.content = null
    this.updaters = []
  }

  /**
   * Shadow frustum of half-size `radius` around `center`. The sun stays far
   * enough back to see every caster in the scene, however small the frustum.
   */
  private fitSun(center: THREE.Vector3, radius: number): void {
    this.sun.target.position.copy(center)
    this.sun.position.copy(center).addScaledVector(SUN_DIRECTION, this.sceneRadius * 2)
    const camera = this.sun.shadow.camera
    camera.left = -radius
    camera.right = radius
    camera.top = radius
    camera.bottom = -radius
    camera.near = 0.1
    camera.far = this.sceneRadius * 4
    camera.updateProjectionMatrix()
  }

  /**
   * On a large map the useful clip range and shadow coverage depend on how far
   * the camera is from what it looks at, so both follow the orbit.
   */
  private updateViewDependent(): void {
    const target = this.controls.target
    const distance = this.camera.position.distanceTo(target)
    const moved = this.viewTarget.distanceTo(target) > distance * 0.03
    if (!moved && Math.abs(distance - this.viewDistance) < this.viewDistance * 0.05) return
    this.viewTarget.copy(target)
    this.viewDistance = distance
    this.camera.near = THREE.MathUtils.clamp(distance * 0.02, 0.03, 5)
    this.camera.far = distance + this.sceneRadius * 2.5
    this.camera.updateProjectionMatrix()
    // Shadows cover roughly what the camera sees, so zoomed-in views keep crisp shadows.
    this.fitSun(target, THREE.MathUtils.clamp(distance * 0.75, 4, this.sceneRadius))
    this.content?.onViewChange?.(target, distance)
  }

  private resize(): void {
    const { width, height } = this.container.getBoundingClientRect()
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height)
    this.labelRenderer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private frame(timestamp: number): void {
    this.timer.update(timestamp)
    const time = this.timer.getElapsed()
    const delta = this.timer.getDelta()
    if (delta > 0) this.fps += (1 / delta - this.fps) * 0.05
    for (const update of this.updaters) update(time)
    this.controls.update()
    this.updateViewDependent()
    this.renderer.info.reset()
    this.renderer.render(this.scene, this.camera)
    this.labelRenderer.render(this.scene, this.camera)
  }
}
