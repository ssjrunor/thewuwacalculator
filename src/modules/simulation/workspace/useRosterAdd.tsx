/*
  Author: Runor Ewhro
  Description: The Build Lab roster's add flow. The socket at the base of the
               column opens the ordinary resonator picker: picking someone the
               roster already holds switches to them, picking anyone else puts
               them on it.
*/

import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { useAppStore } from '@/domain/state/store.ts'
import { selContextResonatorId } from '@/domain/state/selectors.ts'
import { RES_MENU, getResonator } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { ResPckr } from '@/modules/simulation/features/resonator/Picker.tsx'
import { mainPortal } from '@/shared/lib/portalTarget'
import { useAppModal } from '@/shared/ui/useAppModal.ts'

export function useRosterAdd(): {
  open: () => void
  portal: ReactNode
} {
  const modal = useAppModal()
  const portalTarget = mainPortal()
  const contextResId = useAppStore(selContextResonatorId)
  // one call for both cases: an existing working scenario is selected, and a
  // resonator without one gets it created.
  const swapResonator = useAppStore((state) => state.swRes)

  const open = useCallback(() => modal.show(), [modal])
  const current = contextResId ? getResonator(contextResId) : null

  const portal = modal.visible ? (
    <ResPckr
      visible={modal.visible}
      open={modal.open}
      closing={modal.closing}
      portalTarget={portalTarget}
      eyebrow="Roster"
      title="Select Resonator"
      resonators={RES_MENU}
      selResId={contextResId}
      selLbl="Current"
      smmrPrmr={current ? { label: 'Current', value: current.name } : undefined}
      emptyState={<p>I hope Solon Lee releases the character you're searching for.</p>}
      closeLabel="Close"
      panelWidth="regular"
      onClose={modal.hide}
      onSelect={(resonatorId) => {
        swapResonator(resonatorId)
        modal.hide()
      }}
    />
  ) : null

  return { open, portal }
}
