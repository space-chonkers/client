# 50×50 Map Integration (`MarsMapLayer.ts`)

## 1. Overview

`MarsMapLayer` integrates the Layer `-1` Martian terrain (`src/terrain-kit/`) with Layer `0` base corridors (`CorridorGrid`) and Layer `1` player movement (`PlayerSandbox`) on the full `50×50` grid.

### Objectives
- Replace the temporary `20×20` `DebugGrid` and `ShadowMaterial` plane in `PlayerSandbox.ts` with the `50×50` Martian terrain.
- Align Layer `-1` terrain cells 1:1 with Layer `0` corridor cells (`0..49`).
- Support `MarsTerrainDataV1` payloads from the backend contract while providing a temporary seeded procedural fallback.

### Scope
- **Included:** `src/game/map/MarsMapLayer.ts`, `CorridorGrid.ts` foundation plinths, and `PlayerSandbox.ts` integration.
- **Excluded:** `terrain-kit/*`, `showcase/*`, `investigation` goal markers/HUD, and live WebSocket transport.

## 2. Architecture

### Directory Structure

```text
src/game/
├── PlayerSandbox.ts
├── corridor/
│   ├── CorridorGrid.ts
│   └── mockServerPayload.ts
└── map/
    └── MarsMapLayer.ts
```

### Architectural Responsibilities
- `MarsMapLayer.ts` builds the `ReliefMap` (from `MarsTerrainDataV1` or a temporary procedural seed), instantiates `createReliefTerrain`, aligns `terrain.root` to `CorridorGrid`, mines cells on build, and disposes GPU resources via `disposeObject`.
- `PlayerSandbox.ts` mounts `MarsMapLayer` and `CorridorGrid`, and constrains player movement and corridor placement to the `50×50` `MAP_BOUNDS`.

## 3. Implementation Details

### Classes and Functions

| Symbol | Responsibility |
|---|---|
| `MarsMapLayer` | Builds and positions Layer `-1` (`50×50` + border margin) below Layer `0`, mines built cells, and exposes `dispose()`. |
| `PlayerSandbox` | Coordinates Layer `-1`, Layer `0`, Layer `1`, camera, and lighting. |

### Types and Interfaces

```ts
export interface MarsMapLayerOptions {
  terrainData?: MarsTerrainDataV1
  seed?: number
  cellSize?: number
  skirtDepth?: number
  originCell?: { readonly cellX: number; readonly cellY: number }
  initialBaseCells?: ReadonlyArray<{ readonly cellX: number; readonly cellY: number }>
}
```

## 4. Business Logic

### Coordinate Alignment & Grounding
- Procedural fallback maps are generated at `70×70` (`MAP_SIZE + 2 * 10` border cells) so map edges stay outside the camera view while gameplay remains constrained to the central `50×50` grid.
- Before meshing, `prepareInitialBaseTerrain` levels the `initialBaseCells` to their average relief and clears `feature` to `'none'` so rocks or formations never spawn inside the starting base. On procedural maps it also sets `geology: 'plain'` and `region: 'plains'`, because dunes (up to 0.3 units), rubble and volcanic flow fronts add micro-relief on top of the relief that would break the flat ground.
- The homepage (`src/home/MarsHomeScene.tsx`) reuses `MarsMapLayer` with a disc of leveled cells as `initialBaseCells` to get a flat walkable circle (see `docs/homepage.md`).
- `MarsMapLayer` offsets `terrain.root` in X/Z so every `(cellX, cellY)` in `0..49` matches its terrain cell 1:1, and sets `terrain.root.position.y = -avgBaseHeight - 0.02` using the average `surface.heightAt` of the initial `3×3` base.
- `CorridorGrid` adds a shared `0.85`-unit foundation plinth underneath each placed tile (`y = 0` down to `-0.85`) so newly built corridors stay visually grounded over craters and terrain dips without regenerating terrain chunks.
- When a corridor is built onto a cell (`E` / `Space`), `MarsMapLayer.mineCell(x, z)` clamps any Layer `-1` terrain or baked rock vertices inside that `1×1` cell down to `y = -0.02` so corridors and the player always remain on top.

## 5. Data Management

### Data Sources
- `MarsTerrainDataV1` via `createReliefMapFromMarsTerrain` when provided.
- Temporary procedural fallback via `generateReliefMap(seed ?? 42, 50, 50)` until `jam-server` sends `MarsTerrainDataV1` or `seed`.
- `INITIAL_SERVER_PAYLOAD.grid`, `INITIAL_SERVER_CONSTRUCTIONS`, and `INITIAL_BASE_ORIGIN` from `mockServerPayload.ts`.

## 6. API and Integrations

No network calls yet. `MarsMapLayer` is pre-wired for `MarsTerrainDataV1` (`src/terrain-kit/marsTerrainContract.ts`).

## 7. Configuration and Environment Variables

No environment variables are required.

## 8. Error Handling

| Scenario | Expected Behavior |
|---|---|
| Invalid `MarsTerrainDataV1` payload | `createReliefMapFromMarsTerrain` throws `MarsTerrainDataError`. |
| `terrainData` omitted | Falls back to procedural `generateReliefMap` with `DEFAULT_FALLBACK_SEED = 42`. |

## 9. Security Considerations

All untrusted `MarsTerrainDataV1` payloads are validated by `parseMarsTerrainData` inside `createReliefMapFromMarsTerrain`.

## 10. Performance Considerations

- Terrain meshes and dressing are chunked and baked by `createReliefTerrain`.
- `CorridorGrid` shares one plinth geometry and material across all tiles.

## 11. Testing

### Validation Commands

```bash
bun run build
```

## 12. Dependencies

| Dependency | Purpose |
|---|---|
| `three` | Scene graph, bounding box, and beacon meshes |
| `../../terrain-kit/*` | `generateReliefMap`, `createReliefMapFromMarsTerrain`, `createReliefTerrain`, `disposeObject` |
| `../corridor/mockServerPayload` | `INITIAL_BASE_ORIGIN` and `INITIAL_SERVER_PAYLOAD` |

## 13. Known Limitations

- Uses a fixed fallback `seed = 42` until `jam-server` sends `MarsTerrainDataV1` or a match `seed` in `MatchState`.
- Expanding corridors onto cells with tall formations mines vertices in-place inside that `1×1` cell, which leaves neighboring vertices outside the cell untouched.

## 14. Future Improvements

- Pass live `MarsTerrainDataV1` (or server `seed`) from `MatchState` into `MarsMapLayer`.

## 15. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-15 | 1.0.0 | Integrated 50×50 Layer -1 Mars terrain into `PlayerSandbox` |
| 2026-11-15 | 1.1.0 | Leveled cells become plain ground; homepage uses `MarsMapLayer` as its background |
