# Hazard alerts

The mission HUD maps server phenomena to a warning banner and, for persistent
phenomena, an in-progress label below the minimap. The server's reliable
`match.phenomenon` events drive start, instant, and resolve transitions; current
match state/frames also seed the alert when a mission is already in progress.

| Code | Phenomenon | Behavior |
|---|---|---|
| `1` | Solar storm | Persistent; clear it at the stash with energy. |
| `2` | Water leak | Persistent; clear it at the stash with energy. |
| `3` | Oxygen loss | Persistent; clear it at the stash with energy. |
| `4` | Rotten food | Instant resource loss; closing the banner does not leave an in-progress label. |

## Behavior

- One hazard at a time. Repeats and other hazard events are ignored while an
  alert or in-progress hazard is visible.
- Persistent hazards show a warning banner and sound the alarm once. Closing the
  warning stops the alarm and moves the hazard to the in-progress label. The
  server's `resolved` event clears either presentation state.
- Instant hazards show the warning and alarm, but closing the warning dismisses
  it without creating an in-progress label.
- Unknown server codes are ignored with a console warning; code `0` means no
  hazard.
- Leaving the match clears the alert and stops the alarm.

`useHazardAlert` owns the state and alarm lifecycle. `App.tsx` feeds it server
phenomenon events and active state; `HazardAlertBanner` and
`HazardOngoingLabel` are presentational components. Hazard effects and resolution
remain server-authoritative.

## Validation
```bash
bun run build
bun test ./tests
```
