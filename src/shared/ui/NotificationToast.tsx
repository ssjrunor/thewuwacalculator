import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'
import { useToastStore, type Toast, type ToastPosition, type ToastVariant } from '@/shared/util/toastStore.ts'

const EXIT_MS = 340

const POSITION_CLASSES: Record<ToastPosition, string> = {
  'top-left': 'toast-container--top-left',
  'top-center': 'toast-container--top-center',
  'top-right': 'toast-container--top-right',
  'bottom-left': 'toast-container--bottom-left',
  'bottom-center': 'toast-container--bottom-center',
  'bottom-right': 'toast-container--bottom-right',
}

const VARIANT_ICONS: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
}

function ToastItem({ toast }: { toast: Toast }) {
  const [entered, setEntered] = useState(false)
  const dismiss = useToastStore((s) => s.dismiss)
  const remove = useToastStore((s) => s.remove)
  const removeTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!toast.exiting) return
    removeTimerRef.current = setTimeout(() => remove(toast.id), EXIT_MS)
    return () => clearTimeout(removeTimerRef.current ?? undefined)
  }, [toast.exiting, toast.id, remove])

  const handleDismiss = () => dismiss(toast.id)

  const handleClick = () => {
    if (toast.onClick) {
      toast.onClick()
      handleDismiss()
    }
  }

  const position = toast.position ?? 'top-center'
  const isTop = position.startsWith('top')
  const variant = toast.variant ?? 'default'
  const Icon = VARIANT_ICONS[variant]

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
            handleDismiss()
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
          onClick={handleDismiss}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function NotificationToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  const grouped = new Map<ToastPosition, Toast[]>()
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
          className={`toast-container ${POSITION_CLASSES[position]}`}
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
