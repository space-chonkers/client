import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Local Go server (see the server README); only the dev server proxies to it. */
const DEV_BACKEND_URL = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin in development: the terrain showcase fetches `/v1/mars-terrain/{seed}` without CORS setup.
    proxy: {
      '/v1/mars-terrain': DEV_BACKEND_URL,
    },
  },
})
