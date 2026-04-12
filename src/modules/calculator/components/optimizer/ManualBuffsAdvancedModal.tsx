import { AppDialog } from '@/shared/ui/AppDialog'
import { ModalCloseButton } from '@/shared/ui/ModalCloseButton'
import { ManualBuffEditor } from '@/modules/calculator/components/workspace/panes/left/controls/ManualBuffEditor'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'

interface ManualBuffsAdvancedModalProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  onClose: () => void
  runtime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
}

export function ManualBuffsAdvancedModal({
  visible,
  open,
  closing,
  portalTarget,
  onClose,
  runtime,
  onRuntimeUpdate,
}: ManualBuffsAdvancedModalProps) {
  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      contentClassName="app-modal-panel mb-adv-modal"
      ariaLabel="Advanced Modifiers"
      onClose={onClose}
    >
      <div className="mb-adv-root">
        <div className="mb-adv-header">
          <div className="mb-adv-header-titles">
            <span className="mb-adv-eyebrow">Manual Buffs</span>
            <h2 className="mb-adv-title">Advanced Modifiers</h2>
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>
        <div className="mb-adv-body">
          <ManualBuffEditor
            runtime={runtime}
            onRuntimeUpdate={onRuntimeUpdate}
            cardVariant="inner"
            showQuickStats={false}
            showTransferActions={true}
          />
        </div>
      </div>
    </AppDialog>
  )
}
