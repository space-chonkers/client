# Space Corridor & Temporary Corridor Grid (`SpaceCorridor.tsx` & `CorridorGrid.ts`)

## 1. Overview

`SpaceCorridor` provides low-poly, roofless 3D corridor meshes and spatial grid utilities for Layer `0` structures in the `50x50` world map. `CorridorGrid` manages a temporary logical grid in the client that places corridor tiles at integer `(gridX, gridZ)` coordinates and automatically selects and rotates wall variants (`0, 1, 2` straight/corner, or `3` walls) based on occupied cardinal neighbors.

### Objectives
- Define world grid dimensions (`50x50`) and 3D spatial layer constants (`-1`, `0`, `1`).
- Construct roofless low-poly `THREE.Group` corridor segments for 0, 1, 2, or 3 lateral walls (including straight and corner 2-wall configurations).
- Render directional floor guide strips only toward open cardinal exits.
- Automatically orient corridor walls and open floor guides on a grid (`CorridorGrid`) when tiles are placed or removed.

### Scope
- **Included:** Spatial coordinate helpers, Tritanopia-safe color palette (`CORRIDOR_PALETTE`), procedural `THREE.Group` corridor builders, `CorridorGrid` auto-tiling manager, and integration inside `PlayerSandbox.ts`.
- **Excluded:** Authoritative server-side tile validation and Layer `-1` terrain generation.

## 2. Architecture

### Directory Structure

```text
src/
├── assets/
│   └── SpaceCorridor.tsx
└── game/
    ├── PlayerSandbox.ts
    └── corridor/
        ├── CorridorGrid.ts
        └── mockServerPayload.ts
```

### Architectural Responsibilities
- `SpaceCorridor.tsx` isolates procedural Three.js geometry construction and coordinate math from React state and networking layers.
- `CorridorGrid.ts` maintains the set of occupied `(gridX, gridZ)` tiles in Layer `0`, resolves neighbor connectivity (`north`, `south`, `east`, `west`), and rebuilds affected tile meshes when tiles are added or removed.
- `mockServerPayload.ts` defines the temporary server payload contract (`ServerMatchPayload`, `INITIAL_SERVER_PAYLOAD`, `INITIAL_BASE_ORIGIN`, `INITIAL_SERVER_CONSTRUCTIONS`) to serve as the baseline until the live backend service is connected.
- `PlayerSandbox.ts` mounts `CorridorGrid` with the initial `3x3` base from `mockServerPayload.ts` and allows live corridor expansion via `E` or `Space`.

## 3. Implementation Details

### Components and Classes

| Name | Responsibility |
|---|---|
| `SpaceCorridor` | Standalone Three.js `WebGLRenderer` preview component that displays and rotates requested corridor wall variants. |
| `CorridorGrid` | Manages placed Layer `0` corridor tiles in a Three.js scene and updates adjacent neighbor walls automatically. |
| `CorridorGrid.getOccupiedTiles()` | Returns a copied, read-only snapshot of occupied tiles as `{ gridX, gridZ, kind }` (local coordinates). |
| `CorridorGrid.onOccupancyChange(listener)` | Calls `listener` after tiles are added (`placeTile`, `loadConstructions`) or removed (`removeTile`); rejected placements and removals do not notify. Returns an unsubscribe function; `dispose()` clears all listeners. Used by the mission minimap (see `docs/mission_minimap.md`). |

### Utilities

| Utility | Responsibility |
|---|---|
| `layerToWorldY(layer)` | Converts a `SpatialLayer` (`-1`, `0`, `1`) into its vertical world `Y` coordinate using `LAYER_VERTICAL_STEP` (`0.5`). |
| `gridToWorldPosition(gridX, gridZ, layer)` | Clamps `(gridX, gridZ)` to `[0, 49]` and returns a centered `THREE.Vector3` in world space. |
| `createCorridorSegment(wallCount, isCorner)` | Builds a Layer `0` roofless `THREE.Group` with a floor deck, 4 corner pillars, `0..3` lateral walls with coral top caps, and floor guide strips pointing toward open sides. |
| `createCrossCorridor()` | Shortcut for `createCorridorSegment(0)` (0 walls, 4 open exits). |
| `createTJunctionCorridor()` | Shortcut for `createCorridorSegment(1)` (1 north wall, 3 open exits). |
| `createStraightCorridorSegment()` | Shortcut for `createCorridorSegment(2, false)` (west and east walls, north-south passage). |
| `createCornerCorridor()` | Shortcut for `createCorridorSegment(2, true)` (north and west walls, south-east L-corner). |
| `createBorderCorridor()` | Shortcut for `createCorridorSegment(3)` (north, west, and east walls, 1 south exit). |
| `resolveCorridorOrientation(openSides)` | Pure helper that maps a `ReadonlySet<CardinalSide>` of connected neighbors to `{ wallCount, isCorner, rotationY }`. |

### Types and Interfaces

- `SpatialLayer`: `-1 | 0 | 1` derived from `SPATIAL_LAYERS` (`TERRAIN: -1`, `STRUCTURES: 0`, `ENTITIES: 1`).
- `CorridorWallVariant`: `0 | 1 | 2 | 3` lateral wall count.
- `CardinalSide`: `'north' | 'south' | 'east' | 'west'`.
- `ConstructionKind`: `'base_tile' | 'stash'`.
- `ConstructionPayload`: `{ id: string; kind: ConstructionKind; cellX: number; cellY: number }`.
- `CorridorOrientation`: `{ wallCount: CorridorWallVariant; isCorner: boolean; rotationY: number }`.

## 4. Business Logic

### Main Workflow
1. Resolve the vertical position of the segment at `SPATIAL_LAYERS.STRUCTURES` (`Y = 0`).
2. Create the metallic floor deck (`1.0 x 0.08 x 1.0`) occupying 100% of the `1x1` tile and four corner structural posts at `(±0.45, ±0.45)`.
3. Determine which cardinal sides receive closed walls based on `wallCount` (`0..3`) and `isCorner`.
4. Attach hull walls and high-contrast coral marker caps (`#ff595e`) flush with the `1x1` tile borders on closed sides.
5. Render a center floor node and extend cyan-teal floor guide arms (`#00a896`) exclusively toward open cardinal sides.
6. In `PlayerSandbox`, `CorridorGrid.constrainMovement` prevents the `0.55`-scaled astronaut from passing through closed corridor walls or corner pillars.

### Business Rules
- A side shared with an adjacent corridor tile is always open (no wall, floor guide arm extended).
- A side without an adjacent corridor tile is closed with a hull wall and coral marker cap (`#ff595e`).
- All roofs are omitted so top-down cameras can see inside corridors.

## 5. Data Management

### Data Sources
- Static constants (`MAP_GRID_WIDTH`, `MAP_GRID_HEIGHT`, `SPATIAL_LAYERS`, `CORRIDOR_PALETTE`, `INITIAL_CORRIDOR_TILES`) and interactive sandbox keyboard input (`KeyE`, `Space`).

### State Management
- `CorridorGrid` stores each tile's `kind` and mesh group in an internal `Map` keyed by `"x,z"`, and is the source of truth for sandbox construction occupancy.

## 6. API and Integrations

This feature does not use external APIs or network integrations.

## 7. Configuration and Environment Variables

No environment variables are required.

## 8. Error Handling

| Scenario | Expected Behavior |
|---|---|
| Duplicate tile placement at `(x, z)` | `placeTile` returns `false` without recreating meshes. |
| Removing a non-existent tile | `removeTile` returns `false` safely. |
| Target cell outside sandbox bounds | `PlayerSandbox` ignores `E`/`Space` placement requests outside `[-half, half]`. |

## 9. Security Considerations

No user credentials, network inputs, or external resources are processed.

## 10. Performance Considerations

- Only the modified tile `(x, z)` and its 4 immediate cardinal neighbors are rebuilt when a tile is placed or removed.
- Previous `THREE.Group` meshes have their geometries and materials disposed immediately on rebuild and on `CorridorGrid.dispose()`.

## 11. Testing

### Validation Commands

```bash
# TypeScript compilation and production bundle verification
bun run build
```

## 12. Dependencies

| Dependency | Purpose |
|---|---|
| `react` | Component lifecycle (`useEffect`, `useRef`) for `<SpaceCorridor />` |
| `three` | 3D scene graph, geometries, materials, lights, and WebGL rendering |

## 13. Known Limitations

- `CorridorGrid` currently holds client-side sandbox state until connected to the authoritative `WorldMap` state from the server.

## 14. Future Improvements

- Synchronize `CorridorGrid` with authoritative server `Tile` construction updates and deduct construction resource costs on expansion.

## 15. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-14 | 1.0.0 | Initial documentation of `SpaceCorridor.tsx` |
| 2026-11-15 | 1.1.0 | Added `CorridorGrid` auto-tiling manager and `PlayerSandbox` integration |
| 2026-11-15 | 1.2.0 | Added read-only occupancy snapshot and change listener for the mission minimap |
