import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The dev server forwards backend paths to `just run` on port 8080.
const backend = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': backend, '/mcp': backend, '/healthz': backend },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
  },
})
