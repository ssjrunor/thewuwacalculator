/*
  Author: Runor Ewhro
  Description: shared echo-pane helpers for stat labels, icon resolution,
               default echo instancing, and set/cost summaries.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { makeEchoUid } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { STATICONMAP } from '@/modules/calculator/features/overview/lib/stats.ts'

const STAT_LABELS: Record<string, string> = {
  hpPercent: 'HP%',
  atkPercent: 'ATK%',
  defPercent: 'DEF%',
  critRate: 'Crit Rate',
  critDmg: 'Crit DMG',
  healingBonus: 'Healing',
  energyRegen: 'Energy Regen',
  tuneBreakBoost: 'Tune Break Boost',
  hpFlat: 'HP',
  atkFlat: 'ATK',
  defFlat: 'DEF',
  aero: 'Aero DMG',
  glacio: 'Glacio DMG',
  electro: 'Electro DMG',
  fusion: 'Fusion DMG',
  havoc: 'Havoc DMG',
  spectro: 'Spectro DMG',
  basicAtk: 'Basic ATK',
  heavyAtk: 'Heavy ATK',
  resonanceSkill: 'Res. Skill',
  resonanceLiberation: 'Res. Liberation',
}

const STATICONKEYM: Record<string, string> = {
  hpPercent: 'HP',
  hpFlat: 'HP',
  atkPercent: 'ATK',
  atkFlat: 'ATK',
  defPercent: 'DEF',
  defFlat: 'DEF',
  critRate: 'Crit Rate',
  critDmg: 'Crit DMG',
  energyRegen: 'Energy Regen',
  healingBonus: 'Healing Bonus',
  tuneBreakBoost: 'Tune Break Boost',
  aero: 'Aero DMG Bonus',
  glacio: 'Glacio DMG Bonus',
  electro: 'Electro DMG Bonus',
  fusion: 'Fusion DMG Bonus',
  havoc: 'Havoc DMG Bonus',
  spectro: 'Spectro DMG Bonus',
  basicAtk: 'Basic Attack DMG Bonus',
  heavyAtk: 'Heavy Attack DMG Bonus',
  resonanceSkill: 'Resonance Skill DMG Bonus',
  resonanceLiberation: 'Resonance Liberation DMG Bonus',
}

// map internal stat keys to the shorter ui display labels
export function fmtEchoStatL(key: string): string {
  return STAT_LABELS[key] ?? key
}

// format echo stat values according to flat vs percent display rules
export function fmtEchoStatV(key: string, value: number): string {
  if (key.endsWith('Flat') || key === 'hpFlat' || key === 'atkFlat' || key === 'defFlat') {
    return String(Math.round(value))
  }

  if (key === 'tuneBreakBoost') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
  }

  return `${value.toFixed(1)}%`
}

// resolve the stat icon asset used by the echo pane's mask icon
export function getEchoStatI(key: string): string | undefined {
  const iconKey = STATICONKEYM[key]
  return iconKey ? STATICONMAP[iconKey] : undefined
}

// build a default echo instance for a picked catalog echo and slot
export function mkDefEchoNst(
  echoId: string,
  index: number,
  previous: EchoInstance | null,
): EchoInstance | null {
  const definition = getEchoById(echoId)
  if (!definition) {
    return null
  }

  const cost = definition.cost
  const primaryStats = ECHO_MAIN_STATS[cost]
  const secondaryStats = ECHO_SIDE_STATS[cost]
  if (!primaryStats || !secondaryStats) {
    return null
  }

  const vldPrmrKeys = Object.keys(primaryStats)
  const fllbPrmrKey = vldPrmrKeys[0]
  const prvsPrmrKey = previous?.mainStats?.primary?.key
  const keepPrimary =
    prvsPrmrKey != null && vldPrmrKeys.includes(prvsPrmrKey)
  const primaryKey = keepPrimary ? prvsPrmrKey : fllbPrmrKey
  const primaryValue = primaryStats[primaryKey]

  const previousSet = previous?.set
  const keepSet =
    previousSet != null && definition.sets.includes(previousSet)

  return {
    uid: previous?.uid ?? makeEchoUid(),
    id: definition.id,
    set: keepSet ? previousSet : (definition.sets[0] ?? 0),
    mainEcho: index === 0,
    mainStats: {
      primary: {
        key: primaryKey,
        value: primaryValue,
      },
      secondary: {
        key: secondaryStats.key,
        value: secondaryStats.value,
      },
    },
    substats: previous?.substats ? { ...previous.substats } : {},
  }
}

// counts pieces per sonata for the set summary badges. within one sonata a
// repeated echo id counts once; the same echo id in two sonatas counts toward each.
export function cmptSetCnts(echoes: Array<EchoInstance | null>): Record<number, number> {
  const counts: Record<number, number> = {}
  const seenIdsBySet: Record<number, Set<string>> = {}
  for (const echo of echoes) {
    if (!echo) {
      continue
    }

    const seenIds = seenIdsBySet[echo.set] ?? (seenIdsBySet[echo.set] = new Set<string>())
    if (seenIds.has(echo.id)) {
      continue
    }

    seenIds.add(echo.id)
    counts[echo.set] = (counts[echo.set] ?? 0) + 1
  }

  return counts
}
