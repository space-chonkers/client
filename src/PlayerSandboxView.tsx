import { useEffect, useRef } from 'react'
import { PlayerSandbox } from './game/PlayerSandbox'
import { ResourceBar } from './ui/ResourceBar'
import './game/player/player.css'

/** Mounts the player test scene and top HUD resource bar. */
export default function PlayerSandboxView() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const sandbox = new PlayerSandbox(container)
    return () => sandbox.dispose()
  }, [])

  return (
    <div className="player-sandbox">
      <ResourceBar />
      <div ref={containerRef} className="player-sandbox__canvas" aria-label="Astronaut player test scene" />
    </div>
  )
}
