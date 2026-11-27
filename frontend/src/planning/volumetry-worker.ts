import type { CaseMetadata, Vec3 } from './case-contract.ts'
import type { ResectionPlane } from './plane.ts'
import type { OffsetSearchResult, PlanDifferenceResult, VolumetryResult } from './volumetry.ts'

export type InitialiseVolumetry = {
  type: 'initialise'
  selectionToken: number
  metadata: CaseMetadata
  labels: ArrayBuffer
}

export type EvaluateVolumetry = {
  type: 'evaluate'
  selectionToken: number
  revision: number
  plane: ResectionPlane
}

export type ComparisonIdentity = {
  selectionToken: number
  comparisonRequestId: number
  planAId: string
  planBId: string
}

export type ComparePlans = ComparisonIdentity & {
  type: 'comparePlans'
  planeA: ResectionPlane
  planeB: ResectionPlane
}

export type VolumetryJob = EvaluateVolumetry | ComparePlans
export type SearchIdentity = { selectionToken: number; revision: number; searchRequestId: number }
export type SearchOffsets = SearchIdentity & {
  type: 'searchOffsets'; plane: ResectionPlane; centre: Vec3; limit: number; currentOffsetMm: number
}
export type CancelSearch = SearchIdentity & { type: 'cancelSearch' }
export type VolumetryWorkerRequest = InitialiseVolumetry | VolumetryJob | SearchOffsets | CancelSearch

export type VolumetryWorkerResponse =
  | { type: 'ready'; selectionToken: number }
  | { type: 'initialisationError'; selectionToken: number; message: string }
  | { type: 'result'; selectionToken: number; revision: number; result: VolumetryResult; evaluationMs?: number }
  | { type: 'calculationError'; selectionToken: number; revision: number; message: string }
  | (ComparisonIdentity & { type: 'comparePlansResult'; result: PlanDifferenceResult })
  | (ComparisonIdentity & { type: 'comparePlansError'; message: string })
  | (SearchIdentity & { type: 'searchResult'; result: OffsetSearchResult })
  | (SearchIdentity & { type: 'searchError'; message: string })

export function startVolumetryWorker(
  selectionToken: number, metadata: CaseMetadata, labels: ArrayBuffer,
): Worker {
  const worker = new Worker(new URL('./volumetry.worker.ts', import.meta.url), { type: 'module' })
  try {
    worker.postMessage({ type: 'initialise', selectionToken, metadata, labels } satisfies InitialiseVolumetry, [labels])
    return worker
  } catch (error) {
    worker.terminate()
    throw error
  }
}
