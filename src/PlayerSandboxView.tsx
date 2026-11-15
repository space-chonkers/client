import { useCallback, useEffect, useRef, useState } from 'react'
import { PlayerSandbox } from './game/PlayerSandbox'
import { ActionButtons } from './ui/ActionButtons'
import { DEFAULT_SIMULATED_RESOURCES, ResourceBar, type ResourceBarValues } from './ui/ResourceBar'
import {
  SIMULATED_BUILD_COST,
  SIMULATED_COLLECT_YIELD,
  applyResourceDelta,
} from './ui/simulatedResources'
import './game/player/player.css'

/** Mounts the player test scene with the top HUD resource bar and bottom-left action buttons. */
export default function PlayerSandboxView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [resources, setResources] = useState<ResourceBarValues>({ ...DEFAULT_SIMULATED_RESOURCES })

  const handleBuild = useCallback(
    () => setResources((current) => applyResourceDelta(current, SIMULATED_BUILD_COST, -1)),
    [],
  )
  const handleCollect = useCallback(
    () => setResources((current) => applyResourceDelta(current, SIMULATED_COLLECT_YIELD, 1)),
    [],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const sandbox = new PlayerSandbox(container)
    return () => sandbox.dispose()
  }, [])

  return (
    <div className="player-sandbox">
      <ResourceBar values={resources} />
      <ActionButtons onBuild={handleBuild} onCollect={handleCollect} />
      <div ref={containerRef} className="player-sandbox__canvas" aria-label="Astronaut player test scene" />
    </div>
  )
}
