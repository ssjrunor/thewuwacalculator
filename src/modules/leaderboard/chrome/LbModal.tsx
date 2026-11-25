/*
  Author: Runor Ewhro
  description: leaderboard modals (sign in, edit profile) on the app's modal:
               the shared panel and head with the app's open and close motion.
               `open` is the caller's state, and this plays the entry and exit
               around it.
*/

import { useEffect, type ReactNode } from 'react'
import { AppModal } from '@/shared/ui/AppModal'
import { ModalHeader, ModalShell } from '@/shared/ui/AppModalShell'
import { useAppModal } from '@/shared/ui/useAppModal'

export function LbModal({ open, onClose, over, title, className, children, foot }: {
  open: boolean
  onClose: () => void
  over: string
  title: string
  className?: string
  children: ReactNode
  foot?: ReactNode
}) {
  const modal = useAppModal()
  const { show, hide, visible } = modal
  useEffect(() => {
    if (open && !visible) show()
    if (!open && visible) hide()
  }, [open, visible, show, hide])

  return (
    <AppModal state={modal.dialogProps} variant="leaderboard" ariaLabel={title} onClose={onClose}>
      <ModalShell className={['lbm', className].filter(Boolean).join(' ')}>
        <ModalHeader over={over} title={title} onClose={onClose} />
        <div className="lbm-body">{children}</div>
        {foot ? <footer className="amdl__foot">{foot}</footer> : null}
      </ModalShell>
    </AppModal>
  )
}
