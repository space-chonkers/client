# Layer −1 Terrain

## 1. Overview

Layer −1 is the Martian geology around and under the playable space. It is
generated procedurally today; the same renderer can also draw real Martian
elevation once the backend provides it (see
[mars_terrain_contract.md](mars_terrain_contract.md)).
It is environmental only: units never walk on it (`TerrainCell.walkable` is always
`false`). Layer 0 (walkable base, corridors, building) and Layer 1 (characters)
are separate systems and are not part of this feature.

### Objectives
- Generate a deterministic, seeded 50×50 cell map (`MAP_SIZE`) whose cells carry a
  relief value in [-1, 1] plus derived geology, region and a single feature hint.
- Turn that map into chunked, low-draw-call meshes with geological dressing
  (craters, formations, rocks, mineral deposits).
- Provide reusable procedural assets (rocks, formations, minerals, terrain surfaces).
- Accept real elevation in metres through a versioned contract without changing the renderer.

### Scope
Included: cell data model, relief generation, classification, mineral distribution,
terrain meshing, static dressing, a development-only showcase, and the client side
of the proposed real-elevation contract (validation, adapter, coordinate conversions).
Excluded: gameplay, Layer 0/1, networking, fetching or ingesting real elevation data,
a Points of Interest catalog.

## 2. Architecture

```text
src/
├── terrain-kit/              # Production code: no UI, no debug tooling
│   ├── reliefMap.ts          # Cell model, relief generation, classification (no Three.js)
│   ├── craters.ts            # Crater kinds, shapes, population, carving (no Three.js)
│   ├── mineralDistribution.ts# Where mineral families may occur (no Three.js)
│   ├── elevation.ts          # Real elevation model and normalization (no Three.js)
│   ├── marsTerrainContract.ts# Proposed v1 payload, validation, adapter to ReliefMap (no Three.js)
│   ├── marsCoordinates.ts    # Geographic ↔ local metres ↔ grid ↔ world (no Three.js)
│   ├── reliefField.ts        # ReliefMap → continuous height, surface mix and shading
│   ├── reliefTerrain.ts      # ReliefMap → chunked terrain + baked dressing
│   ├── terrain.ts            # Generic height-field meshing, surface types, crack decals
│   ├── placement.ts          # Grounds assets on the rendered surface
│   ├── minerals.ts           # Mineral deposit visuals and their colours
│   ├── formations.ts         # Strata, pillars, mesas, sedimentary formations
│   ├── rocks.ts              # Rocks, clusters, instanced scatter
│   ├── geometry.ts           # Facet building, merging, static-mesh baking
│   ├── palette.ts            # Shared landscape palette and shared materials
│   ├── noise.ts              # Seeded RNG, hashing, noise
│   └── dispose.ts            # GPU resource cleanup
└── showcase/                 # Development-only tooling (never in production builds)
    ├── TerrainShowcase.tsx   # Control panel and cell inspector
    ├── ReliefMinimap.tsx     # Relief heatmap minimap (hover to inspect, click to focus)
    ├── ShowcaseStage.ts      # Renderer, camera, lights, render loop
    ├── types.ts              # Contracts shared by the stage, views and panel
    ├── terrainLayerView.ts   # Full map with debug views (relief tint, data columns, labels)
    ├── assetGallery.ts       # Every kit asset on a plinth
    ├── gridOverlay.ts        # Cell-boundary overlay
    └── showcase.css
```

Dependency direction: the data modules (`reliefMap.ts`, `craters.ts`,
`mineralDistribution.ts`, `elevation.ts`, `marsTerrainContract.ts`,
`marsCoordinates.ts`) have no Three.js dependency. Everything that builds meshes
depends on them, never the reverse.

### Terrain sources

Both sources produce a `ReliefMap`, and the renderer (`createReliefTerrain`) only
consumes that map. It never calls a source; a test enforces this. A map built from
real elevation is the one that carries `map.elevation`.

| Source | Built by | Height drawn from | `map.classification` |
|---|---|---|---|
| Procedural | `generateReliefMap(seed)` | Normalized relief through the terraced `RELIEF_HEIGHT` curve, plus procedural micro-relief | `procedural` |
| Real elevation | `createReliefMapFromMarsTerrain(data)` | Measured metres at true scale, bilinear between cell corners | `none` by default; `procedural` only on request |

`map.classification` says whether `geology`, `region` and `feature` were invented by
the seeded classifier. With `none`, every cell is `unclassified` with feature `none`,
the surface uses one neutral ground colour, and nothing is dressed (no formations,
minerals or scattered rocks). With `procedural`, they are game decoration, never
observations.

The showcase stage chooses the source (`VIEW_BUILDERS` in `ShowcaseStage.ts`). Today it is always procedural.

## 3. Implementation Details

| Module | Responsibility |
|---|---|
| `generateReliefMap(seed, cols, rows, options)` | Relief + craters + classification in one call |
| `generateLandforms` | Macro relief (highlands, basins, plains), canyons, knobs, crater population |
| `createReliefMap` | Builds cells from relief (generated or authored) and craters; with `elevation`, a real-elevation map |
| `createReliefMapFromMarsTerrain(data, options)` | Validates a contract payload and builds a real-elevation map |
| `parseMarsTerrainData(input)` | Validates untrusted input; throws `MarsTerrainDataError` listing every issue |
| `createReliefTerrain` | Meshes the map in chunks and places/bakes all dressing |
| `createMineralDeposit(kind, options)` | One deposit group (matte host + `mineral` material) |

### Types and Interfaces
- `TerrainCell`: `col`, `row`, `layer: -1`, normalized `relief` ∈ [-1, 1], `slope`, `curvature`,
  `geology`, `region`, `feature`, `walkable: false`; on real maps also `elevationMeters`.
- `ReliefMap`: `seed`, `cols`, `rows`, row-major `cells`, `craters`, `classification`, and on
  real maps `elevation` (raw corner samples in metres, cell size, normalization, geographic reference).
- `ReliefMapOptions`: optional inputs; `mineralRules`, `elevation` and `classification` (default `procedural`).
- `MineralRule`: `feature`, `where(geology, region, craterKind)`, `chance`, `spacing`, `maxSlope`.

## 4. Business Logic

### Main Workflow
1. `generateLandforms` composes macro relief, then carves craters (oldest first).
2. `createReliefMap` measures slope/curvature, classifies regions and geology,
   assigns feature hints, then places minerals using the mineral rules. With
   `classification: 'none'` it only measures slope/curvature.
3. `createReliefTerrain` builds the height field from cell data, meshes it in
   10×10-cell chunks, places each feature's asset on the rendered surface, and
   bakes static props into one mesh per material and chunk.

### Business Rules
- Same seed and options → identical map and meshes.
- Generated relief (`generateLandforms`) is clamped to [-1, 1] and rounded to two
  decimals. `createReliefMap` stores the relief it is given as-is, so callers passing
  authored relief must keep it in [-1, 1].
- Dressing is sized for `cellSize = 1`: asset sizes and footprints are fixed world
  units, while the mesh and placement spots scale with `cellSize`.
- Every map has one large "hero" crater and at least one fresh crater when possible.
- Generation is tuned through documented parameter tables, one per concern:

  | File | Tables |
  |---|---|
  | `reliefMap.ts` | `LANDFORMS` (relief composition), `REGION_RULES`, `GEOLOGY_THRESHOLDS`, `FEATURE_ODDS` |
  | `craters.ts` | `CRATER_MORPHOLOGY`, `CRATER_SHAPE`, `CRATER_POPULATION`, `CRATER_KIND_ODDS` |
  | `reliefField.ts` | `RELIEF_HEIGHT`, `FIELD_SAMPLING`, `DUNES`, `MICRO_RELIEF`, `LANDFORM_SHADING`, `EJECTA_RAYS`, `CRATER_DETAIL` |
  | `reliefTerrain.ts` | `FEATURE_PLACEMENT`, `PLACEMENT_SEARCH`, `ROCK_SCATTER`, `SCATTER_DENSITY` |
  | `mineralDistribution.ts` | `DEFAULT_MINERAL_RULES` (the only table a map can override, via `mineralRules`) |
  | `rocks.ts` | `VARIANTS`, `ROCK_CUT`, `ROCK_SHAPE`, `ROCK_SHADING`, `ROCK_CLUSTER`, `INSTANCED_SCATTER` |
  | `formations.ts` | `STRATA_SHAPE`, `ROCK_MASS_SHAPE`, `RANDOM_BANDS`, and one recipe per formation: `BUTTE`, `PILLAR`, `MESA` |
  | `minerals.ts` | `NODULE`, `GRAIN`, `OUTCROP`, `SAND_DRIFT`, and one recipe per deposit: `HEMATITE`, `GYPSUM`, `OLIVINE`, `SULFUR` |

  Feature and crater-kind odds are cumulative thresholds on a single roll.
  Random spans in the asset tables are `[min, max]` pairs (`Range` in `noise.ts`),
  drawn once per asset from its seed.
- **Minerals:** visuals (`MINERAL_APPEARANCE`, factories in `minerals.ts`) are kept
  separate from distribution (`DEFAULT_MINERAL_RULES`). A map can pass its own
  `mineralRules` without touching the visuals.
- **Disclaimer:** the default rules are generic and inspired by rover findings.
  Procedural placements are game dressing, not claims about real deposits.
  Real-elevation maps get none unless they opt into `classification: 'procedural'`.
- **Ejecta rays:** the bright streaks radiating from fresh impact craters, a
  geological surface feature. They have nothing to do with ray-traced rendering.
- **Static debris:** rock scatter and talus rings are environmental geology built
  once from the seed. Nothing in Layer −1 spawns or despawns at runtime.

## 5. Data Management

Procedural maps are computed client-side from the seed. Real-elevation maps keep the
received metres unmodified on `map.elevation`; normalized relief is derived
deterministically (median reference, 98th-percentile scale, at least 15 m). There is no persistence and no
shared state. The showcase keeps its UI state in React. `ShowcaseStage` owns the
Three.js objects.

## 6. API and Integrations

None yet. The feature does not use the network, the WebSocket protocol, or the backend.
The real-elevation payload it can consume is a proposal, documented in
[mars_terrain_contract.md](mars_terrain_contract.md).

## 7. Configuration and Environment Variables

None. To open the development showcase:

```bash
bun run dev
# then open http://localhost:5173/?view=terrain-showcase
```

The showcase is gated by `import.meta.env.DEV` in `src/main.tsx`. Production builds
drop that branch and the lazily imported showcase chunk.

## 8. Error Handling

| Scenario | Expected Behavior |
|---|---|
| Asset cannot be placed on even ground | Skipped, disposed, and recorded as `placed: false` in `placements` |
| Showcase chunk fails to load (dev) | Error logged, falls back to the game `App` |
| Non-numeric seed in the showcase | Input reverts to the current seed |
| Invalid real-elevation payload (NoData, wrong sample count, bad coordinates…) | `MarsTerrainDataError` listing every issue; no map is built |
| `createReliefMap` given `elevation` whose sample count is not `(cols + 1) × (rows + 1)` | `RangeError`; no map is built |

## 9. Security Considerations

No user data, credentials or network access are involved.

## 10. Performance Considerations

- **Chunking:** the terrain is split into chunks of 10×10 cells, and static props are
  baked into one mesh per (material, chunk). A 50×50 map comes to about 65–75 meshes
  and about 140k–160k triangles.
- **Shared materials:** nearly everything uses the shared `matte` material, with
  colour in per-face vertex colours.
- **Non-uniform scale:** applied to vertices at build time, so it costs nothing at
  render time. A uniform-scale variant was measured with the same mesh and triangle
  counts.
- **Instancing:** small rocks are drawn as one `InstancedMesh` per shape variant.
- **Lazy debug views:** the showcase builds them on first use.
- **Cleanup:** `disposeObject` and `disposeSharedMaterials` free GPU resources.

## 11. Testing

Tests use Bun's built-in runner and live in `tests/terrain/`. They have their own
`tests/tsconfig.json`, which adds the Bun types; the app `tsconfig` sets `types: []`
so Bun and Node globals stay out of browser code. Fixtures in
`syntheticMarsTerrain.ts` are synthetic formulas, not Mars data. The tests cover:
- the procedural map's invariants, a recorded cell hash and a recorded render hash
  (meshes, dressing, placements);
- real elevation staying unclassified and undressed by default (synthetic flat and
  hilly tiles), its drawn surface matching the samples, and opt-in dressing;
- 51×51 corner samples → 50×50 cells, sample order and orientation;
- normalization: range, spike robustness, flat ground;
- validation and NoData rejection;
- the backend handoff files in `docs/mars_terrain_contract/`: both synthetic
  examples pass the parser and match the synthetic generator exactly; the JSON
  Schema, compiled with Ajv (dev dependency), accepts both; and the schema plus
  the cross-field checks agree with the parser on representative invalid payloads;
- true-scale rendering and determinism of real-elevation maps;
- coordinate conversions: the 0°/360° meridian both ways, high latitudes, polar
  rejection and invalid inputs;
- the renderer importing no terrain source.

```bash
bun x tsc --noEmit
bun run typecheck:tests
bun run test
bun run build
```

## 12. Dependencies

| Dependency | Purpose |
|---|---|
| three | Geometry, materials, rendering; `OrbitControls` and `CSS2DRenderer` in the showcase only |
| react | Showcase UI; the terrain kit itself has no React dependency |
