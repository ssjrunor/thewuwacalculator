/*
  Author: Runor Ewhro
  Description: Portal-mounted toast renderer that animates store-driven status
               notifications in the configured screen position.

               The slab says its tone once, with the glyph. The rule along its
               top says time instead: it drains over the toast's own duration,
               and a held notice (duration 0) has no drain to run, so the two
               are told apart by geometry rather than by reading either.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2, AlertTriangle as AlertIcon, XCircle, Info } from 'lucide-react'
import { DEF_PSTN, useTstStr, type Toast, type TstPstn, type ToastVariant } from '@/shared/util/toastStore.ts'

const EXIT_MS = 240
// the store's own fallback, repeated here because the rule has to drain over
// the same span the dismissal timer is counting
const DEF_LIFE = 4000

const PSTN_CLSS: Record<TstPstn, string> = {
  'top-left': 'toast-container--top-left',
  'top-center': 'toast-container--top-center',
  'top-right': 'toast-container--top-right',
  'bottom-left': 'toast-container--bottom-left',
  'bottom-center': 'toast-container--bottom-center',
  'bottom-right': 'toast-container--bottom-right',
}

const VAR_CNS: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertIcon,
  error: XCircle,
}

/*
  Most of what the app reports is a count: rows copied, echoes cleaned, entries
  pasted. The figures are lifted into the data face and made tabular so the
  number leads the line, while the sentence around it stays in the page's type.
  Only a plain string can be walked; anything richer is left exactly as given.
*/
function withFigures(content: ReactNode): ReactNode {
  if (typeof content !== 'string') {
    return content
  }

  const parts = content.split(/(\d[\d,]*)/g)
  return parts.map((part, index) => (
    /^\d/.test(part)
      ? <span className="toast-item__n" key={index}>{part}</span>
      : part
  ))
}

function ToastItem({ toast }: { toast: Toast }) {
  const [entered, setEntered] = useState(false)
  const dismiss = useTstStr((s) => s.dismiss)
  const remove = useTstStr((s) => s.remove)
  const rmTmrRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    // arm the entry transition on the next frame so css can animate from the
    // pre-enter state instead of rendering already-open.
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!toast.exiting) return
    // exiting toasts stay mounted just long enough for the close animation to
    // finish before the store removes them entirely.
    rmTmrRef.current = setTimeout(() => remove(toast.id), EXIT_MS)
    return () => clearTimeout(rmTmrRef.current ?? undefined)
  }, [toast.exiting, toast.id, remove])

  const onDsms = () => dismiss(toast.id)

  const handleClick = () => {
    if (toast.onClick) {
      toast.onClick()
      onDsms()
    }
  }

  const position = toast.position ?? DEF_PSTN
  const isTop = position.startsWith('top')
  const variant = toast.variant ?? 'default'
  const Icon = VAR_CNS[variant]
  // duration 0 is a notice that waits to be dismissed rather than one that runs out
  const life = toast.duration ?? DEF_LIFE
  const held = life <= 0
  const body = useMemo(() => withFigures(toast.content), [toast.content])

  const classes = [
    'toast-item',
    `toast-item--${variant}`,
    isTop ? 'toast-item--top' : 'toast-item--bottom',
    entered && !toast.exiting ? 'toast-item--active' : '',
    toast.exiting ? 'toast-item--exiting' : '',
    held ? 'toast-item--held' : '',
    toast.onClick ? 'toast-item--clickable' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      role={toast.onClick ? 'button' : 'status'}
      aria-live="polite"
      onClick={toast.onClick ? handleClick : undefined}
      tabIndex={toast.onClick ? 0 : undefined}
      onKeyDown={toast.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() } : undefined}
      style={{ '--toast-life': `${life}ms` } as CSSProperties}
    >
      <span className="toast-item__icon" aria-hidden="true">
        <Icon size="0.92rem" strokeWidth={2} />
      </span>
      <div className="toast-item__content">{body}</div>
      {toast.action && (
        <button
          type="button" className="toast-item__action"
          onClick={(e) => {
            e.stopPropagation()
            toast.action!.onClick()
            onDsms()
          }}
        >
          {toast.action.label}
        </button>
      )}
      {!toast.onClick && (
        <button
          type="button" className="toast-item__dismiss"
          aria-label="Dismiss"
          onClick={onDsms}
        >
          <X size="0.875rem" />
        </button>
      )}
    </div>
  )
}

export function NtfcTstCntn() {
  const toasts = useTstStr((s) => s.toasts)

  const grouped = new Map<TstPstn, Toast[]>()
  for (const toast of toasts) {
    const pos = toast.position ?? 'bottom-right'
    const list = grouped.get(pos)
    if (list) list.push(toast)
    else grouped.set(pos, [toast])
  }

  if (grouped.size === 0) return null

  return createPortal(
    <>
      {Array.from(grouped.entries()).map(([position, items]) => (
        <div
          key={position}
          className={`toast-container ${PSTN_CLSS[position]}`}
          aria-label="Notifications"
        >
          {items.map((toast) => (
            <ToastItem key={toast.id} toast={toast} />
          ))}
        </div>
      ))}
    </>,
    document.body,
  )
}
