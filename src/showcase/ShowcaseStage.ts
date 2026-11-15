import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { disposeObject } from '../terrain-kit/dispose'
import { disposeSharedMaterials } from '../terrain-kit/palette'
import { generateReliefMap, type ReliefMap } from '../terrain-kit/reliefMap'
import { buildAssetGallery } from './assetGallery'
import { buildTerrainLayerView } from './terrainLayerView'
import type { CameraPreset, DebugState, ShowcaseContent, StageStats, ViewMode } from './types'

/**
 * One content builder per view; adding a view means adding an entry here.
 * The stage picks the terrain source; the view renders whatever map it gets.
 */
const VIEW_BUILDERS: Record<ViewMode, (seed: number) => ShowcaseContent> = {
  terrain: (seed) => buildTerrainLayerView(generateReliefMap(seed)),
  assets: buildAssetGallery,
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

/** Narrow field of view: flattens perspective so the map reads like a diorama. */
const CAMERA = { fov: 30, near: 0.1, far: 300 }

const ORBIT = {
  dampingFactor: 0.08,
  minDistance: 2,
  /** Initial limit only; each camera preset widens it to fit the content. */
  maxDistance: 90,
  /** Just above the horizon, so the camera never dips below the ground. */
  maxPolarAngle: Math.PI * 0.49,
  /** Furthest zoom-out, as a multiple of the framing distance of the current preset. */
  maxDistanceFactor: 2.5,
}

/**
 * Warm sky over dark rust ground; a cool rim light hints at the thin blue
 * Martian sky. Fill is kept moderate so form comes from the sun, not from
 * flat ambient light.
 */
const LIGHTING = {
  sun: { color: '#ffeed6', intensity: 3.4 },
  hemisphere: { sky: '#ffe2c8', ground: '#5e2c22', intensity: 0.75 },
  rim: { color: '#9db4ff', intensity: 0.6, position: [6, 5, -8] as const },
}

const SHADOW = {
  mapSize: 2048,
  bias: -0.0004,
  normalBias: 0.02,
  /** Minimum shadow-frustum half-size, so close-ups still shadow their surroundings. */
  minRadius: 4,
  /** Shadow frustum half-size as a share of the camera distance. */
  distanceShare: 0.75,
}

/** Large invisible plane that only shows the content's drop shadow. */
const SHADOW_CATCHER = { size: 400, color: '#12091c', opacity: 0.28, offset: 0.002 }

/**
 * View-dependent refresh: clip planes and shadows follow the orbit, but only
 * once the target moves or the distance changes by these shares of the distance.
 */
const VIEW_REFRESH = { targetShare: 0.03, distanceShare: 0.05 }
const NEAR_PLANE = { share: 0.02, min: 0.03, max: 5 }
/** Far plane reaches past the scene by this multiple of its radius. */
const FAR_PLANE_RADII = 2.5

/** Smoothing of the displayed fps: each frame moves this share toward the instantaneous value. */
const FPS_SMOOTHING = 0.05

/** Owns the renderer, camera, lights and render loop; content is swapped in via `load`. */
export class ShowcaseStage {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly labelRenderer = new CSS2DRenderer()
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far)
  private readonly controls: OrbitControls
  private readonly sun = new THREE.DirectionalLight(LIGHTING.sun.color, LIGHTING.sun.intensity)
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
    this.controls.dampingFactor = ORBIT.dampingFactor
    this.controls.screenSpacePanning = true
    this.controls.minDistance = ORBIT.minDistance
    this.controls.maxDistance = ORBIT.maxDistance
    this.controls.maxPolarAngle = ORBIT.maxPolarAngle

    const { hemisphere, rim } = LIGHTING
    this.scene.add(new THREE.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity))
    const rimLight = new THREE.DirectionalLight(rim.color, rim.intensity)
    rimLight.position.set(...rim.position)
    this.scene.add(rimLight)

    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize)
    this.sun.shadow.bias = SHADOW.bias
    this.sun.shadow.normalBias = SHADOW.normalBias
    this.scene.add(this.sun, this.sun.target)

    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(SHADOW_CATCHER.size, SHADOW_CATCHER.size).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ color: SHADOW_CATCHER.color, opacity: SHADOW_CATCHER.opacity }),
    )
    this.shadowCatcher.receiveShadow = true
    this.scene.add(this.shadowCatcher)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.renderer.setAnimationLoop((timestamp) => this.frame(timestamp))
  }

  getStats(): StageStats {
    const { render } = this.renderer.info
    return {
      fps: Math.round(this.fps),
      drawCalls: render.calls,
      triangles: render.triangles,
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
    const content = VIEW_BUILDERS[view](seed)
    this.buildMs = performance.now() - start
    this.content = content
    this.scene.add(content.root)
    content.applyDebug?.(this.debug)

    this.updaters = []
    content.root.traverse((object) => {
      if (typeof object.userData.update === 'function') this.updaters.push(object.userData.update)
    })

    this.shadowCatcher.position.y = content.floorY - SHADOW_CATCHER.offset
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
    this.controls.maxDistance = distance * ORBIT.maxDistanceFactor
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
    const moved = this.viewTarget.distanceTo(target) > distance * VIEW_REFRESH.targetShare
    if (!moved && Math.abs(distance - this.viewDistance) < this.viewDistance * VIEW_REFRESH.distanceShare) return
    this.viewTarget.copy(target)
    this.viewDistance = distance
    this.camera.near = THREE.MathUtils.clamp(distance * NEAR_PLANE.share, NEAR_PLANE.min, NEAR_PLANE.max)
    this.camera.far = distance + this.sceneRadius * FAR_PLANE_RADII
    this.camera.updateProjectionMatrix()
    // Shadows cover roughly what the camera sees, so zoomed-in views keep crisp shadows.
    this.fitSun(target, THREE.MathUtils.clamp(distance * SHADOW.distanceShare, SHADOW.minRadius, this.sceneRadius))
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
    if (delta > 0) this.fps += (1 / delta - this.fps) * FPS_SMOOTHING
    for (const update of this.updaters) update(time)
    this.controls.update()
    this.updateViewDependent()
    this.renderer.info.reset()
    this.renderer.render(this.scene, this.camera)
    this.labelRenderer.render(this.scene, this.camera)
  }
}
