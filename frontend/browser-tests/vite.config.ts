import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { researchPublic } from './research-paths.ts'

export default defineConfig(({ mode }) => {
  if (mode !== 'fixture-build') {
    return { publicDir: process.env.HEPATOPLAN_RESEARCH_TEST ? researchPublic : false }
  }
  return {
    base: '/demo/',
    publicDir: fileURLToPath(new URL('../../public/', import.meta.url)),
    build: {
      outDir: 'dist/fixture',
      rollupOptions: { input: fileURLToPath(new URL('./fixture.html', import.meta.url)) },
    },
  }
})
