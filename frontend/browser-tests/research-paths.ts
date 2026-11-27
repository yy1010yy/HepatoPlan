import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export const productionFixture = process.env.HEPATOPLAN_FIXTURE_BUILD === '1'
export const researchPublic = productionFixture
  ? resolve(repoRoot, 'frontend/dist/fixture')
  : resolve(process.env.HEPATOPLAN_RESEARCH_PUBLIC_DIR ?? resolve(repoRoot, 'backend/.local/research-public'))

export const researchReports = resolve(repoRoot, 'backend/.local')
