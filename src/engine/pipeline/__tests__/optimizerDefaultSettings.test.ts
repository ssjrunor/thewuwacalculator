import { describe, expect, it } from 'vitest'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import {
  createDefaultResonatorRuntime,
  makeDefaultEnemyProfile,
} from '@/domain/state/defaults'
import { deriveInitialOptimizerSettings } from '@/engine/optimizer/rebuild/defaultSettings'

describe('optimizer default settings', () => {
  it('initializes a target skill and main-stat co-tags for a standard damage resonator', () => {
    const seed = getResonatorSeedById('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = createDefaultResonatorRuntime(seed)
    const settings = deriveInitialOptimizerSettings({
      runtime,
      enemy: makeDefaultEnemyProfile(),
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
      const seed = getResonatorSeedById(resonatorId)
      expect(seed).toBeTruthy()
      if (!seed) {
        return
      }

      const runtime = createDefaultResonatorRuntime(seed)
      const settings = deriveInitialOptimizerSettings({
        runtime,
        enemy: makeDefaultEnemyProfile(),
      })

      expect(settings.targetSkillId).toBeTruthy()
      expect(settings.mainStatFilter).toContain('er')
    },
  )
})
