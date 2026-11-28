/*
  Author: Runor Ewhro
  description: verifies that twin nova dyad origins stacks reach only the
               prepared twin nova skills used by damage evaluation.
*/

import { describe, expect, it } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listSkillsFor } from '@/data/catalog/gameDataService'
import { makeCombatGraph } from '@/engine/runtime/combatGraph'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
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
    includePair ? { ...echo(pairedEchoId, false), set: 27 } : null,
    null,
    null,
    null,
  ]
  runtime.state.controls[`echo:${mainEchoId}:main:stacks`] = stacks
  const graph = makeCombatGraph({ actRt: runtime, activeSeed: seed })
  const context = makeCombatEnv({ graph, targetSlotId: 'active', enemy: makeEnemy() })
  const skills = listSkillsFor('echo', mainEchoId)
  if (skills.length < 2 || !skills[0]) throw new Error(`Missing Twin Nova skills for ${mainEchoId}`)

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
    attributes: context.buffs.attribute,
    skills,
  }
}

describe('Twin Nova Echo effects', () => {
  it.each(['6000179', '6000180'] as const)(
    'adds 10%% skill-specific DMG per Dyad Origins stack for %s',
    (echoId) => {
      const inactive = twinNovaEchoSkillBonus(echoId, 0)
      const active = twinNovaEchoSkillBonus(echoId, 6)
      const unpaired = twinNovaEchoSkillBonus(echoId, 6, false)

      expect(inactive.twinNovaBonuses).toEqual(active.skills.map(() => 0))
      expect(active.twinNovaBonuses).toEqual(active.skills.map(() => 60))
      expect(unpaired.twinNovaBonuses).toEqual(active.skills.map(() => 0))
      expect(active.echoSkillBucket).toBe(0)
      expect(active.unrelatedEchoSkillBonus).toBe(0)
    },
  )

  it('converts the paired Blade passive and its two forms to Spectro', () => {
    const paired = twinNovaEchoSkillBonus('6000180', 6)
    const unpaired = twinNovaEchoSkillBonus('6000180', 6, false)
    expect(paired.attributes.spectro.dmgBonus - unpaired.attributes.spectro.dmgBonus).toBe(12)
    expect(unpaired.attributes.electro.dmgBonus - paired.attributes.electro.dmgBonus).toBe(12)
    expect(paired.skills.filter(skill => skill.id !== 'echo:6000180:skill:1')
      .map(skill => skill.element)).toEqual(['spectro', 'spectro'])
    expect(paired.skills[0]?.element).toBe('electro')
  })
})
