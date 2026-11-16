import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { INITIAL_SERVER_PAYLOAD } from './game/corridor/mockServerPayload'
import { launchMission, resolveMissionTerrainConfig, type MissionTerrain } from './game/map/missionTerrain'
import type { MissionMapConstruction, MissionMapPlayer } from './game/minimap/missionMap'
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

/** One line naming the terrain on screen; a fallback is always announced, plain procedural only in development. */
function TerrainSourceNote({ terrain }: { terrain: MissionTerrain }) {
  if (terrain.source === 'mars') {
    const { productId, datasetId, provider } = terrain.data.source
    return (
      <p className="mission-terrain-note" title={`${provider} · ${datasetId}`}>
        Real Mars terrain · HiRISE {productId ?? datasetId}
      </p>
    )
  }
  if (terrain.fallbackReason) {
    return (
      <p className="mission-terrain-note mission-terrain-note--fallback" role="status">
        Real Mars terrain unavailable ({terrain.fallbackReason}). Using procedural terrain.
      </p>
    )
  }
  return import.meta.env.DEV ? <p className="mission-terrain-note">Procedural terrain · seed {terrain.seed}</p> : null
}

/**
 * Mounts the player test scene with the HUD: resource bar (top-left), mission
 * minimap (top-right) and action buttons (bottom-left). The minimap mirrors
 * snapshots the scene publishes; investigation sites come from the mock
 * server payload until real match snapshots are connected. The scene is created
 * once its Layer −1 terrain is resolved (see `launchMission`).
 */
export default function PlayerSandboxView({ topRightStatus }: PlayerSandboxViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [resources, setResources] = useState<ResourceBarValues>({ ...DEFAULT_SIMULATED_RESOURCES })
  const [constructions, setConstructions] = useState<ReadonlyArray<MissionMapConstruction>>([])
  const [player, setPlayer] = useState<MissionMapPlayer | null>(null)
  /** Terrain the scene was built from; `null` while it loads. */
  const [terrain, setTerrain] = useState<MissionTerrain | null>(null)

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

    const config = resolveMissionTerrainConfig({
      dev: import.meta.env.DEV,
      apiBaseUrl: import.meta.env.VITE_MARS_TERRAIN_API_URL,
      search: window.location.search,
    })
    // Stops a pending terrain request or disposes the scene on unmount (leaving the mission).
    return launchMission(config, {
      createScene: (missionTerrain) =>
        new PlayerSandbox(
          container,
          { onConstructionsChange: setConstructions, onPlayerChange: setPlayer },
          missionTerrain.source === 'mars' ? { terrainData: missionTerrain.data } : { terrainSeed: missionTerrain.seed },
        ),
      onTerrain: setTerrain,
    })
  }, [])

  return (
    <div className="player-sandbox">
      <ResourceBar values={resources} />
      <ActionButtons onBuild={handleBuild} onCollect={handleCollect} />
      <div className="player-sandbox__top-right">
        <MissionMinimap
          grid={INITIAL_SERVER_PAYLOAD.grid}
          constructions={constructions}
          investigation={INITIAL_SERVER_PAYLOAD.investigation}
          player={player}
        />
        {topRightStatus}
      </div>
      {terrain ? (
        <TerrainSourceNote terrain={terrain} />
      ) : (
        <p className="mission-terrain-loading" role="status">
          Loading Martian terrain…
        </p>
      )}
      <div ref={containerRef} className="player-sandbox__canvas" aria-label="Astronaut player test scene" />
    </div>
  )
}
