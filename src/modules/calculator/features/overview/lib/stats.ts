/*
  Author: Runor Ewhro
  Description: builds overview stat displays and a nested stats tree for
               resonator summary panels, including formatted labels, icons,
               colors, and grouped modifier breakdowns.
*/

import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime.ts'
import type { AttributeKey, FinalStats, ModBuff, SkillTypeKey } from '@/domain/entities/stats.ts'
import { resResBaseSt } from '@/domain/services/resonatorSeedService.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService.ts'
import { getSkillType } from '@/modules/calculator/model/skillTypes.ts'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'
import { ATTR_COLORS } from '@/modules/calculator/model/display.ts'
import { toTitle } from '@/shared/lib/format.ts'

export interface VrvwStatRow {
  label: string
  base: number
  bonus: number
  total: number
  color?: string
}

export interface VrvwSttsView {
  mainStats: VrvwStatRow[]
  secondaryStats: VrvwStatRow[]
  dmgMdfrStts: VrvwStatRow[]
}

// icon lookup used by overview stat rows and stat displays
export const STATICONMAP: Record<string, string> = {
  ATK: '/assets/stat-icons/atk.png',
  HP: '/assets/stat-icons/hp.png',
  DEF: '/assets/stat-icons/def.png',
  'Energy Regen': '/assets/stat-icons/energyregen.png',
  'Crit Rate': '/assets/stat-icons/critrate.png',
  'Crit DMG': '/assets/stat-icons/critdmg.png',
  'Healing Bonus': '/assets/stat-icons/healing.png',
  'Tune Break Boost': '/assets/stat-icons/tune-break-boost.png',
  'Basic Attack DMG Bonus': '/assets/stat-icons/basic.png',
  'Heavy Attack DMG Bonus': '/assets/stat-icons/heavy.png',
  'Resonance Skill DMG Bonus': '/assets/stat-icons/skill.png',
  'Resonance Liberation DMG Bonus': '/assets/stat-icons/liberation.png',
  'Aero DMG Bonus': '/assets/stat-icons/aero.png',
  'Glacio DMG Bonus': '/assets/stat-icons/glacio.png',
  'Spectro DMG Bonus': '/assets/stat-icons/spectro.png',
  'Fusion DMG Bonus': '/assets/stat-icons/fusion.png',
  'Electro DMG Bonus': '/assets/stat-icons/electro.png',
  'Havoc DMG Bonus': '/assets/stat-icons/havoc.png',
}

// compact number formatter for large damage/stat readouts
export function fmtCmpcNmbr(raw: number | null): string {
  if (raw === null || !Number.isFinite(raw)) {
    return '--'
  }

  const num = Math.floor(raw)
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`
  if (num >= 1e7) return `${(num / 1e6).toFixed(1)}M`
  return num.toLocaleString()
}

// format overview stat values according to whether they are flat or percent-based
export function fmtDsplVl(label: string, value: number): string {
  if (label === 'ATK' || label === 'HP' || label === 'DEF') {
    return Math.floor(value).toLocaleString()
  }

  if (label === 'Tune Break Boost') {
    return fmtNum(value)
  }

  return `${value.toFixed(1)}%`
}

// friendly labels for raw stat keys used in tooltips, trees, and detail panes
export function fmtStatKeyLb(key: string): string {
  const labels: Record<string, string> = {
    atkPercent: 'ATK%',
    hpPercent: 'HP%',
    defPercent: 'DEF%',
    atkFlat: 'ATK',
    hpFlat: 'HP',
    defFlat: 'DEF',
    critRate: 'Crit Rate',
    critDmg: 'Crit DMG',
    energyRegen: 'Energy Regen',
    healingBonus: 'Healing Bonus',
    tuneBreakBoost: 'Tune Break Boost',
    dmgVuln: 'DMG Vulnerability',
    aero: 'Aero DMG',
    glacio: 'Glacio DMG',
    spectro: 'Spectro DMG',
    fusion: 'Fusion DMG',
    electro: 'Electro DMG',
    havoc: 'Havoc DMG',
    basicAtk: 'Basic ATK',
    heavyAtk: 'Heavy ATK',
    resonanceSkill: 'Res. Skill',
    resonanceLiberation: 'Res. Liberation',
  }

  return labels[key] ?? toTitle(key)
}

// keys that should be rendered as percentages instead of flat values
const PRCNSTATKEYS = new Set([
  'critRate', 'critDmg', 'energyRegen', 'healingBonus', 'dmgVuln',
  'aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc',
  'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation',
])

// format a raw stat value by key
export function fmtStatKeyVl(key: string, value: number): string {
  if (key === 'tuneBreakBoost') {
    return fmtNum(value)
  }

  if (PRCNSTATKEYS.has(key) || key.endsWith('Percent')) {
    return `${value.toFixed(1)}%`
  }

  return Math.floor(value).toLocaleString()
}

// build the three overview stat sections shown in summary panels:
// 1. main stats
// 2. secondary stats
// 3. damage modifier stats
export function mkVrvwSttsVi(runtime: ResRuntime, finalStats: FinalStats): VrvwSttsView {
  const seed = seedRsntById[runtime.id]
  const baseStats = seed ? resResBaseSt(seed, runtime.base.level) : undefined
  const traceNodes = runtime.base.traceNodes

  // resolve weapon secondary stat contribution so base values reflect weapon stats too
  let wpnStatKey: string | null = null
  let wpnStatVl = 0
  const weaponId = runtime.build.weapon.id
  if (!isNoWeaponId(weaponId)) {
    const weaponDef = getWpnById(weaponId)
    if (weaponDef) {
      wpnStatKey = weaponDef.statKey
      wpnStatVl = weaponDef.statsByLevel[runtime.build.weapon.level]?.secondaryStatValue ?? weaponDef.statValue
    }
  }

  // helper to conditionally expose the equipped weapon's secondary stat
  function weaponBonus(statKey: string): number {
    return wpnStatKey === statKey ? wpnStatVl : 0
  }

  // flat core stats are shown as base + bonus = total
  const mainStats: VrvwStatRow[] = [
    {
      label: 'ATK',
      base: finalStats.atk.base,
      total: finalStats.atk.final,
      bonus: finalStats.atk.final - finalStats.atk.base,
    },
    {
      label: 'HP',
      base: finalStats.hp.base,
      total: finalStats.hp.final,
      bonus: finalStats.hp.final - finalStats.hp.base,
    },
    {
      label: 'DEF',
      base: finalStats.def.base,
      total: finalStats.def.final,
      bonus: finalStats.def.final - finalStats.def.base,
    },
  ]

  // base values for percent-like stats come from character base, trace nodes, and weapon secondaries
  const baseCritRate = (baseStats?.critRate ?? 5) + (traceNodes.critRate ?? 0) + weaponBonus('critRate')
  const baseCritDmg = (baseStats?.critDmg ?? 150) + (traceNodes.critDmg ?? 0) + weaponBonus('critDmg')
  const baseNrgyRgn = (baseStats?.energyRegen ?? 100) + weaponBonus('energyRegen')
  const baseHlngBns = (baseStats?.healingBonus ?? 0) + (traceNodes.healingBonus ?? 0) + weaponBonus('healingBonus')
  const baseTuneBreakBoost = (baseStats?.tuneBreakBoost ?? 0) + weaponBonus('tuneBreakBoost')

  const secondaryStats: VrvwStatRow[] = [
    {
      label: 'Energy Regen',
      base: baseNrgyRgn,
      total: finalStats.energyRegen,
      bonus: finalStats.energyRegen - baseNrgyRgn,
    },
    {
      label: 'Crit Rate',
      base: baseCritRate,
      total: finalStats.critRate,
      bonus: finalStats.critRate - baseCritRate,
    },
    {
      label: 'Crit DMG',
      base: baseCritDmg,
      total: finalStats.critDmg,
      bonus: finalStats.critDmg - baseCritDmg,
    },
    {
      label: 'Healing Bonus',
      base: baseHlngBns,
      total: finalStats.healingBonus,
      bonus: finalStats.healingBonus - baseHlngBns,
    },
    {
      label: 'Tune Break Boost',
      base: baseTuneBreakBoost,
      total: finalStats.tbb,
      bonus: finalStats.tbb - baseTuneBreakBoost,
    },
  ]

  // element damage bonus rows include both element-specific and universal attribute dmg bonus
  const dmgModStts: VrvwStatRow[] = (
      ['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc'] as AttributeKey[]
  ).map((element) => {
    const base = traceNodes.attribute[element]?.dmgBonus ?? 0
    const total = finalStats.attribute[element].dmgBonus + finalStats.attribute.all.dmgBonus

    return {
      label: `${element.charAt(0).toUpperCase() + element.slice(1)} DMG Bonus`,
      base,
      total,
      bonus: total - base,
      color: ATTR_COLORS[element],
    }
  })

  // skill-type damage bonus rows also include the shared universal skillType.all bucket
  dmgModStts.push(
      {
        label: 'Basic Attack DMG Bonus',
        base: 0,
        total: finalStats.skillType.basicAtk.dmgBonus + finalStats.skillType.all.dmgBonus,
        bonus: finalStats.skillType.basicAtk.dmgBonus + finalStats.skillType.all.dmgBonus,
      },
      {
        label: 'Heavy Attack DMG Bonus',
        base: 0,
        total: finalStats.skillType.heavyAtk.dmgBonus + finalStats.skillType.all.dmgBonus,
        bonus: finalStats.skillType.heavyAtk.dmgBonus + finalStats.skillType.all.dmgBonus,
      },
      {
        label: 'Resonance Skill DMG Bonus',
        base: 0,
        total: finalStats.skillType.resonanceSkill.dmgBonus + finalStats.skillType.all.dmgBonus,
        bonus: finalStats.skillType.resonanceSkill.dmgBonus + finalStats.skillType.all.dmgBonus,
      },
      {
        label: 'Resonance Liberation DMG Bonus',
        base: 0,
        total: finalStats.skillType.resonanceLiberation.dmgBonus + finalStats.skillType.all.dmgBonus,
        bonus: finalStats.skillType.resonanceLiberation.dmgBonus + finalStats.skillType.all.dmgBonus,
      },
  )

  return {
    mainStats,
    secondaryStats: secondaryStats,
    dmgMdfrStts: dmgModStts,
  }
}

export interface SttsTreeLeaf {
  kind: 'leaf'
  key: string
  label: string
  value: number
  displayValue: string
  color?: string
  baseValue?: string
  diffValue?: string
  diffSign?: 'positive' | 'negative'
}

export interface SttsTreeBrnc {
  kind: 'branch'
  key: string
  label: string
  color?: string
  flow?: 'grid' | 'fixed-grid'
  children: SttsTreeNode[]
}

export type SttsTreeNode = SttsTreeLeaf | SttsTreeBrnc

// user-facing labels for modifier keys inside mod buff buckets
const MOD_LABELS: Record<keyof ModBuff, string> = {
  resShred: 'RES Shred',
  dmgBonus: 'DMG Bonus',
  amplify: 'Amplify',
  defIgnore: 'DEF Ignore',
  defShred: 'DEF Shred',
  dmgVuln: 'Vulnerability',
  critRate: 'Crit Rate',
  critDmg: 'Crit DMG',
}

const MOD_KEYS = Object.keys(MOD_LABELS) as (keyof ModBuff)[]

// ordered attribute buckets for the full stats tree
const ATTR_KEYS: ('all' | AttributeKey)[] = [
  'all', 'aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc', 'physical',
]

const TTRB_LBLS: Record<'all' | AttributeKey, string> = {
  all: 'Universal',
  aero: 'Aero',
  glacio: 'Glacio',
  spectro: 'Spectro',
  fusion: 'Fusion',
  electro: 'Electro',
  havoc: 'Havoc',
  physical: 'Physical',
}

// ordered skill-type buckets for the full stats tree
const SKLLTYPEKEYS: SkillTypeKey[] = [
  'all', 'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation',
  'introSkill', 'outroSkill', 'echoSkill', 'coord',
  'spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare',
  'healing', 'shield', 'tuneRupture', 'hack',
]

// compact number formatter that removes trailing zeroes from decimals
function fmtNum(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

// flat integer display formatter
function fmtFlat(value: number): string {
  return Math.floor(value).toLocaleString()
}

// percent display formatter
function fmtPct(value: number): string {
  return `${fmtNum(value)}%`
}

// signed display formatter used for mod values and diffs
function fmtSigned(value: number, suffix: string): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${fmtNum(value)}${suffix}`
}

export { fmtSigned as formatSignedMod }

// convert a ModBuff object into leaf rows, skipping zero values
function mkModKids(buff: ModBuff): SttsTreeLeaf[] {
  const leaves: SttsTreeLeaf[] = []
  for (const key of MOD_KEYS) {
    const value = buff[key]
    if (value === 0) continue
    leaves.push({
      kind: 'leaf',
      key,
      label: MOD_LABELS[key],
      value,
      displayValue: fmtSigned(value, '%'),
    })
  }
  return leaves
}

// build a core base-stat row with base/final/diff metadata
function makeBaseStat(key: string, label: string, stat: { base: number; final: number }): SttsTreeLeaf {
  const diff = Math.floor(stat.final) - Math.floor(stat.base)
  return {
    kind: 'leaf',
    key,
    label,
    value: stat.final,
    displayValue: fmtFlat(stat.final),
    baseValue: fmtFlat(stat.base),
    diffValue: diff !== 0 ? `${diff > 0 ? '+' : ''}${fmtFlat(diff)}` : undefined,
    diffSign: diff > 0 ? 'positive' : diff < 0 ? 'negative' : undefined,
  }
}

// build the nested full stats tree used by detailed overview panes
export function mkSttsTree(finalStats: FinalStats): SttsTreeNode[] {
  const root: SttsTreeNode[] = []

  // base stats shown as base -> final with diff indicators
  root.push({
    kind: 'branch',
    key: 'baseStats',
    label: 'Base Stats',
    flow: 'fixed-grid',
    children: [
      makeBaseStat('atk', 'ATK', finalStats.atk),
      makeBaseStat('hp', 'HP', finalStats.hp),
      makeBaseStat('def', 'DEF', finalStats.def),
    ],
  })

  // scalar combat stats that are not nested under attribute/skill-type buckets
  root.push({
    kind: 'branch',
    key: 'combat',
    label: 'Combat',
    flow: 'grid',
    children: [
      { kind: 'leaf', key: 'critRate', label: 'Crit. Rate', value: finalStats.critRate, displayValue: fmtPct(finalStats.critRate) },
      { kind: 'leaf', key: 'critDmg', label: 'Crit. DMG', value: finalStats.critDmg, displayValue: fmtPct(finalStats.critDmg) },
      { kind: 'leaf', key: 'energyRegen', label: 'Energy Regen', value: finalStats.energyRegen, displayValue: fmtPct(finalStats.energyRegen) },
      { kind: 'leaf', key: 'healingBonus', label: 'Healing Bonus', value: finalStats.healingBonus, displayValue: fmtPct(finalStats.healingBonus) },
      { kind: 'leaf', key: 'flatDmg', label: 'Flat DMG', value: finalStats.flatDmg, displayValue: fmtFlat(finalStats.flatDmg) },
      { kind: 'leaf', key: 'dmgBonus', label: 'DMG Bonus', value: finalStats.dmgBonus, displayValue: fmtPct(finalStats.dmgBonus) },
      { kind: 'leaf', key: 'amplify', label: 'Amplify', value: finalStats.amplify, displayValue: fmtPct(finalStats.amplify) },
      { kind: 'leaf', key: 'defIgnore', label: 'DEF Ignore', value: finalStats.defIgnore, displayValue: fmtPct(finalStats.defIgnore) },
      { kind: 'leaf', key: 'defShred', label: 'DEF Shred', value: finalStats.defShred, displayValue: fmtPct(finalStats.defShred) },
      { kind: 'leaf', key: 'dmgVuln', label: 'DMG Vulnerability', value: finalStats.dmgVuln, displayValue: fmtPct(finalStats.dmgVuln) },
      { kind: 'leaf', key: 'shieldBonus', label: 'Shield Bonus', value: finalStats.shieldBonus, displayValue: fmtPct(finalStats.shieldBonus) },
      { kind: 'leaf', key: 'tuneBreakBoost', label: 'Tune Break Boost', value: finalStats.tbb, displayValue: fmtNum(finalStats.tbb) },
      { kind: 'leaf', key: 'special', label: 'Special', value: finalStats.special, displayValue: fmtPct(finalStats.special) },
    ],
  })

  // attribute modifier branches, one branch per attribute that has non-zero mods
  const ttrbKids: SttsTreeNode[] = []
  for (const key of ATTR_KEYS) {
    const mods = mkModKids(finalStats.attribute[key])
    if (mods.length === 0) continue
    ttrbKids.push({
      kind: 'branch',
      key,
      label: TTRB_LBLS[key],
      color: key !== 'all' ? ATTR_COLORS[key] : undefined,
      children: mods,
    })
  }
  if (ttrbKids.length > 0) {
    root.push({
      kind: 'branch',
      key: 'attribute',
      label: 'Attribute',
      flow: 'grid',
      children: ttrbKids,
    })
  }

  // skill-type modifier branches, again skipping empty buckets
  const skllTypeKids: SttsTreeNode[] = []
  for (const key of SKLLTYPEKEYS) {
    const mods = mkModKids(finalStats.skillType[key])
    if (mods.length === 0) continue
    skllTypeKids.push({
      kind: 'branch',
      key,
      label: getSkillType(key).label,
      children: mods,
    })
  }
  if (skllTypeKids.length > 0) {
    root.push({
      kind: 'branch',
      key: 'skillType',
      label: 'Skill Type',
      flow: 'grid',
      children: skllTypeKids,
    })
  }

  return root
}
