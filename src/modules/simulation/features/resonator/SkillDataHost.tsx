/*
  Author: Runor Ewhro
  Description: Hosts shared skill-detail modal requests across persistent and routed Simulation surfaces.
*/

import { createContext as mkCtx, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SkillTabKey } from '@/domain/entities/resonator'
import { useAppStore } from '@/application/state'
import { selWorkDrvd } from '@/application/state'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { SkillData } from '@/modules/simulation/features/resonator/SkillData.tsx'
import {
  getResDtls,
  getResonator,
  type ResView,
} from '@/modules/simulation/features/resonator/lib/resonator.ts'

export interface SkllDataTgt {
  resonatorId: string
  tab: SkillTabKey
}

interface SkllDataCtxV {
  open: (target: SkllDataTgt) => void
  openFor: (resonatorId: string) => void
}

const skllDataCtx = mkCtx<SkllDataCtxV | null>(null)

export function SkllDataProv({ children }: { children: ReactNode }) {
  const { actRt, partRtsById: partRntmById } = useAppStore(selWorkDrvd)
  const modal = useAppModal()
  const [target, setTarget] = useState<SkllDataTgt | null>(null)

  const open = useCallback((next: SkllDataTgt) => {
    setTarget(next)
    modal.show()
  }, [modal])

  // the common case only knows which resonator was clicked, so land on
  // whichever tab that one authored first.
  const openFor = useCallback((resonatorId: string) => {
    open({
      resonatorId,
      tab: (getResDtls(resonatorId)?.skillTabs ?? [])[0] ?? 'normalAttack',
    })
  }, [open])

  const close = useCallback(() => {
    modal.hide(() => {
      setTarget(null)
    })
  }, [modal])

  const runtime = target
    ? partRntmById[target.resonatorId]
      ?? (actRt?.id === target.resonatorId ? actRt : null)
    : null

  // resolve each candidate's runtime-specific tab data.
  const roster = useMemo<ResView[]>(() => {
    if (!actRt) {
      return []
    }

    return [actRt.id, ...actRt.build.team.slice(1)].flatMap((memberId) => {
      if (!memberId) {
        return []
      }

      const view = getResonator(memberId)
      return view ? [view] : []
    })
  }, [actRt])

  const swtcMmbr = useCallback((resonatorId: string) => {
    setTarget((prev) => (prev ? { ...prev, resonatorId } : prev))
  }, [])

  const value = useMemo<SkllDataCtxV>(() => ({ open, openFor }), [open, openFor])

  return (
    <skllDataCtx.Provider value={value}>
      {children}
      <SkillData
        key={target?.tab ?? 'none'}
        visible={modal.visible}
        open={modal.open}
        closing={modal.closing}
        portalTarget={mainPortal()}
        resonatorId={target?.resonatorId ?? null}
        runtime={runtime}
        requestedTab={target?.tab ?? null}
        roster={roster}
        onSwitchMember={swtcMmbr}
        onClose={close}
      />
    </skllDataCtx.Provider>
  )
}

export function useSkllData(): SkllDataCtxV {
  const value = useContext(skllDataCtx)
  if (!value) {
    throw new Error('useSkllData must be used within SkllDataProv')
  }

  return value
}
