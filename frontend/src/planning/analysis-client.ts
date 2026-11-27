import type { DecodedMesh } from './binary-stl.ts'
import type { CaseState, ComparisonPair } from './case-controller.ts'
import { isAnalysisResponse, isComparisonAnalysisRequest, isSingleAnalysisRequest } from './analysis-contract.ts'
import type { AnalysisContext, AnalysisRequest, AnalysisResponse, ComparisonAnalysisRequest, SingleAnalysisRequest } from './analysis-contract.ts'
import { planContextOptions } from '../plan-context.ts'
import { planeReadouts } from './plane-controls.ts'
import type { ResectionPlane } from './plane.ts'
import type { MeasuredVolumetry, OffsetSearchResult, PlanDifferenceResult, VolumetryResult } from './volumetry.ts'

type ReadyCase = Extract<CaseState, { status: 'ready' }>

export function analysisContext(values: AnalysisContext): AnalysisContext | undefined {
  const context: AnalysisContext = {}
  for (const key of ['procedureType', 'reason'] as const) {
    const candidate = values[key]
    if (candidate && planContextOptions[key].groups.some(group => group.options.includes(candidate))) context[key] = candidate
  }
  return context.procedureType || context.reason ? context : undefined
}

function copyMeasurements(result: VolumetryResult): VolumetryResult {
  const { totalParenchymaMl, resectedMl, remainingMl, flrPercent, resectedPercent,
    tumourIntersectsPlane, tumourPlaneDistanceMm, tumourCentres } = result
  return {
    totalParenchymaMl, resectedMl, remainingMl, flrPercent, resectedPercent, tumourIntersectsPlane, tumourPlaneDistanceMm,
    ...(tumourCentres && { tumourCentres: {
      removal: tumourCentres.removal, retained: tumourCentres.retained, onPlane: tumourCentres.onPlane,
    } }),
  }
}

function cut(bounds: DecodedMesh['bounds'], caseId: string, releaseId: string,
  plane: ResectionPlane, result: VolumetryResult, context?: AnalysisContext) {
  const { offsetMm, angleDeg } = planeReadouts(bounds, plane)
  const nearestDegree = Math.round(angleDeg)
  return {
    caseId, releaseId, offsetMm: Math.round(offsetMm),
    angleDeg: Math.abs(angleDeg - nearestDegree) < 1e-9 ? nearestDegree : angleDeg,
    resectSide: plane.resectSide, measurements: copyMeasurements(result),
    ...(context && { context }),
  }
}

function newRequestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function singleAnalysisRequest(state: ReadyCase, search: OffsetSearchResult, values?: AnalysisContext): SingleAnalysisRequest {
  if (state.measurements.status !== 'ready' || !state.measurements.result.tumourCentres) {
    throw new Error('Current tumour measurements are required for analysis.')
  }
  const { caseId, revision, metadata: { releaseId }, liver: { bounds }, plane } = state
  const current = cut(bounds, caseId, releaseId, plane, state.measurements.result, analysisContext(values ?? {}))
  const { minOffsetMm, maxOffsetMm, testedCount, qualifyingCount, outcome } = search
  const request = {
    version: 2, requestId: newRequestId(), caseId, releaseId, revision, current,
    search: {
      minOffsetMm, maxOffsetMm, testedCount, qualifyingCount, outcome,
      ...(search.outcome === 'improvement' && { alternative: {
        ...cut(bounds, caseId, releaseId, search.alternative.plane, search.alternative.result),
        offsetMm: search.alternative.offsetMm,
      } }),
    },
  }
  if (!isSingleAnalysisRequest(request)) throw new Error('The current cut cannot be sent for analysis.')
  return request
}

export function comparisonAnalysisRequest(
  state: ReadyCase, [a, b]: ComparisonPair, difference?: PlanDifferenceResult,
): ComparisonAnalysisRequest {
  const { caseId, metadata: { releaseId }, liver: { bounds } } = state
  const request = {
    version: 2, requestId: newRequestId(), caseId, releaseId, planAId: a.id, planBId: b.id,
    planA: cut(bounds, a.caseId, a.releaseId, a.plane, a.result, analysisContext(a)),
    planB: cut(bounds, b.caseId, b.releaseId, b.plane, b.result, analysisContext(b)),
    ...(difference ? { spatialStatus: 'ready', differenceVolumes: {
      removedOnlyByAMl: difference.removedOnlyByAMl, removedOnlyByBMl: difference.removedOnlyByBMl,
      removedByBothMl: difference.removedByBothMl, retainedByBothMl: difference.retainedByBothMl,
    } } : { spatialStatus: 'unavailable' }),
  }
  if (!isComparisonAnalysisRequest(request)) throw new Error('The selected pair cannot be sent for analysis.')
  return request
}

export async function fetchAnalysis(request: AnalysisRequest, signal: AbortSignal, fetcher = fetch): Promise<AnalysisResponse> {
  signal.throwIfAborted()
  const path = 'revision' in request ? '/api/plans/explain' : '/api/plan-comparisons/explain'
  const response = await fetcher(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(request),
  })
  signal.throwIfAborted()
  if (!response.ok) throw new Error('AI analysis unavailable.')
  const result: unknown = await response.json()
  signal.throwIfAborted()
  if (!isAnalysisResponse(result, request)) throw new Error('The analysis response does not match this request.')
  if (result.recommendation.action === 'preview_alternative'
      && (!('revision' in request) || request.search.outcome !== 'improvement')) {
    throw new Error('The requested cut has no measured alternative.')
  }
  return result
}

// One attempt owns its search, fetch and response. Leave or retry by cancelling that attempt.
export class AnalysisAttempt {
  #active?: AbortController

  start(): AbortSignal {
    this.cancel()
    this.#active = new AbortController()
    return this.#active.signal
  }

  cancel(): void {
    this.#active?.abort()
    this.#active = undefined
  }
}
