import { loadCaseBundle } from './case-loader.ts'
import type { CaseBundle, LoadedCaseIndex } from './case-loader.ts'
import { normalisePlane } from './plane.ts'
import type { ResectionPlane } from './plane.ts'
import { startVolumetryWorker } from './volumetry-worker.ts'
import type { EvaluateVolumetry, VolumetryWorkerResponse } from './volumetry-worker.ts'
import type { VolumetryResult } from './volumetry.ts'

export type CaseMeshes = Pick<CaseBundle, 'liver' | 'tumour'>
type CaseAssets = CaseMeshes & Pick<CaseBundle, 'metadata'>
type Selection = { readonly caseId: string; readonly selectionToken: number }

export type Measurements =
  | { readonly status: 'updating' }
  | { readonly status: 'ready'; readonly result: VolumetryResult }
  | { readonly status: 'unavailable'; readonly message: string }

type ReadyCase = Selection & CaseAssets & {
  readonly status: 'ready'
  readonly plane: ResectionPlane
  readonly revision: number
  readonly measurements: Measurements
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
  postMessage(message: EvaluateVolumetry): void
  terminate(): void
}

type ControllerDependencies = {
  loadBundle: typeof loadCaseBundle
  startWorker: (...args: Parameters<typeof startVolumetryWorker>) => WorkerPort
  requestFrame(callback: FrameRequestCallback): number
  cancelFrame(handle: number): void
  releaseMeshes?(meshes: CaseMeshes): void
}

function defaultPlane(liver: CaseBundle['liver']): ResectionPlane {
  const { min, max } = liver.bounds
  return {
    pointMm: [min[0] / 2 + max[0] / 2, min[1] / 2 + max[1] / 2, min[2] / 2 + max[2] / 2],
    unitNormal: [1, 0, 0],
    resectSide: 'positive',
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class CaseController {
  readonly #catalog: LoadedCaseIndex
  readonly #dependencies: ControllerDependencies
  readonly #listeners = new Set<(state: CaseState) => void>()
  #state: CaseState = { status: 'idle' }
  #selectionToken = 0
  #revision = 0
  #abort?: AbortController
  #assets?: CaseAssets
  #worker?: WorkerPort
  #frame?: number
  #pending?: EvaluateVolumetry
  #inFlight?: EvaluateVolumetry
  #desiredPlane?: ResectionPlane
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
    return this.#load(caseId, undefined, true)
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
      const plane = this.#desiredPlane ?? defaultPlane(this.#assets.liver)
      this.#queueMeasurement({ status: 'ready', ...selection, ...this.#assets }, plane)
      return
    }
    if (this.#inFlight?.revision !== message.revision) return
    this.#inFlight = undefined
    const state = this.#state
    if (state.status === 'ready' && message.revision === state.revision) {
      if (message.type === 'result') this.#mayRecover = true
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
    this.#pending = { type: 'evaluate', selectionToken: state.selectionToken, revision, plane }
    this.#publish({ ...state, plane, revision, measurements: { status: 'updating' } })
    this.#scheduleFrame()
  }

  #scheduleFrame(): void {
    const worker = this.#worker
    if (!worker || !this.#pending || this.#inFlight || this.#frame !== undefined) return
    this.#frame = this.#dependencies.requestFrame(() => {
      if (worker !== this.#worker) return
      this.#frame = undefined
      const job = this.#pending
      if (!job || this.#inFlight) return
      this.#pending = undefined
      this.#inFlight = job
      try {
        worker.postMessage(job)
      } catch (error) {
        this.#inFlight = undefined
        const state = this.#state
        if (state.status === 'ready' && state.revision === job.revision) {
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
    this.#pending = this.#inFlight = undefined
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
