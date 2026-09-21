/*
  Author: Runor Ewhro
  Description: Drafts manual runtime modifiers and commits their reducers
               when the optimizer's modifier dialog finishes closing.
*/

import { AppModal } from '@/shared/ui/AppModal'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { BuffEditor } from '@/modules/simulation/features/buffs/BuffEditor.tsx'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { useCallback } from 'react'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'

interface MnlBffsDvncM {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  onClose: (onClosed?: () => void) => void
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
  const session = useConfigurationSession({ source: runtime, commit: onRtPdt })
  const close = useCallback(() => onClose(session.finish), [onClose, session])

  return (
    <AppModal
      state={{ visible, open, closing: closing ?? false }}
      variant="manual-buffs"
      ariaLabel="Advanced Modifiers"
      onClose={close}
    >
      <div className="amdl mb-adv-root">
        <ModalHeader over="Manual Buffs" title={<h2>Advanced Modifiers</h2>} onClose={close} />
        <div className="mb-adv-body">
          <BuffEditor
            runtime={session.draft}
            onRtPdt={session.update}
            cardVariant="inner"
            showQckStts={false}
            showTrnsCtns={true}
          />
        </div>
      </div>
    </AppModal>
  )
}
