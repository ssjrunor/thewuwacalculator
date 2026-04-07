import type { FeatureResult } from '@/domain/gameData/contracts'
import type { EnemyProfile } from '@/domain/entities/appState'
import { ATTRIBUTE_TO_ENEMY_RES_INDEX, isUnsetEnemyProfile } from '@/domain/entities/appState'
import { getNegativeEffectDefaultMax } from '@/domain/gameData/negativeEffects'
import type { CombatState } from '@/domain/entities/runtime'
import type { FinalStats, ModBuff, NegativeEffectKey, SkillDefinition, SkillTypeKey } from '@/domain/entities/stats'
import { getNegativeEffectBase as computeNegativeEffectBase } from '@/engine/formulas/negativeEffects'
import { getTuneRuptureLevelScale } from '@/engine/formulas/tuneRupture'
import { aggregateSkillTypeBuffs, makeModBuff } from '@/engine/resolvers/buffPool'
import { getSkillTypeDisplay, formatSkillTypeLabel } from '@/modules/calculator/model/skillTypes'

type SharedDamageContext = {
  zeroed: boolean
  ignoresEnemy: boolean
  baseRes: number
  resShred: number
  enemyResValue: number
  resMult: number
  totalDefIgnore: number
  totalDefShred: number
  enemyDefenseBase: number
  enemyDefense: number
  defenseMultiplier: number
  damageBonusPercent: number
  damageBonusMultiplier: number
  amplifyPercent: number
  amplifyMultiplier: number
  dmgVulnPercent: number
  dmgVulnMultiplier: number
  specialPercent: number
  specialMultiplier: number
  critRatePercent: number
  critRate: number
  critDmgPercent: number
  critDmg: number
  skillTypeLabel: string
  skillTypeAll: ModBuff
  skillTypeBuff: ModBuff
  attributeAll: ModBuff
  attributeElement: ModBuff
  skillBuffs: ModBuff
}

const WHOLE_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

function formatWhole(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  return WHOLE_NUMBER_FORMATTER.format(Math.round(value))
}

function formatFixed(value: number, digits = 4): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  const normalized = Math.abs(value) < 1e-12 ? 0 : value
  return normalized.toFixed(digits)
}

function formatPercent(value: number, digits = 4): string {
  return `${formatFixed(value, digits)}%`
}

function formatMultiplierPercent(value: number, digits = 4): string {
  return formatPercent(value * 100, digits)
}

function formatBucketParts(parts: Array<{ label: string; value: number }>, digits = 4): string {
  const nonZeroParts = parts.filter((part) => hasNonZeroValue(part.value))

  if (nonZeroParts.length === 0) {
    return formatPercent(0, digits)
  }

  return nonZeroParts
    .map((part) => `${part.label} ${formatPercent(part.value, digits)}`)
    .join(' + ')
}

function joinInline(parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(' | ')
}

function hasNonZeroValue(value: number, epsilon = 1e-9): boolean {
  return Math.abs(value) > epsilon
}

function pushSection(
  sections: string[][],
  ...lines: Array<string | null | undefined | false>
): void {
  const normalized = lines.filter((line): line is string => Boolean(line && line.trim()))

  if (normalized.length > 0) {
    sections.push(normalized)
  }
}

function joinSections(sections: string[][]): string {
  return sections.map((section) => section.join('\n')).join('\n\n')
}

function buildHitSpread(
  hits: SkillDefinition['hits'],
  valueFormatter: (hit: SkillDefinition['hits'][number]) => string,
): string {
  const includeLabel = hits.length > 1 || hits.some((hit) => Boolean(hit.label) || hit.count > 1)

  return hits
    .map((hit, index) => {
      const value = valueFormatter(hit)
      const countSuffix = hit.count > 1 ? ` x ${hit.count}` : ''

      if (!includeLabel) {
        return `${value}${countSuffix}`
      }

      return `${hit.label ?? `Hit ${index + 1}`} ${value}${countSuffix}`
    })
    .join(' + ')
}

function resistanceMultiplier(enemyResPercent: number): number {
  if (enemyResPercent < 0) return 1 - enemyResPercent / 200
  if (enemyResPercent < 75) return 1 - enemyResPercent / 100
  return 1 / (1 + 5 * (enemyResPercent / 100))
}

function resolveEnemyResistance(enemy: EnemyProfile, skill: SkillDefinition): number {
  return enemy.res[ATTRIBUTE_TO_ENEMY_RES_INDEX[skill.element]]
}

function buildSkillBuffs(skill: SkillDefinition): ModBuff {
  return {
    ...makeModBuff(),
    ...(skill.skillBuffs ?? {}),
  }
}

function computeBaseAbility(finalStats: FinalStats, skill: SkillDefinition): number {
  return (
    finalStats.atk.final * skill.scaling.atk +
    finalStats.hp.final * skill.scaling.hp +
    finalStats.def.final * skill.scaling.def +
    finalStats.energyRegen * skill.scaling.energyRegen
  )
}

function sumHitScale(hits: SkillDefinition['hits']): number {
  return hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

function resolveDamageHits(skill: SkillDefinition, fallbackMultiplier = 0): SkillDefinition['hits'] {
  if (skill.hits.length > 0) {
    return skill.hits
  }

  if (fallbackMultiplier <= 0) {
    return []
  }

  return [{ count: 1, multiplier: fallbackMultiplier }]
}

function getSkillTypeLabel(skillTypes: SkillTypeKey[]): string {
  if (skillTypes.length === 0) {
    return 'Skill'
  }

  return skillTypes
    .map((skillType) => getSkillTypeDisplay(skillType).label ?? formatSkillTypeLabel(skillType))
    .join(' + ')
}

function buildSharedDamageContext(
  finalStats: FinalStats,
  skill: SkillDefinition,
  enemy: EnemyProfile,
  level: number,
): SharedDamageContext {
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = aggregateSkillTypeBuffs(finalStats.skillType, skill.skillType)
  const attributeAll = finalStats.attribute.all
  const attributeElement = finalStats.attribute[skill.element]
  const skillBuffs = buildSkillBuffs(skill)
  const ignoresEnemy = isUnsetEnemyProfile(enemy)
  const baseRes = ignoresEnemy ? 0 : resolveEnemyResistance(enemy, skill)
  const skillTypeLabel = getSkillTypeLabel(skill.skillType)

  if (!ignoresEnemy && baseRes === 100) {
    return {
      zeroed: true,
      ignoresEnemy,
      baseRes,
      resShred: 0,
      enemyResValue: baseRes,
      resMult: 0,
      totalDefIgnore: 0,
      totalDefShred: 0,
      enemyDefenseBase: (8 * enemy.level) + 792,
      enemyDefense: 0,
      defenseMultiplier: 0,
      damageBonusPercent: 0,
      damageBonusMultiplier: 0,
      amplifyPercent: 0,
      amplifyMultiplier: 0,
      dmgVulnPercent: 0,
      dmgVulnMultiplier: 0,
      specialPercent: 0,
      specialMultiplier: 0,
      critRatePercent: 0,
      critRate: 0,
      critDmgPercent: 0,
      critDmg: 0,
      skillTypeLabel,
      skillTypeAll,
      skillTypeBuff,
      attributeAll,
      attributeElement,
      skillBuffs,
    }
  }

  const resShred =
    attributeAll.resShred +
    attributeElement.resShred +
    skillTypeAll.resShred +
    skillTypeBuff.resShred +
    skillBuffs.resShred
  const enemyResValue = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = ignoresEnemy ? 1 : resistanceMultiplier(enemyResValue)

  const totalDefIgnore =
    finalStats.defIgnore +
    attributeAll.defIgnore +
    attributeElement.defIgnore +
    skillTypeAll.defIgnore +
    skillTypeBuff.defIgnore +
    skillBuffs.defIgnore
  const totalDefShred =
    finalStats.defShred +
    attributeAll.defShred +
    attributeElement.defShred +
    skillTypeAll.defShred +
    skillTypeBuff.defShred +
    skillBuffs.defShred

  const enemyDefenseBase = ignoresEnemy ? 0 : (8 * enemy.level) + 792
  const enemyDefense = ignoresEnemy
    ? 0
    : enemyDefenseBase * (1 - (totalDefIgnore + totalDefShred) / 100)
  const defenseMultiplier = ignoresEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  const damageBonusPercent =
    finalStats.dmgBonus +
    attributeAll.dmgBonus +
    attributeElement.dmgBonus +
    skillTypeAll.dmgBonus +
    skillTypeBuff.dmgBonus +
    skillBuffs.dmgBonus
  const amplifyPercent =
    finalStats.amplify +
    attributeAll.amplify +
    attributeElement.amplify +
    skillTypeAll.amplify +
    skillTypeBuff.amplify +
    skillBuffs.amplify
  const dmgVulnPercent =
    finalStats.dmgVuln +
    attributeAll.dmgVuln +
    attributeElement.dmgVuln +
    skillTypeAll.dmgVuln +
    skillTypeBuff.dmgVuln +
    skillBuffs.dmgVuln
  const specialPercent = finalStats.special
  const critRatePercent =
    finalStats.critRate +
    attributeAll.critRate +
    attributeElement.critRate +
    skillTypeAll.critRate +
    skillTypeBuff.critRate +
    skillBuffs.critRate
  const critDmgPercent =
    finalStats.critDmg +
    attributeAll.critDmg +
    attributeElement.critDmg +
    skillTypeAll.critDmg +
    skillTypeBuff.critDmg +
    skillBuffs.critDmg

  return {
    zeroed: false,
    ignoresEnemy,
    baseRes,
    resShred,
    enemyResValue,
    resMult,
    totalDefIgnore,
    totalDefShred,
    enemyDefenseBase,
    enemyDefense,
    defenseMultiplier,
    damageBonusPercent,
    damageBonusMultiplier: 1 + damageBonusPercent / 100,
    amplifyPercent,
    amplifyMultiplier: 1 + amplifyPercent / 100,
    dmgVulnPercent,
    dmgVulnMultiplier: 1 + dmgVulnPercent / 100,
    specialPercent,
    specialMultiplier: 1 + specialPercent / 100,
    critRatePercent,
    critRate: critRatePercent / 100,
    critDmgPercent,
    critDmg: critDmgPercent / 100,
    skillTypeLabel,
    skillTypeAll,
    skillTypeBuff,
    attributeAll,
    attributeElement,
    skillBuffs,
  }
}

function buildBaseAbilitySegment(
  finalStats: FinalStats,
  skill: SkillDefinition,
  baseAbility: number,
): string {
  const terms: string[] = []

  if (skill.scaling.atk !== 0) {
    terms.push(`ATK ${formatFixed(finalStats.atk.final)} x ${formatFixed(skill.scaling.atk)}`)
  }
  if (skill.scaling.hp !== 0) {
    terms.push(`HP ${formatFixed(finalStats.hp.final)} x ${formatFixed(skill.scaling.hp)}`)
  }
  if (skill.scaling.def !== 0) {
    terms.push(`DEF ${formatFixed(finalStats.def.final)} x ${formatFixed(skill.scaling.def)}`)
  }
  if (skill.scaling.energyRegen !== 0) {
    terms.push(`ER ${formatFixed(finalStats.energyRegen)} x ${formatFixed(skill.scaling.energyRegen)}`)
  }

  return `Base ${formatFixed(baseAbility)} = ${terms.length > 0 ? terms.join(' + ') : '0.0000'}`
}

function formatNamedAddends(parts: Array<{ label: string; value: number }>, digits = 4): string {
  const nonZeroParts = parts.filter((part) => hasNonZeroValue(part.value))

  if (nonZeroParts.length === 0) {
    return formatPercent(0, digits)
  }

  return nonZeroParts
    .map((part) => `${part.label} ${formatPercent(part.value, digits)}`)
    .join(' + ')
}

function buildCommonTotalsLines(finalStats: FinalStats, skill: SkillDefinition, shared: SharedDamageContext): string[] {
  const lines: string[] = []

  if (hasNonZeroValue(shared.damageBonusPercent)) {
    lines.push(
      `Damage Bonus ${formatPercent(shared.damageBonusPercent)} = ${formatBucketParts([
        { label: 'Global', value: finalStats.dmgBonus },
        { label: 'Attribute(All)', value: shared.attributeAll.dmgBonus },
        { label: `Attribute(${skill.element})`, value: shared.attributeElement.dmgBonus },
        { label: 'SkillType(All)', value: shared.skillTypeAll.dmgBonus },
        { label: `SkillType(${shared.skillTypeLabel})`, value: shared.skillTypeBuff.dmgBonus },
        { label: 'Skill', value: shared.skillBuffs.dmgBonus },
      ])}`,
    )
  }

  if (hasNonZeroValue(shared.amplifyPercent)) {
    lines.push(
      `Amplify ${formatPercent(shared.amplifyPercent)} = ${formatBucketParts([
        { label: 'Global', value: finalStats.amplify },
        { label: 'Attribute(All)', value: shared.attributeAll.amplify },
        { label: `Attribute(${skill.element})`, value: shared.attributeElement.amplify },
        { label: 'SkillType(All)', value: shared.skillTypeAll.amplify },
        { label: `SkillType(${shared.skillTypeLabel})`, value: shared.skillTypeBuff.amplify },
        { label: 'Skill', value: shared.skillBuffs.amplify },
      ])}`,
    )
  }

  if (hasNonZeroValue(shared.dmgVulnPercent)) {
    lines.push(
      `Vulnerability ${formatPercent(shared.dmgVulnPercent)} = ${formatBucketParts([
        { label: 'Global', value: finalStats.dmgVuln },
        { label: 'Attribute(All)', value: shared.attributeAll.dmgVuln },
        { label: `Attribute(${skill.element})`, value: shared.attributeElement.dmgVuln },
        { label: 'SkillType(All)', value: shared.skillTypeAll.dmgVuln },
        { label: `SkillType(${shared.skillTypeLabel})`, value: shared.skillTypeBuff.dmgVuln },
        { label: 'Skill', value: shared.skillBuffs.dmgVuln },
      ])}`,
    )
  }

  if (hasNonZeroValue(shared.specialPercent)) {
    lines.push(`Special ${formatPercent(shared.specialPercent)} = Special ${formatPercent(finalStats.special)}`)
  }

  if (hasNonZeroValue(shared.critRatePercent)) {
    lines.push(
      `Crit Rate ${formatPercent(shared.critRatePercent)} = ${formatBucketParts([
        { label: 'Base', value: finalStats.critRate },
        { label: 'Attribute(All)', value: shared.attributeAll.critRate },
        { label: `Attribute(${skill.element})`, value: shared.attributeElement.critRate },
        { label: 'SkillType(All)', value: shared.skillTypeAll.critRate },
        { label: `SkillType(${shared.skillTypeLabel})`, value: shared.skillTypeBuff.critRate },
        { label: 'Skill', value: shared.skillBuffs.critRate },
      ])}`,
    )
  }

  lines.push(
    `Crit Damage ${formatPercent(shared.critDmgPercent)} = ${formatBucketParts([
      { label: 'Base', value: finalStats.critDmg },
      { label: 'Attribute(All)', value: shared.attributeAll.critDmg },
      { label: `Attribute(${skill.element})`, value: shared.attributeElement.critDmg },
      { label: 'SkillType(All)', value: shared.skillTypeAll.critDmg },
      { label: `SkillType(${shared.skillTypeLabel})`, value: shared.skillTypeBuff.critDmg },
      { label: 'Skill', value: shared.skillBuffs.critDmg },
    ])}`,
  )

  return lines
}

function buildEnemyBreakdownLines(
  enemy: EnemyProfile,
  level: number,
  shared: SharedDamageContext,
): string[] {
  const lines: string[] = []
  if (!shared.ignoresEnemy) {
    lines.push(
      `Enemy Defense ${formatFixed(Math.max(0, shared.enemyDefense))} = ${formatFixed(shared.enemyDefenseBase)} x (1 - ${formatPercent(shared.totalDefIgnore)} - ${formatPercent(shared.totalDefShred)})`,
    )
    lines.push(
      `Defense Modifier ${formatMultiplierPercent(shared.defenseMultiplier, 10)} = ${formatFixed(800 + 8 * level)} / (${formatFixed(800 + 8 * level)} + ${formatFixed(Math.max(0, shared.enemyDefense))})`,
    )
  } else {
    lines.push(`Defense Modifier ${formatMultiplierPercent(shared.defenseMultiplier, 10)} = No enemy selected`)
  }

  let resistanceSegment: string
  if (shared.ignoresEnemy) {
    resistanceSegment = `Resistance Modifier ${formatMultiplierPercent(shared.resMult, 10)} = No enemy selected`
  } else if (shared.enemyResValue < 0) {
    resistanceSegment = `Resistance Modifier ${formatMultiplierPercent(shared.resMult, 10)} = 1 - ((${formatPercent(shared.baseRes)} - ${formatPercent(shared.resShred)}) / 200)`
  } else if (shared.enemyResValue < 75) {
    resistanceSegment = `Resistance Modifier ${formatMultiplierPercent(shared.resMult, 10)} = 1 - (${formatPercent(shared.baseRes)} - ${formatPercent(shared.resShred)})`
  } else {
    resistanceSegment = `Resistance Modifier ${formatMultiplierPercent(shared.resMult, 10)} = 1 / (1 + 5 x ((${formatPercent(shared.baseRes)} - ${formatPercent(shared.resShred)}) / 100))`
  }

  if (!shared.ignoresEnemy) {
    lines.push(
      `Effective RES ${formatPercent(shared.enemyResValue)} = Base RES ${formatPercent(shared.baseRes)} - RES Shred ${formatPercent(shared.resShred)}`,
    )
  }
  lines.push(resistanceSegment)

  if (!shared.ignoresEnemy && shared.zeroed) {
    lines.push(`Note: Enemy base ${formatPercent(shared.baseRes)} matches the formula's hard zero shortcut for this branch.`)
  }

  void enemy
  return lines
}

function buildDirectMultiplierLine(shared: SharedDamageContext, combinedMultiplier: number): string {
  return `Combined Multiplier ${formatMultiplierPercent(combinedMultiplier, 10)} = ${joinInline([
    `Def ${formatMultiplierPercent(shared.defenseMultiplier, 10)}`,
    `RES ${formatMultiplierPercent(shared.resMult, 10)}`,
    hasNonZeroValue(shared.damageBonusPercent)
      ? `DMG ${formatMultiplierPercent(shared.damageBonusMultiplier, 4)}`
      : null,
    hasNonZeroValue(shared.amplifyPercent)
      ? `Amp ${formatMultiplierPercent(shared.amplifyMultiplier, 4)}`
      : null,
    hasNonZeroValue(shared.dmgVulnPercent)
      ? `Vuln ${formatMultiplierPercent(shared.dmgVulnMultiplier, 4)}`
      : null,
    hasNonZeroValue(shared.specialPercent)
      ? `Special ${formatMultiplierPercent(shared.specialMultiplier, 4)}`
      : null,
  ]).replaceAll(' | ', ' x ')}`
}

function buildDirectDamageConsoleText(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
): string {
  const { skill } = entry
  const sections: string[][] = []
  const hits = skill.hits

  pushSection(sections, '// Summary', `Normal ${formatWhole(entry.normal)} | Crit ${formatWhole(entry.crit)} | Avg ${formatWhole(entry.avg)}`)

  if ((skill.fixedDmg ?? 0) > 0) {
    const distributedHits = resolveDamageHits(skill, 1)
    const totalHitScale = sumHitScale(distributedHits)
    const spreadLine = distributedHits.length > 1 || distributedHits.some((hit) => hit.count > 1 || hit.label)
      ? `Spread: ${buildHitSpread(
        distributedHits,
        (hit) => formatPercent((totalHitScale > 0 ? hit.multiplier / totalHitScale : 1) * 100),
      )}`
      : null

    pushSection(
      sections,
      '// Formula',
      `Fixed Damage ${formatWhole(entry.normal)} = max(1, floor(${formatFixed(skill.fixedDmg ?? 0)}))`,
      spreadLine,
    )
    pushSection(
      sections,
      '// Final',
      `Crit ${formatWhole(entry.crit)} = Fixed damage does not apply crit | Avg ${formatWhole(entry.avg)} = Fixed damage does not apply crit`,
    )
    return joinSections(sections)
  }

  if (hits.length === 0) {
    pushSection(sections, '// Summary', 'Note: No resolved hit data for this skill.')
    return joinSections(sections)
  }

  const shared = buildSharedDamageContext(finalStats, skill, enemy, level)
  const baseAbility = computeBaseAbility(finalStats, skill)
  const totalMv = sumHitScale(hits)
  const totalHitCount = hits.reduce((total, hit) => total + hit.count, 0)
  const flatPerHit = skill.flat + finalStats.flatDmg
  const flatTotal = flatPerHit * totalHitCount
  const combinedMultiplier =
    shared.resMult *
    shared.defenseMultiplier *
    shared.damageBonusMultiplier *
    shared.amplifyMultiplier *
    shared.dmgVulnMultiplier *
    shared.specialMultiplier

  if (shared.zeroed) {
    pushSection(
      sections,
      '// Formula',
      buildBaseAbilitySegment(finalStats, skill, baseAbility),
      `Total MV ${formatPercent(totalMv * 100)} = ${buildHitSpread(hits, (hit) => formatPercent(hit.multiplier * 100))}`,
      hasNonZeroValue(flatTotal)
        ? `Flat Damage ${formatFixed(flatTotal)} = (${formatFixed(skill.flat)} + ${formatFixed(finalStats.flatDmg)}) x ${formatWhole(totalHitCount)}`
        : null,
      ...buildCommonTotalsLines(finalStats, skill, shared),
      ...buildEnemyBreakdownLines(enemy, level, shared),
      buildDirectMultiplierLine(shared, combinedMultiplier),
    )
    pushSection(
      sections,
      '// Output',
      `Normal ${formatWhole(entry.normal)} = 0 because the enemy base resistance shortcut zeroed this damage branch`,
    )
  } else {
    pushSection(
      sections,
      '// Formula',
      buildBaseAbilitySegment(finalStats, skill, baseAbility),
      `Total MV ${formatPercent(totalMv * 100)} = ${buildHitSpread(hits, (hit) => formatPercent(hit.multiplier * 100))}`,
      hasNonZeroValue(flatTotal)
        ? `Flat Damage ${formatFixed(flatTotal)} = (${formatFixed(skill.flat)} + ${formatFixed(finalStats.flatDmg)}) x ${formatWhole(totalHitCount)}`
        : null,
      ...buildCommonTotalsLines(finalStats, skill, shared),
      ...buildEnemyBreakdownLines(enemy, level, shared),
      buildDirectMultiplierLine(shared, combinedMultiplier),
    )
    pushSection(
      sections,
      '// Output',
      `Normal ${formatWhole(entry.normal)} = ((${formatFixed(baseAbility)} x ${formatPercent(totalMv * 100)})${hasNonZeroValue(flatTotal) ? ` + ${formatFixed(flatTotal)}` : ''}) x ${formatMultiplierPercent(combinedMultiplier, 10)}`,
    )
  }

  pushSection(
    sections,
    '// Final',
    `Crit ${formatWhole(entry.crit)} = ${formatWhole(entry.normal)} x ${formatPercent(shared.critDmgPercent)}`,
    hasNonZeroValue(shared.critRatePercent)
      ? `Average ${formatWhole(entry.avg)} = ${shared.critRate >= 1
        ? `Guaranteed crit because Crit Rate is ${formatPercent(shared.critRatePercent)}`
        : `${formatWhole(entry.normal)} x (1 + ${formatPercent(shared.critRatePercent)} x (${formatPercent(shared.critDmgPercent)} - 1))`}`
      : `Average ${formatWhole(entry.avg)} = ${formatWhole(entry.normal)}`,
  )

  return joinSections(sections)
}

function buildSupportConsoleText(entry: FeatureResult, finalStats: FinalStats): string {
  const { skill } = entry
  const sections: string[][] = []
  const baseAbility = computeBaseAbility(finalStats, skill)
  const supportType = skill.archetype === 'healing' ? 'Healing' : 'Shield'
  const supportBonus = skill.archetype === 'healing'
    ? finalStats.healingBonus + (skill.skillHealingBonus ?? 0)
    : finalStats.shieldBonus + (skill.skillShieldBonus ?? 0)
  const totalMultiplier = 1 + supportBonus / 100

  pushSection(sections, '// Summary', `Avg ${formatWhole(entry.avg)}`)
  pushSection(
    sections,
    '// Output',
    `${supportType} ${formatWhole(entry.avg)} = max(1, floor(((${formatFixed(baseAbility)} x ${formatMultiplierPercent(skill.multiplier, 4)})${hasNonZeroValue(skill.flat) ? ` + ${formatFixed(skill.flat)}` : ''}) x ${formatMultiplierPercent(totalMultiplier, 4)}))`,
    '// Core',
    `${joinInline([
      buildBaseAbilitySegment(finalStats, skill, baseAbility),
      `MV ${formatPercent(skill.multiplier * 100)}`,
      hasNonZeroValue(skill.flat) ? `Flat ${formatFixed(skill.flat)}` : null,
    ])}`,
  )
  if (hasNonZeroValue(supportBonus)) {
    pushSection(
      sections,
      '// Modifiers',
      `${supportType} Bonus ${formatPercent(supportBonus)} = ${skill.archetype === 'healing'
        ? formatNamedAddends([
          { label: 'Healing Bonus', value: finalStats.healingBonus },
          { label: 'Skill Healing Bonus', value: skill.skillHealingBonus ?? 0 },
        ])
        : formatNamedAddends([
          { label: 'Shield Bonus', value: finalStats.shieldBonus },
          { label: 'Skill Shield Bonus', value: skill.skillShieldBonus ?? 0 },
        ])}`,
    )
  }

  return joinSections(sections)
}

function buildTuneRuptureConsoleText(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
): string {
  const { skill } = entry
  const sections: string[][] = []
  const hits = resolveDamageHits(skill, skill.tuneRuptureScale ?? 16)
  const ignoresEnemy = isUnsetEnemyProfile(enemy)
  const baseRes = ignoresEnemy ? 0 : resolveEnemyResistance(enemy, skill)
  const attributeAll = finalStats.attribute.all
  const attributeElement = finalStats.attribute[skill.element]
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = aggregateSkillTypeBuffs(finalStats.skillType, skill.skillType)
  const skillBuffs = buildSkillBuffs(skill)
  const resShred =
    attributeAll.resShred +
    attributeElement.resShred +
    skillTypeAll.resShred +
    skillTypeBuff.resShred +
    skillBuffs.resShred
  const defIgnore =
    finalStats.defIgnore +
    attributeAll.defIgnore +
    attributeElement.defIgnore +
    skillTypeAll.defIgnore +
    skillTypeBuff.defIgnore +
    skillBuffs.defIgnore
  const defShred =
    finalStats.defShred +
    attributeAll.defShred +
    attributeElement.defShred +
    skillTypeAll.defShred +
    skillTypeBuff.defShred +
    skillBuffs.defShred
  const dmgVuln =
    finalStats.dmgVuln +
    attributeAll.dmgVuln +
    attributeElement.dmgVuln +
    skillTypeAll.dmgVuln +
    skillTypeBuff.dmgVuln +
    skillBuffs.dmgVuln

  const enemyResValue = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = ignoresEnemy ? 1 : resistanceMultiplier(enemyResValue)
  const enemyDefenseBase = ignoresEnemy ? 0 : (8 * enemy.level) + 792
  const enemyDefense = ignoresEnemy ? 0 : enemyDefenseBase * (1 - (defIgnore + defShred) / 100)
  const defenseMultiplier = ignoresEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))
  const classMultiplier = enemy.class === 3 || enemy.class === 4
    ? 14
    : enemy.class === 2
      ? 3
      : 1
  const tuneSkillType = finalStats.skillType.tuneRupture
  const bonusMultiplier =
    (1 + finalStats.amplify / 100) *
    (1 + tuneSkillType.dmgBonus / 100) *
    (1 + finalStats.tuneBreakBoost / 100)
  const levelScale = getTuneRuptureLevelScale(level)
  const perHitMultiplier = resMult * defenseMultiplier * (1 + dmgVuln / 100) * classMultiplier * bonusMultiplier
  const totalHitScale = sumHitScale(hits)
  const critRatePercent = (skill.tuneRuptureCritRate ?? 0) * 100
  const critDmgPercent = (skill.tuneRuptureCritDmg ?? 1) * 100

  pushSection(sections, '// Summary', `Normal ${formatWhole(entry.normal)} | Crit ${formatWhole(entry.crit)} | Avg ${formatWhole(entry.avg)}`)

  if (!ignoresEnemy && baseRes === 100) {
    pushSection(sections, '// Output', `Normal ${formatWhole(entry.normal)} = 0 because the enemy base resistance shortcut zeroed this damage branch`)
  } else {
    pushSection(
      sections,
      '// Output',
      `Normal ${formatWhole(entry.normal)} = ${formatFixed(totalHitScale)} x ${formatFixed(levelScale)} x ${formatMultiplierPercent(perHitMultiplier, 10)}`,
    )
  }
  pushSection(
    sections,
    '// Core',
    `${joinInline([
      `Hit Scale ${formatFixed(totalHitScale)} = ${buildHitSpread(hits, (hit) => formatFixed(hit.multiplier))}`,
      `Level Scale ${formatFixed(levelScale)} = Tune Rupture scale at Lv ${level}`,
      `Class ${formatFixed(classMultiplier)} = Enemy Class ${enemy.class}`,
    ])}`,
    `Multi ${joinInline([
      `Total ${formatMultiplierPercent(perHitMultiplier, 10)}`,
      `Def ${formatMultiplierPercent(defenseMultiplier, 10)}`,
      `RES ${formatMultiplierPercent(resMult, 10)}`,
      hasNonZeroValue(dmgVuln) ? `Vuln ${formatMultiplierPercent(1 + dmgVuln / 100, 4)}` : null,
      hasNonZeroValue(finalStats.amplify) || hasNonZeroValue(tuneSkillType.dmgBonus) || hasNonZeroValue(finalStats.tuneBreakBoost)
        ? `Bonus ${formatMultiplierPercent(bonusMultiplier, 10)} = ${formatMultiplierPercent(1 + finalStats.amplify / 100, 4)} x ${formatMultiplierPercent(1 + tuneSkillType.dmgBonus / 100, 4)} x ${formatMultiplierPercent(1 + finalStats.tuneBreakBoost / 100, 4)}`
        : null,
    ]).replaceAll(' | ', ' x ')}`,
  )
  pushSection(
    sections,
    '// Enemy',
    `${joinInline([
      ignoresEnemy
        ? `Def ${formatMultiplierPercent(defenseMultiplier, 10)} = No enemy selected`
        : `Def ${formatMultiplierPercent(defenseMultiplier, 10)} = ${formatFixed(800 + 8 * level)} / (${formatFixed(800 + 8 * level)} + ${formatFixed(Math.max(0, enemyDefense))})`,
      ignoresEnemy
        ? `RES ${formatMultiplierPercent(resMult, 10)} = No enemy selected`
        : `RES ${formatMultiplierPercent(resMult, 10)} = RES after shred ${formatPercent(enemyResValue)}`,
    ])}`,
  )
  pushSection(
    sections,
    '// Final',
    `${joinInline([
      hasNonZeroValue(critRatePercent) ? `Rate ${formatPercent(critRatePercent)} = Skill Tune Rupture Crit Rate` : null,
      `Dmg ${formatPercent(critDmgPercent)} = Skill Tune Rupture Crit Damage`,
      `Crit ${formatWhole(entry.crit)} = ${formatWhole(entry.normal)} x ${formatPercent(critDmgPercent)}`,
      (skill.tuneRuptureCritRate ?? 0) >= 1
        ? `Avg ${formatWhole(entry.avg)} = Guaranteed crit because Crit Rate is ${formatPercent(critRatePercent)}`
        : `Avg ${formatWhole(entry.avg)} = (${formatWhole(entry.crit)} x ${formatPercent(critRatePercent)}) + (${formatWhole(entry.normal)} x ${formatPercent(100 - critRatePercent)})`,
    ])}`,
  )

  return joinSections(sections)
}

function getNegativeEffectBase(archetype: SkillDefinition['archetype'], level: number, stacks: number): number {
  if (
    archetype !== 'spectroFrazzle'
    && archetype !== 'aeroErosion'
    && archetype !== 'fusionBurst'
    && archetype !== 'glacioChafe'
    && archetype !== 'electroFlare'
  ) {
    return 0
  }

  return computeNegativeEffectBase(archetype, level, stacks)
}

function buildNegativeEffectConsoleText(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  combatState: CombatState,
): string {
  const { skill } = entry
  const sections: string[][] = []
  const effectArchetype = skill.archetype as Extract<
    SkillDefinition['archetype'],
    'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'
  >
  const stacks = effectArchetype === 'spectroFrazzle'
    ? combatState.spectroFrazzle
    : effectArchetype === 'aeroErosion'
      ? combatState.aeroErosion
      : effectArchetype === 'fusionBurst'
        ? combatState.fusionBurst
        : effectArchetype === 'glacioChafe'
          ? combatState.glacioChafe
        : combatState.electroFlare
  const extraStacks = effectArchetype === 'electroFlare'
    && combatState.electroFlare > getNegativeEffectDefaultMax('electroFlare')
    ? combatState.electroRage
    : 0
  const element = effectArchetype === 'spectroFrazzle'
    ? 'spectro'
    : effectArchetype === 'aeroErosion'
      ? 'aero'
      : effectArchetype === 'fusionBurst'
        ? 'fusion'
        : effectArchetype === 'glacioChafe'
          ? 'glacio'
        : 'electro'
  const aggregatedEffectType = aggregateSkillTypeBuffs(finalStats.skillType, skill.skillType)
  const negativeEffectBuff = finalStats.negativeEffect[effectArchetype as NegativeEffectKey]
  const attributeAll = finalStats.attribute.all
  const attributeElement = finalStats.attribute[element]
  const ignoresEnemy = isUnsetEnemyProfile(enemy)
  const baseRes = ignoresEnemy ? 0 : enemy.res[ATTRIBUTE_TO_ENEMY_RES_INDEX[element]]
  const resShred = attributeAll.resShred + attributeElement.resShred + aggregatedEffectType.resShred
  const defIgnore = finalStats.defIgnore + attributeAll.defIgnore + attributeElement.defIgnore + aggregatedEffectType.defIgnore
  const defShred = finalStats.defShred + attributeAll.defShred + attributeElement.defShred + aggregatedEffectType.defShred
  const dmgVuln = finalStats.dmgVuln + attributeAll.dmgVuln + attributeElement.dmgVuln + aggregatedEffectType.dmgVuln
  const enemyResValue = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = ignoresEnemy ? 1 : resistanceMultiplier(enemyResValue)
  const enemyDefenseBase = ignoresEnemy ? 0 : (8 * enemy.level) + 792
  const enemyDefense = ignoresEnemy ? 0 : enemyDefenseBase * (1 - (defIgnore + defShred) / 100)
  const defenseMultiplier = ignoresEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))
  const hits = resolveDamageHits(skill, 1)
  const totalHitScale = sumHitScale(hits)
  const perStackBase =
    getNegativeEffectBase(effectArchetype, level, stacks) +
    (effectArchetype === 'electroFlare' ? getNegativeEffectBase(effectArchetype, level, extraStacks) : 0)
  const bonusMultiplier =
    (1 + finalStats.amplify / 100) *
    (1 + aggregatedEffectType.amplify / 100) *
    (1 + aggregatedEffectType.dmgBonus / 100) *
    (1 + finalStats.special / 100)
  const negativeEffectMultiplier = 1 + negativeEffectBuff.multiplier
  const critRatePercent = ((skill.negativeEffectCritRate ?? 0) * 100) + negativeEffectBuff.critRate
  const critDmgPercent = ((skill.negativeEffectCritDmg ?? 1) * 100) + negativeEffectBuff.critDmg

  pushSection(sections, '// Summary', `Normal ${formatWhole(entry.normal)} | Crit ${formatWhole(entry.crit)} | Avg ${formatWhole(entry.avg)}`)

  if (stacks <= 0 && extraStacks <= 0) {
    pushSection(sections, '// Output', `Normal ${formatWhole(entry.normal)} = 0 because the current stack count is 0`)
    return joinSections(sections)
  }

  const totalMultiplier =
    negativeEffectMultiplier *
    bonusMultiplier *
    resMult *
    defenseMultiplier *
    (1 + dmgVuln / 100)

  pushSection(
    sections,
    '// Output',
    `Normal ${formatWhole(entry.normal)} = ${formatFixed(perStackBase)} x ${formatFixed(totalHitScale)} x ${formatMultiplierPercent(totalMultiplier, 10)}`,
  )
  pushSection(
    sections,
    '// Core',
    `${joinInline([
      effectArchetype === 'electroFlare'
        ? `Stacks ${formatFixed(stacks, 0)} + ${formatFixed(extraStacks, 0)} = Current Electro Flare + Electro Rage stacks`
        : `Stacks ${formatFixed(stacks, 0)} = Current ${getSkillTypeDisplay(skill.skillType).label} stacks`,
      effectArchetype === 'electroFlare'
        ? `Base ${formatFixed(perStackBase)} = Electro Flare base + Electro Rage base`
        : `Per Stack ${formatFixed(perStackBase)} = ${effectArchetype}`,
      `Hit Scale ${formatFixed(totalHitScale)} = ${buildHitSpread(hits, (hit) => formatFixed(hit.multiplier))}`,
    ])}`,
    `Multi ${joinInline([
      `Total ${formatMultiplierPercent(totalMultiplier, 10)}`,
      hasNonZeroValue(negativeEffectBuff.multiplier)
        ? `${getSkillTypeDisplay(skill.skillType).label} ${formatMultiplierPercent(negativeEffectMultiplier, 4)}`
        : null,
      hasNonZeroValue(finalStats.amplify) || hasNonZeroValue(aggregatedEffectType.amplify) || hasNonZeroValue(aggregatedEffectType.dmgBonus) || hasNonZeroValue(finalStats.special)
        ? `Bonus ${formatMultiplierPercent(bonusMultiplier, 10)} = ${formatMultiplierPercent(1 + finalStats.amplify / 100, 4)} x ${formatMultiplierPercent(1 + aggregatedEffectType.amplify / 100, 4)} x ${formatMultiplierPercent(1 + aggregatedEffectType.dmgBonus / 100, 4)} x ${formatMultiplierPercent(1 + finalStats.special / 100, 4)}`
        : null,
      `Def ${formatMultiplierPercent(defenseMultiplier, 10)}`,
      `RES ${formatMultiplierPercent(resMult, 10)}`,
      hasNonZeroValue(dmgVuln) ? `Vuln ${formatMultiplierPercent(1 + dmgVuln / 100, 4)}` : null,
    ]).replaceAll(' | ', ' x ')}`,
  )
  pushSection(
    sections,
    '// Enemy',
    `${joinInline([
      ignoresEnemy
        ? `Def ${formatMultiplierPercent(defenseMultiplier, 10)} = No enemy selected`
        : `Def ${formatMultiplierPercent(defenseMultiplier, 10)} = ${formatFixed(800 + 8 * level)} / (${formatFixed(800 + 8 * level)} + ${formatFixed(Math.max(0, enemyDefense))})`,
      ignoresEnemy
        ? `RES ${formatMultiplierPercent(resMult, 10)} = No enemy selected`
        : `RES ${formatMultiplierPercent(resMult, 10)} = RES after shred ${formatPercent(enemyResValue)}`,
    ])}`,
  )
  pushSection(
    sections,
    '// Final',
    `${joinInline([
      hasNonZeroValue(critRatePercent) ? `Rate ${formatPercent(critRatePercent)} = Skill + Negative Effect Crit Rate` : null,
      `Dmg ${formatPercent(critDmgPercent)} = Skill + Negative Effect Crit Damage`,
      `Crit ${formatWhole(entry.crit)} = ${formatWhole(entry.normal)} x ${formatPercent(critDmgPercent)}`,
      critRatePercent >= 100
        ? `Avg ${formatWhole(entry.avg)} = Guaranteed crit because Crit Rate is ${formatPercent(critRatePercent)}`
        : `Avg ${formatWhole(entry.avg)} = (${formatWhole(entry.crit)} x ${formatPercent(critRatePercent)}) + (${formatWhole(entry.normal)} x ${formatPercent(100 - critRatePercent)})`,
    ])}`,
  )

  return joinSections(sections)
}

export function buildSkillFormulaConsoleText(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  combatState: CombatState,
): string {
  switch (entry.skill.archetype) {
    case 'healing':
    case 'shield':
      return buildSupportConsoleText(entry, finalStats)
    case 'tuneRupture':
      return buildTuneRuptureConsoleText(entry, finalStats, enemy, level)
    case 'spectroFrazzle':
    case 'aeroErosion':
    case 'fusionBurst':
    case 'glacioChafe':
    case 'electroFlare':
      return buildNegativeEffectConsoleText(entry, finalStats, enemy, level, combatState)
    case 'skillDamage':
    default:
      return buildDirectDamageConsoleText(entry, finalStats, enemy, level)
  }
}
