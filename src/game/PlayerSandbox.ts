import * as THREE from 'three'
import {
  CorridorGrid,
  type ConstructionPayload,
} from './corridor/CorridorGrid'
import { InputController } from './input/InputController'
import { FACING_VECTORS } from './player/Facing'
import { Player } from './player/Player'

/** Size of the debug grid; the player is kept inside it. */
const GRID_SIZE = 20
/** Corridor floor deck height so the astronaut stands on top of Layer 0 tiles. */
const CORRIDOR_DECK_HEIGHT = 0.08
/** Center cell (stash) of the initial 3x3 server base payload. */
const INITIAL_BASE_ORIGIN = { cellX: 29, cellY: 25 } as const
/** Initial 3x3 base constructions matching the authoritative server payload. */
const INITIAL_SERVER_CONSTRUCTIONS: ReadonlyArray<ConstructionPayload> = [
  { id: 'base-28-24', kind: 'base_tile', cellX: 28, cellY: 24 },
  { id: 'base-29-24', kind: 'base_tile', cellX: 29, cellY: 24 },
  { id: 'base-30-24', kind: 'base_tile', cellX: 30, cellY: 24 },
  { id: 'base-28-25', kind: 'base_tile', cellX: 28, cellY: 25 },
  { id: 'stash', kind: 'stash', cellX: 29, cellY: 25 },
  { id: 'base-30-25', kind: 'base_tile', cellX: 30, cellY: 25 },
  { id: 'base-28-26', kind: 'base_tile', cellX: 28, cellY: 26 },
  { id: 'base-29-26', kind: 'base_tile', cellX: 29, cellY: 26 },
  { id: 'base-30-26', kind: 'base_tile', cellX: 30, cellY: 26 },
]
/** Angled top-down camera, relative to the player. */
const CAMERA_OFFSET = new THREE.Vector3(0, 9, 7.5)
const CAMERA_LOOK_HEIGHT = 0.8
const CAMERA_FOLLOW_SPEED = 6
/** Longest frame step, so a background tab doesn't teleport the player. */
const MAX_DELTA = 1 / 20

/**
 * Test scene for the player: astronaut, follow camera, lights, temporary
 * Layer 0 corridor grid, and a debug grid.
 *
 * Call `dispose()` to stop it and free GPU resources.
 */
export class PlayerSandbox {
  readonly player: Player
  readonly corridors = new CorridorGrid()

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  private readonly input = new InputController()
  private readonly sun = new THREE.DirectionalLight('#fff4e6', 2.6)
  private readonly grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, '#7a8296', '#3a4050')
  private readonly shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>
  private readonly resizeObserver: ResizeObserver
  private readonly cameraTarget = new THREE.Vector3()
  private readonly lookTarget = new THREE.Vector3()
  private readonly prevPlayerPosition = new THREE.Vector3()

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

    // Layer 0: Temporary corridor grid loaded from server 3x3 initial base payload
    this.corridors.loadConstructions(INITIAL_SERVER_CONSTRUCTIONS, INITIAL_BASE_ORIGIN)
    this.scene.add(this.corridors.object)

    // Player (spawns at slot 0: cell (29, 24) -> (0, -1) relative to stash (29, 25), facing north)
    const half = GRID_SIZE / 2 - 0.5
    this.player = new Player({ bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half } })
    this.player.position.set(0, CORRIDOR_DECK_HEIGHT, -1)
    this.player.setFacing('up')
    this.scene.add(this.player.object)

    window.addEventListener('keydown', this.onKeyDown)

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
    // Offset by (0.5, 0, 0.5) so 1x1 grid cells frame integer tile centers (x, z).
    this.grid.name = 'DebugGrid'
    this.grid.position.set(0.5, 0, 0.5)
    this.scene.add(this.grid)
    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    )
    this.shadowCatcher.rotation.x = -Math.PI / 2
    this.shadowCatcher.receiveShadow = true
    this.scene.add(this.shadowCatcher)

    this.updateCamera(1)

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(container)
    this.resize()

    this.lastTime = performance.now()
    this.frameId = requestAnimationFrame(this.tick)
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId)
    window.removeEventListener('keydown', this.onKeyDown)
    this.resizeObserver.disconnect()
    this.input.dispose()
    this.corridors.dispose()
    this.player.dispose()
    this.grid.dispose()
    this.shadowCatcher.geometry.dispose()
    this.shadowCatcher.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  /** Press E or Space to expand a corridor tile onto the empty cell in front of the player. */
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || (event.code !== 'KeyE' && event.code !== 'Space')) return
    event.preventDefault()

    const facing = FACING_VECTORS[this.player.facing]
    const targetX = Math.round(this.player.position.x) + facing.x
    const targetZ = Math.round(this.player.position.z) + facing.z
    const half = GRID_SIZE / 2 - 0.5
    if (Math.abs(targetX) > half || Math.abs(targetZ) > half) return

    this.corridors.placeTile(targetX, targetZ)
  }

  private readonly tick = (now: number) => {
    const delta = Math.min((now - this.lastTime) / 1000, MAX_DELTA)
    this.lastTime = now
    this.elapsed += delta

    this.prevPlayerPosition.copy(this.player.position)
    this.player.update(delta, this.elapsed, this.input.getMoveDirection())
    this.corridors.constrainMovement(this.prevPlayerPosition, this.player.position, delta)

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
