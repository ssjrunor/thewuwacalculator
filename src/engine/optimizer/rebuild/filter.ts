import type { EchoInstance, ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { DamageResult, FinalStats, SkillDefinition } from '@/domain/entities/stats'
import type { EnemyProfile } from '@/domain/entities/appState'
import { computeSkillDamage } from '@/engine/formulas/damage'

export type OptimizerStatWeightMap = Partial<Record<string, number>>

function cloneFinalStats(finalStats: FinalStats): FinalStats {
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
      healing: { ...finalStats.skillType.healing },
      shield: { ...finalStats.skillType.shield },
      tuneRupture: { ...finalStats.skillType.tuneRupture },
    },
  }
}

function scoreResult(result: DamageResult, skill: SkillDefinition): number {
  if (skill.aggregationType === 'healing' || skill.aggregationType === 'shield') {
    return result.avg
  }

  return result.avg
}

function computeMarginalWeight(
  finalStats: FinalStats,
  skill: SkillDefinition,
  enemy: EnemyProfile,
  level: number,
  combat: ResonatorRuntimeState['state']['combat'],
  mutate: (next: FinalStats) => void,
): number {
  const base = scoreResult(computeSkillDamage(finalStats, skill, enemy, level, combat), skill)
  const adjusted = cloneFinalStats(finalStats)
  mutate(adjusted)
  const boosted = scoreResult(computeSkillDamage(adjusted, skill, enemy, level, combat), skill)
  return Math.max(0, boosted - base)
}

export function buildOptimizerStatWeightMap(params: {
  finalStats: FinalStats
  skill: SkillDefinition
  enemy: EnemyProfile
  level: number
  combat: ResonatorRuntimeState['state']['combat']
}): OptimizerStatWeightMap {
  const { finalStats, skill, enemy, level, combat } = params

  return {
    atkPercent: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.atk.final += next.atk.base / 100
    }),
    atkFlat: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.atk.final += 1
    }),
    hpPercent: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.hp.final += next.hp.base / 100
    }),
    hpFlat: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.hp.final += 1
    }),
    defPercent: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.def.final += next.def.base / 100
    }),
    defFlat: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.def.final += 1
    }),
    critRate: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.critRate += 1
    }),
    critDmg: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.critDmg += 1
    }),
    energyRegen: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.energyRegen += 1
    }),
    healingBonus: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.healingBonus += 1
    }),
    basicAtk: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.skillType.basicAtk.dmgBonus += 1
    }),
    heavyAtk: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.skillType.heavyAtk.dmgBonus += 1
    }),
    resonanceSkill: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.skillType.resonanceSkill.dmgBonus += 1
    }),
    resonanceLiberation: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.skillType.resonanceLiberation.dmgBonus += 1
    }),
    aero: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.aero.dmgBonus += 1
    }),
    glacio: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.glacio.dmgBonus += 1
    }),
    fusion: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.fusion.dmgBonus += 1
    }),
    spectro: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.spectro.dmgBonus += 1
    }),
    havoc: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.havoc.dmgBonus += 1
    }),
    electro: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.electro.dmgBonus += 1
    }),
    physical: computeMarginalWeight(finalStats, skill, enemy, level, combat, (next) => {
      next.attribute.physical.dmgBonus += 1
    }),
  }
}

export function scoreEchoByWeightMap(
  echo: EchoInstance,
  weights: OptimizerStatWeightMap,
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

export function applyKeepPercentFilter(
  echoes: EchoInstance[],
  options: {
    keepPercent: number
    rotationMode: boolean
    lockedMainEchoId: string | null
    weights: OptimizerStatWeightMap | null
  },
): EchoInstance[] {
  const { keepPercent, rotationMode, lockedMainEchoId, weights } = options

  if (rotationMode || keepPercent <= 0 || !weights) {
    return echoes
  }

  const clampedKeep = Math.min(Math.max(keepPercent, 0), 1)
  const keepFraction = 1 - clampedKeep
  const keepCount = Math.max(1, Math.floor(echoes.length * keepFraction))

  const lockedEchoes = lockedMainEchoId
    ? echoes.filter((echo) => echo.id === lockedMainEchoId)
    : []
  const lockedUidSet = new Set(lockedEchoes.map((echo) => echo.uid))

  const scored = echoes
    .filter((echo) => !lockedUidSet.has(echo.uid))
    .map((echo) => ({
      echo,
      score: scoreEchoByWeightMap(echo, weights),
    }))
    .sort((left, right) => right.score - left.score)

  const nonLockedKeepCount = Math.max(0, keepCount - lockedEchoes.length)

  return [
    ...lockedEchoes,
    ...scored.slice(0, nonLockedKeepCount).map((entry) => entry.echo),
  ]
}
