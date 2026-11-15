# Simulated Resource Bar (`ResourceBar.tsx`)

## 1. Overview

`ResourceBar` renders a top-left HUD panel displaying the 5 shared mission resource and status indicators (`oxygen`, `water`, `energy`, `food`, and `radiation`). Each row displays the resource icon, a percentage progress bar filled with the resource's Tritanopia-safe color (`ICON_COLORS`), and its numeric value. By default, it displays simulated baseline values so the HUD can be previewed immediately in the 3D sandbox, while accepting optional live values from game state.

### Objectives
- Display the 5 pool/status resources (`oxygen`, `water`, `energy`, `food`, `radiation`) in a vertical top-left panel using `<GameIcon />`.
- Render a color-coded percentage bar (`0%` to `100%` against `MAX_RESOURCE_CAPACITY = 100`) and numeric balance for each resource row.
- Provide default simulated values (`DEFAULT_SIMULATED_RESOURCES`) with support for partial or full value overrides via props.
- Preserve full keyboard and mouse interaction with the underlying 3D canvas (`pointer-events: none` on the overlay container).

### Scope
- **Included:** `ResourceBar.tsx`, `resourceBar.css`, and mounting inside `PlayerSandboxView.tsx`.
- **Excluded:** Action/construction buttons (`build`, `expand`, `collect`), navigation controls, secondary screens, and WebSocket/RabbitMQ state synchronization.

## 2. Architecture

### Directory Structure

```text
src/
├── PlayerSandboxView.tsx
└── ui/
    ├── ResourceBar.tsx
    ├── resourceBar.css
    └── icons/
        └── GameIcons.tsx
```

### Architectural Responsibilities
- `ResourceBar.tsx` is a pure presentational HUD component that merges `DEFAULT_SIMULATED_RESOURCES` with optional `values` props, computes clamped fill percentages against `MAX_RESOURCE_CAPACITY`, and renders each row with `<GameIcon />`, a progress track/fill, and the numeric value.
- `resourceBar.css` positions the HUD panel in the top-left corner of `.player-sandbox` without intercepting 3D canvas pointer events outside the panel itself.
- `PlayerSandboxView.tsx` mounts `<ResourceBar />` alongside the Three.js `.player-sandbox__canvas` container.

## 3. Implementation Details

### Components

| Component | Responsibility |
|---|---|
| `ResourceBar` | Renders the top-left vertical HUD panel with 5 resource rows (`oxygen`, `water`, `energy`, `food`, `radiation`), each containing the icon, a progress bar colored via `ICON_COLORS[type]`, and the numeric value. |
| `PlayerSandboxView` | Hosts `<ResourceBar />` above the Three.js player sandbox canvas. |

### Utilities

| Constant | Responsibility |
|---|---|
| `MAX_RESOURCE_CAPACITY` | Maximum shared pool capacity per resource (`100`). |
| `DEFAULT_SIMULATED_RESOURCES` | Default simulated resource numbers (`{ oxygen: 85, water: 70, energy: 90, food: 60, radiation: 12 }`). |

### Types and Interfaces

- `ResourceBarValues`:
  ```ts
  export interface ResourceBarValues {
    oxygen: number
    water: number
    energy: number
    food: number
    radiation: number
  }
  ```
- `ResourceBarProps`:
  - `values?: Partial<ResourceBarValues>`
  - `iconSize?: number` (defaults to `28`)
  - `className?: string`

## 4. Business Logic

### Main Workflow
1. `<PlayerSandboxView />` renders `<ResourceBar />` above the 3D canvas container.
2. `<ResourceBar />` merges `DEFAULT_SIMULATED_RESOURCES` with any provided `values` prop.
3. For each resource in `['oxygen', 'water', 'energy', 'food', 'radiation']`, the component calculates `percentage = Math.min(100, Math.max(0, (value / MAX_RESOURCE_CAPACITY) * 100))`.
4. Each `.resource-bar__row` renders `<GameIcon type={type} size={iconSize} />`, `.resource-bar__track` with `.resource-bar__fill` (`width: ${percentage}%`, `backgroundColor: ICON_COLORS[type]`), and `.resource-bar__value`.

### Business Rules
- Omitted resource keys automatically fall back to `DEFAULT_SIMULATED_RESOURCES`.
- Fill percentages are clamped to `[0, 100]` relative to `MAX_RESOURCE_CAPACITY` (`100`).
- The outer `.resource-bar-overlay` uses `pointer-events: none` so mouse and keyboard controls in `PlayerSandbox` remain unobstructed.

## 5. Data Management

### Data Sources
- `DEFAULT_SIMULATED_RESOURCES`, `MAX_RESOURCE_CAPACITY`, and optional `values` prop passed by parent components.

### State Management
- Stateless component; derived display values and percentages are computed synchronously on render.

## 6. API and Integrations

This feature does not use external APIs or network integrations.

## 7. Configuration and Environment Variables

No environment variables are required.

## 8. Error Handling

| Scenario | Expected Behavior |
|---|---|
| `values` prop is omitted or partial | Missing keys fall back to `DEFAULT_SIMULATED_RESOURCES`. |
| Resource value outside `0..100` | Progress bar fill width is clamped between `0%` and `100%`. |

## 9. Security Considerations

Only typed numeric resource values and static icon types are rendered.

## 10. Performance Considerations

- Lightweight stateless render using existing bundled PNG icons and CSS transitions (`width 180ms ease-out`).

## 11. Testing

### Validation Commands

```bash
# TypeScript compilation and production bundle verification
bun run build
```

## 12. Dependencies

| Dependency | Purpose |
|---|---|
| `react` | Component rendering |
| `./icons/GameIcons` | `<GameIcon />`, `ICON_COLORS`, and `PoolResourceIconType` |

## 13. Known Limitations

- Displays static/simulated values until connected to the live `SharedEconomy` / match state stream.

## 14. Future Improvements

- Connect `<ResourceBar values={livePoolBalances} />` to real-time server tick updates and highlight critical low-balance warnings.

## 15. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-14 | 1.0.0 | Initial implementation of top-left `<ResourceBar />` panel with percentage bars |
