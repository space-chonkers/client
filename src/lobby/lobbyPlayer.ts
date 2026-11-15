/**
 * A crew member in the co-op lobby. Mirrors the lobby-relevant fields of
 * jam-server's `PlayerState` (protocol v1) so server data can be passed as is.
 */
export interface LobbyPlayer {
  /** Stable for the life of the match. */
  id: string
  /** 0-based seat in the crew; decides the slot color. */
  slot: number
  /** Display name. */
  name: string
}

/**
 * The only crew member until the client joins jam-server lobbies: the local
 * player, sitting in the first slot.
 */
export const LOCAL_LOBBY_PLAYER: LobbyPlayer = {
  id: 'local-player',
  slot: 0,
  name: 'Astronaut 1',
}
