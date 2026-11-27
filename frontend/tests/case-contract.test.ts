import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Ajv } from 'ajv'
import type { CaseIndex, CaseMetadata } from '../src/planning/case-contract.ts'

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
}

const ajv = new Ajv()
const validateIndex = ajv.compile<CaseIndex>(
  readJson('../../contracts/case-index.schema.json') as object,
)
const validateMetadata = ajv.compile<CaseMetadata>(
  readJson('../../contracts/case-metadata.schema.json') as object,
)

const fixtureIndexUrl = '../../fixtures/cases/index.json'

test('version 1 index resolves to metadata for the same release and case', () => {
  const index = readJson(fixtureIndexUrl)
  assert.ok(validateIndex(index), ajv.errorsText(validateIndex.errors))
  assert.equal(index.cases.length, 1)

  for (const { caseId } of index.cases) {
    const metadata = readJson(
      `../../fixtures/cases/releases/${index.releaseId}/${caseId}/metadata.json`,
    )
    assert.ok(validateMetadata(metadata), ajv.errorsText(validateMetadata.errors))
    assert.equal(metadata.caseId, caseId)
    assert.equal(metadata.releaseId, index.releaseId)
    assert.deepEqual(metadata.dimensions, [3, 4, 5])
    assert.deepEqual(metadata.voxelToWorldMm[0], [-2, 0, 0, 10])
  }
})

test('the published case index is valid', () => {
  const index = readJson('../../public/cases/index.json')
  assert.ok(validateIndex(index), ajv.errorsText(validateIndex.errors))
})

test('indexes reject duplicate and invalid identifiers', () => {
  const index = readJson(fixtureIndexUrl)
  assert.ok(validateIndex(index))
  assert.equal(validateIndex({ ...index, cases: [...index.cases, ...index.cases] }), false)
  for (const caseId of ['../case-002', 'CASE-002', 'case-002\n']) {
    assert.equal(validateIndex({ ...index, cases: [{ caseId }] }), false)
  }
})
