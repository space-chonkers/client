import * as THREE from 'three'
import { PlaceholderItem } from './debug/PlaceholderItem'
import { InputController } from './input/InputController'
import { Backpack, type BackpackItem } from './pickups/Backpack'
import { PickupSystem } from './pickups/PickupSystem'
import { Player } from './player/Player'

/** Size of the debug grid; the player is kept inside it. */
const GRID_SIZE = 20
/** Angled top-down camera, relative to the player. */
const CAMERA_OFFSET = new THREE.Vector3(0, 9, 7.5)
const CAMERA_LOOK_HEIGHT = 0.8
const CAMERA_FOLLOW_SPEED = 6
/** Longest frame step, so a background tab doesn't teleport the player. */
const MAX_DELTA = 1 / 20

export type BackpackListener = (items: readonly BackpackItem[]) => void

/**
 * Test scene for the player: astronaut, follow camera, lights, a debug grid
 * and placeholder cubes to pick up. No terrain or world assets.
 *
 * Call `dispose()` to stop it and free GPU resources.
 */
export class PlayerSandbox {
  readonly player: Player
  readonly backpack = new Backpack()

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  private readonly input = new InputController()
  private readonly pickups: PickupSystem
  private readonly items: PlaceholderItem[] = []
  private readonly sun = new THREE.DirectionalLight('#fff4e6', 2.6)
  private readonly grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, '#7a8296', '#3a4050')
  private readonly shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>
  private readonly resizeObserver: ResizeObserver
  private readonly cameraTarget = new THREE.Vector3()
  private readonly lookTarget = new THREE.Vector3()

  private frameId = 0
  private lastTime = 0
  private elapsed = 0

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.domElement.style.display = 'block'
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#1a1d26')

    // Player
    const half = GRID_SIZE / 2 - 0.5
    this.player = new Player(undefined, { minX: -half, maxX: half, minZ: -half, maxZ: half })
    this.scene.add(this.player.object)
    this.pickups = new PickupSystem(this.player, this.backpack)

    // Lights
    this.scene.add(new THREE.HemisphereLight('#dbe7ff', '#4a3a34', 1.4))
    this.sun.position.set(4, 10, 5)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.left = -6
    this.sun.shadow.camera.right = 6
    this.sun.shadow.camera.top = 6
    this.sun.shadow.camera.bottom = -6
    this.sun.shadow.bias = -0.0005
    this.scene.add(this.sun, this.sun.target)

    // DEBUG ONLY: grid + invisible plane that only shows shadows.
    // Replace with the team's terrain.
    this.grid.name = 'DebugGrid'
    this.scene.add(this.grid)
    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    )
    this.shadowCatcher.rotation.x = -Math.PI / 2
    this.shadowCatcher.receiveShadow = true
    this.scene.add(this.shadowCatcher)

    // TEST ONLY: placeholder items to pick up.
    const placeholders: [string, string, string, number, number][] = [
      ['test-cube-1', 'Test cube 1', '#ff5d73', 2, -2],
      ['test-cube-2', 'Test cube 2', '#4dd0e1', -3, -1],
      ['test-cube-3', 'Test cube 3', '#ffd23f', 0, 3],
      ['test-cube-4', 'Test cube 4', '#9b7bff', 4, 2],
      ['test-cube-5', 'Test cube 5', '#7bdc6b', -2, -5],
    ]
    for (const [id, label, color, x, z] of placeholders) {
      const item = new PlaceholderItem(id, label, color, x, z)
      this.items.push(item)
      this.scene.add(item.object)
      this.pickups.register(item)
    }

    this.updateCamera(1)

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(container)
    this.resize()

    this.lastTime = performance.now()
    this.frameId = requestAnimationFrame(this.tick)
  }

  /** Subscribe to backpack changes. Returns an unsubscribe function. */
  onBackpackChange(listener: BackpackListener): () => void {
    return this.backpack.onChange(listener)
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    this.input.dispose()
    this.player.dispose()
    for (const item of this.items) item.dispose()
    this.grid.dispose()
    this.shadowCatcher.geometry.dispose()
    this.shadowCatcher.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private readonly tick = (now: number) => {
    const delta = Math.min((now - this.lastTime) / 1000, MAX_DELTA)
    this.lastTime = now
    this.elapsed += delta

    this.player.update(delta, this.elapsed, this.input.getMoveDirection())
    if (this.input.consumePickupPress()) this.pickups.tryPickUp()
    for (const item of this.items) item.update(this.elapsed)

    this.updateCamera(1 - Math.exp(-CAMERA_FOLLOW_SPEED * delta))
    this.updateSun()

    this.renderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this.tick)
  }

  /** Smoothly follow the player from above and slightly behind. */
  private updateCamera(blend: number): void {
    this.cameraTarget.copy(this.player.position).add(CAMERA_OFFSET)
    this.camera.position.lerp(this.cameraTarget, blend)
    this.lookTarget.copy(this.camera.position).sub(CAMERA_OFFSET)
    this.lookTarget.y += CAMERA_LOOK_HEIGHT
    this.camera.lookAt(this.lookTarget)
  }

  /** Keep the shadow area centered on the player. */
  private updateSun(): void {
    this.sun.target.position.copy(this.player.position)
    this.sun.position.set(this.player.position.x + 4, 10, this.player.position.z + 5)
  }

  private readonly resize = () => {
    const { width, height } = this.container.getBoundingClientRect()
    if (width === 0 || height === 0) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }
}
