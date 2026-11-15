/** Game modes offered on the homepage. */
export type GameMode = 'solo' | 'coop'

export interface GameModeOption {
  mode: GameMode
  /** Text shown on the mode button. */
  label: string
  /** Shown in the button's accessible label ("up to N players"). */
  maxPlayers: number
}

/** Crew size of a co-op match; matches jam-server's `limits.maxPlayersPerMatch`. */
export const COOP_MAX_PLAYERS = 4

/** Mode buttons, in display order. */
export const GAME_MODE_OPTIONS: readonly GameModeOption[] = [
  { mode: 'solo', label: 'Solo', maxPlayers: 1 },
  { mode: 'coop', label: 'Co-op', maxPlayers: COOP_MAX_PLAYERS },
]
