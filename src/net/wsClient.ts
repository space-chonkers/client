export interface ConnectionStatus {
  connected: boolean
  playerId: string | null
  error: string | null
}

function buildWsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined
  if (fromEnv && fromEnv.length > 0) return fromEnv
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }
  return 'ws://localhost:8081/ws'
}

export function getWsUrl(): string {
  return buildWsUrl()
}

const SERVER_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  not_identified: 'Please wait while we connect you to the server.',
  already_in_match: 'Leave your current mission before joining another.',
  not_in_match: 'You are not in a mission. Please join a lobby first.',
  match_not_found: 'Lobby not found. Check the code and try again.',
  match_full: 'This lobby is full.',
  match_in_progress: 'This mission has already started.',
  not_host: 'Only the host can start the mission.',
  wrong_phase: 'You can’t do that at this stage of the mission.',
  not_on_base: 'Stand on the base to build.',
  not_in_front: 'Build in the cell directly in front of you.',
  cell_occupied: 'There is already a tile in front of you.',
  out_of_bounds: 'You can’t build outside the map.',
  invalid_cell: 'That cell cannot be used.',
  insufficient_resources: 'Not enough resources to build.',
  insufficient_energy: 'Not enough energy to fix this.',
  not_at_stash: 'Move closer to the stash to collect.',
  no_phenomenon: 'There is nothing to fix right now.',
  match_over: 'This mission has already ended.',
  server_full: 'The server is full. Please try again later.',
  rate_limited: 'Too many requests. Please try again in a moment.',
  protocol_version_mismatch: 'This client is out of date. Please refresh the page.',
}

export function formatServerError(code?: string, _payload?: unknown): string {
  return (code && SERVER_ERROR_MESSAGES[code]) || 'Something went wrong. Please try again.'
}

interface SocketHandlers {
  onOpen: () => void
  onMessage: (data: string) => void
  onClose: () => void
}

export class GameSocket {
  private socket: WebSocket | null = null
  private pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map()
  private openPromise: Promise<void> | null = null
  private resolveOpen: (() => void) | null = null
  private rejectOpen: ((err: Error) => void) | null = null
  private counter = 0
  private seq = 0
  private closedByCaller = false
  private handlers: SocketHandlers

  constructor(handlers: SocketHandlers) {
    this.handlers = handlers
  }

  connect(url: string): void {
    this.closedByCaller = false
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.resolveOpen = resolve
      this.rejectOpen = reject
    })
    const ws = new WebSocket(url)
    this.socket = ws
    ws.onopen = () => {
      if (this.socket !== ws) return
      this.resolveOpen?.()
      this.resolveOpen = null
      this.rejectOpen = null
      this.handlers.onOpen()
    }
    ws.onmessage = (ev) => {
      if (this.socket !== ws) return
      this.handlers.onMessage(String(ev.data))
    }
    ws.onclose = () => {
      if (this.socket !== ws) return
      if (this.rejectOpen) {
        this.rejectOpen(new Error(this.closedByCaller ? 'Connection closed.' : 'Could not connect to the server. Please try again.'))
        this.resolveOpen = null
        this.rejectOpen = null
      }
      this.rejectAllPending(new Error('Connection closed. Please try again.'))
      this.handlers.onClose()
    }
    ws.onerror = () => {}
  }

  close(): void {
    this.closedByCaller = true
    const ws = this.socket
    this.socket = null
    if (this.rejectOpen) {
      this.rejectOpen(new Error('Connection closed.'))
      this.resolveOpen = null
      this.rejectOpen = null
    }
    this.rejectAllPending(new Error('Connection closed.'))
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
      ws.close()
    }
  }

  async waitUntilOpen(timeoutMs = 5000): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (!this.openPromise) throw new Error('Not connected to the server. Please try again.')
    await Promise.race([
      this.openPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out. Please try again.')), timeoutMs),
      ),
    ])
  }

  async send(type: string, payload?: unknown): Promise<unknown> {
    await this.waitUntilOpen()
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to the server. Please try again.'))
        return
      }
      const id = `r${++this.counter}`
      this.pending.set(id, { resolve, reject })
      const envelope: Record<string, unknown> = { id, type }
      if (payload !== undefined) envelope.payload = payload
      this.socket.send(JSON.stringify(envelope))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('The server took too long to respond. Please try again.'))
        }
      }, 5000)
    })
  }

  sendInput(seq: number, move?: { x: number; y: number }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    const payload: Record<string, unknown> = { seq }
    if (move) payload.move = move
    this.socket.send(JSON.stringify({ type: 'match.input', payload }))
  }

  handleIncoming(data: string, dispatch: (type: string, payload: unknown, id?: string, error?: string) => void): void {
    let envelope: { id?: string; type: string; payload?: unknown; error?: string }
    try {
      envelope = JSON.parse(data)
    } catch {
      return
    }
    if (envelope.id && this.pending.has(envelope.id)) {
      const entry = this.pending.get(envelope.id)!
      this.pending.delete(envelope.id)
      if (envelope.type === 'error') {
        entry.reject(new Error(formatServerError(envelope.error, envelope.payload)))
      } else {
        entry.resolve(envelope.payload)
      }
      return
    }
    if (envelope.type === 'error' && !envelope.id) {
      dispatch(envelope.type, envelope.payload, envelope.id, envelope.error)
      return
    }
    dispatch(envelope.type, envelope.payload, envelope.id, envelope.error)
  }

  nextSeq(): number {
    return this.seq++
  }

  private rejectAllPending(err: Error): void {
    for (const entry of this.pending.values()) {
      entry.reject(err)
    }
    this.pending.clear()
  }
}
