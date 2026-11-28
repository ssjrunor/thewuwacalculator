/*
  Author: Runor Ewhro
  description: checks that optional data gaps stay out of the scoring failure path while strict audit diagnostics and
               the submitted builds are retained.
*/

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInterpreterEnvironment, interpretTeamActions } from '../index'
import { timelineFor } from '../events/timeline'
import { prepareEquipment, createGearLibrary } from '../gear'
import { canonicalResonatorId } from '@/domain/rotationActions/identities'
import { executeCombatScenarioProgram, prepareCombatScenario } from '@/engine/pipeline/combatScenario'
import type { ActionPlan } from '@/domain/rotationActions/types'
import type { CombatScenario } from '@/domain/entities/combatScenario'
import type { RuntimeRecord } from '../types'

const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'))
const gameData = (path: string) => json(join(process.cwd(), 'public/data/beta', `${path}.json`))
const interpretationData = (path: string) => json(join(process.cwd(), 'src/data/rotationGen', `${path}.json`))
const fixture = () => json(join(__dirname, 'fixtures/team.json')) as Promise<{ plan: ActionPlan; scenario: CombatScenario }>
const env = () => createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })

describe('partial scoring interpretation', () => {
  it('finds a reported timeline for every configured context at all seven sequences', async () => {
    const selections = await json('scripts/leaderboard/data/scenarios.json')
    const { plans } = await json('scripts/leaderboard/data/actions.json')
    let checked = 0, fallbacks = 0
    expect(Object.keys(selections.resonators)).toHaveLength(49)
    for (const [id, selection] of Object.entries(selections.resonators) as [string, RuntimeRecord][]) {
      for (const teamId of selection.teams) {
        const plan = plans[teamId] as ActionPlan
        const seat = plan.team.findIndex(member => canonicalResonatorId(member.resonatorId) === canonicalResonatorId(id))
        expect(seat).toBeGreaterThanOrEqual(0)
        for (let sequence = 0; sequence <= 6; sequence++) {
          const policy = { allowPartial: true, omissions: [] as RuntimeRecord[] }
          expect(timelineFor(plan, seat, sequence, policy), `${id}:${teamId}:s${sequence}`).not.toBeNull()
          checked++
          if (policy.omissions.length) {
            fallbacks++
            expect(id).toBe('1405')
            expect(sequence).toBeLessThan(2)
            expect(policy.omissions[0]).toMatchObject({ code: 'sequence-timeline-fallback', timelineSequence: 2 })
            expect(timelineFor(plan, seat, sequence)).toBeNull()
          }
        }
      }
    }
    expect(checked).toBe(228 * 7)
    expect(fallbacks).toBe(10)
  })

  it('retains the team rotation and readable stats with an unknown Echo, set and hit-reactive rule', async () => {
    const { plan, scenario } = await fixture(), environment = await env()
    const context = scenario.team.members.find(member => member.id === scenario.contextMemberId)!
    context.loadout.echoes[0] = { ...context.loadout.echoes[0]!, id: '999999999', set: 999 }
    const gear = environment.gear
    environment.gear = { module(kind, id, selection) {
      const module = gear.module(kind, id, selection)
      if (kind === 'weapon') module.rules.push({ id: 999, when: 1, phase: 'beforeHit',
        conditions: [{ path: 'event.cast', operator: 'eq', value: 6 }], operations: [] })
      return module
    } }
    const result = await interpretTeamActions(environment, plan, scenario, { allowPartial: true })
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    expect(result.diagnostics.timingModel).toBe('authored-action-timeline')
    expect(result.diagnostics.omissions.map((entry: RuntimeRecord) => entry.code)).toEqual(expect.arrayContaining([
      'unknown-echo-equipment', 'missing-gear-triggers', 'missing-echo-hit-events',
    ]))
    expect(result.scenario.team.members[0]!.loadout).toEqual(context.loadout)
    expect(executeCombatScenarioProgram(prepareCombatScenario(result.scenario), result.scenario.program.program)?.entries.length).toBeGreaterThan(0)
    const strict = await interpretTeamActions(environment, plan, scenario)
    expect(strict.status).toBe('unsupported')
  })

  it('omits unbound attacks while retaining other team members and valid editor nodes', async () => {
    const { plan, scenario } = await fixture(), environment = await env()
    const load = environment.characters.load.bind(environment.characters)
    const context = scenario.team.members.find(member => member.id === scenario.contextMemberId)!
    environment.characters.load = async (ids, mode) => {
      const kits = await load(ids, mode)
      kits[context.resonatorId].nodeFeatures = {}
      return kits
    }
    const result = await interpretTeamActions(environment, plan, scenario, { allowPartial: true })
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    expect(result.diagnostics.timingModel).toBe('authored-action-timeline')
    expect(result.diagnostics.omissions.some((entry: RuntimeRecord) => entry.code === 'missing-feature-binding')).toBe(true)
    const run = executeCombatScenarioProgram(prepareCombatScenario(result.scenario), result.scenario.program.program)
    expect(run?.entries.some(entry => entry.resonatorId !== context.resonatorId && entry.avg > 0)).toBe(true)
  })

  it('uses the app context rotation when its team translation is absent', async () => {
    const { plan, scenario } = await fixture(), environment = await env()
    environment.characters.has = () => false
    const result = await interpretTeamActions(environment, plan, scenario, { allowPartial: true })
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    expect(result.diagnostics.timingModel).toBe('catalog-context-fallback')
    expect(result.scenario.team.members).toEqual(scenario.team.members)
    expect(executeCombatScenarioProgram(prepareCombatScenario(result.scenario), result.scenario.program.program)?.entries.length).toBeGreaterThan(0)
  })

  it('omits missing weapon and Sonata trigger definitions without removing equipment stats', () => {
    const equipment = prepareEquipment({
      loadout: { echoes: [{ id: '999999999', set: 999, mainEcho: true, substats: { critRate: 8.1 } }],
        weapon: { id: '999999999', level: 90, rank: 1 } },
      echoCatalog: [], gearLibrary: createGearLibrary({ schemaVersion: 1, weapons: {}, echoes: {}, sonatas: {} }),
    })
    expect(equipment.echoes.equipped[0].substats.critRate).toBe(8.1)
    expect(equipment.weapon.effects).toEqual({})
    expect(equipment.sonata.effects).toEqual({})
    expect(equipment.omissions.filter((entry: RuntimeRecord) => entry.code === 'missing-gear-triggers')).toHaveLength(3)
  })
})
