import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: process.env.HEPATOPLAN_RESEARCH_TEST ? '.local/research-public' : false,
})
