import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { INITIAL_SERVER_PAYLOAD } from './game/corridor/mockServerPayload'
import type { MissionMapConstruction } from './game/minimap/missionMap'
import { PlayerSnapshotStore } from './game/minimap/PlayerSnapshotStore'
import { PlayerSandbox } from './game/PlayerSandbox'
import { ActionButtons } from './ui/ActionButtons'
import { MissionMinimap } from './ui/MissionMinimap'
import { DEFAULT_SIMULATED_RESOURCES, ResourceBar, type ResourceBarValues } from './ui/ResourceBar'
import {
  SIMULATED_BUILD_COST,
  SIMULATED_COLLECT_YIELD,
  applyResourceDelta,
} from './ui/simulatedResources'
import './game/player/player.css'

export interface PlayerSandboxViewProps {
  /** Transient status (e.g. the ongoing hazard label) stacked under the minimap in the top-right HUD. */
  topRightStatus?: ReactNode
}

/**
 * Mounts the player test scene with the HUD: resource bar (top-left), mission
 * minimap (top-right) and action buttons (bottom-left). The minimap mirrors
 * snapshots the scene publishes; investigation sites come from the mock
 * server payload until real match snapshots are connected.
 */
export default function PlayerSandboxView({ topRightStatus }: PlayerSandboxViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [resources, setResources] = useState<ResourceBarValues>({ ...DEFAULT_SIMULATED_RESOURCES })
  const [constructions, setConstructions] = useState<ReadonlyArray<MissionMapConstruction>>([])
  // Player updates arrive at ~10 Hz; keeping them out of this component's state
  // means only the minimap's player marker re-renders, not the whole HUD.
  const [playerStore] = useState(() => new PlayerSnapshotStore())

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

    const sandbox = new PlayerSandbox(container, {
      onConstructionsChange: setConstructions,
      onPlayerChange: playerStore.set,
    })
    return () => sandbox.dispose()
  }, [playerStore])

  return (
    <div className="player-sandbox">
      <ResourceBar values={resources} />
      <ActionButtons onBuild={handleBuild} onCollect={handleCollect} />
      <div className="player-sandbox__top-right">
        <MissionMinimap
          grid={INITIAL_SERVER_PAYLOAD.grid}
          constructions={constructions}
          investigation={INITIAL_SERVER_PAYLOAD.investigation}
          player={playerStore}
        />
        {topRightStatus}
      </div>
      <div ref={containerRef} className="player-sandbox__canvas" aria-label="Astronaut player test scene" />
    </div>
  )
}
