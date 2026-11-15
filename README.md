# Game client

A minimal Bun + TypeScript + React + Three.js client. The sample screen renders a
spinning Three.js cube. The production container serves the built static client;
game/backend server logic belongs in its separate repo.

## Local development

Install [Bun](https://bun.sh), then run:

```sh
bun install
bun run dev
```

Vite prints the local URL (normally <http://localhost:5173>). Run the production
build locally with `bun run build`. Run the tests with `bun test`.

Without `VITE_SERVER_URL` the client uses a mock server, so no backend is needed.
See [`.env.example`](.env.example).

## Docs

- [Economy](docs/economy.md): shared stash, team pool, resource-to-money conversion and the server contract.

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
