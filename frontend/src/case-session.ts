import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CaseController } from './planning/case-controller.ts'
import type { CaseState } from './planning/case-controller.ts'
import { loadCaseIndex } from './planning/case-loader.ts'
import type { LoadedCaseIndex } from './planning/case-loader.ts'
import { PlanSession } from './planning/plan-session.ts'
import { defaultPlane } from './planning/plane-controls.ts'

export const demoId = 'case-002'
const indexUrl = new URL('cases/index.json', new URL(import.meta.env.BASE_URL, location.href))
const idle: CaseState = { status: 'idle' }

type Engine = { controller: CaseController; session: PlanSession }
type Catalogue =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: LoadedCaseIndex; engine?: Engine }

export type LoadStatus = { message: string; retry?: boolean; choose?: boolean }

function describeCatalogue(catalogue: Catalogue, hasDemo: boolean): LoadStatus {
  switch (catalogue.status) {
    case 'error': return { message: catalogue.message, retry: true }
    case 'ready':
      if (hasDemo) return { message: `Loading ${demoId}…` }
      return catalogue.data.index.cases.length
        ? { message: `Demo case ${demoId} is unavailable.`, choose: true }
        : { message: 'No prepared cases available.', retry: true }
    case 'loading': return { message: 'Loading case catalogue…' }
  }
}

function describeCase(state: CaseState, catalogueStatus: LoadStatus): LoadStatus {
  switch (state.status) {
    case 'loading': return { message: `Loading ${state.caseId}…` }
    case 'error': return { message: state.message, retry: true, choose: true }
    case 'ready': return { message: 'Liver and tumour meshes loaded.' }
    case 'idle': return catalogueStatus
  }
}

export function usePreparedCases() {
  const [catalogue, setCatalogue] = useState<Catalogue>({ status: 'loading' })
  const [demo, setDemo] = useState<Extract<CaseState, { status: 'ready' }>>()
  const request = useRef<AbortController | undefined>(undefined)
  const engine = useRef<Engine | undefined>(undefined)

  const loadCatalogue = useCallback(async () => {
    if (request.current || engine.current) return
    const abort = new AbortController()
    request.current = abort
    setCatalogue({ status: 'loading' })
    try {
      const data = await loadCaseIndex(indexUrl, abort.signal)
      abort.signal.throwIfAborted()
      if (data.index.cases.length) {
        const controller = new CaseController(data)
        engine.current = { controller, session: new PlanSession(controller) }
        if (data.index.cases.some(entry => entry.caseId === demoId)) {
          void controller.selectCase(demoId)
        }
      }
      setCatalogue({ status: 'ready', data, engine: engine.current })
    } catch (error) {
      if (!abort.signal.aborted) {
        setCatalogue({ status: 'error', message: error instanceof Error ? error.message : 'Cannot load case catalogue.' })
      }
    } finally {
      if (request.current === abort) request.current = undefined
    }
  }, [])

  useEffect(() => {
    void loadCatalogue()
    return () => {
      request.current?.abort()
      request.current = undefined
      engine.current?.controller.dispose()
      engine.current = undefined
    }
  }, [loadCatalogue])

  const controller = catalogue.status === 'ready' ? catalogue.engine?.controller : undefined
  const session = catalogue.status === 'ready' ? catalogue.engine?.session : undefined
  const subscribe = useCallback((notify: () => void) => controller?.subscribe(notify) ?? (() => {}), [controller])
  const snapshot = useCallback(() => controller?.state ?? idle, [controller])
  const state = useSyncExternalStore(subscribe, snapshot)
  useEffect(() => {
    if (state.status !== 'ready' || state.caseId !== demoId) return
    setDemo(cached => cached?.selectionToken === state.selectionToken ? cached : {
      ...state, plane: defaultPlane(state.liver.bounds), comparison: { status: 'idle' },
    })
  }, [state])
  const cases = catalogue.status === 'ready' ? catalogue.data.index.cases : []
  const hasDemo = cases.some(entry => entry.caseId === demoId)
  const activeId = state.status === 'idle' ? undefined : state.caseId
  const catalogueStatus = describeCatalogue(catalogue, hasDemo)
  const caseStatus = describeCase(state, catalogueStatus)
  const visibleDemo = activeId === demoId && state.status !== 'ready' ? undefined : demo
  const demoStatus = activeId === demoId ? caseStatus : visibleDemo ? describeCase(visibleDemo, catalogueStatus)
    : activeId && hasDemo
    ? { message: 'Open the demo to load this case.' } : catalogueStatus

  function selectCase(caseId: string) {
    if (!controller || !cases.some(entry => entry.caseId === caseId)) return
    const current = controller.state
    if (current.status === 'idle' || current.caseId !== caseId) void controller.selectCase(caseId)
  }

  return {
    controller, state, activeId, cases, caseStatus, demoStatus, demo: visibleDemo, hasDemo, catalogueStatus,
    session,
    selectCase,
    loadCatalogue,
    retryCase() {
      if (controller?.state.status === 'error') void controller.retry()
      else void loadCatalogue()
    },
    retryMeasurement() { void controller?.retry() },
  }
}
