import { useEffect, useRef, useState } from 'react'
import { PlayerSandbox } from './game/PlayerSandbox'

/** Mounts the player test scene and shows the backpack count. */
export default function PlayerSandboxView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [backpackCount, setBackpackCount] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const sandbox = new PlayerSandbox(container)
    const unsubscribe = sandbox.onBackpackChange((items) => setBackpackCount(items.length))

    return () => {
      unsubscribe()
      sandbox.dispose()
    }
  }, [])

  return (
    <div className="player-sandbox">
      <div ref={containerRef} className="player-sandbox__canvas" aria-label="Astronaut player test scene" />
      <div className="player-sandbox__backpack">Backpack: {backpackCount}</div>
    </div>
  )
}
