import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Worker as NodeWorker } from 'node:worker_threads'
import type { CaseMetadata } from '../src/case-contract.ts'
import { startVolumetryWorker } from '../src/volumetry-worker.ts'
import type { EvaluateVolumetry, VolumetryWorkerResponse } from '../src/volumetry-worker.ts'

const metadata: CaseMetadata = {
  schemaVersion: 1, releaseId: 'demo-1', caseId: 'case-001',
  dimensions: [3, 1, 1], voxelSpacingMm: [1, 1, 1],
  voxelToWorldMm: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
  labelCounts: { parenchyma: 2, tumour: 1 },
}
const evaluate: EvaluateVolumetry = {
  type: 'evaluate', selectionToken: 4, revision: 1,
  plane: { pointMm: [0.5, 0, 0], unitNormal: [1, 0, 0], resectSide: 'positive' },
}

// Adapt the actual browser entrypoint to a separate Node thread for the test runner.
class BrowserWorkerAdapter extends NodeWorker {
  constructor(url: URL, options: WorkerOptions) {
    assert.equal(options.type, 'module')
    super(`
      const { parentPort, workerData } = require('node:worker_threads')
      globalThis.postMessage = message => parentPort.postMessage(message)
      import(workerData).then(() => parentPort.on('message', data => globalThis.onmessage({ data })))
    `, { eval: true, workerData: url.href })
  }
}

function useBrowserAdapter(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  Object.defineProperty(globalThis, 'Worker', { value: BrowserWorkerAdapter, configurable: true })
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
    else Reflect.deleteProperty(globalThis, 'Worker')
  })
}

async function receive(worker: NodeWorker): Promise<VolumetryWorkerResponse> {
  const [message] = await once(worker, 'message')
  return message
}

test('browser worker transfers the mask once and uses the prepared case for repeated evaluations', async t => {
  useBrowserAdapter(t)
  const labels = new Uint8Array([1, 1, 2]).buffer
  const worker = startVolumetryWorker(4, metadata, labels) as unknown as NodeWorker
  t.after(async () => { await worker.terminate() })
  assert.equal(labels.byteLength, 0)
  assert.deepEqual(await receive(worker), { type: 'ready', selectionToken: 4 })

  worker.postMessage(evaluate)
  const first = await receive(worker)
  assert.equal(first.type, 'result')
  if (first.type !== 'result') throw new Error('Expected a volumetry result.')
  assert.equal(first.selectionToken, 4)
  assert.equal(first.revision, 1)
  assert.equal(first.result.totalParenchymaMl, 0.002)
  assert.equal(first.result.resectedMl, 0.001)

  worker.postMessage({ ...evaluate, revision: 2, plane: { ...evaluate.plane, pointMm: [4, 0, 0] } })
  const second = await receive(worker)
  if (second.type !== 'result') throw new Error('Expected a volumetry result.')
  assert.equal(second.selectionToken, 4)
  assert.equal(second.revision, 2)
  assert.equal(second.result.resectedMl, 0)
})

test('worker distinguishes initialization errors from calculation errors', async t => {
  useBrowserAdapter(t)
  const bad = startVolumetryWorker(3, metadata, new Uint8Array([1, 3, 2]).buffer) as unknown as NodeWorker
  t.after(async () => { await bad.terminate() })
  assert.deepEqual(await receive(bad), {
    type: 'initialisationError', selectionToken: 3, message: 'Invalid mask label 3.',
  })

  const worker = startVolumetryWorker(4, metadata, new Uint8Array([1, 1, 2]).buffer) as unknown as NodeWorker
  t.after(async () => { await worker.terminate() })
  await receive(worker)
  worker.postMessage({ ...evaluate, revision: 7, plane: { ...evaluate.plane, unitNormal: [0, 0, 0] } })
  assert.deepEqual(await receive(worker), {
    type: 'calculationError', selectionToken: 4, revision: 7, message: 'Plane normal must be nonzero.',
  })
  worker.postMessage({ ...evaluate, selectionToken: 3, revision: 8 })
  assert.deepEqual(await receive(worker), {
    type: 'calculationError', selectionToken: 3, revision: 8, message: 'Worker is not ready for this selection.',
  })
})
