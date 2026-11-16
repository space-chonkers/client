import { useEffect, useRef, useState } from 'react'
import { useBackgroundMusic } from './audio/useBackgroundMusic'
import { useHazardAlert } from './game/hazards/useHazardAlert'
import HomeScreen from './home/HomeScreen'
import { COOP_MAX_PLAYERS, type GameMode } from './home/gameMode'
import CoopLobbyScreen from './lobby/CoopLobbyScreen'
import { useGameSession } from './net/useGameSession'
import PlayerSandboxView from './PlayerSandboxView'
import HazardAlertBanner from './ui/HazardAlertBanner'
import HazardOngoingLabel from './ui/HazardOngoingLabel'
import './ui/theme.css'
import './ui/chunkyButton.css'

type AppScreen = 'home' | 'coop-lobby' | 'mission'

/**
 * Shows the homepage until a game mode is picked. Solo creates + starts a
 * server lobby; co-op joins via the lobby screen. Playing state comes from
 * the server `match.state` phase.
 */
export default function App() {
  const music = useBackgroundMusic()
  const hazardAlert = useHazardAlert()
  const session = useGameSession()
  const [screen, setScreen] = useState<AppScreen>('home')
  const {
    receiveHazardCode,
    receiveInstantHazardCode,
    resolveOngoingHazard,
    dismiss,
  } = hazardAlert

  // Full state/frames cover active hazards, including when joining a live match.
  const lastActivePhenomenonCode = useRef(-1)
  useEffect(() => {
    const phenomenon = session.frame?.phenomenon ?? session.matchState?.phenomenon
    const code = phenomenon?.type ?? 0
    if (code === lastActivePhenomenonCode.current) return
    lastActivePhenomenonCode.current = code
    if (code !== 0) {
      receiveHazardCode(code)
    }
  }, [session.frame, session.matchState, receiveHazardCode])

  // Instant events (currently rotten food) are not present in match frames.
  const handledPhenomenonEvent = useRef(session.lastPhenomenon)
  useEffect(() => {
    const event = session.lastPhenomenon
    if (!event || event === handledPhenomenonEvent.current) return
    handledPhenomenonEvent.current = event

    if (event.action === 'started') receiveHazardCode(event.phenomenon.type)
    else if (event.action === 'instant') receiveInstantHazardCode(event.phenomenon.type)
    else resolveOngoingHazard()
  }, [
    session.lastPhenomenon,
    receiveHazardCode,
    receiveInstantHazardCode,
    resolveOngoingHazard,
  ])

  // Advance to mission when the server says playing.
  useEffect(() => {
    const phase = session.matchState?.phase
    if ((phase === 'playing' || phase === 'countdown') && screen !== 'mission') {
      setScreen('mission')
    }
  }, [session.matchState, screen])

  useEffect(() => {
    if (session.ended) dismiss()
  }, [session.ended, dismiss])

  const handleModeSelected = (mode: GameMode) => {
    if (mode === 'coop') {
      setScreen('coop-lobby')
      return
    }
    // Solo: create a lobby (1 player) and start immediately (host).
    void (async () => {
      try {
        await session.createLobby()
        await session.startMatch()
      } catch {
        setScreen('home')
      }
    })()
    setScreen('mission')
  }

  const goHome = () => {
    dismiss()
    void session.leaveMatch()
    setScreen('home')
  }

  const lobbyPlayers =
    session.matchState?.players.map((p) => ({ id: p.id, slot: p.slot, name: p.name })) ?? []
  const isHost = session.matchState?.hostId === session.playerId

  if (screen === 'mission') {
    const { warningHazard, ongoingHazard, closeWarning } = hazardAlert
    return (
      <main className="game-client mission-screen">
        <PlayerSandboxView
          matchState={session.matchState}
          frame={session.frame}
          playerId={session.playerId}
          ended={session.ended}
          lastBuild={session.lastBuild}
          lastCollect={session.lastCollect}
          welcome={session.welcome}
          onSendInput={session.sendInput}
          onSendCollect={session.sendCollect}
          onSendBuild={session.sendBuild}
          onSendFix={session.sendFix}
          onLeave={goHome}
          topRightStatus={ongoingHazard && <HazardOngoingLabel hazard={ongoingHazard} />}
        />
        {warningHazard && <HazardAlertBanner hazard={warningHazard} onClose={closeWarning} />}
        {!session.connected && <p className="mission-alert" role="alert">Disconnected from the server. Return home to try again.</p>}
        {session.error && <p className="mission-alert" role="alert">{session.error}</p>}
        <button type="button" className="chunky-button mission-screen__back" onClick={goHome}>
          Back to home
        </button>
      </main>
    )
  }

  if (screen === 'coop-lobby') {
    return (
      <main className="game-client">
        <CoopLobbyScreen
          music={music}
          players={lobbyPlayers}
          localPlayerId={session.playerId ?? ''}
          maxPlayers={COOP_MAX_PLAYERS}
          onLeave={goHome}
          matchId={session.matchState?.matchId ?? null}
          isHost={isHost}
          phase={session.matchState?.phase}
          error={session.error}
          connected={session.connected}
          onCreate={session.createLobby}
          onQuickJoin={session.quickJoin}
          onJoinByCode={session.joinByCode}
          onStart={session.startMatch}
        />
      </main>
    )
  }

  return (
    <main className="game-client mission-screen">
      <HomeScreen music={music} onStartMission={handleModeSelected} />
      {session.error && <p className="mission-alert" role="alert">{session.error}</p>}
    </main>
  )
}
