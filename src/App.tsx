import { useState } from 'react'
import { useBackgroundMusic } from './audio/useBackgroundMusic'
import { useHazardAlert } from './game/hazards/useHazardAlert'
import { useSimulatedHazardTicks } from './game/hazards/useSimulatedHazardTicks'
import HomeScreen from './home/HomeScreen'
import { COOP_MAX_PLAYERS, type GameMode } from './home/gameMode'
import CoopLobbyScreen from './lobby/CoopLobbyScreen'
import { LOCAL_LOBBY_PLAYER } from './lobby/lobbyPlayer'
import PlayerSandboxView from './PlayerSandboxView'
import HazardAlertBanner from './ui/HazardAlertBanner'
import HazardOngoingLabel from './ui/HazardOngoingLabel'
import './ui/theme.css'
import './ui/chunkyButton.css'

type AppScreen = 'home' | 'coop-lobby' | 'mission'

/** Until the client joins jam-server lobbies, the local player is the whole crew. */
const LOCAL_CREW = [LOCAL_LOBBY_PLAYER]

/**
 * Shows the homepage until a game mode is picked. Solo goes straight to the
 * player sandbox; co-op opens the crew lobby while players join.
 */
export default function App() {
  // Music lives in App so it keeps playing across screens
  const music = useBackgroundMusic()
  const hazardAlert = useHazardAlert()
  const [screen, setScreen] = useState<AppScreen>('home')

  // Temporary: replace with the real server tick subscription once it is connected
  useSimulatedHazardTicks(screen === 'mission', hazardAlert.receiveHazardCode)

  const handleModeSelected = (mode: GameMode) => {
    setScreen(mode === 'coop' ? 'coop-lobby' : 'mission')
  }

  const goHome = () => {
    hazardAlert.dismiss()
    setScreen('home')
  }

  if (screen === 'mission') {
    const { warningHazard, ongoingHazard, closeWarning } = hazardAlert
    return (
      <main className="game-client mission-screen">
        <PlayerSandboxView />
        {ongoingHazard && <HazardOngoingLabel hazard={ongoingHazard} />}
        {warningHazard && <HazardAlertBanner hazard={warningHazard} onClose={closeWarning} />}
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
          players={LOCAL_CREW}
          localPlayerId={LOCAL_LOBBY_PLAYER.id}
          maxPlayers={COOP_MAX_PLAYERS}
          onLeave={goHome}
        />
      </main>
    )
  }

  return (
    <main className="game-client">
      <HomeScreen music={music} onStartMission={handleModeSelected} />
    </main>
  )
}
