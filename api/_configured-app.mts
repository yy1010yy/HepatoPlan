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

const key = process.env.GEMINI_API_KEY?.trim()
const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
export const analysisApp = createAnalysisApp({
  findTumourCount: (releaseId, caseId) => releaseId === index.releaseId ? tumourCounts.get(caseId) : undefined,
  provider: key ? createGeminiProvider(key, model) : undefined,
})
