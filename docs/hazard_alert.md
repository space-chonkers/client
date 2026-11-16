# Hazard Alert Banner

## 1. Overview

On every tick the server sends a hazard code. A non-zero code shows a warning banner and plays a siren once, when the banner appears. Closing the banner with **X** replaces it with a small "<Hazard> in progress" label in the top-right corner, which stays until the hazard is resolved. Only one hazard can be active at a time; codes received meanwhile are ignored.

| Code | Hazard | Icon |
|---|---|---|
| `0` | Nothing happens | — |
| `1` | Solar Storm | `radiation` |
| `2` | Water Leak | `water` |
| `3` | Oxygen Loss | `oxygen` |
| `4` | Rotten Food | `food` |

### Scope

- **Included:** code → hazard mapping, banner UI, "in progress" label, alarm sound, and a temporary simulated tick stream for **Solo** missions.
- **Excluded:** the hazards' effects on the game (resources, damage, etc.), how a hazard gets solved, and the real server-tick connection.

## 2. Architecture

```text
src/
├── App.tsx                        # Owns useHazardAlert, enables simulated ticks in Solo, renders label + banner
├── audio/
│   └── AlarmSound.ts              # Procedural warning siren (Web Audio API)
├── game/
│   └── hazards/
│       ├── hazardEvents.ts        # Codes, hazard definitions, getHazardByCode
│       ├── useHazardAlert.ts      # Tick codes → warning banner, ongoing hazard, alarm
│       └── useSimulatedHazardTicks.ts # TEMPORARY fake server ticks (Solo only)
└── ui/
    ├── HazardAlertBanner.tsx      # Warning banner with X button
    ├── hazardAlertBanner.css
    ├── HazardOngoingLabel.tsx     # "In progress" label (stacked under the minimap)
    └── hazardOngoingLabel.css
```

- `hazardEvents.ts` is the single source of truth for codes and texts.
- `useHazardAlert` holds the hazard state; the UI components are purely presentational.
- `AlarmSound` builds on `audio/soundManager.ts` like `BackgroundMusic`: it plays through the shared `AudioContext`, and `useHazardAlert` calls `stop()` on unmount.

## 3. Implementation Details

| Module | Responsibility |
|---|---|
| `getHazardByCode(code)` | Returns the `HazardDefinition` for codes 1–4, `null` for 0 or unknown codes. |
| `useHazardAlert()` | Returns `{ warningHazard, ongoingHazard, receiveHazardCode, closeWarning, resolveOngoingHazard, dismiss }`. Both hazards are a `HazardDefinition` or `null`. |
| `HazardAlertBanner` | Props `hazard` and `onClose`. Top accent strip, icon badge, title, description and X button. |
| `HazardOngoingLabel` | Prop `hazard`. Pill: icon + "<Hazard> in progress". It has no position of its own: `App` passes it to `PlayerSandboxView` as `topRightStatus`, which stacks it under the mission minimap in the top-right HUD column. |
| `AlarmSound` | `play()` (siren: 6 low-passed square beeps alternating 880 / 660 Hz, ~1.5 s), `stop()`. |
| `useSimulatedHazardTicks(enabled, onHazardCode)` | Temporary. While `enabled`, calls `onHazardCode` every 5 s with `0` (70%) or a random hazard code 1–4 (30%). Clears its interval when disabled or unmounted. |

## 4. Business Logic

1. Each tick, call `receiveHazardCode(code)`.
2. `0` is ignored. Unknown codes are ignored with a `console.warn`.
3. A valid code shows the banner (`warningHazard`) and plays the alarm. This is the only moment the alarm plays.
4. Hazards never stack: only one can be active at a time. While a hazard is in the banner or in progress, every other code is ignored, whether it is a repeat of the same hazard or a different one (no new banner, no new alarm).
5. A new hazard is accepted only once the current one is resolved (`resolveOngoingHazard()`) or cleared (`dismiss()`).
6. The banner has no timer: it stays until **X** is clicked. `closeWarning()` stops the alarm, hides the banner and makes that hazard the `ongoingHazard`, shown by `HazardOngoingLabel`.
7. `resolveOngoingHazard()` removes the label. Nothing calls it yet: it is the hook for the future resolution logic.
8. `dismiss()` (called by `App`'s `goHome`, currently only reachable from the co-op lobby's leave action) clears the banner and the ongoing hazard and stops the alarm.

### UI rules

- The banner shares the HUD panel tokens (`--hud-panel-*`, `--hud-text` in `theme.css`) with the other HUD panels. A thin 4 px top strip and the uppercase title use the hazard's icon color (`ICON_COLORS[hazard.icon]`, passed as `--hazard-accent`); the description stays light text. The 40 px icon wobbles, and the X is a flat button with a light hover highlight (no `.chunky-button`).
- The "in progress" label shares the HUD panel tokens (`--hud-panel-*`, `--hud-text` in `theme.css`) with `ResourceBar` and `ActionButtons`: translucent dark panel with blur, slate border, soft shadow, 28 px icon. The hazard's title is shown in its icon color (`--hazard-accent`).
- Screen readers: the banner's title and description are in a `role="alert"` region; the X button is labelled "Close <Hazard> warning"; the "in progress" label is a `role="status"`.
- Banner position: top center; below 900 px wide it moves to the bottom so it doesn't cover the resource bar and the back button.
- The "in progress" label stretches to the top-right HUD column, so it is always exactly as wide as the mission minimap (272 px above 900 px; see `docs/mission_minimap.md`).
- Above 900 px the banner is `min(560px, 100% − 2 × 304px)` wide so it fits between the ResourceBar and the 272 px mission minimap (304 px = 16 px gutter + 272 px minimap + 16 px gap). At 900 px and below it is `min(560px, 100% − 32px)` at the bottom (see `docs/mission_minimap.md`).
- `prefers-reduced-motion` disables the animations.

## 5. Testing

Click **Solo** on the homepage: `App` enables `useSimulatedHazardTicks`, which feeds `receiveHazardCode` a code every 5 s as if it came from the server (mostly `0`, sometimes a hazard). Close the banner with **X** to see the "in progress" label. Later ticks are ignored while that hazard is active; since nothing resolves it yet, only one hazard appears per mission. The mission screen has no "Back to home" button; reload the page to start over.

Tune `SIMULATED_TICK_INTERVAL_MS` and `SIMULATED_HAZARD_CHANCE` in `useSimulatedHazardTicks.ts` to test faster or slower.

```bash
bun run build   # TypeScript check + production build
```

### Connecting the real server

1. Delete `useSimulatedHazardTicks.ts`.
2. In `App.tsx`, replace the `useSimulatedHazardTicks(...)` call with the server subscription, passing each tick's code to `hazardAlert.receiveHazardCode`.

`useHazardAlert` needs no changes: it already handles `0`, unknown codes, repeats and the one-hazard-at-a-time rule.

## 6. Known Limitations

- Not yet connected to the server tick stream; only the simulated Solo ticks feed codes.
- No resolution logic yet, so the "in progress" label stays for the rest of the mission.
- The alarm volume is fixed and is not affected by the music volume control or mute.
- Only one hazard at a time; codes received while one is active are dropped, not queued.

## 7. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-15 | 1.0.0 | Initial banner, countdown, alarm and Solo test trigger |
| 2026-11-15 | 1.1.0 | X button + compact countdown, countdown removed from the full banner, final alarm at 3 s, "in progress" label |
| 2026-11-15 | 1.2.0 | Removed "Warning · Incoming hazard" label, siren alarm, 10 s countdown, alarm only when the banner first appears |
| 2026-11-15 | 1.3.0 | Removed the countdown, progress bar and compact view; closing the banner shows the "in progress" label |
| 2026-11-15 | 1.4.0 | `AlarmSound` uses the shared `soundManager`; `dispose()` removed in favor of `stop()` |
| 2026-11-15 | 1.5.0 | One-shot Solo trigger replaced by `useSimulatedHazardTicks` (periodic fake server ticks) |
| 2026-11-15 | 1.6.0 | Hazards no longer stack: codes are ignored while a hazard is in the banner or in progress |
