import { CaseController } from '../src/case-controller.ts'
import { loadCaseIndex } from '../src/case-loader.ts'
import { measurementPanel } from '../src/measurements-panel.ts'
import { bindPlaneControls } from '../src/plane-controls.ts'
import { PlanSession } from '../src/plan-session.ts'
import { mountResectionViewer } from '../src/resection-viewer.ts'
import { startVolumetryWorker } from '../src/volumetry-worker.ts'
import type { EvaluateVolumetry, VolumetryWorkerResponse } from '../src/volumetry-worker.ts'

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
        started.postMessage = (message: EvaluateVolumetry) => {
          dispatches.textContent = String(++dispatchCount)
          post(message)
        }
        worker = started
        return started
      },
    })
    const view = params.has('no-render') ? undefined : mountResectionViewer(element('viewer'), controller)
    const session = new PlanSession(controller)
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
    }

    let loadStarted: { selectionToken: number; time: number } | undefined
    let inputStarted: { revision: number; time: number } | undefined
    const render = controller.subscribe(state => {
      if (params.has('research')) {
        if (state.status === 'loading') loadStarted = { selectionToken: state.selectionToken, time: performance.now() }
        if (state.status === 'ready' && state.measurements.status === 'updating') {
          inputStarted = { revision: state.revision, time: performance.now() }
        }
        if (state.status === 'ready' && state.measurements.status === 'ready'
            && inputStarted?.revision === state.revision && workerTiming?.revision === state.revision
            && workerTiming.selectionToken === state.selectionToken) {
          const start = inputStarted.time
          const workerMs = workerTiming.evaluationMs
          const loadStart = loadStarted?.selectionToken === state.selectionToken ? loadStarted.time : undefined
          loadStarted = undefined
          // Give the viewer's queued render and the results DOM update a frame to reach the screen.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (controller.state !== state) return
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
      if (state.status !== 'ready') comparison.textContent = ''
      renderPlanOptions()
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
    }, options)
    element('open').addEventListener('click', () => { session.open(planA.value) }, options)
    element('compare').addEventListener('click', () => {
      const current = session.compare([planA.value, planB.value])
      comparison.textContent = current.rows.map(row => `${row.label}: ${row.values.join(' | ')}`).join('\n')
    }, options)
    element('crash').addEventListener('click', () => {
      worker?.dispatchEvent(new ErrorEvent('error', { message: 'Synthetic worker crash', cancelable: true }))
    }, options)

    workspace = {
      dispose() {
        events.abort()
        render()
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
