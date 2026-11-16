import * as THREE from 'three'
import { CorridorGrid } from './corridor/CorridorGrid'
import {
  INITIAL_BASE_ORIGIN,
  INITIAL_SERVER_CONSTRUCTIONS,
} from './corridor/mockServerPayload'
import { InputController } from './input/InputController'
import {
  occupiedTilesToConstructions,
  sandboxToWorldCell,
  type MissionMapConstruction,
  type MissionMapPlayer,
} from './minimap/missionMap'
import { FACING_VECTORS } from './player/Facing'
import { Player } from './player/Player'

/** Size of the debug grid; the player is kept inside it. */
const GRID_SIZE = 20
/** Corridor floor deck height so the astronaut stands on top of Layer 0 tiles. */
const CORRIDOR_DECK_HEIGHT = 0.08
/** Angled top-down camera, relative to the player. */
const CAMERA_OFFSET = new THREE.Vector3(0, 9, 7.5)
const CAMERA_LOOK_HEIGHT = 0.8
const CAMERA_FOLLOW_SPEED = 6
/** Longest frame step, so a background tab doesn't teleport the player. */
const MAX_DELTA = 1 / 20
/** Seconds between player snapshots sent to the view (~10 per second). */
const PLAYER_PUBLISH_INTERVAL = 0.1
/** Smallest movement, in cells, worth publishing to the view. */
const PLAYER_PUBLISH_EPSILON = 0.01

/** Callbacks a React owner can use to mirror sandbox state in the HUD. Both are optional. */
export interface PlayerSandboxListeners {
  /** World-cell constructions; sent on start and after every tile placement or removal. */
  onConstructionsChange?: (constructions: MissionMapConstruction[]) => void
  /** Player world position and facing; sent on start and then at most every `PLAYER_PUBLISH_INTERVAL` while it changes. */
  onPlayerChange?: (player: MissionMapPlayer) => void
}

/**
 * Test scene for the player: astronaut, follow camera, lights, temporary
 * Layer 0 corridor grid, and a debug grid.
 *
 * Call `dispose()` to stop it, free GPU resources and stop notifying listeners.
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
  private playerPublishTimer = 0
  private lastPublishedPlayer: MissionMapPlayer | null = null

  constructor(
    private readonly container: HTMLElement,
    private readonly listeners: PlayerSandboxListeners = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.domElement.style.display = 'block'
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#1a1d26')

    // Layer 0: Temporary corridor grid loaded from server 3x3 initial base payload.
    // Subscribed first so the initial load is published like any later change.
    this.corridors.onOccupancyChange(this.publishConstructions)
    this.corridors.loadConstructions(INITIAL_SERVER_CONSTRUCTIONS, INITIAL_BASE_ORIGIN)
    this.scene.add(this.corridors.object)

    // Player (spawns at slot 0: cell (29, 24) -> (0, -1) relative to stash (29, 25), facing north)
    const half = GRID_SIZE / 2 - 0.5
    this.player = new Player({ bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half } })
    this.player.position.set(0, CORRIDOR_DECK_HEIGHT, -1)
    this.player.setFacing('up')
    this.scene.add(this.player.object)
    this.publishPlayer()

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
    this.publishPlayerThrottled(delta)

    this.updateCamera(1 - Math.exp(-CAMERA_FOLLOW_SPEED * delta))
    this.updateSun()

    this.renderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this.tick)
  }

  private readonly publishConstructions = () => {
    if (!this.listeners.onConstructionsChange) return
    this.listeners.onConstructionsChange(
      occupiedTilesToConstructions(this.corridors.getOccupiedTiles(), INITIAL_BASE_ORIGIN),
    )
  }

  private publishPlayerThrottled(delta: number): void {
    this.playerPublishTimer += delta
    if (this.playerPublishTimer < PLAYER_PUBLISH_INTERVAL) return
    // Carry the overshoot so the average rate stays at 1 / PLAYER_PUBLISH_INTERVAL.
    this.playerPublishTimer -= PLAYER_PUBLISH_INTERVAL
    this.publishPlayer()
  }

  /** Sends the player's world position and facing, skipping updates with no visible change. */
  private publishPlayer(): void {
    if (!this.listeners.onPlayerChange) return
    const { x, z } = this.player.position
    const next: MissionMapPlayer = {
      ...sandboxToWorldCell(x, z, INITIAL_BASE_ORIGIN),
      facing: this.player.facing,
    }
    const previous = this.lastPublishedPlayer
    if (
      previous &&
      previous.facing === next.facing &&
      Math.abs(previous.cellX - next.cellX) < PLAYER_PUBLISH_EPSILON &&
      Math.abs(previous.cellY - next.cellY) < PLAYER_PUBLISH_EPSILON
    ) {
      return
    }
    this.lastPublishedPlayer = next
    this.listeners.onPlayerChange(next)
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
