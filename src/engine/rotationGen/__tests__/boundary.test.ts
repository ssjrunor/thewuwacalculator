/*
  Author: Runor Ewhro
  description: checks scenario identity, authored seat order, and interpretation limits.
*/

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { createInterpreterEnvironment, interpretTeamActions } from '../index'
import { stableId } from '../stableId'
import type { ActionPlan } from '@/domain/rotationActions/types'
import type { CombatScenario } from '@/domain/entities/combatScenario'
import { initialCharacterState } from '../initialState'
import { buildTeamPreamble } from '../editor/preamble'
import { prepareEditorSources } from '../editor/catalog'
import { prepareInterpreterState } from '../prepareTeam'
import { bindEquipmentConditions } from '../equipmentConditions'
import { createEffectState } from '../events/execute'
import { makeScenarioTeam } from '@/domain/entities/combatScenario'
import { packTimeline } from '@/domain/rotationActions/timelines'

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'))
const gameData = (path: string) => json(join(process.cwd(), 'public/data/beta', `${path}.json`))
const interpretationData = (path: string) => json(join(process.cwd(), 'src/data/rotationGen', `${path}.json`))

describe('portable action interpreter', () => {
  it('preserves the existing SHA-256 numeric identities across padding and Unicode boundaries', () => {
    for (let length = 0; length < 200; length++) {
      const kind = `kind-${length}`, value = 'Jué 🐉'.repeat(length)
      const expected = Number.parseInt(createHash('sha256').update(`${kind}\0${value}`).digest('hex').slice(0, 13), 16)
      expect(stableId(kind, value)).toBe(expected)
    }
  })

  it('bundles for browser/Worker hosts without Node, ingest, tools or bundled JSON data', async () => {
    const result = await build({ entryPoints: ['src/engine/rotationGen/index.ts'], bundle: true,
      platform: 'browser', format: 'esm', write: false, metafile: true,
      alias: { '@': join(process.cwd(), 'src') } })
    const inputs = Object.keys(result.metafile!.inputs)
    expect(inputs.every(file => file.startsWith('src/') && !file.endsWith('.json'))).toBe(true)
    expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([])
  })

  it('consumes a supplied scenario, preserving its builds and controls without mutating it', async () => {
    const fixture = await json(join(__dirname, 'fixtures/team.json')) as { plan: ActionPlan; scenario: CombatScenario }
    const before = JSON.stringify(fixture)
    const environment = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const result = await interpretTeamActions(environment, fixture.plan, fixture.scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    expect(result.scenario.team.members[0].id).toBe(fixture.scenario.contextMemberId)
    expect(Object.fromEntries(result.scenario.team.members.map(member => [member.id, member])))
      .toEqual(Object.fromEntries(fixture.scenario.team.members.map(member => [member.id, member])))
    expect(result.scenario.target).toEqual(fixture.scenario.target)
    expect(result.scenario.contextMemberId).toBe(fixture.scenario.contextMemberId)
    expect(result.scenario.program.program.length).toBeGreaterThan(0)
    expect(result).not.toHaveProperty('dps')
    expect(JSON.stringify(fixture)).toBe(before)

    const custom = structuredClone(fixture.scenario)
    custom.target = { ...custom.target, id: 'custom:evaluation', source: 'custom' }
    const customResult = await interpretTeamActions(environment, fixture.plan, custom)
    expect(customResult.status, JSON.stringify(customResult.diagnostics)).toBe('interpreted')
  })

  it('matches reordered app members to authored seats without changing the action program', async () => {
    const fixture = await json(join(__dirname, 'fixtures/team.json')) as { plan: ActionPlan; scenario: CombatScenario }
    const environment = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const original = await interpretTeamActions(environment, fixture.plan, fixture.scenario)
    const reordered = structuredClone(fixture.scenario)
    reordered.team = makeScenarioTeam([...reordered.team.members].reverse())
    const result = await interpretTeamActions(environment, fixture.plan, reordered)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted' || original.status !== 'interpreted') return
    expect(result.scenario).toEqual(original.scenario)
    expect(result.scenario.initialOnFieldMemberId).toBe(fixture.scenario.team.members[fixture.plan.initialActiveSlot].id)
  })

  it.each([0, 1, 2])('selects the context timeline by authored seat %i after moving it to app slot zero', async seat => {
    const { plan, scenario } = await json(join(__dirname, 'fixtures/team.json')) as { plan: ActionPlan; scenario: CombatScenario }
    const authored = [...scenario.team.members]
    const context = authored[seat]
    scenario.contextMemberId = context.id
    scenario.team = makeScenarioTeam([context, ...authored.filter(member => member.id !== context.id)].reverse())
    const names: string[] = [], index = new Map<string, number>()
    plan.timelines = { owns: {}, names, runs: Object.fromEntries(authored.map((member, slot) =>
      [`${slot}:${member.progression.sequence}`, packTimeline({ seconds: 10 + slot,
        events: [[0, 'swap', slot], [30, 'swap', (slot + 1) % authored.length]] }, names, index)])) }
    const environment = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const result = await interpretTeamActions(environment, plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    expect(result.duration).toBe(10 + seat)
    expect(result.diagnostics.timingModel).toBe('reference-timeline')
    expect(result.scenario.team.members[0].id).toBe(context.id)
    expect(result.scenario.initialOnFieldMemberId).toBe(context.id)
    const activeWrites: unknown[] = []
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const entry = value as Record<string, unknown>
      if (entry.path === 'runtime.rotation.activeResonatorId') activeWrites.push(entry.value)
      for (const child of Object.values(entry)) visit(child)
    }
    visit(result.scenario.program.program)
    expect(activeWrites).toEqual([context.resonatorId, authored[(seat + 1) % authored.length].resonatorId])
  })

  it('evaluates an outgoing delayed hit after the field handoff', async () => {
    const { plan, scenario } = await json(join(__dirname, 'fixtures/team.json')) as { plan: ActionPlan; scenario: CombatScenario }
    const authored = [...scenario.team.members], lynae = authored[1]
    scenario.contextMemberId = lynae.id
    scenario.team = makeScenarioTeam([lynae, ...authored.filter(member => member.id !== lynae.id)])
    const names: string[] = [], index = new Map<string, number>()
    // the Skill's hit lands 30 frames on, after the Outro at 10 has already handed over
    plan.timelines = { owns: {}, names, runs: { [`1:${lynae.progression.sequence}`]: packTimeline({ seconds: 3, events: [
      [0, 'swap', 1], [0, 'cast', 1, 'Skill - Lynae-Style Palettes', -1],
      [10, 'cast', 1, "Outro - Let's Hit the Road!", -1], [10, 'swap', 2]] }, names, index) } }
    const environment = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const result = await interpretTeamActions(environment, plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    const order: string[] = []
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const entry = value as Record<string, unknown>
      if (entry.type === 'feature') order.push(`${entry.resonatorId}`)
      if (entry.path === 'runtime.rotation.activeResonatorId') order.push(`active ${entry.value}`)
      for (const child of Object.values(entry)) visit(child)
    }
    visit(result.scenario.program.program)
    const handed = order.indexOf(`active ${authored[2].resonatorId}`)
    expect(handed).toBeGreaterThan(0)
    expect(order.filter(item => item === lynae.resonatorId)).toHaveLength(2)
    expect(order.slice(handed).filter(item => item === lynae.resonatorId)).toHaveLength(2)
  })

  it('turns an Active Other handoff buff on after the swap, so it pins the incoming member', async () => {
    const { plan, scenario } = await json(join(__dirname, 'fixtures/team.json')) as { plan: ActionPlan; scenario: CombatScenario }
    const authored = [...scenario.team.members], lynae = authored[1]
    scenario.contextMemberId = lynae.id
    scenario.team = makeScenarioTeam([lynae, ...authored.filter(member => member.id !== lynae.id)])
    const names: string[] = [], index = new Map<string, number>()
    // Lynae's Hyvatia primes its Outro handoff; the Outro hands over to Phoebe
    plan.timelines = { owns: {}, names, runs: { [`1:${lynae.progression.sequence}`]: packTimeline({ seconds: 4, events: [
      [0, 'swap', 1], [0, 'cast', 1, '#echo', -1], [120, 'cast', 1, "Outro - Let's Hit the Road!", -1], [120, 'swap', 2]] }, names, index) } }
    const environment = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const result = await interpretTeamActions(environment, plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    const order: string[] = []
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const entry = value as Record<string, unknown>
      if (entry.path === 'runtime.rotation.activeResonatorId') order.push(`active ${entry.value}`)
      if (entry.path === 'runtime.state.controls.echo:6000189:main:active' && entry.value === true) order.push('hyvatia')
      for (const child of Object.values(entry)) visit(child)
    }
    visit(result.scenario.program.program)
    expect(order.indexOf('hyvatia')).toBeGreaterThan(order.indexOf(`active ${authored[2].resonatorId}`))
    expect(order.indexOf(`active ${authored[2].resonatorId}`)).toBeGreaterThan(-1)
  })

  it('keeps gear caches scoped to the supplied data snapshot', async () => {
    const first = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const firstWeapon = first.gear.module('weapon', '21050046')
    const second = await createInterpreterEnvironment({ mode: 'beta', gameData,
      interpretationData: async path => {
        const data = await interpretationData(path)
        if (path === 'gear/triggers') data.weapons['21050046'].variants[0].effects['2935400645402166'].duration = 999
        return data
      } })
    expect(second.gear.module('weapon', '21050046').effects['2935400645402166'].duration).toBe(999)
    expect(firstWeapon.effects['2935400645402166'].duration).not.toBe(999)
  })

  it('binds Rover rules and emitted controls to the scenario form without changing action identities', async () => {
    const environment = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const rules = await environment.characters.load(['1501', '1502'], 'beta')
    expect(rules['1501'].resonatorId).toBe(1501)
    expect(rules['1501'].sourceResonatorId).toBe(1502)
    expect(Object.keys(rules['1501'].actions)).toEqual(Object.keys(rules['1502'].actions))
    expect(rules['1501'].rules.flatMap((rule: { operations: Array<{ source?: number }> }) => rule.operations)
      .some((operation: { source?: number }) => operation.source === 1502)).toBe(false)
    const { plan, scenario } = await json(join(__dirname, 'fixtures/team.json'))
    const rover = scenario.team.members.find((member: { resonatorId: string }) => member.resonatorId === '1502')
    rover.resonatorId = '1501'
    const result = await interpretTeamActions(environment, plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    const program = JSON.stringify(result.scenario.program.program)
    expect(program).toContain('inherent:1501:lvl70:active')
    expect(program).not.toContain('inherent:1502:')
    expect(result.scenario.team.members.some(member => member.resonatorId === '1501')).toBe(true)
  })

  it('initializes selected modes and preserves explicit opening values', async () => {
    const environment = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const rules = await environment.characters.load(['1509'], 'beta')
    const { scenario } = await json(join(__dirname, 'fixtures/team.json')) as { scenario: CombatScenario }
    const lynae = scenario.team.members.find(member => member.resonatorId === '1509')!
    lynae.local.controls['resonator:1509:mode:value'] = 'tune_strain'
    expect(initialCharacterState(rules['1509'], lynae)).toEqual({ mode: 'tuneStrain' })
    lynae.local.controls['resonator:1509:mode:value'] = 'unknown-mode'
    expect(() => initialCharacterState(rules['1509'], lynae)).toThrow(/Unsupported initial value/)
    const state = (path: string, kind: 'select' | 'toggle' | 'stack', defaultValue: string | boolean | number,
      options?: string[]) => ({ id: path, label: path, path, kind, defaultValue, controlKey: path.split('.').pop()!,
      ownerKey: 'test', source: { type: 'resonator' as const, id: '1509' },
      ...(options ? { options: options.map(id => ({ id, label: id })) } : {}) })
    const choices = [
      { resonatorId: '1509', state: state('runtime.state.controls.mode', 'select', 'first', ['first', 'second']) },
      { resonatorId: '1509', state: state('runtime.state.controls.buff', 'toggle', true) },
      { resonatorId: '1509', state: state('enemy.combat.spectroFrazzle', 'stack', 0), changeTarget: 'enemy' as const },
    ]
    const values = (preamble: Array<{ changes: Array<{ value: unknown }> }>) =>
      preamble.slice(0, 3).map(node => node.changes[0].value)
    expect(values(buildTeamPreamble(choices, 1509))).toEqual(['first', true, 0])
    expect(values(buildTeamPreamble(choices, 1509, choice =>
      choice.state.path.endsWith('.mode') ? 'second' : undefined))).toEqual(['second', true, 0])
  })

  it('opens the preamble as the editor does, carrying only the seats\' modes', async () => {
    const { plan, scenario } = await json(join(__dirname, 'fixtures/team.json'))
    const lynae = scenario.team.members.find((member: { resonatorId: string }) => member.resonatorId === '1509')
    lynae.local.controls['resonator:1509:mode:value'] = 'tune_strain'
    scenario.environment.combatState.spectroFrazzle = 5
    scenario.target.status = { ...scenario.target.status, tuneStrain: 3 }
    const result = await interpretTeamActions(await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData }), plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    const preamble = result.scenario.program.program.filter(node => node.editorSection === 'preamble')
    const changes = preamble.flatMap(node => node.type === 'condition' ? node.changes : [])
    expect(changes.find(change => change.path === 'runtime.state.controls.resonator:1509:mode:value')?.value).toBe('tune_strain')
    expect(changes.find(change => change.path === 'enemy.status.tuneStrain')?.value).toBe(0)
    expect(changes.some(change => change.path.startsWith('runtime.routing.'))).toBe(false)
    expect(JSON.stringify(preamble)).not.toContain('enemy.status.tuneStrainShifting')
  })

  it('seeds modes, explicit character buffs and enemy statuses into the event state', async () => {
    const { scenario } = await json(join(__dirname, 'fixtures/team.json')) as { scenario: CombatScenario }
    const env = await createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })
    const ids = scenario.team.members.map(member => member.resonatorId)
    const rulesets = await env.characters.load(ids, 'beta')
    const lynae = scenario.team.members.find(member => member.resonatorId === '1509')!
    lynae.local.controls['resonator:1509:mode:value'] = 'tune_strain'
    lynae.local.controls['inherent:1509:lvl70:active'] = true
    const rover = scenario.team.members.find(member => member.resonatorId === '1502')!
    rover.local.controls['inherent:1502:lvl70:active'] = false
    scenario.environment.combatState.spectroFrazzle = 5
    scenario.target.status = { ...scenario.target.status, tuneStrain: 3, tuneRuptureShifting: true }
    const weaponBundles = Object.fromEntries(await Promise.all(scenario.team.members.map(async member =>
      [member.loadout.weapon.id, await gameData(`weapons/runtime-bundles/${member.loadout.weapon.id}`)])))
    const combat = prepareInterpreterState({ scenario, mode: 'beta', weaponBundles,
      echoCatalog: env.echoCatalog, gearLibrary: env.gear, rulesets })
    combat.initialOnFieldResonatorId = Number(ids[0])
    bindEquipmentConditions(prepareEditorSources({ scenario, resonators: {}, echoes: env.echoSources,
      sonataDefinitions: env.sonataDefinitions }), combat, rulesets)
    const state = createEffectState(rulesets, combat)
    expect(state.members[1509].state.mode).toBe('tuneStrain')
    expect(state.enemy.spectroFrazzle).toBe(5)
    expect(state.enemy.tuneStrainInterferedStacks).toBe(3)
    expect(state.effects.some((effect: { id: number }) => effect.id === 1524831186738234)).toBe(true)
    expect(state.effects.some((effect: { id: number }) => effect.id === 1711673661624849)).toBe(false)
    expect(state.effects.some((effect: { id: number }) => effect.id === 1993289647094170)).toBe(true)
  })
})
