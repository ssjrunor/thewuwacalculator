/*
  Author: Runor Ewhro
  Description: Verifies legacy special-damage keys migrate to the canonical final-damage stat contract.
*/

import { describe, expect, it } from 'vitest'
import { getRotFormulaStatKey } from '@/domain/gameData/rotationFormulaStats'
import { mnlBffsSchm } from '@/engine/runtime/manualBuffsSchema'

const quickBuffs = {
  atk: { percent: 0, flat: 0 },
  hp: { percent: 0, flat: 0 },
  def: { percent: 0, flat: 0 },
  critRate: 0,
  critDmg: 0,
  energyRegen: 0,
  healingBonus: 0,
}

describe('final damage stat-key compatibility', () => {
  it('normalizes legacy manual buffs to finalDmg', () => {
    const parsed = mnlBffsSchm.parse({
      quick: quickBuffs,
      modifiers: [{
        id: 'legacy-final-dmg',
        enabled: true,
        scope: 'topStat',
        stat: 'special',
        value: 12,
      }],
    })

    expect(parsed.modifiers[0]).toMatchObject({
      scope: 'topStat',
      stat: 'finalDmg',
      value: 12,
    })
  })

  it('normalizes legacy rotation formula paths to finalDmg', () => {
    expect(getRotFormulaStatKey('runtime.rotation.formula.special')).toBe('finalDmg')
    expect(getRotFormulaStatKey('runtime.rotation.formula.finalDmg')).toBe('finalDmg')
  })
})
