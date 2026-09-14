/*
  Author: Runor Ewhro
  Description: Renders the buffs pane shared by Simulation tools.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { BuffEditor } from '@/modules/simulation/features/buffs/BuffEditor.tsx'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'

interface BuffsPaneProps {
  runtime: ResRuntime
  onRtPdt: RtUpdHnd
}

// renders the buff editor pane that delegates runtime edits to the shared handler.
export function BuffsPane({
  runtime,
  onRtPdt: onRtPdt,
}: BuffsPaneProps) {
  return (
    <section className="calc-pane custom-buffs-pane">
      <div className="weapon-effect__bar">
        <span className="weapon-effect__sigil" aria-hidden="true" />
        <span className="weapon-effect__titles">
          <span className="weapon-effect__tag">Simulation</span>
          <span className="weapon-effect__name">Buffs</span>
        </span>
      </div>
      <BuffEditor
        runtime={runtime}
        onRtPdt={onRtPdt}
        showTrnsCtns
      />
    </section>
  )
}
