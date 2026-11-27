import assert from 'node:assert/strict'
import { test } from 'node:test'
import fixture from '../../fixtures/plan-analysis-v2.json' with { type: 'json' }
import { prepareAnalysis } from '../../backend/plan-analysis.mts'
import { isAnalysisResponse, isComparisonAnalysisRequest, isSingleAnalysisRequest } from '../src/planning/analysis-contract.ts'

const { single, comparison } = fixture
const tumourCount = (release: string, id: string) => release === 'demo-1' && id === 'case-002' ? 100 : undefined
const selection = (analysis: NonNullable<ReturnType<typeof prepareAnalysis>>, actionIndex = 0) => ({
  findingId: analysis.providerInput.findings[0].id,
  observationIds: analysis.providerInput.requiredObservationIds,
  actionId: analysis.providerInput.actions[actionIndex].id,
  rationaleFactIds: analysis.providerInput.actions[actionIndex].rationaleFactIds,
})

test('v2 routes have distinct closed request and response shapes', () => {
  assert(isSingleAnalysisRequest(single.request))
  assert(isComparisonAnalysisRequest(comparison.request))
  assert(isAnalysisResponse(single.response, single.request))
  assert(isAnalysisResponse(comparison.response, comparison.request))
  const { revision: _, ...withoutRevision } = single.request
  assert(!isSingleAnalysisRequest(withoutRevision))
  assert(!isSingleAnalysisRequest({ ...single.request, filename: 'scan.nii' }))
  assert(!isSingleAnalysisRequest({ ...single.request, current: {
    ...single.request.current, measurements: { ...single.request.current.measurements, remainingMl: Infinity },
  } }))
  assert(!isComparisonAnalysisRequest({ ...comparison.request, planBId: comparison.request.planAId }))
  assert(!isComparisonAnalysisRequest({ ...comparison.request, planB: { ...comparison.request.planB, caseId: 'other' } }))
  assert(!isAnalysisResponse({ ...comparison.response, planAId: comparison.request.planBId }, comparison.request))
  assert(!isAnalysisResponse({ ...single.response, recommendation: {
    ...single.response.recommendation, action: 'open_plan_a',
  } }, single.request))
})

test('single-plan analysis checks the tested candidate and requires its gap observation', () => {
  const analysis = prepareAnalysis('single', single.request, tumourCount)
  assert(analysis)
  const picked = selection(analysis)
  const resolved = analysis.resolve(picked)
  assert.equal(resolved?.recommendation.action, 'preview_alternative')
  assert.match(resolved?.finding.text ?? '', /\+9 mm.*24 mL/)
  assert.equal(analysis.resolve({ ...picked, observationIds: [] }), undefined)
  assert.equal(analysis.resolve({ ...picked, rationaleFactIds: ['invented_margin'] }), undefined)
  assert.equal(analysis.resolve({ ...picked, actionId: 'open_plan_a' }), undefined)
  assert.equal(prepareAnalysis('single', single.request, () => 101), undefined)
  const invalid = structuredClone(single.request)
  invalid.search.alternative.angleDeg = 2
  assert.equal(prepareAnalysis('single', invalid, tumourCount), undefined)
  invalid.search.alternative.angleDeg = 0
  invalid.search.alternative.measurements.tumourPlaneDistanceMm = 0
  assert.equal(prepareAnalysis('single', invalid, tumourCount), undefined)
  assert.equal(prepareAnalysis('single', { ...single.request, current: {
    ...single.request.current, context: { reason: 'Custom text' },
  } }, tumourCount), undefined)
})

test('single-plan outcomes produce different findings and inspections without inventing candidates', () => {
  const { alternative: _, ...search } = single.request.search
  assert(isSingleAnalysisRequest(single.request))
  const current = { ...single.request.current, measurements: {
    ...single.request.current.measurements, tumourCentres: { removal: 0, retained: 100, onPlane: 0 },
  } }
  for (const outcome of ['current_best', 'no_gain', 'none_qualify'] as const) {
    const analysis = prepareAnalysis('single', {
      ...single.request, current: outcome === 'current_best' ? single.request.current : current,
      search: { ...search, outcome, qualifyingCount: outcome === 'none_qualify' ? 0 : 1 },
    }, tumourCount)
    assert(analysis)
    assert.equal(analysis.providerInput.findings[0].id, outcome)
    assert(analysis.providerInput.actions.every(item => item.id !== 'preview_alternative'))
    assert(analysis.resolve(selection(analysis)))
  }
})

test('comparison resolves the net volume gain and contact with matching evidence', () => {
  const analysis = prepareAnalysis('comparison', comparison.request, tumourCount)
  assert(analysis)
  const actionIndex = analysis.providerInput.actions.findIndex(action => action.id === 'open_plan_b')
  assert(actionIndex >= 0)
  const chosen = selection(analysis, actionIndex)
  const resolved = analysis.resolve({ ...chosen, observationIds: [...chosen.observationIds, 'flr_delta'] })
  assert.match(resolved?.finding.text ?? '', /B retains 10 mL.*B's plane touches/)
  assert.match(resolved?.observations[0].text ?? '', /20 mL.*10 mL/)
  assert.match(resolved?.observations[1].text ?? '', /\+10 percentage points/)
  assert(resolved?.limitations.includes('tumour_side_unmeasured'))
  assert.equal(analysis.resolve({ ...chosen, actionId: 'open_plan_a' }), undefined)
  assert.equal(analysis.resolve({ ...chosen, observationIds: [] }), undefined)
  assert(!JSON.stringify(analysis.providerInput).includes(comparison.request.caseId))
  const invalid = structuredClone(comparison.request)
  invalid.differenceVolumes.removedOnlyByAMl++
  assert.equal(prepareAnalysis('comparison', invalid, tumourCount), undefined)
})

test('comparison handles missing regions, equal FLR with distinct regions, and measured ties', () => {
  const { differenceVolumes: _, ...request } = comparison.request
  const unavailable = prepareAnalysis('comparison', { ...request, spatialStatus: 'unavailable' }, tumourCount)
  assert(unavailable)
  assert(unavailable.providerInput.limitations.includes('spatial_unavailable'))
  assert(!unavailable.providerInput.observations.some(observation => observation.id === 'exclusive_regions'))
  for (const exclusive of [20, 0]) {
    const equal = prepareAnalysis('comparison', {
      ...comparison.request, planB: comparison.request.planA, differenceVolumes: {
        removedOnlyByAMl: exclusive, removedOnlyByBMl: exclusive,
        removedByBothMl: 40 - exclusive, retainedByBothMl: 60 - exclusive,
      },
    }, tumourCount)
    assert(equal)
    assert.equal(equal.providerInput.findings[0].id, 'equal_remaining')
    assert.equal(equal.providerInput.observations.some(observation => observation.id === 'exclusive_regions'), exclusive > 0)
    assert(equal.providerInput.actions.some(action => action.id === 'view_measurements'))
    assert(equal.resolve(selection(equal)))
  }
})
