/*
  Author: Runor Ewhro
  description: protects Denia's mode-only Shifting surge and its attachment scope.
*/

import { describe, expect, it } from 'vitest'
import { ensureResonatorData, initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { runDetailedResRotation } from '@/engine/pipeline'
import type { RotationNode } from '@/domain/gameData/contracts'

describe('Denia Shifting Off-Tune', () => {
  it.each(['beta', 'live'] as const)('keeps Banish consumed cores after a form change without restoring form ATK in %s', async (mode) => {
    await initGameData({ mode })
    await ensureResonatorData(['1211'])
    const seed = getResSeedBy('1211')!, denia = makeResRuntime(seed)
    denia.state.controls['resonator:1211:entropy_shift:active'] = true
    denia.state.controls['resonator:1211:entropy_shift_breakdown:active'] = false
    denia.state.controls['resonator:1211:dark_cores:value'] = 0
    const items: RotationNode[] = [{ id: 'base', type: 'feature', resonatorId: '1211', featureId: 'damage:1211105' }, {
      id: 'spent', type: 'feature', resonatorId: '1211', featureId: 'damage:1211105',
      attached: { features: [], conditions: [{ id: 'cores', type: 'condition', resonatorId: '1211', changes: [{
        type: 'set', resonatorId: '1211', path: 'runtime.state.controls.resonator:1211:dark_cores:value', value: 3,
      }] }] },
    }, { id: 'later', type: 'feature', resonatorId: '1211', featureId: 'damage:1211105' }]
    const entries = runDetailedResRotation(denia, seed, makeEnemy(), {}, {}, { items }).entries
    expect(entries).toHaveLength(3)
    const stats = entries.map(entry => entry.effectiveStats!)
    expect(stats[1].multiplier).toBeCloseTo(stats[0].multiplier! * 5.5)
    expect(stats[2].multiplier).toBeCloseTo(stats[0].multiplier!)
    expect(stats[1].atk).toBe(stats[0].atk)
    expect(stats[2].atk).toBe(stats[0].atk)
  })
  it.each(['beta', 'live'] as const)('applies the attached surge before Entropy Shift without leaking to later hits in %s', async (mode) => {
    await initGameData({ mode })
    await ensureResonatorData(['1413', '1211'])
    const qingxiaoSeed = getResSeedBy('1413')!
    const deniaSeed = getResSeedBy('1211')!
    const qingxiao = makeResRuntime(qingxiaoSeed)
    const denia = makeResRuntime(deniaSeed)
    qingxiao.build.team = denia.build.team = ['1413', '1211', null]
    denia.state.controls['resonator:1211:mode:value'] = 'tune_strain'
    denia.state.controls['resonator:1211:entropy_shift:active'] = false
    denia.state.controls['team:1211:tune_strain_shifting:active'] = false
    const items: RotationNode[] = [{
      id: 'shifting-hit', type: 'feature', resonatorId: '1413', featureId: 'damage:1413201:hit:1',
      attached: { conditions: [{
        id: 'shifting-surge', type: 'condition', resonatorId: '1211',
        changes: [{ type: 'set', resonatorId: '1211',
          path: 'runtime.state.controls.team:1211:tune_strain_shifting:active', value: true }],
      }], features: [] },
    }, {
      id: 'later-hit', type: 'feature', resonatorId: '1413', featureId: 'damage:1413201:hit:1',
    }]
    const run = () => runDetailedResRotation(qingxiao, qingxiaoSeed, makeEnemy(), { '1211': denia }, {}, { items })
    const traces = run().entries.map(entry => entry.effectiveStats?.offTuneTrace)
    expect(traces[0]?.postTotal).toBeCloseTo(19.2)
    expect(traces[0]?.gain).toBeCloseTo(traces[0]!.rated + 19.2)
    expect(traces[1]?.postTotal).toBe(0)
    denia.state.controls['resonator:1211:mode:value'] = 'fusion_burst'
    expect(run().entries[0]?.effectiveStats?.offTuneTrace?.postTotal).toBe(0)
  })
})
