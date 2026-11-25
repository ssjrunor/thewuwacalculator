/*
  Author: Runor Ewhro
  description: verifies shared Rover mechanics across catalog forms and generated editor programs.
*/

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInterpreterEnvironment, interpretTeamActions } from '../index'
import { createCharacterRuleLibrary } from '../characterRules'
import type { RuntimeRecord } from '../types'
import { ROVER_PAIRS } from '@/domain/entities/roverGender'
import { convertRotationNodesRoverGender, convertScenarioRoverGender } from '@/application/state/roverGenderConversion'
import { makeScenarioTeam, type CombatScenario } from '@/domain/entities/combatScenario'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeResProfile, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { executeCombatScenarioProgram, prepareCombatScenario } from '@/engine/pipeline/combatScenario'
import { packTimeline } from '@/domain/rotationActions/timelines'
import type { ActionPlan, TimelineEvent } from '@/domain/rotationActions/types'

const json = async (path: string) => JSON.parse(await readFile(join(process.cwd(), path), 'utf8'))
const gameData = (path: string) => json(`public/data/beta/${path}.json`)
const interpretationData = (path: string) => json(`src/data/rotationGen/${path}.json`)

function totalDamage(scenario: CombatScenario): number {
  const run = executeCombatScenarioProgram(prepareCombatScenario(scenario), scenario.program.program)
  if (!run) throw new Error('Expected an executable Rover scenario')
  return run.entries.reduce((sum, entry) => sum + entry.avg, 0)
}

describe('Rover form parity', () => {
  it('binds references from another teammate using the same team-wide form choices', async () => {
    const index = { rulesets: { 1311: { name: 'Teammate' }, 1309: { name: 'Electro Rover' } } }
    const source = { schemaVersion: 2, state: {}, resonatorId: 1311, actions: {}, nodeFeatures: {}, effects: {}, rules: [
      { id: 'teammate', when: 1, conditions: [{ path: 'actorMember.resonator.id', operator: 'eq', value: 1309 }],
        operations: [{ op: 'setControl', path: 'runtime.state.controls.team:1309:resonance:active', value: true }] },
    ] }
    const library = createCharacterRuleLibrary(index, async id => id === '1311' ? source : { ...source, resonatorId: 1309 })
    const rules = await library.load(['1311', '1310'], 'beta')
    expect(rules['1311'].rules[0].conditions[0].value).toBe(1310)
    expect(rules['1311'].rules[0].operations[0].path).toContain('team:1310:')
    expect(source.rules[0]!.conditions[0]!.value).toBe(1309)
  })

  it.each(ROVER_PAIRS)('keeps $attribute form parity at its supported rotation boundary', async ({ male, female }) => {
    const environment = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const fixture = await json('src/engine/rotationGen/__tests__/fixtures/team.json')
    const original: CombatScenario = fixture.scenario
    const oldMember = original.team.members.find(member => member.resonatorId === '1502')!
    const member = makeScenarioMemberFromProfile(makeResProfile(getResSeedBy(male)!, { maxed: true }))
    member.id = oldMember.id
    member.loadout = structuredClone(oldMember.loadout)
    member.local.controls = male === '1309' ? { 'resonator:1309:mode:value': 'electro_flare' } : {}
    const scenario: CombatScenario = { ...original, team: makeScenarioTeam([member]), contextMemberId: member.id,
      initialOnFieldMemberId: member.id, program: { sequence: [], program: [], lastRanAt: null },
      environment: { ...original.environment, manualEffects: [], routing: { bySourceMemberId: { [member.id]: {} } } },
    }
    if (!environment.characters.has(male)) {
      // Havoc has no Riley action plan yet: verify its real catalog and saved-rotation boundary without made-up translation data
      const bundle = await gameData(`resonators/runtime-bundles/${male}`)
      scenario.program.program = [{ id: 'saved-basic', type: 'feature', resonatorId: male,
        featureId: bundle.source.features[0].id, multiplier: 1 }]
      const versions = ['male', 'female'].map(gender => convertScenarioRoverGender(scenario, gender as 'male' | 'female'))
      const damage = versions.map(totalDamage)
      expect(versions[1]!.team.members[0]!.resonatorId).toBe(female)
      expect(damage[0]).toBeGreaterThan(0)
      expect(damage[1]).toBeCloseTo(damage[0]!, 8)
      return
    }
    const rules = await environment.characters.load([male], 'beta')
    const action = Object.values(rules[male].actions as Record<string, RuntimeRecord>).find((candidate) =>
      candidate.cast === 0 && candidate.input === 'basic' && candidate.events.some((event: { damage?: unknown }) => event.damage))
    if (!action) throw new Error(`No basic attack for Rover ${male}`)
    const plan: ActionPlan = { schemaVersion: 1, kind: 'team-actions', teamId: `rover-${male}`, initialActiveSlot: 0,
      team: [{ resonatorId: male }], actions: { basic: { kind: 'resonator', resonatorId: male, sourceName: action.name } },
      referenceTiming: { durationSeconds: 20, sectionSeconds: [5, 5, 5, 5] },
      sections: Array.from({ length: 4 }, (_, pass) => ({ id: `section-${pass}`, kind: pass ? 'loop' : 'opener', pass,
        steps: [{ id: `cast-${pass}`, type: 'cast', actorSlot: 0, actionId: 'basic' }] })),
    }
    const before = JSON.stringify({ plan, scenario })
    const results = await Promise.all(['male', 'female'].map(gender =>
      interpretTeamActions(environment, plan, convertScenarioRoverGender(scenario, gender as 'male' | 'female'))))
    for (const result of results) expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (results[0]!.status !== 'interpreted' || results[1]!.status !== 'interpreted') return
    const [left, right] = results
    expect(right.scenario.team.members[0]!.resonatorId).toBe(female)
    expect(convertRotationNodesRoverGender(right.scenario.program.program, 'male'))
      .toEqual(convertRotationNodesRoverGender(left.scenario.program.program, 'male'))
    const damage = results.map(result => {
      if (result.status !== 'interpreted') return 0
      return totalDamage(result.scenario)
    })
    expect(damage[0]).toBeGreaterThan(0)
    expect(damage[1]).toBeCloseTo(damage[0]!, 8)
    expect(JSON.stringify({ plan, scenario })).toBe(before)
    const bundle = await gameData(`resonators/runtime-bundles/${male}`)
    const control = bundle.details.stateGraph.nodes.find((node: { kind: string }) => node.kind === 'toggle').key
    const names: string[] = []
    const events: TimelineEvent[] = Array.from({ length: 4 }, (_, pass) => [
      [pass * 180, 'section', pass],
      [pass * 180, 'control', `runtime.state.controls.${control}`, pass % 2],
      [pass * 180, 'cast', 0, action.name, -1],
    ] as TimelineEvent[]).flat()
    plan.timelines = { owns: { [male]: Object.values(rules[male].effects as Record<string, RuntimeRecord>).map(effect => effect.name).filter(Boolean) },
      names, runs: { [`0:${member.progression.sequence}`]: packTimeline({ seconds: 20, events }, names, new Map()) } }
    const stored = await Promise.all(['male', 'female'].map(gender =>
      interpretTeamActions(environment, plan, convertScenarioRoverGender(scenario, gender as 'male' | 'female'))))
    for (const result of stored) {
      expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
      expect(result.diagnostics.timelineSkipped).toEqual([])
    }
    if (stored[0]!.status !== 'interpreted' || stored[1]!.status !== 'interpreted') return
    expect(convertRotationNodesRoverGender(stored[1].scenario.program.program, 'male'))
      .toEqual(convertRotationNodesRoverGender(stored[0].scenario.program.program, 'male'))

  })
})
