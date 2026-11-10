/*
  Author: Runor Ewhro
  description: checks Zani buffs that depend on Heliacal Ember stacks.
*/

import { describe, expect, it } from 'vitest'
import { ensureResonatorData, initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { runDetailedResRotation } from '@/engine/pipeline'
import type { RotationNode } from '@/domain/gameData/contracts'

describe('Zani Beacon target prerequisite', () => {
  it.each(['beta', 'live'] as const)('applies the Beacon amplify only while Heliacal Ember is above zero and restores attached overrides in %s', async mode => {
    await initGameData({ mode })
    await ensureResonatorData(['1502', '1507'])
    const seed = getResSeedBy('1502')!, source = makeResRuntime(getResSeedBy('1507')!)
    const recipient = makeResRuntime(seed)
    recipient.build.team = source.build.team = ['1502', '1507', null]
    source.state.controls['team:1507:beacon_for_the_future:active'] = true
    source.state.controls['resonator:1507:heliacal_ember:value'] = 0
    const ember = (id: string, value: number): Extract<RotationNode, { type: 'condition' }> => ({
      id, type: 'condition', resonatorId: '1507', changes: [{ type: 'set',
        path: 'runtime.state.controls.resonator:1507:heliacal_ember:value', value, resonatorId: '1507' }],
    })
    const hit = (id: string): Extract<RotationNode, { type: 'feature' }> => ({
      id, type: 'feature', resonatorId: '1502', featureId: 'damage:4100026',
    })
    const items: RotationNode[] = [hit('unmarked'), { ...hit('local-mark'), attached: {
      conditions: [ember('local-ember', 1)], features: [],
    } }, hit('restored'), ember('bank', 7), hit('marked'), ember('consume', 0), hit('consumed')]
    const entries = runDetailedResRotation(recipient, seed, makeEnemy(), { '1507': source }, {}, { items }).entries
    const base = entries[0].effectiveStats!.amplify!
    expect(entries.map(entry => entry.effectiveStats!.amplify! - base)).toEqual([0, 20, 0, 20, 0])
    source.state.controls['team:1507:beacon_for_the_future:active'] = false
    const inactive = runDetailedResRotation(recipient, seed, makeEnemy(), { '1507': source }, {}, { items }).entries
    expect(inactive.every(entry => entry.effectiveStats!.amplify === base)).toBe(true)
  })
})

describe('Zani Outro consumed stack scaling', () => {
  it('scales the Outro multiplier by 10% per Ember and ignores damage bonus modifiers', async () => {
    await initGameData({ mode: 'beta' })
    await ensureResonatorData(['1507'])
    const seed = getResSeedBy('1507')!, runtime = makeResRuntime(seed)
    const items: RotationNode[] = [{ id: 'outro', type: 'feature', resonatorId: '1507', featureId: 'damage:1507:outro' }]
    const multiplier = () => runDetailedResRotation(runtime, seed, makeEnemy(), {}, {}, { items })
      .entries[0].effectiveStats!.multiplier!
    runtime.base.sequence = 0
    runtime.state.controls['resonator:1507:heliacal_ember:value'] = 0
    const plain = multiplier()
    runtime.state.controls['resonator:1507:heliacal_ember:value'] = 7
    expect(multiplier()).toBeCloseTo(plain * 1.7)
    runtime.state.manualBuffs.modifiers.push({ id: 'spectro-bonus', enabled: true, scope: 'attribute',
      attribute: 'spectro', mod: 'dmgBonus', value: 100 })
    expect(multiplier()).toBeCloseTo(plain * 1.7)
  })
})
