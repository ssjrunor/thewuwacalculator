/*
  Author: Runor Ewhro
  Description: Builds the slot-overwrite comparison payload for echo equip
               submenus without mutating the current build.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { ArrowRight } from 'lucide-react'
import { EchoCard } from '@/shared/ui/EchoGrid.tsx'

interface EchoQpCmprPr {
  currentEcho: EchoInstance | null
  nextEcho: EchoInstance
}

export function EchoQpCmprdn({
  currentEcho,
  nextEcho,
}: EchoQpCmprPr) {
  return (
    <div className="echo-equip-preview">
      <div className="echo-equip-preview__lane">
        <div className="echo-equip-preview__card">
          <span className="echo-equip-preview__label">Current</span>
          <EchoCard
            echo={currentEcho}
            variant="compact"
            showSubstats={true}
            showImage
          />
        </div>
        <div className="echo-equip-preview__arrow" aria-hidden="true">
          <ArrowRight size="1em" />
        </div>
        <div className="echo-equip-preview__card">
          <span className="echo-equip-preview__label">Equip</span>
          <EchoCard
            echo={nextEcho}
            variant="compact"
            showSubstats={true}
            showImage
          />
        </div>
      </div>
    </div>
  )
}
