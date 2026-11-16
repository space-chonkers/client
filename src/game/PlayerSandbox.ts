import * as THREE from 'three'
import { CorridorGrid } from './corridor/CorridorGrid'
import {
  INITIAL_BASE_ORIGIN,
  INITIAL_SERVER_CONSTRUCTIONS,
  INITIAL_SERVER_PAYLOAD,
} from './corridor/mockServerPayload'
import { InputController } from './input/InputController'
import {
  occupiedTilesToConstructions,
  sandboxToWorldCell,
  type MissionMapConstruction,
  type MissionMapPlayer,
} from './minimap/missionMap'
import { MarsMapLayer } from './map/MarsMapLayer'
import { FACING_VECTORS } from './player/Facing'
import { Player } from './player/Player'

/** Corridor floor deck height so the astronaut stands on top of Layer 0 tiles. */
const CORRIDOR_DECK_HEIGHT = 0.08
/** Playable 50x50 bounds in world coordinates relative to `INITIAL_BASE_ORIGIN`. */
const MAP_BOUNDS = {
  minX: -INITIAL_BASE_ORIGIN.cellX,
  maxX: INITIAL_SERVER_PAYLOAD.grid.width - 1 - INITIAL_BASE_ORIGIN.cellX,
  minZ: -INITIAL_BASE_ORIGIN.cellY,
  maxZ: INITIAL_SERVER_PAYLOAD.grid.height - 1 - INITIAL_BASE_ORIGIN.cellY,
} as const
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
 * Playable sandbox scene: astronaut (Layer 1), corridor grid (Layer 0),
 * 50x50 Martian terrain (Layer -1), follow camera, and lighting.
 *
 * Call `dispose()` to stop it, free GPU resources and stop notifying listeners.
 */
export class PlayerSandbox {
  readonly player: Player
  readonly corridors = new CorridorGrid()
  readonly mapLayer: MarsMapLayer

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  private readonly input = new InputController()
  private readonly sun = new THREE.DirectionalLight('#fff4e6', 2.6)
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
    // Layer -1: 50x50 playable Martian terrain (+ border margin) aligned with CorridorGrid
    this.mapLayer = new MarsMapLayer({
      originCell: INITIAL_BASE_ORIGIN,
      initialBaseCells: INITIAL_SERVER_CONSTRUCTIONS,
    })
    this.scene.add(this.mapLayer.object)

    // Layer 0: Temporary corridor grid loaded from server 3x3 initial base payload
    this.corridors.loadConstructions(INITIAL_SERVER_CONSTRUCTIONS, INITIAL_BASE_ORIGIN)
    this.scene.add(this.corridors.object)
    for (const item of INITIAL_SERVER_CONSTRUCTIONS) {
      this.mapLayer.mineCell(
        item.cellX - INITIAL_BASE_ORIGIN.cellX,
        item.cellY - INITIAL_BASE_ORIGIN.cellY,
      )
    }

    // Player (spawns at slot 0: cell (29, 24) -> (0, -1) relative to stash (29, 25)). It keeps
    // the Player default facing ('down', toward the camera) and then turns to each move direction.
    this.player = new Player({ bounds: MAP_BOUNDS })
    this.player.position.set(0, CORRIDOR_DECK_HEIGHT, -1)
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
    this.mapLayer.dispose()
    this.player.dispose()
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
    if (
      targetX < MAP_BOUNDS.minX ||
      targetX > MAP_BOUNDS.maxX ||
      targetZ < MAP_BOUNDS.minZ ||
      targetZ > MAP_BOUNDS.maxZ
    ) {
      return
    }

    if (this.corridors.placeTile(targetX, targetZ)) {
      this.mapLayer.mineCell(targetX, targetZ)
    }
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
