import { describe, expect, it } from 'vitest'
import type { TeamMemRt } from '@/domain/entities/runtime'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import {
  MAX_RES_LVL,
  MAX_WPN_LVL,
  makeCombatState,
  makeTeamMember,
  makeTraceNode,
  mkMaxSkllLvl,
} from '@/domain/state/defaults'
import { matTeamMemFr } from '@/domain/state/runtimeMaterialization'
import { mkMaxTrcNode } from '@/domain/state/traceNodes'
import { teamRuntime } from '../lib/teamRuntime.ts'

describe('optimizer teammate runtime', () => {
  it('materializes teammate progression as maxed from compact storage', () => {
    const seed = getResSeedBy('1102')
    if (!seed) {
      throw new Error('missing resonator 1102')
    }

    const compact = {
      ...makeTeamMember(seed),
      base: {
        level: 1,
        sequence: 2,
        skillLevels: { ...mkMaxSkllLvl(), normalAttack: 1 },
        traceNodes: makeTraceNode(),
      },
      build: {
        ...makeTeamMember(seed).build,
        weapon: {
          ...makeTeamMember(seed).build.weapon,
          level: 1,
        },
      },
    } as unknown as TeamMemRt

    const runtime = matTeamMemFr(
      seed,
      compact,
      {},
      makeCombatState(),
      ['1207', seed.id, null],
    )

    expect(runtime.base.level).toBe(MAX_RES_LVL)
    expect(runtime.base.sequence).toBe(2)
    expect(runtime.base.skillLevels).toEqual(mkMaxSkllLvl())
    expect(runtime.base.traceNodes).toEqual(mkMaxTrcNode(seed))
    expect(runtime.build.weapon.level).toBe(MAX_WPN_LVL)
  })

  it('compacts only editable teammate progression and weapon fields', () => {
    const seed = getResSeedBy('1102')
    if (!seed) {
      throw new Error('missing resonator 1102')
    }

    const runtime = matTeamMemFr(
      seed,
      makeTeamMember(seed),
      {},
      makeCombatState(),
      ['1207', seed.id, null],
    )
    runtime.base.level = 1
    runtime.base.skillLevels.normalAttack = 1
    runtime.base.traceNodes = makeTraceNode()
    runtime.build.weapon.level = 1

    const compact = teamRuntime(runtime)

    expect(compact.base).toEqual({ sequence: 0 })
    expect('level' in compact.base).toBe(false)
    expect('skillLevels' in compact.base).toBe(false)
    expect('traceNodes' in compact.base).toBe(false)
    expect('level' in compact.build.weapon).toBe(false)
  })
})
