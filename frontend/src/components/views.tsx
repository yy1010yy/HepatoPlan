import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEventHandler, ReactNode, Ref } from 'react'
import { Box3, Vector3 } from 'three'
import { Button, Status } from './controls.tsx'
import { demoId } from '../case-session.ts'
import type { LoadStatus } from '../case-session.ts'
import type { CaseController, CaseState } from '../planning/case-controller.ts'
import type { DecodedMesh } from '../planning/binary-stl.ts'
import { AnatomyViewer } from './anatomy-viewer.tsx'
import type { ResectionViewerSource } from '../planning/resection-viewer.ts'
import { LandingContent } from './landing-content.tsx'
import { MeasurementDetails, PlaneControls, Presets, PrimaryMeasurements } from './plan-widgets.tsx'
import { measurementPanel } from '../planning/measurements-panel.ts'
import { PlanDetailsList } from './plan-dialogs.tsx'
import type { SavedPlan } from '../planning/plan-session.ts'
import type { PlanContext } from '../plan-context.ts'

type CaseActions = {
  status: LoadStatus
  onRetry: () => void
  onChoose: MouseEventHandler<HTMLButtonElement>
}

function CaseViewport({ name, title, caption, extent, status, onRetry, onChoose, children }: CaseActions & {
  name: 'demo' | 'case'
  title: string
  caption: ReactNode
  extent?: string
  children?: ReactNode
}) {
  const statusRef = useRef<HTMLParagraphElement>(null)
  const titleId = name === 'demo' ? 'demo-title' : 'anatomy-title'
  return (
    <section className={`viewport ${name === 'demo' ? 'hero-viewport' : 'plan-viewport'}`} aria-labelledby={titleId}>
      <div className="viewport-caption">
        <h2 id={titleId}>{title}</h2>
        {caption}
      </div>
      <div className={children ? 'viewport-content' : 'viewport-content viewport-content-empty'}>
        {children}
        <div className="viewport-body">
          <Status id={`${name}-status`} statusRef={statusRef}>{status.message}</Status>
          {name === 'case' && <p className="extent" id="case-extent" hidden={!extent}>{extent}</p>}
          {(status.retry || status.choose) && (
            <div className="actions">
              {status.retry && <Button id={`${name}-retry`} onClick={() => { statusRef.current?.focus(); onRetry() }}>Retry</Button>}
              {status.choose && <Button id={`${name}-choose`} aria-haspopup="dialog" onClick={onChoose}>Choose another case</Button>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function Landing({ titleRef, onExplore, onUpload, demo, ...caseActions }: CaseActions & {
  titleRef: Ref<HTMLHeadingElement>
  onExplore: MouseEventHandler<HTMLAnchorElement>
  onUpload: MouseEventHandler<HTMLButtonElement>
  demo?: Extract<CaseState, { status: 'ready' }>
}) {
  const source = useMemo<ResectionViewerSource | undefined>(() => demo && ({
    subscribe(listener) {
      listener(demo)
      return () => {}
    },
  }), [demo])
  return (
    <>
    <section id="home" className="landing grid-surface" aria-labelledby="landing-title">
      <div className="wrap hero">
        <div className="hero-copy">
          <h1 id="landing-title" tabIndex={-1} ref={titleRef}>See Beyond 2D.<br />Plan in 3D</h1>
          <p>Explore prepared liver and tumour anatomy and see how a resection plane changes the estimated remaining liver volume.</p>
          <div className="actions">
            <a className="button button-primary" href="#plan" id="explore" onClick={onExplore}>Explore HepatoPlan</a>
            <Button aria-haspopup="dialog" onClick={onUpload}>Try a CT upload</Button>
          </div>
        </div>
        <CaseViewport name="demo" title="Prepared demo" caption={<span className="pill" id="demo-id">{demoId}</span>}
          {...caseActions}>
          {source && <AnatomyViewer key={demo?.selectionToken} source={source} rotateOnly />}
        </CaseViewport>
      </div>
    </section>
    <LandingContent onExplore={onExplore} />
    </>
  )
}

function meshBox({ bounds }: DecodedMesh) {
  return new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max))
}

export function Workspace({ titleRef, state, controller, planCount, dirty, baseline, savedName,
  context, onContextChange, onSave, onCompare, onRetryMeasurement, ...caseActions }: CaseActions & {
  titleRef: Ref<HTMLHeadingElement>
  state: CaseState
  controller?: CaseController
  planCount: number
  dirty: boolean
  baseline?: SavedPlan
  context: PlanContext
  onContextChange: (context: PlanContext) => void
  savedName?: string
  onSave: MouseEventHandler<HTMLButtonElement>
  onCompare?: () => void
  onRetryMeasurement: () => void
}) {
  const [planeVisible, setPlaneVisible] = useState(true)
  const [liverOpacity, setLiverOpacity] = useState(55)
  const editing = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const panel = measurementPanel(state)
  useEffect(() => {
    const editor = editing.current
    const pinned = preview.current
    if (!editor || !pinned) return
    const observer = new ResizeObserver(() => {
      editor.style.setProperty('--plan-preview-height', `${pinned.offsetHeight}px`)
    })
    observer.observe(pinned)
    return () => observer.disconnect()
  }, [])
  const dimensions = state.status === 'ready'
    ? meshBox(state.liver).union(meshBox(state.tumour)).getSize(new Vector3()) : undefined
  const extent = dimensions && `Mesh extent: ${dimensions.toArray().map(Math.round).join(' × ')} mm`
  return (
    <section id="workspace" className="workspace wrap" aria-labelledby="workspace-title">
      <div className="workspace-heading">
        <div>
          <h1 id="workspace-title" tabIndex={-1} ref={titleRef}>3D resection planning workspace</h1>
          <p className="working-cut">{baseline?.name || 'Working cut'}{dirty && <span className="pill">Unsaved changes</span>}</p>
          {baseline?.notes && <PlanDetailsList details={{ name: baseline.name, notes: baseline.notes }} />}
          {planCount < 2 && (
            <Status id="compare-status">{planCount === 1 ? 'Save one more plan to compare.' : 'Save two plans to compare.'}</Status>
          )}
        </div>
        <Presets state={state} controller={controller} />
      </div>
      <div id="plan-view" className="workframe plan-layout">
        <div className="plan-editing" ref={editing} onFocusCapture={event => {
          const target = event.target
          const pinned = preview.current
          if (!pinned || !target.closest('.controls') || getComputedStyle(pinned).position !== 'sticky') return
          requestAnimationFrame(() => {
            if (!target.isConnected || document.activeElement !== target) return
            const clearance = target.getBoundingClientRect().top - pinned.getBoundingClientRect().bottom - 8
            if (clearance < 0) window.scrollBy(0, clearance)
          })
        }}>
          <div className="plan-preview" ref={preview}>
            <CaseViewport name="case" title="Case anatomy" caption={<span className="pill">RAS+ · mm</span>}
              extent={extent} {...caseActions}>
              {state.status === 'ready' && controller && <AnatomyViewer key={state.selectionToken} source={controller}
                planeVisible={planeVisible} liverOpacity={liverOpacity / 100} />}
            </CaseViewport>
            <PrimaryMeasurements panel={panel} />
          </div>
          <PlaneControls state={state} controller={controller} planeVisible={planeVisible} liverOpacity={liverOpacity}
            onVisibility={setPlaneVisible} onOpacity={setLiverOpacity} context={context} onContextChange={onContextChange} />
        </div>
        <MeasurementDetails state={state} panel={panel} onRetry={onRetryMeasurement} onSave={onSave}
          onCompare={onCompare} savedName={savedName} />
      </div>
    </section>
  )
}
