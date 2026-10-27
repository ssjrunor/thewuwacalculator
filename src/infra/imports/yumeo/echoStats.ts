/*
  Author: Runor Ewhro
  description: maps Mornye Tools Echo property IDs to calculator stat keys.
*/

// main property IDs share a stat suffix across groups 2 through 5.

const MAIN_STAT_BY_SUFFIX: Record<number, string> = {
  1: 'critRate', 2: 'critDmg', 3: 'atkPercent', 4: 'hpPercent',
  5: 'defPercent', 6: 'healingBonus', 7: 'glacio', 8: 'fusion',
  9: 'electro', 10: 'aero', 11: 'spectro', 12: 'havoc',
  13: 'atkPercent', 14: 'hpPercent', 15: 'defPercent',
  16: 'energyRegen', 17: 'atkPercent', 18: 'hpPercent',
  19: 'defPercent',
}

const MAIN_FLAT_STAT_BY_SUFFIX: Record<number, string> = {
  1: 'atkFlat', 2: 'hpFlat', 3: 'atkFlat',
}

const SUB_STAT_BY_ID: Record<number, string> = {
  1: 'hpFlat', 2: 'atkFlat', 3: 'defFlat',
  4: 'hpPercent', 5: 'atkPercent', 6: 'defPercent',
  7: 'resonanceSkill', 8: 'basicAtk', 9: 'heavyAtk',
  10: 'resonanceLiberation', 11: 'critRate', 12: 'critDmg',
  13: 'energyRegen', 14: 'critRate', 15: 'critDmg',
  16: 'energyRegen', 17: 'atkPercent', 18: 'hpFlat',
  19: 'defFlat',
}

export function yumeoEchoStatKey(statId: unknown, kind: 'main' | 'sub'): string | null {
  if (typeof statId !== 'number' || !Number.isInteger(statId)) return null
  if (kind === 'sub') return SUB_STAT_BY_ID[statId] ?? null

  const flat = statId >= 20_000
  const tierScale = flat ? 10_000 : 1_000
  const tier = Math.floor(statId / tierScale)
  if (tier < 2 || tier > 5) return null
  const suffix = statId % tierScale
  return (flat ? MAIN_FLAT_STAT_BY_SUFFIX : MAIN_STAT_BY_SUFFIX)[suffix] ?? null
}
