/*
  Author: Runor Ewhro
  Description: Holds the open request for the target console so the head can
               open it from any working surface. The target is one thing the
               whole app is calculating against, so it is not the property of
               the pane that happens to be showing.

               Session-only, like the teammate console: a console left open at
               unload should not reopen on the next visit.
*/

import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useAppStore } from '@/domain/state/store.ts'
import { selActResId, selEnemyProf, selWorkDrvd } from '@/domain/state/selectors.ts'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { selLiveRun } from '@/modules/simulation/model/selectors.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { EnemyConsole } from '@/modules/simulation/features/enemies/Console.tsx'

interface EnemyConsoleStore {
  open: boolean
  show: () => void
  close: () => void
}

export const useEnemyCnsl = create<EnemyConsoleStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}))

export function openEnemyCnsl(): void {
  useEnemyCnsl.getState().show()
}

/*
  The console itself, standing where the head can reach it. It reads the same
  three things the Simulation panes read, so the target it edits is the
  target every surface is calculating against.
*/
export function EnemyConsoleHost() {
  const open = useEnemyCnsl((state) => state.open)
  const closeRequest = useEnemyCnsl((state) => state.close)
  const actResId = useAppStore(selActResId)
  const enemyProfile = useAppStore(selEnemyProf)
  const { prepWork, actRt } = useAppStore(selWorkDrvd)
  const setEnemy = useAppStore((state) => state.setEnemy)
  const updActRt = useAppStore((state) => state.updActRt)
  const modal = useAppModal()

  const activeSeed = actResId ? seedRsntById[actResId] ?? null : null
  const simulation = useMemo(
    () => selLiveRun(activeSeed ? prepWork : null),
    [activeSeed, prepWork],
  )

  /*
    `show` is the stable half of the modal: the object around it is rebuilt on
    every state change, so depending on that would re-open the modal on the
    frame it just opened and it would never settle.
  */
  const { show } = modal
  useEffect(() => {
    if (open) show()
  }, [open, show])

  const close = useCallback(() => {
    modal.hide(() => {
      closeRequest()
    })
  }, [closeRequest, modal])

  if (!open) {
    return null
  }

  return (
    <EnemyConsole
      visible={modal.visible}
      open={modal.open}
      closing={modal.closing}
      runtime={actRt}
      enemyProfile={enemyProfile}
      simulation={simulation}
      onRtPdt={updActRt}
      onEnemyChange={setEnemy}
      onClose={close}
    />
  )
}
