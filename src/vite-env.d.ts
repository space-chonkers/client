/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Backend origin serving `GET /v1/mars-terrain/{seed}` for production builds
   * (e.g. `https://api.example`, or `/` when a reverse proxy routes it on the
   * client's own origin). Unset in production: missions use procedural terrain.
   * Development ignores it unless set, and uses the Vite proxy.
   */
  readonly VITE_MARS_TERRAIN_API_URL?: string
}
