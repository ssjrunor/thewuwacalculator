/*
  Author: Runor Ewhro
  Description: Owns rotation import behavior and state transitions for the handlers module.
*/

import { useMemo } from 'react'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import {
  normalizeImportedRotationEntries,
  type NormalizedImportedRotation,
} from '@/infra/imports/rotationPayload.ts'
import { useLoadRotation } from './useLoadRotation.ts'
import type { ImportHandler } from '@/infra/imports/types.ts'

export const ROTATION_IMPORT_KIND = 'rotation'

export function useRotationImportHandler(): ImportHandler<NormalizedImportedRotation[]> {
  const addRotToInv = useAppStore((state) => state.addInvRot)
  const loadRotation = useLoadRotation()
  const showToast = useTstStr((state) => state.show)

  return useMemo<ImportHandler<NormalizedImportedRotation[]>>(() => ({
    kind: ROTATION_IMPORT_KIND,
    detect: (parsed) => {
      const entries = normalizeImportedRotationEntries(parsed)
      return entries.length > 0 ? entries : null
    },
    review: (entries) => {
      const single = entries.length === 1 ? entries[0] : null
      return {
        title: single ? 'Import rotation' : 'Import rotations',
        summary: single
          ? `Add "${single.name}" (${single.resName}) to your saved rotations.`
          : `Add ${entries.length} rotations to your saved rotations.`,
        primaryLabel: 'Import & load',
        secondaryLabel: 'Import only',
      }
    },
    apply: (entries, variant) => {
      const added: SavedRotation[] = []
      for (const entry of entries) {
        const addedEntry = addRotToInv(entry)
        if (addedEntry) added.push(addedEntry)
      }

      const first = added[0]
      if (!first) {
        showToast({
          content: 'No valid rotation data found.',
          variant: 'error',
          duration: 3500,
        })
        return
      }

      if (variant === 'primary') {
        loadRotation(first)
        showToast({
          content: `Imported and loaded "${first.name}".`,
          variant: 'success',
          duration: 3000,
        })
        return
      }

      showToast({
        content: `Imported ${added.length} rotation${added.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 3000,
      })
    },
  }), [addRotToInv, loadRotation, showToast])
}
