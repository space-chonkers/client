# Space Corridor (`SpaceCorridor.tsx`)

## 1. Overview

`SpaceCorridor` provides low-poly, roofless 3D corridor meshes and spatial grid utilities for Layer `0` structures in the `50x50` world map. It enables top-down camera visibility inside base modules while clearly indicating open exits and closed walls using a Tritanopia-friendly palette.

### Objectives
- Define world grid dimensions (`50x50`) and 3D spatial layer constants (`-1`, `0`, `1`).
- Construct roofless low-poly `THREE.Group` corridor segments for 0, 1, 2, or 3 lateral walls (including straight and corner 2-wall configurations).
- Render directional floor guide strips only toward open cardinal exits.
- Provide a standalone React preview component for inspecting corridor variants.

### Scope
- **Included:** Spatial coordinate helpers, Tritanopia-safe color palette (`CORRIDOR_PALETTE`), procedural `THREE.Group` corridor builders, and the `<SpaceCorridor />` preview component.
- **Excluded:** Server-side tile validation, dynamic neighbor auto-tiling state, and Layer `-1` / Layer `1` entity management.

## 2. Architecture

### Directory Structure

```text
src/
└── assets/
    └── SpaceCorridor.tsx
```

### Architectural Responsibilities
- `SpaceCorridor.tsx` isolates procedural Three.js geometry construction and coordinate math from React state and networking layers.
- Game scenes can import the pure factory functions (`createCorridorSegment`, `createCrossCorridor`, etc.) directly into a Three.js scene graph, or mount `<SpaceCorridor />` as an isolated React canvas preview.

## 3. Implementation Details

### Components

| Component | Responsibility |
|---|---|
| `SpaceCorridor` | Mounts a Three.js `WebGLRenderer` canvas that displays and rotates a row of requested corridor wall variants (`variants = [0, 1, 2, 3]`) and disposes GPU resources on unmount. |

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

### Types and Interfaces

- `SpatialLayer`: `-1 | 0 | 1` derived from `SPATIAL_LAYERS` (`TERRAIN: -1`, `STRUCTURES: 0`, `ENTITIES: 1`).
- `CorridorWallVariant`: `0 | 1 | 2 | 3` lateral wall count.
- `CardinalSide`: `'north' | 'south' | 'east' | 'west'`.
- `SpaceCorridorProps`: `{ variants?: CorridorWallVariant[] }`.

## 4. Business Logic

### Main Workflow
1. Resolve the vertical position of the segment at `SPATIAL_LAYERS.STRUCTURES` (`Y = 0`).
2. Create the metallic floor deck (`0.88 x 0.08 x 0.88`) and four corner structural posts.
3. Determine which cardinal sides receive closed walls based on `wallCount` (`0..3`) and `isCorner`.
4. Attach hull walls and high-contrast coral marker caps (`#ff595e`) on closed sides.
5. Render a center floor node and extend cyan-teal floor guide arms (`#00a896`) exclusively toward open cardinal sides.

### Business Rules
- World coordinates are strictly clamped within `MAP_GRID_WIDTH = 50` and `MAP_GRID_HEIGHT = 50`.
- All roofs are omitted so top-down cameras can see inside corridors.
- Colors follow `CORRIDOR_PALETTE` to remain distinguishable for players with Tritanopia.

## 5. Data Management

### Data Sources
- Static constants (`MAP_GRID_WIDTH`, `MAP_GRID_HEIGHT`, `SPATIAL_LAYERS`, `LAYER_VERTICAL_STEP`, `CORRIDOR_PALETTE`) and component props (`variants`).

### State Management
- Stateless procedural factories; the React preview component holds only a `useRef<HTMLDivElement>` for its Three.js canvas container.

## 6. API and Integrations

This feature does not use external APIs or network integrations.

## 7. Configuration and Environment Variables

No environment variables are required.

## 8. Error Handling

| Scenario | Expected Behavior |
|---|---|
| Out-of-bounds grid coordinates | `gridToWorldPosition` clamps `gridX` and `gridZ` to `[0, 49]`. |
| Zero-sized container on mount/resize | `resize()` checks `width === 0 \|\| height === 0` and skips projection updates until valid dimensions exist. |

## 9. Security Considerations

No user credentials, network inputs, or external resources are processed.

## 10. Performance Considerations

- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` caps pixel density to avoid excessive GPU fill-rate cost.
- On component unmount, the `useEffect` cleanup cancels the animation frame, disconnects the `ResizeObserver`, and disposes all mesh geometries, materials, and the `WebGLRenderer`.

## 11. Testing

### Validation Commands

```bash
# TypeScript compilation and production bundle verification
bun run build
```

## 12. Dependencies

| Dependency | Purpose |
|---|---|
| `react` | Component lifecycle (`useEffect`, `useRef`) for the preview canvas |
| `three` | 3D scene graph, geometries, materials, lights, and WebGL rendering |

## 13. Known Limitations

- `createCorridorSegment` places walls in fixed canonical orientations; callers must rotate the returned `THREE.Group` around the `Y` axis (`Math.PI / 2` increments) to orient T-junctions, corners, or dead-ends toward arbitrary directions.

## 14. Future Improvements

- Add helper utilities that accept a bitmask or set of open neighbor directions (`Set<CardinalSide>`) and automatically apply the appropriate rotation.

## 15. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-14 | 1.0.0 | Initial documentation of `SpaceCorridor.tsx` |
