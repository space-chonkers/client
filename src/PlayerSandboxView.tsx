import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { INITIAL_SERVER_PAYLOAD } from './game/corridor/mockServerPayload'
import type { MissionMapConstruction } from './game/minimap/missionMap'
import { PlayerSnapshotStore } from './game/minimap/PlayerSnapshotStore'
import { PlayerSandbox } from './game/PlayerSandbox'
import { ActionButtons } from './ui/ActionButtons'
import { MissionMinimap } from './ui/MissionMinimap'
import { ResourceBar, type ResourceBarValues } from './ui/ResourceBar'
import type { MatchEnded, MatchFrame, MatchState, ResourceAmounts, Welcome } from './net/protocol'
import './game/player/player.css'

export interface PlayerSandboxViewProps {
  matchState: MatchState | null
  frame: MatchFrame | null
  playerId: string | null
  ended: MatchEnded | null
  lastBuild: { cellX: number; cellY: number } | null
  lastCollect: ResourceAmounts | null
  welcome: Welcome | null
  onSendInput: (move: { x: number; y: number } | null) => void
  onSendCollect: () => Promise<void> | void
  onSendBuild: (cellX: number, cellY: number) => Promise<void> | void
  onSendFix: () => Promise<void> | void
  onLeave: () => void
  /** Transient status (e.g. an ongoing hazard label) below the minimap. */
  topRightStatus?: ReactNode
}

const STASH_COLLECT_RANGE = 0.7

function sameValues<T extends object>(left: T, right: T): boolean {
  return (Object.keys(left) as (keyof T)[]).every((key) => left[key] === right[key])
}

/** Mounts the server-backed mission scene and its resource, minimap, and action HUDs. */
export default function PlayerSandboxView({
  matchState,
  frame,
  playerId,
  ended,
  lastBuild,
  lastCollect,
  welcome,
  onSendInput,
  onSendCollect,
  onSendBuild,
  onSendFix,
  onLeave,
  topRightStatus,
}: PlayerSandboxViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sandboxRef = useRef<PlayerSandbox | null>(null)
  const inputRef = useRef(onSendInput)
  inputRef.current = onSendInput
  const [fallbackConstructions, setFallbackConstructions] = useState<ReadonlyArray<MissionMapConstruction>>([])
  // Player snapshots update independently so only the minimap marker re-renders.
  const [playerStore] = useState(() => new PlayerSnapshotStore())
  const [resources, setResources] = useState<ResourceBarValues>({
    oxygen: 0,
    water: 0,
    energy: 0,
    food: 0,
  })
  const [maxResources, setMaxResources] = useState<ResourceBarValues>({
    oxygen: 100,
    water: 100,
    energy: 100,
    food: 100,
  })
  const [stash, setStash] = useState<ResourceAmounts>({
    oxygen: 0,
    water: 0,
    energy: 0,
    food: 0,
  })
  const [nearStash, setNearStash] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const sandbox = new PlayerSandbox(container, {
      onConstructionsChange: setFallbackConstructions,
      onPlayerChange: playerStore.set,
    })
    sandbox.setInputCallback((move) => inputRef.current(move))
    sandboxRef.current = sandbox
    return () => {
      sandbox.setInputCallback(null)
      sandboxRef.current = null
      sandbox.dispose()
    }
  }, [playerStore])

  useEffect(() => {
    if (welcome) sandboxRef.current?.setServerRules(welcome.tickRate, welcome.rules.playerSpeed)
  }, [welcome])

  useEffect(() => {
    if (!lastBuild) return
    setNotice('Corridor built')
    const timer = window.setTimeout(() => setNotice(null), 2500)
    return () => window.clearTimeout(timer)
  }, [lastBuild])

  useEffect(() => {
    if (!lastCollect) return
    const total = Object.values(lastCollect).reduce((sum, amount) => sum + amount, 0)
    setNotice(total > 0 ? 'Resources collected' : 'The stash is empty')
    const timer = window.setTimeout(() => setNotice(null), 2500)
    return () => window.clearTimeout(timer)
  }, [lastCollect])

  // Apply authoritative constructions and player positions whenever state arrives.
  useEffect(() => {
    const sandbox = sandboxRef.current
    if (!sandbox || !matchState) return
    const stashConstruction = matchState.constructions.find((construction) => construction.kind === 'stash')
    if (!stashConstruction) return

    const players = frame?.players ?? matchState.players
    sandbox.applyServerState({
      constructions: matchState.constructions,
      stashOrigin: { cellX: stashConstruction.cellX, cellY: stashConstruction.cellY },
      grid: matchState.grid,
      investigation: matchState.investigation,
      players: players.map((player) => ({
        id: player.id,
        slot: player.slot,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        facing: player.facing,
      })),
      localPlayerId: playerId,
    })

    const localPlayer = players.find((player) => player.id === playerId)
    if (localPlayer) {
      const onCell =
        Math.floor(localPlayer.x) === stashConstruction.cellX &&
        Math.floor(localPlayer.y) === stashConstruction.cellY
      const distance = Math.hypot(
        localPlayer.x - (stashConstruction.cellX + 0.5),
        localPlayer.y - (stashConstruction.cellY + 0.5),
      )
      setNearStash(onCell || distance <= STASH_COLLECT_RANGE)
    } else {
      setNearStash(false)
    }
  }, [matchState, frame, playerId])

  // Keep the HUD pools and stash sourced from the latest server snapshot.
  useEffect(() => {
    const source = frame?.resources ?? matchState?.resources
    if (!source) return
    const nextResources = {
      oxygen: Math.round(source.oxygen.pool.current),
      water: Math.round(source.water.pool.current),
      energy: Math.round(source.energy.pool.current),
      food: Math.round(source.food.pool.current),
    }
    setResources((current) => sameValues(current, nextResources) ? current : nextResources)
    const nextMaxResources = {
      oxygen: Math.round(source.oxygen.pool.max),
      water: Math.round(source.water.pool.max),
      energy: Math.round(source.energy.pool.max),
      food: Math.round(source.food.pool.max),
    }
    setMaxResources((current) => sameValues(current, nextMaxResources) ? current : nextMaxResources)
    const nextStash = {
      oxygen: Number(source.oxygen.stash.current.toFixed(1)),
      water: Number(source.water.stash.current.toFixed(1)),
      energy: Number(source.energy.stash.current.toFixed(1)),
      food: Number(source.food.stash.current.toFixed(1)),
    }
    setStash((current) => sameValues(current, nextStash) ? current : nextStash)
  }, [frame, matchState])

  const handleBuild = useCallback(() => {
    const sandbox = sandboxRef.current
    if (!sandbox) return
    const target = sandbox.getServerBuildTarget()
    void onSendBuild(target.cellX, target.cellY)
  }, [onSendBuild])

  const handleCollect = useCallback(() => {
    void onSendCollect()
  }, [onSendCollect])

  const handleFix = useCallback(() => {
    void onSendFix()
  }, [onSendFix])

  const activePhenomenon = frame?.phenomenon ?? matchState?.phenomenon
  const fixEnabled =
    nearStash && !ended && activePhenomenon !== undefined &&
    activePhenomenon.type > 0 && activePhenomenon.type < 4
  const minimapGrid = matchState?.grid ?? INITIAL_SERVER_PAYLOAD.grid
  const minimapConstructions = matchState?.constructions ?? fallbackConstructions
  const minimapInvestigation = matchState?.investigation ?? INITIAL_SERVER_PAYLOAD.investigation

  return (
    <div className="player-sandbox">
      <ResourceBar values={resources} maxValues={maxResources} />
      <ActionButtons
        onBuild={handleBuild}
        onCollect={handleCollect}
        onFix={handleFix}
        collectEnabled={nearStash}
        fixEnabled={fixEnabled}
      />
      <div className="player-sandbox__top-right">
        <MissionMinimap
          grid={minimapGrid}
          constructions={minimapConstructions}
          investigation={minimapInvestigation}
          player={playerStore}
        />
        {topRightStatus}
        <div className="player-sandbox__stash" aria-label="Stash resources">
          <span>
            Stash: O2 {stash.oxygen.toFixed(1)} · W {stash.water.toFixed(1)} · E {stash.energy.toFixed(1)} · F{' '}
            {stash.food.toFixed(1)}
          </span>
          <span className="player-sandbox__stash-hint">
            {nearStash ? 'At stash — press Q/C to collect' : 'Walk to center crate to collect'}
          </span>
        </div>
      </div>
      <div ref={containerRef} className="player-sandbox__canvas" aria-label="Astronaut player test scene" />
      <div className="player-sandbox__toasts">
        {notice && <p className="player-sandbox__toast" role="status">{notice}</p>}
      </div>
      {ended && (
        <div className="mission-ended-backdrop">
          <div className="mission-ended-dialog" role="dialog" aria-label="Mission ended">
            <h2>{ended.outcome === 'win' ? 'Mission complete!' : 'Mission failed'}</h2>
            <p>{ended.reason === 'all_investigated' ? 'All investigation sites reached.' :
              ended.reason === 'resource_depleted' ? 'A shared resource ran out.' : 'The mission was abandoned.'}</p>
            <p>
              Covered {ended.stats.investigationCovered}/{ended.stats.investigationTotal} · Base{' '}
              {ended.stats.baseCells} cells · {Math.round(ended.stats.elapsedMs / 1000)}s
            </p>
            {ended.stats.depletedResource && <p>Depleted resource: {ended.stats.depletedResource.charAt(0).toUpperCase() + ended.stats.depletedResource.slice(1)}</p>}
            <button type="button" className="chunky-button" onClick={onLeave}>
              Back to home
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
