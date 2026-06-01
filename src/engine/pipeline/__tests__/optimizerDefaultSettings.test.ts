import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import {
  makeResRuntime,
  makeEnemy,
} from '@/domain/state/defaults'
import { deriveOptSets } from '@/engine/optimizer/config/defaultSettings.ts'

describe('optimizer default settings', () => {
  it('initializes a target skill and main-stat co-tags for a standard damage resonator', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    const settings = deriveOptSets({
      runtime,
      enemy: makeEnemy(),
    })

    expect(settings.targetSkillId).toBeTruthy()
    expect(settings.targetMode).toBe('skill')
    expect(settings.targetComboSourceId).toBe(`live:${runtime.id}`)
    expect(settings.mainStatFilter?.length ?? 0).toBeGreaterThan(0)
    expect(settings.mainStatFilter).toContain('bonus')
    expect(settings.selectedBonus).toBeTruthy()
  })

  it.each(['1206', '1209', '1412'])(
    'adds ER to the initial co-tags for special ER resonator %s',
    (resonatorId) => {
      const seed = getResSeedBy(resonatorId)
      expect(seed).toBeTruthy()
      if (!seed) {
        return
      }

      const runtime = makeResRuntime(seed)
      const settings = deriveOptSets({
        runtime,
        enemy: makeEnemy(),
      })

      expect(settings.targetSkillId).toBeTruthy()
      expect(settings.mainStatFilter).toContain('er')
    },
  )
})
