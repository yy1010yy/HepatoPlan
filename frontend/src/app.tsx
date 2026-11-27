import { StrictMode, useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from './components/controls.tsx'
import { CaseChooser, UploadPreview } from './components/dialog.tsx'
import { LandingNavigation } from './components/landing-content.tsx'
import { demoId, usePreparedCases } from './case-session.ts'
import { Landing, Workspace } from './components/views.tsx'
import { CompareView } from './components/compare-view.tsx'
import { SavedPlansDialog, SavePlanDialog, UnsavedCutDialog } from './components/plan-dialogs.tsx'
import { continuationLabel, usePlanWorkflow } from './plan-workflow.ts'
import './app.css'

function App() {
  const planning = usePreparedCases()
  const flow = usePlanWorkflow(planning, demoId)
  const workspace = flow.view !== 'landing'
  const lastView = useRef(flow.view)
  const main = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const selectButton = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (lastView.current !== flow.view) {
      lastView.current = flow.view
      title.current?.focus()
    }
  }, [flow.view])
  const canCompare = flow.plans.length >= 2
  const continuation = flow.pending && continuationLabel(flow.pending.destination)

  return (
    <>
      <a className="skip-link" id="skip-link" href="#main"
        onClick={event => { event.preventDefault(); main.current?.focus() }}>Skip to content</a>
      <header className="header">
        <div className="wrap header-inner">
          <a className="brand" href="#home" aria-label="HepatoPlan home" onClick={event => {
            if (!workspace || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            flow.request({ kind: 'leave', hash: '#home' }, event.currentTarget)
          }}>
            <span className="brand-mark" aria-hidden="true"><i /></span>
            HepatoPlan
          </a>
          <p className="purpose">For research and education</p>
          {!workspace && <LandingNavigation onExplore={flow.explore} />}
          {workspace && (
            <div className="workspace-header" id="workspace-header">
              <div className="case-actions">
                <span id="active-case" className="pill">{planning.activeId ?? 'No case selected'}</span>
                <Button id="choose-case" className="button-compact" ref={selectButton} aria-haspopup="dialog"
                  onClick={event => flow.setCaseOpener(event.currentTarget)}>Choose case</Button>
              </div>
              <nav className="mode-nav" aria-label="Workspace">
                <a className="button button-compact" id="plan-link" href="#plan"
                  aria-current={flow.view === 'plan' ? 'page' : undefined}
                  onClick={event => { event.preventDefault(); flow.backToPlan() }}>Plan</a>
                <a className="button button-compact" id="compare-link" href="#compare"
                  aria-current={flow.view === 'compare' ? 'page' : undefined}
                  aria-disabled={flow.view !== 'compare' && !canCompare}
                  aria-describedby={flow.view === 'plan' && !canCompare ? 'compare-status' : undefined}
                  onClick={event => { event.preventDefault(); if (flow.view !== 'compare') flow.goCompare() }}>Compare</a>
              </nav>
              <Button className="button-compact" aria-haspopup="dialog" disabled={planning.state.status !== 'ready'}
                onClick={event => flow.setSavedOpener(event.currentTarget)}>Saved plans · {flow.plans.length}</Button>
            </div>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} ref={main}>
        {flow.view === 'compare' && flow.selection ? (
          <CompareView titleRef={title} plans={flow.selection.plans} pair={flow.selection.pair}
            onPair={flow.setPair} state={planning.state} controller={planning.controller}
            onOpen={(planId, opener) => flow.request({ kind: 'open', planId }, opener)} onBack={flow.backToPlan} />
        ) : workspace ? (
          <Workspace titleRef={title} state={planning.state} controller={planning.controller} status={planning.caseStatus}
            planCount={flow.plans.length} dirty={flow.dirty} baseline={flow.baseline} savedName={flow.savedName}
            context={flow.context} onContextChange={flow.setContext}
            onSave={event => flow.setSaveOpener(event.currentTarget)} onCompare={canCompare ? () => flow.goCompare(true) : undefined}
            onRetry={planning.retryCase} onRetryMeasurement={planning.retryMeasurement}
            onChoose={event => flow.setCaseOpener(event.currentTarget)} />
        ) : (
          <Landing titleRef={title} demo={planning.demo} status={planning.demoStatus} onRetry={planning.retryCase}
            onChoose={event => flow.setCaseOpener(event.currentTarget)}
            onExplore={flow.explore} onUpload={event => flow.setUploadOpener(event.currentTarget)} />
        )}
      </main>
      <CaseChooser opener={flow.caseOpener} fallback={selectButton} activeId={planning.activeId} cases={planning.cases}
        status={planning.hasDemo ? { message: '' } : planning.catalogueStatus}
        onCancel={() => flow.setCaseOpener(null)} onRetry={planning.loadCatalogue}
        onSelect={(caseId, opener) => flow.request({ kind: 'case', caseId }, opener)}
        onUpload={event => flow.setUploadOpener(event.currentTarget)} />
      {flow.uploadOpener && <UploadPreview opener={flow.uploadOpener} fallback={selectButton}
        unavailable={planning.cases.length > 0 && !planning.hasDemo}
        onCancel={() => flow.setUploadOpener(null)}
        onContinue={event => flow.request({ kind: 'case', caseId: demoId }, event.currentTarget)} />}
      {flow.savedOpener && <SavedPlansDialog opener={flow.savedOpener} fallback={selectButton} plans={flow.plans}
        onCancel={() => flow.setSavedOpener(null)}
        onOpen={(planId, opener) => flow.request({ kind: 'open', planId }, opener)} />}
      {flow.pending && <UnsavedCutDialog opener={flow.pending.opener} fallback={selectButton}
        continuation={continuation!} canSave={flow.canSave} onCancel={() => flow.setPending(undefined)}
        canDiscard={flow.pending.destination.kind !== 'open' || planning.state.status === 'ready'}
        onSave={event => flow.setSaveOpener(event.currentTarget)} onDiscard={flow.discard} />}
      {flow.saveOpener && <SavePlanDialog opener={flow.saveOpener} fallback={selectButton}
        previous={flow.baseline} continuation={continuation} canSave={flow.canSave}
        onCancel={() => flow.setSaveOpener(null)} onSave={flow.save} />}
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing HepatoPlan app root')
createRoot(root).render(<StrictMode><App /></StrictMode>)
