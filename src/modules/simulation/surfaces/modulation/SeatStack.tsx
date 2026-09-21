/*
  Author: Runor Ewhro
  Description: Projects an ordered team around the selected member and exposes
               a shared member-selection control for loadout and panel hosts.
*/

import type { ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { withDefResMg } from '@/shared/lib/imageFallback'
import type { CssVars } from '@/modules/simulation/workspace/ui.tsx'

export function SeatStack({
  roster,
  memberId,
  onMember,
  hidden = false,
}: {
  roster: ResView[]
  memberId: string | null
  onMember: (resonatorId: string) => void
  /** Removes an inactive duplicate from focus order and the accessibility tree. */
  hidden?: boolean
}) {
  const seated = roster.find((mate) => mate.id === memberId) ?? roster[0] ?? null
  if (!seated) return null

  // Keep DOM order stable and derive each member's relative position from selection.
  const count = roster.length
  const seatAt = roster.findIndex((mate) => mate.id === seated.id)
  const slotOf = (index: number) => {
    const turn = (index - seatAt + count) % count
    return turn === 0 ? 'front' : turn === 1 ? 'right' : 'left'
  }

  return (
    <span className="pgs-seat-stack"
      role="tablist"
      aria-label="Member being tuned"
      aria-hidden={hidden || undefined}
      data-solo={count === 1 ? 'true' : undefined}
      style={{ '--seat-left': count > 2 ? 1 : 0 } as CssVars}
    >
      {roster.map((mate, index) => {
        const at = mate.id === seated.id
        return (
          <button
            type="button"
            key={mate.id}
            role="tab"
            aria-selected={at}
            aria-label={mate.name}
            title={mate.name}
            tabIndex={hidden ? -1 : undefined}
            className={at ? 'pgs-seat-bead is-at' : 'pgs-seat-bead'}
            data-slot={slotOf(index)}
            style={{ '--el': ATTR_COLORS[mate.attribute] } as CssVars}
            onClick={() => { if (!at) onMember(mate.id) }}
          >
            <img src={mate.profile} alt="" loading="lazy" onError={withDefResMg} />
          </button>
        )
      })}
    </span>
  )
}
