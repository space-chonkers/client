# Mars Terrain Contract (proposed v1)

**Status:** proposal. The backend serves this payload at
`GET /v1/mars-terrain/{seed}` (server `internal/terrain`), and the client fetches
it with `fetchMarsTerrain` for the mission (see [map_integration.md](map_integration.md))
and the development terrain showcase. Decided for v1: seed ownership (§2), the horizontal convention
(§3) and NoData rejection (§4). Three backend decisions remain open (§9): the
datum, the resampling method, and transport and errors. Field names still need
the backend team's agreement before Phase 4B.

Backend handoff files are in [`mars_terrain_contract/`](mars_terrain_contract/):
a JSON Schema and two synthetic example payloads (§7).

## 1. Purpose

The future backend geospatial module picks a location on Mars with verified
HiRISE DTM coverage. It then samples real elevations and sends one map's terrain to
the client. The client turns the payload into the same `ReliefMap` the
procedural generator produces, so the same renderer draws it. Classification
and dressing stay off unless the client opts in (§5).

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
| Visual height (world units) | `reliefField.ts` | Relative height × world units per metre (`cellSize / grid.cellSizeMeters`), at true scale. No procedural micro-relief is added. |

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

## 7. Schema and example payloads

| File | What it is |
|---|---|
| `mars_terrain_data.v1.schema.json` | JSON Schema (draft 2020-12) for the payload. |
| `synthetic_2x2.v1.json` | A small 2 × 2-cell (3 × 3-sample) payload you can read by eye. |
| `synthetic_50x50.v1.json` | The full Phase 4A size: 50 × 50 cells, 51 × 51 = 2,601 samples. |

**The examples are synthetic.** Every elevation comes from the formula
`-4000 + 2 × column − 3 × row` (a tilted plane). The centre (10° N, 20° E) is an
arbitrary round number. The datum, dataset and provider strings are labelled
synthetic. Nothing in them is real Martian terrain or NASA/HiRISE data. They are
for checking format and orientation only. Sample 0 is the north-west corner, so
values rise to the east and fall to the south.

The TypeScript parser (`parseMarsTerrainData`) stays the source of truth.
`tests/terrain/marsTerrainContractArtifacts.test.ts` checks that:

- both examples pass the parser and are exactly what `syntheticMarsTerrain` produces;
- the schema's bounds and required fields match the parser;
- the real schema, compiled with Ajv (draft 2020-12), accepts both examples;
- on representative valid and invalid payloads, the schema plus the two code
  rules below give the same verdict as the parser.

**What the schema cannot check.** JSON Schema cannot compare two fields, so two
parser rules have to be checked in code (§8):

1. `elevation.columns == grid.columns + 1` and `elevation.rows == grid.rows + 1`.
2. `len(elevation.samplesMeters) == elevation.columns × elevation.rows`.

Like the parser, the schema allows extra fields. Optional `source.productId`
must be left out when there is none; `null` is rejected.

## 8. Validating payloads in the Go backend

Validate each payload the way it will be sent: encode it to JSON first, then
check those bytes against the schema and the two code rules above. The example
below uses
[`github.com/santhosh-tekuri/jsonschema/v6`](https://github.com/santhosh-tekuri/jsonschema),
which supports draft 2020-12. This Go code was compiled and run once against
both examples and 34 accepted and rejected payloads, and it agreed with the
TypeScript parser on every one. The client test suite repeats the same check
automatically with Ajv, but it does not run the Go code.

```go
package terrain

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// MarsTerrainValidator checks payloads against mars_terrain_data.v1.schema.json
// plus the cross-field rules JSON Schema cannot express.
type MarsTerrainValidator struct{ schema *jsonschema.Schema }

func NewMarsTerrainValidator(schemaJSON []byte) (*MarsTerrainValidator, error) {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(schemaJSON))
	if err != nil {
		return nil, fmt.Errorf("parse schema: %w", err)
	}
	const url = "urn:space-chonkers:mars-terrain-data:v1"
	c := jsonschema.NewCompiler()
	if err := c.AddResource(url, doc); err != nil {
		return nil, fmt.Errorf("add schema: %w", err)
	}
	schema, err := c.Compile(url)
	if err != nil {
		return nil, fmt.Errorf("compile schema: %w", err)
	}
	return &MarsTerrainValidator{schema: schema}, nil
}

// Validate checks one encoded payload exactly as it will be sent.
func (v *MarsTerrainValidator) Validate(payload []byte) error {
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("payload is not JSON: %w", err)
	}
	if err := v.schema.Validate(inst); err != nil {
		return fmt.Errorf("schema: %w", err)
	}
	// The schema passed, so these fields exist with the right types.
	var shape struct {
		Grid      struct{ Columns, Rows int }
		Elevation struct {
			Columns, Rows int
			SamplesMeters []float64
		}
	}
	if err := json.Unmarshal(payload, &shape); err != nil {
		return fmt.Errorf("decode shape: %w", err)
	}
	g, e := shape.Grid, shape.Elevation
	if e.Columns != g.Columns+1 || e.Rows != g.Rows+1 {
		return fmt.Errorf("elevation must be %dx%d corner samples, got %dx%d", g.Columns+1, g.Rows+1, e.Columns, e.Rows)
	}
	if len(e.SamplesMeters) != e.Columns*e.Rows {
		return fmt.Errorf("elevation.samplesMeters has %d values, expected %d", len(e.SamplesMeters), e.Columns*e.Rows)
	}
	return nil
}
```

Suggested use:

- **Backend tests:** run `Validate` on both example files as known-good inputs,
  and on every payload your generator produces.
- **Encoding in Go:**
  - Declare `productId` as `*string` with `json:",omitempty"` so a missing value
    is left out rather than sent as `null`.
  - `encoding/json` refuses to encode `NaN` and `±Inf`, so a NoData sample fails
    at encoding time instead of reaching the client.
- **Whitespace edge case:** the schema's `\S` pattern only rejects ASCII
  whitespace when Go's `regexp` runs it. A string made only of Unicode spaces
  (for example U+00A0) would pass in Go but be rejected by the client, which
  uses `trim()`. Don't generate such strings.

## 9. Open backend decisions

These three questions have to be settled with the backend team before Phase 4B.
None of them blocks the client today. The client code and the schema already
cover every other part of the payload.

### 1. Elevation datum identifier and meaning

- **To decide:**
  - The exact string sent in `elevation.datum`.
  - The vertical surface it names (for example the Mars areoid used by the
    source DTMs).
  - Whether v1 always uses a single datum. If so, the schema can pin it with
    `const`.
- **Client today:** requires a non-empty string, stores it as is on
  `map.elevation.geo.datum`, and never converts between datums.
- **Why it matters:** rendered heights are relative to the map's median sample,
  so a constant offset doesn't change what is drawn. But `samplesMeters` and
  `TerrainCell.elevationMeters` are only meaningful against a known surface.
  Mixing datums would make two maps' metres incomparable.

### 2. DTM resampling and interpolation

- **Fixed already (§3):** the grid geometry, meaning where every sample sits.
- **To decide:**
  - How the backend computes the elevation at each sample point from the source
    DTM: bilinear, bicubic, nearest-neighbour, or an area-average over each
    sample's 10 m footprint.
  - How it handles a source resolution finer or coarser than the grid
    (`source.resolutionMeters` vs `grid.cellSizeMeters`).
  - Whether the method is recorded in the payload, for example as a provenance
    field in a later version.
- **Client today:** doesn't depend on the method. It averages each cell's four
  corners and interpolates bilinearly between corners when drawing (§5).
- **Why it matters:** an area-average smooths short features. Point
  interpolation keeps them but can alias. The same request should also always
  return the same samples.

### 3. Transport endpoint and error-response format

- **To decide:**
  - The endpoint path and method, and the request parameters (for example
    `center`, `seed`, or a location id).
  - Content type and compression. The full payload is about 19 KB of JSON
    before compression.
  - Caching.
  - The HTTP status codes and error body for cases such as "no DTM coverage at
    this location", "invalid request" and "upstream unavailable".
- **Client today:** `fetchMarsTerrain(seed)` (`src/terrain-kit/marsTerrainApi.ts`)
  calls `GET {baseUrl}/v1/mars-terrain/{seed}` for the mission and the development
  showcase. It tells "unreachable" (`MarsTerrainRequestError` with `status: null`)
  apart from an HTTP error status, but does not interpret status codes or error
  bodies further. The mission treats every failure (and a timeout) the same way:
  it starts on procedural terrain and says so; the showcase offers Retry.
  `MarsTerrainDataError` is the client's
  own validation error for a payload it received. It is not a server error
  format, and the server shouldn't reuse it.
- **Why it matters:** the client needs to tell "retry later" apart from "this
  location can never be served" to choose between retrying and falling back to
  a procedural map.

### Decided for v1

The backend team confirms these when implementing:

- NoData: incomplete tiles are rejected (§4).
- Seed: owned by the backend (§2).
- Horizontal convention: north-up local grid, equirectangular on R = 3,389,500 m,
  centres within ±85° (§3).
