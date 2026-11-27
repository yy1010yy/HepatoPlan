import { useRef, useState } from 'react'
import type { MouseEventHandler, RefObject } from 'react'
import { Button, Status } from './controls.tsx'
import { Dialog } from './dialog.tsx'
import type { PlanDetails, SavedPlan } from '../planning/plan-session.ts'

export const sessionNotice = 'Plans are kept in this tab. Refreshing or closing it clears them.'

export function planLabel(plan: SavedPlan, plans: readonly SavedPlan[]) {
  const number = plans.findIndex(item => item.id === plan.id) + 1
  return plans.some(item => item.id !== plan.id && item.name === plan.name)
    ? `${plan.name} (save ${number})` : plan.name
}

type DialogProps = {
  opener: HTMLElement
  fallback: RefObject<HTMLButtonElement | null>
  onCancel: () => void
}

export function PlanDetailsList({ details }: { details: PlanDetails }) {
  const rows = [
    ['Procedure type', details.procedureType],
    ['Reason', details.reason],
    ['Notes', details.notes],
  ].filter(([, value]) => value)
  if (!rows.length) return null
  return (
    <dl className="plan-details">
      {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  )
}

export function SavePlanDialog({ opener, fallback, onCancel, onSave, canSave, previous, continuation, alternative = false }: DialogProps & {
  onSave: (details: Pick<PlanDetails, 'name' | 'notes'>) => void
  canSave: boolean
  previous?: SavedPlan
  continuation?: string
  alternative?: boolean
}) {
  const initialFocus = useRef<HTMLInputElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState('')
  const title = alternative ? 'Save alternative' : 'Save plan'
  return (
    <Dialog id="save-dialog" titleId="save-title" opener={opener} initialFocus={initialFocus} cancel={cancel}
      fallback={fallback} onCancel={onCancel}>
      <h2 id="save-title">{title}</h2>
      <p className="status">{sessionNotice}</p>
      <form className="save-form" onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const value = (name: string) => String(form.get(name) ?? '').trim()
        try {
          onSave({ name: value('name'), notes: value('notes') || undefined })
        } catch (problem) {
          setError(problem instanceof Error ? problem.message : 'Cannot save this plan.')
        }
      }}>
        <label>Plan name<input ref={initialFocus} name="name" required defaultValue={previous?.name} /></label>
        <label>Notes (optional)<textarea name="notes" rows={3} defaultValue={previous?.notes} /></label>
        <Status id="save-error" hidden={!error}>{error}</Status>
        <div className="actions dialog-actions">
          <Button ref={cancel} onClick={onCancel}>Cancel</Button>
          <Button className="button-primary" type="submit" disabled={!canSave}>
            {continuation ? `Save and ${continuation}` : title}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export function SavedPlansDialog({ opener, fallback, onCancel, plans, onOpen }: DialogProps & {
  plans: readonly SavedPlan[]
  onOpen: (id: string, opener: HTMLButtonElement) => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  return (
    <Dialog id="saved-dialog" titleId="saved-title" opener={opener} initialFocus={first} cancel={cancel}
      fallback={fallback} onCancel={onCancel}>
      <h2 id="saved-title">Saved plans</h2>
      <p className="status">{sessionNotice}</p>
      {!plans.length && <p className="status">Save a cut to revisit it here.</p>}
      <ul className="saved-list">
        {plans.map((plan, index) => (
          <li key={plan.id} className="panel">
            <h3>{planLabel(plan, plans)}</h3>
            <PlanDetailsList details={plan} />
            <Button ref={index === 0 ? first : undefined} aria-label={`Open ${planLabel(plan, plans)}`}
              onClick={event => onOpen(plan.id, event.currentTarget)}>Open</Button>
          </li>
        ))}
      </ul>
      <div className="actions dialog-actions"><Button ref={cancel} onClick={onCancel}>Close</Button></div>
    </Dialog>
  )
}

export function UnsavedCutDialog({ opener, fallback, onCancel, continuation, canSave, canDiscard, onSave, onDiscard }: DialogProps & {
  continuation: string
  canSave: boolean
  canDiscard: boolean
  onSave: MouseEventHandler<HTMLButtonElement>
  onDiscard: () => void
}) {
  const stay = useRef<HTMLButtonElement>(null)
  return (
    <Dialog id="unsaved-dialog" titleId="unsaved-title" opener={opener} initialFocus={stay} cancel={stay}
      fallback={fallback} onCancel={onCancel}>
      <h2 id="unsaved-title">Unsaved changes</h2>
      <p className="status">Save your working cut before continuing?</p>
      {!canSave && <p className="status">Wait for current measurements to save the cut.</p>}
      <div className="actions dialog-actions">
        <Button ref={stay} onClick={onCancel}>Stay</Button>
        <Button disabled={!canDiscard} onClick={onDiscard}>Discard and {continuation}</Button>
        <Button className="button-primary" disabled={!canSave} onClick={onSave}>Save and {continuation}</Button>
      </div>
    </Dialog>
  )
}
