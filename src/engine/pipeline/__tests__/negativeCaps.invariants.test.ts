/*
  Author: Runor Ewhro
  description: checks independent negative-effect stack caps and rotation execution parity.
*/

import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import type { RotationNode } from '@/domain/gameData/contracts'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { negEffectsFor } from '@/engine/gameData/negativeEffects'
import { prepareResSimulation } from '@/engine/pipeline'
import { executeRotationProgram, executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'
import { getNegBase } from '@/engine/formulas/negativeEffects'

describe('negative-effect cap changes during rotations', () => {
  it('scales enhanced Frazzle stacks in every damage executor and preserves fixed multipliers', () => {
    const seed = getResSeedBy('1407')!
    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.build.team = ['1407', null, null]
    runtime.build.echoes = [null, null, null, null, null]
    runtime.state.controls = {}
    runtime.state.combat.spectroFrazzle = 1
    const { context } = prepareResSimulation(runtime, seed, makeEnemy(), { '1407': runtime })
    const env = prepareRunEnv(context, seed)
    const counts = [0, 1, 10, 11, 12, 13, 16, 19]
    const base = getNegBase('spectroFrazzle', 90, 10)
    for (const count of counts) {
      const expected = count === 0 ? 0 : count <= 10 ? 209.9 + 895.8 * count : base * (1 + (count - 10) / 3)
      expect(getNegBase('spectroFrazzle', 90, count)).toBeCloseTo(expected, 8)
      if (count > 0) expect(getNegBase('spectroFrazzle', 90, count, { fixedMv: 5000 }))
        .toBeCloseTo(getNegBase('spectroFrazzle', 90, 1, { fixedMv: 5000 }), 8)
      // explicit tick stacks exercise both damage paths for the same count
      const items: RotationNode[] = [{ id: 'tick', type: 'feature', resonatorId: '1407',
        featureId: 'damage:1407:negative-effect:spectro-frazzle', negativeEffectStacks: count }]
      const program = prepareRotationProgram(items)
      const total = executeRotationProgram(env, program).entries.reduce((sum, entry) => sum + entry.avg, 0)
      expect(executeRotationScore(env, program).total.avg).toBeCloseTo(total, 6)
      const portable = compilePortableRotation(env, items, [], new Set(['tick|0']), {}, undefined, undefined, { echoCount: 0 })
      expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(total, 6)
    }
  })

  it('keeps RES Ignore and Shred separate in detailed, score and portable rotations', () => {
    const seed = getResSeedBy('1309')!
    const items: RotationNode[] = [
      { id: 'basic', type: 'feature', resonatorId: '1309', featureId: 'damage:1309001' },
      { id: 'flare', type: 'feature', resonatorId: '1309', featureId: 'damage:1309:negative-effect:electro-flare' },
    ]
    const results = [null, 'resIgnore', 'resShred'].map(mod => {
      const runtime = makeResRuntime(seed)
      runtime.base.level = 90
      runtime.build.team = ['1309', null, null]
      runtime.build.echoes = [null, null, null, null, null]
      runtime.state.controls = {}
      runtime.state.combat.electroFlare = 10
      if (mod) runtime.state.manualBuffs.modifiers.push({ id: 'res', enabled: true,
        scope: 'attribute', attribute: 'all', mod: mod as 'resIgnore' | 'resShred', value: 15 })
      const { context } = prepareResSimulation(runtime, seed, makeEnemy(), { '1309': runtime })
      const env = prepareRunEnv(context, seed), program = prepareRotationProgram(items)
      const entries = executeRotationProgram(env, program).entries
      const total = entries.reduce((sum, entry) => sum + entry.avg, 0)
      expect(executeRotationScore(env, program).total.avg).toBeCloseTo(total, 6)
      const portable = compilePortableRotation(env, items, [], new Set(['basic|0', 'flare|0']),
        {}, undefined, undefined, { echoCount: 0 })
      expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(total, 6)
      return entries.map(entry => entry.avg)
    })
    expect(results[1]![0]).toBeGreaterThan(results[0]![0]!)
    expect(results[1]![0]).toBeCloseTo(results[2]![0]!, 8)
    expect(results[1]![1]).toBeCloseTo(results[0]![1]!, 8)
    expect(results[2]![1]).toBeGreaterThan(results[0]![1]!)
  })

  it('keeps overflow Rage available at the ordinary Flare cap and scopes its payout to one tick in every executor', () => {
    const seed = getResSeedBy('1309')!
    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.build.team = ['1309', null, null]
    runtime.build.echoes = [null, null, null, null, null]
    runtime.state.controls = {}
    runtime.state.combat.electroFlare = 10
    runtime.state.combat.electroRage = 0
    const sources = negEffectsFor(runtime)
    expect(sources.find(source => source.key === 'electroFlare')?.max).toBe(10)
    expect(sources.find(source => source.key === 'electroRage')?.max).toBe(10)
    const hit = (id: string): Extract<RotationNode, { type: 'feature' }> => ({
      id, type: 'feature', resonatorId: '1309', featureId: 'damage:1309:negative-effect:electro-flare',
    })
    const items: RotationNode[] = [hit('base'), { ...hit('overflow'), attached: {
      conditions: [{ id: 'rage', type: 'condition', resonatorId: '1309', changes: [
        { type: 'set', path: 'enemy.combat.electroRage', value: 5 },
      ] }], features: [],
    } }, hit('spent')]
    const { context } = prepareResSimulation(runtime, seed, makeEnemy(), { '1309': runtime })
    const env = prepareRunEnv(context, seed), program = prepareRotationProgram(items)
    const detailed = executeRotationProgram(env, program)
    const values = detailed.entries.map(entry => entry.avg)
    expect(values).toHaveLength(3)
    expect(values[0]).toBeGreaterThan(0)
    expect(values[1]).toBeGreaterThan(values[0]!)
    expect(values[2]).toBeCloseTo(values[0]!, 8)
    const total = values.reduce((sum, value) => sum + value, 0)
    expect(executeRotationScore(env, program).total.avg).toBeCloseTo(total, 6)
    const portable = compilePortableRotation(env, items, [], new Set(['base|0', 'overflow|0', 'spent|0']),
      {}, undefined, undefined, { echoCount: 0 })
    expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(total, 6)
    const empty = structuredClone(runtime)
    empty.state.combat.electroFlare = 0
    expect(negEffectsFor(empty).some(source => source.key === 'electroRage')).toBe(true)
  })

  it.each([
    ['spectroFrazzle', 'spectro_frazzle', '1501'], ['fusionBurst', 'fusion_burst', '1210'],
    ['glacioChafe', 'glacio_chafe', '1109'], ['aeroErosion', 'aero_erosion', '1407'], ['electroFlare', 'electro_flare', '1309'],
  ])('raises only the corresponding Suisui %s cap, including Rage with Flare, without requiring the field to remain active', (status, slug, teammate) => {
    const runtime = makeResRuntime(getResSeedBy('1110')!)
    runtime.state.controls = {}
    runtime.build.team = ['1110', teammate, null]
    const other = makeResRuntime(getResSeedBy(teammate)!)
    other.state.controls = {}
    const maxima = () => {
      const current = structuredClone(runtime)
      return Object.fromEntries(negEffectsFor(current, { '1110': current, [teammate]: other }).map(source => [source.key, source.max]))
    }
    const base = maxima()
    runtime.state.controls['team:1110:ceaseless_landscape:active'] = true
    expect(maxima()).toEqual(base)
    runtime.state.controls['team:1110:ceaseless_landscape:active'] = false
    runtime.state.controls[`team:1110:ceaseless_${slug}_limit:active`] = true
    const raised = maxima()
    expect(raised[status]).toBe(base[status]! + 3)
    for (const [key, max] of Object.entries(raised)) {
      expect(max).toBe(base[key]! + (key === status || status === 'electroFlare' && key === 'electroRage' ? 3 : 0))
    }
  })

  it("applies the owner's current stack cap for persistent and attached cap changes in every executor", () => {
    const ids: [string, string, string] = ['1110', '1108', '1109']
    const runtimes = ids.map(id => {
      const runtime = makeResRuntime(getResSeedBy(id)!)
      runtime.base.level = 90
      runtime.build.team = ids
      runtime.build.echoes = [null, null, null, null, null]
      runtime.state.controls = {}
      return runtime
    })
    const cap = (id: string, value: boolean): Extract<RotationNode, { type: 'condition' }> => ({
      id, type: 'condition', resonatorId: '1110', changes: [{ type: 'set',
        path: 'runtime.state.controls.team:1110:ceaseless_glacio_chafe_limit:active', value, resonatorId: '1110' }],
    })
    const hit = (id: string, owner = '1110'): Extract<RotationNode, { type: 'feature' }> => ({
      id, type: 'feature', resonatorId: owner, featureId: `damage:${owner}:negative-effect:glacio-chafe`, negativeEffectStacks: 1,
    })
    const items: RotationNode[] = [hit('base'), { ...cap('field', true), changes: [{ type: 'set', path: 'runtime.state.controls.team:1110:ceaseless_landscape:active', value: true, resonatorId: '1110' }] }, hit('field-only'), cap('on', true), hit('own'), hit('ally', '1109'),
      cap('off', false), hit('cleared'), { ...hit('attached'), attached: { conditions: [cap('local-on', true)], features: [] } }, hit('restored')]
    const { context } = prepareResSimulation(runtimes[0]!, getResSeedBy('1110')!, makeEnemy(),
      Object.fromEntries(runtimes.map(runtime => [runtime.id, runtime])))
    const env = prepareRunEnv(context, getResSeedBy('1110')!), program = prepareRotationProgram(items)
    const detailed = executeRotationProgram(env, program)
    // the field alone leaves the cap at 10 and its separate window raises it to 13; the 1109 hit reads its own cap, and
    // the attached change applies only to its hit
    expect(detailed.entries.map(entry => entry.skill.stackMax)).toEqual([10, 10, 13, 13, 10, 13, 10])
    const values = detailed.entries.map(entry => entry.avg)
    expect(values[0]).toBeCloseTo(values[1]!, 7)
    expect(values[2]).toBeGreaterThan(values[0]!)
    expect(values[2]).toBeCloseTo(values[3]!, 7)
    expect(values[0]).toBeCloseTo(values[4]!, 7)
    expect(values[2]).toBeCloseTo(values[5]!, 7)
    expect(values[0]).toBeCloseTo(values[6]!, 7)
    const total = values.reduce((sum, value) => sum + value, 0)
    expect(executeRotationScore(env, program).total.avg).toBeCloseTo(total, 6)
    const portable = compilePortableRotation(env, items, [], new Set(['base', 'field-only', 'own', 'ally', 'cleared', 'attached', 'restored']
      .map(id => `${id}|0`)), {}, undefined, undefined, { echoCount: 0 })
    expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(total, 6)
  })
})
