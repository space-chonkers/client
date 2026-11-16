# Multiplayer integration

The client connects to `/ws` on its own origin, or to `VITE_WS_URL` when
configured at build time. The integration Compose file proxies `/ws` to the
server. Solo creates and starts a lobby; co-op supports creating, quick joining,
joining by code, and starting as host.

The server advertises `tickRate` and `frameRate` in `welcome`; both default to
60 Hz. While moving, the client sends one input per advertised tick, and draws
authoritative player positions from server frames without local prediction or
reconciliation. Frames are lossy, and actual rendering and responsiveness still
depend on browser performance and network latency. The current server applies
movement when an input arrives, advancing by one tick per input; it does not run
a separate clock-driven movement simulation.

The HUD shows server-owned pool and stash balances. By default, stash generation
per second equals pool consumption per second for every resource. Players must
still collect before a stash fills, and building spends resources. B5 phenomena
are not implemented yet.

Known protocol errors are mapped to player-facing messages rather than displaying
raw server payloads. See `action_buttons.md` for build and collect controls.
