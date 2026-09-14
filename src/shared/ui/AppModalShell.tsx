/*
  Author: Runor Ewhro
  Description: Owns app modal shell behavior and state transitions for the ui module.
*/

import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalShellProps {
  className?: string
  children: ReactNode
}

interface ModalHeaderProps {
  over?: string
  title: ReactNode
  leading?: ReactNode

  children?: ReactNode
  closeLabel?: string
  onClose: () => void
}

export function ModalShell({ className, children }: ModalShellProps) {
  return <div className={['amdl', className].filter(Boolean).join(' ')}>{children}</div>
}

export function ModalHeader({
  over,
  title,
  leading,
  children,
  closeLabel = 'Close',
  onClose,
}: ModalHeaderProps) {
  return (
    <header className="amdl__head">
      {leading ? <span className="amdl__lead">{leading}</span> : null}
      <span className="amdl__title">
        {over ? <span className="amdl__over">{over}</span> : null}
        <b>{title}</b>
      </span>
      <span className="amdl__fill" />
      {children}
      <button type="button" className="amdl__close" aria-label={closeLabel} onClick={onClose}>
        <X size="0.95rem" />
      </button>
    </header>
  )
}
