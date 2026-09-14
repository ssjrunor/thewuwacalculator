/*
  Author: Runor Ewhro
  Description: verifies that Twin Nova Dyad Origins stacks reach only the
               prepared Twin Nova skills used by damage evaluation.
*/

import { describe, expect, it } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { listSkillsFor } from '@/domain/services/gameDataService'
import { makeCombatGraph } from '@/domain/state/combatGraph'
import { makeEnemy, makeResRuntime } from '@/domain/state/defaults'
import { prepareNumericSkill } from '@/engine/effects/numericTeam'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'

function echo(id: string, mainEcho: boolean): EchoInstance {
  return {
    uid: `twin-nova-${id}`,
    id,
    set: 26,
    mainEcho,
    mainStats: {
      primary: { key: 'atkPercent', value: 0 },
      secondary: { key: 'atkFlat', value: 0 },
    },
    substats: {},
  }
}

function twinNovaEchoSkillBonus(
  mainEchoId: '6000179' | '6000180',
  stacks: number,
  includePair = true,
) {
  const pairedEchoId = mainEchoId === '6000179' ? '6000180' : '6000179'
  const seed = getResSeedBy('1108')
  if (!seed) throw new Error('Missing Hiyuki test seed')

  const runtime = makeResRuntime(seed)
  runtime.build.echoes = [
    echo(mainEchoId, true),
    includePair ? echo(pairedEchoId, false) : null,
    null,
    null,
    null,
  ]
  runtime.state.controls[`echo:${mainEchoId}:main:stacks`] = stacks
  const graph = makeCombatGraph({ actRt: runtime, activeSeed: seed })
  const context = makeCombatEnv({ graph, targetSlotId: 'active', enemy: makeEnemy() })
  const skills = listSkillsFor('echo', mainEchoId)
  if (skills.length !== 2 || !skills[0]) throw new Error(`Missing Twin Nova skills for ${mainEchoId}`)

  return {
    echoSkillBucket: context.buffs.skillType.echoSkill.dmgBonus,
    twinNovaBonuses: skills.map((skill) => (
      prepareNumericSkill(context.numericTeam, context.numericLane, skill).skillBuffs?.dmgBonus ?? 0
    )),
    unrelatedEchoSkillBonus: prepareNumericSkill(
      context.numericTeam,
      context.numericLane,
      { ...skills[0], id: 'echo:unrelated:skill:1' },
    ).skillBuffs?.dmgBonus ?? 0,
  }
}

describe('Twin Nova Echo effects', () => {
  it.each(['6000179', '6000180'] as const)(
    'adds 10%% skill-specific DMG per Dyad Origins stack for %s',
    (echoId) => {
      const inactive = twinNovaEchoSkillBonus(echoId, 0)
      const active = twinNovaEchoSkillBonus(echoId, 6)
      const unpaired = twinNovaEchoSkillBonus(echoId, 6, false)

      expect(inactive.twinNovaBonuses).toEqual([0, 0])
      expect(active.twinNovaBonuses).toEqual([60, 60])
      expect(unpaired.twinNovaBonuses).toEqual([0, 0])
      expect(active.echoSkillBucket).toBe(0)
      expect(active.unrelatedEchoSkillBonus).toBe(0)
    },
  )
})
