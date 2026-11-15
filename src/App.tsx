import { useState } from 'react'
import { useBackgroundMusic } from './audio/useBackgroundMusic'
import HomeScreen from './home/HomeScreen'
import type { GameMode } from './home/gameMode'
import PlayerSandboxView from './PlayerSandboxView'

/** Shows the homepage until a game mode is picked, then the player sandbox. */
export default function App() {
  // Music lives in App so it keeps playing across screens
  const music = useBackgroundMusic()
  const [selectedMode, setSelectedMode] = useState<GameMode | null>(null)

  if (selectedMode) {
    return (
      <main className="game-client mission-screen">
        <PlayerSandboxView />
        <button type="button" className="chunky-button mission-screen__back" onClick={() => setSelectedMode(null)}>
          Back to home
        </button>
      </main>
    )
  }

  return (
    <main className="game-client">
      <HomeScreen music={music} onStartMission={setSelectedMode} />
    </main>
  )
}
