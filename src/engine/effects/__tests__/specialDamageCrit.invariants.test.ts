/*
  Author: Runor Ewhro
  description: preserves absent and explicitly authored special-damage crit
               scalars across numeric and portable skill effects.
*/

import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listSkillsFor } from '@/data/catalog/gameDataService'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { makeCombatGraph } from '@/engine/runtime/combatGraph'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'
import { calcSkillDamage } from '@/engine/formulas/damage'
import { applySkllDat } from '@/engine/effects/dataEffects'
import { prepareNumericSkill } from '@/engine/effects/numericTeam'
import { PortableTeam } from '@/engine/rotation/portable/team'
import { lowerDamage, lowerSkill } from '@/engine/rotation/portable/damage'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'

function fixture(resonatorId: string, mode = 'tune_rupture', sequence = 0) {
  const seed = getResSeedBy(resonatorId)!
  const runtime = makeResRuntime(seed)
  runtime.base.level = 90
  runtime.base.sequence = sequence
  runtime.build.echoes = [null, null, null, null, null]
  Object.assign(runtime.state.controls, {
    'resonator:1210:mode:value': mode,
    'resonator:1210:fusion_trail:value': 30,
    'resonator:1210:rupturous_trail:value': 30,
    'inherent:1208:lvl50:stacks': 4,
  })
  const enemy = makeEnemy()
  const graph = makeCombatGraph({ actRt: runtime, activeSeed: seed })
  const context = makeCombatEnv({ graph, targetSlotId: 'active', enemy })
  const raw = listSkillsFor('resonator', resonatorId)
    .find((skill) => skill.id === (resonatorId === '1210' ? '1210604' : '1208:tune-break'))!
  const skill = resolveSkill(runtime, raw)
  const numeric = context.numericTeam!
  const lane = numeric.program.laneById[resonatorId]!
  const portable = new PortableTeam(graph, enemy, resonatorId, [])
  return { runtime, enemy, graph, context, skill, numeric, lane, portable }
}

describe('special damage crit scalar defaults', () => {
  it.each([
    ['1210', 'tune_rupture', 'tuneRuptureCritDmg'],
    ['1210', 'fusion_burst', 'negativeEffectCritDmg'],
    ['1208', 'tune_rupture', 'tuneRuptureCritDmg'],
  ] as const)('preserves %s %s crit defaults under unrelated skill buffs', (id, mode, field) => {
    const { runtime, enemy, graph, context, skill, numeric, lane, portable } = fixture(id, mode)
    expect(skill[field]).toBeUndefined()
    const objectSkill = applySkllDat(runtime, skill, { graph, targetSlotId: 'active', enemy })
    const numericSkill = prepareNumericSkill(numeric, lane, skill)
    expect(numericSkill).not.toBe(skill)
    expect(numericSkill[field]).toBeUndefined()
    expect(numericSkill[field]).toBe(objectSkill[field])
    const result = calcSkillDamage(context.finalStats, numericSkill, enemy, 90)
    expect(result.normal).toBeGreaterThan(0)
    expect(result.crit).toBe(result.normal)
    expect(result.avg).toBe(result.normal)

    const lowered = lowerSkill(portable, lane, skill, {
      id: 'special-damage', label: skill.label, skillId: skill.id,
      source: { type: 'resonator', id },
    })
    const avg = lowerDamage(portable, lane, lowered, portable.finals[lane]!, {}, portable.ir.one)
    const program = portable.ir.finish([lowered.scalars[field]!, avg])
    const values = executeScalarProgram(program, new Float64Array(program.inputCount))
    expect(values[0]).toBe(1)
    expect(values[1]).toBeCloseTo(result.avg, 7)
  })

  it.each([0, 1.75])('preserves an explicit crit multiplier of %s', (critDmg) => {
    const { enemy, context, skill: baseSkill, numeric, lane, portable } = fixture('1208')
    const skill = { ...baseSkill, tuneRuptureCritDmg: critDmg }
    const prepared = prepareNumericSkill(numeric, lane, skill)
    expect(prepared.tuneRuptureCritDmg).toBe(critDmg)
    const result = calcSkillDamage(context.finalStats, prepared, enemy, 90)
    expect(result.crit).toBeCloseTo(result.normal * critDmg)
    const lowered = lowerSkill(portable, lane, skill, {
      id: 'explicit-crit', label: skill.label, skillId: skill.id,
      source: { type: 'resonator', id: '1208' },
    })
    expect(portable.ir.value(lowered.scalars.tuneRuptureCritDmg!)).toBe(critDmg)
  })

  it('retains explicitly targeted S6 crit scalar additions', () => {
    const { runtime, graph, enemy, skill, numeric, lane, portable } = fixture('1210', 'tune_rupture', 6)
    const objectSkill = applySkllDat(runtime, skill, { graph, targetSlotId: 'active', enemy })
    const prepared = prepareNumericSkill(numeric, lane, skill)
    expect(prepared.tuneRuptureCritRate).toBe(0.8)
    expect(prepared.tuneRuptureCritDmg).toBe(2.75)
    expect(prepared.tuneRuptureCritDmg).toBe(objectSkill.tuneRuptureCritDmg)
    const lowered = lowerSkill(portable, lane, skill, {
      id: 's6-crit', label: skill.label, skillId: skill.id,
      source: { type: 'resonator', id: '1210' },
    })
    expect(portable.ir.value(lowered.scalars.tuneRuptureCritRate!)).toBe(0.8)
    expect(portable.ir.value(lowered.scalars.tuneRuptureCritDmg!)).toBe(2.75)
    expect(portable.ir.value(lowered.scalars.negativeEffectCritDmg!)).toBe(1)
  })
})
