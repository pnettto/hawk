import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Backend (`wrangler dev`) port — keep in sync with `npm run dev:server`.
const backend = `http://localhost:${process.env.BACKEND_PORT || 8787}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backend, ws: true },
      '/shared': backend,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    server: {
      deps: {
        inline: ['@testing-library/svelte'],
      },
    },
  },
  resolve: {
    conditions: process.env.VITEST ? ['browser'] : undefined,
  },
})
