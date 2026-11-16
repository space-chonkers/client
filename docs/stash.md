# Stash (`Stash.tsx`)

## 1. Overview

`Stash` provides a low-poly sci-fi cargo box designed to sit centered on one Layer `0` space corridor tile. Its charcoal design (chamfered cube, wrap-around corner guards, lid seam, coral status light) is inspired by a "deep space ops" cargo box reference.

### Objectives
- Build a procedural `THREE.Group` cargo box with a chamfered body, lid seam, 8 corner guards, a top pad, side handles, and a glowing status light.
- Provide a standalone React preview showing the stash on a cross corridor tile.

### Scope
- **Included:** `STASH_PALETTE`, `STASH_DIMENSIONS`, the `createStash()` factory, and the `<Stash />` preview component.
- **Excluded:** Inventory or storage logic, player interaction, and automatic placement on the world grid.

## 2. Architecture

### Directory Structure

```text
src/
└── assets/
    ├── SpaceCorridor.tsx
    └── Stash.tsx
```

### Architectural Responsibilities
- `Stash.tsx` contains only procedural geometry construction for the stash and its preview.
- The preview reuses `createCrossCorridor`, `layerToWorldY`, `SPATIAL_LAYERS`, and `CORRIDOR_PALETTE` from `SpaceCorridor.tsx` instead of duplicating them. The status light reuses `CORRIDOR_PALETTE.coralMarker`.

## 3. Implementation Details

### Components

| Component | Responsibility |
|---|---|
| `Stash` | Mounts a Three.js `WebGLRenderer` canvas that shows a stash centered on a rotating cross corridor tile and disposes GPU resources on unmount. |

### Utilities

| Utility | Responsibility |
|---|---|
| `createStash()` | Builds the stash `THREE.Group`. Its origin is the center of the box's bottom face; the status light faces `+Z` (south). |
| `extrudeFootprint(points, height)` | Internal. Extrudes a ground-plane (X/Z) outline straight up; used for the body, seam, corner guards, and top pad. |
| `chamferedRectangle(width, depth, chamfer)` | Internal. Rectangle outline with its four corners cut off. |
| `cornerGuardOutline(halfWidth, halfDepth, length)` | Internal. Outline of the `(+X, +Z)` corner guard; the other corners rotate it in 90° steps. |

### Constants

| Constant | Value |
|---|---|
| `STASH_PALETTE` | `body: #24272b` (glossy), `guard: #3a3e44` (matte), `seam: #141618`, `light: CORRIDOR_PALETTE.coralMarker` (`#ff595e`, emissive) |
| `STASH_DIMENSIONS` | `width: 0.45`, `depth: 0.45`, `height: 0.45` (world units; one corridor tile is `1 x 1`) |

## 4. Business Logic

### Main Workflow
1. Extrude a chamfered `0.45 x 0.45 x 0.45` body resting on `Y = 0`.
2. Wrap a dark lid seam band around the body at 62% of its height.
3. Add 8 corner guards (4 at the bottom, 4 at the top rising slightly above the lid), each wrapping two faces with a chamfered outer edge.
4. Add an octagonal pad on top of the lid.
5. Add bar handles with two standoffs on the west and east sides.
6. Add a glowing coral status light on the front (`+Z`) face, centered on the lid seam.

### Placing on a Corridor Tile
Add the stash as a child of a corridor segment and raise it onto the floor deck, whose top is at `Y = 0.08` in the segment's local space:

```ts
const tile = createCrossCorridor()
const stash = createStash()
stash.position.y = 0.08
tile.add(stash)
```

Rotate the stash around `Y` in `Math.PI / 2` steps to turn the status light toward another side.

## 5. Data Management

### Data Sources
- Static constants (`STASH_PALETTE`, `STASH_DIMENSIONS`).

### State Management
- Stateless factory; the preview component holds only a `useRef<HTMLDivElement>` for its canvas container.

## 6. API and Integrations

This feature does not use external APIs or network integrations.

## 7. Configuration and Environment Variables

No environment variables are required.

## 8. Error Handling

| Scenario | Expected Behavior |
|---|---|
| Zero-sized container on mount/resize | `resize()` skips projection updates until valid dimensions exist. |

## 9. Security Considerations

No user credentials, network inputs, or external resources are processed.

## 10. Performance Considerations

- The 8 corner guards share one geometry, and the handle bars and standoffs share one geometry each. Each stash creates 4 materials shared across its meshes.
- On unmount, the preview cancels the animation frame, disconnects the `ResizeObserver`, and disposes all geometries, materials, and the `WebGLRenderer`.

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
| `three` | 3D geometry, materials, lights, and WebGL rendering |

## 13. Known Limitations

- The corridor floor deck height (`0.08`) is duplicated as a local constant in `Stash.tsx` because `SpaceCorridor.tsx` does not export it.
- At `0.45` tall, the stash is as tall as the corridor walls (`0.45`).
- The `<Stash />` preview is not mounted anywhere in the app.

## 14. Change History

| Date | Version | Description |
|---|---|---|
| 2026-11-15 | 1.0.0 | Initial stash cargo box asset and preview |
| 2026-11-15 | 1.1.0 | Redesigned as a charcoal sci-fi cargo box (chamfered cube, corner guards, top pad, side handles, coral status light) |
