import { isAnalysisResponse, isComparisonAnalysisRequest, isSingleAnalysisRequest } from '../frontend/src/planning/analysis-contract.ts'
import type {
  AnalysisAction, AnalysisContext, AnalysisFinding, AnalysisLimitation, AnalysisRequest, AnalysisResponse,
  ComparisonAnalysisRequest, SingleAnalysisRequest,
} from '../frontend/src/planning/analysis-contract.ts'
import { volumeFormatter } from '../frontend/src/planning/measurements-panel.ts'
import { planContextOptions } from '../frontend/src/plan-context.ts'
import type { VolumetryResult } from '../frontend/src/planning/volumetry.ts'

type Fact = AnalysisFinding & { id: string }
type Action = { id: AnalysisAction; rationaleFactIds: string[] }
type Catalogue = {
  findings: Fact[]
  observations: Fact[]
  requiredObservationIds: string[]
  rationales: Fact[]
  actions: Action[]
  limitations: AnalysisLimitation[]
}
type Selection = { findingId: string; observationIds: string[]; actionId: string; rationaleFactIds: string[] }
type Mode = 'single' | 'comparison'
export type FindTumourCount = (releaseId: string, caseId: string) => number | undefined

const volume = volumeFormatter()
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const signed = (n: number) => n > 0 ? `+${number.format(n)}` : number.format(n)
const gap = (mm: number) => mm > 0 && mm < 0.01 ? 'less than 0.01 mm' : `${number.format(mm)} mm`
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

function allowedContext(context?: AnalysisContext): boolean {
  return !context || (['procedureType', 'reason'] as const).every(key =>
    context[key] === undefined || planContextOptions[key].groups.some(group => group.options.includes(context[key]!)))
}

function validMeasurements(m: VolumetryResult, tumourCount: number): boolean {
  const centres = m.tumourCentres
  return close(m.remainingMl + m.resectedMl, m.totalParenchymaMl)
    && close(m.remainingMl / m.totalParenchymaMl * 100, m.flrPercent)
    && close(m.resectedMl / m.totalParenchymaMl * 100, m.resectedPercent)
    && m.tumourIntersectsPlane === (m.tumourPlaneDistanceMm === 0)
    && (!centres || (centres.removal + centres.retained + centres.onPlane === tumourCount
      && (centres.onPlane === 0 || m.tumourIntersectsPlane)))
}

function qualifies(m: VolumetryResult): boolean {
  return !m.tumourIntersectsPlane && !!m.tumourCentres
    && m.tumourCentres.retained === 0 && m.tumourCentres.onPlane === 0
}

function validSearch({ current, search }: SingleAnalysisRequest): boolean {
  const { minOffsetMm: low, maxOffsetMm: high, testedCount, qualifyingCount, outcome } = search
  if (low !== -high || testedCount !== high - low + 1 || qualifyingCount > testedCount
      || current.offsetMm < low || current.offsetMm > high) return false
  const currentQualifies = qualifies(current.measurements)
  if (outcome === 'current_best') return currentQualifies && qualifyingCount > 0
  if (outcome === 'no_gain') return !currentQualifies && qualifyingCount > 0 && qualifyingCount < testedCount
  if (outcome === 'none_qualify') return !currentQualifies && qualifyingCount === 0
  if (search.outcome !== 'improvement') return false
  const { alternative } = search
  return qualifyingCount >= (currentQualifies ? 2 : 1) && (currentQualifies || qualifyingCount < testedCount)
    && alternative.offsetMm !== current.offsetMm && alternative.offsetMm >= low && alternative.offsetMm <= high
    && alternative.angleDeg === current.angleDeg && alternative.resectSide === current.resectSide
    && qualifies(alternative.measurements) && alternative.measurements.remainingMl > current.measurements.remainingMl
    && close(alternative.measurements.totalParenchymaMl, current.measurements.totalParenchymaMl)
}

function validComparison(request: ComparisonAnalysisRequest): boolean {
  const a = request.planA.measurements
  const b = request.planB.measurements
  if (!close(a.totalParenchymaMl, b.totalParenchymaMl)) return false
  if (request.spatialStatus !== 'ready') return true
  const { removedOnlyByAMl: onlyA, removedOnlyByBMl: onlyB, removedByBothMl: both,
    retainedByBothMl: neither } = request.differenceVolumes
  return close(onlyA + onlyB + both + neither, a.totalParenchymaMl)
    && close(onlyA + both, a.resectedMl) && close(onlyB + both, b.resectedMl)
    && close(onlyB + neither, a.remainingMl) && close(onlyA + neither, b.remainingMl)
}

function fact(id: string, text: string, ...evidence: string[]): Fact {
  return { id, text, evidence }
}

function catalogue(): Catalogue {
  return {
    findings: [], observations: [], requiredObservationIds: [], rationales: [], actions: [],
    limitations: ['volume_only', 'geometric_gap_only'],
  }
}

function offer(result: Catalogue, id: AnalysisAction, rationale: Fact): void {
  result.rationales.push(rationale)
  result.actions.push({ id, rationaleFactIds: [rationale.id] })
}

function contact(m: VolumetryResult): string {
  return m.tumourIntersectsPlane ? 'touches or crosses the segmented tumour'
    : `is separate from the segmented tumour with an estimated gap of ${gap(m.tumourPlaneDistanceMm)}`
}

function sides(m: VolumetryResult): string {
  const counts = m.tumourCentres!
  if (!counts.retained && !counts.onPlane) return 'All segmented tumour centres lie on the removal side.'
  return `Segmented tumour voxel centres: ${counts.removal} on the removal side, ${counts.retained} on the retained side, ${counts.onPlane} on the plane.`
}

function singleEvidence({ current, search }: SingleAnalysisRequest): Catalogue {
  const result = catalogue()
  const m = current.measurements
  if (search.outcome === 'improvement') {
    const winner = search.alternative
    const next = winner.measurements
    result.findings.push(fact('offset_gain',
      `Moving the offset from ${signed(current.offsetMm)} mm to ${signed(winner.offsetMm)} mm retained ${volume(next.remainingMl - m.remainingMl)} more parenchyma.`,
      'current.offsetMm', 'search.alternative.offsetMm', 'current.measurements.remainingMl', 'search.alternative.measurements.remainingMl'))
    result.observations.push(fact('gap_change',
      `The estimated gap was ${gap(m.tumourPlaneDistanceMm)} for the current cut and ${gap(next.tumourPlaneDistanceMm)} for the tested cut.`,
      'current.measurements.tumourPlaneDistanceMm', 'search.alternative.measurements.tumourPlaneDistanceMm'))
    result.requiredObservationIds.push('gap_change')
    offer(result, 'preview_alternative', fact('preview_tested_cut',
      `Inspect the tested cut at ${signed(winner.offsetMm)} mm. Its plane ${contact(next)}. ${sides(next)}`,
      'search.alternative.offsetMm', 'search.alternative.measurements.tumourPlaneDistanceMm',
      'search.alternative.measurements.tumourIntersectsPlane', 'search.alternative.measurements.tumourCentres'))
  } else {
    const outcomeText = {
      current_best: 'This cut already retains the most parenchyma among qualifying offsets.',
      no_gain: 'Qualifying offsets exist, and each retains at most as much parenchyma as the current cut.',
      none_qualify: 'No tested offset met both tumour conditions.',
    }[search.outcome]
    result.findings.push(fact(search.outcome,
      `${outcomeText} HepatoPlan tested ${search.testedCount} offsets at ${signed(current.angleDeg)}° with the ${current.resectSide} removal side.`,
      'search.outcome', 'search.testedCount', 'search.qualifyingCount', 'current.angleDeg', 'current.resectSide'))
    offer(result, 'inspect_plane', fact('inspect_current_contact', `Inspect the current plane. It ${contact(m)}.`,
      'current.measurements.tumourIntersectsPlane', 'current.measurements.tumourPlaneDistanceMm'))
    if (!qualifies(m)) {
      offer(result, 'inspect_removal_side', fact('inspect_current_side', `Check the current removal side. ${sides(m)}`,
        'current.resectSide', 'current.measurements.tumourCentres'))
    }
    offer(result, 'view_measurements', fact('inspect_search_outcome', 'Review the measured cut and the range tested at this angle.',
      'search.outcome', 'search.minOffsetMm', 'search.maxOffsetMm', 'current.measurements.remainingMl'))
  }
  result.observations.push(fact('current_side', sides(m), 'current.measurements.tumourCentres'))
  return result
}

function comparisonEvidence(request: ComparisonAnalysisRequest): Catalogue {
  const result = catalogue()
  const a = request.planA.measurements
  const b = request.planB.measurements
  const delta = b.remainingMl - a.remainingMl
  const flrDelta = b.flrPercent - a.flrPercent
  const contactChanges = a.tumourIntersectsPlane !== b.tumourIntersectsPlane
  const higherVolumeHasSmallerGap = (delta > 0 && b.tumourPlaneDistanceMm < a.tumourPlaneDistanceMm)
    || (delta < 0 && a.tumourPlaneDistanceMm < b.tumourPlaneDistanceMm)
  const differingRegions = request.spatialStatus === 'ready'
    && (request.differenceVolumes.removedOnlyByAMl > 0 || request.differenceVolumes.removedOnlyByBMl > 0)
  const direction = delta > 0 ? 'B' : 'A'
  const volumeText = delta === 0 ? (differingRegions
    ? 'Both plans retain the same measured volume and preserve different regions.'
    : 'Both plans retain the same measured volume.')
    : `Plan ${direction} retains ${volume(Math.abs(delta))} more parenchyma.`
  const evidence = ['planA.measurements.remainingMl', 'planB.measurements.remainingMl']
  if (delta === 0 && differingRegions) {
    evidence.push('differenceVolumes.removedOnlyByAMl', 'differenceVolumes.removedOnlyByBMl')
  }
  const tumourText = `A's plane ${contact(a)}. B's plane ${contact(b)}.`
  const tumourEvidence = ['planA.measurements.tumourIntersectsPlane', 'planB.measurements.tumourIntersectsPlane',
    'planA.measurements.tumourPlaneDistanceMm', 'planB.measurements.tumourPlaneDistanceMm']
  const leadWithTumour = contactChanges || higherVolumeHasSmallerGap
  result.findings.push(fact(delta === 0 ? 'equal_remaining' : `${direction.toLowerCase()}_retains_more`,
    leadWithTumour ? `${volumeText} ${tumourText}` : volumeText, ...evidence, ...(leadWithTumour ? tumourEvidence : [])))
  if (delta !== 0) {
    result.observations.push(fact('flr_delta', `B minus A is ${signed(flrDelta)} percentage points of volume-based FLR.`,
      'planA.measurements.flrPercent', 'planB.measurements.flrPercent'))
  }
  if (!leadWithTumour) result.observations.push(fact('compare_tumour_contact', tumourText, ...tumourEvidence))
  if (!a.tumourCentres || !b.tumourCentres) result.limitations.push('tumour_side_unmeasured')
  if (request.spatialStatus !== 'ready') result.limitations.push('spatial_unavailable')
  if (request.spatialStatus === 'ready' && differingRegions) {
    const { removedOnlyByAMl: onlyA, removedOnlyByBMl: onlyB } = request.differenceVolumes
    const exclusive = fact('exclusive_regions',
      `A alone removes ${volume(onlyA)}. B alone removes ${volume(onlyB)}. ${delta === 0
        ? 'The equal totals include different tissue.' : 'These exclusive regions account for the net difference.'}`,
      'differenceVolumes.removedOnlyByAMl', 'differenceVolumes.removedOnlyByBMl')
    result.observations.push(exclusive)
    result.requiredObservationIds.push(exclusive.id)
    offer(result, 'show_differences', fact('inspect_exclusive_regions', 'Use Show differences to inspect the exclusive regions.',
      ...exclusive.evidence))
  }
  for (const [label, m] of [['a', a], ['b', b]] as const) {
    const key = `plan${label.toUpperCase()}.measurements`
    if (m.tumourCentres) result.observations.push(fact(`${label}_tumour_side`, `Plan ${label.toUpperCase()}. ${sides(m)}`, `${key}.tumourCentres`))
    if (contactChanges && !m.tumourIntersectsPlane) continue
    if (delta === 0 && differingRegions && !contactChanges) continue
    offer(result, label === 'a' ? 'open_plan_a' : 'open_plan_b', fact(`inspect_plan_${label}`,
      `Open Plan ${label.toUpperCase()} to inspect its plane. It ${contact(m)}.`,
      `${key}.tumourIntersectsPlane`, `${key}.tumourPlaneDistanceMm`))
  }
  if (!contactChanges && !(delta === 0 && differingRegions)) {
    offer(result, 'view_measurements', fact('inspect_saved_measurements', 'Review both saved readings in the comparison table.', ...evidence))
  }
  return result
}

export function prepareAnalysis(mode: Mode, value: unknown, findTumourCount: FindTumourCount) {
  const request = mode === 'single' && isSingleAnalysisRequest(value) ? value
    : mode === 'comparison' && isComparisonAnalysisRequest(value) ? value : undefined
  if (!request) return undefined
  const tumourCount = findTumourCount(request.releaseId, request.caseId)
  if (tumourCount === undefined || !Number.isSafeInteger(tumourCount) || tumourCount <= 0) return undefined
  const cuts = 'revision' in request
    ? [request.current, ...(request.search.outcome === 'improvement' ? [request.search.alternative] : [])]
    : [request.planA, request.planB]
  if (!cuts.every(cut => validMeasurements(cut.measurements, tumourCount) && allowedContext(cut.context))) return undefined
  const single = 'revision' in request
  if (!(single ? validSearch(request) : validComparison(request))) return undefined
  const facts = single ? singleEvidence(request) : comparisonEvidence(request)
  const providerInput = {
    mode,
    objective: single ? 'Retain more parenchyma at the current angle and side while meeting both tumour conditions.'
      : 'Compare preserved parenchyma and the segmented tumour relationship. Recommend an inspection.',
    contexts: single ? { current: request.current.context } : { A: request.planA.context, B: request.planB.context },
    findings: providerFacts(facts.findings),
    observations: providerFacts(facts.observations),
    requiredObservationIds: facts.requiredObservationIds,
    rationales: providerFacts(facts.rationales),
    actions: facts.actions,
    limitations: facts.limitations,
  }
  return { providerInput, resolve: (selection: unknown) => resolveSelection(request, facts, selection) }
}

function providerFacts(entries: Fact[]) {
  return entries.map(({ id, text }) => ({ id, text }))
}

function isSelection(input: unknown): input is Selection {
  if (typeof input !== 'object' || input === null || Object.keys(input).length !== 4) return false
  const value = input as Partial<Selection>
  const ids = (list: unknown): list is string[] => Array.isArray(list) && list.length <= 5
    && list.every(id => typeof id === 'string') && new Set(list).size === list.length
  return typeof value.findingId === 'string' && typeof value.actionId === 'string'
    && ids(value.observationIds) && ids(value.rationaleFactIds) && value.rationaleFactIds.length > 0
}

function resolveSelection(request: AnalysisRequest, catalogue: Catalogue, selection: unknown): AnalysisResponse | undefined {
  if (!isSelection(selection)) return undefined
  const finding = catalogue.findings.find(item => item.id === selection.findingId)
  const action = catalogue.actions.find(item => item.id === selection.actionId)
  const observations = selection.observationIds.map(id => catalogue.observations.find(item => item.id === id))
  const rationales = selection.rationaleFactIds.map(id => catalogue.rationales.find(item => item.id === id))
  if (!finding || !action || !observations.every(item => item !== undefined)
      || !rationales.every(item => item !== undefined)
      || !catalogue.requiredObservationIds.every(id => selection.observationIds.includes(id))
      || !selection.rationaleFactIds.every(id => action.rationaleFactIds.includes(id))) return undefined
  const { version, requestId, caseId, releaseId } = request
  const identity = 'revision' in request ? { mode: 'single', revision: request.revision }
    : { mode: 'comparison', planAId: request.planAId, planBId: request.planBId }
  const display = ({ text, evidence }: Fact): AnalysisFinding => ({ text, evidence })
  const response = {
    ...identity, version, requestId, caseId, releaseId,
    finding: display(finding), observations: observations.map(display), limitations: catalogue.limitations,
    recommendation: {
      action: action.id, rationale: rationales.map(item => item.text).join(' '),
      evidence: [...new Set(rationales.flatMap(item => item.evidence))],
    },
  }
  return isAnalysisResponse(response, request) ? response : undefined
}
