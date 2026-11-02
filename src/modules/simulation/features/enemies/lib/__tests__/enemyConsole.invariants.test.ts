/*
  Author: Runor Ewhro
  description: checks enemy controls and summaries against numerical effects,
               including draft isolation, multi-operation rows, and shared owners.
*/

import { describe, expect, it } from 'vitest'
import { getGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listStatesFor, listResFeats } from '@/data/catalog/gameDataService'
import type { EnemyStatus } from '@/domain/entities/appState'
import { readRtPath } from '@/domain/gameData/runtimePath'
import { makeAppState, makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { projectScenarioUiRuntimes } from '@/engine/runtime/scenarioRuntime'
import { prepareResSimulation } from '@/engine/pipeline'
import { executeRotationProgram, executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'
import type { RotationNode } from '@/domain/gameData/contracts'
import { readEffects } from '../effects'
import { topStatMath } from '../effectMath'
import { prepareEnemyConsoleDraft } from '../draftSimulation'

const seed = getResSeedBy('1102')!
const runtime = makeResRuntime(seed)
const sources = Object.values(getGameData().sourcesByKey).filter((source) => source.source.type === 'enemy')

describe('enemy console numerical contracts', () => {
  it('applies Prowler resistance to damage in detailed, rowless, and portable rotations', () => {
    const enemy = { ...makeEnemy(), id: '320000560', status: { tuneStrain: 0, invisibility: false } }
    const env = prepareRunEnv(prepareResSimulation(runtime, seed, enemy).context, seed)
    const featureId = listResFeats(seed.id).find((feature) => feature.variant !== 'subHit')!.id
    const items: RotationNode[] = [
      { id: 'before', type: 'feature', featureId },
      { id: 'invisible', type: 'condition', changes: [{ type: 'set', path: 'enemy.status.invisibility', value: true }] },
      { id: 'after', type: 'feature', featureId },
    ]
    const prepared = prepareRotationProgram(items)
    const detailed = executeRotationProgram(env, prepared)
    expect(detailed.entries[1].avg / detailed.entries[0].avg).toBeCloseTo(0.5 / 0.8)
    const exact = executeRotationScore(env, prepared)
    const portable = compilePortableRotation(env, items, [], new Set(['before|0', 'after|0']), {}, undefined, undefined, { echoCount: 0 })
    expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(exact.total.avg, 8)
  })

  it.each(sources.map((source) => [source.source.id, source] as const))('projects every control and each effect once for %s', (id, source) => {
    for (const maximum of [false, true]) {
      const status: EnemyStatus = { tuneStrain: maximum ? 3 : 0 }
      for (const state of source.states ?? []) {
        status[state.id] = maximum
          ? state.kind === 'toggle' ? true : state.kind === 'select' ? state.options!.at(-1)!.id : state.max ?? 1
          : state.defaultValue ?? 0
      }
      const enemy = { ...makeEnemy(), id, status }
      const context = prepareResSimulation(runtime, seed, enemy).context
      const summary = readEffects(runtime, enemy, null, (field) => status[field], () => false)
      expect(summary.dmgVuln).toBeCloseTo(context.finalStats.dmgVuln, 10)
      expect(new Set(summary.rows.map((row) => row.id)).size).toBe(summary.rows.length)
      for (const state of source.states ?? []) {
        expect(summary.rows.filter((row) => row.state?.controlKey === state.controlKey)).toHaveLength(1)
      }
    }
  })

  it('counts Rustfire consumption once and includes Pavilion\'s conditional bonus', () => {
    const rustfire = { ...makeEnemy(), id: '340000300', status: { tuneStrain: 0, havocBaneStacks: 3, havocBaneConsumed: true } }
    const summary = readEffects(runtime, rustfire, null, (field) => rustfire.status[field as keyof typeof rustfire.status], () => false)
    expect(summary.dmgVuln).toBe(35)
    expect(summary.rows.filter((row) => row.state)).toHaveLength(2)
    for (const tuneStrain of [2, 3]) {
      const enemy = { ...makeEnemy(), id: '340000310', status: { tuneStrain } }
      const result = readEffects(runtime, enemy, null, () => undefined, () => false)
      expect(result.dmgVuln).toBe(tuneStrain < 3 ? 0 : 25)
      expect(result.rows[0].active).toBe(tuneStrain >= 3)
    }
  })

  it('retains immunity and all-attribute resistance readings outside damage totals', () => {
    const immune = readEffects(runtime, { ...makeEnemy(), id: '320000570' }, null, () => undefined, () => false)
    expect(immune.rows.flatMap((row) => row.readings)).toContainEqual(expect.objectContaining({ stat: 'immunity', active: true }))
    expect(immune.dmgVuln).toBe(0)
    const enemy = { ...makeEnemy(), id: '340000330', status: { tuneStrain: 0, paradox: 2 } }
    const summary = readEffects(runtime, enemy, null, (field) => enemy.status[field as keyof typeof enemy.status], () => false)
    expect(summary.dmgVuln).toBe(30)
    expect(summary.rows[0].readings).toHaveLength(2)
    expect(summary.rows[0].readings).toContainEqual(expect.objectContaining({ stat: 'resistance', scope: 'All-Attribute RES', value: -20 }))
  })

  it('deduplicates responder equations and includes modifiers outside their owner', () => {
    const seed = getResSeedBy('1510')!
    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.sequence = 6
    runtime.state.controls['resonator:1510:silent_debate:active'] = true
    runtime.state.manualBuffs.modifiers.push({ id: 'tbb', enabled: true, scope: 'topStat', stat: 'tuneBreakBoost', value: 100 })
    runtime.state.manualBuffs.modifiers.push({ id: 'final-damage', enabled: true, scope: 'topStat', stat: 'finalDmg', value: 17 })
    const enemy = { ...makeEnemy(), status: { tuneStrain: 3 } }
    const context = prepareResSimulation(runtime, seed, enemy).context
    const state = listStatesFor('resonator', seed.id).find((state) => state.controlKey === 'resonator:1510:silent_debate:active')!
    const single = topStatMath(runtime, state, enemy, context, 'finalDmg')
    expect(topStatMath(runtime, [state, state], enemy, context, 'finalDmg')).toEqual(single)
    const summary = readEffects(runtime, enemy, context, () => 3, (state) => readRtPath(runtime, state.path))
    expect(summary.finalDmg).toBeCloseTo(context.finalStats.finalDmg)
    expect(summary.rows.find((row) => row.id === 'other:finalDmg')?.value).toBeCloseTo(17)
  })

  it('previews draft resistance and manual effects without committing them', () => {
    const state = makeAppState()
    const scenario = state.combat.scenariosById[state.combat.selectedScenarioId]
    scenario.target = { ...makeEnemy(), id: '320000560', status: { tuneStrain: 0, invisibility: false } }
    scenario.environment.targetModifiers.resistanceReduction = { havoc: 7 }
    const before = structuredClone(scenario)
    const runtime = projectScenarioUiRuntimes(scenario).subjectRuntime
    const baseline = prepareEnemyConsoleDraft(scenario, runtime, scenario.target)!
    const draftRuntime = structuredClone(runtime)
    draftRuntime.state.manualBuffs.quick.critRate += 12
    const preview = prepareEnemyConsoleDraft(scenario, draftRuntime, { ...scenario.target, status: { tuneStrain: 0, invisibility: true } })!
    expect(preview.finalStats.attribute.all.resShred).toBe(-30)
    expect(preview.finalStats.attribute.havoc.resShred).toBe(7)
    expect(preview.finalStats.critRate).toBeCloseTo(baseline.finalStats.critRate + 12)
    expect(scenario).toEqual(before)
  })
})
