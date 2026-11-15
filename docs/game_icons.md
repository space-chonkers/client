# Game Icons (`GameIcons.tsx`)

## 1. Overview

`GameIcons` provides the shared 2D iconography system for the game client, covering the 5 shared-pool resource/status indicators (`oxygen`, `water`, `energy`, `food`, `radiation`) and the 3 construction/action events (`build`, `expand`, `collect`).

### Objectives
- Expose resolved asset URLs (`ICON_PNG_URLS`) for the 8 transparent `.png` icons so they can be used in both React UI components and Three.js textures/sprites.
- Define a Tritanopia-friendly color map (`ICON_COLORS`) paired with distinct icon silhouettes.
- Provide a lightweight `<GameIcon />` React component that renders an icon and an optional numeric or string `amount`.

### Scope
- **Included:** Icon type unions, `ICON_PNG_URLS`, `ICON_COLORS`, `<GameIcon />`, and the 8 transparent `.png` files under `src/ui/icons/`.
- **Excluded:** HUD layout containers (handled by `ResourceBar.tsx`) and action button click handlers.

## 2. Architecture

### Directory Structure

```text
src/
└── ui/
    └── icons/
        ├── GameIcons.tsx
        ├── build.png
        ├── collect.png
        ├── energy.png
        ├── expand.png
        ├── food.png
        ├── oxygen.png
        ├── radiation.png
        └── water.png
```

### Architectural Responsibilities
- Serves as the single source of truth for icon types, asset URLs, and Tritanopia-safe accent colors across UI overlays and 3D views.

## 3. Implementation Details

### Components

| Component | Responsibility |
|---|---|
| `GameIcon` | Renders a transparent PNG icon (`<img>`) at a configurable pixel `size` (default `48`) with an optional adjacent `amount` label. |

### Utilities

| Constant | Responsibility |
|---|---|
| `ICON_PNG_URLS` | Maps each `GameIconType` to its bundler-resolved URL via `new URL('./<name>.png', import.meta.url).href`. |
| `ICON_COLORS` | Maps each `GameIconType` to its Tritanopia-safe hex color string. |

### Types and Interfaces

- `PoolResourceIconType`: `'oxygen' | 'water' | 'energy' | 'food' | 'radiation'`
- `ConstructionEventIconType`: `'build' | 'expand' | 'collect'`
- `GameIconType`: `PoolResourceIconType | ConstructionEventIconType`
- `GameIconProps`:
  - `type: GameIconType`
  - `size?: number` (defaults to `48`)
  - `amount?: number | string`
  - `className?: string`

## 4. Business Logic

### Main Workflow
1. Caller passes `type` (and optional `size`, `amount`, `className`) to `<GameIcon />`.
2. Component resolves the PNG URL from `ICON_PNG_URLS[type]`.
3. If `amount !== undefined`, renders a bold numeric/text readout next to the icon image (`0` is rendered properly because the check is strict against `undefined`).

### Business Rules
- Every resource and action icon pairs a distinct silhouette with a Tritanopia-safe color in `ICON_COLORS`:
  - `oxygen`: `#b3f7ff`
  - `water`: `#1971ff`
  - `energy`: `#facc15`
  - `food`: `#fb923c`
  - `radiation`: `#ff4d6d`
  - `build`: `#e2e8f0`
  - `expand`: `#2ec4b6`
  - `collect`: `#7dd3fc`

## 5. Data Management

### Data Sources
- Local static `.png` assets bundled via Vite `import.meta.url` and props passed by parent components.

### State Management
- Stateless presentational component (`React.FC<GameIconProps>`).

## 6. API and Integrations

This feature does not use external APIs or network integrations.

## 7. Configuration and Environment Variables

No environment variables are required.

## 8. Error Handling

| Scenario | Expected Behavior |
|---|---|
| `amount` is `0` | Rendered as `0` because the check uses `amount !== undefined`. |
| `amount` is omitted | Only the `<img>` element is rendered without an extra text node. |

## 9. Security Considerations

All icon URLs are statically resolved from local repository assets; no untrusted URLs are injected.

## 10. Performance Considerations

- Uses pre-rendered, lightweight transparent `.png` assets (`436 B` to `2 KB` each) with `userSelect: 'none'` to prevent accidental drag/selection during gameplay.

## 11. Testing

### Validation Commands

```bash
# TypeScript compilation and production bundle verification
bun run build
```

## 12. Dependencies

| Dependency | Purpose |
|---|---|
| `react` | Rendering the `<GameIcon />` component |

## 13. Known Limitations

- None known.

## 14. Future Improvements

- Optional animated pulse or warning badge state when a resource approaches zero or radiation spikes.

## 15. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-14 | 1.0.0 | Initial documentation of `GameIcons.tsx` and PNG icon assets |
