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

    type LegacyWeapon = typeof profile.runtime.build.weapon & { baseAtk?: number }
    const raw = structuredClone(state)
    const rawProfile = raw.calculator.profiles[resonatorId]
    ;(rawProfile.runtime.build.weapon as LegacyWeapon).baseAtk = 12345
    raw.calculator.inventoryBuilds.push({
      id: 'legacy-build',
      name: 'Legacy Build',
      resonatorId,
      resonatorName: 'Legacy',
      build: {
        weapon: {
          id: rawProfile.runtime.build.weapon.id,
          level: 90,
          rank: 1,
          baseAtk: 12345,
        } as LegacyWeapon,
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

    const parsed = persistedSchema.parse(raw)
    const parsedProfile = parsed.calculator.profiles[resonatorId]
    const parsedBuild = parsed.calculator.inventoryBuilds[0]
    const parsedRotation = parsed.calculator.inventoryRotations[0]
    const parsedMember = parsedRotation?.summary?.members?.[0]
    expect(parsedProfile).toBeDefined()
    expect(parsedBuild).toBeDefined()
    expect(parsedRotation).toBeDefined()
    expect(parsedMember).toBeDefined()

    expect(parsedProfile?.runtime.build.weapon).not.toHaveProperty('baseAtk')
    expect(parsedBuild?.build.weapon).not.toHaveProperty('baseAtk')
    expect(parsedBuild).not.toHaveProperty('resonatorName')
    expect(parsedRotation).not.toHaveProperty('resonatorName')
    expect(parsedMember).not.toHaveProperty('name')

    const hydrated = initAppState(parsed as unknown as Parameters<typeof initAppState>[0])
    expect(hydrated.calculator.profiles[resonatorId].runtime.build.weapon.baseAtk).toBeGreaterThan(0)
    expect(hydrated.calculator.inventoryBuilds[0].resonatorName).toBe(seed!.name)
    expect(hydrated.calculator.inventoryRotations[0].resonatorName).toBe(seed!.name)
    expect(hydrated.calculator.inventoryRotations[0].summary?.members?.[0]?.name).toBe(seed!.name)
  })
})
