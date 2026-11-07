/*
  Author: Runor Ewhro
  description: preserves pinned recipients across runtime, portable, and scenario edits.
*/
import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listResFeats } from '@/data/catalog/gameDataService'
import { makeAppState, makeEnemy, makeResProfile, makeResRuntime, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { makeScenarioTeam, reviseCombatScenario } from '@/domain/entities/combatScenario'
import { projectScenarioRuntimes } from '@/engine/runtime/scenarioRuntime'
import { applyRuntimeToSimulation } from '@/engine/runtime/runtimeAdapters'
import { captureScenarioOtherTargets } from '@/engine/runtime/scenarioEffectTargets'
import { prepareResSimulation } from '@/engine/pipeline'
import { executeRotationProgram, executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'

const owner = 'team:1403:dissolving_mist'
const control = `state.controls.${owner}:active`
const route = `runtime.routing.selectedTargetsByOwnerKey.1403@${owner}`
const ids = ['1404', '1405', '1403'] as const
const change = (id: string, path: string, value: string | boolean, resonatorId?: string): Extract<RotationNode, { type: 'condition' }> => ({ id, type: 'condition',
  changes: [{ type: 'set', path, value, ...(resonatorId ? { resonatorId } : {}) }] })
const hit = (id: string, resonatorId: string): RotationNode => ({ id, type: 'feature', resonatorId,
  featureId: listResFeats(resonatorId).find(feature => feature.variant !== 'subHit')!.id })

function execute(items: RotationNode[], initiallyActive = false, savedTarget?: string) {
  const seeds = ids.map(id => getResSeedBy(id)!)
  const runtimes = seeds.map(seed => {
    const runtime = makeResRuntime(seed)
    runtime.build.team = [...ids]
    runtime.build.echoes = [null, null, null, null, null]
    if (seed.id === '1403') runtime.state.controls[`${owner}:active`] = initiallyActive
    return runtime
  })
  const { context } = prepareResSimulation(runtimes[0]!, seeds[0]!, makeEnemy(),
    Object.fromEntries(runtimes.slice(1).map(runtime => [runtime.id, runtime])),
    savedTarget ? { [`1403@${owner}`]: savedTarget } : {})
  const env = prepareRunEnv(context, seeds[0]!)
  const program = prepareRotationProgram(items)
  const exact = executeRotationProgram(env, program, { inspect: true, includeSnapshots: true })
  const packed = executeRotationScore(env, program)
  const portable = compilePortableRotation(env, items, [], new Set(items.filter(item => item.type === 'feature').map(item => `${item.id}|0`)),
    {}, undefined, undefined, { echoCount: 0 })
  const score = executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]!
  expect(score).toBeCloseTo(exact.entries.reduce((total, entry) => total + entry.avg, 0), 6)
  expect(packed.total.avg).toBeCloseTo(score, 6)
  return { values: exact.entries.map(entry => entry.avg), inspection: exact.inspection }
}

describe('Active Other recipient lifetime', () => {
  it('pins an initially enabled buff across swaps and honors a later source-qualified target condition', () => {
    const { values, inspection } = execute([
      change('opening', 'runtime.rotation.activeResonatorId', '1404'),
      hit('first', '1404'), change('swap', 'runtime.rotation.activeResonatorId', '1405'), hit('pinned', '1404'),
      change('retarget', route, '1405', '1403'), hit('removed', '1404'),
      change('return', 'runtime.rotation.activeResonatorId', '1404'), hit('still-removed', '1404'),
    ], true)
    expect(values).toHaveLength(4)
    expect(values[1]).toBeCloseTo(values[0]!, 8)
    expect(values[2]).toBeLessThan(values[0]!)
    expect(values[3]).toBeCloseTo(values[2]!, 8)
    expect(inspection.find(entry => entry.nodeId === 'pinned')?.selectedTargetsByRuntimeId?.['1403']?.[`1403@${owner}`]).toBe('1404')
  })

  it('pins initially enabled buffs to the first authored active member', () => {
    const items: RotationNode[] = [
      { ...change('disabled', 'runtime.rotation.activeResonatorId', '1404'), enabled: false },
      change('opening', 'runtime.rotation.activeResonatorId', '1405'), hit('first', '1405'),
      change('swap', 'runtime.rotation.activeResonatorId', '1404'), hit('still-pinned', '1405'),
    ]
    const { values, inspection } = execute(items, true, '1404')
    expect(values[1]).toBeCloseTo(values[0]!, 8)
    for (const nodeId of ['first', 'still-pinned']) {
      expect(inspection.find(entry => entry.nodeId === nodeId)?.selectedTargetsByRuntimeId?.['1403']?.[`1403@${owner}`]).toBe('1405')
    }
    expect(execute(items, true, '1405').values).toEqual(values)
  })

  it('recaptures on activation after swaps, ignoring saved targets but preserving authored target changes', () => {
    const { values, inspection } = execute([
      change('opening', 'runtime.rotation.activeResonatorId', '1404'), hit('before', '1405'),
      change('swap-in', 'runtime.rotation.activeResonatorId', '1405'),
      change('enable', `runtime.${control}`, true, '1403'),
      change('swap-away', 'runtime.rotation.activeResonatorId', '1404'), hit('buffed', '1405'),
      change('disable', `runtime.${control}`, false, '1403'),
      change('re-enable', `runtime.${control}`, true, '1403'), hit('recaptured', '1405'),
      change('retarget', route, '1405', '1403'),
      change('disable-again', `runtime.${control}`, false, '1403'),
      change('enable-again', `runtime.${control}`, true, '1403'), hit('explicit', '1405'),
    ], false, '1404')
    expect(values[1]).toBeGreaterThan(values[0]!)
    expect(values[2]).toBeCloseTo(values[0]!, 8)
    expect(values[3]).toBeCloseTo(values[1]!, 8)
    expect(inspection.find(entry => entry.nodeId === 'buffed')?.selectedTargetsByRuntimeId?.['1403']?.[`1403@${owner}`]).toBe('1405')
    expect(inspection.find(entry => entry.nodeId === 'recaptured')?.selectedTargetsByRuntimeId?.['1403']?.[`1403@${owner}`]).toBe('1404')
  })

  it('captures the active recipient at activation, before any later hit reads the buff', () => {
    const { values } = execute([
      hit('before', '1405'), change('swap-in', 'runtime.rotation.activeResonatorId', '1405'),
      change('enable', `runtime.${control}`, true, '1403'),
      change('swap-away', 'runtime.rotation.activeResonatorId', '1404'), hit('after', '1405'),
    ])
    expect(values).toHaveLength(2)
    expect(values[1]).toBeGreaterThan(values[0]!)
  })

  it('preserves activation-time recipients when uptime body state rejoins its parent', () => {
    const { values } = execute([
      hit('before', '1405'), { id: 'uptime', type: 'uptime', ratio: 0.5, items: [
        change('swap-in', 'runtime.rotation.activeResonatorId', '1405'),
        change('enable', `runtime.${control}`, true, '1403'),
        change('swap-away', 'runtime.rotation.activeResonatorId', '1404'),
      ] }, hit('after', '1405'),
      change('swap-to-source', 'runtime.rotation.activeResonatorId', '1403'), hit('still-pinned', '1405'),
    ], false, '1404')
    expect(values[1]).toBeGreaterThan(values[0]!)
    expect(values[2]).toBeCloseTo(values[1]!, 8)
  })

  it('persists the resolved recipient when a live scenario control turns on', () => {
    const members = ids.map(id => makeScenarioMemberFromProfile(makeResProfile(getResSeedBy(id)!)))
    members[2]!.local.controls[`${owner}:active`] = false
    const base = selectedCombatScenario(makeAppState().combat)
    const scenario = reviseCombatScenario(base, { team: makeScenarioTeam(members), initialOnFieldMemberId: members[1]!.id })
    const runtime = projectScenarioRuntimes(scenario).runtimesById['1403']!
    const edited = { ...runtime, state: { ...runtime.state, controls: { ...runtime.state.controls, [`${owner}:active`]: true } } }
    const next = applyRuntimeToSimulation(scenario, '1403', edited, runtime).scenario
    expect(next.environment.routing.bySourceMemberId[members[2]!.id]?.[owner]).toBe(members[1]!.id)
    const swapped = reviseCombatScenario(next, { initialOnFieldMemberId: members[0]!.id })
    expect(captureScenarioOtherTargets(swapped).environment.routing.bySourceMemberId[members[2]!.id]?.[owner]).toBe(members[1]!.id)
    expect(scenario.environment.routing.bySourceMemberId[members[2]!.id]?.[owner]).toBeUndefined()
  })
})
