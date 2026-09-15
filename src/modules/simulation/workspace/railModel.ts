/*
  Author: Runor Ewhro
  Description: Builds the shared rail model from active or stored runtimes,
               catalog metadata, equipment, team members, and Sonata sets.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { isNoWeaponId } from '@/domain/entities/runtime'
import { getWpnById } from '@/domain/services/weaponCatalogService'
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { getResonator, spriteVars } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { toTitle } from '@/shared/lib/format'
import { getWpnVisKey } from '@/modules/simulation/workspace/weaponVisual.ts'
import { buildSonataPlan } from '@/modules/simulation/workspace/ui.tsx'
import type { BuildRailModel } from './BuildRail.tsx'

const DEF_ACCENT = '#6b7cff'

export interface RailModelCtx {
  /** Resonator whose live runtime is supplied by this workspace context. */
  actResId: string | null
  runtime: ResRuntime | null
  partRtsById: Record<string, ResRuntime>
  initRtsById: Record<string, ResRuntime>
}

export function makeRailModel(resId: string | null, ctx: RailModelCtx): BuildRailModel {
  const { actResId, runtime, partRtsById, initRtsById } = ctx
  const railRuntime = resId === actResId
    ? runtime
    : resId ? initRtsById[resId] ?? null : null
  const railSeed = resId ? seedRsntById[resId] ?? null : null
  // Active-subject teammates resolve live; other profiles use stored runtime projections.
  const railDisplayRuntimesById = resId === actResId ? partRtsById : initRtsById
  const railWeaponState = railRuntime?.build.weapon ?? null
  const railWeapon = railWeaponState?.id && !isNoWeaponId(railWeaponState.id)
    ? getWpnById(railWeaponState.id)
    : null
  const railWeaponName = railWeapon?.name
    ?? (railWeaponState && !isNoWeaponId(railWeaponState.id) && railWeaponState.id
      ? toTitle(railWeaponState.id)
      : 'No Weapon')
  const railWpnVslKey = getWpnVisKey(railWeapon?.weaponType ?? railSeed?.weaponType ?? null)
  const railWeaponIcon = railWeapon?.icon
    ?? (railWpnVslKey ? `/assets/game/weapons/types/${railWpnVslKey}.webp` : null)
  const railSonataSets = railRuntime
    ? buildSonataPlan(railRuntime.build.echoes).map((entry) => ({
        setId: entry.id,
        pieces: entry.count,
        icon: entry.icon,
        name: getSntSetNam(entry.id),
      }))
    : []
  const railTeamSupports = (railRuntime?.build.team?.slice(1) ?? [])
    .filter((id): id is string => Boolean(id))
    .map((id) => {
      const res = getResonator(id)
      if (!res) return null
      const mateRt = railDisplayRuntimesById[id] ?? null
      const mateWpnState = mateRt?.build.weapon ?? null
      const mateWpn = mateWpnState?.id && !isNoWeaponId(mateWpnState.id)
        ? getWpnById(mateWpnState.id)
        : null
      const mateWpnKey = getWpnVisKey(mateWpn?.weaponType ?? res.weaponType ?? null)
      const sets = mateRt
        ? buildSonataPlan(mateRt.build.echoes)
            .slice(0, 2)
            .map((entry) => ({ ...entry, name: getSntSetNam(entry.id) }))
        : []
      return {
        id,
        name: res.name,
        rarity: res.rarity ?? 4,
        sprite: res.sprite ?? res.profile ?? '/assets/game/default.webp',
        profile: res.profile ?? res.sprite ?? '/assets/game/default.webp',
        spriteCss: spriteVars(res),
        attribute: res.attribute,
        accent: ATTR_COLORS[res.attribute] ?? DEF_ACCENT,
        level: mateRt?.base.level ?? null,
        sequence: mateRt?.base.sequence ?? 0,
        weaponIcon: mateWpn?.icon ?? (mateWpnKey ? `/assets/game/weapons/types/${mateWpnKey}.webp` : null),
        weaponName: mateWpn?.name ?? null,
        weaponRarity: mateWpn?.rarity ?? null,
        weaponLevel: mateWpnState?.level ?? null,
        weaponRank: mateWpnState?.rank ?? null,
        sets,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  return {
    runtime: railRuntime,
    seed: railSeed,
    rarity: railSeed?.rarity ?? 4,
    accent: railSeed ? ATTR_COLORS[railSeed.attribute] ?? DEF_ACCENT : DEF_ACCENT,
    attrIcon: getAttributeIconSrc(railSeed?.attribute),
    portraitSrc: railSeed?.sprite ?? railSeed?.profile ?? '/assets/game/default.webp',
    spriteCss: spriteVars(railSeed),
    weaponState: railWeaponState,
    weapon: railWeapon,
    weaponName: railWeaponName,
    weaponRarity: railWeapon?.rarity ?? null,
    weaponIcon: railWeaponIcon,
    sonataSets: railSonataSets,
    teamSupports: railTeamSupports,
  }
}
