/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the Go gateway, e.g. ws://localhost:8081/ws */
  readonly VITE_SERVER_URL?: string
  /** "true" forces the mock server even if VITE_SERVER_URL is set. */
  readonly VITE_USE_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
