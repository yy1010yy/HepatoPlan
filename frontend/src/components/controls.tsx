import type { ComponentProps, ReactNode, Ref } from 'react'

export function Button({ className, ...props }: ComponentProps<'button'>) {
  return <button type="button" className={className ? `button ${className}` : 'button'} {...props} />
}

export function Status({ id, children, statusRef, hidden }: {
  id: string
  children: ReactNode
  statusRef?: Ref<HTMLParagraphElement>
  hidden?: boolean
}) {
  return <p className="status" id={id} role="status" ref={statusRef} tabIndex={statusRef ? -1 : undefined}
    hidden={hidden}>{children}</p>
}

export function LabelledRange({ id, label, readout, ...props }: ComponentProps<'input'> & {
  id: string; label: string; readout?: string
}) {
  return (
    <div className="range-field">
      <div className="range-label"><label htmlFor={id}>{label}</label><span aria-hidden="true">{readout}</span></div>
      <input id={id} type="range" {...props} />
    </div>
  )
}

export function MetricRow({ id, label, value }: { id: string; label: string; value: string }) {
  return <div className="metric-row"><dt>{label}</dt><dd id={id}>{value}</dd></div>
}
