import { comparePlans, PreparedCase } from './volumetry.ts'
import type { SearchIdentity, SearchOffsets, VolumetryWorkerRequest, VolumetryWorkerResponse } from './volumetry-worker.ts'

const port = globalThis as unknown as {
  onmessage: ((event: MessageEvent<VolumetryWorkerRequest>) => void) | null
  postMessage(message: VolumetryWorkerResponse): void
}

let active: { selectionToken: number; preparedCase: PreparedCase } | undefined
let search: SearchIdentity | undefined

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runSearch({ selectionToken, revision, searchRequestId, plane, centre, limit, currentOffsetMm }: SearchOffsets) {
  const identity = { selectionToken, revision, searchRequestId }
  search = identity
  try {
    if (!active || active.selectionToken !== selectionToken) throw new Error('Worker is not ready for this selection.')
    const steps = active.preparedCase.searchOffsets(plane, centre, limit, currentOffsetMm)
    while (search === identity) {
      const deadline = performance.now() + 8
      do {
        const step = steps.next()
        if (step.done) {
          port.postMessage({ type: 'searchResult', ...identity, result: step.value })
          return
        }
      } while (performance.now() < deadline)
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
  } catch (error) {
    if (search === identity) port.postMessage({ type: 'searchError', ...identity, message: describe(error) })
  } finally {
    if (search === identity) search = undefined
  }
}

port.onmessage = ({ data }) => {
  if (data.type === 'initialise') {
    const { selectionToken, metadata, labels } = data
    try {
      if (active) throw new Error('Worker already holds a prepared case.')
      const preparedCase = new PreparedCase(metadata, new Uint8Array(labels))
      active = { selectionToken, preparedCase }
      port.postMessage({ type: 'ready', selectionToken })
    } catch (error) {
      port.postMessage({ type: 'initialisationError', selectionToken, message: describe(error) })
    }
  } else if (data.type === 'searchOffsets') {
    void runSearch(data)
  } else if (data.type === 'cancelSearch') {
    if (search?.selectionToken === data.selectionToken && search.revision === data.revision
        && search.searchRequestId === data.searchRequestId) search = undefined
  } else if (data.type === 'evaluate') {
    const { selectionToken, revision, plane } = data
    try {
      if (!active || active.selectionToken !== selectionToken) {
        throw new Error('Worker is not ready for this selection.')
      }
      const started = performance.now()
      const result = active.preparedCase.evaluate(plane)
      port.postMessage({ type: 'result', selectionToken, revision, result, evaluationMs: performance.now() - started })
    } catch (error) {
      port.postMessage({ type: 'calculationError', selectionToken, revision, message: describe(error) })
    }
  } else if (data.type === 'comparePlans') {
    const { selectionToken, comparisonRequestId, planAId, planBId, planeA, planeB } = data
    const identity = { selectionToken, comparisonRequestId, planAId, planBId }
    try {
      if (!active || active.selectionToken !== selectionToken) {
        throw new Error('Worker is not ready for this selection.')
      }
      const result = comparePlans(active.preparedCase, planeA, planeB)
      port.postMessage({ type: 'comparePlansResult', ...identity, result })
    } catch (error) {
      port.postMessage({ type: 'comparePlansError', ...identity, message: describe(error) })
    }
  }
}
