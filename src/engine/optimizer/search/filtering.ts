/*
  Author: Runor Ewhro
  Description: estimates marginal stat weights from live damage recomputation
               so optimizer defaults can bias toward the current target skill.
*/

import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import type { DamageResult, FinalStats, SkillDef } from '@/domain/entities/stats.ts'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import { calcSkillDamage } from '@/engine/formulas/damage.ts'

export type OptStatWeight = Partial<Record<string, number>>

// clone only the branches that marginal-weight mutations may touch
function cloneFnlStts(finalStats: FinalStats): FinalStats {
  return {
    ...finalStats,
    atk: { ...finalStats.atk },
    hp: { ...finalStats.hp },
    def: { ...finalStats.def },
    attribute: {
      ...finalStats.attribute,
      all: { ...finalStats.attribute.all },
      aero: { ...finalStats.attribute.aero },
      glacio: { ...finalStats.attribute.glacio },
      spectro: { ...finalStats.attribute.spectro },
      fusion: { ...finalStats.attribute.fusion },
      electro: { ...finalStats.attribute.electro },
      havoc: { ...finalStats.attribute.havoc },
      physical: { ...finalStats.attribute.physical },
    },
    skillType: {
      ...finalStats.skillType,
      all: { ...finalStats.skillType.all },
      basicAtk: { ...finalStats.skillType.basicAtk },
      heavyAtk: { ...finalStats.skillType.heavyAtk },
      resonanceSkill: { ...finalStats.skillType.resonanceSkill },
      resonanceLiberation: { ...finalStats.skillType.resonanceLiberation },
      introSkill: { ...finalStats.skillType.introSkill },
      outroSkill: { ...finalStats.skillType.outroSkill },
      echoSkill: { ...finalStats.skillType.echoSkill },
      coord: { ...finalStats.skillType.coord },
      spectroFrazzle: { ...finalStats.skillType.spectroFrazzle },
      aeroErosion: { ...finalStats.skillType.aeroErosion },
      fusionBurst: { ...finalStats.skillType.fusionBurst },
      havocBane: { ...finalStats.skillType.havocBane },
      glacioChafe: { ...finalStats.skillType.glacioChafe },
      electroFlare: { ...finalStats.skillType.electroFlare },
      healing: { ...finalStats.skillType.healing },
      shield: { ...finalStats.skillType.shield },
      tuneRupture: { ...finalStats.skillType.tuneRupture },
      hack: { ...finalStats.skillType.hack },
    },
  }
}

// collapse one computed result into the scalar score used for weight comparison
function scoreResult(result: DamageResult, skill: SkillDef): number {
  if (skill.aggregationType === 'healing' || skill.aggregationType === 'shield') {
    return result.avg
  }

  return result.avg
}

// measure how much one synthetic stat bump changes the current skill result
function marginWeight(
  finalStats: FinalStats,
  skill: SkillDef,
  enemy: EnemyProfile,
  level: number,
  combat: ResRuntime['state']['combat'],
  mutate: (next: FinalStats) => void,
): number {
  const base = scoreResult(calcSkillDamage(finalStats, skill, enemy, level, combat), skill)
  const adjusted = cloneFnlStts(finalStats)
  mutate(adjusted)
  const boosted = scoreResult(calcSkillDamage(adjusted, skill, enemy, level, combat), skill)
  return Math.max(0, boosted - base)
}

// build the stat weight map consumed by default-setting helpers and filters
export function makeStatWeights(params: {
  finalStats: FinalStats
  skill: SkillDef
  enemy: EnemyProfile
  level: number
  combat: ResRuntime['state']['combat']
}): OptStatWeight {
  const { finalStats, skill, enemy, level, combat } = params

  return {
    atkPercent: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.atk.final += next.atk.base / 100
    }),
    atkFlat: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.atk.final += 1
    }),
    hpPercent: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.hp.final += next.hp.base / 100
    }),
    hpFlat: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.hp.final += 1
    }),
    defPercent: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.def.final += next.def.base / 100
    }),
    defFlat: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.def.final += 1
    }),
    critRate: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.critRate += 1
    }),
    critDmg: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.critDmg += 1
    }),
    energyRegen: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.energyRegen += 1
    }),
    healingBonus: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.healingBonus += 1
    }),
    basicAtk: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.skillType.basicAtk.dmgBonus += 1
    }),
    heavyAtk: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.skillType.heavyAtk.dmgBonus += 1
    }),
    resonanceSkill: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.skillType.resonanceSkill.dmgBonus += 1
    }),
    resonanceLiberation: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.skillType.resonanceLiberation.dmgBonus += 1
    }),
    aero: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.aero.dmgBonus += 1
    }),
    glacio: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.glacio.dmgBonus += 1
    }),
    fusion: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.fusion.dmgBonus += 1
    }),
    spectro: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.spectro.dmgBonus += 1
    }),
    havoc: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.havoc.dmgBonus += 1
    }),
    electro: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.electro.dmgBonus += 1
    }),
    physical: marginWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.physical.dmgBonus += 1
    }),
  }
}

export function scrEchoByWgh(
  echo: EchoInstance,
  weights: OptStatWeight,
): number {
  let total = 0

  const apply = (key: string, value: number) => {
    total += (weights[key] ?? 0) * value
  }

  apply(echo.mainStats.primary.key, echo.mainStats.primary.value)
  apply(echo.mainStats.secondary.key, echo.mainStats.secondary.value)

  for (const [key, value] of Object.entries(echo.substats)) {
    apply(key, value)
  }

  return total
}

export function applyKeepPrc(
  echoes: EchoInstance[],
  options: {
    keepPercent: number
    rotationMode: boolean
    lockedMainId: string | null
    weights: OptStatWeight | null
  },
): EchoInstance[] {
  const { keepPercent, rotationMode, lockedMainId: lockMainEcho, weights } = options

  if (rotationMode || keepPercent <= 0 || !weights) {
    return echoes
  }

  const clampedKeep = Math.min(Math.max(keepPercent, 0), 1)
  const keepFraction = 1 - clampedKeep
  const keepCount = Math.max(1, Math.floor(echoes.length * keepFraction))

  const lockedEchoes = lockMainEcho
    ? echoes.filter((echo) => echo.id === lockMainEcho)
    : []
  const lockedUidSet = new Set(lockedEchoes.map((echo) => echo.uid))

  const scored = echoes
    .filter((echo) => !lockedUidSet.has(echo.uid))
    .map((echo) => ({
      echo,
      score: scrEchoByWgh(echo, weights),
    }))
    .sort((left, right) => right.score - left.score)

  const nonLckdKeepC = Math.max(0, keepCount - lockedEchoes.length)

  return [
    ...lockedEchoes,
    ...scored.slice(0, nonLckdKeepC).map((entry) => entry.echo),
  ]
}
