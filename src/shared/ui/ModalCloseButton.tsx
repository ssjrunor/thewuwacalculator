import type { ButtonHTMLAttributes } from 'react'
import { X } from 'lucide-react'

type ModalCloseButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  label?: string
}

export function ModalCloseButton({
  label = 'Close',
  className,
  'aria-label': ariaLabel,
  ...props
}: ModalCloseButtonProps) {
  return (
    <button
      {...props}
      type="button"
      className={['app-modal-close', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel ?? label}
    >
      <X size={18} />
      <span>{label}</span>
    </button>
  )
}
