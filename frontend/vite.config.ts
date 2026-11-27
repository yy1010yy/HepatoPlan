import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
  build: { outDir: 'dist/app' },
})
