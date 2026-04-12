import { describe, expect, it } from 'vitest'
import type { TeamMemberRuntime } from '@/domain/entities/runtime'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import {
  MAX_RESONATOR_LEVEL,
  MAX_WEAPON_LEVEL,
  makeDefaultCombatState,
  makeDefaultTeamMemberRuntime,
  makeDefaultTraceNodeBuffs,
  makeMaxSkillLevels,
} from '@/domain/state/defaults'
import { materializeTeamMemberFromCompactRuntime } from '@/domain/state/runtimeMaterialization'
import { makeMaxTraceNodeBuffs } from '@/domain/state/traceNodes'
import { compactTeamMemberRuntime } from '../teamRuntime'

describe('optimizer teammate runtime', () => {
  it('materializes teammate progression as maxed from compact storage', () => {
    const seed = getResonatorSeedById('1102')
    if (!seed) {
      throw new Error('missing resonator 1102')
    }

    const compact = {
      ...makeDefaultTeamMemberRuntime(seed),
      base: {
        level: 1,
        sequence: 2,
        skillLevels: { ...makeMaxSkillLevels(), normalAttack: 1 },
        traceNodes: makeDefaultTraceNodeBuffs(),
      },
      build: {
        ...makeDefaultTeamMemberRuntime(seed).build,
        weapon: {
          ...makeDefaultTeamMemberRuntime(seed).build.weapon,
          level: 1,
        },
      },
    } as unknown as TeamMemberRuntime

    const runtime = materializeTeamMemberFromCompactRuntime(
      seed,
      compact,
      {},
      makeDefaultCombatState(),
      ['1207', seed.id, null],
    )

    expect(runtime.base.level).toBe(MAX_RESONATOR_LEVEL)
    expect(runtime.base.sequence).toBe(2)
    expect(runtime.base.skillLevels).toEqual(makeMaxSkillLevels())
    expect(runtime.base.traceNodes).toEqual(makeMaxTraceNodeBuffs(seed))
    expect(runtime.build.weapon.level).toBe(MAX_WEAPON_LEVEL)
  })

  it('compacts only editable teammate progression and weapon fields', () => {
    const seed = getResonatorSeedById('1102')
    if (!seed) {
      throw new Error('missing resonator 1102')
    }

    const runtime = materializeTeamMemberFromCompactRuntime(
      seed,
      makeDefaultTeamMemberRuntime(seed),
      {},
      makeDefaultCombatState(),
      ['1207', seed.id, null],
    )
    runtime.base.level = 1
    runtime.base.skillLevels.normalAttack = 1
    runtime.base.traceNodes = makeDefaultTraceNodeBuffs()
    runtime.build.weapon.level = 1

    const compact = compactTeamMemberRuntime(runtime)

    expect(compact.base).toEqual({ sequence: 0 })
    expect('level' in compact.base).toBe(false)
    expect('skillLevels' in compact.base).toBe(false)
    expect('traceNodes' in compact.base).toBe(false)
    expect('level' in compact.build.weapon).toBe(false)
  })
})
