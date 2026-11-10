/*
  Author: Runor Ewhro
  description: checks negative-effect stack caps when field changes toggle mid-rotation.
*/

import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import type { RotationNode } from '@/domain/gameData/contracts'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { prepareResSimulation } from '@/engine/pipeline'
import { executeRotationProgram, executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'

describe('negative-effect cap changes during rotations', () => {
  it("applies the owner's current stack cap for persistent and attached field changes in every executor", () => {
    const ids: [string, string, string] = ['1110', '1108', '1109']
    const runtimes = ids.map(id => {
      const runtime = makeResRuntime(getResSeedBy(id)!)
      runtime.base.level = 90
      runtime.build.team = ids
      runtime.build.echoes = [null, null, null, null, null]
      runtime.state.controls = {}
      return runtime
    })
    const field = (id: string, value: boolean): Extract<RotationNode, { type: 'condition' }> => ({
      id, type: 'condition', resonatorId: '1110', changes: [{ type: 'set',
        path: 'runtime.state.controls.team:1110:ceaseless_landscape:active', value, resonatorId: '1110' }],
    })
    const hit = (id: string, owner = '1110'): Extract<RotationNode, { type: 'feature' }> => ({
      id, type: 'feature', resonatorId: owner, featureId: `damage:${owner}:negative-effect:glacio-chafe`, negativeEffectStacks: 1,
    })
    const items: RotationNode[] = [hit('base'), field('on', true), hit('own'), hit('ally', '1109'),
      field('off', false), hit('cleared'), { ...hit('attached'), attached: { conditions: [field('local-on', true)], features: [] } }, hit('restored')]
    const { context } = prepareResSimulation(runtimes[0]!, getResSeedBy('1110')!, makeEnemy(),
      Object.fromEntries(runtimes.map(runtime => [runtime.id, runtime])))
    const env = prepareRunEnv(context, getResSeedBy('1110')!), program = prepareRotationProgram(items)
    const detailed = executeRotationProgram(env, program)
    // the field raises 1110's cap from 10 to 13; the 1109 hit reads its own cap, and the
    // attached change applies to its hit only
    expect(detailed.entries.map(entry => entry.skill.stackMax)).toEqual([10, 13, 13, 10, 13, 10])
    const values = detailed.entries.map(entry => entry.avg)
    expect(values[1]).toBeGreaterThan(values[0]!)
    expect(values[1]).toBeCloseTo(values[2]!, 7)
    expect(values[0]).toBeCloseTo(values[3]!, 7)
    expect(values[1]).toBeCloseTo(values[4]!, 7)
    expect(values[0]).toBeCloseTo(values[5]!, 7)
    const total = values.reduce((sum, value) => sum + value, 0)
    expect(executeRotationScore(env, program).total.avg).toBeCloseTo(total, 6)
    const portable = compilePortableRotation(env, items, [], new Set(['base', 'own', 'ally', 'cleared', 'attached', 'restored']
      .map(id => `${id}|0`)), {}, undefined, undefined, { echoCount: 0 })
    expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(total, 6)
  })
})
