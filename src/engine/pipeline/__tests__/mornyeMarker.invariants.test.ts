/*
  Author: Runor Ewhro
  description: checks when Mornye's Interfered Marker applies its bonus to a teammate.
*/

import { describe, expect, it } from 'vitest'
import { ensureResonatorData, initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { runDetailedResRotation } from '@/engine/pipeline'
import type { RotationNode } from '@/domain/gameData/contracts'

describe('Mornye Interfered Marker prerequisites', () => {
  it.each(['beta', 'live'] as const)('applies Interfered Marker at S0 only during Tune Rupture or Tune Strain, at S1 always, and adds the S2 crit damage in %s', async mode => {
    await initGameData({ mode })
    await ensureResonatorData(['1209', '1509'])
    const seed = getResSeedBy('1509')!, sourceSeed = getResSeedBy('1209')!
    const recipient = makeResRuntime(seed), source = makeResRuntime(sourceSeed)
    recipient.base.sequence = 6
    source.base.sequence = 0
    source.state.manualBuffs.quick.energyRegen = 160
    recipient.build.team = source.build.team = ['1509', '1209', null]
    source.state.controls['resonator:1209:interfered_marker:active'] = true
    const path = 'runtime.state.controls.resonator:1209:interfered_marker:tune_rupture'
    const hit = (id: string): Extract<RotationNode, { type: 'feature' }> => ({
      id, type: 'feature', resonatorId: '1509', featureId: 'damage:1509006',
    })
    const items: RotationNode[] = [hit('no-interfered'), { ...hit('rupture'), attached: {
      conditions: [{ id: 'rupture-local', type: 'condition', resonatorId: '1209', changes: [
        { type: 'set', path, value: true, resonatorId: '1209' },
      ] }], features: [],
    } }, hit('restored')]
    const run = (enemy = makeEnemy()) => runDetailedResRotation(recipient, seed, enemy, { '1209': source }, {}, { items }).entries
    // at S0 only the hit with an attached Tune Rupture write gains the 40 damage bonus
    const baseline = run().map(entry => entry.effectiveStats!)
    expect(baseline[1].bonus! - baseline[0].bonus!).toBeCloseTo(40)
    expect(baseline[2].bonus).toBe(baseline[0].bonus)
    const strain = makeEnemy()
    strain.status = { ...strain.status, tuneStrain: 1 }
    expect(run(strain).every(entry => Math.abs(entry.effectiveStats!.bonus! - baseline[1].bonus!) < 1e-8)).toBe(true)
    source.base.sequence = 1
    expect(run().every(entry => Math.abs(entry.effectiveStats!.bonus! - baseline[1].bonus!) < 1e-8)).toBe(true)
    source.base.sequence = 2
    source.state.controls['team:1209:entropic_morning:active'] = true
    const s2 = run()
    expect(s2[0].effectiveStats!.critDmg! - baseline[0].critDmg!).toBeCloseTo(32)
    source.state.controls['resonator:1209:interfered_marker:active'] = false
    expect(run()[0].effectiveStats!.bonus).toBe(baseline[0].bonus)
  })
})
