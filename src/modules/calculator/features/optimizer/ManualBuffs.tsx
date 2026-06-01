/*
  Author: Runor Ewhro
  Description: Renders the manual buffs surface for the calculator optimizer flow.
*/

import { AppModal } from '@/shared/ui/AppModal'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton'
import { BuffEditor } from '@/modules/calculator/features/buffs/BuffEditor.tsx'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'

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
      <div className="mb-adv-root">
        <div className="mb-adv-header">
          <div className="mb-adv-header-titles">
            <span className="mb-adv-eyebrow">Manual Buffs</span>
            <h2 className="mb-adv-title">Advanced Modifiers</h2>
          </div>
          <MdlClsBttn onClick={onClose} />
        </div>
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
