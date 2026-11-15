# Hazard Alert Banner

## 1. Overview

On every tick the server sends a hazard code. A non-zero code shows a warning banner and plays a siren once, when the banner appears. Closing the banner with **X** replaces it with a small "<Hazard> in progress" label in the top-right corner, which stays until the hazard is resolved.

| Code | Hazard | Icon |
|---|---|---|
| `0` | Nothing happens | — |
| `1` | Solar Storm | `radiation` |
| `2` | Water Leak | `water` |
| `3` | Oxygen Loss | `oxygen` |
| `4` | Rotten Food | `food` |

### Scope

- **Included:** code → hazard mapping, banner UI, "in progress" label, alarm sound, and a temporary test trigger on the **Solo** button.
- **Excluded:** the hazards' effects on the game (resources, damage, etc.), how a hazard gets solved, and the real server-tick connection.

## 2. Architecture

```text
src/
├── App.tsx                        # Owns useHazardAlert; renders label + banner on the mission screen
├── audio/
│   └── AlarmSound.ts              # Procedural warning siren (Web Audio API)
├── game/
│   └── hazards/
│       ├── hazardEvents.ts        # Codes, hazard definitions, getHazardByCode
│       └── useHazardAlert.ts      # Tick codes → warning banner, ongoing hazard, alarm
└── ui/
    ├── HazardAlertBanner.tsx      # Warning banner with X button
    ├── hazardAlertBanner.css
    ├── HazardOngoingLabel.tsx     # Top-right "in progress" label
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
| `HazardOngoingLabel` | Prop `hazard`. Top-right pill: icon + "<Hazard> in progress". |
| `AlarmSound` | `play()` (siren: 6 low-passed square beeps alternating 880 / 660 Hz, ~1.5 s), `stop()`. |

## 4. Business Logic

1. Each tick, call `receiveHazardCode(code)`.
2. `0` is ignored. Unknown codes are ignored with a `console.warn`.
3. A valid code shows the banner (`warningHazard`) and plays the alarm. This is the only moment the alarm plays.
4. The server may repeat the code on later ticks: a code for the hazard already in the banner, or already in progress, is ignored (no new banner, no new alarm).
5. A **different** hazard replaces the banner and plays the alarm again.
6. The banner has no timer: it stays until **X** is clicked. `closeWarning()` stops the alarm, hides the banner and makes that hazard the `ongoingHazard`, shown by `HazardOngoingLabel`.
7. `resolveOngoingHazard()` removes the label. Nothing calls it yet: it is the hook for the future resolution logic.
8. `dismiss()` (used by "Back to home") clears the banner and the ongoing hazard and stops the alarm.

### UI rules

- The banner keeps the cream panel. The top strip and the icon rings use the hazard's icon color (`ICON_COLORS[hazard.icon]`, passed as `--hazard-accent`). Text stays ink so it is readable with every color.
- Screen readers: the banner's title and description are in a `role="alert"` region; the X button is labelled "Close <Hazard> warning"; the "in progress" label is a `role="status"`.
- Banner position: top center; below 900 px wide it moves to the bottom so it doesn't cover the resource bar and the back button.
- `prefers-reduced-motion` disables the animations.

## 5. Testing

Click **Solo** on the homepage: `App` sends a random code (1–4) to `receiveHazardCode`, as if it came from a server tick. Close the banner with **X** to see the "in progress" label, which stays until "Back to home". This trigger lives in `App.startMission` and should be removed once real ticks are connected.

```bash
bun run build   # TypeScript check + production build
```

## 6. Known Limitations

- Not yet connected to the server tick stream; only the Solo test trigger feeds codes.
- No resolution logic yet, so the "in progress" label only goes away with "Back to home".
- The alarm volume is fixed and is not affected by the music volume control or mute.
- Only one banner and one ongoing hazard at a time; a new one replaces the current one (no queue).

## 7. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-15 | 1.0.0 | Initial banner, countdown, alarm and Solo test trigger |
| 2026-11-15 | 1.1.0 | X button + compact countdown, countdown removed from the full banner, final alarm at 3 s, "in progress" label |
| 2026-11-15 | 1.2.0 | Removed "Warning · Incoming hazard" label, siren alarm, 10 s countdown, alarm only when the banner first appears |
| 2026-11-15 | 1.3.0 | Removed the countdown, progress bar and compact view; closing the banner shows the "in progress" label |
| 2026-11-15 | 1.4.0 | `AlarmSound` uses the shared `soundManager`; `dispose()` removed in favor of `stop()` |
