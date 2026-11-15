# Co-op Lobby

## 1. Overview

Waiting room shown after picking **Co-op** on the homepage. It shows the crew slots filling up while players join.

### Objectives

- Show the 4 crew slots: filled ones with name, slot number and a "You" tag for the local player; empty ones with an animated "Waiting..." placeholder.
- Show how many players are aboard (`N / 4 aboard`).
- Let the player leave back to the homepage.

### Scope

UI only. There is no host and no start button: the match is meant to begin through a timeout that is not implemented yet. The client does not talk to jam-server yet either, so the crew is just the local player (slot 0) and the lobby stays open until the player presses **Leave**.

## 2. Architecture

```text
src/
├── App.tsx                     # Screen state: home → coop-lobby (and mission for Solo)
├── home/
│   ├── gameMode.ts             # COOP_MAX_PLAYERS (4)
│   ├── MarsHomeScene.tsx/.css  # Reused as the lobby background
│   └── MusicVolumeControl.tsx  # Reused in the lobby
└── lobby/
    ├── CoopLobbyScreen.tsx     # Lobby screen and its slot cards
    ├── CoopLobbyScreen.css     # Layout, slots, tags, animations
    └── lobbyPlayer.ts          # LobbyPlayer type + LOCAL_LOBBY_PLAYER
```

- `CoopLobbyScreen` is presentational: the crew and the local player id arrive as props, and leaving goes through `onLeave`. A future jam-server connection only has to supply those props.
- `LobbyPlayer` (`id`, `slot`, `name`) mirrors the lobby fields of the protocol's `PlayerState`.
- The `.lobby-screen` root gets the JAM palette tokens from `ui/theme.css`.

## 3. Implementation Details

| Component / module   | Responsibility                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `CoopLobbyScreen`    | Mars scene + header, crew panel (count, slots, Leave button) and the music control.                    |
| `LobbySlot`          | One slot card, filled or empty. The slot number (`P1`–`P4`) keeps slots distinguishable without color. |
| `AstronautAvatar`    | Helmet SVG; the visor uses the slot color (`--slot-color`).                                            |
| `LOCAL_LOBBY_PLAYER` | The local player used as the whole crew until the server integration exists.                           |

## 4. Business Logic

1. Homepage → **Co-op** → `App` switches to `coop-lobby`.
2. Slots are rendered for `maxPlayers` seats; each one shows the player whose `slot` matches, or the empty state.
3. **Leave** → homepage.

- Animations (panel entrance, slot join pop, pulsing empty avatars, bouncing dots) are disabled with `prefers-reduced-motion`.

## 5. API and Integrations

None yet. The pinned jam-server commit does not implement lobby messages (`player.hello`, `match.join`, `match.state`).

## 6. Known Limitations

- No networking: other players can never appear in the lobby.
- The start timeout is not implemented, so the lobby never leads to a match.
