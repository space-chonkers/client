import type { ClientMessage, ServerMessage } from '../economy/types'
import type { GameTransport, TransportHandlers } from './transport'

const MAX_RETRY_DELAY_MS = 10_000

/**
 * Connects to the Go gateway, which forwards this player's RabbitMQ queue over WebSocket.
 * Reconnects with exponential backoff. Intents sent while disconnected are dropped on purpose:
 * replaying stale intents against an authoritative server is worse than losing them.
 */
export class WebSocketTransport implements GameTransport {
  private socket: WebSocket | null = null
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(
    private readonly url: string,
    private readonly handlers: TransportHandlers,
  ) {
    this.open()
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }

  close(): void {
    this.closed = true
    clearTimeout(this.retryTimer)
    this.socket?.close()
    this.handlers.onStatus('closed')
  }

  private open(): void {
    this.handlers.onStatus('connecting')
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.onopen = () => {
      this.retries = 0
      this.handlers.onStatus('open')
    }

    socket.onmessage = (event) => {
      const message = parse(event.data)
      if (message) this.handlers.onMessage(message)
    }

    socket.onclose = () => {
      if (this.closed) return
      this.handlers.onStatus('closed')
      const delay = Math.min(1000 * 2 ** this.retries++, MAX_RETRY_DELAY_MS)
      this.retryTimer = setTimeout(() => this.open(), delay)
    }
  }
}

function parse(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null
  try {
    const value = JSON.parse(data)
    return typeof value?.type === 'string' ? (value as ServerMessage) : null
  } catch {
    return null
  }
}
