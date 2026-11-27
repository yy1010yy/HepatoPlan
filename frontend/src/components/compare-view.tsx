import { useEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { Button, Status } from './controls.tsx'
import { planLabel } from './plan-dialogs.tsx'
import { compareSavedPlans } from '../planning/plan-session.ts'
import type { SavedPlan } from '../planning/plan-session.ts'
import { differenceRegions } from '../planning/plan-difference-panel.ts'
import type { CaseController, CaseState, ComparisonPair } from '../planning/case-controller.ts'
import { volumeFormatter } from '../planning/measurements-panel.ts'
import { AnatomyViewer } from './anatomy-viewer.tsx'

const fields = Object.keys(differenceRegions) as (keyof typeof differenceRegions)[]
const volume = volumeFormatter()

function SpatialDifferences({ state, controller, pair }: {
  state: CaseState; controller?: CaseController; pair: ComparisonPair
}) {
  const statusRef = useRef<HTMLParagraphElement>(null)
  const candidate = state.status === 'ready' ? state.comparison : undefined
  const current = candidate && candidate.status !== 'idle'
    && candidate.pair[0].id === pair[0].id && candidate.pair[1].id === pair[1].id ? candidate : undefined
  const loadFailed = state.status === 'error'
  const failed = current?.status === 'error' || loadFailed
  return (
    <section className="viewport differences" aria-labelledby="differences-title">
      <div className="viewport-caption">
        <h2 id="differences-title">Spatial differences</h2>
        <span className="pill">RAS+ · mm</span>
      </div>
      <div className="difference-body">
        {controller && current && <AnatomyViewer source={controller} comparison rotateOnly liverOpacity={0.85} />}
        <ul className="difference-legend" aria-label="Difference volumes">
          {fields.map(field => (
            <li key={field}>
              <span className="difference-label">
                <span aria-hidden="true" style={{ backgroundColor: differenceRegions[field].colour }} />
                {differenceRegions[field].label}
              </span>
              <strong>{current?.status === 'ready' ? volume(current.result[field]) : '—'}</strong>
            </li>
          ))}
        </ul>
        <Status id="difference-status" statusRef={statusRef}>
          {failed ? 'Difference volumes are unavailable.' : current?.status === 'ready' ? '' : 'Updating differences…'}
        </Status>
        {failed && <Button onClick={() => {
          statusRef.current?.focus()
          if (loadFailed) void controller?.retry()
          else controller?.retryComparison()
        }}>Retry differences</Button>}
      </div>
    </section>
  )
}

export function CompareView({ titleRef, plans, pair, onPair, state, controller, onOpen, onBack }: {
  titleRef: Ref<HTMLHeadingElement>
  plans: readonly SavedPlan[]
  pair: ComparisonPair
  onPair: (pair: ComparisonPair) => void
  state: CaseState
  controller?: CaseController
  onOpen: (id: string, opener: HTMLButtonElement) => void
  onBack: () => void
}) {
  const [showDifferences, setShowDifferences] = useState(false)
  const ready = state.status === 'ready'
  const { rows } = compareSavedPlans(pair)
  useEffect(() => {
    if (ready && showDifferences) controller?.selectComparison(...pair)
  }, [controller, pair, ready, showDifferences])
  useEffect(() => () => controller?.selectComparison(), [controller])

  function updatePair(next: ComparisonPair) {
    if (ready && showDifferences) controller?.selectComparison(...next)
    else controller?.selectComparison()
    onPair(next)
  }

  return (
    <section className="workspace wrap" aria-labelledby="compare-title">
      <div className="workspace-heading">
        <div>
          <h1 id="compare-title" ref={titleRef} tabIndex={-1}>Compare saved plans</h1>
          <p className="status">{pair[0].caseId} · {pair[0].releaseId}</p>
        </div>
        <Button onClick={onBack}>Back to planning</Button>
      </div>
      <div className={`workframe compare-layout${showDifferences ? ' compare-with-differences' : ''}`}>
        <section className="panel compare-controls" aria-labelledby="selected-plans-title">
          <h2 id="selected-plans-title">Selected plans</h2>
          {(['A', 'B'] as const).map((label, index) => (
            <label className="plan-selector" key={label}>Plan {label}
              <select value={pair[index].id} onChange={event => {
                const plan = plans.find(option => option.id === event.currentTarget.value)
                if (plan) updatePair(index === 0 ? [plan, pair[1]] : [pair[0], plan])
              }}>
                {plans.filter(plan => plan.id !== pair[1 - index].id).map(plan => (
                  <option value={plan.id} key={plan.id}>{planLabel(plan, plans)}</option>
                ))}
              </select>
            </label>
          ))}
          <div className="actions compare-actions">
            <Button onClick={() => updatePair([pair[1], pair[0]])}>Swap A/B</Button>
            <Button disabled={!ready} onClick={event => onOpen(pair[0].id, event.currentTarget)}>Open Plan A</Button>
            <Button disabled={!ready} onClick={event => onOpen(pair[1].id, event.currentTarget)}>Open Plan B</Button>
          </div>
          <label className="show-plane">
            <input type="checkbox" checked={showDifferences} onChange={event => {
              if (event.currentTarget.checked) controller?.selectComparison(...pair)
              else controller?.hideComparisonOverlay()
              setShowDifferences(event.currentTarget.checked)
            }} /> Show differences
          </label>
        </section>
        <section className="panel compare-results" aria-labelledby="comparison-table-title">
          <h2 id="comparison-table-title">Saved measurements</h2>
          <table className="comparison-table" aria-labelledby="comparison-table-title">
            <colgroup><col className="measurement-col" /><col /><col /></colgroup>
            <thead>
              <tr>
                <th scope="col">Measurement</th>
                {pair.map((plan, index) => (
                  <th scope="col" key={plan.id}><span>{index === 0 ? 'A' : 'B'}</span> {planLabel(plan, plans)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {pair.map((plan, index) => <td key={plan.id}>{row.values[index]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {showDifferences && <SpatialDifferences state={state} controller={controller} pair={pair} />}
      </div>
    </section>
  )
}
