import type { CaseController, CaseState } from './case-controller.ts'
import { volumeFormatter } from './measurements-panel.ts'
import type { PlanSession } from './plan-session.ts'
import type { PlanDifferenceResult } from './volumetry.ts'

export const differenceRegions = {
  removedOnlyByAMl: { label: 'Removed only by A', colour: '#0072B2' },
  removedOnlyByBMl: { label: 'Removed only by B', colour: '#D55E00' },
  removedByBothMl: { label: 'Removed by both', colour: '#64748B' },
  retainedByBothMl: { label: 'Retained by both', colour: '#CBD5E1' },
} as const satisfies Record<keyof PlanDifferenceResult, { label: string; colour: string }>

type ComparisonControls = {
  planA: HTMLSelectElement
  planB: HTMLSelectElement
  toggle: HTMLInputElement
  legend: HTMLElement
  status: HTMLElement
  rows: HTMLElement
  retry: HTMLButtonElement
}

export function bindPlanDifference(
  controller: Pick<CaseController, 'subscribe' | 'state' | 'retryComparison'>,
  session: Pick<PlanSession, 'selectComparison'>,
  elements: ComparisonControls,
  setSurfaceVisible: (visible: boolean) => void,
  locale = 'en',
) {
  const { planA, planB, toggle, legend, status, rows, retry } = elements
  const events = new AbortController()
  const options = { signal: events.signal }
  const formatVolume = volumeFormatter(locale)
  const document = rows.ownerDocument
  const fields = Object.keys(differenceRegions) as (keyof PlanDifferenceResult)[]
  const entries = fields.map(field => {
    const { label, colour } = differenceRegions[field]
    const row = document.createElement('li')
    const swatch = document.createElement('span')
    swatch.style.cssText = 'display:inline-block;width:1em;height:1em;margin-inline-end:.5em'
    swatch.style.backgroundColor = colour
    swatch.setAttribute('aria-hidden', 'true')
    const value = document.createElement('span')
    row.append(swatch, `${label} `, value)
    return { field, row, value }
  })
  rows.replaceChildren(...entries.map(entry => entry.row))
  toggle.checked = false

  function render(state: CaseState) {
    const comparison = state.status === 'ready' ? state.comparison : undefined
    const valid = comparison !== undefined && comparison.status !== 'idle'
    toggle.disabled = !valid
    const visible = valid && toggle.checked
    legend.hidden = !visible
    setSurfaceVisible(visible)
    status.textContent = visible && comparison.status === 'loading' ? 'Updating…'
      : visible && comparison.status === 'error' ? 'Volumes unavailable' : ''
    retry.hidden = !visible || comparison.status !== 'error'
    for (const { field, value } of entries) {
      value.textContent = visible && comparison.status === 'ready' ? formatVolume(comparison.result[field]) : ''
    }
  }

  function syncPair() {
    session.selectComparison(planA.value, planB.value)
  }
  planA.addEventListener('change', syncPair, options)
  planB.addEventListener('change', syncPair, options)
  toggle.addEventListener('change', () => render(controller.state), options)
  retry.addEventListener('click', () => controller.retryComparison(), options)
  const unsubscribe = controller.subscribe(render)

  return { syncPair, dispose() { events.abort(); unsubscribe() } }
}
