import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Backend (Hono) port — keep in sync with the PORT env passed to `deno task dev:server`.
const backend = `http://localhost:${process.env.BACKEND_PORT || 8000}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': backend,
      '/shared': backend,
      '/kv': backend,
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
