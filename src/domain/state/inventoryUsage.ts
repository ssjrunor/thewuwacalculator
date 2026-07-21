/*
  Author: Runor Ewhro
  Description: Builds app-level derived inventory usage indexes for saved
               echoes and builds.
*/

import type { InventoryEntry, SavedBuildSnap } from '@/domain/entities/inventoryStorage.ts'
import { getBuildSig } from '@/domain/entities/inventoryStorage.ts'
import type { ResProf } from '@/domain/entities/profile.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'

export interface InvEchoSg {
  resonatorId: string
  resName: string
  icon?: string
  rarity: 4 | 5
  slotIndex: number
}

export interface InvBldUsr {
  resonatorId: string
  resName: string
  icon?: string
  rarity: 4 | 5
}

export interface InvSgDrvd {
  echoUseByUid: Record<string, InvEchoSg[]>
  buildUseByBldId: Record<string, InvBldUsr[]>
}

export function mkInvEchoSgB(
  profilesById: Record<string, ResProf>,
): Record<string, InvEchoSg[]> {
  // index equipped echoes by uid so inventory surfaces can answer
  // "who is using this?" without walking every profile during render.
  const usageByUid: Record<string, InvEchoSg[]> = {}
  const seen = new Set<string>()

  for (const [resonatorId, profile] of Object.entries(profilesById)) {
    const resonator = getResSeedBy(resonatorId)
    const usageBase = {
      resonatorId,
      resName: resonator?.name ?? resonatorId,
      ...(resonator?.profile ? { icon: resonator.profile } : {}),
      rarity: resonator?.rarity ?? 4,
    } satisfies Omit<InvEchoSg, 'slotIndex'>

    profile.runtime.build.echoes.forEach((echo, slotIndex) => {
      if (!echo?.uid) {
        return
      }

      // the same uid can appear in multiple resonators, but a single
      // resonator-slot pair should only contribute once.
      const seenKey = `${echo.uid}:${resonatorId}:${slotIndex}`
      if (seen.has(seenKey)) {
        return
      }

      seen.add(seenKey)
      usageByUid[echo.uid] = [
        ...(usageByUid[echo.uid] ?? []),
        {
          ...usageBase,
          slotIndex,
        },
      ]
    })
  }

  return usageByUid
}

export function mkInvMkUsrs(
  profilesById: Record<string, ResProf>,
  invBlds: InventoryEntry[],
): Record<string, InvBldUsr[]> {
  // saved build entries are matched through the canonical build signature so
  // equivalent weapon+echo layouts collapse onto the same inventory build id.
  const usrsBySig = new Map<string, InvBldUsr[]>()

  for (const [resonatorId, profile] of Object.entries(profilesById)) {
    const signature = getBuildSig({
      weapon: profile.runtime.build.weapon,
      echoes: profile.runtime.build.echoes,
    } satisfies SavedBuildSnap)
    const resonator = getResSeedBy(resonatorId)
    const user: InvBldUsr = {
      resonatorId,
      resName: resonator?.name ?? resonatorId,
      ...(resonator?.profile ? { icon: resonator.profile } : {}),
      rarity: resonator?.rarity ?? 4,
    }
    const existing = usrsBySig.get(signature)

    if (existing) {
      existing.push(user)
      continue
    }

    usrsBySig.set(signature, [user])
  }

  return Object.fromEntries(
    invBlds.map((entry) => [
      entry.id,
      usrsBySig.get(getBuildSig(entry.build)) ?? [],
    ]),
  )
}

export function mkInvSgDrvd(
  profilesById: Record<string, ResProf>,
  invBlds: InventoryEntry[],
  seeEquipped: boolean
): InvSgDrvd {
  return {
    // disabling the preference should fully short-circuit the expensive indexes.
    echoUseByUid: seeEquipped ? mkInvEchoSgB(profilesById) : {},
    buildUseByBldId: seeEquipped ? mkInvMkUsrs(profilesById, invBlds) : {},
  }
}
