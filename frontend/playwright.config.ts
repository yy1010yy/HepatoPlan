import { defineConfig } from '@playwright/test'
import { productionFixture } from './browser-tests/research-paths.ts'

const origin = 'http://127.0.0.1:4179'
const baseURL = productionFixture ? origin + '/demo/' : origin + '/'

export default defineConfig({
  testDir: './browser-tests',
  timeout: 45_000,
  use: {
    actionTimeout: 8_000,
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: productionFixture
      ? 'vite preview --config browser-tests/vite.config.ts --mode fixture-build --host 127.0.0.1 --port 4179 --strictPort'
      : 'vite --config browser-tests/vite.config.ts --host 127.0.0.1 --port 4179 --strictPort',
    url: new URL('browser-tests/fixture.html', baseURL).href,
    reuseExistingServer: false,
  },
})
