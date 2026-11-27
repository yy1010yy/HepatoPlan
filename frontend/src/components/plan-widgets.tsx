import { useRef } from 'react'
import type { MouseEventHandler } from 'react'
import { Button, LabelledRange, MetricRow, Status } from './controls.tsx'
import type { CaseController, CaseState } from '../planning/case-controller.ts'
import { PLANE_PRESETS, planeReadouts, presetPlane } from '../planning/plane-controls.ts'
import type { PlanePreset } from '../planning/plane-controls.ts'
import { measurementLabels, measurementPanel } from '../planning/measurements-panel.ts'

type Editing = { state: CaseState; controller?: CaseController }

export function Presets({ state, controller }: Editing) {
  return (
    <div className="actions presets" role="group" aria-label="Plane presets">
      {(Object.keys(PLANE_PRESETS) as PlanePreset[]).map(key => {
        let pressed = false
        if (state.status === 'ready') {
          const preset = presetPlane(state.liver.bounds, key, state.plane.resectSide)
          pressed = preset.pointMm.every((value, i) => value === state.plane.pointMm[i])
            && preset.unitNormal.every((value, i) => Math.abs(value - state.plane.unitNormal[i]) < 1e-12)
        }
        return <Button key={key} aria-pressed={pressed} disabled={state.status !== 'ready'}
          onClick={() => controller?.applyPlanePreset(key)}>{PLANE_PRESETS[key].label}</Button>
      })}
    </div>
  )
}

export function PlaneControls({ state, controller, planeVisible, liverOpacity, onVisibility, onOpacity }: Editing & {
  planeVisible: boolean; liverOpacity: number; onVisibility: (value: boolean) => void; onOpacity: (value: number) => void
}) {
  const ready = state.status === 'ready'
  const plane = ready ? planeReadouts(state.liver.bounds, state.plane) : undefined
  const offsetLimit = plane?.offsetLimitMm ?? 1
  return (
    <section className="panel controls" aria-labelledby="plane-title">
      <h2 id="plane-title">Resection plane</h2>
      <LabelledRange id="plane-offset" label="Plane offset" min={-offsetLimit} max={offsetLimit} step={1}
        value={Math.round(plane?.offsetMm ?? 0)} readout={plane?.offsetText} aria-valuetext={plane?.offsetText}
        disabled={!ready} onChange={event => controller?.setPlaneOffset(event.currentTarget.valueAsNumber)} />
      <LabelledRange id="plane-angle" label="Plane angle" min={-45} max={45} step={1}
        value={Math.round(plane?.angleDeg ?? 0)} readout={plane?.angleText} aria-valuetext={plane?.angleText}
        disabled={!ready} onChange={event => controller?.setPlaneAngle(event.currentTarget.valueAsNumber)} />
      <p className="status removal-side">Removal side <strong>{ready ? state.plane.resectSide : '—'}</strong></p>
      <div className="actions">
        <Button disabled={!ready} onClick={() => controller?.flipResectSide()}>Flip removal side</Button>
        <Button disabled={!ready} onClick={() => controller?.resetPlane()}>Reset plane</Button>
      </div>
      <fieldset className="display-controls" disabled={!ready}>
        <legend>Display</legend>
        <label className="show-plane"><input type="checkbox" checked={planeVisible}
          onChange={event => onVisibility(event.currentTarget.checked)} /> Show plane</label>
        <LabelledRange id="liver-opacity" label="Liver opacity" min={0} max={100} step={1}
          value={liverOpacity} readout={`${liverOpacity}%`} aria-valuetext={`${liverOpacity}%`}
          onChange={event => onOpacity(event.currentTarget.valueAsNumber)} />
      </fieldset>
    </section>
  )
}

export function Measurements({ state, onRetry, onSave, onCompare, savedName }: {
  state: CaseState
  onRetry: () => void
  onSave: MouseEventHandler<HTMLButtonElement>
  onCompare?: () => void
  savedName?: string
}) {
  const statusRef = useRef<HTMLParagraphElement>(null)
  const measurements = measurementPanel(state)
  const rows = new Map(measurements.status === 'ready' ? measurements.rows.map(row => [row.label, row.value]) : [])
  const failed = state.status === 'ready' && measurements.status === 'unavailable'
  const updating = state.status === 'ready' && measurements.status === 'updating'
  const read = (label: string) => rows.get(label) ?? '—'
  const flr = measurements.status === 'ready' ? measurements.result.flrPercent : undefined
  return (
    <section className="panel readings" aria-labelledby="readings-title">
      <h2 id="readings-title">Measurements</h2>
      <dl className="metrics">
        <MetricRow id="remaining" label={measurementLabels.remaining} value={read(measurementLabels.remaining)} />
        <MetricRow id="flr" label={measurementLabels.flr} value={read(measurementLabels.flr)} />
      </dl>
      <div className="flr-track">
        {flr !== undefined && <meter id="flr-bar" aria-label={measurementLabels.flr} min={0} max={100} value={flr} />}
      </div>
      <dl className="measurement-details">
        {(['total', 'removed', 'resected', 'intersection', 'distance'] as const).map(key => (
          <MetricRow key={key} id={`measure-${key}`} label={measurementLabels[key]} value={read(measurementLabels[key])} />
        ))}
      </dl>
      <Status id="measurement-status" statusRef={statusRef}>
        {updating ? 'Updating measurements…' : failed ? measurements.message : ''}
      </Status>
      <Button id="measurement-retry" hidden={!failed} onClick={() => { statusRef.current?.focus(); onRetry() }}>
        Retry measurements
      </Button>
      <Button className="button-primary" id="save-plan" disabled={!measurements.canSave}
        aria-haspopup="dialog" onClick={onSave}>
        Save plan
      </Button>
      {savedName && <Status id="save-status">Saved {savedName}.</Status>}
      {onCompare && <Button onClick={onCompare}>Compare these plans</Button>}
    </section>
  )
}
