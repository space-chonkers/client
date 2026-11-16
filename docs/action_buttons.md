# Action buttons

`ActionButtons` displays Build, Collect, and Fix in a compact bottom-left panel.
Build uses a click or `E` / `Space`; Collect uses a click or `Q` / `C`; Fix uses
a click or `F`. Shortcuts are ignored in text inputs, repeated key events, and
when an action is disabled.

`PlayerSandboxView` sends build and collect intents through `useGameSession`.
The server validates the build target, stash proximity, and available resources.
Collect is enabled when the authoritative player position is on the stash cell
or within 0.7 grid units of its center. Successful actions display a brief
confirmation, and the resource HUD reads pool and stash values from server
snapshots. The mission does not simulate resource changes locally.

Fix is enabled when a persistent phenomenon is active and the authoritative
player is near the stash. It sends `phenomenon.fix`; the server checks the fix
cost and applies the result.

## Components

- `ActionButtons.tsx` renders the three actions, key hints, and availability state.
- `actionButtons.css` uses the shared HUD panel tokens and styles the flat rows.
- `PlayerSandboxView.tsx` derives availability and sends action intents.
- `ResourceBar.tsx` displays resource pools; the stash balance is shown below the
  mission minimap.

Unavailable actions remain visible but disabled. Build currently stays enabled
and lets the server return a friendly validation error; Collect is disabled
until the local player is near the stash, and Fix is disabled unless a
persistent phenomenon is active there.

## Validation

```bash
bun run build
bun test ./tests
```
