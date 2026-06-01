/*
  Author: Runor Ewhro
  Description: Portal-mounted toast renderer that animates store-driven status
               notifications in the configured screen position.
*/

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2, AlertTriangle as AlertIcon, XCircle, Info } from 'lucide-react'
import { useTstStr, type Toast, type TstPstn, type ToastVariant } from '@/shared/util/toastStore.ts'

const EXIT_MS = 340

const PSTN_CLSS: Record<TstPstn, string> = {
  'top-left': 'toast-container--top-left',
  'top-center': 'toast-container--top-center',
  'top-right': 'toast-container--top-results',
  'bottom-left': 'toast-container--bottom-left',
  'bottom-center': 'toast-container--bottom-center',
  'bottom-right': 'toast-container--bottom-results',
}

const VAR_CNS: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertIcon,
  error: XCircle,
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

  const position = toast.position ?? 'top-center'
  const isTop = position.startsWith('top')
  const variant = toast.variant ?? 'default'
  const Icon = VAR_CNS[variant]

  const classes = [
    'toast-item',
    `toast-item--${variant}`,
    isTop ? 'toast-item--top' : 'toast-item--bottom',
    entered && !toast.exiting ? 'toast-item--active' : '',
    toast.exiting ? 'toast-item--exiting' : '',
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
    >
      <div className="toast-item__icon">
        <Icon size={16} />
      </div>
      <div className="toast-item__content">{toast.content}</div>
      {toast.action && (
        <button
          type="button"
          className="toast-item__action"
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
          type="button"
          className="toast-item__dismiss"
          aria-label="Dismiss"
          onClick={onDsms}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function NtfcTstCntn() {
  const toasts = useTstStr((s) => s.toasts)

  const grouped = new Map<TstPstn, Toast[]>()
  for (const toast of toasts) {
    const pos = toast.position ?? 'top-center'
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
