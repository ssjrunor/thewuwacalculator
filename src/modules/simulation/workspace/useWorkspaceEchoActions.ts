/*
  Author: Runor Ewhro
  Description: Coordinates save, lift, and undo operations for canonical or
               caller-owned Echo loadouts in a build workspace.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import { sameEchoUid, saveEchoSlots } from '@/domain/entities/inventoryStorage.ts'
import { useAppStore } from '@/application/state'
import type { EvaluationEchoActions } from '@/modules/simulation/workspace/ui.tsx'
import { qpEchoAtSlot } from '@/modules/simulation/features/echoes/lib/equip.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'

const LIFT_UNDO_MS = 6000

export function useWorkspaceEchoActions({
  resonatorId,
  echoLoadout,
  editable,
  canSaveEcho,
  onEchoLoadoutChange,
}: {
  resonatorId: string | null | undefined
  echoLoadout: Array<EchoInstance | null>
  editable: boolean
  canSaveEcho: (echo: EchoInstance) => boolean
  /** Optional detached owner. When present, slot changes stay in the caller's
      local workspace instead of writing through to the canonical runtime. */
  onEchoLoadoutChange?: (echoes: Array<EchoInstance | null>) => void
}): EvaluationEchoActions | undefined {
  const showToast = useTstStr((state) => state.show)
  const addEchoesToInventory = useAppStore((state) => state.addInvEchoes)
  const updateRuntime = useAppStore((state) => state.updResRt)
  const [liftedEcho, setLiftedEcho] = useState<{
    resonatorId: string
    slotIndex: number
    echo: EchoInstance
  } | null>(null)
  const liftUndoTimer = useRef(0)

  const clearLiftOffer = useCallback(() => {
    window.clearTimeout(liftUndoTimer.current)
    liftUndoTimer.current = 0
    setLiftedEcho(null)
  }, [])

  useEffect(() => () => window.clearTimeout(liftUndoTimer.current), [])

  useEffect(() => {
    if (!liftedEcho) return
    const filled = echoLoadout[liftedEcho.slotIndex]
    if (
      liftedEcho.resonatorId === resonatorId &&
      (!filled || sameEchoUid(filled, liftedEcho.echo))
    ) return
    const frame = window.requestAnimationFrame(clearLiftOffer)
    return () => window.cancelAnimationFrame(frame)
  }, [clearLiftOffer, echoLoadout, liftedEcho, resonatorId])

  const saveEcho = useCallback((slotIndex: number) => {
    if (!editable || !resonatorId) return
    const { savedCount, nextEchoes } = saveEchoSlots(
      echoLoadout,
      [slotIndex],
      addEchoesToInventory,
    )

    if (savedCount === 0) {
      showToast({
        content: 'This echo is already saved.',
        variant: 'warning',
        duration: 2600,
      })
      return
    }

    if (nextEchoes) {
      if (onEchoLoadoutChange) {
        onEchoLoadoutChange(nextEchoes)
      } else {
        updateRuntime(resonatorId, (runtime) => ({
          ...runtime,
          build: { ...runtime.build, echoes: nextEchoes },
        }))
      }
    }

    showToast({
      content: 'Saved 1 echo to bag.',
      variant: 'success',
      duration: 2400,
    })
  }, [
    addEchoesToInventory,
    echoLoadout,
    editable,
    onEchoLoadoutChange,
    resonatorId,
    showToast,
    updateRuntime,
  ])

  const liftEcho = useCallback((slotIndex: number) => {
    const echo = echoLoadout[slotIndex]
    if (!editable || !resonatorId || !echo) return

    if (onEchoLoadoutChange) {
      const echoes = [...echoLoadout]
      echoes[slotIndex] = null
      onEchoLoadoutChange(echoes)
    } else {
      updateRuntime(resonatorId, (runtime) => {
        const echoes = [...runtime.build.echoes]
        echoes[slotIndex] = null
        return {
          ...runtime,
          build: { ...runtime.build, echoes },
        }
      })
    }

    window.clearTimeout(liftUndoTimer.current)
    setLiftedEcho({ resonatorId, slotIndex, echo })
    liftUndoTimer.current = window.setTimeout(() => {
      liftUndoTimer.current = 0
      setLiftedEcho(null)
    }, LIFT_UNDO_MS)
  }, [echoLoadout, editable, onEchoLoadoutChange, resonatorId, updateRuntime])

  const undoLift = useCallback(() => {
    if (!liftedEcho) return
    const { resonatorId: liftedResonatorId, slotIndex, echo } = liftedEcho
    clearLiftOffer()
    if (!editable || resonatorId !== liftedResonatorId) return

    if (onEchoLoadoutChange) {
      onEchoLoadoutChange(qpEchoAtSlot(echoLoadout, echo, slotIndex))
    } else {
      updateRuntime(liftedResonatorId, (runtime) => ({
        ...runtime,
        build: {
          ...runtime.build,
          echoes: qpEchoAtSlot(runtime.build.echoes, echo, slotIndex),
        },
      }))
    }
  }, [
    clearLiftOffer,
    echoLoadout,
    editable,
    liftedEcho,
    onEchoLoadoutChange,
    resonatorId,
    updateRuntime,
  ])

  const liftedSlot = liftedEcho && liftedEcho.resonatorId === resonatorId
    ? liftedEcho.slotIndex
    : null

  return useMemo(() => editable ? {
    canSave: (slotIndex: number) => {
      const echo = echoLoadout[slotIndex]
      return echo ? canSaveEcho(echo) : false
    },
    onSave: saveEcho,
    onLift: liftEcho,
    liftedSlot,
    onUndoLift: undoLift,
  } : undefined, [
    canSaveEcho,
    echoLoadout,
    editable,
    liftedSlot,
    liftEcho,
    saveEcho,
    undoLift,
  ])
}
