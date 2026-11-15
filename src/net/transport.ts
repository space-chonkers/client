import type { ClientMessage, ServerMessage } from '../economy/types'
import { MockTransport } from './mockTransport'
import { WebSocketTransport } from './websocketTransport'

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

export interface TransportHandlers {
  onMessage(message: ServerMessage): void
  onStatus(status: ConnectionStatus): void
}

/** How the client talks to the server. Swap implementations without touching game code. */
export interface GameTransport {
  send(message: ClientMessage): void
  close(): void
}

export type TransportFactory = (handlers: TransportHandlers) => GameTransport

/** Picks the real WebSocket when a server URL is configured, otherwise the mock server. */
export function createTransport(handlers: TransportHandlers): GameTransport {
  const url = import.meta.env.VITE_SERVER_URL
  if (import.meta.env.VITE_USE_MOCK === 'true' || !url) {
    return new MockTransport(handlers)
  }
  return new WebSocketTransport(url, handlers)
}
