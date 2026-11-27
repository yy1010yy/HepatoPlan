import { useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { Button, Status } from './controls.tsx'
import type { LoadStatus } from '../case-session.ts'

function containTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
  )].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0)
  const first = controls[0]
  const last = controls.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function Dialog({ id, titleId, opener, initialFocus, cancel, fallback, onCancel, children }: {
  id: string
  titleId: string
  opener: HTMLElement | null
  initialFocus: RefObject<HTMLButtonElement | null>
  cancel: RefObject<HTMLButtonElement | null>
  fallback: RefObject<HTMLButtonElement | null>
  onCancel: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const node = dialog.current
    if (!node || !opener) return
    node.showModal()
    const target = initialFocus.current ?? cancel.current
    target?.focus()
    return () => {
      node.close()
      const target = opener.getClientRects().length ? opener : fallback.current
      target?.focus()
    }
  }, [opener, initialFocus, cancel, fallback])

  return (
    <dialog className="dialog" id={id} ref={dialog} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onCancel() }} onKeyDown={containTab}>
      {children}
    </dialog>
  )
}

export function CaseChooser({ opener, fallback, activeId, cases, status, onCancel, onSelect, onRetry }: {
  opener: HTMLElement | null
  fallback: RefObject<HTMLButtonElement | null>
  activeId?: string
  cases: readonly { caseId: string }[]
  status: LoadStatus
  onCancel: () => void
  onSelect: (id: string) => void
  onRetry: () => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const initialCase = useRef<HTMLButtonElement>(null)
  const initialId = activeId ?? cases[0]?.caseId
  return (
    <Dialog id="case-dialog" titleId="chooser-title" opener={opener} initialFocus={initialCase} cancel={cancel}
      fallback={fallback} onCancel={onCancel}>
      <h2 id="chooser-title">Choose a prepared case</h2>
      <Status id="chooser-status" hidden={!status.message}>{status.message}</Status>
      <ul className="case-list" id="case-list" aria-label="Prepared cases" hidden={!cases.length}>
        {cases.map(({ caseId }) => (
          <li key={caseId}>
            <Button className="case-option" aria-current={caseId === activeId ? 'true' : undefined}
              ref={caseId === initialId ? initialCase : undefined}
              onClick={() => onSelect(caseId)}>
              <span>{caseId}</span>
              {caseId === activeId && <span className="pill">Active</span>}
            </Button>
          </li>
        ))}
      </ul>
      <div className="actions dialog-actions">
        <Button id="chooser-retry" hidden={!status.retry} onClick={() => { cancel.current?.focus(); onRetry() }}>
          Retry
        </Button>
        <Button id="chooser-cancel" ref={cancel} onClick={onCancel}>Cancel</Button>
      </div>
    </Dialog>
  )
}
