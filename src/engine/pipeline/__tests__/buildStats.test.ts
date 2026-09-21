/*
  Author: Runor Ewhro
  Description: Verifies that build-stat projection includes build-bound
               passives while excluding live combat control state.
*/

import { describe, expect, it } from 'vitest'
import { getResSeedBy, resResBaseSt } from '@/data/catalog/resonatorSeedService.ts'
import { makeResRuntime } from '@/engine/runtime/defaults.ts'
import { getBuildStats } from '@/engine/pipeline/buildStats.ts'
import { makeStatsView } from '@/modules/simulation/model/statsView.ts'

describe('build stats', () => {
  it('includes build-bound resonator passives in their stats', () => {
    const seed = getResSeedBy('1212')
    if (!seed) throw new Error('Missing Jingran seed')
    const runtime = makeResRuntime(seed)
    const stats = getBuildStats(runtime, resResBaseSt(seed, runtime.base.level))
    const healingBonus = Math.min(stats.hp.final * 0.0062, 310)

    expect(stats.healingBonus).toBeCloseTo(healingBonus, 10)
    expect(
      makeStatsView(runtime, stats).secondaryStats.find((row) => row.key === 'healingBonus')?.total,
    ).toBeCloseTo(healingBonus, 10)
  })

  it('does not promote live combat controls into build stats', () => {
    const seed = getResSeedBy('1212')
    if (!seed) throw new Error('Missing Jingran seed')
    const baseline = makeResRuntime(seed)
    const active = makeResRuntime(seed)
    active.state.controls['resonator:1212:fortune_in_disguise:stacks'] = 3
    const baseStats = resResBaseSt(seed, baseline.base.level)

    expect(getBuildStats(active, baseStats)).toEqual(getBuildStats(baseline, baseStats))
  })

  it('includes a weapon passive while excluding its stack-driven sibling effect', () => {
    const seed = getResSeedBy('1212')
    if (!seed) throw new Error('Missing Jingran seed')
    const runtime = makeResRuntime(seed)
    runtime.build.weapon = { id: '21010015', level: 1, rank: 1, baseAtk: 47 }
    runtime.state.controls['weapon:21010015:passive:stacks'] = 3
    const baseStats = resResBaseSt(seed, runtime.base.level)
    const stats = getBuildStats(runtime, baseStats)

    expect(stats.energyRegen).toBeCloseTo(baseStats.energyRegen + 12.8, 10)
    expect(stats.skillType.resonanceLiberation.dmgBonus).toBe(0)
  })
})
