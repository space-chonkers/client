import type { ConnectionStatus, GameTransport, TransportFactory } from '../net/transport'
import type {
  ConversionRates,
  PoolState,
  ResourceType,
  ServerMessage,
  StashCollectedMessage,
  StashState,
} from './types'

export interface EconomyState {
  status: ConnectionStatus
  tick: number
  stash: StashState | null
  pool: PoolState | null
  conversionRates: ConversionRates | null
  lastCollection: StashCollectedMessage | null
  lastRejection: string | null
}

const initialState: EconomyState = {
  status: 'closed',
  tick: -1,
  stash: null,
  pool: null,
  conversionRates: null,
  lastCollection: null,
  lastRejection: null,
}

/**
 * Client-side mirror of the server economy. Holds no rules: it only applies what the server
 * sends and forwards intents. Plain TypeScript, no React/Three, so it can be tested alone.
 */
export class EconomyStore {
  private state = initialState
  private listeners = new Set<() => void>()
  private transport: GameTransport | null = null

  constructor(private readonly createTransport: TransportFactory) {}

  /** Opens the connection. Returns a cleanup function (fits React's useEffect). */
  connect(): () => void {
    this.transport = this.createTransport({
      onStatus: (status) => this.set({ status }),
      onMessage: (message) => this.receive(message),
    })
    return () => {
      this.transport?.close()
      this.transport = null
    }
  }

  getState = (): EconomyState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Call this when a player interacts with a resource's section. The server converts that
   * resource into Pool money and answers with `stash.collected` + a new snapshot.
   */
  collect(resource: ResourceType): void {
    this.transport?.send({ type: 'stash.collect', resource })
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'economy.snapshot':
        // Ignore out-of-order snapshots.
        if (message.tick < this.state.tick) return
        this.set({
          tick: message.tick,
          stash: message.stash,
          pool: message.pool,
          conversionRates: message.conversionRates,
        })
        break
      case 'stash.collected':
        this.set({ lastCollection: message, lastRejection: null })
        break
      case 'economy.rejected':
        this.set({ lastRejection: message.reason })
        break
    }
  }

  private set(patch: Partial<EconomyState>): void {
    // New object on every change so useSyncExternalStore detects it.
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
}
