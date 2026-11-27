import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { usePreparedCases } from './case-session.ts'
import type { CaseState, ComparisonPair } from './planning/case-controller.ts'
import { defaultPlane } from './planning/plane-controls.ts'
import type { ResectionPlane } from './planning/plane.ts'
import type { PlanDetails, SavedPlan } from './planning/plan-session.ts'
import { planContextFor, planContextValues } from './plan-context.ts'

type View = 'landing' | 'plan' | 'compare'
type Destination =
  | { kind: 'case'; caseId: string }
  | { kind: 'open'; planId: string }
  | { kind: 'leave'; hash: string; fromHistory?: boolean }
type Ready = Extract<CaseState, { status: 'ready' }>

function viewFor(hash: string): View {
  if (hash === '#compare') return 'compare'
  return hash === '#plan' ? 'plan' : 'landing'
}

function samePlane(a: ResectionPlane, b: ResectionPlane) {
  return a.resectSide === b.resectSide
    && a.pointMm.every((value, i) => Math.abs(value - b.pointMm[i]) < 1e-9)
    && a.unitNormal.every((value, i) => Math.abs(value - b.unitNormal[i]) < 1e-12)
}

export function continuationLabel(destination: Destination) {
  if (destination.kind === 'case') return 'switch cases'
  if (destination.kind === 'open') return 'open plan'
  return 'leave planning'
}

export function usePlanWorkflow(planning: ReturnType<typeof usePreparedCases>, demoId: string) {
  const [view, setView] = useState<View>(() => viewFor(location.hash) === 'landing' ? 'landing' : 'plan')
  const [baseline, setBaseline] = useState<SavedPlan>()
  const [context, setContext] = useState(() => planContextFor())
  const [lastSave, setLastSave] = useState<SavedPlan>()
  const [selection, setSelection] = useState<{ pair: ComparisonPair; plans: readonly SavedPlan[] }>()
  const [caseOpener, setCaseOpener] = useState<HTMLElement | null>(null)
  const [uploadOpener, setUploadOpener] = useState<HTMLButtonElement | null>(null)
  const [savedOpener, setSavedOpener] = useState<HTMLElement | null>(null)
  const [saveOpener, setSaveOpener] = useState<HTMLElement | null>(null)
  const [pending, setPending] = useState<{ destination: Destination; opener: HTMLElement }>()
  const lastReady = useRef<Ready>(null)

  const { state, session, controller } = planning
  useLayoutEffect(() => {
    if (state.status === 'ready') lastReady.current = state
  }, [state])
  const working = state.status === 'ready' ? state
    : lastReady.current?.caseId === planning.activeId ? lastReady.current : undefined
  const initialPlane = working && (baseline?.plane ?? defaultPlane(working.liver.bounds))
  const dirty = !!(working && initialPlane && !samePlane(working.plane, initialPlane))
  const plans = session?.list() ?? []
  const canSave = state.status === 'ready' && state.measurements.status === 'ready'

  function closeDialogs() {
    setCaseOpener(null)
    setUploadOpener(null)
    setSavedOpener(null)
    setSaveOpener(null)
    setPending(undefined)
  }

  function navigate(next: View, hash = `#${next}`, replace = false) {
    if (location.hash !== hash) {
      if (replace) history.replaceState(null, '', hash || location.pathname + location.search)
      else history.pushState(null, '', hash || location.pathname + location.search)
    }
    setView(next)
  }

  function goCompare(latest = false) {
    if (plans.length < 2) return
    const previous = selection?.pair
    const reuse = !latest && previous && previous.every(plan => plans.some(item => item.id === plan.id))
    setSelection({ plans, pair: reuse ? previous : [plans.at(-2)!, plans.at(-1)!] })
    navigate('compare')
  }

  function perform(destination: Destination, discard = false) {
    closeDialogs()
    switch (destination.kind) {
      case 'case':
        if (destination.caseId !== planning.activeId) {
          setBaseline(undefined)
          setContext(planContextFor())
          setLastSave(undefined)
          setSelection(undefined)
          lastReady.current = null
          planning.selectCase(destination.caseId)
        }
        navigate('plan')
        break
      case 'open': {
        const opened = session?.open(destination.planId)
        setBaseline(opened)
        setContext(planContextFor(opened))
        setLastSave(undefined)
        navigate('plan')
        break
      }
      case 'leave':
        if (discard && initialPlane) {
          controller?.restorePlane(initialPlane)
          setContext(planContextFor(baseline))
        }
        navigate('landing', destination.hash, destination.fromHistory)
        break
    }
  }

  function request(destination: Destination, opener: HTMLElement) {
    if (dirty && (destination.kind !== 'case' || destination.caseId !== planning.activeId)) {
      setPending({ destination, opener })
    } else perform(destination)
  }

  function save(details: Pick<PlanDetails, 'name' | 'notes'>) {
    if (!session) return
    const plan = session.save({ ...details, ...planContextValues(context) })
    setBaseline(plan)
    setLastSave(plan)
    if (pending) perform(pending.destination)
    else setSaveOpener(null)
  }

  const syncRoute = useEffectEvent(() => {
    const hash = location.hash
    const next = viewFor(hash)
    if (next === 'landing' && view !== 'landing' && dirty) {
      // Hash traversal already moved the URL. Keep the editor in place until a choice is made.
      history.pushState(null, '', `#${view}`)
      const focus = document.activeElement
      request({ kind: 'leave', hash, fromHistory: true }, focus instanceof HTMLElement ? focus : document.body)
      return
    }
    if (next === 'compare') {
      if (plans.length < 2) navigate('plan', '#plan', true)
      else goCompare()
    } else setView(next)
    closeDialogs()
  })

  useEffect(() => {
    const onHashChange = () => syncRoute()
    onHashChange()
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function explore(event: MouseEvent<HTMLAnchorElement>) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    request({ kind: 'case', caseId: demoId }, event.currentTarget)
  }

  return {
    view, plans, selection, baseline, context, setContext, dirty, canSave, pending, caseOpener, uploadOpener, savedOpener, saveOpener,
    savedName: !dirty && lastSave === baseline ? lastSave?.name : undefined,
    setCaseOpener, setUploadOpener, setSavedOpener, setSaveOpener, setPending,
    save, goCompare, explore, request,
    discard() { if (pending) perform(pending.destination, true) },
    backToPlan() { navigate('plan') },
    setPair(pair: ComparisonPair) { if (selection) setSelection({ ...selection, pair }) },
  }
}
