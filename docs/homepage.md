# Homepage

### Objectives

- Choose between **Solo** (1 player) and **Co-op** (up to 4 players).
- Let the player move an astronaut around the homepage map.
- Raise, lower or mute the background music from a collapsible button.

### Scope

Includes the scene, the controllable character, the mode menu, the music control and the browser tab icon. It does **not** include gameplay: after choosing a mode, `App` mounts `PlayerSandboxView` (the player test scene) with a "Back to home" button. The chosen mode is not used by the sandbox yet, except that **Solo** fires a test hazard warning (see `docs/hazard_alert.md`).

## 1. Architecture

```text
public/
└── favicon.svg                 # Tab icon: the junior astronaut
src/
├── App.tsx                     # Selected mode state, app-wide music and hazard alert
├── style.css                   # Global base styles + mission screen
├── ui/
│   ├── theme.css               # JAM palette tokens and font (.home-screen, .mission-screen)
│   └── chunkyButton.css        # Shared .chunky-button / .chunky-button--icon
├── audio/
│   ├── BackgroundMusic.ts      # Procedural music engine (Web Audio API)
│   └── useBackgroundMusic.ts   # Hook: volume, mute and audio unlock
└── home/
    ├── HomeScreen.tsx          # Screen composition (UI overlay)
    ├── HomeScreen.css          # Layout, logo and mode menu styles
    ├── MarsHomeScene.tsx       # Renderer, camera, input and animation loop
    ├── MusicVolumeControl.tsx  # Collapsible music button
    ├── MusicVolumeControl.css  # Music button and panel styles
    ├── gameMode.ts             # GameMode type and menu options
    └── scene/
        └── marsProps.ts        # Low-poly builders, palette and walkable tiles
```

- `useBackgroundMusic` is used in `App` so the music keeps playing across screens.
- Each component imports its own stylesheet. Components that customize `.chunky-button` import `ui/chunkyButton.css` before their own CSS so their rules win the cascade (e.g. the 48px round music toggle over the 40px `--icon` default).
- `marsProps.ts` reuses `createCrossCorridor` and `createStraightCorridorSegment` from `src/assets/SpaceCorridor.tsx` for the base.
- The controllable astronaut is the shared game player: `Player` and `AstronautModel` from `src/game/player/` and `InputController` from `src/game/input/`. The homepage has no movement code of its own.
- Terrain, base and characters share one grid with tile centers on integer coordinates.

## 2. Implementation Details

| Component / module            | Responsibility                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HomeScreen`                  | Logo, mode buttons and music control on top of the scene.                                                                                                                                                                                                                                          |
| `MarsHomeScene`               | Mounts Three.js, fits the orthographic camera (its frustum is shifted by `SCENE_DOWN_SHIFT` so the base sits centered between the title and the mode buttons), feeds `InputController` directions to `Player.update` every frame, animates the rover and companion, releases resources on unmount. |
| `Player` (shared, unmodified) | Continuous 4-direction movement with acceleration, turning and a procedural walk/idle animation. The homepage passes its own `HOME_PLAYER_TUNING`.                                                                                                                                                 |
| `canPlayerStandAt`            | Every corner of the player's footprint (`PLAYER_FOOTPRINT_HALF_SIZE`) must be on a walkable tile that the companion doesn't occupy.                                                                                                                                                                |
| `keepPlayerOnFreeGround`      | Runs after each `Player.update`: if the new position is blocked, undoes the move on one axis (slide) or both.                                                                                                                                                                                      |
| `isMarsTileWalkable`          | Tile is on the flat plain and outside the base.                                                                                                                                                                                                                                                    |
| `MusicVolumeControl`          | Round music-note button; clicking it expands the panel (mute / − / 10-level bar / + / percentage). `Escape` closes it.                                                                                                                                                                             |
| `useBackgroundMusic`          | Returns `{ volume, isMuted, setVolume, toggleMute }`. Starts audio on the first `pointerdown`/`keydown`.                                                                                                                                                                                           |
| `BackgroundMusic`             | Generates a pad (Am–F–C–G) and an arpeggio with oscillators; `start`, `setVolume`, `dispose`. Steps missed while the tab was throttled are skipped, not played at once.                                                                                                                                                                                                      |

## 3. Business Logic

### Character movement

- **Keyboard:** WASD or arrow keys. The character walks while a key is held and slows to a stop when it is released. With several keys held, the last one pressed wins (no diagonals).
- Clicking or tapping the map does not move the character.
- Standing still, it plays the shared model's breathing idle.
- It cannot leave the flat plain, enter the base or step onto the jumping companion's tile. When it hits an obstacle it slides along it instead of stopping. The rover is decorative and does not collide.
- Collision lives in the homepage, not in `Player`. `Player` keeps its velocity while blocked, so the character keeps its walk animation while pushing against an obstacle.
- Both astronauts use `AstronautModel` scaled by `HOME_ASTRONAUT_SCALE` (0.45) so they fit the 1-unit tiles. The stride rate is divided by the same scale so the steps match the shorter legs.

### Music

- Volume is normalized 0–1, default `0.5`, in steps of `0.1`.
- Setting the volume to 0 mutes; unmuting at volume 0 restores the default value.
- When muted, the collapsed button shows a diagonal slash.

### Modes

- Solo: 1 player. Co-op: up to 4 players (stated in each button's accessible label).
- Picking **Solo** also sends a random hazard code (1–4) to `useHazardAlert` as a temporary test trigger. "Back to home" calls `dismiss()`, which clears the banner and the "in progress" label and stops the alarm.
- Nothing is persisted (no saves, volume or mode).

## 4. Dependencies

| Dependency                  | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `@fontsource/nunito`        | Self-hosted Nunito font files (no request to Google Fonts at runtime). |
| `@fontsource/archivo-black` | Self-hosted Archivo Black for the logo's J and M.                      |
| `@fontsource/fredoka`       | Self-hosted Fredoka 700 for the logo's A.                              |
