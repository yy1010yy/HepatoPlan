import { useId } from 'react'
import { Button } from './controls.tsx'
import type { AnalysisAction, AnalysisLimitation, AnalysisResponse, SingleAnalysisRequest } from '../planning/analysis-contract.ts'
import { measurementLabels, tumourDistanceFormatter, volumeFormatter } from '../planning/measurements-panel.ts'

const volume = volumeFormatter()
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const signed = (value: number) => `${value > 0 ? '+' : ''}${number.format(value)}`
const distance = tumourDistanceFormatter()
const centreSummary = ({ removal, retained, onPlane }: { removal: number; retained: number; onPlane: number }) =>
  retained === 0 && onPlane === 0 ? 'All on removal side'
    : `${number.format(removal)} removal, ${number.format(retained)} retained, ${number.format(onPlane)} on plane`

const fields = {
  offsetMm: ['Plane offset', (value: number) => `${signed(value)} mm`],
  angleDeg: ['Plane angle', (value: number) => `${signed(value)}°`],
  remainingMl: [measurementLabels.remaining, volume],
  flrPercent: ['Volume-based FLR', (value: number) => `${number.format(value)}%`],
  tumourPlaneDistanceMm: ['Estimated tumour-to-plane gap', distance],
  tumourIntersectsPlane: [measurementLabels.intersection, (value: boolean) => value ? 'Touches or crosses' : 'Separate'],
  tumourCentres: ['Segmented tumour voxel centres', centreSummary],
} as const

export function searchOutcome(outcome: SingleAnalysisRequest['search']['outcome']): string {
  const messages = {
    improvement: 'A tested offset retains more parenchyma and meets both tumour conditions.',
    current_best: 'The current cut already retains the most parenchyma among qualifying offsets.',
    no_gain: 'Qualifying offsets exist, and each retains at most as much parenchyma as the current cut.',
    none_qualify: 'No tested offset met both tumour conditions.',
  }
  return messages[outcome]
}

const actionLabels: Record<Exclude<AnalysisAction, 'view_measurements'>, string> = {
  preview_alternative: 'Preview alternative',
  inspect_plane: 'Inspect the plane',
  inspect_removal_side: 'Inspect the removal side',
  open_plan_a: 'Open Plan A',
  open_plan_b: 'Open Plan B',
}

const limitationLabels: Record<AnalysisLimitation, string> = {
  volume_only: 'FLR measures volume. Liver function is unmeasured.',
  geometric_gap_only: 'The gap is a geometric estimate. Clinical margin adequacy is unmeasured.',
  tumour_side_unmeasured: 'Tumour side was unmeasured for at least one cut.',
  spatial_unavailable: 'Spatial measurements are unavailable for this pair.',
}

function fieldValue(field: keyof typeof fields, value: unknown): string {
  if (field === 'tumourCentres') return centreSummary(value as Parameters<typeof centreSummary>[0])
  if (field === 'tumourIntersectsPlane') return fields[field][1](Boolean(value))
  return fields[field][1](Number(value))
}

export function TestedCutMeasurements({ request }: { request: SingleAnalysisRequest }) {
  if (request.search.outcome !== 'improvement') return null
  const { current, search: { alternative } } = request
  return (
    <div className="analysis-measurements">
      <p className="status">Fixed at {fieldValue('angleDeg', current.angleDeg)} with the {current.resectSide} removal side.</p>
      <table className="comparison-table">
        <caption>Measured alternative</caption>
        <colgroup><col className="measurement-col" /><col /><col /></colgroup>
        <thead><tr><th scope="col">Measurement</th><th scope="col">Current cut</th><th scope="col">Tested cut</th></tr></thead>
        <tbody>
          <tr><th scope="row">{fields.offsetMm[0]}</th>
            <td>{fieldValue('offsetMm', current.offsetMm)}</td><td>{fieldValue('offsetMm', alternative.offsetMm)}</td></tr>
          {(['remainingMl', 'flrPercent', 'tumourPlaneDistanceMm', 'tumourIntersectsPlane', 'tumourCentres'] as const).map(key => (
            <tr key={key}><th scope="row">{fields[key][0]}</th>
              <td>{fieldValue(key, current.measurements[key])}</td><td>{fieldValue(key, alternative.measurements[key])}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AnalysisPanel({ result, actions }: {
  result: AnalysisResponse
  actions: Partial<Record<Exclude<AnalysisAction, 'view_measurements'>, { run: (opener: HTMLButtonElement) => void }>>
}) {
  const title = useId()
  const { recommendation } = result
  const action = recommendation.action === 'view_measurements' ? undefined : actions[recommendation.action]
  return (
    <section className="analysis-result" aria-labelledby={title}>
      <h3 id={title}>AI recommendation</h3>
      <p className="analysis-finding">{result.finding.text}</p>
      {result.observations.map(observation => <p key={observation.evidence.join(' ')}>{observation.text}</p>)}
      <p>{recommendation.rationale}</p>
      {!!result.limitations.length && <ul className="analysis-limits">
        {result.limitations.map(item => <li key={item}>{limitationLabels[item]}</li>)}
      </ul>}
      {action && recommendation.action !== 'view_measurements' && (
        <div className="actions">
          <Button className="button-primary" onClick={event => action.run(event.currentTarget)}>
            {actionLabels[recommendation.action]}
          </Button>
        </div>
      )}
    </section>
  )
}
