/*
  Author: Runor Ewhro
  Description: Verifies grouped suggestion identity, distinct set-bonus
               matching, and exact scored weapon-state materialization.
*/

import { describe, expect, it } from 'vitest'
import type { SetPlanSuggest, WeaponEntry } from '@/engine/suggestions/types.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { mkMaxResRt } from '@/domain/state/defaults.ts'
import { groupWeaponSuggestions, materializeWeaponSuggestion, sameSetPlanCandidate } from '../results.ts'

describe('suggestion candidate identity', () => {
  it('recognizes the worn alternative without changing the grouped display', () => {
    const result: SetPlanSuggest = {
      avgDamage: 4_751_280,
      setPlan: [{ setId: 34, pieces: 3 }, { setId: 1, pieces: 2 }],
      displayPlan: [{ setIds: [34], pieces: 3 }, { setIds: [1, 35, 36, 37], pieces: 2 }],
      echoes: [],
    }
    const before = structuredClone(result)
    expect(sameSetPlanCandidate(result, [{ setId: 34, pieces: 3 }, { setId: 35, pieces: 2 }], result.avgDamage)).toBe(true)
    expect(sameSetPlanCandidate(result, [{ setId: 33, pieces: 3 }, { setId: 35, pieces: 2 }], result.avgDamage)).toBe(false)
    expect(sameSetPlanCandidate(result, result.setPlan, result.avgDamage * 1.01)).toBe(false)
    expect(result).toEqual(before)
  })

  it('matches distinct bonuses when a greedy first choice would block another slot', () => {
    const result: SetPlanSuggest = {
      avgDamage: 100, echoes: [], setPlan: [],
      displayPlan: [{ setIds: [1, 2], pieces: 2 }, { setIds: [1], pieces: 2 }],
    }
    expect(sameSetPlanCandidate(result, [{ setId: 1, pieces: 2 }, { setId: 2, pieces: 2 }], 100)).toBe(true)
    expect(sameSetPlanCandidate(result, [{ setId: 1, pieces: 5 }], 100)).toBe(false)
  })

  it('groups weapon variants without depending on adjacency or changing their order', () => {
    const first = { weaponId: 'a', mode: 'max' } as WeaponEntry
    const second = { weaponId: 'b', mode: 'max' } as WeaponEntry
    const resting = { weaponId: 'a', mode: 'default' } as WeaponEntry
    expect(groupWeaponSuggestions([first, second, resting])).toEqual([
      { id: 'a', plans: [first, resting] }, { id: 'b', plans: [second] },
    ])
  })

  it('applies the scored weapon controls without restoring omitted passive state', () => {
    const seed = getResSeedBy('1506')!
    const runtime = mkMaxResRt(seed)
    const weapon = runtime.build.weapon
    runtime.state.controls = { ...runtime.state.controls, [`weapon:${weapon.id}:omitted`]: true, 'resonator:keep': 7 }
    const plan = {
      weaponId: weapon.id, level: weapon.level, rank: weapon.rank, baseAtk: weapon.baseAtk,
      damage: 100, controls: { [`weapon:${weapon.id}:scored`]: 2 },
    } as WeaponEntry
    const candidate = materializeWeaponSuggestion(runtime, plan)
    expect(candidate.state.controls[`weapon:${weapon.id}:omitted`]).toBeUndefined()
    expect(candidate.state.controls['resonator:keep']).toBe(7)
    expect(candidate.build.weapon).toEqual(weapon)
    expect(candidate.state.controls[`weapon:${weapon.id}:scored`]).toBe(2)
    expect(runtime.state.controls[`weapon:${weapon.id}:omitted`]).toBe(true)
  })
})
