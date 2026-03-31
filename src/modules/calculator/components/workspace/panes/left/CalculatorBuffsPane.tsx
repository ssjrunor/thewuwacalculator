import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { ManualBuffEditor } from '@/modules/calculator/components/workspace/panes/left/controls/ManualBuffEditor'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'

interface CalculatorBuffsPaneProps {
  runtime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
}

// renders the buff editor pane that delegates runtime edits to the shared handler.
export function CalculatorBuffsPane({
  runtime,
  onRuntimeUpdate,
}: CalculatorBuffsPaneProps) {
  return (
    <section className="calc-pane custom-buffs-pane">
        <div>
            <div className="panel-overline">Simulation</div>
            <h3>Buffs</h3>
        </div>
      <ManualBuffEditor
        runtime={runtime}
        onRuntimeUpdate={onRuntimeUpdate}
        showTransferActions
      />
    </section>
  )
}
