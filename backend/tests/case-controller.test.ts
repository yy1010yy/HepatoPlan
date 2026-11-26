import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { CaseController } from '../src/case-controller.ts'
import type { CaseBundle, LoadedCaseIndex } from '../src/case-loader.ts'
import { measurementPanel } from '../src/measurements-panel.ts'
import { bindPlaneControls, planeGeometry, planeReadouts, presetPlane } from '../src/plane-controls.ts'
import type { PlaneControlElements } from '../src/plane-controls.ts'
import type { ResectionPlane } from '../src/plane.ts'
import { PlanSession } from '../src/plan-session.ts'
import type { SavedPlan } from '../src/plan-session.ts'
import { createResectionScene } from '../src/resection-viewer.ts'
import { PreparedCase } from '../src/volumetry.ts'
import type { ComparePlans, EvaluateVolumetry, VolumetryJob, VolumetryWorkerResponse } from '../src/volumetry-worker.ts'
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
  readonly dispatched: VolumetryJob[] = []

  get jobs(): EvaluateVolumetry[] {
    return this.dispatched.filter(job => job.type === 'evaluate')
  }

  postMessage(job: VolumetryJob) { this.dispatched.push(job) }
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

function saved(id: string, overrides: Partial<SavedPlan> = {}): SavedPlan {
  return { id, name: id, releaseId: 'demo', caseId: 'a', plane: planeAt(0), result, ...overrides }
}

function lastComparison(worker: FakeWorker): ComparePlans {
  const job = worker.dispatched.at(-1)
  if (job?.type !== 'comparePlans') throw new Error('Expected a comparison request.')
  return job
}

const difference = { removedOnlyByAMl: 0, removedOnlyByBMl: 0, removedByBothMl: 0.4, retainedByBothMl: 0.6 }

function comparisonReply(job: ComparePlans, volumes = difference): Extract<VolumetryWorkerResponse, { type: 'comparePlansResult' }> {
  const { selectionToken, comparisonRequestId, planAId, planBId } = job
  return { type: 'comparePlansResult', selectionToken, comparisonRequestId, planAId, planBId, result: volumes }
}

test('late comparison success and error leave active comparison data and status intact', async () => {
  const { controller, ready, frame } = harness()
  const workerA = await ready()
  frame()
  publishResult(workerA, workerA.jobs[0])
  const [a, b, c] = ['a', 'b', 'c'].map(id => saved(id))
  controller.selectComparison(a, b)
  frame()
  const firstAB = lastComparison(workerA)

  controller.selectComparison(a, c)
  workerA.emit(comparisonReply(firstAB))
  assert.deepEqual(readyState(controller).comparison, { status: 'loading', pair: [a, c] })
  frame()
  const ac = lastComparison(workerA)
  const acVolumes = { ...difference, removedOnlyByAMl: 0.2 }
  workerA.emit(comparisonReply(ac, acVolumes))
  assert.deepEqual(readyState(controller).comparison, { status: 'ready', pair: [a, c], result: acVolumes })

  controller.selectComparison(a, b)
  frame()
  const { selectionToken, comparisonRequestId, planAId, planBId } = lastComparison(workerA)
  const delayedError = new MessageEvent('message', { data: {
    type: 'comparePlansError', selectionToken, comparisonRequestId, planAId, planBId, message: 'Old case failed',
  } satisfies VolumetryWorkerResponse })
  const oldListener = workerA.onmessage!
  const workerB = await ready('b')
  frame()
  publishResult(workerB, workerB.jobs[0])
  const d = saved('d', { caseId: 'b' })
  const e = saved('e', { caseId: 'b' })
  controller.selectComparison(d, e)
  frame()
  const de = lastComparison(workerB)
  oldListener(delayedError)
  assert.deepEqual(readyState(controller).comparison, { status: 'loading', pair: [d, e] })
  const deVolumes = { ...difference, retainedByBothMl: 0.8 }
  workerB.emit(comparisonReply(de, deVolumes))
  oldListener(delayedError)
  assert.deepEqual(readyState(controller).comparison, { status: 'ready', pair: [d, e], result: deVolumes })
})

test('comparison identity distinguishes repeated ordered selections and explicit retries', async () => {
  const { controller, ready, frame } = harness()
  const worker = await ready()
  frame()
  publishResult(worker, worker.jobs[0])
  const [a, b, c] = ['a', 'b', 'c'].map(id => saved(id))

  controller.selectComparison(a, b)
  frame()
  const first = lastComparison(worker)
  controller.selectComparison(a, c)
  controller.selectComparison(a, b)
  controller.selectComparison(a, b)
  worker.emit(comparisonReply(first))
  assert.equal(readyState(controller).comparison.status, 'loading')
  frame()
  const last = lastComparison(worker)
  assert.deepEqual([last.planAId, last.planBId], ['a', 'b'])
  assert.equal(last.comparisonRequestId, first.comparisonRequestId + 2)
  worker.emit({ ...comparisonReply(last), planAId: 'b', planBId: 'a' })
  assert.equal(readyState(controller).comparison.status, 'loading')
  const { selectionToken, comparisonRequestId, planAId, planBId } = last
  worker.emit({ type: 'comparePlansError', selectionToken, comparisonRequestId, planAId, planBId, message: 'Failed' })
  assert.deepEqual(readyState(controller).comparison, { status: 'error', pair: [a, b], message: 'Failed' })
  controller.retryComparison()
  frame()
  const retry = lastComparison(worker)
  assert.equal(retry.comparisonRequestId, last.comparisonRequestId + 1)
  worker.emit(comparisonReply(retry))
  assert.deepEqual(readyState(controller).comparison, { status: 'ready', pair: [a, b], result: difference })

  for (const invalid of [a, saved('other case', { caseId: 'b' }), saved('other release', { releaseId: 'older' })]) {
    controller.selectComparison(a, c)
    controller.selectComparison(a, invalid)
    assert.deepEqual(readyState(controller).comparison, { status: 'idle' })
  }
  frame()
  assert.equal(lastComparison(worker), retry)
})

test('single worker slot drains latest plane before latest pair and isolates case changes', async () => {
  const { controller, ready, frame } = harness()
  const worker = await ready()
  frame()
  publishResult(worker, worker.jobs[0])
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => saved(id))
  controller.selectComparison(a, b)
  frame()
  const first = lastComparison(worker)
  controller.selectComparison(a, c)
  controller.selectComparison(a, d)
  controller.setPlane(planeAt(2))
  frame()
  assert.deepEqual(worker.dispatched.map(job => job.type), ['evaluate', 'comparePlans'])
  worker.emit(comparisonReply(first))
  frame()
  assert.deepEqual(worker.dispatched.map(job => job.type), ['evaluate', 'comparePlans', 'evaluate'])
  const evaluation = worker.jobs[1]
  publishResult(worker, evaluation)
  frame()
  const last = lastComparison(worker)
  assert.equal(last.planBId, 'd')
  assert.equal(worker.dispatched.length, 4)

  const oldListener = worker.onmessage!
  const newWorker = await ready('b')
  frame()
  assert.equal(worker.terminated, true)
  assert.equal(readyState(controller).comparison.status, 'idle')
  controller.setPlane(planeAt(3))
  oldListener(new MessageEvent('message', { data: comparisonReply(last) }))
  frame()
  assert.equal(newWorker.dispatched.length, 1)
  publishResult(newWorker, newWorker.jobs[0])
  frame()
  assert.equal(newWorker.dispatched.length, 2)
})

test('comparison recovery waits for the still-active worker to initialise', async () => {
  const { controller, ready, frame, loads, workers } = harness()
  const worker = await ready()
  frame()
  publishResult(worker, worker.jobs[0])
  controller.selectComparison(saved('a'), saved('b'))
  frame()
  const failed = lastComparison(worker)
  worker.crash()
  assert.equal(controller.state.status, 'loading')
  loads.at(-1)!.resolve(makeBundle('a'))
  await Promise.resolve()
  const recovered = workers.at(-1)!
  frame()
  assert.equal(recovered.dispatched.length, 0)
  recovered.emit({ type: 'ready', selectionToken: failed.selectionToken + 1 })
  frame()
  publishResult(recovered, recovered.jobs[0])
  frame()
  const retried = lastComparison(recovered)
  assert.equal(retried.selectionToken, failed.selectionToken + 1)
  assert.equal(retried.comparisonRequestId, failed.comparisonRequestId + 1)
  assert.deepEqual([retried.planAId, retried.planBId], ['a', 'b'])
  recovered.emit(comparisonReply(retried))
  assert.equal(readyState(controller).comparison.status, 'ready')
})

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

test('plane controls map offsets and angles, flip the side, and reset through the queue', async () => {
  const { controller, ready, frame } = harness()
  const worker = await ready()
  assert.equal(controller.setPlaneOffset(-3), true)
  assert.equal(controller.setPlaneAngle(30), true)
  const state = readyState(controller)
  assert.deepEqual(state.plane.pointMm, [-2, 7, 10])
  assert.ok(Math.abs(state.plane.unitNormal[0] - Math.sqrt(3) / 2) < 1e-12)
  assert.ok(Math.abs(state.plane.unitNormal[1] - 0.5) < 1e-12)
  assert.deepEqual(planeReadouts(state.liver.bounds, state.plane).offsetText, '−3 mm')
  assert.deepEqual(planeReadouts(state.liver.bounds, state.plane).angleText, '+30°')
  assert.throws(() => controller.setPlaneOffset(6), /within the case range/)
  assert.throws(() => controller.setPlaneAngle(1.5), /whole degree/)
  assert.throws(() => controller.setPlaneAngle(46), /whole degree/)
  assert.equal(controller.state, state)

  controller.flipResectSide()
  const flipped = readyState(controller)
  assert.deepEqual(flipped.plane, { ...state.plane, resectSide: 'negative' })
  frame()
  assert.deepEqual(worker.jobs[0].plane, flipped.plane)
  publishResult(worker, worker.jobs[0])
  controller.resetPlane()
  frame()
  assert.deepEqual(worker.jobs[1].plane, { pointMm: [1, 7, 10], unitNormal: [1, 0, 0], resectSide: 'positive' })
  assert.equal(controller.resetPlane(), false)
})

test('each preset changes both values in one revision while retaining the selected side', async () => {
  const fractionalBounds = { min: [0, 0, 0], max: [10.2, 4, 6] } as const
  assert.equal(planeGeometry(fractionalBounds).offsetLimitMm, 6)
  const negative = presetPlane(fractionalBounds, 'negative-offset', 'negative')
  assert.equal(planeReadouts(fractionalBounds, negative).offsetText, '−4 mm')
  const { controller, ready, frame } = harness()
  const worker = await ready()
  controller.flipResectSide()
  for (const [preset, offset, angle] of [
    ['negative-offset', -3, -10], ['centre-tilt', 0, 8], ['positive-offset', 3, 14],
  ] as const) {
    const previous = readyState(controller)
    assert.equal(controller.applyPlanePreset(preset), true)
    const current = readyState(controller)
    assert.equal(current.revision, previous.revision + 1)
    assert.equal(current.plane.resectSide, 'negative')
    const readouts = planeReadouts(current.liver.bounds, current.plane)
    assert.equal(readouts.offsetMm, offset)
    assert.ok(Math.abs(readouts.angleDeg - angle) < 1e-12)
    assert.equal(controller.applyPlanePreset(preset), false)
    frame()
    const job = worker.jobs.at(-1)!
    assert.equal(job.revision, current.revision)
    assert.deepEqual(job.plane, current.plane)
    publishResult(worker, job)
  }
  assert.equal(worker.jobs.length, 3)
})

test('native input binding shows saved geometry without rounding the evaluated plane', async () => {
  class Control extends EventTarget {
    disabled = false
    value = ''
    min = ''
    max = ''
    step = ''
    type = ''
    textContent = ''
    attributes = new Map<string, string>()
    get valueAsNumber() { return Number(this.value) }
    setAttribute(name: string, value: string) { this.attributes.set(name, value) }
    removeAttribute(name: string) { this.attributes.delete(name) }
  }
  const { controller, ready, frame } = harness()
  const controls = {
    offset: new Control(), angle: new Control(), offsetReadout: new Control(), angleReadout: new Control(),
    flip: new Control(), reset: new Control(),
    presets: { 'negative-offset': new Control(), 'centre-tilt': new Control(), 'positive-offset': new Control() },
  }
  const unbind = bindPlaneControls(controller, controls as unknown as PlaneControlElements)
  assert.equal(controls.offset.disabled, true)
  const worker = await ready()
  assert.deepEqual([controls.offset.min, controls.offset.max, controls.offset.step], ['-5', '5', '1'])
  assert.deepEqual([controls.angle.min, controls.angle.max, controls.angle.step], ['-45', '45', '1'])

  const radians = 12.5 * Math.PI / 180
  const saved: ResectionPlane = { pointMm: [3.25, 7, 10],
    unitNormal: [Math.cos(radians), Math.sin(radians), 0], resectSide: 'negative' }
  controller.setPlane(saved)
  assert.equal(controls.offsetReadout.textContent, '+2.25 mm')
  assert.equal(controls.angleReadout.textContent, '+12.5°')
  assert.equal(controls.offset.attributes.get('aria-valuetext'), '+2.25 mm')
  frame()
  assert.deepEqual(worker.jobs[0].plane, saved)
  publishResult(worker, worker.jobs[0])

  controls.offset.value = '-2'
  controls.offset.dispatchEvent(new Event('input'))
  assert.equal(controls.offsetReadout.textContent, '−2 mm')
  assert.equal(controls.angleReadout.textContent, '+12.5°')
  controls.angle.value = '-15'
  controls.angle.dispatchEvent(new Event('input'))
  assert.equal(controls.angleReadout.textContent, '−15°')
  controls.presets['centre-tilt'].dispatchEvent(new Event('click'))
  assert.equal(controls.angleReadout.textContent, '+8°')
  assert.equal(controls.offsetReadout.textContent, '0 mm')
  controls.flip.dispatchEvent(new Event('click'))
  assert.equal(readyState(controller).plane.resectSide, 'positive')
  controls.reset.dispatchEvent(new Event('click'))
  assert.equal(controls.angleReadout.textContent, '0°')
  const state = controller.state
  unbind()
  controls.angle.value = '20'
  controls.angle.dispatchEvent(new Event('input'))
  assert.equal(controller.state, state)
})

test('resection scene keeps case geometry in world space and clips opposite half-spaces', async () => {
  const { controller, ready, frame, frames } = harness()
  const view = createResectionScene()
  const unsubscribe = controller.subscribe(state => view.update(state))
  const worker = await ready()
  controller.setPlane({ ...planeAt(0.5), unitNormal: [1, 0, 0] })
  frame()
  publishResult(worker, worker.jobs[0])

  const positive = view.scene.getObjectByName('liver-positive')
  const negative = view.scene.getObjectByName('liver-negative')
  const tumour = view.scene.getObjectByName('tumour')
  const overlay = view.scene.getObjectByName('resection-plane')
  assert.ok(positive instanceof Mesh && positive.material instanceof MeshStandardMaterial)
  assert.ok(negative instanceof Mesh && negative.material instanceof MeshStandardMaterial)
  assert.ok(tumour instanceof Mesh && tumour.material instanceof MeshStandardMaterial)
  assert.ok(overlay?.visible)
  assert.deepEqual(view.target.toArray(), [1, 7, 10])
  assert.equal(positive.geometry, negative.geometry)
  assert.equal(positive.geometry.getAttribute('position').array, readyState(controller).liver.positions)
  assert.equal(tumour.material.clippingPlanes, null)
  const positivePlane = positive.material.clippingPlanes![0]
  const negativePlane = negative.material.clippingPlanes![0]
  assert.equal(positivePlane.constant, -0.5)
  assert.equal(negativePlane.constant, 0.5)
  const engine = new PreparedCase({
    ...readyState(controller).metadata, dimensions: [3, 1, 1], labelCounts: { parenchyma: 2, tumour: 1 },
  }, new Uint8Array([1, 1, 2]))
  const kept = new Vector3(0, 0, 0)
  const removed = new Vector3(1, 0, 0)
  assert.ok(positivePlane.distanceToPoint(removed) > 0 && negativePlane.distanceToPoint(removed) < 0)
  assert.ok(positivePlane.distanceToPoint(kept) < 0 && negativePlane.distanceToPoint(kept) > 0)
  assert.equal(engine.evaluate(readyState(controller).plane).resectedMl, 0.001)
  const removedColour = positive.material.color.getHex()
  const retainedColour = negative.material.color.getHex()
  assert.notEqual(removedColour, retainedColour)

  view.setPlaneVisible(false)
  view.setLiverOpacity(0.35)
  assert.equal(overlay.visible, false)
  assert.ok(positive.visible && negative.visible && tumour.visible)
  assert.equal(positive.material.opacity, 0.35)
  assert.equal(negative.material.opacity, 0.35)
  assert.equal(frames.size, 0)
  assert.equal(worker.jobs.length, 1)
  controller.flipResectSide()
  assert.equal(positive.material.color.getHex(), retainedColour)
  assert.equal(negative.material.color.getHex(), removedColour)
  assert.equal(overlay.visible, false)

  let disposals = 0
  positive.geometry.addEventListener('dispose', () => { disposals++ })
  tumour.geometry.addEventListener('dispose', () => { disposals++ })
  controller.dispose()
  assert.equal(disposals, 2)
  assert.equal(view.scene.getObjectByName('liver-positive'), undefined)
  unsubscribe()
  view.dispose()
})

test('session snapshots require current measurements and reopen unrounded saved geometry', async () => {
  const { controller, ready, frame } = harness()
  const session = new PlanSession(controller)
  const worker = await ready()
  assert.throws(() => session.save({ name: 'Draft' }), /current case and plane/)
  frame()
  const initial = worker.jobs[0]
  worker.emit({ type: 'calculationError', selectionToken: initial.selectionToken, revision: initial.revision,
    message: 'Failed' })
  assert.throws(() => session.save({ name: 'Draft' }), /current case and plane/)
  await controller.retry()
  frame()
  publishResult(worker, worker.jobs[1])

  assert.throws(() => session.save({ name: '   ' }), /plan name/)
  const first = session.save({ name: ' Trial ', procedureType: 'Study', reason: 'Compare', notes: 'Preserve' })
  assert.equal(first.name, 'Trial')
  assert.equal(first.procedureType, 'Study')
  assert.equal(first.reason, 'Compare')
  assert.equal(first.notes, 'Preserve')
  assert.deepEqual(first.result, result)
  assert.notEqual(first.result, result)
  assert.ok(Object.isFrozen(first.plane.pointMm) && Object.isFrozen(first.result))

  controller.setPlane({ ...planeAt(4.125), resectSide: 'negative' })
  assert.throws(() => session.save({ name: 'Trial' }), /current case and plane/)
  frame()
  const update = worker.jobs[2]
  const secondResult = { ...result, resectedMl: 0.333333333, remainingMl: 0.901226667,
    flrPercent: 73.001, resectedPercent: 26.999, tumourIntersectsPlane: true, tumourPlaneDistanceMm: 0 }
  worker.emit({ type: 'result', selectionToken: update.selectionToken, revision: update.revision, result: secondResult })
  const second = session.save({ name: 'Trial' })
  assert.notEqual(first.id, second.id)
  assert.notDeepEqual(first.plane, second.plane)
  assert.equal(second.result.resectedMl, 0.333333333)

  const comparison = session.compare([second.id, first.id])
  assert.deepEqual(comparison.plans.map(plan => plan.id), [second.id, first.id])
  assert.deepEqual(comparison.rows.map(row => row.values), [
    ['0.333 mL', '0.123 mL'], ['0.901 mL', '1.111 mL'], ['73%', '90%'],
    ['27%', '10%'], ['Touches or crosses', 'Separate'], ['0 mm', '2.46 mm'],
  ])
  assert.throws(() => session.compare([first.id, first.id]), /distinct/)
  for (const plan of [first, second, second]) {
    const previousRevision = readyState(controller).revision
    assert.equal(session.open(plan.id), plan)
    const state = readyState(controller)
    assert.deepEqual(state.plane, plan.plane)
    assert.ok(state.revision > previousRevision)
    assert.equal(state.measurements.status, 'updating')
    const readouts = planeReadouts(state.liver.bounds, state.plane)
    assert.equal(readouts.offsetMm, plan.plane.pointMm[0] - 1)
    frame()
    const job = worker.jobs.at(-1)!
    assert.deepEqual(job.plane, plan.plane)
    publishResult(worker, job)
  }
})

test('plans stay in memory across case switches and comparisons reject other cases and releases', async () => {
  const { controller, loads, workers, ready, frame } = harness()
  const session = new PlanSession(controller)
  function save(worker: FakeWorker, name: string) {
    frame()
    publishResult(worker, worker.jobs.at(-1)!)
    return session.save({ name })
  }
  const a = save(await ready('a'), 'Trial')
  const b = save(await ready('b'), 'Trial')
  assert.deepEqual(session.list(), [b])
  assert.throws(() => session.open(a.id), /active case and release/)
  assert.throws(() => session.compare([b.id, a.id]), /active case and release/)
  const worker = await ready('a')
  const another = save(worker, 'Alternative')
  assert.deepEqual(session.list(), [a, another])

  const next = controller.selectCase('a')
  const bundle = makeBundle('a')
  loads.at(-1)!.resolve({ ...bundle, metadata: { ...bundle.metadata, releaseId: 'other-release' } })
  await next
  const state = controller.state
  if (state.status !== 'loading') throw new Error('Expected loading case.')
  const newWorker = workers.at(-1)!
  newWorker.emit({ type: 'ready', selectionToken: state.selectionToken })
  const otherRelease = save(newWorker, 'Trial')
  assert.deepEqual(session.list(), [otherRelease])
  assert.throws(() => session.compare([a.id, otherRelease.id]), /active case and release/)
})
