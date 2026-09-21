/*
  Author: Runor Ewhro
  Description: Builds Echo context actions from the active loadout, inventory, and clipboard capabilities.
*/

import { useCallback, useMemo } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { equalEchoes } from '@/domain/entities/inventoryStorage.ts'
import { useAppStore } from '@/application/state'
import { useCtxBuilder } from '@/modules/simulation/shell/context-menu/useContextMenuBuilder.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { makeEchoClip, writeEchoClip } from '@/modules/simulation/features/echoes/lib/clipboard.ts'
import { cmptTtlEchoC } from '@/modules/simulation/features/echoes/lib/echoes.ts'
import { mkEchoSlotCs, slotFit } from '@/modules/simulation/features/echoes/lib/equip.ts'
import { EchoQpCmprdn } from '@/modules/simulation/features/echoes/lib/EchoEquipComparePreview.tsx'

interface UseEchoSrfcM {
  clpbSrcResId: string
  clipSourceName: string
  currentEchoes: Array<EchoInstance | null>
  onQpEchoAtjg: (echo: EchoInstance, slotIndex: number) => void
}

export function useEchoSrfcM({
  clpbSrcResId: clpbSrcResId,
  clipSourceName: clpbSrcResNa,
  currentEchoes: crrnChs,
  onQpEchoAtjg: onQpEchoAtSl,
}: UseEchoSrfcM) {
  const menu = useCtxBuilder()
  const invChs = useAppStore((state) => state.library.echoes)
  const addEchoToInv = useAppStore((state) => state.addInvEcho)
  const showToast = useTstStr((state) => state.show)

  const curTtlCost = useMemo(() => cmptTtlEchoC(crrnChs), [crrnChs])
  const curSlotCsts = useMemo(() => mkEchoSlotCs(crrnChs), [crrnChs])

  const canSaveEcho = useCallback((echo: EchoInstance) => (
    !invChs.some((entry) => equalEchoes(entry.echo, echo))
  ), [invChs])

  const copyChsToClp = useCallback(async (echoes: EchoInstance[]) => {
    if (echoes.length === 0) {
      showToast({
        content: 'Nothing to copy yet.',
        variant: 'warning',
        duration: 2600,
      })
      return false
    }

    const wrote = await writeEchoClip(makeEchoClip({
      source: 'loadout',
      resonatorId: clpbSrcResId,
      resName: clpbSrcResNa,
      echoes,
    }))

    if (!wrote) {
      showToast({
        content: 'Clipboard write failed.',
        variant: 'error',
        duration: 3000,
      })
    }

    return wrote
  }, [clpbSrcResId, clpbSrcResNa, showToast])

  const saveEchoToIn = useCallback((echo: EchoInstance) => {
    if (!canSaveEcho(echo)) {
      showToast({
        content: 'This echo is already saved.',
        variant: 'warning',
        duration: 2600,
      })
      return false
    }

    const saved = addEchoToInv(echo)
    if (!saved) {
      showToast({
        content: 'This echo is already saved.',
        variant: 'warning',
        duration: 2600,
      })
      return false
    }

    showToast({
      content: 'Saved 1 echo to bag.',
      variant: 'success',
      duration: 2400,
    })
    return true
  }, [addEchoToInv, canSaveEcho, showToast])

  const mkQpEnts = useCallback((id: string, echo: EchoInstance) => {
    return crrnChs
      .map((currentEcho, slotIndex) => ({
        currentEcho,
        slotIndex,
        fitState: slotFit(
          crrnChs,
          curTtlCost,
          curSlotCsts,
          echo,
          slotIndex,
        ),
      }))
      .filter(({ fitState }) => fitState.fits)
      .map(({ currentEcho, slotIndex, fitState }) => ({
        id: `${id}:equip:${slotIndex}`,
        label: `Slot ${slotIndex + 1}`,
        hint: fitState.selected ? 'Current' : undefined,
        preview: (
          <EchoQpCmprdn
            currentEcho={currentEcho}
            nextEcho={echo}
          />
        ),
        onSelect: () => onQpEchoAtSl(echo, slotIndex),
      }))
  }, [crrnChs, curSlotCsts, curTtlCost, onQpEchoAtSl])

  const mkReadOnlyMe = useCallback((args: {
    id: string
    echo: EchoInstance
    onSelect: () => void
  }) => {
    const equipEntries = mkQpEnts(args.id, args.echo)

    return menu.simulation.echo.readOnly({
      id: args.id,
      canSave: canSaveEcho(args.echo),
      equipEntries,
      onSave: () => {
        saveEchoToIn(args.echo)
      },
      onCopy: () => {
        void (async () => {
          const wrote = await copyChsToClp([args.echo])
          if (wrote) {
            showToast({
              content: 'Copied 1 echo.',
              variant: 'success',
              duration: 2200,
            })
          }
        })()
      },
      onSelect: args.onSelect,
    })
  }, [mkQpEnts, canSaveEcho, copyChsToClp, menu.simulation.echo, saveEchoToIn, showToast])

  return {
    canSaveEcho,
    saveEchoToInventory: saveEchoToIn,
    copyEchoesToClipboard: copyChsToClp,
    buildReadOnlyMenu: mkReadOnlyMe,
  }
}
