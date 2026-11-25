import { PreparedCase } from './volumetry.ts'
import type { VolumetryWorkerRequest, VolumetryWorkerResponse } from './volumetry-worker.ts'

const port = globalThis as unknown as {
  onmessage: ((event: MessageEvent<VolumetryWorkerRequest>) => void) | null
  postMessage(message: VolumetryWorkerResponse): void
}

let active: { selectionToken: number; preparedCase: PreparedCase } | undefined

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  } else if (data.type === 'evaluate') {
    const { selectionToken, revision, plane } = data
    try {
      if (!active || active.selectionToken !== selectionToken) {
        throw new Error('Worker is not ready for this selection.')
      }
      const result = active.preparedCase.evaluate(plane)
      port.postMessage({ type: 'result', selectionToken, revision, result })
    } catch (error) {
      port.postMessage({ type: 'calculationError', selectionToken, revision, message: describe(error) })
    }
  }
}
