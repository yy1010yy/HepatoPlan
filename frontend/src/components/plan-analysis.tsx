import { useId, useLayoutEffect, useRef, useState } from 'react'
import { AnalysisPanel, searchOutcome, TestedCutMeasurements } from './analysis-panel.tsx'
import { Button, Status } from './controls.tsx'
import { AnalysisAttempt, analysisContext, fetchAnalysis, singleAnalysisRequest } from '../planning/analysis-client.ts'
import type { AnalysisResponse, SingleAnalysisRequest } from '../planning/analysis-contract.ts'
import type { CaseController, CaseState, OffsetSearchState } from '../planning/case-controller.ts'
import type { OffsetSearchResult } from '../planning/volumetry.ts'
import type { PlanContext } from '../plan-context.ts'

type ReadyCase = Extract<CaseState, { status: 'ready' }>
type AnalysisState =
  | { phase: 'idle' | 'searching' | 'searchError' }
  | { phase: 'analysing' | 'apiError'; request?: SingleAnalysisRequest }
  | { phase: 'ready'; request: SingleAnalysisRequest; result: AnalysisResponse }

function waitForSearch(controller: CaseController, source: ReadyCase, signal: AbortSignal) {
  return new Promise<Extract<OffsetSearchState, { status: 'ready' | 'error' }> | undefined>(resolve => {
    let unsubscribe: (() => void) | undefined
    let completed = false
    const finish = (result?: Extract<OffsetSearchState, { status: 'ready' | 'error' }>) => {
      completed = true
      signal.removeEventListener('abort', abort)
      unsubscribe?.()
      resolve(result)
    }
    const abort = () => finish()
    signal.addEventListener('abort', abort, { once: true })
    unsubscribe = controller.subscribe(next => {
      if (signal.aborted || next.status !== 'ready' || next.revision !== source.revision
          || next.selectionToken !== source.selectionToken) return finish()
      if (next.offsetSearch?.status !== 'loading') finish(next.offsetSearch)
    })
    if (completed) unsubscribe()
  })
}

export function planAnalysisScope(state: CaseState, context: PlanContext) {
  // Custom entry text never crosses this boundary, even if it matches a built-in label.
  const selected = analysisContext({ procedureType: context.procedureType.selected, reason: context.reason.selected })
  const scope = state.status === 'ready'
    ? JSON.stringify([state.metadata.releaseId, state.caseId, state.selectionToken, state.revision, selected]) : state.status
  return { scope, selected }
}

export function usePlanAnalysis({ controller, state, context, showPlane, locked, onPreview }: {
  controller?: CaseController; state: CaseState; context: PlanContext; showPlane: () => void
  locked?: boolean; onPreview: (search: OffsetSearchResult) => void
}) {
  const { scope, selected } = planAnalysisScope(state, context)
  const ready = state.status === 'ready' && state.measurements.status === 'ready' && !!state.measurements.result.tumourCentres ? state : undefined
  const id = useId()
  const resultRef = useRef<HTMLElement>(null)
  const [entry, setEntry] = useState<{ scope: string; value: AnalysisState }>()
  const analysis: AnalysisState = entry?.scope === scope ? entry.value : { phase: 'idle' }
  const setAnalysis = (value: AnalysisState) => setEntry({ scope, value })
  const [attempt] = useState(() => new AnalysisAttempt())
  useLayoutEffect(() => {
    setEntry(previous => previous?.scope === scope ? previous : undefined)
    return () => attempt.cancel()
  }, [attempt, scope])
  useLayoutEffect(() => {
    if (analysis.phase !== 'ready' && analysis.phase !== 'apiError' && analysis.phase !== 'searchError') return
    const result = resultRef.current
    const rail = result?.closest<HTMLElement>('.plan-readings')
    if (!result || !rail || getComputedStyle(rail).overflowY !== 'auto') return
    rail.scrollTop += result.getBoundingClientRect().top - rail.getBoundingClientRect().top - 12
  }, [analysis.phase])
  const busy = analysis.phase === 'searching' || analysis.phase === 'analysing'
  const request = 'request' in analysis ? analysis.request : undefined
  const measured = ready?.offsetSearch?.status === 'ready' && ready.offsetSearch.result.outcome === 'improvement'
    ? ready.offsetSearch.result : undefined
  const label = analysis.phase === 'apiError' ? 'Retry analysis' : analysis.phase === 'searchError' ? 'Retry search' : 'Analyse this plan'
  const status = {
    idle: '', searching: 'Testing offsets…', analysing: 'Analysing…',
    searchError: 'Offset search unavailable.', apiError: 'AI analysis unavailable.', ready: 'Analysis ready.',
  }[analysis.phase]

  async function analyse() {
    if (busy || locked || !controller || !ready) return
    const active = controller.state
    if (active.status !== 'ready' || active.revision !== ready.revision || active.selectionToken !== ready.selectionToken) return
    const signal = attempt.start()
    let search = analysis.phase === 'apiError' ? active.offsetSearch : undefined
    if (search?.status !== 'ready') {
      setAnalysis({ phase: 'searching' })
      if (!controller.startOffsetSearch()) {
        setAnalysis({ phase: 'searchError' })
        return
      }
      search = await waitForSearch(controller, ready, signal)
      if (signal.aborted || !search) return
      if (search.status === 'error') {
        setAnalysis({ phase: 'searchError' })
        return
      }
    }
    let prepared: SingleAnalysisRequest | undefined
    try {
      prepared = singleAnalysisRequest(ready, search.result, selected)
      setAnalysis({ phase: 'analysing', request: prepared })
      const result = await fetchAnalysis(prepared, signal)
      if (!signal.aborted) setAnalysis({ phase: 'ready', request: prepared, result })
    } catch {
      if (!signal.aborted) setAnalysis({ phase: 'apiError', request: prepared })
    }
  }

  const resultId = `${id}-result`
  const previewLabel = analysis.phase === 'apiError' ? 'Preview measured alternative'
    : analysis.phase === 'ready' && analysis.result.recommendation.action === 'preview_alternative'
      ? 'Preview alternative' : undefined
  return {
    trigger: <Button className="plan-analysis-trigger" disabled={!ready || !controller || locked}
      aria-disabled={busy || undefined} aria-controls={resultId} onClick={() => void analyse()}>{label}</Button>,
    result: <section id={resultId} className={analysis.phase === 'idle' ? 'plan-analysis-idle' : 'plan-analysis-result'}
      ref={resultRef} aria-labelledby={analysis.phase === 'idle' ? undefined : `${id}-title`}>
      {analysis.phase !== 'idle' && <h2 id={`${id}-title`}>Plan analysis</h2>}
      <Status id={`${id}-status`}>{status}</Status>
      {analysis.phase === 'ready' && (
        <AnalysisPanel result={analysis.result}
          actions={{
            inspect_plane: { run: () => { showPlane(); document.getElementById('plane-offset')?.focus() } },
            inspect_removal_side: { run: () => document.getElementById('removal-side-control')?.focus() },
          }} />
      )}
      {request && (request.search.outcome === 'improvement'
        ? <TestedCutMeasurements request={request} />
        : analysis.phase !== 'ready' && <p className="analysis-finding">{searchOutcome(request.search.outcome)}</p>)}
      {previewLabel && measured && request?.search.outcome === 'improvement' && (
        <div className="actions">
          <Button className={analysis.phase === 'ready' ? 'button-primary' : undefined}
            onClick={() => onPreview(measured)}>{previewLabel}</Button>
        </div>
      )}
    </section>
  }
}
