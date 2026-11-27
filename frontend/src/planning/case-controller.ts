import { loadCaseBundle } from './case-loader.ts'
import type { CaseBundle, LoadedCaseIndex } from './case-loader.ts'
import { normalisePlane } from './plane.ts'
import type { ResectionPlane } from './plane.ts'
import { defaultPlane, normalAtAngle, planeGeometry, pointAtOffset, presetPlane } from './plane-controls.ts'
import type { PlanePreset } from './plane-controls.ts'
import { startVolumetryWorker } from './volumetry-worker.ts'
import type { ComparePlans, ComparisonIdentity, EvaluateVolumetry, VolumetryJob, VolumetryWorkerResponse } from './volumetry-worker.ts'
import type { PlanDifferenceResult, VolumetryResult } from './volumetry.ts'
import type { SavedPlan } from './plan-session.ts'

export type CaseMeshes = Pick<CaseBundle, 'liver' | 'tumour'>
type CaseAssets = CaseMeshes & Pick<CaseBundle, 'metadata'>
type Selection = { readonly caseId: string; readonly selectionToken: number }

export type Measurements =
  | { readonly status: 'updating' }
  | { readonly status: 'ready'; readonly result: VolumetryResult }
  | { readonly status: 'unavailable'; readonly message: string }

export type ComparisonPair = readonly [SavedPlan, SavedPlan]

export type ComparisonState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly pair: ComparisonPair }
  | { readonly status: 'ready'; readonly pair: ComparisonPair; readonly result: PlanDifferenceResult }
  | { readonly status: 'error'; readonly pair: ComparisonPair; readonly message: string }

type ReadyCase = Selection & CaseAssets & {
  readonly status: 'ready'
  readonly plane: ResectionPlane
  readonly revision: number
  readonly measurements: Measurements
  readonly comparison: ComparisonState
}

export type CaseState =
  | { readonly status: 'idle' }
  | (Selection & { readonly status: 'loading' })
  | (Selection & { readonly status: 'error'; readonly message: string })
  | ReadyCase

type WorkerPort = {
  onmessage: ((event: MessageEvent<VolumetryWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(message: VolumetryJob): void
  terminate(): void
}

type ControllerDependencies = {
  loadBundle: typeof loadCaseBundle
  startWorker: (...args: Parameters<typeof startVolumetryWorker>) => WorkerPort
  requestFrame(callback: FrameRequestCallback): number
  cancelFrame(handle: number): void
  releaseMeshes?(meshes: CaseMeshes): void
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function matchesComparison(a: ComparisonIdentity, b: ComparisonIdentity): boolean {
  return a.selectionToken === b.selectionToken && a.comparisonRequestId === b.comparisonRequestId
    && a.planAId === b.planAId && a.planBId === b.planBId
}

export class CaseController {
  readonly #catalog: LoadedCaseIndex
  readonly #dependencies: ControllerDependencies
  readonly #listeners = new Set<(state: CaseState) => void>()
  #state: CaseState = { status: 'idle' }
  #selectionToken = 0
  #revision = 0
  #comparisonRequestId = 0
  #abort?: AbortController
  #assets?: CaseAssets
  #worker?: WorkerPort
  #frame?: number
  #pendingEvaluation?: EvaluateVolumetry
  #pendingComparison?: ComparePlans
  #inFlight?: VolumetryJob
  #desiredPlane?: ResectionPlane
  #desiredPair?: ComparisonPair
  #currentComparison?: ComparePlans
  #mayRecover = true

  constructor(catalog: LoadedCaseIndex, dependencies: Partial<ControllerDependencies> = {}) {
    this.#catalog = catalog
    this.#dependencies = {
      loadBundle: loadCaseBundle,
      startWorker: startVolumetryWorker,
      requestFrame: callback => requestAnimationFrame(callback),
      cancelFrame: handle => cancelAnimationFrame(handle),
      ...dependencies,
    }
  }

  get state(): CaseState {
    return this.#state
  }

  subscribe(listener: (state: CaseState) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => { this.#listeners.delete(listener) }
  }

  selectCase(caseId: string): Promise<void> {
    this.#desiredPair = undefined
    return this.#load(caseId, undefined, true)
  }

  selectComparison(planA?: SavedPlan, planB?: SavedPlan): void {
    const state = this.#state
    if (state.status !== 'ready') return
    if (!planA || !planB || planA.id === planB.id || [planA, planB].some(plan => (
      plan.caseId !== state.caseId || plan.releaseId !== state.metadata.releaseId
    ))) {
      this.#desiredPair = undefined
      this.#pendingComparison = this.#currentComparison = undefined
      if (state.comparison.status !== 'idle') this.#publish({ ...state, comparison: { status: 'idle' } })
      return
    }
    if (this.#desiredPair?.[0].id === planA.id && this.#desiredPair[1].id === planB.id) return
    const comparison = this.#queueComparison(state, [planA, planB])
    this.#publish({ ...state, comparison })
    this.#scheduleFrame()
  }

  retryComparison(): void {
    const state = this.#state
    if (state.status !== 'ready' || state.comparison.status !== 'error') return
    const comparison = this.#queueComparison(state, state.comparison.pair)
    this.#publish({ ...state, comparison })
    this.#scheduleFrame()
  }

  setPlane(input: ResectionPlane): boolean {
    const state = this.#state
    if (state.status !== 'ready') return false
    const plane = normalisePlane(input)
    if (plane.resectSide === state.plane.resectSide
        && plane.pointMm.every((value, index) => value === state.plane.pointMm[index])
        && plane.unitNormal.every((value, index) => value === state.plane.unitNormal[index])) {
      return false
    }
    this.#queueMeasurement(state, plane)
    return true
  }

  setPlaneOffset(offsetMm: number): boolean {
    const state = this.#state
    if (state.status !== 'ready') return false
    const pointMm = pointAtOffset(planeGeometry(state.liver.bounds), offsetMm)
    return this.setPlane({ ...state.plane, pointMm })
  }

  restorePlane(input: ResectionPlane): void {
    const state = this.#state
    if (state.status !== 'ready') throw new Error('Load a case before opening a saved plane.')
    this.#queueMeasurement(state, normalisePlane(input))
  }

  setPlaneAngle(angleDeg: number): boolean {
    const state = this.#state
    if (state.status !== 'ready') return false
    return this.setPlane({ ...state.plane, unitNormal: normalAtAngle(angleDeg) })
  }

  flipResectSide(): boolean {
    const state = this.#state
    if (state.status !== 'ready') return false
    const resectSide = state.plane.resectSide === 'positive' ? 'negative' : 'positive'
    return this.setPlane({ ...state.plane, resectSide })
  }

  resetPlane(): boolean {
    const state = this.#state
    return state.status === 'ready' && this.setPlane(defaultPlane(state.liver.bounds))
  }

  applyPlanePreset(preset: PlanePreset): boolean {
    const state = this.#state
    return state.status === 'ready'
      && this.setPlane(presetPlane(state.liver.bounds, preset, state.plane.resectSide))
  }

  async retry(): Promise<void> {
    const state = this.#state
    if (state.status === 'error') {
      await this.#load(state.caseId, this.#desiredPlane, true)
    } else if (state.status === 'ready' && state.measurements.status === 'unavailable') {
      this.#queueMeasurement(state, state.plane)
    }
  }

  dispose(): void {
    ++this.#selectionToken
    this.#clearActive()
    this.#desiredPlane = undefined
    this.#desiredPair = undefined
    this.#publish({ status: 'idle' })
    this.#listeners.clear()
  }

  async #load(caseId: string, restorePlane: ResectionPlane | undefined, mayRecover: boolean): Promise<void> {
    const selection = { caseId, selectionToken: ++this.#selectionToken }
    this.#clearActive()
    this.#desiredPlane = restorePlane
    this.#mayRecover = mayRecover
    const abort = new AbortController()
    this.#abort = abort
    this.#publish({ status: 'loading', ...selection })
    if (selection.selectionToken !== this.#selectionToken) return

    try {
      const { metadata, liver, tumour, labels } = await this.#dependencies.loadBundle(
        this.#catalog, caseId, abort.signal,
      )
      const assets = { metadata, liver, tumour }
      if (selection.selectionToken !== this.#selectionToken) {
        this.#dependencies.releaseMeshes?.(assets)
        return
      }
      this.#abort = undefined
      this.#assets = assets
      const worker = this.#dependencies.startWorker(selection.selectionToken, metadata, labels)
      this.#worker = worker
      worker.onmessage = ({ data }) => this.#handleMessage(worker, selection, data)
      const recover = (message: string) => {
        if (!this.#isCurrentWorker(worker, selection)) return
        if (this.#mayRecover) void this.#load(caseId, this.#desiredPlane, false)
        else this.#failCase(selection, message)
      }
      worker.onerror = event => {
        event.preventDefault()
        recover(event.message || 'Volumetry worker stopped unexpectedly.')
      }
      worker.onmessageerror = () => recover('Cannot read a reply from the volumetry worker.')
    } catch (error) {
      this.#failCase(selection, describe(error))
    }
  }

  #handleMessage(worker: WorkerPort, selection: Selection, message: VolumetryWorkerResponse): void {
    if (!this.#isCurrentWorker(worker, selection) || message.selectionToken !== selection.selectionToken) return
    if (message.type === 'initialisationError') {
      if (this.#state.status === 'loading') this.#failCase(selection, message.message)
      return
    }
    if (message.type === 'ready') {
      if (this.#state.status !== 'loading' || !this.#assets) return
      const plane = this.#desiredPlane ?? defaultPlane(this.#assets.liver.bounds)
      const comparison = this.#desiredPair
        ? this.#queueComparison(selection, this.#desiredPair) : { status: 'idle' } as const
      this.#queueMeasurement({ status: 'ready', ...selection, ...this.#assets, comparison }, plane)
      return
    }
    const job = this.#inFlight
    if (message.type === 'comparePlansResult' || message.type === 'comparePlansError') {
      if (job?.type !== 'comparePlans' || !matchesComparison(job, message)) return
      this.#inFlight = undefined
      this.#finishComparison(message, message.type === 'comparePlansResult'
        ? { result: message.result } : { message: message.message })
      this.#scheduleFrame()
      return
    }
    if (job?.type !== 'evaluate' || job.revision !== message.revision) return
    this.#inFlight = undefined
    const state = this.#state
    if (state.status === 'ready' && message.revision === state.revision) {
      if (message.type === 'result' && state.comparison.status !== 'loading') this.#mayRecover = true
      const measurements: Measurements = message.type === 'result'
        ? { status: 'ready', result: message.result }
        : { status: 'unavailable', message: message.message }
      this.#publish({ ...state, measurements })
    }
    this.#scheduleFrame()
  }

  #queueMeasurement(state: Omit<ReadyCase, 'plane' | 'revision' | 'measurements'>,
    plane: ResectionPlane): void {
    const revision = ++this.#revision
    this.#desiredPlane = plane
    this.#pendingEvaluation = { type: 'evaluate', selectionToken: state.selectionToken, revision, plane }
    this.#publish({ ...state, plane, revision, measurements: { status: 'updating' } })
    this.#scheduleFrame()
  }

  #queueComparison(selection: Selection, pair: ComparisonPair): ComparisonState {
    const [a, b] = pair
    this.#desiredPair = pair
    this.#currentComparison = this.#pendingComparison = {
      type: 'comparePlans', selectionToken: selection.selectionToken,
      comparisonRequestId: ++this.#comparisonRequestId,
      planAId: a.id, planBId: b.id, planeA: a.plane, planeB: b.plane,
    }
    return { status: 'loading', pair }
  }

  #finishComparison(identity: ComparisonIdentity, outcome: { result: PlanDifferenceResult } | { message: string }): void {
    const state = this.#state
    const current = this.#currentComparison
    if (state.status !== 'ready' || state.comparison.status !== 'loading'
        || !current || !matchesComparison(current, identity)) return
    const { pair } = state.comparison
    if ('result' in outcome) this.#mayRecover = true
    const comparison: ComparisonState = 'result' in outcome
      ? { status: 'ready', pair, result: outcome.result }
      : { status: 'error', pair, message: outcome.message }
    this.#publish({ ...state, comparison })
  }

  #scheduleFrame(): void {
    const worker = this.#worker
    if (!worker || (!this.#pendingEvaluation && !this.#pendingComparison)
        || this.#inFlight || this.#frame !== undefined) return
    this.#frame = this.#dependencies.requestFrame(() => {
      if (worker !== this.#worker) return
      this.#frame = undefined
      const job = this.#pendingEvaluation ?? this.#pendingComparison
      if (!job || this.#inFlight) return
      if (job.type === 'evaluate') this.#pendingEvaluation = undefined
      else this.#pendingComparison = undefined
      this.#inFlight = job
      try {
        worker.postMessage(job)
      } catch (error) {
        this.#inFlight = undefined
        const state = this.#state
        if (job.type === 'comparePlans') {
          this.#finishComparison(job, { message: describe(error) })
        } else if (state.status === 'ready' && state.revision === job.revision) {
          this.#publish({ ...state, measurements: { status: 'unavailable', message: describe(error) } })
        }
        this.#scheduleFrame()
      }
    })
  }

  #isCurrentWorker(worker: WorkerPort, selection: Selection): boolean {
    return worker === this.#worker && selection.selectionToken === this.#selectionToken
  }

  #failCase(selection: Selection, message: string): void {
    if (selection.selectionToken !== this.#selectionToken) return
    this.#clearActive()
    this.#publish({ status: 'error', ...selection, message })
  }

  #clearActive(): void {
    this.#abort?.abort()
    this.#abort = undefined
    if (this.#frame !== undefined) this.#dependencies.cancelFrame(this.#frame)
    this.#frame = undefined
    this.#pendingEvaluation = this.#pendingComparison = this.#inFlight = this.#currentComparison = undefined
    const worker = this.#worker
    this.#worker = undefined
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate()
    }
    const assets = this.#assets
    this.#assets = undefined
    if (assets) this.#dependencies.releaseMeshes?.(assets)
  }

  #publish(state: CaseState): void {
    this.#state = state
    for (const listener of this.#listeners) {
      if (this.#state !== state) break
      listener(state)
    }
  }
}
