import type { Facing } from '../player/Facing'

const KEY_TO_FACING: Readonly<Record<string, Facing>> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
}

const PICKUP_KEYS: ReadonlySet<string> = new Set(['KeyE', 'Space'])

/**
 * Keyboard input for the player.
 *
 * Movement is strictly 4-directional: when several direction keys are held,
 * the most recently pressed one wins (no diagonals). Pickup is edge-triggered,
 * so holding the key picks up only one item.
 */
export class InputController {
  /** Held direction key codes, oldest first. */
  private readonly heldDirectionKeys: string[] = []
  private pickupQueued = false

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const facing = KEY_TO_FACING[event.code]
    if (facing) {
      event.preventDefault()
      if (!this.heldDirectionKeys.includes(event.code)) this.heldDirectionKeys.push(event.code)
      return
    }
    if (PICKUP_KEYS.has(event.code)) {
      event.preventDefault()
      if (!event.repeat) this.pickupQueued = true
    }
  }

  private readonly onKeyUp = (event: KeyboardEvent) => {
    const index = this.heldDirectionKeys.indexOf(event.code)
    if (index !== -1) this.heldDirectionKeys.splice(index, 1)
  }

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
  }

  /** Direction currently requested, or null when no direction key is held. */
  getMoveDirection(): Facing | null {
    const last = this.heldDirectionKeys[this.heldDirectionKeys.length - 1]
    return last ? KEY_TO_FACING[last] : null
  }

  /** Returns true once per pickup key press. */
  consumePickupPress(): boolean {
    const queued = this.pickupQueued
    this.pickupQueued = false
    return queued
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown)
    this.target.removeEventListener('keyup', this.onKeyUp)
  }
}
