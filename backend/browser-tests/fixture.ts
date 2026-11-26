import { CaseController } from '../src/case-controller.ts'
import { loadCaseIndex } from '../src/case-loader.ts'
import { measurementPanel } from '../src/measurements-panel.ts'
import { bindPlanDifference } from '../src/plan-difference-panel.ts'
import { bindPlaneControls } from '../src/plane-controls.ts'
import { PlanSession } from '../src/plan-session.ts'
import { mountResectionViewer } from '../src/resection-viewer.ts'
import { startVolumetryWorker } from '../src/volumetry-worker.ts'
import type { VolumetryJob, VolumetryWorkerResponse } from '../src/volumetry-worker.ts'

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

const picker = element<HTMLSelectElement>('case')
const name = element<HTMLInputElement>('name')
const save = element<HTMLButtonElement>('save')
const planA = element<HTMLSelectElement>('plan-a')
const planB = element<HTMLSelectElement>('plan-b')
const status = element('status')
const revision = element('revision')
const dispatches = element('dispatches')
const results = element('results')
const comparison = element('comparison')
let dispatchCount = 0
let comparisonDispatchCount = 0
let worker: Worker | undefined
let workspace: { dispose: () => void } | undefined
const params = new URLSearchParams(location.search)

async function loadWorkspace() {
  if (workspace) return
  status.textContent = 'Loading index'
  try {
    const indexPath = params.has('research') ? '/cases/index.json' : '/synthetic/cases/index.json'
    const catalog = await loadCaseIndex(new URL(indexPath, location.href))
    let workerTiming: { selectionToken: number; revision: number; evaluationMs: number } | undefined
    const controller = new CaseController(catalog, {
      startWorker: (...args) => {
        const started = startVolumetryWorker(...args)
        started.addEventListener('message', ({ data }: MessageEvent<VolumetryWorkerResponse>) => {
          if (data.type === 'result' && data.evaluationMs !== undefined) {
            workerTiming = { selectionToken: data.selectionToken, revision: data.revision, evaluationMs: data.evaluationMs }
          }
        })
        const post = started.postMessage.bind(started)
        started.postMessage = (message: VolumetryJob) => {
          if (message.type === 'evaluate') dispatches.textContent = String(++dispatchCount)
          else element('comparison-dispatches').textContent = String(++comparisonDispatchCount)
          post(message)
        }
        worker = started
        return started
      },
    })
    const view = params.has('no-render') ? undefined : mountResectionViewer(element('viewer'), controller)
    const session = new PlanSession(controller)
    const difference = bindPlanDifference(controller, session, {
      planA, planB, toggle: element('show-differences'), legend: element('difference-legend'),
      status: element('difference-status'), rows: element('difference-rows'), retry: element('retry-difference'),
    }, visible => view?.setComparisonVisible(visible))
    const unbind = bindPlaneControls(controller, {
      offset: element('offset'), angle: element('angle'),
      offsetReadout: element('offset-value'), angleReadout: element('angle-value'),
      flip: element('flip'), reset: element('reset'),
      presets: { 'negative-offset': element('negative'), 'centre-tilt': element('centre'), 'positive-offset': element('positive') },
    })

    function renderPlanOptions() {
      const plans = session.list()
      for (const [index, select] of [planA, planB].entries()) {
        const previous = select.value
        select.replaceChildren(...plans.map(plan => new Option(plan.name, plan.id)))
        select.value = plans.some(plan => plan.id === previous) ? previous : plans[index]?.id ?? ''
      }
      difference.syncPair()
    }

    let loadStarted: { selectionToken: number; time: number } | undefined
    let inputStarted: { revision: number; time: number } | undefined
    let renderedCaseToken: number | undefined
    let showSavedMetrics = false
    function renderSavedMetrics(state = controller.state) {
      const pair = state.status === 'ready' && state.comparison.status !== 'idle' ? state.comparison.pair : undefined
      element<HTMLButtonElement>('compare').disabled = !pair
      const current = pair && showSavedMetrics ? session.compare([pair[0].id, pair[1].id]) : undefined
      comparison.textContent = current?.rows.map(row => `${row.label}: ${row.values.join(' | ')}`).join('\n') ?? ''
    }
    const render = controller.subscribe(state => {
      if (params.has('research')) {
        if (state.status === 'loading') loadStarted = { selectionToken: state.selectionToken, time: performance.now() }
        if (state.status === 'ready' && state.measurements.status === 'updating' && inputStarted?.revision !== state.revision) {
          inputStarted = { revision: state.revision, time: performance.now() }
        }
        if (state.status === 'ready' && state.measurements.status === 'ready'
            && inputStarted?.revision === state.revision && workerTiming?.revision === state.revision
            && workerTiming.selectionToken === state.selectionToken) {
          const start = inputStarted.time
          inputStarted = undefined
          const workerMs = workerTiming.evaluationMs
          const loadStart = loadStarted?.selectionToken === state.selectionToken ? loadStarted.time : undefined
          loadStarted = undefined
          // Give the viewer's queued render and the results DOM update a frame to reach the screen.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const latest = controller.state
            if (latest.status !== 'ready' || latest.revision !== state.revision) return
            const now = performance.now()
            element('last-timing').textContent = JSON.stringify({
              caseId: state.caseId, revision: state.revision, workerMs,
              inputToResultMs: now - start,
              ...(loadStart === undefined ? {} : { loadMs: now - loadStart }),
            })
          }))
        }
      }
      const panel = measurementPanel(state)
      save.disabled = !panel.canSave
      status.textContent = panel.status === 'unavailable' ? panel.message
        : state.status === 'ready' ? panel.status : state.status
      revision.textContent = state.status === 'ready' ? String(state.revision) : ''
      results.textContent = panel.status === 'ready'
        ? panel.rows.map(row => `${row.label}: ${row.value}`).join('\n') : ''
      const current = state.status === 'ready' ? state.comparison : undefined
      element('comparison-result').textContent = current?.status === 'ready' ? JSON.stringify({
        planIds: current.pair.map(plan => plan.id), volumes: current.result,
      }) : ''
      element<HTMLButtonElement>('open').disabled = state.status !== 'ready' || session.list().length === 0
      if (state.status !== 'ready') showSavedMetrics = false
      renderSavedMetrics(state)
      if (state.status === 'ready' && renderedCaseToken !== state.selectionToken) {
        renderedCaseToken = state.selectionToken
        renderPlanOptions()
      }
    })
    const events = new AbortController()
    const options = { signal: events.signal }
    picker.append(...catalog.index.cases.map(item => new Option(item.caseId, item.caseId)))
    picker.addEventListener('change', () => { void controller.selectCase(picker.value) }, options)
    element('retry-case').addEventListener('click', () => { void controller.retry() }, options)
    element<HTMLInputElement>('overlay').addEventListener('change', event => {
      view?.setPlaneVisible((event.currentTarget as HTMLInputElement).checked)
    }, options)
    element<HTMLInputElement>('opacity').addEventListener('input', event => {
      view?.setLiverOpacity((event.currentTarget as HTMLInputElement).valueAsNumber)
    }, options)
    save.addEventListener('click', () => {
      const plan = session.save({ name: name.value })
      element('saved-plan').textContent = JSON.stringify(plan)
      renderPlanOptions()
      element<HTMLButtonElement>('open').disabled = false
    }, options)
    element('open').addEventListener('click', () => { session.open(planA.value) }, options)
    element('compare').addEventListener('click', () => {
      showSavedMetrics = true
      renderSavedMetrics()
    }, options)
    element('crash').addEventListener('click', () => {
      worker?.dispatchEvent(new ErrorEvent('error', { message: 'Synthetic worker crash', cancelable: true }))
    }, options)

    workspace = {
      dispose() {
        events.abort()
        render()
        difference.dispose()
        unbind()
        view?.dispose()
        controller.dispose()
      },
    }
    status.textContent = 'Select a case'
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error)
  }
}

element('retry-index').addEventListener('click', () => { void loadWorkspace() })
window.addEventListener('pagehide', () => workspace?.dispose(), { once: true })
void loadWorkspace()
