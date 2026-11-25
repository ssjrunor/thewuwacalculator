/*
  Author: Runor Ewhro
  description: tests Denia's Void Particle damage classification.
*/

import { describe, expect, it } from 'vitest'
import { ensureResonatorData, initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { prepareResSimulation, runDetailedResRotation } from '@/engine/pipeline'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'
import { executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'
import type { RotationNode } from '@/domain/gameData/contracts'

describe('Denia Void Particle damage classification', () => {
  it.each(['beta', 'live'] as const)('changes whole attacks and hit rows to Liberation only while all prerequisites hold in %s', async mode => {
    await initGameData({ mode })
    await ensureResonatorData(['1211'])
    const seed = getResSeedBy('1211')!, runtime = makeResRuntime(seed)
    runtime.state.controls['resonator:1211:entropy_shift:active'] = true
    runtime.state.controls['resonator:1211:entropy_shift_breakdown:active'] = true
    runtime.state.manualBuffs.modifiers.push({ id: 'liberation-only', enabled: true,
      scope: 'skillType', skillType: 'resonanceLiberation', mod: 'dmgBonus', value: 100 })
    const items: RotationNode[] = ['1211008', '1211009', '1211010', '1211011', '1211009:hit:2'].map((id, index) => ({
      id: `attack-${index}`, type: 'feature', resonatorId: '1211', featureId: `damage:${id}`,
    }))
    const run = () => runDetailedResRotation(runtime, seed, makeEnemy(), {}, {}, { items }).entries
    const basic = run()
    expect(basic).toHaveLength(items.length)
    expect(basic.every(entry => resolveSkill(runtime, entry.skill).skillType.includes('basicAtk'))).toBe(true)
    runtime.state.controls['resonator:1211:void_particle:active'] = true
    const boosted = run()
    for (const [index, entry] of boosted.entries()) {
      expect(resolveSkill(runtime, entry.skill).skillType).toEqual(['resonanceLiberation'])
      expect(entry.effectiveStats!.bonus! - basic[index].effectiveStats!.bonus!, entry.nodeId).toBeCloseTo(100)
      expect(entry.effectiveStats!.multiplier! / basic[index].effectiveStats!.multiplier!).toBeCloseTo(1.5)
    }
    const { context } = prepareResSimulation(runtime, seed, makeEnemy())
    const env = prepareRunEnv(context, seed)
    const total = boosted.reduce((sum, entry) => sum + entry.avg, 0)
    expect(executeRotationScore(env, prepareRotationProgram(items)).total.avg).toBeCloseTo(total, 6)
    const portable = compilePortableRotation(env, items, [], new Set(items.map(node => `${node.id}|0`)),
      {}, undefined, undefined, { echoCount: 0 })
    expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(total, 6)
    for (const key of ['resonator:1211:entropy_shift:active', 'resonator:1211:entropy_shift_breakdown:active']) {
      runtime.state.controls[key] = false
      expect(run().every(entry => resolveSkill(runtime, entry.skill).skillType.includes('basicAtk'))).toBe(true)
      runtime.state.controls[key] = true
    }
  })
})
