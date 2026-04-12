import { describe, expect, it } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import {
  deriveTeammateEchoPlan,
  resolveTeammateEchoPlan,
  type TeammateEchoPlan,
} from '@/modules/calculator/components/optimizer/teammateEchoPlan'

function makeEcho(id: string, set: number, uid: string, mainEcho = false): EchoInstance {
  return {
    uid,
    id,
    set,
    mainEcho,
    mainStats: {
      primary: { key: 'atkPercent', value: 0 },
      secondary: { key: 'atkFlat', value: 0 },
    },
    substats: {},
  }
}

describe('teammate echo plan', () => {
  it('seeds the plan from the current runtime echoes without changing a valid inherited main echo', () => {
    const baseEchoes = [
      makeEcho('6000199', 30, 'main', true),
      makeEcho('6000187', 30, 'one'),
      makeEcho('6000195', 30, 'two'),
      makeEcho('6000188', 30, 'three'),
      makeEcho('6000196', 30, 'four'),
    ]

    const resolved = resolveTeammateEchoPlan(baseEchoes, null)

    expect(deriveTeammateEchoPlan(baseEchoes)).toEqual({
      mainEchoMode: 'inherit',
      mainEchoId: '6000199',
      setMode: 'inherit',
      setPreferences: [{ setId: 30, count: 5 }],
    })
    expect(resolved.invalidMainEchoId).toBeNull()
    expect(resolved.effectiveEchoes[0]?.id).toBe('6000199')
  })

  it('uses a valid selected main echo for a selected 5pc set plan', () => {
    const baseEchoes = [
      makeEcho('6000199', 30, 'main', true),
      makeEcho('6000187', 30, 'one'),
      makeEcho('6000195', 30, 'two'),
      makeEcho('6000188', 30, 'three'),
      makeEcho('6000196', 30, 'four'),
    ]
    const plan: TeammateEchoPlan = {
      mainEchoMode: 'selected',
      mainEchoId: '6000192',
      setMode: 'selected',
      setPreferences: [{ setId: 31, count: 5 }],
    }

    const resolved = resolveTeammateEchoPlan(baseEchoes, plan)

    expect(resolved.invalidMainEchoId).toBeNull()
    expect(resolved.effectiveEchoes[0]?.id).toBe('6000192')
    expect(resolved.effectiveEchoes[1]?.id).toBe('optimizer-set:31:1')
  })

  it('keeps an invalid selected main echo visible-only by excluding it from the effective loadout', () => {
    const baseEchoes = [
      makeEcho('6000199', 30, 'main', true),
      makeEcho('6000187', 30, 'one'),
      makeEcho('6000195', 30, 'two'),
      makeEcho('6000188', 30, 'three'),
      makeEcho('6000196', 30, 'four'),
    ]
    const plan: TeammateEchoPlan = {
      mainEchoMode: 'selected',
      mainEchoId: '6000199',
      setMode: 'selected',
      setPreferences: [{ setId: 31, count: 5 }],
    }

    const resolved = resolveTeammateEchoPlan(baseEchoes, plan)

    expect(resolved.invalidMainEchoId).toBe('6000199')
    expect(resolved.effectiveEchoes[0]?.id).toBe('optimizer-set:31:0')
  })
})
