import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CaseController } from '../src/case-controller.ts'
import type { CaseBundle, LoadedCaseIndex } from '../src/case-loader.ts'
import { measurementPanel } from '../src/measurements-panel.ts'
import type { ResectionPlane } from '../src/plane.ts'
import type { EvaluateVolumetry, VolumetryWorkerResponse } from '../src/volumetry-worker.ts'
import type { VolumetryResult } from '../src/volumetry.ts'

const catalog: LoadedCaseIndex = {
  indexUrl: 'https://example.test/cases/index.json',
  index: { schemaVersion: 1, releaseId: 'demo', cases: [{ caseId: 'a' }, { caseId: 'b' }] },
}
const result: VolumetryResult = {
  totalParenchymaMl: 1.23456, resectedMl: 0.12345, remainingMl: 1.11111,
  flrPercent: 90.001, resectedPercent: 9.999,
  tumourIntersectsPlane: false, tumourPlaneDistanceMm: 2.4567,
}

function makeBundle(caseId: string): CaseBundle {
  const liver: CaseBundle['liver'] = {
    positions: new Float32Array(9), bounds: { min: [-4, 4, 8], max: [6, 10, 12] },
  }
  return {
    liver, tumour: { ...liver },
    metadata: {
      schemaVersion: 1, releaseId: 'demo', caseId, dimensions: [2, 1, 1],
      voxelSpacingMm: [1, 1, 1], voxelToWorldMm: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
      labelCounts: { parenchyma: 1, tumour: 1 },
    },
    labels: new ArrayBuffer(2),
  }
}

class FakeWorker {
  onmessage: ((event: MessageEvent<VolumetryWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  terminated = false
  readonly jobs: EvaluateVolumetry[] = []

  postMessage(job: EvaluateVolumetry) { this.jobs.push(job) }
  terminate() { this.terminated = true }
  emit(data: VolumetryWorkerResponse) { this.onmessage?.(new MessageEvent('message', { data })) }
  crash() { this.onmessageerror?.(new MessageEvent('messageerror')) }
}

function harness() {
  type Load = {
    caseId: string; signal?: AbortSignal
    resolve(bundle: CaseBundle): void; reject(error: Error): void
  }
  const loads: Load[] = []
  const workers: FakeWorker[] = []
  const released: CaseBundle['liver'][] = []
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const controller = new CaseController(catalog, {
    loadBundle: (_catalog, caseId, signal) => new Promise((resolve, reject) => {
      loads.push({ caseId, signal, resolve, reject })
    }),
    startWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    requestFrame: callback => {
      frames.set(++nextFrame, callback)
      return nextFrame
    },
    cancelFrame: handle => { frames.delete(handle) },
    releaseMeshes: meshes => { released.push(meshes.liver) },
  })
  function frame() {
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(0)
  }
  async function ready(caseId = 'a') {
    const request = controller.selectCase(caseId)
    loads.at(-1)!.resolve(makeBundle(caseId))
    await request
    const worker = workers.at(-1)!
    assert.equal(controller.state.status, 'loading')
    const state = controller.state
    if (state.status !== 'loading') throw new Error('Expected loading case.')
    worker.emit({ type: 'ready', selectionToken: state.selectionToken })
    return worker
  }
  return { controller, loads, workers, frames, released, frame, ready }
}

function planeAt(x: number): ResectionPlane {
  return { pointMm: [x, 0, 0], unitNormal: [2, 0, 0], resectSide: 'positive' }
}

function readyState(controller: CaseController) {
  const state = controller.state
  if (state.status !== 'ready') throw new Error('Expected ready case.')
  return state
}

function publishResult(worker: FakeWorker, job: EvaluateVolumetry) {
  worker.emit({ type: 'result', selectionToken: job.selectionToken, revision: job.revision, result })
}

test('late bundles and failed loads cannot take over the newer selection', async () => {
  const { controller, loads, workers, released, ready } = harness()
  const first = controller.selectCase('a')
  const stale = makeBundle('a')
  const worker = await ready('b')
  assert.equal(loads[0].signal?.aborted, true)
  loads[0].resolve(stale)
  await first
  assert.deepEqual(released, [stale.liver])
  assert.equal(workers.length, 1)
  assert.equal(controller.state.status, 'ready')
  const superseded = controller.selectCase('a')
  assert.equal(worker.terminated, true)
  assert.equal(released.length, 2)
  await ready('b')
  loads[2].reject(new Error('Old request failed'))
  await superseded
  assert.equal(controller.state.status, 'ready')
  if (controller.state.status === 'ready') assert.equal(controller.state.caseId, 'b')
  controller.dispose()
  assert.equal(workers.at(-1)!.terminated, true)
  assert.equal(released.length, 3)
})

test('load and initialization failures can retry with a fresh selection token', async () => {
  const { controller, loads, workers, released } = harness()
  const first = controller.selectCase('a')
  loads[0].reject(new Error('Asset unavailable'))
  await first
  assert.equal(controller.state.status, 'error')
  const retry = controller.retry()
  loads[1].resolve(makeBundle('a'))
  await retry
  assert.deepEqual(controller.state, { status: 'loading', caseId: 'a', selectionToken: 2 })
  workers[0].emit({ type: 'initialisationError', selectionToken: 2, message: 'Mask counts differ' })
  assert.equal(workers[0].terminated, true)
  assert.equal(released.length, 1)
  assert.deepEqual(controller.state, { status: 'error', caseId: 'a', selectionToken: 2, message: 'Mask counts differ' })

  const last = controller.retry()
  loads[2].resolve(makeBundle('a'))
  await last
  workers[1].emit({ type: 'ready', selectionToken: 3 })
  const state = readyState(controller)
  assert.deepEqual(state.plane.pointMm, [1, 7, 10])
  assert.deepEqual(state.measurements, { status: 'updating' })
})

test('animation frames and an in-flight job retain only the latest plane', async () => {
  const { controller, frame, frames, ready } = harness()
  const worker = await ready()
  controller.setPlane(planeAt(2))
  controller.setPlane(planeAt(3))
  assert.equal(frames.size, 1)
  const state = readyState(controller)
  assert.deepEqual(state.plane.pointMm, [3, 0, 0])
  assert.deepEqual(state.plane.unitNormal, [1, 0, 0])
  assert.equal(controller.setPlane(planeAt(3)), false)
  assert.throws(() => controller.setPlane({ ...planeAt(3), unitNormal: [0, 0, 0] }), /nonzero/)
  assert.equal(controller.state, state)

  frame()
  assert.equal(worker.jobs.length, 1)
  const first = worker.jobs[0]
  assert.equal(first.revision, state.revision)
  controller.setPlane(planeAt(4))
  controller.setPlane(planeAt(5))
  frame()
  assert.equal(worker.jobs.length, 1)
  worker.emit({ type: 'calculationError', selectionToken: first.selectionToken, revision: first.revision,
    message: 'Old plane failed' })
  assert.deepEqual(measurementPanel(controller.state), { status: 'updating', canSave: false })
  frame()
  assert.equal(worker.jobs.length, 2)
  assert.deepEqual(worker.jobs[1].plane.pointMm, [5, 0, 0])

  publishResult(worker, first)
  assert.equal(measurementPanel(controller.state).canSave, false)
  publishResult(worker, worker.jobs[1])
  const panel = measurementPanel(controller.state)
  if (panel.status !== 'ready') throw new Error('Expected current measurements.')
  assert.equal(panel.canSave, true)
  assert.equal(panel.result, result)
  assert.equal(panel.rows[0].value, '1.235 mL')
  assert.equal(panel.rows[3].value, '90%')
  assert.deepEqual(panel.rows.at(-1), { label: 'Tumour-to-plane distance (geometric estimate)', value: '2.46 mm' })
})

test('failed evaluation retries the same plane and worker with a fresh revision', async () => {
  const { controller, frame, ready, workers } = harness()
  const worker = await ready()
  frame()
  const failed = worker.jobs[0]
  worker.emit({ type: 'calculationError', selectionToken: failed.selectionToken, revision: failed.revision,
    message: 'Calculation failed' })
  assert.deepEqual(measurementPanel(controller.state),
    { status: 'unavailable', canSave: false, message: 'Calculation failed' })
  await controller.retry()
  frame()
  const retry = worker.jobs[1]
  assert.ok(retry.revision > failed.revision)
  assert.deepEqual(retry.plane, failed.plane)
  assert.equal(workers.length, 1)
  publishResult(worker, { ...retry, selectionToken: 99 })
  assert.equal(measurementPanel(controller.state).canSave, false)
  publishResult(worker, retry)
  assert.equal(measurementPanel(controller.state).canSave, true)
})

test('worker crash reloads the bundle and retains the current plane', async () => {
  const { controller, frame, ready, loads, workers, released } = harness()
  const oldWorker = await ready()
  controller.setPlane({ ...planeAt(8), resectSide: 'negative' })
  frame()
  const lateReply = oldWorker.onmessage!
  oldWorker.crash()
  assert.equal(oldWorker.terminated, true)
  assert.equal(released.length, 1)
  assert.deepEqual(controller.state, { status: 'loading', caseId: 'a', selectionToken: 2 })
  loads[1].resolve(makeBundle('a'))
  await Promise.resolve()
  const nextWorker = workers[1]
  nextWorker.emit({ type: 'ready', selectionToken: 2 })
  frame()
  assert.deepEqual(nextWorker.jobs[0].plane, { ...planeAt(8), unitNormal: [1, 0, 0], resectSide: 'negative' })
  lateReply(new MessageEvent('message', { data: {
    type: 'result', selectionToken: 2, revision: nextWorker.jobs[0].revision, result,
  } }))
  assert.equal(measurementPanel(controller.state).canSave, false)
  publishResult(nextWorker, nextWorker.jobs[0])
  assert.equal(measurementPanel(controller.state).canSave, true)
  nextWorker.crash()
  assert.deepEqual(controller.state, { status: 'loading', caseId: 'a', selectionToken: 3 })
  loads[2].resolve(makeBundle('a'))
  await Promise.resolve()
  workers[2].crash()
  assert.equal(controller.state.status, 'error')
  assert.equal(loads.length, 3)
})
