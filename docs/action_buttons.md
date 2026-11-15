# Action Buttons (`ActionButtons.tsx`)

## 1. Overview

`ActionButtons` renders the two in-game actions, `Build` and `Collect`, as a vertical panel in the bottom-left corner of the HUD, styled like the `ResourceBar`. Each action can be triggered by clicking its button or with a keyboard shortcut. The component only reports intents; it holds no resource logic. In the player sandbox, a temporary simulator updates the values shown in the `ResourceBar`.

### Objectives
- Provide `Build` (`E` / `Space`) on top and `Collect` (`Q` / `C`) below, using `<GameIcon />` and the existing `.chunky-button` base.
- Support keyboard shortcuts (`E` / `Space` for Build, `Q` / `C` for Collect) through a single `window` listener.
- Let a click on `Build` also reach scene code that listens for the build key.
- Dim (never hide) unavailable actions through `buildEnabled` / `collectEnabled`.

### Scope
- **Included:** `ActionButtons.tsx`, `actionButtons.css`, the temporary `simulatedResources.ts`, and its wiring in `PlayerSandboxView.tsx`.
- **Excluded:** availability rules, real corridor placement rules, real Stash/SharedPool transfers, and server synchronization. The `expand` icon asset is kept in `GameIcons.tsx` but is not rendered.

## 2. Architecture

### Directory Structure

```text
src/
├── PlayerSandboxView.tsx
└── ui/
    ├── ActionButtons.tsx
    ├── actionButtons.css
    ├── simulatedResources.ts   (TEMPORARY)
    ├── chunkyButton.css
    ├── ResourceBar.tsx
    └── icons/
        └── GameIcons.tsx
```

### Architectural Responsibilities
- `ActionButtons.tsx` is presentational. It exposes `onBuild` / `onCollect` callbacks and owns the keyboard listener.
- `actionButtons.css` positions the overlay and restyles `.chunky-button` to match the ResourceBar panel.
- `simulatedResources.ts` is a TEMPORARY simulator that must be replaced by authoritative server state once the backend is connected.
- `PlayerSandboxView.tsx` owns the resource state and passes it to `<ResourceBar values={resources} />`.

## 3. Implementation Details

### Components

| Component | Responsibility |
|---|---|
| `ActionButtons` | Renders the Build and Collect buttons (icon, label, key hint), handles shortcuts and availability states. |
| `PlayerSandboxView` | Mounts `ResourceBar` and `ActionButtons` and applies the simulated costs and yields. |

### Utilities

| Utility | Responsibility |
|---|---|
| `shouldIgnoreKeyEvent` | Skips key events from text inputs and editable elements, and `Space` from a focused button. |
| `applyResourceDelta` (`simulatedResources.ts`) | Adds or subtracts a partial resource delta, clamping to `0..MAX_RESOURCE_CAPACITY`. |
| `SIMULATED_BUILD_COST` | Placeholder `{ energy: 5, oxygen: 2 }`, deducted per build. |
| `SIMULATED_COLLECT_YIELD` | Placeholder `{ oxygen: 5, water: 5, energy: 5, food: 5 }`, added per collect (radiation is unchanged). |

### Types and Interfaces

```ts
export interface ActionButtonsProps {
  onBuild?: () => void
  onCollect?: () => void
  buildEnabled?: boolean   // defaults to true
  collectEnabled?: boolean // defaults to true
}
```

### Styling
- The `.action-buttons` panel reuses the ResourceBar look: `rgba(16, 22, 34, 0.88)` background, `1px solid #334155` border, rounded corners, soft shadow and `backdrop-filter: blur(6px)`.
- The cream `.chunky-button` fill is replaced by a dark slate fill so the icon colors stay readable. Each button has a 3px bottom accent border in its icon color (`ICON_COLORS[type]`, passed as the `--action-accent` CSS variable).
- Hover lifts the button, pressed pushes it down, and `:focus-visible` shows a light outline.
- The overlay uses `pointer-events: none`; `.action-buttons` and its buttons use `pointer-events: auto`.

## 4. Business Logic

### Main Workflow

1. The player clicks `Build` / `Collect` or presses `E` / `Space` / `Q` / `C`.
2. `ActionButtons` calls `onBuild` or `onCollect` (only if the action is enabled).
3. `PlayerSandboxView` updates `resources` with the simulator.
4. `ResourceBar` re-renders with the new values.

### Business Rules
- Clicking `Build` calls `onBuild` and dispatches a synthetic `KeyboardEvent('keydown', { code: 'KeyE', bubbles: true })` on `window`, so scene code listening for `E` (e.g. corridor placement) also reacts.
- The shortcut listener ignores untrusted (synthetic) events, so that click does not call `onBuild` twice.
- Held keys (`event.repeat`) are ignored, so one key press equals one action.
- Movement keys (WASD / arrows) are not handled.
- A disabled action has the `disabled` and `aria-disabled` attributes, 0.4 opacity, a `not-allowed` cursor, no hover/pressed effect, no click, and an ignored shortcut. Its label stays readable, and its `aria-label` / `title` say it is unavailable.
- Buttons blur after a click so a later `Space` press does not trigger a second action.
- Simulated resources never drop below `0` or exceed `MAX_RESOURCE_CAPACITY` (`100`).

## 5. Data Management

### Data Sources
- `DEFAULT_SIMULATED_RESOURCES` and `MAX_RESOURCE_CAPACITY` from `ResourceBar.tsx`.
- Placeholder costs and yields from the temporary `simulatedResources.ts`.

### State Management
- `resources` is local React state in `PlayerSandboxView`; `ActionButtons` is stateless.
- `PlayerSandboxView` does not pass `buildEnabled` / `collectEnabled`, so both buttons are always enabled for now.

### Data Flow
`ActionButtons` → `onBuild` / `onCollect` → `setResources` (simulator) → `ResourceBar values`.

## 6. API and Integrations

No external APIs. The only integration is the synthetic `keydown` event on `window` described above.

## 7. Configuration and Environment Variables

No environment variables are required.

## 8. Error Handling

| Scenario | Expected Behavior |
|---|---|
| Callback not provided | The action is a no-op (optional chaining). |
| Action disabled | Button is dimmed and inert; its shortcut is ignored. |
| Key pressed in an input field | Ignored. |
| Simulated resource would go below `0` / above `100` | Clamped. |

## 9. Security Considerations

No user data or credentials are handled. The client only signals intents; the server is meant to stay authoritative over resources.

## 10. Performance Considerations

- One `window` listener, removed on unmount and re-registered only when the callbacks or enabled flags change (the sandbox view passes stable callbacks).

## 11. Testing

### Validation Commands

```bash
# TypeScript compilation and production bundle verification
bun run build
```

## 12. Dependencies

| Dependency | Purpose |
|---|---|
| `react` | Component rendering and effects |
| `./icons/GameIcons` | `<GameIcon />`, `ICON_COLORS` for `build` and `collect` |
| `./chunkyButton.css` | Base button style (restyled in `actionButtons.css`) |
| `./ResourceBar` | Simulated defaults, capacity and values type |

## 13. Known Limitations

- **Not implemented, pending confirmation from the game team:**
  - Stash proximity rule for `Collect`.
  - Valid build cell rule for `Build`.
  - Real build costs and whether the player has enough resources.
  - The client/server contract (intent messages and returned state).
- `buildEnabled` / `collectEnabled` are only wired as props; nothing computes them yet.
- Build and Collect only change simulated values; no real placement or Stash transfer happens.
- A disabled `Build` button does not stop the scene's own `E` / `Space` corridor placement, because that listener lives in `PlayerSandbox.ts`.

## 14. Future Improvements

- Replace `simulatedResources.ts` with authoritative server `resources` snapshots (`match.state` / `match.frame` / `base.build` / `stash.collect`).
- Compute `buildEnabled` / `collectEnabled` client-side from authoritative state once the availability rules are confirmed.

## 15. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-15 | 1.0.0 | Initial implementation of Build and Collect action buttons |
| 2026-11-15 | 1.1.0 | Bottom-left stacked layout, ResourceBar-style panel, availability states, temporary simulator module |
| 2026-11-15 | 1.2.0 | Added `Q` shortcut for Collect and dual keycap hints (`E` / `Space`, `Q` / `C`) |
