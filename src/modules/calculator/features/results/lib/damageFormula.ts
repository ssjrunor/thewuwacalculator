/*
  Author: Runor Ewhro
  Description: Provides shared damage formula helpers for the results surface.
*/

import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import { ATTR_ENEMY_RES, isNoEnemy } from '@/domain/entities/appState.ts'
import { getNegEffectDef } from '@/domain/gameData/negativeEffects.ts'
import type { CombatState } from '@/domain/entities/runtime.ts'
import type { FinalStats, ModBuff, NegEffectKey, SkillDef, SkillTypeKey } from '@/domain/entities/stats.ts'
import { getNegBase as cmptNegFfctB } from '@/engine/formulas/negativeEffects.ts'
import { getTuneLevel } from '@/engine/formulas/tuneRupture.ts'
import { mergeSkillType, makeModBuff } from '@/engine/resolvers/buffPool.ts'
import { getSkillType, fmtSkllTypeL } from '@/modules/calculator/model/skillTypes.ts'

type ShrdDmgCtx = {
  zeroed: boolean
  ignoresEnemy: boolean
  baseRes: number
  resShred: number
  enemyResVl: number
  resMult: number
  totalDefIgnore: number
  totalDefShred: number
  enemyDefBase: number
  enemyDefense: number
  defMult: number
  dmgBonusPrcn: number
  dmgBonusMult: number
  ampPrcn: number
  ampMult: number
  dmgVulnPct: number
  dmgVulnMult: number
  specPrcn: number
  specMult: number
  critRatePrcn: number
  critRate: number
  critDmgPrcn: number
  critDmg: number
  skillTypeLabel: string
  skillTypeAll: ModBuff
  skillTypeBuff: ModBuff
  attributeAll: ModBuff
  attrElem: ModBuff
  skillBuffs: ModBuff
}

export type DmgBreakdown = {
  title: string
  summary: string
  equation: string
  sections: Array<{
    label: string
    lines: string[]
  }>
}

export function fmtBreakdown(breakdown: DmgBreakdown): string {
  // the editor-style formula viewer expects plain text with comment headers, so the structured breakdown is flattened
  // into deterministic sections instead of rendered as nested jsx.
  return [
    `// ${breakdown.title}`,
    breakdown.equation,
    ...breakdown.summary.split('\n').filter(Boolean),
    ...breakdown.sections.flatMap((section) => [
      '',
      `// ${section.label}`,
      ...section.lines,
    ]),
  ].join('\n')
}

function dmgTitle(label: string): string {
  return /\bDMG$/i.test(label.trim()) ? label : `${label} DMG`
}

const WHOLE_NUM_FMT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

function fmtInt(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  return WHOLE_NUM_FMT.format(Math.round(value))
}

function fmtFixed(value: number, digits = 4): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  const normalized = Math.abs(value) < 1e-12 ? 0 : value
  return normalized.toFixed(digits)
}

function fmtNum(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  const normalized = Math.abs(value) < 1e-12 ? 0 : value
  return normalized.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

function fixedPct(value: number, digits = 4): string {
  return `${fmtFixed(value, digits)}%`
}

function fmtPct(value: number, digits = 2): string {
  return `${fmtNum(value, digits)}%`
}

function fmtTuneBreakBoost(value: number): string {
  return fmtNum(value)
}

function pctMul(value: number, digits = 4): string {
  return fixedPct(value * 100, digits)
}

function fmtMulPct(value: number, digits = 2): string {
  return fmtPct(value * 100, digits)
}

function nonZero(value: number, epsilon = 1e-9): boolean {
  return Math.abs(value) > epsilon
}

function addSection(
  sections: DmgBreakdown['sections'],
  label: string,
  ...lines: Array<string | null | undefined | false>
): void {
  // empty formula sections are omitted to keep the readout focused on factors that actually contributed.
  const normalized = lines.filter((line): line is string => Boolean(line && line.trim()))

  if (normalized.length > 0) {
    sections.push({ label, lines: normalized })
  }
}

function hitSpread(
  hits: SkillDef['hits'],
  vlFrmt: (hit: SkillDef['hits'][number]) => string,
): string {
  // multi-hit skills need compact per-hit notation so the formula can show both scale and hit count without becoming a
  // full table.
  return hits
    .map((hit, index) => {
      const value = vlFrmt(hit)
      const countSuffix = hit.count > 1 ? ` x ${hit.count}` : ''
      const label = hit.label ?? (hits.length > 1 ? `H${index + 1}` : '')

      return label ? `${label} ${value}${countSuffix}` : `${value}${countSuffix}`
    })
    .join(' + ')
}

function resistMult(enemyResPct: number): number {
  // resistance uses the game's three-piece curve: negative resistance has reduced penalty, normal resistance is
  // linear, and very high resistance compresses through the asymptotic branch.
  if (enemyResPct < 0) return 1 - enemyResPct / 200
  if (enemyResPct < 75) return 1 - enemyResPct / 100
  return 1 / (1 + 5 * (enemyResPct / 100))
}

function getEnemyRes(enemy: EnemyProfile, skill: SkillDef): number {
  return enemy.res[ATTR_ENEMY_RES[skill.element]]
}

function makeSkillBuffs(skill: SkillDef): ModBuff {
  return {
    ...makeModBuff(),
    ...(skill.skillBuffs ?? {}),
  }
}

function calcBasePower(finalStats: FinalStats, skill: SkillDef): number {
  return (
    finalStats.atk.final * skill.scaling.atk +
    finalStats.hp.final * skill.scaling.hp +
    finalStats.def.final * skill.scaling.def +
    finalStats.energyRegen * skill.scaling.energyRegen
  )
}

function sumHitScale(hits: SkillDef['hits']): number {
  return hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

function resolveHits(skill: SkillDef, fallbackMult = 0): SkillDef['hits'] {
  // generated skills should provide explicit hit rows; the fallback keeps legacy single-multiplier skills explainable.
  if (skill.hits.length > 0) {
    return skill.hits
  }

  if (fallbackMult <= 0) {
    return []
  }

  return [{ count: 1, multiplier: fallbackMult }]
}

function getSkllTypeL(skillTypes: SkillTypeKey[]): string {
  if (skillTypes.length === 0) {
    return 'Skill'
  }

  return skillTypes
    .map((skillType) => getSkillType(skillType).label ?? fmtSkllTypeL(skillType))
    .join(' + ')
}

function mkShrdDmgCtx(
  finalStats: FinalStats,
  skill: SkillDef,
  enemy: EnemyProfile,
  level: number,
): ShrdDmgCtx {
  // build the shared context once so normal, healing, shield, negative-effect, and tune-rupture breakdowns all explain
  // multipliers from the same resolved stat snapshot.
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = mergeSkillType(finalStats.skillType, skill.skillType)
  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[skill.element]
  const skillBuffs = makeSkillBuffs(skill)
  const ignoresEnemy = isNoEnemy(enemy)
  const baseRes = ignoresEnemy ? 0 : getEnemyRes(enemy, skill)
  const skillTypeLabel = getSkllTypeL(skill.skillType)

  if (!ignoresEnemy && baseRes === 100) {
    // 100 percent base resistance is treated as immune before shred, matching the simulator's zero-damage shortcut.
    return {
      zeroed: true,
      ignoresEnemy,
      baseRes,
      resShred: 0,
      enemyResVl: baseRes,
      resMult: 0,
      totalDefIgnore: 0,
      totalDefShred: 0,
      enemyDefBase: (8 * enemy.level) + 792,
      enemyDefense: 0,
      defMult: 0,
      dmgBonusPrcn: 0,
      dmgBonusMult: 0,
      ampPrcn: 0,
      ampMult: 0,
      dmgVulnPct: 0,
      dmgVulnMult: 0,
      specPrcn: 0,
      specMult: 0,
      critRatePrcn: 0,
      critRate: 0,
      critDmgPrcn: 0,
      critDmg: 0,
      skillTypeLabel: skillTypeLabel,
      skillTypeAll,
      skillTypeBuff: skillTypeBuff,
      attributeAll,
      attrElem: attrElement,
      skillBuffs,
    }
  }

  // shred can come from general, element-specific, skill-type, and skill-local buffs; sum it before applying the
  // resistance curve so the section can show one effective enemy resistance.
  const resShred =
    attributeAll.resShred +
    attrElement.resShred +
    skillTypeAll.resShred +
    skillTypeBuff.resShred +
    skillBuffs.resShred
  const enemyResVl = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = ignoresEnemy ? 1 : resistMult(enemyResVl)

  // defense ignore and defense shred share the same final multiplier in this calculator, so the readout aggregates
  // them before reducing enemy defense.
  const totalDefIgnore =
    finalStats.defIgnore +
    attributeAll.defIgnore +
    attrElement.defIgnore +
    skillTypeAll.defIgnore +
    skillTypeBuff.defIgnore +
    skillBuffs.defIgnore
  const totalDefShred =
    finalStats.defShred +
    attributeAll.defShred +
    attrElement.defShred +
    skillTypeAll.defShred +
    skillTypeBuff.defShred +
    skillBuffs.defShred

  const enemyDfnsBas = ignoresEnemy ? 0 : (8 * enemy.level) + 792
  const enemyDefense = ignoresEnemy
    ? 0
    : enemyDfnsBas * (1 - (totalDefIgnore + totalDefShred) / 100)
  const defenseMult = ignoresEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  // additive percent buckets are accumulated first and converted to multipliers only after all matching scopes have
  // contributed.
  const damageBonusPct =
    finalStats.dmgBonus +
    attributeAll.dmgBonus +
    attrElement.dmgBonus +
    skillTypeAll.dmgBonus +
    skillTypeBuff.dmgBonus +
    skillBuffs.dmgBonus
  const amplifyPct =
    finalStats.amplify +
    attributeAll.amplify +
    attrElement.amplify +
    skillTypeAll.amplify +
    skillTypeBuff.amplify +
    skillBuffs.amplify
  const dmgVulnPct =
    finalStats.dmgVuln +
    attributeAll.dmgVuln +
    attrElement.dmgVuln +
    skillTypeAll.dmgVuln +
    skillTypeBuff.dmgVuln +
    skillBuffs.dmgVuln
  const specPrcn = finalStats.special
  const critRatePrcn =
    finalStats.critRate +
    attributeAll.critRate +
    attrElement.critRate +
    skillTypeAll.critRate +
    skillTypeBuff.critRate +
    skillBuffs.critRate
  const critDmgPrcn =
    finalStats.critDmg +
    attributeAll.critDmg +
    attrElement.critDmg +
    skillTypeAll.critDmg +
    skillTypeBuff.critDmg +
    skillBuffs.critDmg

  return {
    zeroed: false,
    ignoresEnemy,
    baseRes,
    resShred,
    enemyResVl: enemyResVl,
    resMult,
    totalDefIgnore: totalDefIgnore,
    totalDefShred: totalDefShred,
    enemyDefBase: enemyDfnsBas,
    enemyDefense,
    defMult: defenseMult,
    dmgBonusPrcn: damageBonusPct,
    dmgBonusMult: 1 + damageBonusPct / 100,
    ampPrcn: amplifyPct,
    ampMult: 1 + amplifyPct / 100,
    dmgVulnPct: dmgVulnPct,
    dmgVulnMult: 1 + dmgVulnPct / 100,
    specPrcn: specPrcn,
    specMult: 1 + specPrcn / 100,
    critRatePrcn: critRatePrcn,
    critRate: critRatePrcn / 100,
    critDmgPrcn: critDmgPrcn,
    critDmg: critDmgPrcn / 100,
    skillTypeLabel: skillTypeLabel,
    skillTypeAll,
    skillTypeBuff: skillTypeBuff,
    attributeAll,
    attrElem: attrElement,
    skillBuffs,
  }
}

function baseSeg(
  finalStats: FinalStats,
  skill: SkillDef,
  baseAbility: number,
): string {
  const terms: string[] = []

  if (skill.scaling.atk !== 0) {
    terms.push(`${fmtNum(finalStats.atk.final, 2)} ATK x ${fmtNum(skill.scaling.atk, 4)}`)
  }
  if (skill.scaling.hp !== 0) {
    terms.push(`${fmtNum(finalStats.hp.final, 2)} HP x ${fmtNum(skill.scaling.hp, 4)}`)
  }
  if (skill.scaling.def !== 0) {
    terms.push(`${fmtNum(finalStats.def.final, 2)} DEF x ${fmtNum(skill.scaling.def, 4)}`)
  }
  if (skill.scaling.energyRegen !== 0) {
    terms.push(`${fmtNum(finalStats.energyRegen, 2)} ER x ${fmtNum(skill.scaling.energyRegen, 4)}`)
  }

  return `core.base = ${fmtNum(baseAbility, 2)} = ${terms.length > 0 ? terms.join(' + ') : '0'}`
}

function fmtSrcDdnd(parts: Array<{ label: string; value: number }>, digits = 2): string {
  const nonZeroParts = parts.filter((part) => nonZero(part.value))

  if (nonZeroParts.length === 0) {
    return fmtPct(0, digits)
  }

  return nonZeroParts
    .map((part) => `${part.label} ${fmtPct(part.value, digits)}`)
    .join(' + ')
}

function commonLines(finalStats: FinalStats, skill: SkillDef, shared: ShrdDmgCtx): string[] {
  return [
    `mod.dmgBonus = ${fmtPct(shared.dmgBonusPrcn)} = ${fmtSrcDdnd([
      { label: 'Global', value: finalStats.dmgBonus },
      { label: 'Elem All', value: shared.attributeAll.dmgBonus },
      { label: skill.element, value: shared.attrElem.dmgBonus },
      { label: 'Type All', value: shared.skillTypeAll.dmgBonus },
      { label: shared.skillTypeLabel, value: shared.skillTypeBuff.dmgBonus },
      { label: 'Skill', value: shared.skillBuffs.dmgBonus },
    ])}`,
    `mod.amp = ${fmtPct(shared.ampPrcn)} = ${fmtSrcDdnd([
      { label: 'Global', value: finalStats.amplify },
      { label: 'Elem All', value: shared.attributeAll.amplify },
      { label: skill.element, value: shared.attrElem.amplify },
      { label: 'Type All', value: shared.skillTypeAll.amplify },
      { label: shared.skillTypeLabel, value: shared.skillTypeBuff.amplify },
      { label: 'Skill', value: shared.skillBuffs.amplify },
    ])}`,
    `mod.vuln = ${fmtPct(shared.dmgVulnPct)} = ${fmtSrcDdnd([
      { label: 'Global', value: finalStats.dmgVuln },
      { label: 'Elem All', value: shared.attributeAll.dmgVuln },
      { label: skill.element, value: shared.attrElem.dmgVuln },
      { label: 'Type All', value: shared.skillTypeAll.dmgVuln },
      { label: shared.skillTypeLabel, value: shared.skillTypeBuff.dmgVuln },
      { label: 'Skill', value: shared.skillBuffs.dmgVuln },
    ])}`,
    `mod.special = ${fmtPct(shared.specPrcn)} = Global ${fmtPct(finalStats.special)}`,
    `crit.rate = ${fmtPct(shared.critRatePrcn)} = ${fmtSrcDdnd([
      { label: 'Base', value: finalStats.critRate },
      { label: 'Elem All', value: shared.attributeAll.critRate },
      { label: skill.element, value: shared.attrElem.critRate },
      { label: 'Type All', value: shared.skillTypeAll.critRate },
      { label: shared.skillTypeLabel, value: shared.skillTypeBuff.critRate },
      { label: 'Skill', value: shared.skillBuffs.critRate },
    ])}`,
    `crit.dmg = ${fmtPct(shared.critDmgPrcn)} = ${fmtSrcDdnd([
      { label: 'Base', value: finalStats.critDmg },
      { label: 'Elem All', value: shared.attributeAll.critDmg },
      { label: skill.element, value: shared.attrElem.critDmg },
      { label: 'Type All', value: shared.skillTypeAll.critDmg },
      { label: shared.skillTypeLabel, value: shared.skillTypeBuff.critDmg },
      { label: 'Skill', value: shared.skillBuffs.critDmg },
    ])}`,
  ]
}

function enemyLines(level: number, shared: ShrdDmgCtx): string[] {
  if (shared.ignoresEnemy) {
    return [
      `enemy.def = ${pctMul(shared.defMult, 10)} = no enemy`,
      `enemy.res = ${pctMul(shared.resMult, 10)} = no enemy`,
    ]
  }

  let resFormula: string
  if (shared.enemyResVl < 0) {
    resFormula = `1 - ((${fmtPct(shared.baseRes)} - ${fmtPct(shared.resShred)}) / 200)`
  } else if (shared.enemyResVl < 75) {
    resFormula = `1 - (${fmtPct(shared.baseRes)} - ${fmtPct(shared.resShred)})`
  } else {
    resFormula = `1 / (1 + 5 x ((${fmtPct(shared.baseRes)} - ${fmtPct(shared.resShred)}) / 100))`
  }

  return [
    `enemy.def = ${pctMul(shared.defMult, 10)} = (${fmtNum(800 + 8 * level, 2)}) / (${fmtNum(800 + 8 * level, 2)} + ${fmtNum(shared.enemyDefBase, 2)} x (1 - ${fmtPct(shared.totalDefIgnore)} - ${fmtPct(shared.totalDefShred)}))`,
    `enemy.res = ${pctMul(shared.resMult, 10)} = ${resFormula}`,
    `enemy.res.effective = ${fmtPct(shared.enemyResVl)} = Base ${fmtPct(shared.baseRes)} - Shred ${fmtPct(shared.resShred)}`,
  ]
}

function drctBrkd(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
): DmgBreakdown {
  const { skill } = entry
  const sections: DmgBreakdown['sections'] = []

  if ((skill.fixedDmg ?? 0) > 0) {
    const dstrHits = resolveHits(skill, 1)
    const ttlHitScl = sumHitScale(dstrHits)

    addSection(
      sections,
      'core',
      `core.fixed = ${fmtInt(entry.normal)} = max(1, floor(${fmtNum(skill.fixedDmg ?? 0, 2)}))`,
      dstrHits.length > 1 || dstrHits.some((hit) => hit.count > 1 || hit.label)
        ? `core.spread = ${hitSpread(
          dstrHits,
          (hit) => fmtPct((ttlHitScl > 0 ? hit.multiplier / ttlHitScl : 1) * 100),
        )}`
        : null,
    )

    return {
      title: dmgTitle(skill.label),
      summary: [
        `out.crit = ${fmtInt(entry.crit)} = fixed damage`,
        `out.avg = ${fmtInt(entry.avg)} = fixed damage`,
      ].join('\n'),
      equation: `out.normal = ${fmtInt(entry.normal)} = max(1, floor(${fmtNum(skill.fixedDmg ?? 0, 2)}))`,
      sections,
    }
  }

  const hits = skill.hits
  if (hits.length === 0) {
    return {
      title: dmgTitle(skill.label),
      summary: [
        `out.crit = ${fmtInt(entry.crit)}`,
        `out.avg = ${fmtInt(entry.avg)}`,
      ].join('\n'),
      equation: `out.normal = ${fmtInt(entry.normal)} = no resolved hit data`,
      sections: [{ label: 'note', lines: ['No resolved hit data for this skill.'] }],
    }
  }

  const shared = mkShrdDmgCtx(finalStats, skill, enemy, level)
  const baseAbility = calcBasePower(finalStats, skill)
  const totalMv = sumHitScale(hits)
  const ttlHitCnt = hits.reduce((total, hit) => total + hit.count, 0)
  const flatPerHit = skill.flat + finalStats.flatDmg
  const flatTotal = flatPerHit * ttlHitCnt
  const baseDmgSgmn = nonZero(flatTotal)
    ? `(${fmtNum(baseAbility, 2)} x ${fmtPct(totalMv * 100)} + ${fmtNum(flatTotal, 2)})`
    : `${fmtNum(baseAbility, 2)} x ${fmtPct(totalMv * 100)}`

  addSection(
    sections,
    'core',
    baseSeg(finalStats, skill, baseAbility),
    `core.mv = ${fmtPct(totalMv * 100)} = ${hitSpread(hits, (hit) => fmtPct(hit.multiplier * 100))}`,
    nonZero(flatTotal)
      ? `core.flat = ${fmtNum(flatTotal, 2)} = (${fmtNum(skill.flat, 2)} + ${fmtNum(finalStats.flatDmg, 2)}) x ${fmtInt(ttlHitCnt)}`
      : null,
  )
  addSection(sections, 'enemy', ...enemyLines(level, shared))
  addSection(sections, 'mods', ...commonLines(finalStats, skill, shared))

  return {
    title: dmgTitle(skill.label),
    summary: [
      `out.crit = ${fmtInt(entry.crit)} = ${fmtInt(entry.normal)} x ${fmtPct(shared.critDmgPrcn)}`,
      shared.critRate >= 1
        ? `out.avg = ${fmtInt(entry.avg)} = guaranteed crit`
        : `out.avg = ${fmtInt(entry.avg)} = ${fmtInt(entry.normal)} x (1 + ${fmtPct(shared.critRatePrcn)} x (${fmtPct(shared.critDmgPrcn)} - 1))`,
    ].join('\n'),
    equation: shared.zeroed
      ? `out.normal = ${fmtInt(entry.normal)} = 0 (enemy base RES shortcut)`
      : `out.normal = ${fmtInt(entry.normal)} = ${baseDmgSgmn} x (1 + ${fmtPct(shared.dmgBonusPrcn)}) x (1 + ${fmtPct(shared.ampPrcn)}) x (1 + ${fmtPct(shared.dmgVulnPct)}) x ${pctMul(shared.defMult, 10)} x ${pctMul(shared.resMult, 10)} x (1 + ${fmtPct(shared.specPrcn)})`,
    sections,
  }
}

function spprBrkd(entry: FeatureResult, finalStats: FinalStats): DmgBreakdown {
  const { skill } = entry
  const sections: DmgBreakdown['sections'] = []
  const supportType = skill.archetype === 'healing' ? 'Healing' : 'Shield'
  const supportKey = skill.archetype === 'healing' ? 'heal' : 'shield'
  const baseAbility = calcBasePower(finalStats, skill)
  const supportBonus = skill.archetype === 'healing'
    ? finalStats.healingBonus + (skill.skillHealingBonus ?? 0)
    : finalStats.shieldBonus + (skill.skillShieldBonus ?? 0)
  const ttlMltp = 1 + supportBonus / 100

  addSection(
    sections,
    'core',
    baseSeg(finalStats, skill, baseAbility),
    `core.mv = ${fmtMulPct(skill.multiplier)}`,
    nonZero(skill.flat) ? `core.flat = ${fmtNum(skill.flat, 2)}` : null,
  )
  addSection(
    sections,
    'mods',
    `mod.${supportKey} = ${fmtPct(supportBonus)} = ${skill.archetype === 'healing'
      ? fmtSrcDdnd([
        { label: 'Global', value: finalStats.healingBonus },
        { label: 'Skill', value: skill.skillHealingBonus ?? 0 },
      ])
      : fmtSrcDdnd([
        { label: 'Global', value: finalStats.shieldBonus },
        { label: 'Skill', value: skill.skillShieldBonus ?? 0 },
      ])}`,
  )

  return {
    title: `${skill.label} ${supportType}`,
    summary: `out.normal = 0\nout.crit = 0`,
    equation: `out.avg = ${fmtInt(entry.avg)} = max(1, floor(((${fmtNum(baseAbility, 2)} x ${fmtMulPct(skill.multiplier)})${nonZero(skill.flat) ? ` + ${fmtNum(skill.flat, 2)}` : ''}) x ${fmtMulPct(ttlMltp)}))`,
    sections,
  }
}

function tuneBrkd(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  kind: 'tuneRupture' | 'hack' = 'tuneRupture',
): DmgBreakdown {
  const { skill } = entry
  const sections: DmgBreakdown['sections'] = []
  const hits = resolveHits(skill, skill.tuneRuptureScale ?? 16)
  const ignoresEnemy = isNoEnemy(enemy)
  const baseRes = ignoresEnemy ? 0 : getEnemyRes(enemy, skill)
  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[skill.element]
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = mergeSkillType(finalStats.skillType, skill.skillType)
  const skillBuffs = makeSkillBuffs(skill)
  const resShred =
    attributeAll.resShred +
    attrElement.resShred +
    skillTypeAll.resShred +
    skillTypeBuff.resShred +
    skillBuffs.resShred
  const defIgnore =
    finalStats.defIgnore +
    attributeAll.defIgnore +
    attrElement.defIgnore +
    skillTypeAll.defIgnore +
    skillTypeBuff.defIgnore +
    skillBuffs.defIgnore
  const defShred =
    finalStats.defShred +
    attributeAll.defShred +
    attrElement.defShred +
    skillTypeAll.defShred +
    skillTypeBuff.defShred +
    skillBuffs.defShred
  const dmgVuln =
    finalStats.dmgVuln +
    attributeAll.dmgVuln +
    attrElement.dmgVuln +
    skillTypeAll.dmgVuln +
    skillTypeBuff.dmgVuln +
    skillBuffs.dmgVuln
  const enemyResVl = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = ignoresEnemy ? 1 : resistMult(enemyResVl)
  const enemyDfnsBas = ignoresEnemy ? 0 : (8 * enemy.level) + 792
  const enemyDefense = ignoresEnemy ? 0 : enemyDfnsBas * (1 - (defIgnore + defShred) / 100)
  const defenseMult = ignoresEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))
  const classMult = enemy.class === 3 || enemy.class === 4
    ? 14
    : enemy.class === 2
      ? 3
      : 1
  const formulaSkillType = finalStats.skillType[kind]
  const kindLabel = kind === 'hack' ? 'Hack' : 'Tune'
  const levelScale = getTuneLevel(level)
  const ttlHitScl = sumHitScale(hits)
  const ampPrcn = ttlHitScl * 100
  const critRatePrcn = (skill.tuneRuptureCritRate ?? 0) * 100
  const critDmgPrcn = (skill.tuneRuptureCritDmg ?? 1) * 100

  addSection(
    sections,
    'core',
    `core.level = ${fmtNum(levelScale, 2)}`,
    `core.${kind === 'hack' ? 'hackAmp' : 'tuneAmp'} = ${fmtPct(ampPrcn)} = ${hitSpread(hits, (hit) => fmtPct(hit.multiplier * 100))}`,
    `enemy.type = ${fmtNum(classMult, 2)}`,
  )
  addSection(
    sections,
    'enemy',
    ignoresEnemy
      ? `enemy.def = ${pctMul(defenseMult, 10)} = no enemy`
      : `enemy.def = ${pctMul(defenseMult, 10)} = (${fmtNum(800 + 8 * level, 2)}) / (${fmtNum(800 + 8 * level, 2)} + ${fmtNum(enemyDfnsBas, 2)} x (1 - ${fmtPct(defIgnore)} - ${fmtPct(defShred)}))`,
    ignoresEnemy
      ? `enemy.res = ${pctMul(resMult, 10)} = no enemy`
      : `enemy.res = ${pctMul(resMult, 10)} = RES after shred ${fmtPct(enemyResVl)}`,
  )
  addSection(
    sections,
    'mods',
    `mod.vuln = ${fmtPct(dmgVuln)} = ${fmtSrcDdnd([
      { label: 'Global', value: finalStats.dmgVuln },
      { label: 'Elem All', value: attributeAll.dmgVuln },
      { label: skill.element, value: attrElement.dmgVuln },
      { label: 'Type All', value: skillTypeAll.dmgVuln },
      { label: kindLabel, value: skillTypeBuff.dmgVuln },
      { label: 'Skill', value: skillBuffs.dmgVuln },
    ])}`,
    `mod.dmgBonus = ${fmtPct(formulaSkillType.dmgBonus)} = ${kindLabel} ${fmtPct(formulaSkillType.dmgBonus)}`,
    `mod.amp = ${fmtPct(finalStats.amplify)} = Global ${fmtPct(finalStats.amplify)}`,
    `mod.tuneBoost = ${fmtTuneBreakBoost(finalStats.tbb)}`,
    `crit.rate = ${fmtPct(critRatePrcn)}`,
    `crit.dmg = ${fmtPct(critDmgPrcn)}`,
  )

  return {
    title: dmgTitle(skill.label),
    summary: [
      `out.crit = ${fmtInt(entry.crit)} = ${fmtInt(entry.normal)} x ${fmtPct(critDmgPrcn)}`,
      (skill.tuneRuptureCritRate ?? 0) >= 1
        ? `out.avg = ${fmtInt(entry.avg)} = guaranteed crit`
        : `out.avg = ${fmtInt(entry.avg)} = ${fmtInt(entry.normal)} x (1 + ${fmtPct(critRatePrcn)} x (${fmtPct(critDmgPrcn)} - 1))`,
    ].join('\n'),
    equation: !ignoresEnemy && baseRes === 100
      ? `out.normal = ${fmtInt(entry.normal)} = 0 (enemy base RES shortcut)`
      : `out.normal = ${fmtInt(entry.normal)} = ${fmtNum(levelScale, 2)} x ${fmtPct(ampPrcn)} x ${pctMul(defenseMult, 10)} x ${pctMul(resMult, 10)} x (1 + ${fmtPct(dmgVuln)}) x ${fmtNum(classMult, 2)} x (1 + ${fmtPct(finalStats.amplify)}) x (1 + ${fmtPct(formulaSkillType.dmgBonus)}) x (1 + ${fmtTuneBreakBoost(finalStats.tbb)} / 100)`,
    sections,
  }
}

function getNegBase(
  archetype: SkillDef['archetype'],
  level: number,
  stacks: number,
  fixedMv?: number,
): number {
  if (
    archetype !== 'spectroFrazzle'
    && archetype !== 'aeroErosion'
    && archetype !== 'fusionBurst'
    && archetype !== 'glacioChafe'
    && archetype !== 'electroFlare'
  ) {
    return 0
  }

  return cmptNegFfctB(archetype, level, stacks, { fixedMv })
}

function negBreakdown(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  combatState: CombatState,
): DmgBreakdown {
  const { skill } = entry
  const sections: DmgBreakdown['sections'] = []
  const effectArch = skill.archetype as Extract<
    SkillDef['archetype'],
    'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'
  >
  const rawStacks = effectArch === 'spectroFrazzle'
    ? combatState.spectroFrazzle
    : effectArch === 'aeroErosion'
      ? combatState.aeroErosion
      : effectArch === 'fusionBurst'
        ? combatState.fusionBurst
        : effectArch === 'glacioChafe'
          ? combatState.glacioChafe
        : combatState.electroFlare
  const stacks = skill.stackMode === 'fixedMax'
    ? skill.stackMax ?? getNegEffectDef(effectArch)
    : rawStacks
  const extraStacks = effectArch === 'electroFlare'
    && combatState.electroFlare > getNegEffectDef('electroFlare')
    ? combatState.electroRage
    : 0
  const element = effectArch === 'spectroFrazzle'
    ? 'spectro'
    : effectArch === 'aeroErosion'
      ? 'aero'
      : effectArch === 'fusionBurst'
        ? 'fusion'
        : effectArch === 'glacioChafe'
          ? 'glacio'
        : 'electro'
  const ggrgFfctType = mergeSkillType(finalStats.skillType, skill.skillType)
  const negFfctBuff = finalStats.negativeEffect[effectArch as NegEffectKey]
  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[element]
  const ignoresEnemy = isNoEnemy(enemy)
  const baseRes = ignoresEnemy ? 0 : enemy.res[ATTR_ENEMY_RES[element]]
  const resShred = attributeAll.resShred + attrElement.resShred + ggrgFfctType.resShred
  const defIgnore = finalStats.defIgnore + attributeAll.defIgnore + attrElement.defIgnore + ggrgFfctType.defIgnore
  const defShred = finalStats.defShred + attributeAll.defShred + attrElement.defShred + ggrgFfctType.defShred
  const dmgVuln = finalStats.dmgVuln + attributeAll.dmgVuln + attrElement.dmgVuln + ggrgFfctType.dmgVuln
  const enemyResVl = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = ignoresEnemy ? 1 : resistMult(enemyResVl)
  const enemyDfnsBas = ignoresEnemy ? 0 : (8 * enemy.level) + 792
  const enemyDefense = ignoresEnemy ? 0 : enemyDfnsBas * (1 - (defIgnore + defShred) / 100)
  const defenseMult = ignoresEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))
  const hits = resolveHits(skill, 1)
  const ttlHitScl = sumHitScale(hits)
  const perStackBase =
    getNegBase(effectArch, level, stacks, skill.fixedMv) +
    (effectArch === 'electroFlare' ? getNegBase(effectArch, level, extraStacks, skill.fixedMv) : 0)
  const negFfctMltp = 1 + negFfctBuff.multiplier
  const critRatePrcn = ((skill.negativeEffectCritRate ?? 0) * 100) + negFfctBuff.critRate
  const critDmgPrcn = ((skill.negativeEffectCritDmg ?? 1) * 100) + negFfctBuff.critDmg

  if (stacks <= 0 && extraStacks <= 0) {
    return {
      title: dmgTitle(skill.label),
      summary: [
        `out.crit = ${fmtInt(entry.crit)}`,
        `out.avg = ${fmtInt(entry.avg)}`,
      ].join('\n'),
      equation: `out.normal = ${fmtInt(entry.normal)} = 0 (no stacks)`,
      sections: [{ label: 'core', lines: ['core.stacks = 0'] }],
    }
  }

  addSection(
    sections,
    'core',
    effectArch === 'electroFlare'
      ? `core.stacks = ${fmtInt(stacks)} + ${fmtInt(extraStacks)}`
      : `core.stacks = ${fmtInt(stacks)}`,
    `core.base = ${fmtNum(perStackBase, 2)}`,
    `core.mv = ${fmtPct(ttlHitScl * 100)} = ${hitSpread(hits, (hit) => fmtPct(hit.multiplier * 100))}`,
  )
  addSection(
    sections,
    'enemy',
    ignoresEnemy
      ? `enemy.def = ${pctMul(defenseMult, 10)} = no enemy`
      : `enemy.def = ${pctMul(defenseMult, 10)} = (${fmtNum(800 + 8 * level, 2)}) / (${fmtNum(800 + 8 * level, 2)} + ${fmtNum(enemyDfnsBas, 2)} x (1 - ${fmtPct(defIgnore)} - ${fmtPct(defShred)}))`,
    ignoresEnemy
      ? `enemy.res = ${pctMul(resMult, 10)} = no enemy`
      : `enemy.res = ${pctMul(resMult, 10)} = RES after shred ${fmtPct(enemyResVl)}`,
  )
  addSection(
    sections,
    'mods',
    `mod.effect = ${fmtMulPct(negFfctMltp)} = ${getSkillType(skill.skillType).label} bonus ${fmtPct(negFfctBuff.multiplier * 100)}`,
    `mod.dmgBonus = ${fmtPct(ggrgFfctType.dmgBonus)} = Effect ${fmtPct(ggrgFfctType.dmgBonus)}`,
    `mod.amp = ${fmtPct(finalStats.amplify + ggrgFfctType.amplify)} = Global ${fmtPct(finalStats.amplify)} + Effect ${fmtPct(ggrgFfctType.amplify)}`,
    `mod.vuln = ${fmtPct(dmgVuln)} = Global ${fmtPct(finalStats.dmgVuln)} + Elem All ${fmtPct(attributeAll.dmgVuln)} + ${element} ${fmtPct(attrElement.dmgVuln)} + Effect ${fmtPct(ggrgFfctType.dmgVuln)}`,
    `mod.special = ${fmtPct(finalStats.special)}`,
    `crit.rate = ${fmtPct(critRatePrcn)}`,
    `crit.dmg = ${fmtPct(critDmgPrcn)}`,
  )

  return {
    title: dmgTitle(skill.label),
    summary: [
      `out.crit = ${fmtInt(entry.crit)} = ${fmtInt(entry.normal)} x ${fmtPct(critDmgPrcn)}`,
      critRatePrcn >= 100
        ? `out.avg = ${fmtInt(entry.avg)} = guaranteed crit`
        : `out.avg = ${fmtInt(entry.avg)} = ${fmtInt(entry.normal)} x (1 + ${fmtPct(critRatePrcn)} x (${fmtPct(critDmgPrcn)} - 1))`,
    ].join('\n'),
    equation: `out.normal = ${fmtInt(entry.normal)} = ${fmtNum(perStackBase, 2)} x ${fmtPct(ttlHitScl * 100)} x ${fmtMulPct(negFfctMltp)} x ${pctMul(defenseMult, 10)} x ${pctMul(resMult, 10)} x (1 + ${fmtPct(finalStats.amplify + ggrgFfctType.amplify)}) x (1 + ${fmtPct(ggrgFfctType.dmgBonus)}) x (1 + ${fmtPct(dmgVuln)}) x (1 + ${fmtPct(finalStats.special)})`,
    sections,
  }
}

export function formBrkd(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  combatState: CombatState,
): DmgBreakdown {
  switch (entry.skill.archetype) {
    case 'healing':
    case 'shield':
      return spprBrkd(entry, finalStats)
    case 'tuneRupture':
      return tuneBrkd(entry, finalStats, enemy, level)
    case 'hack':
      return tuneBrkd(entry, finalStats, enemy, level, 'hack')
    case 'spectroFrazzle':
    case 'aeroErosion':
    case 'fusionBurst':
    case 'glacioChafe':
    case 'electroFlare':
      return negBreakdown(entry, finalStats, enemy, level, combatState)
    case 'skillDamage':
    default:
      return drctBrkd(entry, finalStats, enemy, level)
  }
}

export function skillFormula(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  combatState: CombatState,
): string {
  return fmtBreakdown(
    formBrkd(entry, finalStats, enemy, level, combatState),
  )
}
