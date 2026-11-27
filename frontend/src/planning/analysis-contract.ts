import { Ajv } from 'ajv'
import schema from '../../../contracts/plan-analysis-v2.schema.json' with { type: 'json' }
import type { ResectionPlane } from './plane.ts'
import type { MeasuredVolumetry, PlanDifferenceResult, VolumetryResult } from './volumetry.ts'

type Identity = { version: 2; requestId: string; caseId: string; releaseId: string }
type Pair = { planAId: string; planBId: string }
type Revision = { revision: number }

export type AnalysisContext = { procedureType?: string; reason?: string }
type Cut<Measurements = VolumetryResult> = {
  caseId: string
  releaseId: string
  offsetMm: number
  angleDeg: number
  resectSide: ResectionPlane['resectSide']
  measurements: Measurements
  context?: AnalysisContext
}

export type SingleAnalysisRequest = Identity & Revision & {
  current: Cut<MeasuredVolumetry>
  search: {
    minOffsetMm: number
    maxOffsetMm: number
    testedCount: number
    qualifyingCount: number
  } & (
    | { outcome: 'improvement'; alternative: Cut<MeasuredVolumetry> }
    | { outcome: 'current_best' | 'no_gain' | 'none_qualify' }
  )
}
export type ComparisonAnalysisRequest = Identity & Pair & { planA: Cut; planB: Cut } & (
  | { spatialStatus: 'ready'; differenceVolumes: PlanDifferenceResult }
  | { spatialStatus: 'unavailable' }
)
export type AnalysisRequest = SingleAnalysisRequest | ComparisonAnalysisRequest
export type AnalysisFinding = { text: string; evidence: string[] }
export type AnalysisLimitation = 'volume_only' | 'geometric_gap_only' | 'tumour_side_unmeasured' | 'spatial_unavailable'
type SingleAction = 'preview_alternative' | 'inspect_plane' | 'inspect_removal_side' | 'view_measurements'
type ComparisonAction = 'open_plan_a' | 'open_plan_b' | 'show_differences' | 'view_measurements'
export type AnalysisAction = SingleAction | ComparisonAction
type Result<Action> = {
  finding: AnalysisFinding
  observations: AnalysisFinding[]
  limitations: AnalysisLimitation[]
  recommendation: { action: Action; rationale: string; evidence: string[] }
}
export type AnalysisResponse = Identity & (
  | (Revision & { mode: 'single' } & Result<SingleAction>)
  | (Pair & { mode: 'comparison' } & Result<ComparisonAction>)
)

const ajv = new Ajv()
const singleRequest = ajv.compile<SingleAnalysisRequest>({ ...schema, $ref: '#/definitions/singleRequest' })
const comparisonRequest = ajv.compile<ComparisonAnalysisRequest>({ ...schema, $ref: '#/definitions/comparisonRequest' })
const singleResponse = ajv.compile<Extract<AnalysisResponse, { mode: 'single' }>>({
  ...schema, $ref: '#/definitions/singleResponse',
})
const comparisonResponse = ajv.compile<Extract<AnalysisResponse, { mode: 'comparison' }>>({
  ...schema, $ref: '#/definitions/comparisonResponse',
})

export function isSingleAnalysisRequest(value: unknown): value is SingleAnalysisRequest {
  return singleRequest(value) && sameCase(value, value.current)
    && (value.search.outcome !== 'improvement' || sameCase(value, value.search.alternative))
}

export function isComparisonAnalysisRequest(value: unknown): value is ComparisonAnalysisRequest {
  return comparisonRequest(value) && value.planAId !== value.planBId
    && sameCase(value, value.planA) && sameCase(value, value.planB)
}

function sameCase(a: Pick<Identity, 'caseId' | 'releaseId'>, b: Pick<Identity, 'caseId' | 'releaseId'>): boolean {
  return a.caseId === b.caseId && a.releaseId === b.releaseId
}

export function isAnalysisResponse(value: unknown, request: AnalysisRequest): value is AnalysisResponse {
  const matches = 'revision' in request
    ? singleResponse(value) && value.revision === request.revision
    : comparisonResponse(value) && value.planAId === request.planAId && value.planBId === request.planBId
  if (!matches) return false
  const response = value as AnalysisResponse
  return response.requestId === request.requestId && sameCase(response, request)
    && [response.finding, ...response.observations, response.recommendation].every(item =>
      item.evidence.every(path => {
        let target: unknown = request
        for (const key of path.split('.')) {
          if (typeof target !== 'object' || target === null || !Object.hasOwn(target, key)) return false
          target = (target as Record<string, unknown>)[key]
        }
        return target !== undefined
      }))
}
