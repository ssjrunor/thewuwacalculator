/*
  Author: Runor Ewhro
  Description: Hosts shared skill-detail modal requests across persistent and routed Simulation surfaces.
*/

import { createContext as mkCtx, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ensureResonatorData, hasResonatorData, holdResonatorData } from '@/data/gameData'
import { useTstStr } from '@/shared/util/toastStore'
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
  const pending = useRef(0)
  const targetId = target?.resonatorId
  useEffect(() => targetId ? holdResonatorData([targetId]) : undefined, [targetId])
  const cancelPending = useCallback(() => { pending.current++ }, [])
  useEffect(() => cancelPending, [cancelPending])

  const open = useCallback((next: { resonatorId: string; tab?: SkillTabKey }) => {
    const request = ++pending.current
    const show = () => {
      if (pending.current !== request) return
      setTarget({
        resonatorId: next.resonatorId,
        tab: next.tab ?? getResDtls(next.resonatorId)?.skillTabs?.[0] ?? 'normalAttack',
      })
      modal.show()
    }
    if (hasResonatorData([next.resonatorId])) show()
    else void ensureResonatorData([next.resonatorId]).then(show).catch(() => {
      if (pending.current === request) useTstStr.getState().show({ content: 'Could not load resonator data. Please try again.', variant: 'error' })
    })
  }, [modal])

  // the common case only knows which resonator was clicked, so land on
  // whichever tab that one authored first.
  const openFor = useCallback((resonatorId: string) => {
    open({ resonatorId })
  }, [open])

  const close = useCallback(() => {
    pending.current++
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
