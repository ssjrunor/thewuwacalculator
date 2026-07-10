/*
  Author: Runor Ewhro
  Description: Shared benchmark stat math, roll budgets, and encoded stat summaries.
*/
import type { EchoInstance } from '@/domain/entities/runtime';
import type { AttributeKey, FinalStats, ModBuff, SkillTypeKey } from '@/domain/entities/stats';
import { SUBSTAT_KEYS, getSbstStepP, ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats';
import type { EchoDef } from '@/domain/entities/catalog';
import { ECHO_STAT_STRIDE, MAIN_BUFF_LEN, SET_SLOT_COUNT } from '@/engine/optimizer/config/constants';
import { addEchoStat } from '@/engine/optimizer/encode/echoes';
import { applySetVec as applySetBonuses } from '@/engine/optimizer/encode/sets';
import type { SuggestContext } from '@/engine/suggestions/types';
import type { SetPlanEntry } from '@/engine/suggestions/types';
import { ATTR_COLORS } from '@/modules/calculator/model/display.ts';
import { getSkillType } from '@/modules/calculator/model/skillTypes.ts';
import { truncTo } from '@/shared/lib/number.ts';
import type { BenchmarkOverviewStatRow, BenchmarkOverviewStats, BenchmarkStatTreeLeaf, BenchmarkStatTreeNode, BenchmarkSubstatEntry, BuildBenchmark } from './types.ts';
import {
  aggregateSubstats,
  ENERGY_REGEN,
  MAX_SUBSTAT_SLOTS_PER_KEY,
} from '@/data/scoring/substatMath';



export const WUWA_SUBSTAT_LINES = 25
export const REFERENCE_MAX_ROLLS = 54
export const REFERENCE_BENCHMARK_ROLLS = 48
export const REFERENCE_FREE_ROLL_STATS = 11
export const REFERENCE_MAX_PER_SUB = 36
export const MAX_ROLLS_PER_KEY = MAX_SUBSTAT_SLOTS_PER_KEY
export { ENERGY_REGEN }
export const BENCHMARK_FEATURE_TAB_LABELS: Record<string, string> = {
  combo: 'Combo',
  normalAttack: 'Normal Attack',
  resonanceSkill: 'Resonance Skill',
  forteCircuit: 'Forte Circuit',
  resonanceLiberation: 'Resonance Liberation',
  introSkill: 'Intro Skill',
  outroSkill: 'Outro Skill',
  tuneBreak: 'Tune Break',
  echoAttacks: 'Echo Attacks',
  negativeEffect: 'Negative Effects',
  feature: 'Feature',
}
export const BENCHMARK_STAT_KEYS = [
  'atkPercent',
  'atkFlat',
  'hpPercent',
  'hpFlat',
  'defPercent',
  'defFlat',
  'critRate',
  'critDmg',
  'energyRegen',
  'healingBonus',
  'basicAtk',
  'heavyAtk',
  'resonanceSkill',
  'resonanceLiberation',
  'aero',
  'spectro',
  'fusion',
  'glacio',
  'havoc',
  'electro',
]

export interface BenchmarkScoringParams {
  quality: number
  substatGoal: number
  freeRolls: number
  maxPerSub: number
  deductionPerMain: number
  baselineFreeRolls: number
  diminishRolls: boolean
}

export interface MainStatCandidate {
  frame: BenchmarkEchoFrame
  stats: Float32Array
  primaryStats: Array<{ key: string; value: number }>
  mainCounts: Record<string, number>
}

export interface BenchmarkEchoFrame {
  echoes: EchoInstance[]
  setPlan: SetPlanEntry[]
  stats: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  comboIds: Int32Array
  mainEchoBuffs: Float32Array
  mainIndex: number
  score: (buffer: Float32Array, setRows?: Uint8Array) => number
}

export interface SubstatCandidate {
  damage: number
  counts: Record<string, number>
  main: MainStatCandidate
  stats: Float32Array
}

export interface MainEchoProfile {
  def: EchoDef
  buffs: Float32Array
  effectSig: string
  relevant: boolean
}

export interface MainEchoChoice {
  echo: EchoInstance
  effectSig: string
}

export interface MainStatSourceSummary {
  primaryTotals: Record<string, number>
  secondaryTotals: Record<string, number>
  totalByKey: Record<string, number>
  primarySlots: Record<string, number[]>
  secondarySlots: Record<string, number[]>
}

export const BENCHMARK_ROLL_SOURCE = {
  quality: 0.8,
  substatGoal: REFERENCE_BENCHMARK_ROLLS,
  freeRolls: 2,
  maxPerSub: 30,
  deductionPerMain: 0,
  baselineFreeRolls: 2,
  diminishRolls: true,
}

export const MAXIMUM_ROLL_SOURCE = {
  quality: 1,
  substatGoal: REFERENCE_MAX_ROLLS,
  freeRolls: 0,
  maxPerSub: 36,
  deductionPerMain: 0,
  baselineFreeRolls: 0,
  diminishRolls: false,
}

export const GRADE_LADDER: ReadonlyArray<readonly [number, string]> = [
  [150, 'SOLON?!'], [140, 'SON?!'], [130, 'SSS+'], [120, 'SSS'], [110, 'SS'],
  [105, 'S'], [100, 'A+'], [95, 'A'], [90, 'A-'], [85, 'B+'],
  [80, 'B'], [75, 'C+'], [70, 'C'], [65, 'C-'], [60, 'D'],
  [55, 'E'], [50, 'F'], [45, 'cute'], [40, 'son..'],
]

export function gradeForPercent(percentX100: number): string {
  for (const [threshold, grade] of GRADE_LADDER) {
    if (percentX100 >= threshold) {
      return grade
    }
  }
  return '🥀'
}

// piecewise-linear normalization: baseline -> 0, benchmark -> 1, perfection -> 2.
export function scorePercent(score: number, baseline: number, benchmark: number, perfection: number): number {
  const ceiling = Math.max(perfection, benchmark)
  let percent = 0
  if (score >= benchmark) {
    const range = ceiling - benchmark
    percent = range > 0 ? 1 + (score - benchmark) / range : 1
  } else {
    const range = benchmark - baseline
    percent = range > 0 ? (score - baseline) / range : 0
  }
  return Math.max(0, percent)
}

export function scorePercentX100(score: number, benchmark: BuildBenchmark): number {
  return scorePercent(score, benchmark.baselineDamage, benchmark.benchmarkDamage, benchmark.perfectionDamage) * 100
}

// Quality scales a max-upgraded substat roll toward the low / mid / high range.
export function rollAtQuality(steps: number[], quality: number): number {
  if (steps.length === 0) {
    return 0
  }
  const min = steps[0]
  const max = steps[steps.length - 1]
  const clampedQuality = Math.max(0, Math.min(1, quality))
  return Math.max(min, max * clampedQuality)
}

export function normalizeRollParams(
  source: typeof BENCHMARK_ROLL_SOURCE,
  substatCount: number,
): BenchmarkScoringParams {
  const substatGoal = WUWA_SUBSTAT_LINES * (source.substatGoal / REFERENCE_MAX_ROLLS)
  const freeBudgetRatio = source.substatGoal > 0
    ? (source.freeRolls * REFERENCE_FREE_ROLL_STATS) / source.substatGoal
    : 0
  return {
    quality: source.quality,
    substatGoal,
    freeRolls: substatCount > 0 ? (substatGoal * freeBudgetRatio) / substatCount : 0,
    maxPerSub: MAX_ROLLS_PER_KEY * (source.maxPerSub / REFERENCE_MAX_PER_SUB),
    deductionPerMain: MAX_ROLLS_PER_KEY * (source.deductionPerMain / REFERENCE_MAX_PER_SUB),
    baselineFreeRolls: MAX_ROLLS_PER_KEY * (source.baselineFreeRolls / REFERENCE_MAX_PER_SUB),
    diminishRolls: source.diminishRolls,
  }
}

export function createDiminishingReturnsFormula(
  baseLowerLimit: number,
  penaltyPerMain: number,
  exponent: number,
) {
  return (mainsCount: number, rolls: number) => {
    const lowerLimit = baseLowerLimit - (penaltyPerMain * mainsCount)
    if (rolls <= lowerLimit) {
      return rolls
    }

    const excess = Math.max(0, rolls - lowerLimit)
    return lowerLimit + (excess / Math.pow(excess, exponent))
  }
}

export const DIMINISHING_STAT_ROLLS = createDiminishingReturnsFormula(
  MAX_ROLLS_PER_KEY * (12 / REFERENCE_MAX_PER_SUB),
  MAX_ROLLS_PER_KEY * (2 / REFERENCE_MAX_PER_SUB),
  0.25,
)

export function effectiveRollCount(
  rawCount: number,
  params: BenchmarkScoringParams,
): number {
  if (!params.diminishRolls) {
    return rawCount
  }
  return DIMINISHING_STAT_ROLLS(0, rawCount)
}

export function addStatTotal(buffer: Float32Array, key: string, value: number): void {
  addEchoStat(buffer.subarray(0, ECHO_STAT_STRIDE), key, value)
}

export function skillMaskForTypes(types: readonly SkillTypeKey[]): number {
  let mask = 0
  for (const type of types) {
    if (type === 'basicAtk') mask |= 1 << 0
    if (type === 'heavyAtk') mask |= 1 << 1
    if (type === 'resonanceSkill') mask |= 1 << 2
    if (type === 'resonanceLiberation') mask |= 1 << 3
    if (type === 'echoSkill') mask |= 1 << 6
    if (type === 'coord') mask |= 1 << 7
  }
  return mask
}

export function countOneBits(value: number): number {
  let bits = value >>> 0
  bits = bits - ((bits >>> 1) & 0x55555555)
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333)
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export function makeSetCounts(setRows: Uint8Array, kinds: Uint16Array, comboIds: Int32Array): Uint8Array {
  const setCounts = new Uint8Array(SET_SLOT_COUNT)
  const setMasks = new Uint32Array(SET_SLOT_COUNT)

  for (let index = 0; index < comboIds.length; index += 1) {
    const echoIndex = comboIds[index]
    const setId = setRows[echoIndex]
    if (setId < 0 || setId >= SET_SLOT_COUNT) {
      continue
    }
    setMasks[setId] |= (1 << (kinds[echoIndex] & 31)) >>> 0
  }

  for (let setId = 0; setId < SET_SLOT_COUNT; setId += 1) {
    setCounts[setId] = countOneBits(setMasks[setId])
  }

  return setCounts
}

export function sumEncodedStats(stats: Float32Array, comboIds: Int32Array) {
  const totals = {
    atkP: 0,
    atkF: 0,
    hpP: 0,
    hpF: 0,
    defP: 0,
    defF: 0,
    critRate: 0,
    critDmg: 0,
    er: 0,
    healingBonus: 0,
    basic: 0,
    heavy: 0,
    skill: 0,
    lib: 0,
    aero: 0,
    spectro: 0,
    fusion: 0,
    glacio: 0,
    havoc: 0,
    electro: 0,
  }

  for (let index = 0; index < comboIds.length; index += 1) {
    const base = comboIds[index] * ECHO_STAT_STRIDE
    totals.atkP += stats[base]
    totals.atkF += stats[base + 1]
    totals.hpP += stats[base + 2]
    totals.hpF += stats[base + 3]
    totals.defP += stats[base + 4]
    totals.defF += stats[base + 5]
    totals.critRate += stats[base + 6]
    totals.critDmg += stats[base + 7]
    totals.er += stats[base + 8]
    totals.healingBonus += stats[base + 9]
    totals.basic += stats[base + 10]
    totals.heavy += stats[base + 11]
    totals.skill += stats[base + 12]
    totals.lib += stats[base + 13]
    totals.aero += stats[base + 14]
    totals.spectro += stats[base + 15]
    totals.fusion += stats[base + 16]
    totals.glacio += stats[base + 17]
    totals.havoc += stats[base + 18]
    totals.electro += stats[base + 19]
  }

  return totals
}

export function sumEncodedEnergyRegen(stats: Float32Array, comboIds: Int32Array): number {
  let er = 0
  for (let index = 0; index < comboIds.length; index += 1) {
    er += stats[(comboIds[index] * ECHO_STAT_STRIDE) + 8] ?? 0
  }
  return er
}

export function makeOverviewRow(
  key: string,
  label: string,
  base: number,
  total: number,
  color?: string,
): BenchmarkOverviewStatRow {
  return {
    key,
    label,
    base,
    total,
    bonus: total - base,
    color,
  }
}

export function makeBenchmarkOverviewStats({
  ctx,
  stats,
  setRows,
  kinds,
  comboIds,
  mainEchoBuffs,
  mainIndex,
}: {
  ctx: SuggestContext
  stats: Float32Array
  setRows: Uint8Array
  kinds: Uint16Array
  comboIds: Int32Array
  mainEchoBuffs: Float32Array
  mainIndex: number
}): BenchmarkOverviewStats {
  const source = ctx.sourceFinals
  const echoStats = sumEncodedStats(stats, comboIds)
  const setCounts = makeSetCounts(setRows, kinds, comboIds)
  const setBonus = applySetBonuses(
    setCounts,
    skillMaskForTypes(ctx.selectedSkill.skillType),
    ctx.setConstLut,
    ctx.setRtMask,
  )
  const mainBase = Math.max(0, mainIndex) * MAIN_BUFF_LEN
  const mainAt = (offset: number) => mainEchoBuffs[mainBase + offset] ?? 0

  const atkBonus = source.atk.base * ((echoStats.atkP + setBonus.atkP + mainAt(0)) / 100) + echoStats.atkF + setBonus.atkF + mainAt(1)
  const hpBonus = source.hp.base * ((echoStats.hpP + setBonus.hpP) / 100) + echoStats.hpF + setBonus.hpF
  const defBonus = source.def.base * ((echoStats.defP + setBonus.defP) / 100) + echoStats.defF + setBonus.defF
  const energyRegen = source.energyRegen + echoStats.er + setBonus.er + setBonus.erSetBonus + mainAt(12)
  const critRate = source.critRate + echoStats.critRate + setBonus.critRate + mainAt(15)
  const critDmg = source.critDmg + echoStats.critDmg + setBonus.critDmg + mainAt(16)
  const allAttrBonus = source.attribute.all.dmgBonus + setBonus.bonusBase + mainAt(17)
  const allSkillBonus = source.skillType.all.dmgBonus

  const elementRows: Array<{ key: AttributeKey; label: string; value: number }> = [
    { key: 'aero', label: 'Aero DMG Bonus', value: echoStats.aero + setBonus.aero + mainAt(6) },
    { key: 'glacio', label: 'Glacio DMG Bonus', value: echoStats.glacio + setBonus.glacio + mainAt(7) },
    { key: 'spectro', label: 'Spectro DMG Bonus', value: echoStats.spectro + setBonus.spectro + mainAt(9) },
    { key: 'fusion', label: 'Fusion DMG Bonus', value: echoStats.fusion + setBonus.fusion + mainAt(8) },
    { key: 'electro', label: 'Electro DMG Bonus', value: echoStats.electro + setBonus.electro + mainAt(11) },
    { key: 'havoc', label: 'Havoc DMG Bonus', value: echoStats.havoc + setBonus.havoc + mainAt(10) },
  ]

  return {
    mainStats: [
      makeOverviewRow('atk', 'ATK', source.atk.base, source.atk.final + atkBonus),
      makeOverviewRow('hp', 'HP', source.hp.base, source.hp.final + hpBonus),
      makeOverviewRow('def', 'DEF', source.def.base, source.def.final + defBonus),
    ],
    secondaryStats: [
      makeOverviewRow('energyRegen', 'Energy Regen', source.energyRegen, energyRegen),
      makeOverviewRow('critRate', 'Crit Rate', source.critRate, critRate),
      makeOverviewRow('critDmg', 'Crit DMG', source.critDmg, critDmg),
      makeOverviewRow('healingBonus', 'Healing Bonus', source.healingBonus, source.healingBonus + echoStats.healingBonus),
      makeOverviewRow('tuneBreakBoost', 'Tune Break Boost', source.tbb, source.tbb),
    ],
    dmgMdfrStts: [
      ...elementRows.map((row) => makeOverviewRow(
        row.key,
        row.label,
        source.attribute[row.key].dmgBonus,
        source.attribute[row.key].dmgBonus + allAttrBonus + row.value,
        ATTR_COLORS[row.key],
      )),
      makeOverviewRow('basicAtk', 'Basic Attack DMG Bonus', 0, source.skillType.basicAtk.dmgBonus + allSkillBonus + echoStats.basic + setBonus.basic + mainAt(2)),
      makeOverviewRow('heavyAtk', 'Heavy Attack DMG Bonus', 0, source.skillType.heavyAtk.dmgBonus + allSkillBonus + echoStats.heavy + setBonus.heavy + mainAt(3)),
      makeOverviewRow('resonanceSkill', 'Resonance Skill DMG Bonus', 0, source.skillType.resonanceSkill.dmgBonus + allSkillBonus + echoStats.skill + setBonus.skill + mainAt(4)),
      makeOverviewRow('resonanceLiberation', 'Resonance Liberation DMG Bonus', 0, source.skillType.resonanceLiberation.dmgBonus + allSkillBonus + echoStats.lib + setBonus.lib + mainAt(5)),
    ],
  }
}

const INVARIANT_MOD_LABELS: Record<keyof ModBuff, string> = {
  resShred: 'RES Shred',
  dmgBonus: 'DMG Bonus',
  amplify: 'Amplify',
  defIgnore: 'DEF Ignore',
  defShred: 'DEF Shred',
  dmgVuln: 'Vulnerability',
  critRate: 'Crit Rate',
  critDmg: 'Crit DMG',
}

const INVARIANT_MOD_KEYS = Object.keys(INVARIANT_MOD_LABELS) as (keyof ModBuff)[]
const INVARIANT_ATTR_KEYS: ('all' | AttributeKey)[] = ['all', 'aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc', 'physical']
const INVARIANT_ATTR_LABELS: Record<'all' | AttributeKey, string> = {
  all: 'Universal',
  aero: 'Aero',
  glacio: 'Glacio',
  spectro: 'Spectro',
  fusion: 'Fusion',
  electro: 'Electro',
  havoc: 'Havoc',
  physical: 'Physical',
}
const INVARIANT_SKILL_TYPES: SkillTypeKey[] = [
  'all', 'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation',
  'introSkill', 'outroSkill', 'echoSkill', 'coord',
  'spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare',
  'healing', 'shield', 'tuneRupture', 'hack',
]
const TABLE_SKILL_DMG_TYPES = new Set<SkillTypeKey>([
  'basicAtk',
  'heavyAtk',
  'resonanceSkill',
  'resonanceLiberation',
])

function fmtInvariantNum(value: number): string {
  const truncated = truncTo(value, 2)
  return Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(2).replace(/\.?0+$/, '')
}

function fmtInvariantFlat(value: number): string {
  return Math.floor(value).toLocaleString()
}

function fmtInvariantPct(value: number): string {
  return `${fmtInvariantNum(value)}%`
}

function fmtInvariantSigned(value: number, suffix: string): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${fmtInvariantNum(value)}${suffix}`
}

function invariantLeaf(key: string, label: string, value: number, displayValue: string, color?: string): BenchmarkStatTreeLeaf | null {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0001) return null
  return {
    kind: 'leaf',
    key,
    label,
    value,
    displayValue,
    color,
  }
}

function invariantModLeaves(buff: ModBuff, opts?: { omitDmgBonus?: boolean }): BenchmarkStatTreeLeaf[] {
  const leaves: BenchmarkStatTreeLeaf[] = []
  for (const key of INVARIANT_MOD_KEYS) {
    if (opts?.omitDmgBonus && key === 'dmgBonus') continue
    const value = buff[key]
    const leaf = invariantLeaf(key, INVARIANT_MOD_LABELS[key], value, fmtInvariantSigned(value, '%'))
    if (leaf) leaves.push(leaf)
  }
  return leaves
}

export function makeBenchmarkInvariantStats(finalStats: FinalStats): BenchmarkStatTreeNode[] {
  const root: BenchmarkStatTreeNode[] = []
  const combatChildren = [
    invariantLeaf('flatDmg', 'Flat DMG', finalStats.flatDmg, fmtInvariantFlat(finalStats.flatDmg)),
    invariantLeaf('dmgBonus', 'DMG Bonus', finalStats.dmgBonus, fmtInvariantPct(finalStats.dmgBonus)),
    invariantLeaf('amplify', 'Amplify', finalStats.amplify, fmtInvariantPct(finalStats.amplify)),
    invariantLeaf('defIgnore', 'DEF Ignore', finalStats.defIgnore, fmtInvariantPct(finalStats.defIgnore)),
    invariantLeaf('defShred', 'DEF Shred', finalStats.defShred, fmtInvariantPct(finalStats.defShred)),
    invariantLeaf('dmgVuln', 'DMG Vulnerability', finalStats.dmgVuln, fmtInvariantPct(finalStats.dmgVuln)),
    invariantLeaf('shieldBonus', 'Shield Bonus', finalStats.shieldBonus, fmtInvariantPct(finalStats.shieldBonus)),
    invariantLeaf('special', 'Special', finalStats.special, fmtInvariantPct(finalStats.special)),
  ].filter((row): row is BenchmarkStatTreeLeaf => row != null)
  if (combatChildren.length > 0) {
    root.push({
      kind: 'branch',
      key: 'combat',
      label: 'Combat',
      flow: 'grid',
      children: combatChildren,
    })
  }

  const attrChildren: BenchmarkStatTreeNode[] = []
  for (const key of INVARIANT_ATTR_KEYS) {
    const leaves = invariantModLeaves(finalStats.attribute[key], { omitDmgBonus: true })
    if (leaves.length === 0) continue
    attrChildren.push({
      kind: 'branch',
      key,
      label: INVARIANT_ATTR_LABELS[key],
      color: key !== 'all' ? ATTR_COLORS[key] : undefined,
      children: leaves,
    })
  }
  if (attrChildren.length > 0) {
    root.push({
      kind: 'branch',
      key: 'attribute',
      label: 'Attribute',
      flow: 'grid',
      children: attrChildren,
    })
  }

  const skillTypeChildren: BenchmarkStatTreeNode[] = []
  for (const key of INVARIANT_SKILL_TYPES) {
    const leaves = invariantModLeaves(finalStats.skillType[key], { omitDmgBonus: TABLE_SKILL_DMG_TYPES.has(key) })
    if (leaves.length === 0) continue
    skillTypeChildren.push({
      kind: 'branch',
      key,
      label: getSkillType(key).label,
      children: leaves,
    })
  }
  if (skillTypeChildren.length > 0) {
    root.push({
      kind: 'branch',
      key: 'skillType',
      label: 'Skill Type',
      flow: 'grid',
      children: skillTypeChildren,
    })
  }

  return root
}

export function formatFeatureTabLabel(tab: string): string {
  return BENCHMARK_FEATURE_TAB_LABELS[tab] ?? tab
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim()
}

export function removeSubstatTotals(buffer: Float32Array, totals: Record<string, number>): void {
  for (const [key, value] of Object.entries(totals)) {
    addStatTotal(buffer, key, -value)
  }
}

export function equivalentRollCounts(totals: Record<string, number>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const key of SUBSTAT_KEYS) {
    const steps = getSbstStepP(key)
    const max = steps.length ? steps[steps.length - 1] : 0
    const total = totals[key] ?? 0
    counts[key] = max > 0 && total > 0
      ? Math.min(MAX_ROLLS_PER_KEY, total / max)
      : 0
  }
  return counts
}

export function sumSubstats(echoes: EchoInstance[]): Record<string, number> {
  return aggregateSubstats(echoes).totals
}

export function addRecordTotal(record: Record<string, number>, key: string, value: number): void {
  record[key] = (record[key] ?? 0) + value
}

export function addRecordSlot(record: Record<string, number[]>, key: string, slot: number): void {
  record[key] = [...(record[key] ?? []), slot]
}

export function collectMainStatSources(
  echoes: EchoInstance[],
  primaryStats: Array<{ key: string; value: number }>,
): MainStatSourceSummary {
  const primaryTotals: Record<string, number> = {}
  const secondaryTotals: Record<string, number> = {}
  const totalByKey: Record<string, number> = {}
  const primarySlots: Record<string, number[]> = {}
  const secondarySlots: Record<string, number[]> = {}

  echoes.forEach((echo, index) => {
    const slot = index + 1
    const primary = primaryStats[index] ?? echo.mainStats.primary
    addRecordTotal(primaryTotals, primary.key, primary.value)
    addRecordTotal(totalByKey, primary.key, primary.value)
    addRecordSlot(primarySlots, primary.key, slot)

    const secondary = echo.mainStats.secondary
    addRecordTotal(secondaryTotals, secondary.key, secondary.value)
    addRecordTotal(totalByKey, secondary.key, secondary.value)
    addRecordSlot(secondarySlots, secondary.key, slot)
  })

  return {
    primaryTotals,
    secondaryTotals,
    totalByKey,
    primarySlots,
    secondarySlots,
  }
}

export function getBenchmarkStatKeys(
  mains: MainStatSourceSummary,
  substats: BenchmarkSubstatEntry[],
): string[] {
  const keys = new Set<string>([
    ...BENCHMARK_STAT_KEYS,
    ...SUBSTAT_KEYS,
    ...Object.keys(mains.totalByKey),
    ...substats.map((entry) => entry.key),
  ])

  for (const statsByCost of Object.values(ECHO_MAIN_STATS)) {
    for (const key of Object.keys(statsByCost)) {
      keys.add(key)
    }
  }
  for (const stat of Object.values(ECHO_SIDE_STATS)) {
    keys.add(stat.key)
  }

  return [...keys].sort()
}

export function makeSubstatPlan(
  counts: Record<string, number>,
  rollOf: (key: string) => number,
  params: BenchmarkScoringParams,
  fixedTotals: Record<string, number> = {},
): BenchmarkSubstatEntry[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => {
      const fixedTotal = fixedTotals[key]
      if (fixedTotal != null) {
        return {
          key,
          count,
          effectiveCount: count,
          rollValue: count > 0 ? fixedTotal / count : 0,
          total: fixedTotal,
        }
      }
      const roll = rollOf(key)
      const effectiveCount = effectiveRollCount(count, params)
      return {
        key,
        count,
        effectiveCount,
        rollValue: roll,
        total: effectiveCount * roll,
      }
    })
    .sort((left, right) => right.count - left.count || right.total - left.total)
}
