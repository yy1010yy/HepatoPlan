import { defineConfig } from '@playwright/test'
import fixtureConfig from './playwright.config.ts'

const origin = 'http://127.0.0.1:4181'
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
    command: 'vite preview --base=/demo/ --host 127.0.0.1 --port 4181 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
})
