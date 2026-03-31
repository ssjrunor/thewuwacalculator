/*
  Author: Runor Ewhro
  Description: shared echo-pane helpers for stat labels, icon resolution,
               default echo instancing, and set/cost summaries.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { createEchoUid } from '@/domain/entities/runtime'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { ECHO_PRIMARY_STATS, ECHO_SECONDARY_STATS } from '@/data/gameData/catalog/echoStats'
import { STAT_ICON_MAP } from '@/modules/calculator/model/overviewStats'

const STAT_LABELS: Record<string, string> = {
  hpPercent: 'HP%',
  atkPercent: 'ATK%',
  defPercent: 'DEF%',
  critRate: 'Crit Rate',
  critDmg: 'Crit DMG',
  healingBonus: 'Healing',
  energyRegen: 'Energy Regen',
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

const STAT_ICON_KEY_MAP: Record<string, string> = {
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
export function formatEchoStatLabel(key: string): string {
  return STAT_LABELS[key] ?? key
}

// format echo stat values according to flat vs percent display rules
export function formatEchoStatValue(key: string, value: number): string {
  if (key.endsWith('Flat') || key === 'hpFlat' || key === 'atkFlat' || key === 'defFlat') {
    return String(Math.round(value))
  }

  return `${value.toFixed(1)}%`
}

// resolve the stat icon asset used by the echo pane's mask icon
export function getEchoStatIconUrl(key: string): string | undefined {
  const iconKey = STAT_ICON_KEY_MAP[key]
  return iconKey ? STAT_ICON_MAP[iconKey] : undefined
}

// build a default echo instance for a picked catalog echo and slot
export function makeDefaultEchoInstance(
  echoId: string,
  index: number,
  previous: EchoInstance | null,
): EchoInstance | null {
  const definition = getEchoById(echoId)
  if (!definition) {
    return null
  }

  const cost = definition.cost
  const primaryStats = ECHO_PRIMARY_STATS[cost]
  const secondaryStats = ECHO_SECONDARY_STATS[cost]
  if (!primaryStats || !secondaryStats) {
    return null
  }

  const validPrimaryKeys = Object.keys(primaryStats)
  const fallbackPrimaryKey = validPrimaryKeys[0]
  const previousPrimaryKey = previous?.mainStats?.primary?.key
  const keepPrimary =
    previousPrimaryKey != null && validPrimaryKeys.includes(previousPrimaryKey)
  const primaryKey = keepPrimary ? previousPrimaryKey : fallbackPrimaryKey
  const primaryValue = primaryStats[primaryKey]

  const previousSet = previous?.set
  const keepSet =
    previousSet != null && definition.sets.includes(previousSet)

  return {
    uid: previous?.uid ?? createEchoUid(),
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

// count unique equipped echoes by set to drive the set summary badges
export function computeSetCounts(echoes: Array<EchoInstance | null>): Record<number, number> {
  const counts: Record<number, number> = {}
  const seenIds = new Set<string>()
  for (const echo of echoes) {
    if (!echo || seenIds.has(echo.id)) {
      continue
    }

    seenIds.add(echo.id)
    counts[echo.set] = (counts[echo.set] ?? 0) + 1
  }

  return counts
}
