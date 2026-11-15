# Mars Terrain Contract (proposed v1)

**Status:** proposal. The client can consume this payload today; no backend
serves it yet. Decided for v1: seed ownership (§2), the horizontal convention
(§3) and NoData rejection (§4). Field names and the datum identifier still need
agreement with the backend team before Phase 4B (§7).

## 1. Purpose

The future backend geospatial module picks a location on Mars with verified
HiRISE DTM coverage. It then samples real elevations and sends one map's terrain to
the client. The client turns the payload into the same `ReliefMap` the
procedural generator produces, so rendering, classification and dressing
don't change.

The client never reads NASA rasters, reprojects data or discovers datasets.
All of that stays in the backend.

## 2. Payload

TypeScript source of truth: `MarsTerrainDataV1` in
`src/terrain-kit/marsTerrainContract.ts`.

```jsonc
{
  "version": 1,
  "center": { "latitude": -4.5, "longitudeEast": 137.4 },
  "grid": { "columns": 50, "rows": 50, "cellSizeMeters": 10 },
  "elevation": {
    "sampling": "cell-corners",
    "columns": 51,
    "rows": 51,
    "samplesMeters": [-4512.3, -4512.1, "… 2,601 values in total …"],
    "datum": "<agreed datum identifier>"
  },
  "source": {
    "datasetId": "<backend dataset id>",
    "provider": "<data provider>",
    "resolutionMeters": 1,
    "productId": "<optional source product id>"
  },
  "seed": 1234
}
```

The example values above are illustrative placeholders, not real measurements.

| Field | Meaning |
|---|---|
| `version` | Contract version. The client rejects anything except `1`. |
| `center.latitude` | Planetocentric latitude of the map centre, degrees, [-85, 85], positive north. Polar maps are not supported in v1 (§3). |
| `center.longitudeEast` | East-positive longitude of the map centre, degrees, [0, 360). |
| `grid.columns` / `grid.rows` | Logical cells west→east / north→south. Phase 4A uses 50 × 50. |
| `grid.cellSizeMeters` | Ground size of one cell. Phase 4A uses 10 m, so the map is 500 m × 500 m. |
| `elevation.sampling` | Always `cell-corners` in v1 (see §3). |
| `elevation.columns` / `rows` | Must equal `grid.columns + 1` / `grid.rows + 1`, so 51 × 51 for Phase 4A. |
| `elevation.samplesMeters` | Elevations in **metres above `datum`**, row-major (see §3). |
| `elevation.datum` | Identifier of the vertical reference (for example the Mars areoid used by the source DTM). The exact string must be agreed. The client stores it and never converts between datums. |
| `source.datasetId` / `provider` / `productId` | Provenance, kept with the map. |
| `source.resolutionMeters` | Ground resolution of the source DTM. This is not the cell size. |
| `seed` | Integer in [0, 2³²). **Owned by the backend:** it is part of the map, so every client builds the same map. It drives only procedural decoration the client opts into (§5), never data. |

## 3. Sampling, ordering and orientation

- **Corner sampling.** Samples sit on cell corners, not cell centres. A 50 × 50
  cell grid needs 51 × 51 samples, and neighbouring cells share the samples on
  their common edge, so the surface is continuous.
- **Row-major order from the north-west corner.** `index = row * columns + column`.
  Row 0 is the north edge and column 0 is the west edge. Column increases east;
  row increases south.
- **North-up local grid (decided for v1).** The backend resamples the DTM onto
  a grid centred on `center`, spaced `cellSizeMeters` apart along local east
  and north. With `C = grid.columns`, `N = grid.rows` and `s = cellSizeMeters`,
  corner (column, row) sits at

  ```
  east  = (column − C / 2) × s          north = (N / 2 − row) × s        (metres)
  ```

  and its sample is the elevation at the geographic point

  ```
  latitude  = φ0 + (north / R) × 180 / π
  longitude = (λ0 + (east / (R × cos φ0)) × 180 / π) mod 360            (in [0, 360))
  ```

  where `φ0`/`λ0` are `center.latitude`/`center.longitudeEast` and
  `R = 3,389,500 m` (`MARS_MEAN_RADIUS_METERS`). This is a local equirectangular
  mapping on a sphere. The backend must use exactly these formulas and this
  radius, even when the source DTM uses another projection or sphere (HiRISE DTMs
  often use 3,396,190 m), so that client and server place every point
  identically. The client's `marsCoordinates.ts` implements the same mapping.
- **Latitude limit.** `|center.latitude|` must be at most 85°. Closer to the
  poles `cos φ0` approaches 0 and "north-up" stops being meaningful. Polar maps
  would need a polar projection in a future version.
- **Cell values.** The client gives each cell the mean of its four corners
  (`TerrainCell.elevationMeters`).

## 4. Units and NoData

- Elevations are in metres. Horizontal distances are in metres. Angles are in degrees.
- **NoData: v1 rejects incomplete tiles (decided).** Any `null`, `NaN` or
  non-finite sample makes the payload invalid, and the error names the count
  and the first bad index (row, column). The backend must only send tiles with
  full coverage. Gap filling, if ever needed, is a backend decision for a
  future version.
- The client validates every field and reports **all** problems at once
  (`MarsTerrainDataError.issues`).

## 5. What the client does with it

`createReliefMapFromMarsTerrain(data, options)` builds a `ReliefMap` that carries the elevation on `map.elevation`:

| Stage | Where it lives | Notes |
|---|---|---|
| Raw elevation (m) | `map.elevation.samplesMeters` | A copy of the payload, unmodified. |
| Relative height (m) | `elevation − normalization.referenceMeters` | The reference defaults to the median sample. |
| Normalized relief [-1, 1] | `TerrainCell.relief` | `(elevation − reference) / scale`, clamped. `scale` is the 98th percentile of distances from the reference, at least 15 m, so one spike can't flatten the map. |
| Visual height (world units) | `reliefField.ts` | Relative height × world units per metre (cell size / 10 m), at true scale. No procedural micro-relief is added. |

By default a real map is **unclassified** (`map.classification === 'none'`):
every cell has geology and region `unclassified` and feature `none`. The
surface uses one neutral ground colour, and no craters, formations, mineral
deposits or scattered rocks are added. The drawn surface is the measured one.

`options.classification: 'procedural'` opts into the seeded classifier and
dressing, with the default mineral rules. The map is then marked
`classification: 'procedural'`. Its geology, regions and deposits are game
decoration derived from the relief and the seed, never observations. Code that
shows or uses geology on a real map must check `map.classification`.

## 6. Coordinates on the client

`src/terrain-kit/marsCoordinates.ts` documents four spaces and converts
geographic ↔ local:

1. **Geographic:** planetocentric latitude and east longitude.
2. **Local metres:** east and north of the centre, using the §3 convention.
   Client and server agree exactly because both use it. Against true distances
   on Mars it is approximate. Mars is about 0.6% oblate, and the flat-map term
   grows with latitude. For a corner 250 m east and 250 m north of the centre
   it is about 1.5 mm at 4.5°, 3 cm at 60° and 21 cm at 85°. Conversions throw
   a `RangeError` for centres beyond ±85° and for non-finite inputs, instead of
   returning `NaN`.
3. **Grid:** continuous `col`/`row`; col 0 west, row 0 north (§3).
4. **Three.js world:** X east, Z south (north is −Z), Y up, map centred on the
   origin, one cell `cellSize` world units wide (`worldUnitsPerMeter`).

Placing a geographic point (a future point of interest) on the map is left to the
change that introduces points of interest.

## 7. Open questions for the backend team

Still open; none blocks the client:

1. The exact `datum` identifier, and whether a single datum is guaranteed. The
   client only stores it.
2. The resampling method from DTM to the 10 m grid (for example bilinear
   or area-average), and who documents it. The grid geometry itself is fixed by §3.
3. The transport and error format (out of scope for the client contract).

Decided for v1 (the backend team confirms when implementing):

- NoData: incomplete tiles are rejected (§4).
- Seed: owned by the backend (§2).
- Horizontal convention: north-up local grid, equirectangular on R = 3,389,500 m,
  centres within ±85° (§3).
