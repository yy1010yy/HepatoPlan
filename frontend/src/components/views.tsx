import { useRef } from 'react'
import type { MouseEventHandler, ReactNode, Ref } from 'react'
import { Box3, Vector3 } from 'three'
import { Button, LabelledRange, MetricRow, Status } from './controls.tsx'
import { demoId } from '../case-session.ts'
import type { LoadStatus } from '../case-session.ts'
import type { CaseState } from '../planning/case-controller.ts'
import type { DecodedMesh } from '../planning/binary-stl.ts'
import { measurementPanel } from '../planning/measurements-panel.ts'

type CaseActions = {
  status: LoadStatus
  onRetry: () => void
  onChoose: MouseEventHandler<HTMLButtonElement>
}

function CaseViewport({ name, title, caption, extent, status, onRetry, onChoose }: CaseActions & {
  name: 'demo' | 'case'
  title: string
  caption: ReactNode
  extent?: string
}) {
  const statusRef = useRef<HTMLParagraphElement>(null)
  const titleId = name === 'demo' ? 'demo-title' : 'anatomy-title'
  return (
    <section className={`viewport ${name === 'demo' ? 'hero-viewport' : 'plan-viewport'}`} aria-labelledby={titleId}>
      <div className="viewport-caption">
        <h2 id={titleId}>{title}</h2>
        {caption}
      </div>
      <div className="viewport-body">
        <Status id={`${name}-status`} statusRef={statusRef}>{status.message}</Status>
        {name === 'case' && <p className="extent" id="case-extent" hidden={!extent}>{extent}</p>}
        <div className="actions">
          <Button id={`${name}-retry`} hidden={!status.retry} onClick={() => { statusRef.current?.focus(); onRetry() }}>
            Retry
          </Button>
          <Button id={`${name}-choose`} aria-haspopup="dialog" hidden={!status.choose} onClick={onChoose}>
            Choose another case
          </Button>
        </div>
      </div>
    </section>
  )
}

export function Landing({ titleRef, onExplore, ...caseActions }: CaseActions & {
  titleRef: Ref<HTMLHeadingElement>
  onExplore: MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <section id="landing" className="landing grid-surface" aria-labelledby="landing-title">
      <div className="wrap hero">
        <div className="hero-copy">
          <h1 id="landing-title" tabIndex={-1} ref={titleRef}>See Beyond 2D.<br />Plan in 3D</h1>
          <p>Explore prepared liver and tumour anatomy and see how a resection plane changes the estimated remaining liver volume.</p>
          <a className="button button-primary" href="#plan" id="explore" onClick={onExplore}>Explore HepatoPlan</a>
        </div>
        <CaseViewport name="demo" title="Prepared demo" caption={<span className="pill" id="demo-id">{demoId}</span>}
          {...caseActions} />
      </div>
    </section>
  )
}

function meshBox({ bounds }: DecodedMesh) {
  return new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max))
}

function Measurements({ state, onRetry }: { state: CaseState; onRetry: () => void }) {
  const statusRef = useRef<HTMLParagraphElement>(null)
  const measurements = measurementPanel(state)
  const rows = measurements.status === 'ready' ? measurements.rows : []
  const failed = state.status === 'ready' && measurements.status === 'unavailable'
  const updating = state.status === 'ready' && measurements.status === 'updating'
  const remaining = 'Remaining volume'
  const flr = 'Future Liver Remnant (FLR)'
  return (
    <section className="panel readings" aria-labelledby="readings-title">
      <h2 id="readings-title">Measurements</h2>
      <dl className="metrics">
        <MetricRow id="remaining" label={remaining} value={rows.find(row => row.label === remaining)?.value ?? '—'} />
        <MetricRow id="flr" label={flr} value={rows.find(row => row.label === flr)?.value ?? '—'} />
      </dl>
      <Status id="measurement-status" statusRef={statusRef}>
        {updating ? 'Updating measurements…' : failed ? measurements.message : ''}
      </Status>
      <Button id="measurement-retry" hidden={!failed} onClick={() => { statusRef.current?.focus(); onRetry() }}>
        Retry measurements
      </Button>
    </section>
  )
}

export function Workspace({ titleRef, state, planCount, onRetryMeasurement, ...caseActions }: CaseActions & {
  titleRef: Ref<HTMLHeadingElement>
  state: CaseState
  planCount: number
  onRetryMeasurement: () => void
}) {
  const dimensions = state.status === 'ready'
    ? meshBox(state.liver).union(meshBox(state.tumour)).getSize(new Vector3()) : undefined
  const extent = dimensions && `Mesh extent: ${dimensions.toArray().map(Math.round).join(' × ')} mm`
  return (
    <section id="workspace" className="workspace wrap" aria-labelledby="workspace-title">
      <div className="workspace-heading">
        <h1 id="workspace-title" tabIndex={-1} ref={titleRef}>3D resection planning workspace</h1>
        <Status id="compare-status">{planCount === 1 ? 'Save one more plan to compare.' : 'Save two plans to compare.'}</Status>
      </div>
      <div id="plan-view" className="workframe plan-layout">
        <section className="panel controls" aria-labelledby="plane-title">
          <h2 id="plane-title">Resection plane</h2>
          <LabelledRange id="plane-offset" label="Plane offset" min={-1} max={1} defaultValue={0} disabled />
          <LabelledRange id="plane-angle" label="Plane angle" min={-45} max={45} defaultValue={0} disabled />
        </section>
        <CaseViewport name="case" title="Case anatomy" caption={<span className="pill">RAS+ · mm</span>}
          extent={extent} {...caseActions} />
        <Measurements state={state} onRetry={onRetryMeasurement} />
      </div>
    </section>
  )
}
