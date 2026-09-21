/*
  Author: Runor Ewhro
  Description: Builds profile clipboard and removal actions against canonical scenario ownership.
*/

import { useCallback, useMemo } from 'react'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { projectScenarioMemberProfile } from '@/engine/runtime/scenarioRuntime.ts'
import { useAppStore } from '@/application/state'
import { nextResonatorSelection } from '@/modules/simulation/model/resonatorProfileActions.ts'
import {
  makeProfileClip,
  readProfClip,
  writeProfClip,
} from '@/modules/simulation/workspace/profileClipboard.ts'
import { useConfirm } from '@/shared/hooks/useConfirmation.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import type { BuildRosterEntry } from './BuildRoster.tsx'

export interface ResonatorRemoveCopy {
  title?: string
  message?: string
  confirmLabel?: string
  successMessage?: string
}

export interface ResonatorProfileOps {
  roster: BuildRosterEntry[]
  rosterById: Map<string, BuildRosterEntry>
  copy: (resonatorIds: string[]) => Promise<boolean>
  remove: (resonatorIds: string[], copy?: ResonatorRemoveCopy) => void
  cut: (resonatorIds: string[]) => Promise<void>
  paste: () => Promise<void>
}

export function useResonatorProfileOps(roster: BuildRosterEntry[]): ResonatorProfileOps {
  const showToast = useTstStr((state) => state.show)
  const confirmation = useConfirm()
  const scenariosById = useAppStore((state) => state.combat.scenariosById)
  const contextResId = useAppStore((state) => (
    state.combat.scenariosById[state.combat.selectedScenarioId]
      ? contextScenarioMember(state.combat.scenariosById[state.combat.selectedScenarioId]).resonatorId
      : null
  ))
  const swapResonator = useAppStore((state) => state.swRes)
  const deleteResonatorProfiles = useAppStore((state) => state.delResProfs)
  const upsertResonatorProfiles = useAppStore((state) => state.upsertRes)

  const rosterById = useMemo(
    () => new Map(roster.map((entry) => [entry.id, entry])),
    [roster],
  )

  const makeClipboardEntries = useCallback((resonatorIds: string[]) => (
    resonatorIds.flatMap((resonatorId) => {
      const entry = rosterById.get(resonatorId)
      const scenario = entry ? scenariosById[entry.scenarioId] : null
      if (!entry || !scenario) return []
      const member = contextScenarioMember(scenario)
      return [{
        resonatorId,
        resonatorName: entry.name,
        profile: projectScenarioMemberProfile(scenario, member),
      }]
    })
  ), [rosterById, scenariosById])

  const copy = useCallback(async (resonatorIds: string[]) => {
    const entries = makeClipboardEntries(resonatorIds)
    if (entries.length === 0) {
      showToast({ content: 'Nothing to copy yet.', variant: 'default', duration: 2200 })
      return false
    }

    const wrote = await writeProfClip(makeProfileClip(entries))
    showToast({
      content: wrote
        ? `Copied ${entries.length} resonator profile${entries.length === 1 ? '' : 's'}.`
        : 'Clipboard write failed.',
      variant: wrote ? 'success' : 'error',
      duration: wrote ? 2200 : 2600,
    })
    return wrote
  }, [makeClipboardEntries, showToast])

  const remove = useCallback((resonatorIds: string[], copyText: ResonatorRemoveCopy = {}) => {
    const ids = resonatorIds.filter((id, index, list) => rosterById.has(id) && list.indexOf(id) === index)
    if (ids.length === 0) return

    const removed = ids
      .map((id) => rosterById.get(id))
      .filter((entry): entry is BuildRosterEntry => Boolean(entry))
    const nextId = nextResonatorSelection(roster, contextResId, ids)
    confirmation.confirm({
      title: copyText.title ?? (ids.length === 1 ? 'Remove this context resonator?' : `Remove ${ids.length} context resonators?`),
      message: copyText.message ?? (
        ids.length === 1
          ? `${removed[0]?.name ?? 'This resonator'}'s working scenario will be removed. inventory items stay intact.`
          : 'The working scenarios owned by these context resonators will be removed. inventory items stay intact.'
      ),
      confirmLabel: copyText.confirmLabel ?? 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: () => {
        deleteResonatorProfiles(ids, nextId)
        showToast({
          content: copyText.successMessage ?? (
            ids.length === 1
              ? `${removed[0]?.name ?? 'Resonator'} removed from the context roster.`
              : `Removed ${ids.length} context resonators from the roster.`
          ),
          variant: 'success',
          duration: 3000,
        })
      },
    })
  }, [confirmation, contextResId, deleteResonatorProfiles, roster, rosterById, showToast])

  // One gesture, so the copy has to land before anything is taken away.
  const cut = useCallback(async (resonatorIds: string[]) => {
    const wrote = await copy(resonatorIds)
    if (!wrote) return
    remove(resonatorIds, {
      title: resonatorIds.length === 1 ? 'Cut this context resonator?' : `Cut ${resonatorIds.length} context resonators?`,
      message: resonatorIds.length === 1
        ? 'Its default scenario profile was copied. removing it will delete every scenario under this context resonator.'
        : 'Their default scenario profiles were copied. removing them will delete every scenario under these context resonators.',
      confirmLabel: 'Cut',
      successMessage: resonatorIds.length === 1
        ? 'Context resonator cut to clipboard.'
        : `Cut ${resonatorIds.length} context resonators to clipboard.`,
    })
  }, [copy, remove])

  const paste = useCallback(async () => {
    const payload = await readProfClip()
    if (!payload) {
      showToast({
        content: 'Clipboard does not contain a resonator profile.',
        variant: 'default',
        duration: 2400,
      })
      return
    }

    const overwrites = payload.profiles.filter((entry) => rosterById.has(entry.resonatorId))
    const addedCount = payload.profiles.length - overwrites.length
    const applyPaste = () => {
      upsertResonatorProfiles(
        payload.profiles.map((entry) => entry.profile),
        payload.profiles.length === 1 ? 'Pasted Resonator Profile' : 'Pasted Resonator Profiles',
      )
      const firstId = payload.profiles[0]?.resonatorId
      if (firstId) swapResonator(firstId)
      showToast({
        content: overwrites.length > 0
          ? `Pasted ${payload.profiles.length} resonator profile${payload.profiles.length === 1 ? '' : 's'} (${overwrites.length} overwritten${addedCount > 0 ? `, ${addedCount} added` : ''}).`
          : `Pasted ${payload.profiles.length} resonator profile${payload.profiles.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 3000,
      })
    }

    if (overwrites.length === 0) {
      applyPaste()
      return
    }

    confirmation.confirm({
      title: overwrites.length === 1
        ? `Overwrite ${overwrites[0]?.resonatorName ?? 'this resonator'}?`
        : `Overwrite ${overwrites.length} resonator profiles?`,
      message: overwrites.length === 1
        ? `${overwrites[0]?.resonatorName ?? 'This resonator'} already exists on the roster. Pasting will replace its saved scenario state.`
        : 'Some resonators in the clipboard already exist on the roster. Pasting will replace their saved scenario state.',
      confirmLabel: 'Overwrite',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: applyPaste,
    })
  }, [confirmation, rosterById, showToast, swapResonator, upsertResonatorProfiles])

  return { roster, rosterById, copy, remove, cut, paste }
}
