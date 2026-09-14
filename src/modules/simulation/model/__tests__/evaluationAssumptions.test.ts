/*
  Author: Runor Ewhro
  Description: Protects evaluation input normalization from progression-driven
               report invalidation.
*/

import { describe, expect, it } from 'vitest'
import { makeEvaluationKey } from '@/data/scoring/buildEvaluationKey.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeResRuntime } from '@/domain/state/defaults.ts'
import { applyEvaluationAsm, applyEvaluationMapAsm } from '@/modules/simulation/model/evaluationAssumptions.ts'

describe('evaluation assumptions', () => {
  it('gives progression variants the same normalized input identity', () => {
    const seed = getResSeedBy('1212')
    if (!seed) throw new Error('missing evaluation test seed')

    const low = makeResRuntime(seed)
    low.base = {
      ...low.base,
      level: 1,
      skillLevels: {
        ...low.base.skillLevels,
        normalAttack: 1,
        resonanceSkill: 2,
        forteCircuit: 3,
        resonanceLiberation: 4,
        introSkill: 5,
      },
    }
    low.build = {
      ...low.build,
      weapon: { ...low.build.weapon, level: 1, baseAtk: 1 },
    }

    const high = makeResRuntime(seed)
    high.base = {
      ...high.base,
      level: 80,
      skillLevels: {
        ...high.base.skillLevels,
        normalAttack: 6,
        resonanceSkill: 7,
        forteCircuit: 8,
        resonanceLiberation: 9,
        introSkill: 10,
      },
    }
    high.build = {
      ...high.build,
      weapon: { ...high.build.weapon, level: 80, baseAtk: 999 },
    }

    expect(makeEvaluationKey({
      runtime: applyEvaluationAsm(low),
      runtimesById: applyEvaluationMapAsm({ [low.id]: low }),
      targetSelections: {},
    })).toBe(makeEvaluationKey({
      runtime: applyEvaluationAsm(high),
      runtimesById: applyEvaluationMapAsm({ [high.id]: high }),
      targetSelections: {},
    }))
  })
})
