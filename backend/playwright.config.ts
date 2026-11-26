import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests',
  timeout: 45_000,
  use: {
    actionTimeout: 8_000,
    baseURL: 'http://127.0.0.1:4179',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'vite --config browser-tests/vite.config.ts --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179/browser-tests/fixture.html',
    reuseExistingServer: false,
  },
})
