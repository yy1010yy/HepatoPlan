import type { CaseState } from './case-controller.ts'
import type { VolumetryResult } from './volumetry.ts'

export type MeasurementPanel =
  | { status: 'idle' | 'updating'; canSave: false }
  | { status: 'unavailable'; canSave: false; message: string }
  | {
    status: 'ready'
    canSave: true
    result: VolumetryResult
    rows: ReadonlyArray<{ label: string; value: string }>
  }

export function measurementPanel(state: CaseState, locale = 'en'): MeasurementPanel {
  if (state.status === 'idle') return { status: 'idle', canSave: false }
  if (state.status === 'loading') return { status: 'updating', canSave: false }
  if (state.status === 'error') {
    return { status: 'unavailable', canSave: false, message: state.message }
  }
  const measurements = state.measurements
  if (measurements.status === 'updating') return { status: 'updating', canSave: false }
  if (measurements.status === 'unavailable') {
    return { status: 'unavailable', canSave: false, message: measurements.message }
  }

  const { result } = measurements
  return { status: 'ready', canSave: true, result, rows: measurementRows(result, locale) }
}

export function volumeFormatter(locale = 'en') {
  const volume = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  return (ml: number) => `${volume.format(ml)} mL`
}

export const measurementLabels = {
  total: 'Total liver parenchyma',
  removed: 'Removed volume',
  remaining: 'Remaining volume',
  flr: 'Future Liver Remnant (FLR)',
  resected: 'Resected percentage',
  intersection: 'Tumour intersection',
  distance: 'Tumour-to-plane distance (geometric estimate)',
}

const lowerFlrReference = 20
const upperFlrReference = 30

export function flrBenchmark(flrPercent: number) {
  if (flrPercent < lowerFlrReference) {
    return { band: 'below', label: 'Below reference',
      message: `FLR is below ${lowerFlrReference}%. Low FLR is linked to post-hepatectomy liver failure (PHLF).` }
  }
  if (flrPercent < upperFlrReference) {
    return { band: 'borderline', label: 'Borderline',
      message: `FLR is within the ${lowerFlrReference}–${upperFlrReference}% reference range.` }
  }
  return { band: 'meets', label: 'Meets reference', message: `FLR meets the ${upperFlrReference}% healthy-liver volume benchmark.` }
}

export function measurementRows(result: VolumetryResult, locale = 'en', includeTotal = true) {
  const volume = volumeFormatter(locale)
  const other = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  return [
      ...(includeTotal ? [{ label: measurementLabels.total, value: volume(result.totalParenchymaMl) }] : []),
      { label: measurementLabels.removed, value: volume(result.resectedMl) },
      { label: measurementLabels.remaining, value: volume(result.remainingMl) },
      { label: measurementLabels.flr, value: `${other.format(result.flrPercent)}%` },
      { label: measurementLabels.resected, value: `${other.format(result.resectedPercent)}%` },
      { label: measurementLabels.intersection, value: result.tumourIntersectsPlane ? 'Touches or crosses' : 'Separate' },
      { label: measurementLabels.distance, value: `${other.format(result.tumourPlaneDistanceMm)} mm` },
  ]
}
