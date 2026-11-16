# 50×50 Map Integration (`MarsMapLayer.ts`)

## 1. Overview

`MarsMapLayer` integrates the Layer `-1` Martian terrain (`src/terrain-kit/`) with Layer `0` base corridors (`CorridorGrid`) and Layer `1` player movement (`PlayerSandbox`) on the full `50×50` grid.

### Objectives
- Replace the temporary `20×20` `DebugGrid` and `ShadowMaterial` plane in `PlayerSandbox.ts` with the `50×50` Martian terrain.
- Align Layer `-1` terrain cells 1:1 with Layer `0` corridor cells (`0..49`).
- Render real HiRISE elevation from `GET /v1/mars-terrain/{seed}` in the mission, with seeded procedural terrain as the default fallback.

### Scope
- **Included:** `src/game/map/MarsMapLayer.ts`, `src/game/map/missionTerrain.ts` (terrain source, loading and fallback), `CorridorGrid.ts` foundation plinths, and the `PlayerSandbox.ts` / `PlayerSandboxView.tsx` integration.
- **Excluded:** `terrain-kit/*` internals, `showcase/*`, `investigation` goal markers/HUD, and live WebSocket transport. The server does not assign mission terrain seeds yet.

## 2. Architecture

### Directory Structure

```text
src/game/
├── PlayerSandbox.ts
├── corridor/
│   ├── CorridorGrid.ts
│   └── mockServerPayload.ts
└── map/
    ├── MarsMapLayer.ts
    └── missionTerrain.ts
```

### Architectural Responsibilities
- `missionTerrain.ts` picks the terrain source and seed (`resolveMissionTerrainConfig`), fetches and validates real terrain with the shared `fetchMarsTerrain` (`loadMissionTerrain`), and runs the mission lifecycle (`launchMission`): load the terrain, then create the scene; cancel or dispose on exit.
- `MarsMapLayer.ts` builds the `ReliefMap` (from `MarsTerrainDataV1` or a procedural seed), instantiates `createReliefTerrain`, aligns `terrain.root` to `CorridorGrid`, mines cells on build, and disposes GPU resources via `disposeObject`.
- `PlayerSandbox.ts` mounts `MarsMapLayer` and `CorridorGrid`, and constrains player movement and corridor placement to the `50×50` `MAP_BOUNDS`. Its optional third argument chooses the terrain (`terrainData` or `terrainSeed`); without it, the scene is the procedural seed-42 map.
- `PlayerSandboxView.tsx` starts the mission through `launchMission`, shows "Loading Martian terrain…" until the scene exists, then a one-line terrain note (bottom-right).

## 3. Implementation Details

### Classes and Functions

| Symbol | Responsibility |
|---|---|
| `MarsMapLayer` | Builds and positions Layer `-1` (procedural `70×70`, or real `90×90`: the measured `50×50` inside a synthetic border) below Layer `0`, mines built cells, and exposes `dispose()`. |
| `MarsMapLayer.isRealTerrain` | Whether the layer draws real elevation (and grades built cells). |
| `createMarsTerrainScenery(data)` (`terrain-kit/marsTerrainScenery.ts`) | Real terrain's display map: measured core, synthetic procedural border, procedural classification for the art. |
| `resolveMissionTerrainConfig(env)` | Source (`mars` / `procedural`), seed and API base URL for the mission. |
| `loadMissionTerrain(config, options)` | Real terrain, or procedural terrain with a `fallbackReason`; rejects only when the mission is left. |
| `launchMission(config, { createScene, onTerrain })` | Loads the terrain, creates the scene, and returns `stop()` for unmount. |
| `PlayerSandbox` | Coordinates Layer `-1`, Layer `0`, Layer `1`, camera, and lighting. |

### Types and Interfaces

```ts
export interface MarsMapLayerOptions {
  terrainData?: MarsTerrainDataV1 // real elevation, dressed with the procedural art system
  seed?: number // procedural seed when terrainData is omitted (default 42)
  cellSize?: number
  skirtDepth?: number
  originCell?: { readonly cellX: number; readonly cellY: number }
  initialBaseCells?: ReadonlyArray<{ readonly cellX: number; readonly cellY: number }>
}

type MissionTerrain =
  | { source: 'mars'; seed: number; data: MarsTerrainDataV1 }
  | { source: 'procedural'; seed: number; fallbackReason?: string }
```

## 4. Business Logic

### Coordinate Alignment & Grounding
- Procedural fallback maps are generated at `70×70` (`MAP_SIZE + 2 * 10` border cells) so map edges stay outside the camera view while gameplay remains constrained to the central `50×50` grid.
- Before meshing, `prepareInitialBaseTerrain` levels the `initialBaseCells` to their average relief and clears `feature` to `'none'` so rocks or formations never spawn inside the starting base. On procedural maps it also sets `geology: 'plain'` and `region: 'plains'`, because dunes (up to 0.3 units), rubble and volcanic flow fronts add micro-relief on top of the relief that would break the flat ground.
- The homepage (`src/home/MarsHomeScene.tsx`) reuses `MarsMapLayer` with a disc of leveled cells as `initialBaseCells` to get a flat walkable circle (see `docs/homepage.md`).
- `MarsMapLayer` offsets `terrain.root` in X/Z so every `(cellX, cellY)` in `0..49` matches its terrain cell 1:1, and sets `terrain.root.position.y = -avgBaseHeight - 0.02` using the average `surface.heightAt` of the initial `3×3` base.
- `CorridorGrid` adds a shared `0.85`-unit foundation plinth underneath each placed tile (`y = 0` down to `-0.85`) so newly built corridors stay visually grounded over craters and terrain dips without regenerating terrain chunks.
- When a corridor is built onto a cell (`E` / `Space`), `MarsMapLayer.mineCell(x, z)` clamps any Layer `-1` terrain or baked rock vertices inside that cell (plus a margin, `±0.76`) down to `y = -0.18` so corridors and the player always remain on top. The initial base cells are mined the same way when the scene starts.

### Real HiRISE terrain
Real terrain is **measured shape + procedural game art + synthetic surroundings**. The three stay distinguishable:

| Geometry | Source | Where |
|---|---|---|
| Measured | The payload's corner samples, copied unchanged | The playable `50×50` cells (`elevation.measuredFootprint`) |
| Synthetic | Generated by `createMarsTerrainScenery` | The 20-cell border around them; never presented as data |
| Construction | `mineCell` grading | Rendered meshes only, around built cells |

- **Shape:** heights are the measured metres at true scale (10 m cells → 1 world unit per 10 m), bilinear between samples; nothing is exaggerated. Payload cell `(col, row)` sits under server cell `(cellX, cellY)`, north-up. `createReliefField` draws heights from `map.elevation` whenever it exists, so classification only changes colours, shading and dressing, never the heightfield (tested).
- **Art (game art, not observations):** the display map is classified with the same procedural classifier and dressed by the same placement, baking and scatter systems as procedural maps: rocks and boulders, clusters and debris, mesas, buttes, pillars, sedimentary outcrops, ground cracks, hematite/gypsum/olivine/sulfur deposits, and the varied surface palette. The classifier's input is *local relief* (each cell's elevation minus its ~130 m neighbourhood mean, normalized over the measured cells): real windows are dominated by smooth regional tilts, which as plain normalized relief left them about half as dressed as procedural maps with almost no debris. Asset density now lands close to procedural (e.g. 309–600 placed assets per map vs 431 for procedural seed 42) and is deterministic per payload.
- **Synthetic surroundings:** the border is 20 cells per side (`MARS_SCENERY.borderCells`), so the mission camera, which sees ~10–15 cells past the playable edge, never reaches the void. Each synthetic sample starts at its nearest measured boundary sample, continues that boundary's outward slope (levelling off over 3 cells), and blends in procedural relief from `generateLandforms` (the procedural map generator), scaled to the measured ground's own local relief, with a weight of 0 at the seam and 1 at the outer edge. Height and slope therefore match across the seam: on the served regions the change of slope at the seam is about half of what the measured ground itself does next to it. Procedural maps keep their `70×70` map and 10-cell border unchanged.
- **Base:** `prepareInitialBaseTerrain` clears features from the base cells on both kinds of map; real ground is then levelled on the rendered mesh when the base cells are mined. The terrain is aligned to the base's average measured height.
- **Excavation (earthwork):** real ground can sit several units above or below the flat corridor deck (about ±5 units around the base in the served regions), more than the `0.85` plinth covers. On real maps `mineCell` therefore *cuts and fills* the surface: vertices within the mined square are set to `y = -0.18`, and within 2 world units around it they blend smoothly back to their height, so the ground meets corridors with a graded slope instead of a cliff or a gap. Grading only moves ground toward the floor, so cells mined earlier never revert.
- **Dressing during construction:** props are never squashed or stretched. `bakeStaticMeshes` records each prop's vertex range (`userData.bakedParts`) and `createReliefTerrain` returns the props (`terrain.props`), so `mineCell` can: hide a whole prop (or scatter rock) that reaches over the mined square, hide crack decals anywhere on the graded ground, and move props on the graded slope rigidly with the ground under them (choosing the motion that seats them into the ground rather than leaving an edge hanging). The baked contact shadows and mineral halos painted into the ground are not removed when their prop is hidden.
- **Scientific data is not modified:** the payload, the measured samples in the display map and the cells' measured `elevationMeters` are unchanged (tested). Grading edits only the rendered `BufferGeometry`.

### Terrain source and seed
- The mission seed is `DEFAULT_FALLBACK_SEED = 42` (client-side) until match state carries a terrain seed. It selects the HiRISE window and seeds procedural terrain.
- Development: real terrain by default through the Vite proxy. `?terrain=procedural` selects procedural terrain and `?terrainSeed=N` (0..4294967295) another seed, e.g. `/?terrainSeed=1` for Russell crater. Reload or re-enter the mission to switch.
- Production: real terrain only when the bundle was built with `VITE_MARS_TERRAIN_API_URL` (§7); otherwise the mission is procedural, exactly as before, and the query is ignored.

### Mission lifecycle
1. `PlayerSandboxView` resolves the config and calls `launchMission`; the view shows "Loading Martian terrain…".
2. Real terrain is fetched with `fetchMarsTerrain` and validated with `parseMarsTerrainData` (`MISSION_TERRAIN_TIMEOUT_MS = 8000`).
3. The scene (`PlayerSandbox`) is created only once the terrain is known. If real terrain fails (unreachable, HTTP error, invalid payload, timeout) or cannot be built, the scene is built from procedural terrain and the note says why.
4. Leaving the mission (unmount) aborts a pending request (a late response creates nothing) or disposes the scene.

## 5. Data Management

### Data Sources
- `MarsTerrainDataV1` from `GET /v1/mars-terrain/{seed}` via `fetchMarsTerrain` → `createMarsTerrainScenery` (measured core, synthetic border, game-art classification).
- Procedural terrain via `generateReliefMap(seed ?? 42, 70, 70)` when real terrain is not selected, not configured or unavailable.
- `INITIAL_SERVER_PAYLOAD.grid`, `INITIAL_SERVER_CONSTRUCTIONS`, and `INITIAL_BASE_ORIGIN` from `mockServerPayload.ts`.

## 6. API and Integrations

`GET {VITE_MARS_TERRAIN_API_URL}/v1/mars-terrain/{seed}` once per mission start (see [mars_terrain_contract.md](mars_terrain_contract.md)). No WebSocket, matchmaking or match-state integration.

## 7. Configuration and Environment Variables

| Variable | Where | Meaning |
|---|---|---|
| `VITE_MARS_TERRAIN_API_URL` | Build time (`.env`, Docker build arg, `compose.yaml`) | Backend origin serving the terrain route, e.g. `https://api.example`, or `/` if a reverse proxy routes `/v1/mars-terrain` on the client's own origin. Empty in production: procedural terrain only. |

- **Development:** nothing to set. `vite.config.ts` proxies `/v1/mars-terrain` to the Go server on `localhost:8080`.
- **Production:** the client is static files behind Nginx (`nginx.conf`), which has no API proxy. Build with the backend origin (`docker build --build-arg VITE_MARS_TERRAIN_API_URL=https://… .` or `VITE_MARS_TERRAIN_API_URL=https://… docker compose build`). The request is a simple cross-origin GET (no preflight), so the Go server's `ALLOWED_ORIGINS` must include the client's origin (its default is `*`). The value is baked into the bundle; changing it needs a rebuild.

## 8. Error Handling

| Scenario | Expected Behavior |
|---|---|
| Invalid `MarsTerrainDataV1` payload | `fetchMarsTerrain` rejects with `MarsTerrainDataError`; the mission starts on procedural terrain with "invalid terrain data". |
| Backend unreachable / HTTP error / no answer within 8 s | Procedural terrain; note "Real Mars terrain unavailable (…). Using procedural terrain." |
| Scene cannot be built from real terrain | Logged; the scene is rebuilt from procedural terrain. |
| Mission left while terrain is loading | Request aborted; no scene is created. |
| `terrainData` omitted | Procedural `generateReliefMap` with `DEFAULT_FALLBACK_SEED = 42`. |

## 9. Security Considerations

All untrusted `MarsTerrainDataV1` payloads are validated by `parseMarsTerrainData` (in `fetchMarsTerrain` and again in `createReliefMapFromMarsTerrain`). The terrain route is unauthenticated and read-only; no credentials are involved.

## 10. Performance Considerations

- Terrain meshes and dressing are chunked and baked by `createReliefTerrain`.
- `CorridorGrid` shares one plinth geometry and material across all tiles.
- Real-terrain grading touches only the chunks within 2.76 world units of the built cell.
- One terrain request per mission start (about 24 KB of JSON); no cache.

## 11. Testing

Tests in `tests/map/` build the mission layers exactly as `PlayerSandbox` does (`terrainGeometry.ts`):
- `marsMapLayer.test.ts`: procedural geometry and colours are identical to `main` (hashes of positions, vertex colours and instance colours recorded from `origin/main` after the base and after building corridors); real terrain (synthetic payloads) gets varied procedural dressing, keeps the measured heightfield exactly, starts with a base clear of dressing, hides props a corridor is built on and moves props on graded slopes rigidly, is deterministic, keeps the samples unchanged, is aligned north-up to the world grid, levelled at the base, cut uphill and filled downhill to a flat floor, free of terrain or dressing inside built cells, untouched beyond the grading band, never reverted by later builds, publishes builds to the minimap and disposes cleanly.
- `tests/terrain/marsTerrainScenery.test.ts`: measured core copied unchanged with its footprint, seam continuity (the change of slope at the seam stays within the measured surface's own), procedural (not flat) outer ring, determinism.
- `missionTerrain.test.ts`: source/seed resolution (development query, production with and without the API URL), success, invalid payload, HTML response, unreachable, HTTP 500/503, timeout, cancellation, and the `launchMission` lifecycle (scene only after load, disposal, late response after exit, rebuild on procedural).

### Validation Commands

```bash
bun test ./tests
bun run typecheck:tests
bun x tsc --noEmit
bun run build
```

## 12. Dependencies

| Dependency | Purpose |
|---|---|
| `three` | Scene graph, bounding box, and beacon meshes |
| `../../terrain-kit/*` | `generateReliefMap`, `createReliefMapFromMarsTerrain`, `createReliefTerrain`, `fetchMarsTerrain`, `disposeObject` |
| `../corridor/mockServerPayload` | `INITIAL_BASE_ORIGIN` and `INITIAL_SERVER_PAYLOAD` |

## 13. Known Limitations

- Uses a fixed client-side `seed = 42` until `jam-server` sends a match terrain seed in `MatchState`; co-op players would only share terrain because they share this constant.
- Expanding corridors onto cells with tall formations mines vertices in-place inside that `1×1` cell, which leaves neighboring vertices outside the cell untouched (procedural maps).
- Real terrain is drawn at true scale: on steep windows (Russell crater, Candor Chasma) corridors run through graded cuts or along raised fill several units high.
- Real maps are `90×90` (vs `70×70` procedural): building takes ~25% longer (about 4 s instead of 3.2 s on the development machine).
- Russell crater windows are more densely dressed (about twice procedural) because their measured surface has a lot of fine local relief.
- When construction hides a prop, its baked ground tint (contact shadow, mineral halo) stays on the ground.
- Procedural maps keep the 10-cell border; the camera can still glimpse past it at the very edge of the procedural map.
- Production needs `VITE_MARS_TERRAIN_API_URL` at build time and a backend reachable from players' browsers; there is no runtime configuration or Nginx proxy.

## 14. Future Improvements

- Take the terrain seed from `MatchState` once the server assigns one.

## 15. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-15 | 1.0.0 | Integrated 50×50 Layer -1 Mars terrain into `PlayerSandbox` |
| 2026-11-15 | 1.1.0 | Leveled cells become plain ground; homepage uses `MarsMapLayer` as its background |
| 2026-11-15 | 1.2.0 | Real HiRISE terrain in the mission: source selection, loading and fallback, real-terrain earthwork |
| 2026-11-15 | 1.3.0 | Real terrain dressed with the procedural art system inside a 20-cell synthetic border; construction hides or moves props whole |
