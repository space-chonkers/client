# Game client

A minimal Bun + TypeScript + React + Three.js client. The current screen is the
Martian terrain showcase: the Layer −1 terrain system on the full 50×50 cell grid
(each cell holds a relief value in [-1, 1] that drives geometry and asset
placement, with debug views) plus an asset gallery. Layer −1 is environmental
only: bases, corridors and other walkable surfaces belong to Layer 0.

- `src/terrain-kit/reliefMap.ts`: cell model and seeded generation.
- `src/terrain-kit/reliefTerrain.ts`: chunked terrain mesh and baked dressing.
- `src/terrain-kit/placement.ts`: grounds assets on the rendered surface.
- `src/terrain-kit/minerals.ts`: Mars-inspired deposits (hematite, gypsum, olivine, sulfur).
- `src/showcase/`: the showcase UI; `window.__THREE_GAME_DIAGNOSTICS__` exposes render stats. The production container serves the built static client;
game/backend server logic belongs in its separate repo.

## Local development

Install [Bun](https://bun.sh), then run:

```sh
bun install
bun run dev
```

Vite prints the local URL (normally <http://localhost:5173>). Run the production
build locally with `bun run build`.

## Container

Build and run the same static production image locally or on a VM with Docker
Compose:

```sh
docker compose up --build
```

Open <http://localhost:8080>. Stop it with `Ctrl+C`; use `docker compose down` to
remove the stopped container. The image is a multi-stage build: Bun compiles the
client, and Nginx serves the resulting static files. No API proxy or backend is
configured.
