import * as THREE from 'three'
import { CorridorGrid, type ConstructionPayload } from './corridor/CorridorGrid'
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
import { FACING_VECTORS, facingToYaw, type Facing } from './player/Facing'
import { DEFAULT_PLAYER_TUNING, Player } from './player/Player'

function facingFromServer(facing: string): Facing {
  switch (facing) {
    case 'north': return 'up'
    case 'south': return 'down'
    case 'west': return 'left'
    case 'east': return 'right'
    default: return 'down'
  }
}

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
const CAMERA_FOLLOW_SPEED = 10
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

/** Fallbacks until the server's welcome message is available. */
const DEFAULT_TICK_RATE = 60
const DEFAULT_SERVER_PLAYER_SPEED = 4

const REMOTE_SUIT_COLORS = ['#e2e8f0', '#3ec9b7', '#ff7b54', '#ffd23f'] as const

interface RemotePlayerEntry {
  player: Player
  facing: Facing
  moving: boolean
  walkPhase: number
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
  mapLayer: MarsMapLayer

  private stashCell: { cellX: number; cellY: number } = { ...INITIAL_BASE_ORIGIN }
  private terrainOriginCell: { cellX: number; cellY: number } = { ...INITIAL_BASE_ORIGIN }
  private readonly minedTerrainCells = new Set<string>()
  private readonly remotes = new Map<string, RemotePlayerEntry>()
  private readonly investigationGroup = new THREE.Group()
  private lastInvestigationKey = ''
  private lastConstructionsKey = ''
  private hasLocalServerPosition = false
  private hasServerMap = false
  private localMoving = false
  private localWalkPhase = 0
  private tickRate = DEFAULT_TICK_RATE
  private playerSpeed = DEFAULT_SERVER_PLAYER_SPEED
  private inputCallback: ((move: { x: number; y: number } | null) => void) | null = null
  private inputAccumulator = 0

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
      this.minedTerrainCells.add(`${item.cellX},${item.cellY}`)
      this.mapLayer.mineCell(
        item.cellX - INITIAL_BASE_ORIGIN.cellX,
        item.cellY - INITIAL_BASE_ORIGIN.cellY,
      )
    }

    // Player (spawns at slot 0: cell (29, 24) -> (0, -1) relative to stash (29, 25), facing north)
    this.player = new Player({
      bounds: MAP_BOUNDS,
      tuning: {
        ...DEFAULT_PLAYER_TUNING,
        walkSpeed: DEFAULT_SERVER_PLAYER_SPEED,
        acceleration: 40,
        deceleration: 40,
      },
    })
    this.player.position.set(0, CORRIDOR_DECK_HEIGHT, -1)
    this.player.setFacing('up')
    this.scene.add(this.player.object)
    this.publishPlayer()

    this.scene.add(this.investigationGroup)

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
    this.resizeObserver.disconnect()
    this.input.dispose()
    this.corridors.dispose()
    this.mapLayer.dispose()
    this.player.dispose()
    for (const remote of this.remotes.values()) {
      remote.player.dispose()
    }
    this.remotes.clear()
    this.clearInvestigation()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  setInputCallback(cb: ((move: { x: number; y: number } | null) => void) | null): void {
    this.inputCallback = cb
  }

  setServerRules(tickRate: number, playerSpeed: number): void {
    if (Number.isFinite(tickRate) && tickRate > 0) this.tickRate = tickRate
    if (Number.isFinite(playerSpeed) && playerSpeed > 0) this.playerSpeed = playerSpeed
  }

  /** Current WASD intent as a server move vector (x east, y south). */
  getMoveVector(): { x: number; y: number } | null {
    const dir = this.input.getMoveDirection()
    if (!dir) return null
    const v = FACING_VECTORS[dir]
    return { x: v.x, y: v.z }
  }

  /** Server grid cell in front of the local player (for base.build). */
  getServerBuildTarget(): { cellX: number; cellY: number } {
    const facing = FACING_VECTORS[this.player.facing]
    const localX = Math.round(this.player.position.x) + facing.x
    const localZ = Math.round(this.player.position.z) + facing.z
    return { cellX: localX + this.stashCell.cellX, cellY: localZ + this.stashCell.cellY }
  }

  /** Apply authoritative server state to the scene. */
  applyServerState(payload: {
    constructions: ConstructionPayload[]
    stashOrigin: { cellX: number; cellY: number }
    investigation: Array<{ cellX: number; cellY: number }>
    players: Array<{ id: string; slot?: number; x: number; y: number; vx?: number; vy?: number; facing: string }>
    localPlayerId: string | null
  }): void {
    this.stashCell = payload.stashOrigin

    const constructionsKey = `${payload.stashOrigin.cellX},${payload.stashOrigin.cellY}:` +
      payload.constructions.map((item) => `${item.id}:${item.kind}:${item.cellX},${item.cellY}`).join(';')
    if (constructionsKey !== this.lastConstructionsKey) {
      this.lastConstructionsKey = constructionsKey
      this.corridors.replaceConstructions(payload.constructions, payload.stashOrigin)
      this.syncTerrain(payload.stashOrigin, payload.constructions, !this.hasServerMap)
      this.hasServerMap = true
    }

    this.setInvestigation(payload.investigation, payload.stashOrigin)
    const seen = new Set<string>()
    for (const p of payload.players) {
      const localX = p.x - (payload.stashOrigin.cellX + 0.5)
      const localZ = p.y - (payload.stashOrigin.cellY + 0.5)
      const facing = facingFromServer(p.facing)
      if (p.id === payload.localPlayerId) {
        this.player.position.set(localX, CORRIDOR_DECK_HEIGHT, localZ)
        this.player.setFacing(facing)
        this.localMoving = Math.hypot(p.vx ?? 0, p.vy ?? 0) > 0.05
        if (!this.hasLocalServerPosition) {
          this.hasLocalServerPosition = true
          this.updateCamera(1)
        }
        continue
      }
      seen.add(p.id)
      const isMoving = Math.hypot(p.vx ?? 0, p.vy ?? 0) > 0.05
      let entry = this.remotes.get(p.id)
      if (!entry) {
        const suitColor = REMOTE_SUIT_COLORS[(p.slot ?? 1) % REMOTE_SUIT_COLORS.length]
        const remote = new Player({ suitColor })
        remote.position.set(localX, CORRIDOR_DECK_HEIGHT, localZ)
        remote.setFacing(facing)
        this.scene.add(remote.object)
        entry = {
          player: remote,
          facing,
          moving: isMoving,
          walkPhase: 0,
        }
        this.remotes.set(p.id, entry)
      } else {
        entry.player.position.set(localX, CORRIDOR_DECK_HEIGHT, localZ)
        entry.facing = facing
        entry.moving = isMoving
      }
    }
    for (const [id, entry] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(entry.player.object)
        entry.player.dispose()
        this.remotes.delete(id)
      }
    }
  }

  private clearInvestigation(): void {
    for (const child of this.investigationGroup.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    }
    this.investigationGroup.clear()
  }

  private setInvestigation(
    cells: Array<{ cellX: number; cellY: number }>,
    origin: { cellX: number; cellY: number },
  ): void {
    const key = `${origin.cellX},${origin.cellY}:${cells.map((c) => `${c.cellX},${c.cellY}`).join(';')}`
    if (key === this.lastInvestigationKey) return
    this.lastInvestigationKey = key
    this.clearInvestigation()
    for (const cell of cells) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#664d00' }),
      )
      mesh.position.set(cell.cellX - origin.cellX, 0.4, cell.cellY - origin.cellY)
      this.investigationGroup.add(mesh)
    }
  }

  private syncTerrain(
    origin: { cellX: number; cellY: number },
    constructions: ReadonlyArray<ConstructionPayload>,
    forceReset = false,
  ): void {
    if (
      forceReset ||
      origin.cellX !== this.terrainOriginCell.cellX ||
      origin.cellY !== this.terrainOriginCell.cellY
    ) {
      this.scene.remove(this.mapLayer.object)
      this.mapLayer.dispose()
      this.mapLayer = new MarsMapLayer({ originCell: origin, initialBaseCells: constructions })
      this.scene.add(this.mapLayer.object)
      this.terrainOriginCell = { ...origin }
      this.minedTerrainCells.clear()
      for (const item of constructions) this.minedTerrainCells.add(`${item.cellX},${item.cellY}`)
      return
    }

    for (const item of constructions) {
      const key = `${item.cellX},${item.cellY}`
      if (this.minedTerrainCells.has(key)) continue
      this.mapLayer.mineCell(item.cellX - origin.cellX, item.cellY - origin.cellY)
      this.minedTerrainCells.add(key)
    }
  }

  private readonly tick = (now: number) => {
    const delta = Math.min((now - this.lastTime) / 1000, MAX_DELTA)
    this.lastTime = now
    this.elapsed += delta

    const moveDir = this.input.getMoveDirection()

    if (this.inputCallback) {
      // Each input represents one server tick; use the rate advertised by welcome.
      const inputStepSeconds = 1 / this.tickRate
      this.inputAccumulator += delta
      let steps = 0
      while (this.inputAccumulator >= inputStepSeconds && steps < 4) {
        this.inputAccumulator -= inputStepSeconds
        const moveVec = moveDir ? { x: FACING_VECTORS[moveDir].x, y: FACING_VECTORS[moveDir].z } : null
        this.inputCallback(moveVec)
        steps++
      }
      if (this.inputAccumulator > inputStepSeconds * 4) {
        this.inputAccumulator = 0
      }

      // Server positions are authoritative; animate without applying local movement.
      this.player.object.rotation.y = facingToYaw(this.player.facing)
      if (this.localMoving) this.localWalkPhase += this.playerSpeed * DEFAULT_PLAYER_TUNING.strideRate * delta
      this.player.model.pose(this.localWalkPhase, this.localMoving ? 1 : 0, this.elapsed)

      for (const entry of this.remotes.values()) {
        entry.player.setFacing(entry.facing)
        entry.player.object.rotation.y = facingToYaw(entry.facing)
        if (entry.moving) {
          entry.walkPhase += this.playerSpeed * DEFAULT_PLAYER_TUNING.strideRate * delta
        }
        entry.player.model.pose(entry.walkPhase, entry.moving ? 1 : 0, this.elapsed)
      }
    } else {
      this.prevPlayerPosition.copy(this.player.position)
      this.player.update(delta, this.elapsed, moveDir)
      this.corridors.constrainMovement(this.prevPlayerPosition, this.player.position, delta)
      this.publishPlayerThrottled(delta)
    }

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
    this.playerPublishTimer = 0
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
