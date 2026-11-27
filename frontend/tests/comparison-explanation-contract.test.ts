import assert from 'node:assert/strict'
import { test } from 'node:test'
import example from '../../fixtures/plan-comparison-explanation.json' with { type: 'json' }
import { isExplanationRequest, isExplanationResponse } from '../src/planning/comparison-explanation-contract.ts'

const { request, response } = example

test('comparison explanation requests accept both forms of the ordered pair', () => {
  assert.ok(isExplanationRequest(request))
  const { differenceVolumes: _, ...withoutDifferences } = request
  assert.ok(isExplanationRequest(withoutDifferences))
})

test('comparison explanation requests reject invalid measurements and mixed identities', () => {
  const { remainingMl: _, ...missingMeasurement } = request.planA
  for (const planA of [
    missingMeasurement,
    { ...request.planA, remainingMl: Number.NaN },
    { ...request.planA, remainingMl: Infinity },
    { ...request.planA, caseId: 'case-003' },
    { ...request.planA, releaseId: 'another-release' },
  ]) {
    assert.equal(isExplanationRequest({ ...request, planA }), false)
  }
  assert.equal(isExplanationRequest({ ...request, planBId: request.planAId }), false)
})

test('comparison explanation requests reject file fields and free-form notes', () => {
  assert.equal(isExplanationRequest({ ...request, file: 'scan.nii.gz' }), false)
  assert.equal(isExplanationRequest({ ...request, planB: { ...request.planB, notes: 'private' } }), false)
})

test('comparison explanations must match the current ordered pair', () => {
  assert.ok(isExplanationResponse(response, request))
  assert.equal(isExplanationResponse({ ...response, explanation: ' ' }, request), false)
  assert.equal(isExplanationResponse({ ...response, releaseId: 'new-release' }, request), false)
  assert.equal(isExplanationResponse({
    ...response, planAId: response.planBId, planBId: response.planAId,
  }, request), false)
})
