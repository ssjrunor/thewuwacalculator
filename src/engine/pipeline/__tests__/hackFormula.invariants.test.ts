/*
  Author: Runor Ewhro
  description: checks Hack damage and buff isolation across calculation paths.
*/

import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import type { RotationNode } from '@/domain/gameData/contracts'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { makeOptContext } from '@/engine/search/context/compiled'
import { packTargetCtx } from '@/engine/search/context/pack'
import { CRIT_RATE, CRIT_DMG, DMG_AMP } from '@/engine/search/layout/constants'
import { prepSkill } from '@/engine/pipeline/prepareRuntimeSkill'
import { prepareResSimulation } from '@/engine/pipeline'
import { executeRotationProgram, executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'

describe('Hack formula execution parity', () => {
  it.each([['1308', 'damage:1411098'], ['1511', 'damage:1511038']])(
    'keeps %s Hack separate from amplification and Tune Rupture buffs in every executor', (id, featureId) => {
      const score = (amplify: number, ownBonus = 0, ruptureBonus = 0) => {
        const seed = getResSeedBy(id)!, runtime = makeResRuntime(seed)
        runtime.base.level = 90
        runtime.build.echoes = [null, null, null, null, null]
        runtime.state.manualBuffs.modifiers.push(
          { id: 'amp', enabled: true, scope: 'topStat', stat: 'amplify', value: amplify },
          { id: 'hack', enabled: true, scope: 'skillType', skillType: 'hack', mod: 'dmgBonus', value: ownBonus },
          { id: 'rupture', enabled: true, scope: 'skillType', skillType: 'tuneRupture', mod: 'dmgBonus', value: ruptureBonus },
        )
        const { context } = prepareResSimulation(runtime, seed, makeEnemy())
        const hack = prepSkill({ runtime, seed, enemy: makeEnemy(), skillId: featureId.replace('damage:', '') })
        if (!hack) throw new Error('Missing Hack skill')
        const target = makeOptContext({ resonatorId: id, runtime, skill: hack.skill,
          finalStats: hack.context.finalStats, enemy: makeEnemy() })
        expect(target.statAmp).toBe(0)
        expect(target.statCritRate).toBe(0)
        expect(target.statCritDmg).toBe(100)
        const packedTarget = packTargetCtx({ compiled: target, skill: hack.skill, runtime,
          comboN: 0, comboK: 0, comboCount: 0, comboBaseIndex: 0, lockEchoIdx: -1, setRtMask: 0 })
        expect(packedTarget[DMG_AMP]).toBe(1)
        expect(packedTarget[CRIT_RATE]).toBe(0)
        expect(packedTarget[CRIT_DMG]).toBe(1)
        const env = prepareRunEnv(context, seed)
        const items: RotationNode[] = [{ id: 'hit', type: 'feature', featureId }]
        const program = prepareRotationProgram(items)
        const detailed = executeRotationProgram(env, program)
        const exact = detailed.entries.reduce((sum, entry) => sum + entry.avg, 0)
        const rowless = executeRotationScore(env, program).total.avg
        const portable = compilePortableRotation(env, items, [], new Set(['hit|0']), {}, undefined, undefined, { echoCount: 0 })
        const packed = executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]!
        expect(rowless).toBeCloseTo(exact, 7)
        expect(packed).toBeCloseTo(exact, 7)
        return exact
      }
      const base = score(0)
      expect(base).toBeGreaterThan(0)
      expect(score(30, 0, 100)).toBeCloseTo(base, 7)
      expect(score(30, 25, 100)).toBeGreaterThan(base)
    },
  )
})
