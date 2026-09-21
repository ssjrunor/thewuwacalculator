/*
  Author: Runor Ewhro
  Description: Provides shared inspector controls, value rows, section framing, and node identity helpers.
*/

import type { ReactNode } from 'react'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import type { BuffLine } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'

export function InspectorSection({
  label,
  children,
  defaultOpen = false,
}: {
  label: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <Expandable className="rte-sect"
      TriggerTag="button"
      triggerClass="rte-lbl"
      innerClass="rte-sect__body"
      chevronClass="rte-sect__chev"
      chevronSize={11}
      defaultOpen={defaultOpen}
      header={label}
    >
      {children}
    </Expandable>
  )
}

export function BuffRows({ buffs }: { buffs: readonly BuffLine[] }) {
  return buffs.map((buff) => (
    <div key={buff.id} className="rte-buff" title={buff.name}>
      <img className="rte-buff__art"
        src={buff.icon}
        alt={buff.name}
        onError={withDefIconM}
        loading="lazy"
      />
      <span className="rte-buff__effects">
        {buff.effects.map((effect, index) => (
          <span
            key={`${buff.id}:${index}`} className="rte-buff__effect"
            dangerouslySetInnerHTML={{ __html: effect }}
          />
        ))}
      </span>
    </div>
  ))
}
