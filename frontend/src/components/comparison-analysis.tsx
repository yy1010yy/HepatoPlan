import { useId, useLayoutEffect, useRef, useState } from 'react'
import { AnalysisPanel } from './analysis-panel.tsx'
import { Button, Status } from './controls.tsx'
import { AnalysisAttempt, comparisonAnalysisRequest, fetchAnalysis } from '../planning/analysis-client.ts'
import type { AnalysisResponse, ComparisonAnalysisRequest } from '../planning/analysis-contract.ts'
import type { CaseController, CaseState, ComparisonPair } from '../planning/case-controller.ts'

type State =
  | { phase: 'idle' | 'measuring' | 'analysing' | 'error' }
  | { phase: 'ready'; request: ComparisonAnalysisRequest; result: AnalysisResponse }

type Props = {
  controller?: CaseController
  state: CaseState
  pair: ComparisonPair
  onOpen: (id: string, opener: HTMLButtonElement) => void
}

export function useComparisonAnalysis({ controller, state, pair, onOpen }: Props) {
  const scope = JSON.stringify([pair[0].releaseId, pair[0].caseId, pair[0].id, pair[1].id,
    state.status === 'ready' ? state.selectionToken : state.status])
  const id = useId()
  const resultRef = useRef<HTMLElement>(null)
  const [attempt] = useState(() => new AnalysisAttempt())
  const [entry, setEntry] = useState<{ scope: string; value: State }>()
  const analysis: State = entry?.scope === scope ? entry.value : { phase: 'idle' }
  const setAnalysis = (value: State) => setEntry({ scope, value })
  useLayoutEffect(() => {
    setEntry(previous => previous?.scope === scope ? previous : undefined)
    return () => attempt.cancel()
  }, [attempt, scope])
  useLayoutEffect(() => {
    const result = resultRef.current
    const rail = result?.closest<HTMLElement>('.compare-results')
    if (!result || !rail || getComputedStyle(rail).overflowY !== 'auto') return
    if (analysis.phase === 'idle') rail.scrollTop = 0
    else if (analysis.phase === 'ready' || analysis.phase === 'error') {
      rail.scrollTop += result.getBoundingClientRect().top - rail.getBoundingClientRect().top - 12
    }
  }, [analysis.phase, scope])
  const busy = analysis.phase === 'measuring' || analysis.phase === 'analysing'
  const ready = state.status === 'ready' && state.caseId === pair[0].caseId && state.metadata.releaseId === pair[0].releaseId
  const label = analysis.phase === 'error' ? 'Retry analysis'
    : analysis.phase === 'ready' && analysis.request.spatialStatus === 'unavailable'
      ? 'Analyse with region volumes' : 'Analyse comparison'
  const status = {
    idle: '', measuring: 'Measuring differences…', analysing: 'Analysing…',
    error: 'AI analysis unavailable.', ready: 'Analysis ready.',
  }[analysis.phase]

  async function analyse() {
    if (!ready || busy || !controller) return
    const source = controller.state
    if (source.status !== 'ready' || source.selectionToken !== state.selectionToken) return
    const signal = attempt.start()
    try {
      setAnalysis({ phase: 'measuring' })
      if (source.comparison.status === 'error' && source.comparison.pair[0] === pair[0] && source.comparison.pair[1] === pair[1]) {
        controller.retryComparison()
      }
      const difference = await controller.collectComparison(pair, signal)
      const current = controller.state
      if (signal.aborted || current.status !== 'ready' || current.selectionToken !== source.selectionToken
          || current.comparison.status === 'idle'
          || current.comparison.pair[0] !== pair[0] || current.comparison.pair[1] !== pair[1]) return
      const request = comparisonAnalysisRequest(current, pair, difference)
      setAnalysis({ phase: 'analysing' })
      const result = await fetchAnalysis(request, signal)
      if (!signal.aborted) setAnalysis({ phase: 'ready', request, result })
    } catch {
      if (!signal.aborted) setAnalysis({ phase: 'error' })
    }
  }

  const resultId = `${id}-result`
  return {
    trigger: <Button className="compare-analysis-trigger" disabled={!ready || !controller}
      aria-disabled={busy || undefined} aria-controls={resultId} onClick={() => void analyse()}>{label}</Button>,
    result: <section id={resultId} className={analysis.phase === 'idle' ? 'compare-analysis-idle' : 'compare-analysis-result'}
      ref={resultRef} aria-labelledby={analysis.phase === 'idle' ? undefined : `${id}-title`}>
      {analysis.phase !== 'idle' && <h2 id={`${id}-title`}>Comparison analysis</h2>}
      <Status id={`${id}-status`}>{status}</Status>
      {analysis.phase === 'ready' && (
        <AnalysisPanel result={analysis.result} actions={{
            open_plan_a: { run: opener => onOpen(pair[0].id, opener) },
            open_plan_b: { run: opener => onOpen(pair[1].id, opener) },
          }} />
      )}
    </section>
  }
}
