/*
  Author: Runor Ewhro
  description: tests Denia's nearby-target Fusion Burst amplification.
*/

import { describe, expect, it } from 'vitest'
import { ensureResonatorData, initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { runDetailedResRotation } from '@/engine/pipeline'
import type { RotationNode } from '@/domain/gameData/contracts'

describe('Denia nearby-target Fusion Burst amplification', () => {
  it.each(['beta', 'live'] as const)('amplifies an off-field damage owner in %s', async mode => {
    await initGameData({ mode })
    await ensureResonatorData(['1211', '1206'])
    const seed = getResSeedBy('1211')!, teammateSeed = getResSeedBy('1206')!
    const denia = makeResRuntime(seed), teammate = makeResRuntime(teammateSeed)
    denia.build.team = teammate.build.team = ['1211', '1206', null]
    denia.state.controls['resonator:1211:mode:value'] = 'fusion_burst'
    const items: RotationNode[] = [{ id: 'active', type: 'condition', changes: [
      { type: 'set', path: 'runtime.rotation.activeResonatorId', value: '1206' },
    ] }, { id: 'burst', type: 'feature', resonatorId: '1211', featureId: 'damage:1211:negative-effect:fusion-burst',
      negativeEffectStacks: 10 }]
    const run = () => runDetailedResRotation(denia, seed, makeEnemy(), { '1206': teammate }, {}, { items }).entries
      .find(entry => entry.nodeId === 'burst')!
    const baseline = run()
    denia.state.controls['team:1211:unfinished_lies:active'] = true
    const amplified = run()
    expect(amplified.avg / baseline.avg).toBeCloseTo(1.6)
    expect(amplified.effectiveStats!.amplify).toBe(60)
    denia.state.controls['resonator:1211:mode:value'] = 'tune_strain'
    expect(run().effectiveStats!.amplify).toBe(0)
  })
})
