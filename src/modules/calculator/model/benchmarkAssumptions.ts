/*
  Author: Runor Ewhro
  Description: benchmark scoring policy shared by the benchmark page and any
               other surface that renders a build benchmark score.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime, SkillLevels } from '@/domain/entities/runtime'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { MAX_RES_LVL, MAX_SKILL_LEVEL, MAX_WPN_LVL } from '@/domain/state/defaults'
import { wpnAtkAt } from '@/domain/state/weaponState'
import { mkMaxTrcNode } from '@/domain/state/traceNodes'

export const BENCH_ENEMY: EnemyProfile = {
  id: 'custom:benchmark',
  level: 100,
  class: 4,
  toa: false,
  source: 'custom',
  status: {
    tuneStrain: 0,
  },
  res: {
    0: 20,
    1: 20,
    2: 20,
    3: 20,
    4: 20,
    5: 20,
    6: 20,
  },
}

function normBenchTune(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return BENCH_ENEMY.status?.tuneStrain ?? 0
  }

  return Math.max(0, Math.min(10, Number(value)))
}

export function makeBenchEnemy(tuneStrain: number | null | undefined): EnemyProfile {
  return {
    ...BENCH_ENEMY,
    status: {
      ...(BENCH_ENEMY.status ?? { tuneStrain: 0 }),
      tuneStrain: normBenchTune(tuneStrain),
    },
  }
}

function maxSkillLevels(current: SkillLevels): SkillLevels {
  return {
    ...current,
    normalAttack: MAX_SKILL_LEVEL,
    resonanceSkill: MAX_SKILL_LEVEL,
    forteCircuit: MAX_SKILL_LEVEL,
    resonanceLiberation: MAX_SKILL_LEVEL,
    introSkill: MAX_SKILL_LEVEL,
    tuneBreak: MAX_SKILL_LEVEL,
  }
}

export function applyBenchAsm(runtime: ResRuntime): ResRuntime {
  const details = getResDtlsBy()[runtime.id]
  const traceNodes = details?.traceNodes ?? getResSeedBy(runtime.id)?.traceNodes ?? []

  return {
    ...runtime,
    base: {
      ...runtime.base,
      level: MAX_RES_LVL,
      sequence: runtime.base.sequence,
      skillLevels: maxSkillLevels(runtime.base.skillLevels),
      traceNodes: mkMaxTrcNode({ traceNodes }),
    },
    build: {
      ...runtime.build,
      weapon: {
        ...runtime.build.weapon,
        level: MAX_WPN_LVL,
        rank: runtime.build.weapon.rank,
        baseAtk: wpnAtkAt(runtime.build.weapon.id, MAX_WPN_LVL),
      },
    },
  }
}

export function applyBenchMapAsm(
  runtimesById: Record<string, ResRuntime>,
): Record<string, ResRuntime> {
  return Object.fromEntries(
    Object.entries(runtimesById).map(([id, runtime]) => [
      id,
      applyBenchAsm(runtime),
    ]),
  )
}
