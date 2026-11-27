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

export function measurementRows(result: VolumetryResult, locale = 'en', includeTotal = true) {
  const volume = volumeFormatter(locale)
  const other = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  return [
      ...(includeTotal ? [{ label: 'Total liver parenchyma', value: volume(result.totalParenchymaMl) }] : []),
      { label: 'Removed volume', value: volume(result.resectedMl) },
      { label: 'Remaining volume', value: volume(result.remainingMl) },
      { label: 'Future Liver Remnant (FLR)', value: `${other.format(result.flrPercent)}%` },
      { label: 'Resected percentage', value: `${other.format(result.resectedPercent)}%` },
      { label: 'Tumour intersection', value: result.tumourIntersectsPlane ? 'Touches or crosses' : 'Separate' },
      { label: 'Tumour-to-plane distance (geometric estimate)', value: `${other.format(result.tumourPlaneDistanceMm)} mm` },
  ]
}
