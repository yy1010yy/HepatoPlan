import { Ajv } from 'ajv'
import schema from '../../../contracts/plan-comparison-explanation.schema.json' with { type: 'json' }
import type { PlanDifferenceResult, VolumetryResult } from './volumetry.ts'

type ComparisonIdentity = {
  releaseId: string
  caseId: string
  planAId: string
  planBId: string
}

type ScopedMeasurements = VolumetryResult & Pick<ComparisonIdentity, 'releaseId' | 'caseId'>

export type ExplanationRequest = ComparisonIdentity & {
  planA: ScopedMeasurements
  planB: ScopedMeasurements
  differenceVolumes?: PlanDifferenceResult
}

export type ExplanationResponse = ComparisonIdentity & { explanation: string }

const ajv = new Ajv()
const validRequest = ajv.compile<ExplanationRequest>({ $ref: '#/definitions/request', ...schema })
const validResponse = ajv.compile<ExplanationResponse>({ $ref: '#/definitions/response', ...schema })

export function isExplanationRequest(value: unknown): value is ExplanationRequest {
  return validRequest(value) && value.planAId !== value.planBId
    && [value.planA, value.planB].every(
      plan => plan.caseId === value.caseId && plan.releaseId === value.releaseId,
    )
}

export function isExplanationResponse(
  value: unknown,
  expected: ComparisonIdentity,
): value is ExplanationResponse {
  return validResponse(value) && value.caseId === expected.caseId
    && value.releaseId === expected.releaseId
    && value.planAId === expected.planAId && value.planBId === expected.planBId
}
