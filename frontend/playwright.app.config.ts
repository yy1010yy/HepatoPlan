import { defineConfig } from '@playwright/test'
import fixtureConfig from './playwright.config.ts'

const port = Number(process.env.HEPATOPLAN_APP_TEST_PORT ?? 4181)
const origin = `http://127.0.0.1:${port}`
const baseURL = origin + '/demo/'

export default defineConfig({
  ...fixtureConfig,
  testDir: './app-tests',
  use: {
    ...fixtureConfig.use,
    baseURL,
    ...(process.env.HEPATOPLAN_APP_DEFAULT_GL === '1' ? { launchOptions: {} } : {}),
  },
  webServer: {
    command: `vite preview --base=/demo/ --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
})
