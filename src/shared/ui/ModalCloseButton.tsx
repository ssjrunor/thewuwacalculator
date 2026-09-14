/*
  Author: Runor Ewhro
  Description: Standard close button used by app modals so dismissal affordances
               stay visually and semantically consistent.
*/

import type { ButtonHTMLAttributes as BttnHtmlTtrb } from 'react'
import { X } from 'lucide-react'

type MdlClsBttnPr = Omit<BttnHtmlTtrb<HTMLButtonElement>, 'type'> & {
  label?: string
}

export function ModalCloseButton({
  label = 'Close',
  className,
  'aria-label': ariaLabel,
  ...props
}: MdlClsBttnPr) {
  return (
    <button
      {...props}
      type="button"
      className={['app-modal-close', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel ?? label}
    >
      <X size="1.125rem" />
      <span>{label}</span>
    </button>
  )
}
