import type { BackgroundMusicControls } from '../audio/useBackgroundMusic'
import MarsHomeScene from '../home/MarsHomeScene'
import MusicVolumeControl from '../home/MusicVolumeControl'
import type { LobbyPlayer } from './lobbyPlayer'
import '../ui/theme.css'
import '../ui/chunkyButton.css'
import './CoopLobbyScreen.css'

/** Helmet avatar; the visor takes the slot color through `--slot-color`. */
function AstronautAvatar() {
  return (
    <svg className="lobby-slot__avatar" viewBox="0 0 48 48" aria-hidden="true">
      <path className="lobby-slot__suit" d="M9 46c0-8 6.5-12 15-12s15 4 15 12z" />
      <circle className="lobby-slot__helmet" cx="24" cy="21" r="15" />
      <rect className="lobby-slot__visor" x="13" y="14" width="22" height="13" rx="6.5" />
    </svg>
  )
}

interface LobbySlotProps {
  slotIndex: number
  player: LobbyPlayer | undefined
  isLocal: boolean
}

function LobbySlot({ slotIndex, player, isLocal }: LobbySlotProps) {
  const slotNumber = slotIndex + 1

  if (!player) {
    return (
      <li className="lobby-slot lobby-slot--empty">
        <AstronautAvatar />
        <span className="lobby-slot__name">
          Waiting
          <span className="lobby-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
        <span className="lobby-slot__number">P{slotNumber}</span>
      </li>
    )
  }

  return (
    <li className={`lobby-slot lobby-slot--filled lobby-slot--p${slotNumber}`}>
      <AstronautAvatar />
      <span className="lobby-slot__name">{player.name}</span>
      {isLocal && <span className="lobby-tag">You</span>}
      <span className="lobby-slot__number">P{slotNumber}</span>
    </li>
  )
}

interface CoopLobbyScreenProps {
  /** App-wide music controls; owned by `App` so playback survives screen changes. */
  music: BackgroundMusicControls
  /** Crew members currently in the lobby, each in its own slot. */
  players: readonly LobbyPlayer[]
  localPlayerId: string
  maxPlayers: number
  onLeave: () => void
}

/** Co-op waiting room: shows the crew slots filling up while players join. */
export default function CoopLobbyScreen({ music, players, localPlayerId, maxPlayers, onLeave }: CoopLobbyScreenProps) {
  const slots = Array.from({ length: maxPlayers }, (_, slotIndex) =>
    players.find((player) => player.slot === slotIndex),
  )

  return (
    <div className="lobby-screen">
      <MarsHomeScene />

      <div className="lobby-overlay">
        <header className="lobby-header">
          <h1 className="lobby-header__title">Waiting for crew</h1>
          <p className="lobby-header__subtitle">Co-op mission</p>
        </header>

        <section className="lobby-panel" aria-labelledby="lobby-crew-title">
          <div className="lobby-panel__heading">
            <h2 id="lobby-crew-title" className="lobby-panel__title">
              Crew
            </h2>
            <p className="lobby-panel__count" aria-live="polite">
              {players.length} / {maxPlayers} aboard
            </p>
          </div>

          <ul className="lobby-slots">
            {slots.map((player, slotIndex) => (
              <LobbySlot
                key={slotIndex}
                slotIndex={slotIndex}
                player={player}
                isLocal={player?.id === localPlayerId}
              />
            ))}
          </ul>

          <div className="lobby-actions">
            <button type="button" className="chunky-button lobby-button" onClick={onLeave}>
              Leave
            </button>
          </div>
        </section>

        <MusicVolumeControl {...music} />
      </div>
    </div>
  )
}
