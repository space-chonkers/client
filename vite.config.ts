import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['playjam.study'],
    proxy: {
      '/ws': {
        target: 'http://localhost:8081',
        ws: true,
      },
    },
  },
})
