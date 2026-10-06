import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// BASE_PATH lets the same build run at a domain root ("/") or under a sub-path
// (e.g. "/satlapse/" on GitHub Pages) with no code changes.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        spike: resolve(import.meta.dirname, 'spike.html'),
      },
    },
  },
})
