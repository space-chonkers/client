import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BaseBuildResponse,
  Construction,
  MatchBuild,
  MatchEnded,
  MatchFrame,
  MatchPhenomenon,
  MatchState,
  ResourceAmounts,
  Resources,
  StashCollectResponse,
  Welcome,
} from './protocol'
import { formatServerError, GameSocket, getWsUrl } from './wsClient'

export interface GameSession {
  connected: boolean
  playerId: string | null
  welcome: Welcome | null
  matchState: MatchState | null
  frame: MatchFrame | null
  lastPhenomenon: MatchPhenomenon | null
  ended: MatchEnded | null
  lastBuild: { cellX: number; cellY: number } | null
  lastCollect: ResourceAmounts | null
  error: string | null
  joinMode: 'create' | 'quick' | 'byId' | 'none'
  createLobby: () => Promise<void>
  quickJoin: () => Promise<void>
  joinByCode: (code: string) => Promise<void>
  startMatch: () => Promise<void>
  leaveMatch: () => Promise<void>
  sendInput: (move: { x: number; y: number } | null) => void
  sendCollect: () => Promise<void>
  sendBuild: (cellX: number, cellY: number) => Promise<void>
  sendFix: () => Promise<void>
  resetEnded: () => void
  retry: () => void
}

const NICKNAME = 'Astronaut'

function appendConstruction(
  state: MatchState | null,
  construction: Construction,
  resources: Resources,
): MatchState | null {
  if (!state) return state
  const exists = state.constructions.some(
    (c) => c.cellX === construction.cellX && c.cellY === construction.cellY,
  )
  const constructions = exists ? state.constructions : [...state.constructions, construction]
  return {
    ...state,
    constructions,
    baseCellCount: constructions.length,
    resources,
  }
}

export function useGameSession(): GameSession {
  const socketRef = useRef<GameSocket | null>(null)
  const helloPromiseRef = useRef<Promise<void> | null>(null)
  const identifiedRef = useRef(false)
  const canSendInputRef = useRef(false)
  const seqRef = useRef(0)
  const [connected, setConnected] = useState(false)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [welcome, setWelcome] = useState<Welcome | null>(null)
  const [matchState, setMatchState] = useState<MatchState | null>(null)
  const [frame, setFrame] = useState<MatchFrame | null>(null)
  const [lastPhenomenon, setLastPhenomenon] = useState<MatchPhenomenon | null>(null)
  const [ended, setEnded] = useState<MatchEnded | null>(null)
  const [lastBuild, setLastBuild] = useState<{ cellX: number; cellY: number } | null>(null)
  const [lastCollect, setLastCollect] = useState<ResourceAmounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joinMode, setJoinMode] = useState<GameSession['joinMode']>('none')

  const openAndHello = useCallback((): { socket: GameSocket; hello: Promise<void> } => {
    if (socketRef.current && helloPromiseRef.current) {
      return { socket: socketRef.current, hello: helloPromiseRef.current }
    }

    identifiedRef.current = false
    const socket = new GameSocket({
      onOpen: () => setConnected(true),
      onClose: () => {
        setConnected(false)
        identifiedRef.current = false
        canSendInputRef.current = false
        socketRef.current = null
        helloPromiseRef.current = null
      },
      onMessage: (data) => {
        socket.handleIncoming(data, (type, payload, _id, errCode) => {
          if (type === 'welcome') {
            setWelcome(payload as Welcome)
          } else if (type === 'match.state') {
            const s = payload as MatchState
            canSendInputRef.current = s.phase === 'playing'
            setMatchState(s)
          } else if (type === 'match.frame') {
            setFrame(payload as MatchFrame)
          } else if (type === 'match.phenomenon') {
            setLastPhenomenon(payload as MatchPhenomenon)
          } else if (type === 'match.ended') {
            canSendInputRef.current = false
            setEnded(payload as MatchEnded)
          } else if (type === 'match.build') {
            const p = payload as MatchBuild
            setLastBuild({ cellX: p.construction.cellX, cellY: p.construction.cellY })
            setMatchState((prev) => appendConstruction(prev, p.construction, p.resources))
          } else if (type === 'error') {
            setError(formatServerError(errCode, payload))
          }
        })
      },
    })

    socketRef.current = socket
    socket.connect(getWsUrl())

    const hello = socket
      .send('player.hello', { protocolVersion: 1, nickname: NICKNAME })
      .then((payload) => {
        const p = payload as { playerId: string }
        identifiedRef.current = true
        setPlayerId(p.playerId)
        setError(null)
      })
    helloPromiseRef.current = hello

    return { socket, hello }
  }, [])

  useEffect(() => {
    let active = true
    const { socket, hello } = openAndHello()
    hello.catch((err) => {
      if (!active) return
      helloPromiseRef.current = null
      setError(err instanceof Error ? err.message : 'Could not connect to the server. Please try again.')
    })

    return () => {
      active = false
      socket.close()
      if (socketRef.current === socket) {
        socketRef.current = null
        helloPromiseRef.current = null
        identifiedRef.current = false
      }
    }
  }, [openAndHello])

  const ensureReady = useCallback(async (): Promise<GameSocket> => {
    const { socket, hello } = openAndHello()
    try {
      await hello
    } catch (err) {
      helloPromiseRef.current = null
      throw err
    }
    return socket
  }, [openAndHello])

  const join = useCallback(
    async (payload: { create?: boolean; matchId?: string }, mode: GameSession['joinMode']) => {
      canSendInputRef.current = false
      seqRef.current = 0
      setError(null)
      setEnded(null)
      setFrame(null)
      setLastPhenomenon(null)
      setLastBuild(null)
      setLastCollect(null)
      setJoinMode(mode)
      try {
        const socket = await ensureReady()
        const result = (await socket.send('match.join', payload)) as {
          matchId: string
          state: MatchState
        }
        canSendInputRef.current = result.state.phase === 'playing'
        setMatchState(result.state)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not join the lobby. Please try again.')
        throw err
      }
    },
    [ensureReady],
  )

  const createLobby = useCallback(async () => {
    await join({ create: true }, 'create')
  }, [join])

  const quickJoin = useCallback(async () => {
    await join({}, 'quick')
  }, [join])

  const joinByCode = useCallback(
    async (code: string) => {
      await join({ matchId: code.trim().toUpperCase() }, 'byId')
    },
    [join],
  )

  const startMatch = useCallback(async () => {
    try {
      const socket = await ensureReady()
      await socket.send('match.start')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the mission. Please try again.')
      throw err
    }
  }, [ensureReady])

  const leaveMatch = useCallback(async () => {
    canSendInputRef.current = false
    setMatchState(null)
    setFrame(null)
    setEnded(null)
    setLastBuild(null)
    setLastCollect(null)
    setLastPhenomenon(null)
    setError(null)
    setJoinMode('none')
    const socket = socketRef.current
    if (socket && identifiedRef.current) {
      try {
        await socket.send('match.leave')
      } catch {
        // Leaving while not in a match is a no-op for the UI.
      }
    }
  }, [])

  const sendInput = useCallback((move: { x: number; y: number } | null) => {
    const socket = socketRef.current
    if (!socket || !identifiedRef.current || !canSendInputRef.current) return
    const seq = seqRef.current++
    socket.sendInput(seq, move ?? undefined)
  }, [])

  const sendCollect = useCallback(async () => {
    try {
      const socket = await ensureReady()
      const result = (await socket.send('stash.collect')) as StashCollectResponse['payload']
      setLastCollect(result.collected)
      setMatchState((prev) => (prev ? { ...prev, resources: result.resources } : prev))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not collect resources. Please try again.')
    }
  }, [ensureReady])

  const sendBuild = useCallback(
    async (cellX: number, cellY: number) => {
      try {
        const socket = await ensureReady()
        const result = (await socket.send('base.build', { cellX, cellY })) as BaseBuildResponse['payload']
        setLastBuild({ cellX: result.construction.cellX, cellY: result.construction.cellY })
        setMatchState((prev) => appendConstruction(prev, result.construction, result.resources))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not build the corridor. Please try again.')
      }
    },
    [ensureReady],
  )

  const sendFix = useCallback(async () => {
    try {
      const socket = await ensureReady()
      await socket.send('phenomenon.fix')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fix the phenomenon. Please try again.')
    }
  }, [ensureReady])

  const resetEnded = useCallback(() => setEnded(null), [])
  const retry = useCallback(() => {
    setError(null)
    setEnded(null)
  }, [])

  return {
    connected,
    playerId,
    welcome,
    matchState,
    frame,
    lastPhenomenon,
    ended,
    lastBuild,
    lastCollect,
    error,
    joinMode,
    createLobby,
    quickJoin,
    joinByCode,
    startMatch,
    leaveMatch,
    sendInput,
    sendCollect,
    sendBuild,
    sendFix,
    resetEnded,
    retry,
  }
}
