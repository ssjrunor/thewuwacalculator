/*
  Author: Runor Ewhro
  Description: Defines synthetic formula-stat paths used by rotation condition
               nodes to alter later feature formulas without touching saved
               manual buffs or scoped source effects.
*/

export const ROT_FORMULA_PATH_PREFIX = 'runtime.rotation.formula.'

export type RotFormulaStatKey =
  | 'atkFlat'
  | 'atkPercent'
  | 'hpFlat'
  | 'hpPercent'
  | 'defFlat'
  | 'defPercent'
  | 'energyRegen'
  | 'critRate'
  | 'critDmg'
  | 'healingBonus'
  | 'shieldBonus'
  | 'resIgnore'
  | 'defIgnore'
  | 'dmgBonus'
  | 'dmgAmp'
  | 'dmgVuln'
  | 'tuneBreakBoost'
  | 'special'
  | 'flatDmg'
  | 'mvAdd'
  | 'mvScale'
  | 'fixedDmg'
  | 'fixedMv'

export type RotFormulaStats = Partial<Record<RotFormulaStatKey, number>>

export interface RotFormulaStatDef {
  key: RotFormulaStatKey
  label: string
  description: string
}

export const ROT_FORMULA_STAT_DEFS: RotFormulaStatDef[] = [
  { key: 'atkFlat', label: 'Flat ATK', description: 'Adds flat ATK to later feature formulas that scale with ATK.' },
  { key: 'atkPercent', label: 'ATK%', description: 'Adds ATK% to later feature formulas that scale with ATK.' },
  { key: 'hpFlat', label: 'Flat HP', description: 'Adds flat HP to later feature formulas that scale with HP.' },
  { key: 'hpPercent', label: 'HP%', description: 'Adds HP% to later feature formulas that scale with HP.' },
  { key: 'defFlat', label: 'Flat DEF', description: 'Adds flat DEF to later feature formulas that scale with DEF.' },
  { key: 'defPercent', label: 'DEF%', description: 'Adds DEF% to later feature formulas that scale with DEF.' },
  { key: 'energyRegen', label: 'Energy Regen', description: 'Adds Energy Regen to later feature formulas that scale with Energy Regen.' },
  { key: 'critRate', label: 'Crit Rate', description: 'Adds Crit Rate to later feature formulas that can crit.' },
  { key: 'critDmg', label: 'Crit DMG', description: 'Adds Crit DMG to later feature formulas that can crit.' },
  { key: 'healingBonus', label: 'Healing Bonus', description: 'Adds Healing Bonus to later healing formulas.' },
  { key: 'shieldBonus', label: 'Shield Bonus', description: 'Adds Shield Bonus to later shield formulas.' },
  { key: 'resIgnore', label: 'RES Ignore', description: 'Adds resistance ignore to later damage formulas.' },
  { key: 'defIgnore', label: 'DEF Ignore', description: 'Adds defense ignore to later damage formulas.' },
  { key: 'dmgBonus', label: 'DMG Bonus', description: 'Adds DMG Bonus to later damage formulas.' },
  { key: 'dmgAmp', label: 'DMG Amplify', description: 'Adds DMG Amplify to later damage formulas.' },
  { key: 'dmgVuln', label: 'DMG Vulnerability', description: 'Adds DMG Vulnerability to later damage formulas.' },
  { key: 'tuneBreakBoost', label: 'Tune Break Boost', description: 'Adds Tune Break Boost to later tune, hack, or tune-related formulas.' },
  { key: 'special', label: 'Special', description: 'Adds Special to later formulas that use the special multiplier.' },
  { key: 'flatDmg', label: 'Flat DMG', description: 'Adds Flat DMG to later direct damage formulas.' },
  { key: 'mvAdd', label: 'MV Add', description: 'Adds to the MV of later feature formulas where an MV exists.' },
  { key: 'mvScale', label: 'MV Scale', description: 'Scales the MV of later feature formulas where an MV exists.' },
  { key: 'fixedDmg', label: 'Fixed DMG', description: 'Adds Fixed DMG to later direct damage formulas.' },
  { key: 'fixedMv', label: 'Fixed MV', description: 'Adds Fixed MV to later negative-effect formulas that use a fixed MV.' },
]

const ROT_FORMULA_STAT_KEYS = new Set(ROT_FORMULA_STAT_DEFS.map((definition) => definition.key))

export function getRotFormulaStatKey(path: string): RotFormulaStatKey | null {
  const normalized = path.startsWith('runtime.') ? path : `runtime.${path}`
  if (!normalized.startsWith(ROT_FORMULA_PATH_PREFIX)) {
    return null
  }

  const key = normalized.slice(ROT_FORMULA_PATH_PREFIX.length)
  return ROT_FORMULA_STAT_KEYS.has(key as RotFormulaStatKey) ? key as RotFormulaStatKey : null
}

export function getRotFormulaPath(key: RotFormulaStatKey): string {
  return `${ROT_FORMULA_PATH_PREFIX}${key}`
}
