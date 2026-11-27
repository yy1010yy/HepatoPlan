import type { CaseController, CaseState } from './case-controller.ts'
import { measurementLabels, measurementRows } from './measurements-panel.ts'
import type { ResectionPlane } from './plane.ts'
import type { Vec3 } from './case-contract.ts'
import type { OffsetSearchResult, VolumetryResult } from './volumetry.ts'

export type PlanDetails = {
  readonly name: string
  readonly procedureType?: string
  readonly reason?: string
  readonly notes?: string
}

export type SavedPlan = PlanDetails & {
  readonly id: string
  readonly releaseId: string
  readonly caseId: string
  readonly plane: ResectionPlane
  readonly result: VolumetryResult
}

export type PlanComparison = {
  readonly plans: ReadonlyArray<SavedPlan>
  readonly rows: ReadonlyArray<{ label: string; values: readonly string[]; advantage?: 0 | 1 }>
}

const volumeMetrics: Readonly<Record<string, (result: VolumetryResult) => number>> = {
  [measurementLabels.removed]: result => -result.resectedMl,
  [measurementLabels.remaining]: result => result.remainingMl,
  [measurementLabels.flr]: result => result.flrPercent,
  [measurementLabels.resected]: result => -result.resectedPercent,
}

export function compareSavedPlans(plans: readonly SavedPlan[], locale = 'en'): PlanComparison {
  const columns = plans.map(plan => measurementRows(plan.result, locale, false))
  const rows = columns[0].map(({ label }, row) => {
    const values = columns.map(column => column[row].value)
    const score = volumeMetrics[label]
    if (plans.length !== 2 || values[0] === values[1] || !score) return { label, values }
    const a = score(plans[0].result)
    const b = score(plans[1].result)
    const advantage = a === b ? undefined : a > b ? 0 as const : 1 as const
    return { label, values, advantage }
  })
  return { plans, rows }
}

function scope(state: Extract<CaseState, { status: 'ready' }>): string {
  return JSON.stringify([state.metadata.releaseId, state.caseId])
}

function snapshotVector(vector: Vec3): Vec3 {
  return Object.freeze([vector[0], vector[1], vector[2]] as const)
}

function planName(details: PlanDetails): string {
  const name = details.name.trim()
  if (!name) throw new Error('Enter a plan name.')
  return name
}

export class PlanSession {
  readonly #controller: Pick<CaseController, 'state' | 'restorePlane' | 'selectComparison'>
  readonly #plans = new Map<string, SavedPlan[]>()
  #nextId = 0

  constructor(controller: Pick<CaseController, 'state' | 'restorePlane' | 'selectComparison'>) {
    this.#controller = controller
  }

  save(details: PlanDetails): SavedPlan {
    const name = planName(details)
    const state = this.#controller.state
    if (state.status !== 'ready' || state.measurements.status !== 'ready') {
      throw new Error('Wait for measurements for the current case and plane before saving.')
    }

    return this.#saveSnapshot({ ...details, name }, state, state.plane, state.measurements.result)
  }

  saveAlternative(details: PlanDetails, search: OffsetSearchResult): SavedPlan {
    const state = this.#controller.state
    if (state.status !== 'ready' || state.offsetSearch?.status !== 'ready'
        || state.offsetSearch.result !== search || search.outcome !== 'improvement') {
      throw new Error('Search again for an alternative to the current cut before saving.')
    }
    return this.#saveSnapshot({ ...details, name: planName(details) }, state, search.alternative.plane, search.alternative.result)
  }

  #saveSnapshot(details: PlanDetails, state: Extract<CaseState, { status: 'ready' }>,
    plane: ResectionPlane, result: VolumetryResult): SavedPlan {
    const plan = Object.freeze({
      id: `plan-${++this.#nextId}`,
      name: details.name,
      procedureType: details.procedureType,
      reason: details.reason,
      notes: details.notes,
      releaseId: state.metadata.releaseId,
      caseId: state.caseId,
      plane: Object.freeze({
        pointMm: snapshotVector(plane.pointMm),
        unitNormal: snapshotVector(plane.unitNormal),
        resectSide: plane.resectSide,
      }),
      result: Object.freeze({ ...result, ...(result.tumourCentres && {
        tumourCentres: Object.freeze({ ...result.tumourCentres }),
      }) }),
    })
    const key = scope(state)
    const current = this.#plans.get(key)
    if (current) current.push(plan)
    else this.#plans.set(key, [plan])
    return plan
  }

  list(): readonly SavedPlan[] {
    const state = this.#controller.state
    return state.status === 'ready' ? [...(this.#plans.get(scope(state)) ?? [])] : []
  }

  open(planId: string): SavedPlan {
    const plan = this.#find(planId)
    this.#controller.restorePlane(plan.plane)
    return plan
  }

  selectComparison(planAId: string, planBId: string): void {
    const current = this.list()
    this.#controller.selectComparison(
      current.find(plan => plan.id === planAId),
      current.find(plan => plan.id === planBId),
    )
  }

  compare(planIds: readonly string[], locale = 'en'): PlanComparison {
    if (planIds.length < 2 || new Set(planIds).size !== planIds.length) {
      throw new Error('Select at least two distinct saved plans.')
    }
    const current = this.list()
    const plans = planIds.map(planId => this.#find(planId, current))
    return compareSavedPlans(plans, locale)
  }

  #find(planId: string, current = this.list()): SavedPlan {
    const plan = current.find(saved => saved.id === planId)
    if (!plan) throw new Error('Select a saved plan from the active case and release.')
    return plan
  }
}
