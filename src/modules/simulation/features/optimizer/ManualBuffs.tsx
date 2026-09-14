/*
  Author: Runor Ewhro
  Description: Owns manual buffs behavior and state transitions for the optimizer module.
*/

import { AppModal } from '@/shared/ui/AppModal'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { BuffEditor } from '@/modules/simulation/features/buffs/BuffEditor.tsx'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'

interface MnlBffsDvncM {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  onClose: () => void
  runtime: ResRuntime
  onRtPdt: RtUpdHnd
}

export function ManualBuffs({
  visible,
  open,
  closing,
  onClose,
  runtime,
  onRtPdt: onRtPdt,
}: MnlBffsDvncM) {
  return (
    <AppModal
      state={{ visible, open, closing: closing ?? false }}
      variant="manual-buffs"
      ariaLabel="Advanced Modifiers"
      onClose={onClose}
    >
      <div className="amdl mb-adv-root">
        <ModalHeader over="Manual Buffs" title={<h2>Advanced Modifiers</h2>} onClose={onClose} />
        <div className="mb-adv-body">
          <BuffEditor
            runtime={runtime}
            onRtPdt={onRtPdt}
            cardVariant="inner"
            showQckStts={false}
            showTrnsCtns={true}
          />
        </div>
      </div>
    </AppModal>
  )
}
