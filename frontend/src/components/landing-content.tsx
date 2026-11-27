import { useRef } from 'react'
import type { MouseEventHandler } from 'react'
import centre from '../assets/studies/centre.png'
import tilted from '../assets/studies/tilted.png'
import readings from '../assets/studies/readings.json' with { type: 'json' }
import { volumeFormatter } from '../planning/measurements-panel.ts'

type Explore = MouseEventHandler<HTMLAnchorElement>
const links = [
  ['home', 'Home'], ['challenge', 'The Challenge'], ['solution', 'Our Solution'],
  ['comparison', 'Comparison'], ['methods', 'Methods'],
]
const workflow = [
  ['Select', 'Choose a prepared case from the catalogue.'],
  ['Inspect', 'Rotate the liver and locate the tumour in 3D.'],
  ['Adjust', 'Move, tilt or flip the resection plane.'],
  ['Measure', 'Read the estimated remaining volume and remnant percentage.'],
  ['Compare', 'See how two cuts on the same liver differ.'],
]
const studyImages = { centre, tilted }
const studyNames = { centre: 'Centre cut', tilted: 'Tilted cut' }
const volume = volumeFormatter()
const percent = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })

function Links({ onNavigate }: { onNavigate?: () => void }) {
  return links.map(([id, label]) => <a key={id} href={`#${id}`} onClick={onNavigate}>{label}</a>)
}

export function LandingNavigation({ onExplore }: { onExplore: Explore }) {
  const menu = useRef<HTMLDetailsElement>(null)
  return (
    <>
      <nav className="landing-nav" aria-label="Landing"><Links /></nav>
      <details className="landing-menu" ref={menu}>
        <summary>Menu</summary>
        <nav aria-label="Landing">
          <Links onNavigate={() => { if (menu.current) menu.current.open = false }} />
          <a href="#plan" onClick={onExplore}>Open workspace</a>
        </nav>
      </details>
      <a className="button button-primary landing-nav-cta" href="#plan" onClick={onExplore}>Open workspace</a>
    </>
  )
}

export function LandingContent({ onExplore }: { onExplore: Explore }) {
  return (
    <>
      <section className="landing-band" id="challenge">
        <div className="wrap">
          <h2>The Challenge</h2>
          <p className="landing-lead">A stack of CT slices shows the liver in sections. Planning a cut means understanding the full shape and how much tissue lies on each side.</p>
          <div className="challenge-grid">
            <article className="panel">
              <h3>From 2D imaging to 3D anatomy</h3>
              <p>A prepared model puts the liver and tumour into one view so you can inspect their relationship from multiple angles.</p>
            </article>
            <article className="panel">
              <h3>Different cuts, different volumes</h3>
              <p>A shift or tilt in the plane changes which liver tissue would remain. The 3D view and volume estimates let you explore that change together.</p>
            </article>
          </div>
        </div>
      </section>
      <section className="landing-band solution-band" id="solution">
        <div className="wrap">
          <h2>Our Solution</h2>
          <p className="landing-lead">Explore a geometric resection on prepared liver anatomy for research and education.</p>
          <ol className="workflow">
            {workflow.map(([label, description]) => <li key={label}><h3>{label}</h3><p>{description}</p></li>)}
          </ol>
        </div>
      </section>
      <section className="landing-band" id="comparison">
        <div className="wrap">
          <div className="workframe studies">
            <div className="study-intro">
              <h2>Same liver, two cuts</h2>
              <p>Compare two plane orientations from the same viewing angle. Both cuts pass through the centre of the liver. Tilting the plane changes how much tissue remains.</p>
              <p className="study-case">{readings.caseId} · {readings.releaseId}</p>
              <a className="button button-primary" href="#plan" onClick={onExplore}>Explore HepatoPlan</a>
            </div>
            {readings.studies.map(study => {
              const key = study.key as keyof typeof studyImages
              return (
                <figure className="panel study" key={key} data-study={key}>
                  <figcaption>
                    <h3>{studyNames[key]}</h3>
                    <p className="study-case">{study.angleDeg === 0 ? '0°' : `+${study.angleDeg}°`}</p>
                  </figcaption>
                  <img src={studyImages[key]} width="560" height="360" loading="lazy"
                    alt={`Prepared liver and tumour with the ${studyNames[key].toLowerCase()} plane`} />
                  <dl>
                    <div><dt>Remaining</dt><dd>{volume(study.remainingMl)}</dd></div>
                    <div><dt>FLR</dt><dd>{percent.format(study.flrPercent)}%</dd></div>
                  </dl>
                </figure>
              )
            })}
          </div>
          <details className="methods" id="methods">
            <summary>How measurements work</summary>
            <dl>
              <div><dt>Parenchyma volume</dt><dd>Counts labelled liver tissue on each side of the plane and uses the physical voxel volume. The tumour label is excluded from parenchyma.</dd></div>
              <div><dt>Future liver remnant (FLR)</dt><dd>The estimated remaining parenchyma divided by total parenchyma, expressed as a percentage.</dd></div>
              <div><dt>Tumour distance</dt><dd>A geometric estimate in millimetres from the plane to the tumour. The measurements describe the prepared model for research and education.</dd></div>
            </dl>
          </details>
        </div>
      </section>
      <footer className="landing-footer">
        <div className="wrap closing-cta">
          <div>
            <h2>Making complex anatomy easier to explore</h2>
            <p>Start with the prepared demo and see how moving the plane changes the remaining volume.</p>
            <div className="actions">
              <a className="button button-primary" href="#plan" onClick={onExplore}>Explore HepatoPlan</a>
              <a className="button" href="#home">Back to top</a>
            </div>
          </div>
          <div className="team-credit">
            <strong>Kampung Team</strong>
            <span>University of Malaya</span>
            <span>NextHorizon Hackathon 2026</span>
          </div>
        </div>
        <div className="wrap footer-links">
          <a className="brand" href="#home">HepatoPlan</a>
          <nav aria-label="Footer"><Links /></nav>
          <p>For research and education</p>
        </div>
      </footer>
    </>
  )
}
