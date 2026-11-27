import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from './components/controls.tsx'
import { CaseChooser, UploadPreview } from './components/dialog.tsx'
import { LandingNavigation } from './components/landing-content.tsx'
import { demoId, usePreparedCases } from './case-session.ts'
import { Landing, Workspace } from './components/views.tsx'
import './app.css'

function isWorkspaceRoute() {
  return location.hash === '#plan' || location.hash === '#compare'
}

function App() {
  const planning = usePreparedCases()
  const [workspace, setWorkspace] = useState(isWorkspaceRoute)
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const [uploadOpener, setUploadOpener] = useState<HTMLButtonElement | null>(null)
  const lastView = useRef(workspace)
  const main = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const selectButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function syncRoute() {
      if (location.hash === '#compare') history.replaceState(null, '', '#plan')
      setWorkspace(isWorkspaceRoute())
      setOpener(null)
      setUploadOpener(null)
    }
    syncRoute()
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useLayoutEffect(() => {
    if (lastView.current !== workspace) {
      lastView.current = workspace
      title.current?.focus()
    }
  }, [workspace])

  function explore(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) planning.selectCase(demoId)
  }

  function enterPlan(caseId: string) {
    setOpener(null)
    setUploadOpener(null)
    planning.selectCase(caseId)
    if (!workspace) {
      history.pushState(null, '', '#plan')
      setWorkspace(true)
    }
  }

  return (
    <>
      <a className="skip-link" id="skip-link" href="#main"
        onClick={event => { event.preventDefault(); main.current?.focus() }}>Skip to content</a>
      <header className="header">
        <div className="wrap header-inner">
          <a className="brand" href="#home" aria-label="HepatoPlan home">
            <span className="brand-mark" aria-hidden="true"><i /></span>
            HepatoPlan
          </a>
          <p className="purpose">For research and education</p>
          {!workspace && <LandingNavigation onExplore={explore} />}
          {workspace && (
            <div className="workspace-header" id="workspace-header">
              <div className="case-actions">
                <span id="active-case" className="pill">{planning.activeId ?? 'No case selected'}</span>
                <Button id="choose-case" className="button-compact" ref={selectButton} aria-haspopup="dialog"
                  onClick={event => setOpener(event.currentTarget)}>Choose case</Button>
              </div>
              <nav className="mode-nav" aria-label="Workspace">
                <a className="button button-compact" id="plan-link" href="#plan" aria-current="page">Plan</a>
                <a className="button button-compact" id="compare-link" href="#compare" aria-disabled="true"
                  aria-describedby="compare-status" onClick={event => event.preventDefault()}>Compare</a>
              </nav>
            </div>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} ref={main}>
        {workspace ? (
          <Workspace titleRef={title} state={planning.state} controller={planning.controller} status={planning.caseStatus}
            planCount={planning.planCount} onRetry={planning.retryCase} onRetryMeasurement={planning.retryMeasurement}
            onChoose={event => setOpener(event.currentTarget)} />
        ) : (
          <Landing titleRef={title} demo={planning.demo} status={planning.demoStatus} onRetry={planning.retryCase}
            onChoose={event => setOpener(event.currentTarget)}
            onExplore={explore} onUpload={event => setUploadOpener(event.currentTarget)} />
        )}
      </main>
      <CaseChooser opener={opener} fallback={selectButton} activeId={planning.activeId} cases={planning.cases}
        status={planning.hasDemo ? { message: '' } : planning.catalogueStatus}
        onCancel={() => setOpener(null)} onRetry={planning.loadCatalogue} onSelect={enterPlan}
        onUpload={event => setUploadOpener(event.currentTarget)} />
      {uploadOpener && <UploadPreview opener={uploadOpener} fallback={selectButton}
        unavailable={planning.cases.length > 0 && !planning.hasDemo}
        onCancel={() => setUploadOpener(null)} onContinue={() => enterPlan(demoId)} />}
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing HepatoPlan app root')
createRoot(root).render(<StrictMode><App /></StrictMode>)
