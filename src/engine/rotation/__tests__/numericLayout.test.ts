/*
  Author: Runor Ewhro
  description: verifies the numericLayout.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import { makeResRuntime } from '@/engine/runtime/defaults.ts'
import type { ResSeed } from '@/domain/entities/runtime.ts'
import { mkRtBaseBuff } from '@/engine/pipeline/buildCombatContext.ts'
import { calcFinalStats } from '@/engine/formulas/finalStats.ts'
import {
  deriveFinalPlane,
  finalAttributeCell,
  packBuffPool,
  packFinalStats,
} from '@/engine/rotation/numericLayout.ts'

const seed: ResSeed = {
  id: 'numeric-layout',
  name: 'Numeric Layout',
  profile: '',
  attribute: 'fusion',
  weaponType: 1,
  defaultWeaponId: null,
  baseStats: {
    hp: 1000,
    atk: 100,
    def: 120,
    critRate: 5,
    critDmg: 150,
    energyRegen: 100,
    healingBonus: 0,
    tuneBreakBoost: 0,
  },
  skills: [],
  features: [],
  rotations: [],
}

describe('rotation numeric stat layout', () => {
  it('derives the exact final numeric plane from a packed buff pool', () => {
    const runtime = makeResRuntime(seed)
    runtime.state.manualBuffs.quick.atk.percent = 30
    runtime.state.manualBuffs.quick.atk.flat = 80
    runtime.state.manualBuffs.quick.critRate = 22
    runtime.state.manualBuffs.modifiers.push({
      id: 'fusion-bonus',
      enabled: true,
      scope: 'attribute',
      attribute: 'fusion',
      mod: 'dmgBonus',
      value: 45,
    })
    runtime.state.manualBuffs.modifiers.push(
      { id: 'ignore', enabled: true, scope: 'attribute', attribute: 'fusion', mod: 'resIgnore', value: 6 },
      { id: 'shred', enabled: true, scope: 'attribute', attribute: 'fusion', mod: 'resShred', value: 7 },
    )
    const pool = mkRtBaseBuff(runtime)
    const objectFinal = calcFinalStats(seed.baseStats, pool, 0)

    expect(objectFinal.attribute.fusion.resIgnore).toBe(6)
    expect(objectFinal.attribute.fusion.resShred).toBe(7)
    const packed = packFinalStats(objectFinal)
    expect(packed[finalAttributeCell('fusion', 'resIgnore')]).toBe(6)
    expect(packed[finalAttributeCell('fusion', 'resShred')]).toBe(7)
    expect([...deriveFinalPlane(seed.baseStats, 0, packBuffPool(pool))])
      .toEqual([...packFinalStats(objectFinal)])
  })
})
