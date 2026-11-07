/*
  Author: Runor Ewhro
  description: checks Hack damage and buff isolation across calculation paths.
*/

import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import type { RotationNode } from '@/domain/gameData/contracts'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
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
