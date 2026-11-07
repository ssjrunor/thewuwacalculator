/*
  Author: Runor Ewhro
  description: checks Chisa Ring multipliers across skill levels and sequence effects.
*/

import { beforeAll, describe, expect, it } from 'vitest'
import { initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, mkMaxResRt } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { prepSkill } from '@/engine/pipeline/prepareRuntimeSkill'

beforeAll(async () => { await initGameData({ mode: 'beta' }) })

describe('Chisa Ring multiplier composition', () => {
  it.each([[1, 0.013], [10, 0.0259]])('uses the level-%s Ring rate and scales its contribution once', (level, rate) => {
    const seed = getResSeedBy('1508')!
    const prepare = (points: number, woven: boolean, sequence = 0) => {
      const runtime = mkMaxResRt(seed, sequence)
      runtime.base.skillLevels.forteCircuit = level
      runtime.state.controls['resonator:1508:ring_of_chainsaw:value'] = points
      runtime.state.controls['resonator:1508:woven_myriad_convergence:active'] = woven
      return prepSkill({ runtime, skillId: '1508054', seed, enemy: makeEnemy(),
        runtimesById: makeRuntimeMap(runtime) })!.skill.multiplier
    }
    const base = prepare(0, false)
    expect(prepare(100, false)).toBeCloseTo(base + 100 * rate, 8)
    expect(prepare(100, true)).toBeCloseTo((base + 100 * rate) * 2.2, 8)
    expect(prepare(100, false, 3)).toBeCloseTo((base + 100 * rate) * 2.2, 8)
  })
})
