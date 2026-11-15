import { useState } from 'react'
import { useBackgroundMusic } from './audio/useBackgroundMusic'
import { HAZARD_CODES } from './game/hazards/hazardEvents'
import { useHazardAlert } from './game/hazards/useHazardAlert'
import HomeScreen from './home/HomeScreen'
import type { GameMode } from './home/gameMode'
import PlayerSandboxView from './PlayerSandboxView'
import HazardAlertBanner from './ui/HazardAlertBanner'
import HazardOngoingLabel from './ui/HazardOngoingLabel'
import './ui/theme.css'
import './ui/chunkyButton.css'

function pickRandomHazardCode(): number {
  return HAZARD_CODES[Math.floor(Math.random() * HAZARD_CODES.length)]
}

/** Shows the homepage until a game mode is picked, then the player sandbox. */
export default function App() {
  // Music lives in App so it keeps playing across screens
  const music = useBackgroundMusic()
  const hazardAlert = useHazardAlert()
  const [selectedMode, setSelectedMode] = useState<GameMode | null>(null)

  const startMission = (mode: GameMode) => {
    setSelectedMode(mode)
    // Test trigger: simulates a server tick with a random hazard until real ticks are wired up
    if (mode === 'solo') {
      hazardAlert.receiveHazardCode(pickRandomHazardCode())
    }
  }

  const returnHome = () => {
    hazardAlert.dismiss()
    setSelectedMode(null)
  }

  if (selectedMode) {
    const { warningHazard, ongoingHazard, closeWarning } = hazardAlert
    return (
      <main className="game-client mission-screen">
        <PlayerSandboxView />
        {ongoingHazard && <HazardOngoingLabel hazard={ongoingHazard} />}
        {warningHazard && <HazardAlertBanner hazard={warningHazard} onClose={closeWarning} />}
        <button type="button" className="chunky-button mission-screen__back" onClick={returnHome}>
          Back to home
        </button>
      </main>
    )
  }

  return (
    <main className="game-client">
      <HomeScreen music={music} onStartMission={startMission} />
    </main>
  )
}
