# Game client

A Bun + TypeScript + React + Three.js cooperative game client. The production
container serves the static client; authoritative match state and gameplay are
provided by the separate server repository.

The procedural Layer −1 Martian terrain lives in `src/terrain-kit/`. In development,
open `/?view=terrain-showcase` to inspect it; see
[docs/terrain_layer_minus_1.md](docs/terrain_layer_minus_1.md).

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

Open <http://localhost:5173>. Start the server separately with its Compose file
or set `VITE_WS_URL` to the reachable WebSocket endpoint before building. The
client Compose default targets `ws://localhost:8081/ws`. Stop it with `Ctrl+C`;
use `docker compose down` to remove the stopped container. The image is a
multi-stage build: Bun compiles the client, and Nginx serves the static files.
