import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const preparedAsset = /^cases\/releases\/[a-z0-9-]+\/(?:ATTRIBUTION\.txt|[a-z0-9-]+\/(?:metadata\.json|labels\.bin|liver\.stl|tumour\.stl))$/

export default defineConfig({
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
  build: { outDir: 'dist/app' },
  plugins: [{
    name: 'hepatoplan-case-cache',
    configurePreviewServer(server) {
      const { base, root, build } = server.config
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        const relative = path?.startsWith(base) ? path.slice(base.length) : ''
        const cache = relative === 'cases/index.json' ? 'no-cache'
          : preparedAsset.test(relative) ? 'public, max-age=31536000, immutable' : undefined
        if (cache && existsSync(resolve(root, build.outDir, relative))) {
          res.setHeader('Cache-Control', cache)
        }
        next()
      })
    },
  }],
})
