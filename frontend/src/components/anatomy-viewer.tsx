import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { anatomyColours, mountResectionViewer } from '../planning/resection-viewer.ts'
import type { ResectionViewerSource } from '../planning/resection-viewer.ts'
import { Button, Status } from './controls.tsx'

const legend = [
  { label: 'Remaining tissue', colour: anatomyColours.remaining },
  { label: 'Removed tissue', colour: anatomyColours.removed },
  { label: 'Tumour', colour: anatomyColours.tumour },
  { label: 'Resection plane', colour: anatomyColours.plane },
]

export function AnatomyViewer({ source, rotateOnly = false, planeVisible = true, liverOpacity = 0.55,
  comparison = false }: {
  source: ResectionViewerSource; rotateOnly?: boolean; planeVisible?: boolean; liverOpacity?: number; comparison?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const status = useRef<HTMLParagraphElement>(null)
  const moveFocus = useRef(false)
  const instance = useRef<ReturnType<typeof mountResectionViewer>>(null)
  const helpId = useId()
  const [failed, setFailed] = useState(false)

  useLayoutEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    const target = failed ? status.current : host.current
    target?.focus()
  }, [failed])

  useEffect(() => {
    const container = host.current
    if (failed || !container) return
    function reportFailure() {
      if (document.activeElement === container) moveFocus.current = true
      setFailed(true)
    }
    try {
      const viewer = mountResectionViewer(container, source, { rotateOnly, onError: reportFailure })
      instance.current = viewer
      return () => { instance.current = null; viewer.dispose() }
    } catch {
      reportFailure()
    }
  }, [rotateOnly, source, failed])

  useEffect(() => {
    instance.current?.setPlaneVisible(planeVisible)
    instance.current?.setLiverOpacity(liverOpacity)
    instance.current?.setComparisonVisible(comparison)
  }, [planeVisible, liverOpacity, comparison, rotateOnly, source, failed])

  return (
    <div className="anatomy-viewer">
      <div className="anatomy-stage">
        <div ref={host} className="anatomy-canvas" role="group" aria-label={comparison ? '3D difference model' : '3D liver model'}
          aria-describedby={helpId} tabIndex={failed ? undefined : 0} hidden={failed} />
        <div className="viewer-error" hidden={!failed}>
          <Status id={`${helpId}-error`} statusRef={status}>The 3D view is unavailable.</Status>
          <Button onClick={() => { moveFocus.current = true; setFailed(false) }}>Retry 3D view</Button>
        </div>
      </div>
      <div className="viewer-details" hidden={failed}>
        {!comparison && <ul className="viewer-legend" aria-label="Anatomy legend">
          {legend.map(({ colour, label }) => (
            <li key={label}><span style={{ backgroundColor: colour }} aria-hidden="true" />{label}</li>
          ))}
        </ul>}
        <p className="status" id={helpId}>
          {rotateOnly ? 'Drag or use arrow keys to rotate.'
            : 'Drag to orbit, right-drag to pan, or scroll to zoom. Keyboard: arrows to orbit, Shift + arrows to pan, + or − to zoom.'}
        </p>
      </div>
    </div>
  )
}
