import type { CaseController, CaseState } from './case-controller.ts'
import { measurementRows } from './measurements-panel.ts'
import type { ResectionPlane } from './plane.ts'
import type { Vec3 } from './case-contract.ts'
import type { VolumetryResult } from './volumetry.ts'

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
  readonly rows: ReadonlyArray<{ label: string; values: readonly string[] }>
}

export function compareSavedPlans(plans: readonly SavedPlan[], locale = 'en'): PlanComparison {
  const columns = plans.map(plan => measurementRows(plan.result, locale, false))
  const rows = columns[0].map(({ label }, row) => ({
    label, values: columns.map(column => column[row].value),
  }))
  return { plans, rows }
}

function scope(state: Extract<CaseState, { status: 'ready' }>): string {
  return JSON.stringify([state.metadata.releaseId, state.caseId])
}

function snapshotVector(vector: Vec3): Vec3 {
  return Object.freeze([vector[0], vector[1], vector[2]] as const)
}

export class PlanSession {
  readonly #controller: Pick<CaseController, 'state' | 'restorePlane' | 'selectComparison'>
  readonly #plans = new Map<string, SavedPlan[]>()
  #nextId = 0

  constructor(controller: Pick<CaseController, 'state' | 'restorePlane' | 'selectComparison'>) {
    this.#controller = controller
  }

  save(details: PlanDetails): SavedPlan {
    const name = details.name.trim()
    if (!name) throw new Error('Enter a plan name.')
    const state = this.#controller.state
    if (state.status !== 'ready' || state.measurements.status !== 'ready') {
      throw new Error('Wait for measurements for the current case and plane before saving.')
    }

    const plan = Object.freeze({
      id: `plan-${++this.#nextId}`,
      name,
      procedureType: details.procedureType,
      reason: details.reason,
      notes: details.notes,
      releaseId: state.metadata.releaseId,
      caseId: state.caseId,
      plane: Object.freeze({
        pointMm: snapshotVector(state.plane.pointMm),
        unitNormal: snapshotVector(state.plane.unitNormal),
        resectSide: state.plane.resectSide,
      }),
      result: Object.freeze({ ...state.measurements.result }),
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
