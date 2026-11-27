import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEventHandler, ReactNode, RefObject } from 'react'
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
      onCancel={event => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onCancel()
      }} onKeyDown={containTab}>
      {children}
    </dialog>
  )
}

export function CaseChooser({ opener, fallback, activeId, cases, status, onCancel, onSelect, onRetry, onUpload }: {
  opener: HTMLElement | null
  fallback: RefObject<HTMLButtonElement | null>
  activeId?: string
  cases: readonly { caseId: string }[]
  status: LoadStatus
  onCancel: () => void
  onSelect: (id: string) => void
  onRetry: () => void
  onUpload: MouseEventHandler<HTMLButtonElement>
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
        <Button aria-haspopup="dialog" onClick={onUpload}>Try a CT upload</Button>
        <Button id="chooser-retry" hidden={!status.retry} onClick={() => { cancel.current?.focus(); onRetry() }}>
          Retry
        </Button>
        <Button id="chooser-cancel" ref={cancel} onClick={onCancel}>Cancel</Button>
      </div>
    </Dialog>
  )
}

export function UploadPreview({ opener, fallback, unavailable, onCancel, onContinue }: {
  opener: HTMLElement
  fallback: RefObject<HTMLButtonElement | null>
  unavailable: boolean
  onCancel: () => void
  onContinue: () => void
}) {
  const [filename, setFilename] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const choose = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  return (
    <Dialog id="upload-dialog" titleId="upload-title" opener={opener} initialFocus={choose} cancel={cancel}
      fallback={fallback} onCancel={onCancel}>
      <h2 id="upload-title">Try a CT upload</h2>
      <p className="status">This preview opens prepared case case-002. Your scan stays on this device.</p>
      {unavailable && <Status id="upload-unavailable">Demo case case-002 is unavailable.</Status>}
      <input id="ct-file" type="file" hidden aria-label="CT scan file" onChange={event => {
        const input = event.currentTarget
        const selected = input.files?.[0]
        if (selected) setFilename(selected.name)
        input.value = ''
      }} ref={picker} />
      <p className="selected-file" role="status">{filename}</p>
      <Button ref={choose} onClick={() => picker.current?.click()}>{filename ? 'Choose another file' : 'Choose a file'}</Button>
      <div className="actions dialog-actions">
        <Button ref={cancel} onClick={onCancel}>Cancel</Button>
        <Button className="button-primary" disabled={!filename || unavailable} onClick={onContinue}>Continue with demo case</Button>
      </div>
    </Dialog>
  )
}
