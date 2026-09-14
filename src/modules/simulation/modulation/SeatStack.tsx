/*
  Author: Runor Ewhro
  Description: The party as a dial: the member being tuned in front at full
               size wearing their own attribute, the other two behind it on
               either side. Pressing one turns the dial to them, so the party
               keeps its order; pointed at, it stretches into an even row.

               It is one control in two places. The loadout's head stands it
               while that head is on the board, and the panel's head takes it
               over once the loadout has scrolled away, so both read as the same
               object rather than a row of ports in one and a stack in the other.
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
  /* standing but not in use, as the panel's copy is while the loadout's head is
     still on the board: out of the tab order and out of the accessibility tree */
  hidden?: boolean
}) {
  const seated = roster.find((mate) => mate.id === memberId) ?? roster[0] ?? null
  if (roster.length < 2 || !seated) return null

  /* the beads stay in party order and only their slots turn, so a seat change
     moves each bead to its new place instead of re-ordering the markup */
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
