/*
  Author: Runor Ewhro
  description: tests Aemeath's named Duet mode payouts.
*/

import { describe, expect, it } from 'vitest'
import { ensureResonatorData, initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { prepareResSimulation, runDetailedResRotation } from '@/engine/pipeline'
import { executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'
import type { RotationNode } from '@/domain/gameData/contracts'

describe('Aemeath named Duet mode payouts', () => {
  it.each(['live', 'beta'] as const)('keeps volley counts and mode bonuses across detailed, score and portable execution in %s', async mode => {
    await initGameData({ mode })
    await ensureResonatorData(['1210'])
    const seed = getResSeedBy('1210')!, runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.forteCircuit = 10
    runtime.state.controls['resonator:1210:mode:value'] = 'tune_rupture'
    const items: RotationNode[] = [{ id: 'duet', type: 'feature', resonatorId: '1210', featureId: 'damage:1210604' }]
    const run = () => runDetailedResRotation(runtime, seed, makeEnemy(), {}, {}, { items }).entries[0]!
    const plain = run()
    expect(plain.effectiveStats!.multiplier).toBeCloseTo(1.0935 * 5)
    runtime.state.controls['resonator:1210:rupturous_trail:value'] = '30'
    expect(run().avg / plain.avg).toBeCloseTo(2.2)
    runtime.state.controls['resonator:1210:stardust_resonance:active'] = true
    const enhanced = run()
    expect(enhanced.avg / plain.avg).toBeCloseTo(4.4)
    const checkExecutors = (avg: number) => {
      const { context } = prepareResSimulation(runtime, seed, makeEnemy())
      const env = prepareRunEnv(context, seed)
      expect(executeRotationScore(env, prepareRotationProgram(items)).total.avg).toBeCloseTo(avg, 6)
      const portable = compilePortableRotation(env, items, [], new Set(['duet|0']), {}, undefined, undefined, { echoCount: 0 })
      expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(avg, 6)
    }
    checkExecutors(enhanced.avg)
    runtime.state.controls['resonator:1210:mode:value'] = 'fusion_burst'
    runtime.state.controls['resonator:1210:stardust_resonance:active'] = false
    const burst = run()
    runtime.state.controls['resonator:1210:fusion_trail:value'] = 22
    runtime.state.controls['resonator:1210:stardust_resonance:active'] = true
    const boostedBurst = run()
    expect(boostedBurst.archetype).toBe('fusionBurst')
    expect(boostedBurst.effectiveStats!.multiplier).toBeCloseTo(5.2)
    expect(boostedBurst.avg / burst.avg).toBeCloseTo(5.2)
    checkExecutors(boostedBurst.avg)
  })
})
