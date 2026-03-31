import { describe, expect, it } from 'vitest'
import { runResonatorSimulation } from '@/engine/pipeline'
import { createDefaultResonatorRuntime, makeDefaultEnemyProfile } from '@/domain/state/defaults'
import { getResonatorById } from '@/domain/services/catalogService'

describe('placeholder enemy handling', () => {
  it('ignores enemy defense and resistance when enemy id is 0', () => {
    const seed = getResonatorById('1412')
    if (!seed) {
      throw new Error('missing seed resonator 1412')
    }

    const runtime = createDefaultResonatorRuntime(seed)
    const baselineEnemy = makeDefaultEnemyProfile()
    const inflatedIgnoredEnemy = {
      ...makeDefaultEnemyProfile(),
      id: '0',
      level: 120,
      class: 6,
      toa: true,
      res: {
        0: 80,
        1: 80,
        2: 80,
        3: 80,
        4: 80,
        5: 80,
        6: 80,
      },
    }

    const baseline = runResonatorSimulation(runtime, seed, baselineEnemy)
    const ignored = runResonatorSimulation(runtime, seed, inflatedIgnoredEnemy)

    expect(ignored.total.normal).toBeCloseTo(baseline.total.normal)
    expect(ignored.total.crit).toBeCloseTo(baseline.total.crit)
    expect(ignored.total.avg).toBeCloseTo(baseline.total.avg)
  })
})
