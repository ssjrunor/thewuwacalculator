import { describe, expect, it } from 'vitest'

import { resSdsById } from '@/domain/services/resonatorSeedService'
import { DEF_RES_ID, initAppState, makeAppState, makeResProfile } from '@/domain/state/defaults'
import { persistedSchema } from '@/domain/state/schema'

describe('persistedSchema', () => {
  it('accepts legacy catalog snapshot fields and strips them from persisted storage', () => {
    const state = makeAppState()
    const resonatorId = DEF_RES_ID
    const seed = resSdsById[resonatorId]
    expect(seed).toBeDefined()
    state.calculator.profiles[resonatorId] = makeResProfile(seed!)

    const profile = state.calculator.profiles[resonatorId]
    expect(profile).toBeDefined()

    const raw = structuredClone(state) as any
    raw.calculator.profiles[resonatorId].runtime.build.weapon.baseAtk = 12345
    raw.calculator.inventoryBuilds.push({
      id: 'legacy-build',
      name: 'Legacy Build',
      resonatorId,
      resonatorName: 'Legacy',
      build: {
        weapon: {
          id: raw.calculator.profiles[resonatorId].runtime.build.weapon.id,
          level: 90,
          rank: 1,
          baseAtk: 12345,
        },
        echoes: [null, null, null, null, null],
      },
      createdAt: 1,
      updatedAt: 1,
    })
    raw.calculator.inventoryRotations.push({
      id: 'legacy-rotation',
      name: 'Legacy Rotation',
      mode: 'team',
      resonatorId,
      resonatorName: 'Legacy',
      duration: 10,
      note: '',
      team: [resonatorId, null, null],
      items: [],
      summary: {
        total: { normal: 1, avg: 1, crit: 1 },
        members: [
          {
            id: resonatorId,
            name: 'Legacy',
            contribution: { normal: 1, avg: 1, crit: 1 },
          },
        ],
      },
      createdAt: 1,
      updatedAt: 1,
    })

    const parsed = persistedSchema.parse(raw) as any

    expect(parsed.calculator.profiles[resonatorId].runtime.build.weapon.baseAtk).toBeUndefined()
    expect(parsed.calculator.inventoryBuilds[0].build.weapon.baseAtk).toBeUndefined()
    expect(parsed.calculator.inventoryBuilds[0].resonatorName).toBeUndefined()
    expect(parsed.calculator.inventoryRotations[0].resonatorName).toBeUndefined()
    expect(parsed.calculator.inventoryRotations[0].summary.members[0].name).toBeUndefined()

    const hydrated = initAppState(parsed)
    expect(hydrated.calculator.profiles[resonatorId].runtime.build.weapon.baseAtk).toBeGreaterThan(0)
    expect(hydrated.calculator.inventoryBuilds[0].resonatorName).toBe(seed!.name)
    expect(hydrated.calculator.inventoryRotations[0].resonatorName).toBe(seed!.name)
    expect(hydrated.calculator.inventoryRotations[0].summary?.members?.[0]?.name).toBe(seed!.name)
  })
})
