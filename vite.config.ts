import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Local Go server (server Compose publishes it on 8081); only the dev server proxies to it. */
const DEV_BACKEND_URL = 'http://localhost:8081'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['playjam.study'],
    proxy: {
      // Same-origin in development: the mission and showcase fetch `/v1/mars-terrain/{seed}` without CORS setup.
      '/v1/mars-terrain': DEV_BACKEND_URL,
      '/ws': {
        target: DEV_BACKEND_URL,
        ws: true,
      },
    },
  },
})
