/*
  Author: Runor Ewhro
  Description: Owns loadout clipboard serialization, paste normalization, and
               result reporting for every Simulation Echo editor.
*/

import { useCallback } from 'react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import {
  makeEchoClip,
  pasteEchoes,
  readEchoClip,
  writeEchoClip,
} from '@/modules/simulation/features/echoes/lib/clipboard.ts'
import type { Toast } from '@/shared/util/toastStore.ts'

type ShowToast = (toast: Omit<Toast, 'id' | 'exiting'>) => string

export function useEchoClipboard({
  runtime,
  resonatorName,
  selectedSlots,
  updateRuntime,
  showToast,
}: {
  runtime: ResRuntime
  resonatorName: string
  selectedSlots: readonly number[]
  updateRuntime: RtUpdHnd
  showToast: ShowToast
}) {
  const showPasteResult = useCallback((pasted: number, skipped: number) => {
    if (pasted === 0) {
      showToast({
        content: skipped > 0
          ? 'Nothing valid to paste here.'
          : 'Clipboard does not contain an echo.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    showToast({
      content: skipped > 0
        ? `Pasted ${pasted} echo${pasted === 1 ? '' : 'es'} (${skipped} skipped).`
        : `Pasted ${pasted} echo${pasted === 1 ? '' : 'es'}.`,
      variant: 'success',
      duration: 2400,
    })
  }, [showToast])

  const copyEchoes = useCallback(async (echoes: EchoInstance[]) => {
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
      resonatorId: runtime.id,
      resName: resonatorName,
      echoes,
    }))
    if (!wrote) {
      showToast({
        content: 'Clipboard write failed.',
        variant: 'error',
        duration: 3000,
      })
      return false
    }

    return true
  }, [resonatorName, runtime.id, showToast])

  const pasteIntoSlot = useCallback(async (slotIndex: number) => {
    const payload = await readEchoClip()
    if (!payload) {
      showPasteResult(0, 0)
      return
    }

    const result = pasteEchoes(runtime.build.echoes, payload, slotIndex)
    if (result.pastedCount > 0) {
      updateRuntime((current) => ({
        ...current,
        build: { ...current.build, echoes: result.nextEchoes },
      }))
    }
    showPasteResult(result.pastedCount, result.skippedCount)
  }, [runtime.build.echoes, showPasteResult, updateRuntime])

  const defaultPasteSlot = useCallback(() => {
    if (selectedSlots.length > 0) return selectedSlots[0] ?? 0
    const firstEmpty = runtime.build.echoes.findIndex((echo) => echo == null)
    return firstEmpty >= 0 ? firstEmpty : 0
  }, [runtime.build.echoes, selectedSlots])

  return { copyEchoes, defaultPasteSlot, pasteIntoSlot, showPasteResult }
}
