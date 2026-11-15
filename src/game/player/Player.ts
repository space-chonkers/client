import * as THREE from 'three'
import { AstronautModel } from './AstronautModel'
import { FACING_VECTORS, facingToYaw, type Facing } from './Facing'

export type PlayerTuning = {
  /** Units per second at full speed. */
  walkSpeed: number
  /** How quickly the player reaches walk speed (higher = snappier). */
  acceleration: number
  /** How quickly the player stops when keys are released. */
  deceleration: number
  /** How quickly the model turns to its new facing. */
  turnSpeed: number
  /** Stride cycles (radians) per unit walked; controls step frequency. */
  strideRate: number
}

export const DEFAULT_PLAYER_TUNING: Readonly<PlayerTuning> = {
  walkSpeed: 3.2,
  acceleration: 14,
  deceleration: 18,
  turnSpeed: 16,
  strideRate: 3.4,
}

/** Rectangle on the ground the player cannot leave. */
export type MovementBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type PlayerOptions = {
  /** Main suit color. Defaults to ASTRONAUT_COLORS.suit (white). */
  suitColor?: THREE.ColorRepresentation
  tuning?: Readonly<PlayerTuning>
  bounds?: MovementBounds | null
}

/**
 * The astronaut player: 4-direction movement, an always-known facing, and
 * procedural walk/idle animation.
 *
 * Add `player.object` to the scene and call `update()` once per frame.
 */
export class Player {
  /** Root object: position = player position, rotation.y = visual facing. */
  readonly object = new THREE.Group()
  readonly model: AstronautModel

  private readonly tuning: Readonly<PlayerTuning>
  private bounds: MovementBounds | null
  private currentFacing: Facing = 'down'
  private readonly velocity = new THREE.Vector3()
  private readonly targetVelocity = new THREE.Vector3()
  private yaw = facingToYaw('down')
  private walkPhase = 0

  constructor(options: PlayerOptions = {}) {
    this.tuning = options.tuning ?? DEFAULT_PLAYER_TUNING
    this.bounds = options.bounds ?? null
    this.model = new AstronautModel({ suitColor: options.suitColor })

    this.object.name = 'Player'
    this.object.add(this.model.root)
    this.object.rotation.y = this.yaw
  }

  /** The direction the player is facing: 'up' | 'down' | 'left' | 'right'. */
  get facing(): Facing {
    return this.currentFacing
  }

  /** Unit vector (X/Z) the player is facing. */
  getFacingVector(target: THREE.Vector3): THREE.Vector3 {
    const v = FACING_VECTORS[this.currentFacing]
    return target.set(v.x, 0, v.z)
  }

  get position(): THREE.Vector3 {
    return this.object.position
  }

  get isMoving(): boolean {
    return this.velocity.lengthSq() > 0.01
  }

  setBounds(bounds: MovementBounds | null): void {
    this.bounds = bounds
  }

  /** Turn to face a direction without moving (e.g. for cutscenes). */
  setFacing(facing: Facing): void {
    this.currentFacing = facing
  }

  /** Change the astronaut's suit color, e.g. to tell players apart. */
  setSuitColor(color: THREE.ColorRepresentation): void {
    this.model.setSuitColor(color)
  }

  /**
   * @param delta          seconds since last frame
   * @param elapsed        seconds since start
   * @param moveDirection  requested direction, or null to stand still
   */
  update(delta: number, elapsed: number, moveDirection: Facing | null): void {
    const { walkSpeed, acceleration, deceleration, turnSpeed, strideRate } = this.tuning

    if (moveDirection) {
      this.currentFacing = moveDirection
      const v = FACING_VECTORS[moveDirection]
      this.targetVelocity.set(v.x * walkSpeed, 0, v.z * walkSpeed)
    } else {
      this.targetVelocity.set(0, 0, 0)
    }

    const rate = moveDirection ? acceleration : deceleration
    this.velocity.lerp(this.targetVelocity, 1 - Math.exp(-rate * delta))
    if (!moveDirection && this.velocity.lengthSq() < 1e-4) this.velocity.set(0, 0, 0)
    this.object.position.addScaledVector(this.velocity, delta)

    if (this.bounds) {
      const p = this.object.position
      p.x = THREE.MathUtils.clamp(p.x, this.bounds.minX, this.bounds.maxX)
      p.z = THREE.MathUtils.clamp(p.z, this.bounds.minZ, this.bounds.maxZ)
    }

    this.yaw = dampAngle(this.yaw, facingToYaw(this.currentFacing), turnSpeed, delta)
    this.object.rotation.y = this.yaw

    const speed = this.velocity.length()
    const moving = Math.min(speed / walkSpeed, 1)
    this.walkPhase += speed * strideRate * delta

    this.model.pose(this.walkPhase, moving, elapsed)
  }

  dispose(): void {
    this.model.dispose()
  }
}

/** Frame-rate independent damping between angles, taking the short way round. */
function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  let diff = (target - current) % (Math.PI * 2)
  if (diff > Math.PI) diff -= Math.PI * 2
  if (diff < -Math.PI) diff += Math.PI * 2
  return current + diff * (1 - Math.exp(-lambda * delta))
}
