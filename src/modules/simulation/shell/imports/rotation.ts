/*
  Author: Runor Ewhro
  description: recognizes rotation payloads and applies compatible imports to canonical scenario state.
*/

import { useMemo } from 'react'
import { useAppStore } from '@/application/state'
import { useTstStr } from '@/shared/util/toastStore.ts'
import type { NormalizedImportedRotation } from '@/application/imports/rotationPayload.ts'
import type { ImportHandler, ImportPick } from '@/application/imports/types.ts'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { getWpnById } from '@/data/catalog/weaponCatalogService.ts'
import { loadRotationScenario } from '@/modules/simulation/surfaces/rotation/program-editor/saved/useLoadRotation.ts'

export const ROTATION_IMPORT_KIND = 'rotation'

function importPick(action: 'primary' | 'secondary' | ImportPick): ImportPick {
  if (action === 'primary') return { load: 'build', save: true }
  if (action === 'secondary') return { load: 'none', save: true }
  return action
}

export async function applyRotationImport(
  entries: NormalizedImportedRotation[],
  action: 'primary' | 'secondary' | ImportPick,
): Promise<void> {
  const pick = importPick(action)
  const first = entries[0]
  if (!first || (pick.load === 'none' && !pick.save)) return

  if (pick.load !== 'none') {
    await loadRotationScenario(first.scenario, pick.load)
  }

  if (pick.save) {
    for (const entry of entries) useAppStore.getState().addInvRot(entry)
  }

  useTstStr.getState().show({
    content: pick.load === 'none'
      ? `Saved ${entries.length} rotation${entries.length === 1 ? '' : 's'} to the list.`
      : pick.save
        ? `Loaded "${first.name}" and saved ${entries.length} rotation${entries.length === 1 ? '' : 's'}.`
        : `Loaded "${first.name}".`,
    variant: 'success',
    duration: 3000,
  })
}

export async function detectRotationImport(parsed: unknown): Promise<NormalizedImportedRotation[] | null> {
  const [{ normalizeImportedRotationEntries }, { collectResonatorIds }, { ensureResonatorData }] = await Promise.all([
    import('@/application/imports/rotationPayload.ts'),
    import('@/application/persistence/resonatorScope'),
    import('@/data/gameData'),
  ])
  await ensureResonatorData(collectResonatorIds(parsed))
  const entries = normalizeImportedRotationEntries(parsed)
  return entries.length > 0 ? entries : null
}

export function useRotationImportHandler(): ImportHandler<NormalizedImportedRotation[]> {

  return useMemo<ImportHandler<NormalizedImportedRotation[]>>(() => ({
    kind: ROTATION_IMPORT_KIND,
    detect: detectRotationImport,
    review: (entries) => {
      const single = entries.length === 1 ? entries[0] : null
      const lead = entries[0]
      const member = contextScenarioMember(lead.scenario)
      const weaponId = member.loadout.weapon.id
      return {
        title: single ? 'Import rotation' : 'Import rotations',
        summary: single
          ? `Add "${single.name}" (${single.resName}) to your saved rotations.`
          : `Add ${entries.length} rotations to your saved rotations.`,
        primaryLabel: 'Import & load',
        secondaryLabel: 'Import only',
        take: {
          name: lead.name,
          resonatorName: lead.resName,
          count: entries.length,
          steps: lead.scenario.program.program.length,
          level: member.progression.level,
          profile: getResSeedBy(member.resonatorId)?.profile ?? `/assets/game/resonators/profiles/${member.resonatorId}.webp`,
          weaponIcon: weaponId ? getWpnById(weaponId)?.icon ?? null : null,
          savedCount: useAppStore.getState().library.rotations.length,
        },
      }
    },
    apply: applyRotationImport,
  }), [])
}
