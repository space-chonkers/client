# 3D Investigation Sites (`InvestigationSite.tsx` & `InvestigationSites.ts`)

## 1. Overview

`InvestigationSite` and `InvestigationSites` render 3D golden crystal beacons on every pending `investigation` goal cell across the `50×50` map, synchronized with `MissionMinimap` and the authoritative completion rule (`resolveInvestigationProgress`). When a corridor tile covers an investigation cell, the beacon plays a short rise-spin-shrink collection animation and hides.

### Objectives
- Provide a low-poly golden 3D asset matching the golden diamonds on `MissionMinimap`.
- Share geometries and materials across all investigation sites on the map.
- Sync completion state with `CorridorGrid` constructions via `resolveInvestigationProgress`.
- Animate idle bobbing/rotation for pending sites and a `0.4s` collection animation when covered.

### Scope
- **Included:** `src/assets/InvestigationSite.tsx`, `src/game/map/InvestigationSites.ts`, and `PlayerSandbox.ts` integration.
- **Excluded:** WebSocket transport (`base.build` / `match.build`), win-screen modal (`match.ended`), and `MissionMinimap.tsx` internals.

## 2. Architecture

### Directory Structure

```text
src/
├── assets/
│   └── InvestigationSite.tsx
└── game/
    ├── PlayerSandbox.ts
    ├── minimap/
    │   └── missionMap.ts
    └── map/
        └── InvestigationSites.ts
```

### Architectural Responsibilities
- `InvestigationSite.tsx` builds shared Three.js geometries and materials (`pad`, `ring`, `crystal`, `halo`) in `INVESTIGATION_SITE_PALETTE` (`#facc15` gold, `#d97706` amber, `#fff6ef` cream, `#1e293b` pad) and exposes `createInstance()` and `dispose()`.
- `InvestigationSites.ts` places one instance per `investigation` cell, calls `resolveInvestigationProgress` in `syncConstructions()`, and drives idle and collection animations in `update(delta, elapsed)`.
- `PlayerSandbox.ts` mounts `InvestigationSites`, triggers `syncConstructions` from `publishConstructions`, steps `update(delta, elapsed)` in `tick()`, and disposes resources in `dispose()`.

## 3. Implementation Details

### Symbols

| Symbol | Responsibility |
|---|---|
| `createInvestigationSiteResources` | Creates shared geometries/materials and returns `{ createInstance, dispose }`. |
| `InvestigationSites` | Manages `pending`, `collecting`, and `collected` states for all goal cells on the `50×50` grid. |

## 4. Business Logic

1. Each `investigation` cell starts in `pending` state (bobbing and spinning gently).
2. Whenever base constructions update, `syncConstructions` checks `resolveInvestigationProgress(cells, constructions, grid)`.
3. Any `pending` site whose cell is now occupied transitions to `collecting` (`0.4s` rise `+0.9`, spin `14 rad/s`, scale `1 -> 0`), then `collected` (`visible = false`).

## 5. Data Management

- Reads `INITIAL_SERVER_PAYLOAD.investigation`, `INITIAL_SERVER_PAYLOAD.grid`, and `INITIAL_BASE_ORIGIN` in `PlayerSandbox.ts`.
- Uses `resolveInvestigationProgress` from `src/game/minimap/missionMap.ts` as the single source of truth for completion.

## 6. API and Integrations

No network calls yet. Ready for `match.state` / `match.build` updates once connected to `jam-server`.

## 7. Configuration and Environment Variables

No environment variables are required.

## 8. Error Handling

Sites outside `grid` bounds are filtered out by `resolveInvestigationProgress`.

## 9. Security Considerations

No user input or credentials are handled.

## 10. Performance Considerations

All instances share 4 geometries and 4 materials via `createInvestigationSiteResources()`.

## 11. Testing

### Validation Commands

```bash
bun run build
```

## 12. Dependencies

| Dependency | Purpose |
|---|---|
| `three` | 3D meshes, materials, and transforms |
| `../minimap/missionMap` | `resolveInvestigationProgress` and `MissionMapConstruction` |

## 13. Known Limitations

- Uses `INITIAL_SERVER_PAYLOAD.investigation` until live `match.state` / `match.build` WebSocket events are wired.

## 14. Future Improvements

- Trigger a celebratory particle burst or sound effect when a site is collected.

## 15. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-15 | 1.0.0 | Added 3D golden investigation site assets, collection animation, and `PlayerSandbox` sync |
