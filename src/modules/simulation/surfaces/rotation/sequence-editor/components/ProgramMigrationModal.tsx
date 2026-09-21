/*
  Author: Runor Ewhro
  Description: Reports advanced rotations preserved by the compact sequence
               migration and offers a direct route to their saved copies.
*/

import type { AdvancedRotationMigration } from '@/engine/runtime/advancedRotationMigration.ts'
import { ConfirmModal } from '@/shared/ui/ConfirmationModal.tsx'

interface AdvancedRotationMigrationModalProps {
  visible: boolean
  open: boolean
  closing: boolean
  portalTarget: HTMLElement | null
  migrations: readonly AdvancedRotationMigration[]
  onClose: () => void
  onViewSaved: () => void
}

export function ProgramMigrationModal({
  visible,
  open,
  closing,
  portalTarget,
  migrations,
  onClose,
  onViewSaved,
}: AdvancedRotationMigrationModalProps) {
  const count = migrations.length
  const names = migrations.map((migration) => migration.savedRotation.name)
  const shownNames = names.slice(0, 3)
  const remaining = names.length - shownNames.length
  const title = count === 1 ? 'Advanced rotation preserved' : 'Advanced rotations preserved'

  return (
    <ConfirmModal
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      title={title}
      message={(
        <>
          <span>
            {count === 1 ? 'A rotation was' : `${count} rotations were`}
            {' '}saved before being reset.
          </span>
          {shownNames.length > 0 ? (
            <>
              <br />
              <strong>
                {shownNames.join(', ')}
                {remaining > 0 ? `, and ${remaining} more` : ''}
              </strong>
            </>
          ) : null}
        </>
      )}
      confirmLabel="View saved rotations"
      cancelLabel="Stay here"
      onConfirm={onViewSaved}
      onCancel={onClose}
    />
  )
}
