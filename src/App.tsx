import { useState } from 'react'
import { useBackgroundMusic } from './audio/useBackgroundMusic'
import { useHazardAlert } from './game/hazards/useHazardAlert'
import { useSimulatedHazardTicks } from './game/hazards/useSimulatedHazardTicks'
import HomeScreen from './home/HomeScreen'
import type { GameMode } from './home/gameMode'
import PlayerSandboxView from './PlayerSandboxView'
import HazardAlertBanner from './ui/HazardAlertBanner'
import HazardOngoingLabel from './ui/HazardOngoingLabel'
import './ui/theme.css'
import './ui/chunkyButton.css'

/** Shows the homepage until a game mode is picked, then the player sandbox. */
export default function App() {
  // Music lives in App so it keeps playing across screens
  const music = useBackgroundMusic()
  const hazardAlert = useHazardAlert()
  const [selectedMode, setSelectedMode] = useState<GameMode | null>(null)

  // Temporary: replace with the real server tick subscription once it is connected
  useSimulatedHazardTicks(selectedMode === 'solo', hazardAlert.receiveHazardCode)

  const startMission = (mode: GameMode) => {
    setSelectedMode(mode)
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
