/*
  Author: Runor Ewhro
  Description: Derives runtime weapon stats from catalog data so persisted
               weapon snapshots only need identity and editable fields.
*/

import type { TeamMemWpnVi, WeaponState } from '@/domain/entities/runtime'
import { isNoWeaponId } from '@/domain/entities/runtime'
import { getWpnById } from '@/domain/services/weaponCatalogService'

export function wpnAtkAt(
  weaponId: string | null | undefined,
  level: number,
): number {
  if (!weaponId || isNoWeaponId(weaponId)) {
    return 0
  }

  const weapon = getWpnById(weaponId)
  if (!weapon) {
    return 0
  }

  const lvl = Math.max(1, Math.min(90, Math.round(level)))
  const exact = weapon.statsByLevel[lvl]
  if (exact) {
    return exact.atk
  }

  const lvls = Object.keys(weapon.statsByLevel)
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)

  const nearLvl = lvls.reduce(
    (nearest, current) =>
      Math.abs(current - lvl) < Math.abs(nearest - lvl)
        ? current
        : nearest,
    lvls[0] ?? lvl,
  )

  return weapon.statsByLevel[nearLvl]?.atk ?? weapon.baseAtk
}

export function catWpnAtk(
  weapon: Pick<WeaponState, 'id' | 'level' | 'rank'> & Partial<Pick<WeaponState, 'baseAtk'>>,
): WeaponState {
  return {
    id: weapon.id,
    level: weapon.level,
    rank: weapon.rank,
    baseAtk: wpnAtkAt(weapon.id, weapon.level),
  }
}

export function catTmWpnAtk(
  weapon: Pick<TeamMemWpnVi, 'id' | 'rank'> & Partial<Pick<TeamMemWpnVi, 'baseAtk'>>,
  level: number,
): TeamMemWpnVi {
  return {
    id: weapon.id,
    rank: weapon.rank,
    baseAtk: wpnAtkAt(weapon.id, level),
  }
}
