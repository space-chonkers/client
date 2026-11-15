/** Game modes offered on the homepage. */
export type GameMode = 'solo' | 'coop'

export interface GameModeOption {
  mode: GameMode
  /** Text shown on the mode button. */
  label: string
  /** Shown in the button's accessible label ("up to N players"). */
  maxPlayers: number
}

/** Mode buttons, in display order. */
export const GAME_MODE_OPTIONS: readonly GameModeOption[] = [
  { mode: 'solo', label: 'Solo', maxPlayers: 1 },
  { mode: 'coop', label: 'Co-op', maxPlayers: 4 },
]
