import { readFile } from 'node:fs/promises'
import { createAnalysisApp } from './app.mts'
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini.mts'
import { validateCaseIndex, validateCaseMetadata } from '../frontend/src/planning/case-loader.ts'

const catalogueRoot = new URL('../public/cases/', import.meta.url)
const index: unknown = JSON.parse(await readFile(new URL('index.json', catalogueRoot), 'utf8'))
if (!validateCaseIndex(index)) throw new Error('Prepared case index is invalid.')
const tumourCounts = new Map(await Promise.all(index.cases.map(async ({ caseId }) => {
  const path = new URL(`releases/${index.releaseId}/${caseId}/metadata.json`, catalogueRoot)
  const metadata: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!validateCaseMetadata(metadata) || metadata.caseId !== caseId || metadata.releaseId !== index.releaseId) {
    throw new Error(`Invalid prepared metadata for ${caseId}.`)
  }
  return [caseId, metadata.labelCounts.tumour] as const
})))

const port = Number(process.env.HEPATOPLAN_API_PORT ?? 4191)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid HEPATOPLAN_API_PORT.')
const key = process.env.GEMINI_API_KEY?.trim()
const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
const app = createAnalysisApp({
  findTumourCount: (releaseId, caseId) => releaseId === index.releaseId ? tumourCounts.get(caseId) : undefined,
  provider: key ? createGeminiProvider(key, model) : undefined,
})
const server = app.listen(port, '127.0.0.1', () => console.info(`Analysis API at http://127.0.0.1:${port}`))
server.on('error', error => {
  console.error(error.message)
  process.exitCode = 1
})
