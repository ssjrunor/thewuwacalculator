/*
  Author: Runor Ewhro
  description: checks that Unison follow-up hits keep their Liberation and coordinated attack modifiers, and that
               earned weapon bonuses apply to off-field recipients until their ending state.
*/

import { describe, expect, it } from 'vitest'
import { initGameData, ensureResonatorData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { runDetailedResRotation } from '@/engine/pipeline'
import type { RotationNode } from '@/domain/gameData/contracts'

describe('Unison follow-up damage and earned weapon bonuses', () => {
  it.each(['beta', 'live'] as const)('retains both Liberation and coordination modifiers in %s', async mode => {
    await initGameData({ mode })
    await ensureResonatorData(['1311', '1312'])
    for (const [id, skill] of [['1311', '1311303'], ['1312', '1312025']] as const) {
      const seed = getResSeedBy(id)!, runtime = makeResRuntime(seed)
      const items: RotationNode[] = [{ id: 'hit', type: 'feature', resonatorId: id, featureId: `damage:${skill}` }]
      const run = () => runDetailedResRotation(runtime, seed, makeEnemy(), {}, {}, { items }).entries[0]!
      const before = run()
      runtime.state.manualBuffs.modifiers.push(
        { id: 'liberation', enabled: true, scope: 'skillType', skillType: 'resonanceLiberation', mod: 'dmgBonus', value: 100 },
        { id: 'coordination', enabled: true, scope: 'skillType', skillType: 'coord', mod: 'dmgBonus', value: 40 },
      )
      const after = run()
      expect(after.skill.skillType).toEqual(['resonanceLiberation', 'coord'])
      expect(after.effectiveStats!.bonus! - before.effectiveStats!.bonus!).toBeCloseTo(140, 8)
    }
  })

  it.each(['beta', 'live'] as const)('retains earned Lullaby ATK on off-field recipients and ends it with Soothed Soul in %s', async mode => {
    await initGameData({ mode })
    await ensureResonatorData(['1512', '1311', '1312'])
    const ids: [string, string, string] = ['1512', '1311', '1312']
    const members = Object.fromEntries(ids.map(id => {
      const runtime = makeResRuntime(getResSeedBy(id)!)
      runtime.base.level = 90
      runtime.build.team = ids
      runtime.state.controls = {}
      return [id, runtime]
    }))
    const lily = members['1512']!
    lily.build.weapon = { id: '21030076', level: 90, rank: 1, baseAtk: 412.5 }
    const hit = (owner: string, skill: string, suffix: string): RotationNode => ({
      id: `${owner}-${suffix}`, type: 'feature', resonatorId: owner, featureId: `damage:${skill}`,
    })
    const control = (key: string, value: boolean): RotationNode => ({ id: `${key}-${value}`, type: 'condition',
      resonatorId: '1512', changes: [{ type: 'set', path: `runtime.state.controls.weapon:21030076:passive:${key}`, value, resonatorId: '1512' }] })
    const hits = (suffix: string) => [hit('1311', '1311303', suffix), hit('1312', '1312025', suffix)]
    const items: RotationNode[] = [
      { id: 'active', type: 'condition', changes: [{ type: 'set', path: 'runtime.rotation.activeResonatorId', value: '1512' }] },
      ...hits('before'), control('soothed_soul', true), control('unison_atk', true),
      ...hits('earned'), control('soothed_soul', false), ...hits('ended'),
    ]
    const run = () => runDetailedResRotation(members['1311']!, getResSeedBy('1311')!, makeEnemy(), members, {}, { items }).entries
    const rankOne = run()
    expect(rankOne).toHaveLength(6)
    lily.build.weapon.rank = 5
    const rankFive = run()
    for (const index of [0, 1]) {
      const base = rankOne[index]!.effectiveStats!.atk!
      const gain = rankOne[index + 2]!.effectiveStats!.atk! - base
      expect(gain).toBeGreaterThan(0)
      expect(rankOne[index + 4]!.effectiveStats!.atk!).toBeCloseTo(base, 8)
      expect(rankFive[index + 2]!.effectiveStats!.atk! - rankFive[index]!.effectiveStats!.atk!).toBeCloseTo(2 * gain, 8)
    }
  })
})
