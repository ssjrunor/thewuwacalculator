/*
  Author: Runor Ewhro
  description: checks equipment, teammate effects, and their activation conditions.
*/

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInterpreterEnvironment, interpretTeamActions } from '../index'
import { advanceEffectState, createEffectState, holdStatus, holdEffect, playCast, playSupport, resolveAction, resolveSwap } from '../events/execute'
import { emitEditorProgram } from '../editor/emitProgram'
import { createGearLibrary } from '../gear'
import gear from '@/data/rotationGen/gear/triggers.json'
import { withTuneBreak } from '../events/offTune'
import { timelineKits, playTimeline } from '../events/timeline'
import type { ActionPlan } from '@/domain/rotationActions/types'
import type { RuntimeRecord } from '../types'
import type { RotationNode } from '@/domain/gameData/contracts'
import { materializeStatControls } from '../editor/statControls'

const json = async (path: string) => JSON.parse(await readFile(join(process.cwd(), path), 'utf8'))
const gameData = (path: string) => json(`public/data/beta/${path}.json`)
const interpretationData = (path: string) => json(`src/data/rotationGen/${path}.json`)
const environment = () => createInterpreterEnvironment({ mode: 'beta', gameData, interpretationData })

async function simplePlan(id: string, names: string[]) {
  const { scenario } = await json('src/engine/rotationGen/__tests__/fixtures/team.json')
  scenario.team.members[0].resonatorId = id
  scenario.team.members[0].progression.sequence = 6
  scenario.team.members[0].local.controls = {}
  const plan: ActionPlan = { schemaVersion: 1, kind: 'team-actions', teamId: 'supplied', initialActiveSlot: 0,
    team: scenario.team.members.map((member: RuntimeRecord) => ({ resonatorId: member.resonatorId })),
    referenceTiming: { durationSeconds: 20, sectionSeconds: [5, 5, 5, 5] },
    actions: Object.fromEntries(names.map((sourceName, index) => [index, { kind: 'resonator', resonatorId: id, sourceName }])),
    sections: Array.from({ length: 4 }, (_, pass) => ({ id: `section${pass}`, kind: pass ? 'loop' : 'opener', pass,
      steps: (pass ? [0] : names.map((_, index) => index)).map((actionId, index) =>
        ({ id: `step${pass}:${index}`, type: 'cast', actorSlot: 0, actionId: String(actionId) })) })) }
  return { scenario, plan }
}

async function isolated(id: string) {
  const env = await environment(), rules = await env.characters.load([id], 'beta')
  const member: RuntimeRecord = { resonatorId: Number(id), build: { level: 90, sequence: 0 }, initialControls: {},
    baseTuneBreakBoost: 10,
    weapon: { effects: {}, rules: [] }, echoes: { equipped: [], main: { actions: {}, effects: {}, rules: [] } },
    sonata: { effects: {}, rules: [] } }
  const combat = { mode: 'beta', members: [member], initialOnFieldResonatorId: Number(id),
    initialEnemy: {}, target: {}, framesPerSecond: 60, maxFrames: 10000 }
  const state = createEffectState(rules, combat)
  const cast = (name: string) => { resolveAction(state, Number(id), name); advanceEffectState(state, state.readyAt) }
  return { rules, combat, state, cast }
}

describe('prescribed-plan translation', () => {
  it('requires an already-open Forged Dwarf Star window before an infliction grants team ATK', async () => {
    const { rules, combat } = await isolated('1105')
    combat.members[0].weapon = createGearLibrary(gear).module('weapon', '21050076', 1)
    rules[1105].rules.push({ id: 'inflict', when: 1, phase: 'afterDebuffs',
      operations: [{ op: 'signalStatus', status: 'tuneStrainShifting', negative: false }] })
    const state = createEffectState(rules, combat)
    const action = Number(Object.keys(rules[1105].actions).find(id => rules[1105].actions[id].name === 'Basic - Dimming Brush 1'))
    const ids = Object.entries(combat.members[0].weapon.effects) as Array<[string, RuntimeRecord]>
    const own = Number(ids.find(([, effect]) => effect.name.endsWith(' Liberation'))![0])
    const team = Number(ids.find(([, effect]) => effect.name.endsWith(' team ATK'))![0])
    playCast(state, 1105, action, 1)
    advanceEffectState(state, 100)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === own)).toBe(true)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === team)).toBe(false)
    playCast(state, 1105, action, 1)
    advanceEffectState(state, 200)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === team)).toBe(true)
  })
  it('separates Yinlin marked-target skill damage from her later Deadly Focus ATK buff', async () => {
    const { scenario, plan } = await simplePlan('1302', ['Basic - Zapstring\'s Dance 1'])
    scenario.contextMemberId = scenario.team.members[0].id
    scenario.team.members[0].progression.sequence = 0
    const result = await interpretTeamActions(await environment(), plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    const run = (marked: boolean, atk: boolean, featureId = 'damage:1302012') => {
      const test = structuredClone(result.scenario)
      test.program.program = [{ id: 'window', type: 'condition', enabled: true, resonatorId: '1302', changes: [
        { type: 'set', path: 'runtime.state.controls.resonator:1302:sinners_mark:active', value: marked },
        { type: 'set', path: 'runtime.state.controls.inherent:1302:lvl70:active', value: atk },
      ] }, { id: 'execution', type: 'feature', enabled: true, resonatorId: '1302', featureId }]
      return executeCombatScenarioProgram(prepareCombatScenario(test))!.entries[0]
    }
    const off = run(false, false), marked = run(true, false), atk = run(false, true)
    expect(marked.effectiveStats!.bonus! - off.effectiveStats!.bonus!).toBeCloseTo(10, 8)
    expect(marked.effectiveStats!.atk).toBe(off.effectiveStats!.atk)
    expect(atk.effectiveStats!.bonus).toBe(off.effectiveStats!.bonus)
    expect(atk.effectiveStats!.atk).toBeGreaterThan(off.effectiveStats!.atk!)
    expect(run(false, false, 'damage:1302007').skill.skillType).toEqual(['heavyAtk'])
  })
  it('enables Yinghuo with observed Fire of Life and applies the complete Soul Raid HP bonus', async () => {
    const { scenario, plan } = await simplePlan('1212', ['Liberation - Burial of Thousand Souls', 'Forte Heavy - Soul Raid'])
    scenario.contextMemberId = scenario.team.members[0].id
    scenario.team.members[0].progression.sequence = 0
    const result = await interpretTeamActions(await environment(), plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    const run = (active: boolean) => {
      const test = structuredClone(result.scenario)
      test.program.program = [{ id: 'window', type: 'condition', enabled: true, resonatorId: '1212', changes:
        ['yinghuo', 'fire_of_life'].map(name => ({ type: 'set',
          path: `runtime.state.controls.resonator:1212:${name}:active`, value: active })) },
      { id: 'soul', type: 'feature', enabled: true, resonatorId: '1212', featureId: 'damage:1212026' }]
      return executeCombatScenarioProgram(prepareCombatScenario(test))!.entries[0]
    }
    const off = run(false), on = run(true)
    const steps = Math.min(25, Math.max(0, (on.effectiveStats!.hp! - 25000) / 1000))
    expect(on.effectiveStats!.multiplier! - off.effectiveStats!.multiplier!).toBeCloseTo(steps * .211, 8)
    const writes: Array<{ path?: string; value?: unknown }> = []
    const visit = (node: RuntimeRecord): void => {
      if (node.type === 'condition') writes.push(...node.changes)
      for (const value of Object.values(node)) if (Array.isArray(value)) for (const part of value)
        if (part && typeof part === 'object') visit(part)
      if (node.attached) visit(node.attached)
    }
    for (const node of result.scenario.program.program) visit(node)
    expect(writes.some(write => write.path === 'runtime.state.controls.resonator:1212:yinghuo:active' && write.value === true)).toBe(true)
  })

  it('normalizes Rift Cleaver callback spending to exactly 20 Concerto points', async () => {
    const { rules, combat } = await isolated('1312')
    const weapon = createGearLibrary(gear).module('weapon', 21020107, 1)
    const spendRule = weapon.rules.find((rule: RuntimeRecord) => rule.conditions?.some((condition: RuntimeRecord) =>
      condition.path === 'event.concertoSpent'))
    spendRule.conditions.push({ path: 'event.concertoSpent', operator: 'eq', value: 20 })
    combat.members[0].weapon = weapon
    const state = createEffectState(rules, combat)
    const action = (name: string) => Number(Object.keys(rules[1312].actions).find(id => rules[1312].actions[id].name === name))
    playCast(state, 1312, action('Liberation - Umbral Canopy: Miasma Lock'), Infinity)
    playCast(state, 1312, action('Skill - Furled Canopy: Rift Cleaver'), Infinity)
    const yearning = Number(Object.keys(weapon.effects).find(id => weapon.effects[id].name === 'Unspoken Rue Yearning Mind'))
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === yearning && effect.stacks > 0)).toBe(true)
  })

  it.each([0, 20, 99, 100, 101])('replaces Binding Mind only for a positive Concerto spend below 100 (%i)', async spent => {
    const { rules, combat } = await isolated('1312')
    const kit = rules[1312], weapon = createGearLibrary(gear).module('weapon', 21020107, 1)
    combat.members[0].weapon = weapon
    const state = createEffectState(rules, combat)
    const liberation = Number(Object.keys(kit.actions).find(id => kit.actions[id].name === 'Liberation - Umbral Canopy: Miasma Lock'))
    playCast(state, 1312, liberation, Infinity)
    const binding = Number(Object.keys(weapon.effects).find(id => weapon.effects[id].name === 'Unspoken Rue Binding Mind'))
    const yearning = Number(Object.keys(weapon.effects).find(id => weapon.effects[id].name === 'Unspoken Rue Yearning Mind'))
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === binding && effect.stacks > 0)).toBe(true)
    kit.actions[999] = { name: 'Test Concerto spend', cast: kit.codes.cast.skill, timing: { duration: 0 },
      events: [{ id: 999, at: 0, kind: kit.codes.event.cast, concertoSpent: spent }] }
    playCast(state, 1312, 999, Infinity)
    const replaces = spent > 0 && spent < 100
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === binding && effect.stacks > 0 && effect.until > state.frame)).toBe(!replaces)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === yearning && effect.stacks > 0 && effect.until > state.frame)).toBe(replaces)
  })

  it('starts a QTE Outro on the incoming Intro frame while ordinary gear handoffs start immediately', async () => {
    const { rules, combat } = await isolated('1606'), ally = await isolated('1603')
    Object.assign(rules, ally.rules)
    combat.members.push(ally.combat.members[0])
    combat.members[0].sonata = createGearLibrary(gear).module('sonata', 8, 5)
    const state = createEffectState(rules, combat)
    const effectId = Number(Object.keys(rules[1606].effects).find(id => rules[1606].effects[id].name === 'Roccia: Outro'))
    resolveSwap(state, 1603, { outro: 'Outro - Applause, Please!', intro: 'Intro - Everblooming' })
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === effectId)).toBe(false)
    expect(state.effects.find((effect: RuntimeRecord) => effect.id === Number(Object.keys(combat.members[0].sonata.effects)[0])))
      .toMatchObject({ target: 1603, until: 900 })
    advanceEffectState(state, 35)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === effectId)).toBe(false)
    advanceEffectState(state, 36)
    expect(state.effects.find((effect: RuntimeRecord) => effect.id === effectId))
      .toMatchObject({ owner: 1606, target: 1603, until: 876 })
    advanceEffectState(state, 876)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === effectId && effect.until > state.frame)).toBe(false)
  })

  it('automatically emits one catalog-backed Midnight Veil burst after each Outro handoff', async () => {
    const { rules, combat } = await isolated('1602'), ally = await isolated('1505')
    Object.assign(rules, ally.rules)
    combat.members.push(ally.combat.members[0])
    combat.members[0].sonata = createGearLibrary(gear).module('sonata', 12, 5)
    const state = createEffectState(rules, combat)
    for (let pass = 0; pass < 4; pass++) {
      resolveSwap(state, 1505, { outro: 'Outro - Duality', intro: 'Intro - Discernment' })
      resolveSwap(state, 1602)
    }
    const bursts = state.trace.filter((entry: RuntimeRecord) => entry.featureId === 'damage:echoSet:12:midnight-veil')
    expect(bursts).toHaveLength(4)
    for (const burst of bursts) {
      expect(burst.owner).toBe(1602)
      const index = state.trace.indexOf(burst)
      expect(state.trace.slice(0, index).findLast((entry: RuntimeRecord) => entry.type === 'swap').to).toBe(1505)
    }
    expect(createGearLibrary(gear).module('sonata', 12, 4).rules).toEqual([])
  })

  it('exposes Midnight Veil only for five distinct pieces and attributes its damage to the wearer', async () => {
    const { scenario } = await simplePlan('1602', [])
    scenario.contextMemberId = scenario.team.members[0].id
    await environment()
    const { makeSourceCat } = await import('@/engine/services/runtimeSourceService')
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    const { executeRotationScore, prepareRotationProgram } = await import('@/engine/rotation/execute')
    const { compilePortableRotation } = await import('@/engine/rotation/portable/compiler')
    const { executeScalarProgram } = await import('@/engine/rotation/portable/ir')
    const featureId = 'damage:echoSet:12:midnight-veil'
    const ids = (await gameData('echoes/catalog')).filter((echo: RuntimeRecord) => echo.sets.includes(12)).slice(0, 5)
    const echoes = scenario.team.members[0].loadout.echoes
    scenario.team.members[0].loadout.echoes = ids.map((echo: RuntimeRecord, index: number) => ({
      ...structuredClone(echoes[index]!), id: String(echo.id), set: 12, mainEcho: index === 0,
    }))
    scenario.program.program = [{ id: 'burst', type: 'feature', enabled: true, resonatorId: '1602', featureId, multiplier: 1 }]
    const prepare = () => prepareCombatScenario(scenario)
    const complete = prepare()
    const catalog = makeSourceCat(complete.subjectRuntime)
    expect(catalog.featuresById[featureId]).toBeDefined()
    expect(catalog.skillsById[catalog.featuresById[featureId].skillId!].skillType).toEqual(['outroSkill'])
    const result = executeCombatScenarioProgram(complete)!
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].effectiveStats!.multiplier).toBe(4.8)
    const total = result.entries[0].avg
    expect(executeRotationScore(complete.workspace.rotNvrn!, prepareRotationProgram(scenario.program.program)).total.avg)
      .toBeCloseTo(total, 6)
    const { ECHO_STAT_KEYS, TEAM_INPUT } = await import('@/engine/rotation/portable/layout')
    const { fillPortableInputs } = await import('@/engine/rotation/portable/cpu')
    const candidates = complete.subjectRuntime.build.echoes.filter(echo => echo != null)
    const equippedProgram = compilePortableRotation(complete.workspace.rotNvrn!, scenario.program.program,
      candidates, new Set(['burst|0']), {}, undefined, undefined, { echoCount: 5 })
    const payload = { sets: Uint8Array.from(candidates, echo => echo.set), kinds: Uint16Array.from([1, 2, 3, 4, 5]),
      stats: Float32Array.from(candidates.flatMap(echo => ECHO_STAT_KEYS.map(key =>
        (echo.mainStats.primary.key === key ? echo.mainStats.primary.value : 0) +
        (echo.mainStats.secondary.key === key ? echo.mainStats.secondary.value : 0) + (echo.substats[key] ?? 0)))) }
    const inputs = new Float64Array(TEAM_INPUT.count)
    fillPortableInputs(payload, equippedProgram, [0, 1, 2, 3, 4], 0, inputs)
    expect(executeScalarProgram(equippedProgram.scalar, inputs)[0] / total).toBeCloseTo(1, 6)
    const portable = compilePortableRotation(complete.workspace.rotNvrn!, scenario.program.program,
      [], new Set(['burst|0']), {}, undefined, undefined, { echoCount: 0 })
    // candidate echoes are empty on purpose: the set's skill ends once its five-piece activation is lost
    expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBe(0)
    scenario.team.members[1].loadout.echoes = structuredClone(scenario.team.members[0].loadout.echoes)
    scenario.team.members[0].loadout.echoes[4]!.id = scenario.team.members[0].loadout.echoes[3]!.id
    const duplicate = prepare()
    expect(makeSourceCat(duplicate.subjectRuntime).featuresById[featureId]).toBeUndefined()
    expect(executeCombatScenarioProgram(duplicate)!.entries).toHaveLength(0)
    const missingWearer = compilePortableRotation(duplicate.workspace.rotNvrn!, scenario.program.program,
      [], new Set(['burst|0']), {}, undefined, undefined, { echoCount: 0 })
    expect(executeScalarProgram(missingWearer.scalar, new Float64Array(missingWearer.scalar.inputCount))[0]).toBe(0)
    scenario.team.members[0].loadout.echoes[4]!.id = String(ids[4].id)
    scenario.team.members[0].loadout.echoes[4]!.set = 2
    expect(makeSourceCat(prepare().subjectRuntime).featuresById[featureId]).toBeUndefined()
  })

  it('does not restore Binding Mind when Yearning ends on swap', async () => {
    const { scenario } = await simplePlan('1312', [])
    scenario.team.members[0].loadout.weapon = { id: '21020107', level: 90, rank: 1 }
    scenario.team.members[1].resonatorId = '1308'
    await environment()
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    const controls = (binding: boolean, yearning: boolean) => {
      scenario.program.program = [{ id: 'mind', type: 'condition', enabled: true, resonatorId: '1312', changes:
        Object.entries({ unison: true, binding_mind: binding, yearning_mind: yearning }).map(([key, value]) => ({
          type: 'set', path: `runtime.state.controls.weapon:21020107:passive:${key}`, value,
        })) }, { id: 'ally', type: 'feature', enabled: true, resonatorId: '1308', featureId: 'damage:1411001' }]
      return executeCombatScenarioProgram(prepareCombatScenario(scenario))!.entries[0].effectiveStats!.bonus!
    }
    const binding = controls(true, false), yearning = controls(false, true), swapped = controls(false, false)
    expect(binding - yearning).toBeCloseTo(24, 6)
    expect(swapped).toBe(yearning)
    expect(controls(true, false)).toBe(binding)
  })

  it('captures a source stat at the cast marker before a teammate Crit window ends', async () => {
    const { scenario, plan } = await simplePlan('1606', ['Liberation - Commedia Improvviso!'])
    scenario.team.members[1].resonatorId = '1505'
    plan.team[1].resonatorId = '1505'
    const result = await interpretTeamActions(await environment(), plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    const key = 'team:1606:commedia_improvviso:crit_rate'
    const field = 'runtime.state.controls.resonator:1505:inner_stellarealm:active'
    const items: RotationNode[] = [
      { id: 'field-on', type: 'condition', resonatorId: '1505', changes: [{ type: 'set', path: field, value: true }] },
      { id: 'cast:stat-snapshot', type: 'condition', resonatorId: '1606',
        changes: [{ type: 'set', path: `runtime.state.controls.${key}`, value: 50 }] },
      { id: 'field-off', type: 'condition', resonatorId: '1505', changes: [{ type: 'set', path: field, value: false }] },
      { id: 'hit', type: 'feature', resonatorId: '1606', featureId: 'damage:1606013', multiplier: 1 },
    ]
    const filled = materializeStatControls(result.scenario, items, [{ resonatorId: '1606',
      actionName: 'Liberation - Commedia Improvviso!', controlKey: key, stat: 'critRate' }],
    new Set([`1606|runtime.state.controls.${key}`]))
    const snapshot = filled[1].type === 'condition' ? filled[1].changes[0].value : undefined
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    const execution = executeCombatScenarioProgram(prepareCombatScenario({ ...result.scenario,
      program: { ...result.scenario.program, program: filled } }))!
    const hitRate = execution.entries[0].effectiveStats!.critRate!
    expect(typeof snapshot).toBe('number')
    expect(snapshot as number).toBeGreaterThan(hitRate)
    expect(items[1].type === 'condition' && items[1].changes[0].value).toBe(50)
  })

  it.each([0, 7.5])('captures Roccia Crit Rate from the actual build with %s Crit Rate per Echo', async critRate => {
    const { scenario, plan } = await simplePlan('1606', ['Liberation - Commedia Improvviso!'])
    const owner = scenario.team.members[0]
    owner.progression.sequence = 0
    owner.loadout.weapon = { id: '21040015', level: 90, rank: 5, baseAtk: 587.5 }
    for (const echo of owner.loadout.echoes) if (echo) echo.substats.critRate = critRate
    const original = JSON.stringify(scenario)
    const env = await environment()
    const result = await interpretTeamActions(env, plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    const { executeCombatScenarioProgram, prepareCombatScenario } = await import('@/engine/pipeline/combatScenario')
    const run = executeCombatScenarioProgram(prepareCombatScenario(result.scenario))!
    const entries = run.entries.filter(entry => entry.resonatorId === '1606' && entry.feature.id === 'damage:1606013')
    expect(entries).toHaveLength(4)
    const writes = run.inspection.filter(row => row.nodeType === 'condition' && row.executed &&
      row.value?.kind === 'condition' && row.value.path.endsWith('1606:commedia_improvviso:crit_rate'))
      .map(row => row.value?.kind === 'condition' ? row.value.value : undefined)
    const expected = Math.max(50, entries[0].effectiveStats!.critRate!)
    expect(writes.some(value => typeof value === 'number' && Math.abs(value - expected) < 1e-8)).toBe(true)
    expect(entries.every(entry => entry.effectiveStats!.critRate === entries[0].effectiveStats!.critRate)).toBe(true)
    expect(JSON.stringify(scenario)).toBe(original)
  })

  it('emits authorable per-hit sequence conditions without enabling standing threshold assumptions', async () => {
    const { scenario, plan } = await simplePlan('1602', ['Skill - Crimson Erosion 2', 'Basic - Execution 1'])
    const result = await interpretTeamActions(await environment(), plan, scenario)
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    if (result.status !== 'interpreted') return
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    const run = executeCombatScenarioProgram(prepareCombatScenario(result.scenario))!
    expect(run.inspection.some(row => row.value?.kind === 'condition' &&
      row.value.path === 'runtime.state.controls.sequence:1602:s2:active' && row.value.value === true)).toBe(true)
    const sanhua = await simplePlan('1102', ['Basic - Frigid Light 2'])
    const other = await interpretTeamActions(await environment(), sanhua.plan, sanhua.scenario)
    expect(other.status).toBe('interpreted')
    if (other.status !== 'interpreted') return
    const otherRun = executeCombatScenarioProgram(prepareCombatScenario(other.scenario))!
    expect(otherRun.inspection.some(row => row.value?.kind === 'condition' &&
      row.value.path === 'runtime.state.controls.sequence:1102:s3:active' && row.value.value === true)).toBe(false)
  })

  it('preserves callback Concerto spending for the next equipment trigger', () => {
    const kit = { resonatorId: 1, name: 'callback', nodeFeatures: {}, codes: { event: { cast: 0, hit: 1 }, cast: { intro: 4 } }, state: {}, effects: { 2: { maxStacks: 1 } },
      actions: { 3: { name: 'Spend', cast: 0, timing: { duration: 1 }, events: [{ id: 4, kind: 0, at: 0 }] } },
      rules: [{ id: 'spend', when: 0, operations: [{ op: 'recordConcertoSpend', value: -2000 }] }] }
    const member = { resonatorId: 1, build: { level: 90, sequence: 0 }, initialControls: {},
      echoes: { main: { effects: {}, rules: [] } }, sonata: { effects: {}, rules: [] },
      weapon: { effects: {}, rules: [{ id: 'weapon', when: 0,
        conditions: [{ path: 'event.concertoSpent', operator: 'gt', value: 0 }], operations: [{ op: 'grantEffect', effect: 2 }] }] } }
    const fight = createEffectState({ 1: kit }, { members: [member], initialOnFieldResonatorId: 1, maxFrames: 10 })
    playCast(fight, 1, 3, 0)
    expect(fight.effects.some((effect: RuntimeRecord) => effect.id === 2)).toBe(true)
  })

  it('replays Unison at its native Liberation grant', async () => {
    const { rules, combat } = await isolated('1312')
    const unison = Object.keys(rules[1312].effects).find(id => rules[1312].effects[id].name === 'Unison')!
    const kits = timelineKits(rules, { timelines: { owns: { 1312: ['Unison'] } } } as unknown as ActionPlan)
    expect(kits[1312].effects[unison].replayLifecycle).toBe(true)
    const state = createEffectState(kits, combat)
    const play = (name: string) => {
      const id = Object.keys(kits[1312].actions).find(id => kits[1312].actions[id].name === name)!
      playCast(state, 1312, Number(id), Infinity)
    }
    play('Intro - Furled Canopy: Flash Rift')
    expect(state.effects.some((effect: RuntimeRecord) => String(effect.id) === unison && effect.stacks > 0)).toBe(false)
    play('Liberation - Umbral Canopy: Miasma Lock')
    expect(state.effects.some((effect: RuntimeRecord) => String(effect.id) === unison && effect.stacks > 0)).toBe(true)
    play('Skill - Furled Canopy: Rift Cleaver')
    expect(state.effects.some((effect: RuntimeRecord) => String(effect.id) === unison && effect.stacks > 0 && effect.until > state.frame)).toBe(false)
  })

  it.each(['Intro - Furled Canopy: Sealed Delusion (Unison)',
    'Intro - Unfurled Canopy: Whirling Thunder (Unison)'])(
    'keeps native Unison distinct from responding with %s', async (name) => {
      const { rules, combat } = await isolated('1312')
      const plan = { actions: { shared: { kind: 'resonator', resonatorId: '1312', sourceName: name } },
        timelines: { owns: { 1312: ['Unison'] } } } as unknown as ActionPlan
      const kits = timelineKits(rules, plan)
      const unison = Object.keys(kits[1312].effects).find(id => kits[1312].effects[id].name === 'Unison')!
      expect(kits[1312].governed.has(Number(unison))).toBe(false)
      const intro = Number(Object.keys(kits[1312].actions).find(id => kits[1312].actions[id].name === name))
      const liberation = Number(Object.keys(kits[1312].actions).find(id => kits[1312].actions[id].name === 'Liberation - Umbral Canopy: Miasma Lock'))
      // the folded Intro roster already contains its following Liberation's Unison, so it cannot grant the weapon's
      // on-gaining-Unison bonus early
      const { state } = playTimeline(kits, combat, { seconds: 5, events: [
        [0, 'state', 0, 'Unison', 1, 0], [0, 'cast', 0, String(intro), -1],
      ] }, new Set(), new Set())
      expect(state.effects.some((effect: RuntimeRecord) => String(effect.id) === unison && effect.stacks > 0)).toBe(false)
      playCast(state, 1312, liberation, Infinity)
      expect(state.effects.some((effect: RuntimeRecord) => String(effect.id) === unison && effect.stacks > 0)).toBe(true)
    })

  it('signals a Unison response to equipment without granting Suoming Unison', async () => {
    const { rules, combat } = await isolated('1312')
    const kit = rules[1312]
    const response = Object.entries(kit.effects).find(([, effect]) => (effect as RuntimeRecord).responseKind === 'unisonResponse')
    expect(response).toBeDefined()
    const intro = Number(Object.keys(kit.actions).find(id => kit.actions[id].name === 'Intro - Furled Canopy: Sealed Delusion (Unison)'))
    const incoming = Object.keys(kit.effects).find(id => kit.effects[id].shared && kit.effects[id].recipient === 'incomingMember')!
    const unison = Object.keys(kit.effects).find(id => kit.effects[id].name === 'Unison')!
    combat.members[0].weapon.rules.push({ id: 'response-listener', when: 'responseEvent',
      conditions: [{ path: 'event.responseKind', operator: 'eq', value: 'unisonResponse' }],
      operations: [{ op: 'grantEffect', effect: 999 }] })
    combat.members[0].weapon.effects[999] = { name: 'Response Gear', recipient: 'self', maxStacks: 1 }
    const state = createEffectState(rules, combat)
    holdEffect(state, 1312, Number(incoming), 1312, 1)
    playCast(state, 1312, intro, Infinity)
    expect(state.trace.some((row: RuntimeRecord) => row.type === 'effect' && row.effectId === 999 && row.stacks === 1)).toBe(true)
    expect(state.effects.some((effect: RuntimeRecord) => String(effect.id) === unison && effect.stacks > 0)).toBe(false)
  })

  it('doubles Seal Master attack multipliers while leaving other Basic damage unchanged', async () => {
    const { scenario } = await simplePlan('1312', [])
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    const ids = ['1312004', '1312005', '1312011', '1312012', '1312026']
    const run = (active: boolean) => {
      scenario.program.program = [{ id: 'seal', type: 'condition', enabled: true, resonatorId: '1312', changes: [
        { type: 'set', path: 'runtime.state.controls.resonator:1312:seal_master:active', value: active, resonatorId: '1312' }] },
        ...ids.map(id => ({ id, type: 'feature' as const, enabled: true, resonatorId: '1312', featureId: `damage:${id}`, multiplier: 1 }))]
      return executeCombatScenarioProgram(prepareCombatScenario(scenario))!.entries
    }
    const off = run(false), on = run(true)
    on.forEach((entry, index) => expect(entry.effectiveStats!.multiplier)
      .toBeCloseTo(off[index].effectiveStats!.multiplier! * (index === 4 ? 1 : 2), 8))
  })

  it('applies Danjin Overflow at the runtime stage and scopes S2 independently', async () => {
    const { scenario } = await simplePlan('1602', [])
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    const run = (overflow: boolean, s2: boolean) => {
      scenario.program.program = [{ id: 'conditions', type: 'condition', enabled: true, resonatorId: '1602', changes: [
        { type: 'set', path: 'runtime.state.controls.inherent:1602:lvl70:active', value: overflow, resonatorId: '1602' },
        { type: 'set', path: 'runtime.state.controls.sequence:1602:s2:active', value: s2, resonatorId: '1602' }] },
        ...['5700022', '5700001'].map(id => ({ id, type: 'feature' as const, enabled: true, resonatorId: '1602', featureId: `damage:${id}`, multiplier: 1 }))]
      return executeCombatScenarioProgram(prepareCombatScenario(scenario))!.entries.map(entry => entry.effectiveStats!.bonus!)
    }
    const base = run(false, false)
    expect(run(true, false).map((bonus, index) => bonus - base[index])).toEqual([30, 0])
    expect(run(false, true).map((bonus, index) => bonus - base[index])).toEqual([20, 20])
  })

  it('limits Daybreaker DEF ignore to Basic Attack damage', async () => {
    const { scenario, plan } = await simplePlan('1510', ['Intro - Before Injection of Dawn'])
    scenario.team.members[0].progression.sequence = 0
    scenario.team.members[0].loadout.weapon = { id: '21040056', level: 90, rank: 1 }
    const env = await environment()
    const interpreted = await interpretTeamActions(env, plan, scenario)
    expect(interpreted.status).toBe('interpreted')
    if (interpreted.status !== 'interpreted') return
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    interpreted.scenario.program.program = [
      { id: 'weapon', type: 'condition', enabled: true, resonatorId: '1510', changes: [
        { type: 'set', path: 'runtime.state.controls.weapon:21040056:passive:basic', value: true, resonatorId: '1510' }] },
      ...['1510018', '1510025', '1510029'].map(id => ({ id, type: 'feature' as const, enabled: true,
        resonatorId: '1510', featureId: `damage:${id}`, multiplier: 1 }))]
    const run = executeCombatScenarioProgram(prepareCombatScenario(interpreted.scenario))!
    // Luuk's Liberation damage also counts as Basic Attack DMG
    expect(run.entries.map(entry => entry.effectiveStats!.defIgnore)).toEqual([10, 10, 0])
  })

  it.each([{ sequence: 0, buds: 0 }, { sequence: 0, buds: 10 }, { sequence: 6, buds: 0 }, { sequence: 6, buds: 10 }])('scales every named Sweet Dream attack at S$sequence with $buds consumed buds', async ({ sequence, buds }) => {
    const { scenario } = await simplePlan('1603', [])
    scenario.team.members[0].progression.sequence = sequence
    const { prepareCombatScenario, executeCombatScenarioProgram } = await import('@/engine/pipeline/combatScenario')
    const ids = ['9700001', '9700002', '9700003', '9700004', '9700005', '9700008',
      '9700011', '9700012', '9700013', '9700014', '9700015', '9700016', '9700017', '9700018', '9700031', '9700022']
    const run = (active: boolean) => {
      scenario.program.program = [
        { id: 'dream', type: 'condition', enabled: true, resonatorId: '1603', changes: [
          { type: 'set', path: 'runtime.state.controls.resonator:1603:sweet_dream:active', value: active, resonatorId: '1603' },
          { type: 'set', path: 'runtime.state.controls.resonator:1603:sweet_dream:crimson_bud', value: buds, resonatorId: '1603' }] },
        ...ids.map(id => ({ id, type: 'feature' as const, enabled: true, resonatorId: '1603', featureId: `damage:${id}`, multiplier: 1 }))]
      return executeCombatScenarioProgram(prepareCombatScenario(scenario))!.entries
        .filter(entry => entry.resonatorId === '1603')
    }
    const off = run(false), on = run(true)
    expect(on).toHaveLength(ids.length)
    on.forEach((entry, index) => expect(entry.effectiveStats!.multiplier)
      .toBeCloseTo(off[index].effectiveStats!.multiplier! * (ids[index] === '9700022' ? 1 : (sequence >= 6 ? 3 : 1.5) + 0.05 * buds), 8))
  })

  it.each(['live', 'beta'])('applies Qiuyuan base bonuses to the active member only and S2 amplification team-wide in %s', async mode => {
    for (const kind of ['runtime-bundles', 'worker-bundles']) {
      const { source } = await json(`public/data/${mode}/resonators/${kind}/1411.json`)
      const scope = (id: string) => source.effects.find((effect: RuntimeRecord) => effect.id === id).targetScope
      expect(scope('1411:bamboo-shade')).toBe('active')
      expect(scope('1411:sundering-strike')).toBe('active')
      expect(scope('1411:s2:team')).toBe('teamWide')
    }
  })

  it.each(['live', 'beta'])('preserves named Intro and Golden Impale damage types in every %s execution asset', async mode => {
    const sources = await json(`public/data/${mode}/resonators/sources.json`)
    for (const [owner, ids] of [['1608', { '1608025': 'introSkill', '1608026': 'resonanceSkill' }],
      ['1510', { '1510018': 'basicAtk' }]] as const) {
      for (const kind of ['source', 'runtime-bundles', 'worker-bundles']) {
        const source = kind === 'source' ? sources.find((row: RuntimeRecord) => row.source.id === owner)
          : (await json(`public/data/${mode}/resonators/${kind}/${owner}.json`)).source
        for (const [id, type] of Object.entries(ids)) {
          expect(source.skills.find((skill: RuntimeRecord) => skill.id === id).skillType).toEqual([type])
          if (source.damageEntries) for (const row of source.damageEntries.filter((row: RuntimeRecord) => row.skillId === id))
            expect(row.skillType).toEqual([type])
        }
      }
    }
  })

  it('activates zero-energy Dream only at three pieces and grants Gilded Basic bonus only on a qualifying Liberation', async () => {
    const library = createGearLibrary(gear)
    for (const pieces of [2, 3]) {
      const { rules, combat } = await isolated('1608')
      combat.members[0].sonata = library.module('sonata', 19, pieces)
      const fight = createEffectState(rules, combat)
      expect(fight.trace.some((row: RuntimeRecord) => row.type === 'effect' && row.effect === 'Dream of the Lost zero energy')).toBe(pieces === 3)
      delete rules['1608'].state.noResonanceEnergy
      expect(createEffectState(rules, combat).trace.some((row: RuntimeRecord) => row.effect === 'Dream of the Lost zero energy')).toBe(false)
    }
    const { rules, combat } = await isolated('1510')
    const module = library.module('sonata', 26, 5)
    combat.members[0].sonata = module
    const stacks = Number(Object.keys(module.effects).find(id => module.effects[id].maxStacks === 3))
    const bonus = Number(Object.keys(module.effects).find(id => module.effects[id].name.endsWith('Basic bonus')))
    rules['1510'].actions[42] = { name: 'Test Liberation', cast: 3, timing: { duration: 0 }, events: [{ id: 42, kind: 0, at: 0 }] }
    const fight = createEffectState(rules, combat)
    holdEffect(fight, 1510, stacks, 1510, 2)
    playCast(fight, 1510, 42, 0)
    expect(fight.effects.some((effect: RuntimeRecord) => effect.id === bonus)).toBe(false)
    holdEffect(fight, 1510, stacks, 1510, 3)
    playCast(fight, 1510, 42, 0)
    expect(fight.effects.some((effect: RuntimeRecord) => effect.id === bonus && effect.stacks === 1)).toBe(true)
  })

  it.each(['live', 'beta'])('preserves Blueprint ER and Basic damage classifications in all %s artifacts', async mode => {
    const sources = await json(`public/data/${mode}/resonators/sources.json`)
    for (const kind of ['source', 'runtime-bundles', 'worker-bundles']) {
      const mornye = kind === 'source' ? sources.find((row: RuntimeRecord) => row.source.id === '1209')
        : (await json(`public/data/${mode}/resonators/${kind}/1209.json`)).source
      const blueprint = mornye.effects.find((effect: RuntimeRecord) => effect.id === '1209:lvl50:blueprint-energy-regen')
      expect(blueprint.ownerKey).toBe('inherent:1209:lvl50')
      expect(blueprint.condition).toMatchObject({ type: 'gte', value: 50 })
      expect(blueprint.operations).toEqual([{ type: 'add_top_stat', stat: 'energyRegen', value: { type: 'const', value: 10 } }])
      const aemeath = kind === 'source' ? sources.find((row: RuntimeRecord) => row.source.id === '1210')
        : (await json(`public/data/${mode}/resonators/${kind}/1210.json`)).source
      for (const id of ['1210103', '1210104', '1210105', '1210106', '1210109', '1210110']) {
        expect(aemeath.skills.find((skill: RuntimeRecord) => skill.id === id).skillType).toEqual(['basicAtk'])
        if (kind !== 'source') for (const row of aemeath.damageEntries.filter((row: RuntimeRecord) => row.skillId === id))
          expect(row.skillType).toEqual(['basicAtk'])
      }
      const cartethyia = kind === 'source' ? sources.find((row: RuntimeRecord) => row.source.id === '1409')
        : (await json(`public/data/${mode}/resonators/${kind}/1409.json`)).source
      expect(cartethyia.skills.find((skill: RuntimeRecord) => skill.id === '1409006').skillType).toEqual(['basicAtk'])
      if (kind !== 'source') for (const row of cartethyia.damageEntries.filter((row: RuntimeRecord) => row.skillId === '1409006'))
        expect(row.skillType).toEqual(['basicAtk'])
    }
  })

  it.each(['spectroFrazzle', 'heliacalEmber'].flatMap(status => [false, true].map(offField => ({ status, offField }))))('keeps Eternal Radiance personal for $status (off-field own hit: $offField)', async ({ status, offField }) => {
    const own = await isolated('1507'), other = await isolated('1502')
    const rules = { ...own.rules, ...other.rules }, owner = 1507
    const library = createGearLibrary(gear)
    own.combat.members[0].sonata = library.module('sonata', 11, 5)
    own.combat.members.push(other.combat.members[0])
    const ember = Number(Object.keys(rules['1507'].effects).find(id => rules['1507'].effects[id].name === 'Heliacal Ember'))
    const crit = Number(Object.keys(own.combat.members[0].sonata.effects)
      .find(id => own.combat.members[0].sonata.effects[id].name === 'Eternal Radiance Crit Rate'))
    const spectro = Number(Object.keys(own.combat.members[0].sonata.effects)
      .find(id => own.combat.members[0].sonata.effects[id].name === 'Eternal Radiance Spectro DMG'))
    for (const id of ['1507', '1502']) rules[id].actions[42] = {
      name: 'Test status hit', cast: 2, timing: { duration: 1 },
      events: [{ id: 420, kind: 1, at: 0, index: 0, damage: { type: 2 } }],
    }
    rules['1507'].rules.push({ id: 'convert-on-hit', when: 1, phase: 'beforeHit', listenTeam: true,
      operations: [{ op: 'signalStatus', status, effect: ember, stacks: 1 }] })
    const state = createEffectState(rules, own.combat)
    state.active = 1502
    playCast(state, 1502, 42, 1); advanceEffectState(state, state.frame)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === crit && effect.stacks > 0)).toBe(false)
    state.enemy.heliacalEmber = 10
    state.active = offField ? 1502 : owner
    playCast(state, owner, 42, 1); advanceEffectState(state, state.frame)
    expect(state.effects.find((effect: RuntimeRecord) => effect.id === crit).until).toBe(900)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === spectro && effect.stacks > 0)).toBe(true)
    advanceEffectState(state, 850)
    playCast(state, owner, 42, 1); advanceEffectState(state, state.frame)
    expect(state.effects.find((effect: RuntimeRecord) => effect.id === crit).until).toBe(1750)
  })

  it('replays a recorded conversion at its hit once, with its real inflictor and without rewriting status stacks', async () => {
    const { rules, state } = await isolated('1406'), kit = rules['1406'], owner = 1406
    const effect = Number(Object.keys(kit.effects).find(id => kit.effects[id].status?.key === 'aeroErosion'))
    state.members[owner].state.recordedStacks = 0
    state.members[owner].state.inflictionSignals = 0
    kit.actions[42] = { name: 'Test conversion', cast: 2, timing: { duration: 1 }, events: [
      { id: 420, kind: 1, at: 0, index: 0, damage: { type: 2 } },
      { id: 421, kind: 1, at: 1, index: 1, damage: { type: 2 } },
    ] }
    kit.rules.push(
      { id: 'native-infliction', when: 1, phase: 'beforeHit', operations: [
        { op: 'signalStatus', status: 'aeroErosion', effect, stacks: 1 },
      ] },
      { id: 'observe-infliction', when: 'statusApplied', operations: [
        { op: 'add', path: 'state.inflictionSignals', value: 1 },
      ] },
      { id: 'observe-hit', when: 1, phase: 'afterDebuffs', operations: [
        { op: 'add', path: 'state.recordedStacks', value: { path: `event.appliedByOwner.${effect}.${owner}` } },
      ] },
    )
    playCast(state, owner, 42, 2, undefined, undefined, undefined, undefined, undefined,
      [{ hit: 0, owner, status: 'aeroErosion', stacks: 4 }])
    advanceEffectState(state, 1)
    expect(state.members[owner].state.recordedStacks).toBe(5)
    expect(state.members[owner].state.inflictionSignals).toBe(2)
    expect(state.enemy.aeroErosion ?? 0).toBe(0)
  })

  it('refreshes Suisui status caps independently after the triggering hit and retains them after the field ends', async () => {
    const { rules, state } = await isolated('1110'), kit = rules['1110'], owner = 1110
    const effectId = (name: string) => Number(Object.keys(kit.effects).find(id => kit.effects[id].name === name))
    const field = effectId('Suisui: Ceaseless Landscape'), chafe = effectId('Suisui: Glacio Chafe Stack Limit')
    const flare = effectId('Suisui: Electro Flare Stack Limit')
    expect(kit.effectControls[chafe]).toEqual([['runtime.state.controls.team:1110:ceaseless_glacio_chafe_limit:active', true]])
    kit.actions[42] = { name: 'Test status damage', cast: 0, timing: { duration: 1 },
      events: [{ id: 42, kind: 1, at: 0, status: 'glacioChafe', damage: { type: 11, status: 'glacioChafe' } }] }
    holdEffect(state, owner, field, 'team', 1)
    state.effects.find((effect: RuntimeRecord) => effect.id === field).until = 1200
    const hit = () => { playCast(state, owner, 42, 1); advanceEffectState(state, state.frame) }
    hit()
    expect(state.effects.find((effect: RuntimeRecord) => effect.id === chafe).until).toBe(900)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === flare)).toBe(false)
    expect(state.trace.findIndex((row: RuntimeRecord) => row.type === 'hit'))
      .toBeLessThan(state.trace.findIndex((row: RuntimeRecord) => row.type === 'effect' && row.effectId === chafe))
    advanceEffectState(state, 850); hit()
    expect(state.effects.find((effect: RuntimeRecord) => effect.id === chafe).until).toBe(1750)
    advanceEffectState(state, 1250); hit()
    expect(state.effects.find((effect: RuntimeRecord) => effect.id === chafe).until).toBe(1750)
    advanceEffectState(state, 1750)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === chafe && effect.stacks > 0 && effect.until > state.frame)).toBe(false)
  })

  it('refreshes Chisa cap for fifteen seconds after the last qualifying hit, independently of the Outro window', async () => {
    const { rules, state } = await isolated('1508'), kit = rules['1508'], owner = 1508
    const outro = Number(Object.keys(kit.effects).find(id => kit.effects[id].name === 'Chisa: Outro'))
    const cap = Number(Object.keys(kit.effects).find(id => kit.effects[id].name === 'Chisa: Negative Status Cap Window'))
    expect(kit.effectControls[outro]).toEqual([])
    expect(kit.effectControls[cap]).toEqual([['runtime.state.controls.team:1508:unraveling_law_zero:active', true]])
    kit.actions[42] = { name: 'Test - Hit', cast: kit.codes.cast.basic, input: 'basic', timing: { duration: 1 },
      events: [{ id: 1, kind: kit.codes.event.cast, at: 0 }, { id: 2, kind: kit.codes.event.hit, at: 0, index: 0, damage: { type: 0 } }] }
    kit.nodeFeatures[42] = 'test-hit'
    holdEffect(state, owner, outro, 'team', 1)
    const window = state.effects.find((effect: RuntimeRecord) => effect.id === outro)
    window.until = 1200
    const hit = () => { playCast(state, owner, 42, 1); advanceEffectState(state, state.frame) }
    hit(); expect(state.effects.find((effect: RuntimeRecord) => effect.id === cap).until).toBe(900)
    advanceEffectState(state, 850); hit()
    expect(state.effects.find((effect: RuntimeRecord) => effect.id === cap).until).toBe(1750)
    advanceEffectState(state, 1250); hit()
    expect(state.effects.find((effect: RuntimeRecord) => effect.id === cap).until).toBe(1750)
    advanceEffectState(state, 1749)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === cap && effect.stacks > 0)).toBe(true)
    advanceEffectState(state, 1750)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === cap && effect.stacks > 0 && effect.until > state.frame)).toBe(false)
  })

  it.each(['live', 'beta'])('places Cartethyia target-stack amplification in the amplification bucket in %s execution assets', async mode => {
    const id = '1409:lvl70:aero-erosion-bonus'
    const sources = await json(`public/data/${mode}/resonators/sources.json`)
    const authored = sources.find((source: RuntimeRecord) => String(source.source.id) === '1409')
    const runtime = await json(`public/data/${mode}/resonators/runtime-bundles/1409.json`)
    const worker = await json(`public/data/${mode}/resonators/worker-bundles/1409.json`)
    for (const source of [authored, runtime.source, worker.source]) {
      const effect = source.effects.find((effect: RuntimeRecord) => effect.id === id)
      expect(effect.operations).toEqual([expect.objectContaining({ type: 'add_top_stat', stat: 'amplify' })])
    }
  })

  it.each([{ swapping: false, delay: 0, expires: false }, { swapping: true, delay: 0, expires: false },
    { swapping: true, delay: 11, expires: false }, { swapping: true, delay: 11, expires: true }])('defers repeated incoming buff observations until the handoff (%j)', async ({ swapping, delay, expires }) => {
    const { rules, combat } = await isolated('1506'), ally = await isolated('1509')
    Object.assign(rules, ally.rules)
    combat.members.push(ally.combat.members[0])
    combat.initialOnFieldResonatorId = swapping ? 1509 : 1506
    const [actionId, action] = Object.entries(rules[1506].actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Basic - Chamuel\'s Star 1')! as [string, RuntimeRecord]
    const path = 'runtime.state.controls.team:1509:hit_the_road:active'
    const effectId = Number(Object.keys(rules[1509].effects).find(id => rules[1509].effects[id].name === "Let's Hit the Road!"))
    const cast = { type: 'cast', owner: 1506, actionId: Number(actionId), instance: 1, frame: 10 + delay }
    const onset = { type: 'effect', owner: 1509, target: 1506, effectId, frame: 10, stacks: 1, until: expires ? 20 : 850 }
    // a native grant and a held-state observation can repeat the same onset before the swap
    const trace = [onset, { ...onset },
      ...swapping ? [{ type: 'swap', from: 1509, to: 1506, frame: 10 + delay }] : [], cast,
      ...action.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
        ({ type: 'hit', owner: 1506, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 10 + delay }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast] }, {
      resonators: { 1506: await gameData('resonators/runtime-bundles/1506'), 1509: await gameData('resonators/runtime-bundles/1509') },
      effectControls: rules[1509].effectControls, activeOtherControls: new Set([`1509|${path}`]),
      preambleChoices: [{ resonatorId: '1509', state: { path, kind: 'toggle', defaultValue: false } }],
    })
    const activation = output.items.findIndex((node: RuntimeRecord) => node.type === 'condition' &&
      node.changes.some((change: RuntimeRecord) => change.path === path && change.value === true))
    const hit = output.items.findIndex((node: RuntimeRecord) => node.type === 'feature')
    if (expires) {
      expect(activation).toBe(-1)
      expect(hit).toBeGreaterThan(-1)
      return
    }
    expect(activation).toBeGreaterThan(-1)
    expect(activation).toBeLessThan(hit)
    if (swapping) expect(output.items.findIndex((node: RuntimeRecord) => node.type === 'condition' &&
      node.changes.some((change: RuntimeRecord) => change.path === 'runtime.rotation.activeResonatorId' && node.editorSection !== 'preamble')))
      .toBeLessThan(activation)
  })

  it('applies a before-damage gear grant to its own triggering hit without applying later grants', async () => {
    const { rules, combat } = await isolated('1506'), kit = rules['1506']
    const ally = await isolated('1507')
    Object.assign(rules, ally.rules)
    combat.members.push(ally.combat.members[0])
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Forte Heavy - Absolution Litany')! as [string, RuntimeRecord]
    const eventId = action.events.find((event: RuntimeRecord) => event.damage).id
    const path = 'runtime.state.controls.echoSet:11:bonus:radiance5p1'
    const effectId = 999
    combat.members[0].sonata.effects = { [effectId]: { name: 'Radiance', recipient: 'self', maxStacks: 1 } }
    const cast = { type: 'cast', owner: 1506, actionId: Number(actionId), instance: 1, frame: 0 }
    const grant = (sourceEventId: number) => ({ type: 'effect', owner: 1506, target: 1506, effectId,
      frame: 48, stacks: 1, until: 948, sourceActionId: Number(actionId), sourceInstance: 1, sourceEventId })
    const run = (sourceEventId: number) => emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60,
      casts: [cast], trace: [cast, { type: 'swap', from: 1506, to: 1507, frame: 8 }, grant(sourceEventId), { type: 'hit', owner: 1506, actionId: Number(actionId),
        eventId, instance: 1, frame: 48 }] }, {
      resonators: { 1506: bundle, 1507: allyBundle }, effectControls: { ...kit.effectControls, [effectId]: [[path, true]] },
      preambleChoices: [{ resonatorId: '1506', state: { path, kind: 'toggle', defaultValue: false } }],
    })
    const bundle = await gameData('resonators/runtime-bundles/1506')
    const allyBundle = await gameData('resonators/runtime-bundles/1507')
    const own = run(eventId).items.find((node: RuntimeRecord) => node.featureId === 'damage:1506030')
    expect(own.attached.conditions.flatMap((condition: RuntimeRecord) => condition.changes))
      .toContainEqual(expect.objectContaining({ path, value: true }))
    const unrelated = run(-1).items.find((node: RuntimeRecord) => node.featureId === 'damage:1506030')
    expect(unrelated.attached?.conditions.some((condition: RuntimeRecord) =>
      condition.changes.some((change: RuntimeRecord) => change.path === path && change.value === true)) ?? false).toBe(false)
  })

  it.each([false, true])('restores a modifier resource only with an observed spend (%s)', async observedSpend => {
    const { rules, combat } = await isolated('1507'), kit = rules['1507']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Outro - Beacon For the Future')! as [string, RuntimeRecord]
    const effectId = Number(Object.keys(kit.effects).find(id => kit.effects[id].name === 'Heliacal Ember'))
    const path = 'runtime.state.controls.resonator:1507:heliacal_ember:value'
    const cast = { type: 'cast', owner: 1507, actionId: Number(actionId), instance: 1, frame: 0,
      spentEffects: [{ owner: 1507, effectId, stacks: 7, consumed: 7, observedSpend }] }
    const trace = [{ type: 'control', owner: 1507, frame: 0, path, value: 7 }, cast,
      { type: 'control', owner: 1507, frame: 1, path, value: 0 },
      ...action.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
        ({ type: 'hit', owner: 1507, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 2 }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast] },
      { resonators: { 1507: await gameData('resonators/runtime-bundles/1507') }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1507', state: { path, kind: 'number', defaultValue: 0 } }] })
    const outro = output.items.find((node: RuntimeRecord) => node.featureId === 'damage:1507:outro')
    expect(outro.attached?.conditions.some((condition: RuntimeRecord) =>
      condition.changes.some((change: RuntimeRecord) => change.path === path && change.value === 7)) ?? false).toBe(observedSpend)
    expect(output.items.filter((node: RuntimeRecord) => node.type === 'condition' && node.editorSection !== 'preamble')
      .flatMap((node: RuntimeRecord) => node.changes).filter((change: RuntimeRecord) => change.path === path)
      .map((change: RuntimeRecord) => change.value)).toEqual([7, 0])
  })

  it('applies a captured single-hit tail condition to its aggregate feature without changing the persistent timeline', async () => {
    const { rules, combat } = await isolated('1406'), kit = rules['1406']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Forte Skill - Unbound Flow 2')! as [string, RuntimeRecord]
    const path = 'runtime.state.controls.inherent:1406:lvl50:active'
    const cast = { type: 'cast', owner: 1406, actionId: Number(actionId), instance: 1, frame: 0,
      hitControls: [{ hit: 0, owner: 1406, path, value: false }] }
    const trace = [{ type: 'control', owner: 1406, frame: 0, path, value: true }, cast,
      ...action.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
        ({ type: 'hit', owner: 1406, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 12 }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast] },
      { resonators: { 1406: await gameData('resonators/runtime-bundles/1406') }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1406', state: { path, kind: 'toggle', defaultValue: false } }] })
    const tail = output.items.find((node: RuntimeRecord) => node.featureId === 'damage:1406028')
    expect(tail.attached.conditions.flatMap((condition: RuntimeRecord) => condition.changes))
      .toContainEqual(expect.objectContaining({ path, value: false }))
    expect(output.items.filter((node: RuntimeRecord) => node.type === 'condition' && node.editorSection !== 'preamble')
      .flatMap((node: RuntimeRecord) => node.changes).filter((change: RuntimeRecord) => change.path === path)
      .map((change: RuntimeRecord) => change.value)).toEqual([true])
  })

  it('maps sparse Qiuyuan held Skill events through repeated hit-table rows without adding the omitted hit', async () => {
    const { rules, combat } = await isolated('1411'), kit = rules['1411']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Skill - Undaunted Wayfarer (Hold)')! as [string, RuntimeRecord]
    const events = action.events.filter((event: RuntimeRecord) => event.damage)
    const cast = { type: 'cast', owner: 1411, actionId: Number(actionId), instance: 1, frame: 0, landedIndices: [0, 1, 2, 4] }
    const trace = [cast, ...[0, 1, 2, 4].map(index => ({ type: 'hit', owner: 1411,
      actionId: Number(actionId), eventId: events[index].id, instance: 1, frame: 1 }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast] },
      { resonators: { 1411: await gameData('resonators/runtime-bundles/1411') }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1411', state: {
          path: 'runtime.state.controls.resonator:1411:bamboo_shade:active', kind: 'toggle', defaultValue: false } }] })
    expect(output.items.filter((node: RuntimeRecord) => node.type === 'feature')
      .map((node: RuntimeRecord) => [node.featureId, node.multiplier])).toEqual([
      ['damage:1308010:hit:1', 1], ['damage:1308010:hit:2', 2], ['damage:1308010:hit:3', 1],
    ])
    expect(output.diagnostics.scaledPartialFeatures).toBe(0)
  })

  it('preserves each landed hit identity when a complete aggregate has different captured conditions', async () => {
    const { rules, combat } = await isolated('1411'), kit = rules['1411']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Skill - Undaunted Wayfarer (Hold)')! as [string, RuntimeRecord]
    const events = action.events.filter((event: RuntimeRecord) => event.damage)
    const path = 'runtime.state.controls.resonator:1411:bamboo_shade:active'
    const cast = { type: 'cast', owner: 1411, actionId: Number(actionId), instance: 1, frame: 0,
      hitControls: events.map((_: RuntimeRecord, hit: number) => ({ hit, owner: 1411, path, value: hit === 2 })) }
    const trace = [cast, ...events.map((event: RuntimeRecord) => ({ type: 'hit', owner: 1411,
      actionId: Number(actionId), eventId: event.id, instance: 1, frame: 1 }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast] },
      { resonators: { 1411: await gameData('resonators/runtime-bundles/1411') }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1411', state: { path, kind: 'toggle', defaultValue: false } }] })
    const nodes = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(nodes.reduce((count: number, node: RuntimeRecord) => count + node.multiplier, 0)).toBe(5)
    const enabled = nodes.filter((node: RuntimeRecord) => node.attached?.conditions.some((condition: RuntimeRecord) =>
      condition.changes.some((change: RuntimeRecord) => change.path === path && change.value === true)))
    expect(enabled).toHaveLength(1)
    expect(enabled[0]).toMatchObject({ featureId: 'damage:1308010:hit:2', multiplier: 1 })
  })

  it.each([20, 30, 60])('uses Sigrika opening %i Vitality for the runic bonus over its smaller recorded spend', async available => {
    const { rules, combat } = await isolated('1412'), kit = rules['1412']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Forte - Runic Chain Whip')! as [string, RuntimeRecord]
    const effectId = Number(Object.keys(kit.effects).find(id => kit.effects[id].name === 'Sigrika: Soliskin Vitality'))
    const cast = { type: 'cast', owner: 1412, actionId: Number(actionId), instance: 1, frame: 0,
      spentEffects: [{ owner: 1412, effectId, stacks: available, consumed: 1 }] }
    const trace = [cast, ...action.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
      ({ type: 'hit', owner: 1412, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 10 }))]
    const path = 'runtime.state.controls.resonator:1412:soliskin_vitality:value'
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast] },
      { resonators: { 1412: await gameData('resonators/runtime-bundles/1412') }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1412', state: { path, kind: 'number', defaultValue: 0 } }] })
    const followup = output.items.find((node: RuntimeRecord) => node.featureId === 'damage:1412023')
    expect(followup.attached.conditions.flatMap((condition: RuntimeRecord) => condition.changes))
      .toContainEqual(expect.objectContaining({ path, value: available / 10 }))
    expect(followup.multiplier).toBe(1)
  })

  it('recreates Mortefi Harmonic Control after expiry and binds S3 to Burning Rhapsody', async () => {
    const { rules, combat } = await isolated('1204')
    const kits = timelineKits(rules, { timelines: { owns: { 1204: ['Inherent: Harmonic Control'] } } } as unknown as ActionPlan)
    const id = Number(Object.keys(kits[1204].effects).find(id => kits[1204].effects[id].name === 'Inherent: Harmonic Control'))
    const state = createEffectState(kits, combat)
    resolveAction(state, 1204, 'Skill - Passionate Variation')
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(true)
    advanceEffectState(state, state.frame + 481)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(false)
    resolveAction(state, 1204, 'Skill - Passionate Variation')
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(true)
    const rhapsody = Object.keys(kits[1204].effects).find(id => kits[1204].effects[id].name === 'Mortefi: Burning Rhapsody')!
    expect(kits[1204].effectControls[rhapsody]).toEqual([['runtime.state.controls.sequence:1204:s3:active', true]])
    expect(kits[1204].standingControls?.['sequence:1204:s3:active']).toBeUndefined()
  })

  it('recreates Sanhua Condensation after expiry and opens her permanent S5 control in the preamble', async () => {
    const { rules, combat } = await isolated('1102')
    const kits = timelineKits(rules, { timelines: { owns: { 1102: ['Inherent: Condensation'] } } } as unknown as ActionPlan)
    const id = Number(Object.keys(kits[1102].effects).find(id => kits[1102].effects[id].name === 'Inherent: Condensation'))
    const state = createEffectState(kits, combat)
    resolveAction(state, 1102, 'Intro - Freezing Thorns')
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(true)
    advanceEffectState(state, state.frame + 481)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(false)
    resolveAction(state, 1102, 'Intro - Freezing Thorns')
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(true)
    const key = 'sequence:1102:s5:active', path = `runtime.state.controls.${key}`
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 0 }, { trace: [], casts: [], frame: 0 },
      { resonators: { 1102: await gameData('resonators/runtime-bundles/1102') },
        preambleChoices: [{ resonatorId: '1102', state: { controlKey: key, path, kind: 'toggle', defaultValue: false } }] })
    expect(output.items.flatMap((node: RuntimeRecord) => node.changes ?? [])
      .find((change: RuntimeRecord) => change.path === path)?.value).toBe(true)
  })

  it('recreates Aero Rover Sand in the Storm on later Intros after its ten-second expiry', async () => {
    const { rules, combat } = await isolated('1406')
    const kits = timelineKits(rules, { timelines: { owns: { 1406: ['Inherent: Sand in the Storm'] } } } as unknown as ActionPlan)
    const id = Number(Object.keys(kits[1406].effects).find(id => kits[1406].effects[id].name === 'Inherent: Sand in the Storm'))
    const intro = (Object.values(kits[1406].actions) as RuntimeRecord[]).find(action => action.cast === 4)!
    const state = createEffectState(kits, combat)
    resolveAction(state, 1406, intro.name)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(true)
    advanceEffectState(state, state.frame + 601)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(false)
    resolveAction(state, 1406, intro.name)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(true)
  })

  it('enables Buling automatic S6 upgrade in the generated preamble', async () => {
    const { rules, combat } = await isolated('1307')
    const key = 'sequence:1307:s6:active', path = `runtime.state.controls.${key}`
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 0 }, { trace: [], casts: [], frame: 0 },
      { resonators: { 1307: await gameData('resonators/runtime-bundles/1307') },
        preambleChoices: [{ resonatorId: '1307', state: { controlKey: key, path, kind: 'toggle', defaultValue: false } }] })
    expect(output.items.flatMap((node: RuntimeRecord) => node.changes ?? [])
      .find((change: RuntimeRecord) => change.path === path)?.value).toBe(true)
    const bundle = await gameData('resonators/runtime-bundles/1307')
    const effect = bundle.source.effects.find((effect: RuntimeRecord) => effect.id === '1307:s6:heaven-earth-mind')
    expect(JSON.stringify(effect.condition)).toContain('base.sequence')
    expect(JSON.stringify(effect.condition)).toContain('thunder_spell_heaven_earth_mind:active')
  })

  it.each([1, 2])('maps Camellya Ephemeral Outro packets independently when %i hit lands', async landed => {
    const { rules, combat } = await isolated('1603'), kit = rules[1603]
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Outro - Twining (Ephemeral)')! as [string, RuntimeRecord]
    const cast = { type: 'cast', owner: 1603, actionId: Number(actionId), action: action.name, instance: 1, frame: 0, share: 0.4177 }
    const trace = [cast, ...action.events.filter((event: RuntimeRecord) => event.damage).slice(0, landed)
      .map((event: RuntimeRecord) => ({ type: 'hit', owner: 1603, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 0 }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 1 }, { trace, casts: [cast], frame: 1 },
      { resonators: { 1603: await gameData('resonators/runtime-bundles/1603') }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1603', state: { path: 'enemy.combat.havocBane', kind: 'number', defaultValue: 0 } }] })
    expect(output.items.filter((node: RuntimeRecord) => node.type === 'feature')
      .map((node: RuntimeRecord) => [node.featureId, node.multiplier])).toEqual([
      ['damage:1603:outro', 1], ['damage:1603:ephemeral-twining', 1],
    ].slice(0, landed))
  })

  it('uses actual Galbrena Outro hit features for a shortened cast with integer play counts', async () => {
    const { rules, combat } = await isolated('1208'), kit = rules[1208]
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Outro - Ashen Pursuit')! as [string, RuntimeRecord]
    const cast = { type: 'cast', owner: 1208, actionId: Number(actionId), action: action.name, instance: 1, frame: 0, share: 0.2 }
    const trace = [cast, ...action.events.filter((event: RuntimeRecord) => event.damage).slice(0, 2)
      .map((event: RuntimeRecord) => ({ type: 'hit', owner: 1208, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 0 }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 1 }, { trace, casts: [cast], frame: 1 },
      { resonators: { 1208: await gameData('resonators/runtime-bundles/1208') }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1208', state: {
          path: 'runtime.state.controls.inherent:1208:lvl50:stacks', kind: 'stack', defaultValue: 0 } }] })
    expect(output.items.filter((node: RuntimeRecord) => node.type === 'feature')
      .map((node: RuntimeRecord) => [node.featureId, node.multiplier])).toEqual([
      ['damage:1208:ashen-pursuit:hit:1', 1], ['damage:1208:ashen-pursuit:hit:2', 1],
    ])
  })

  it('reacquires Galbrena Burning Drive from her own next cast after its prior window expires', async () => {
    const { rules, combat } = await isolated('1208')
    const kits = timelineKits(rules, { timelines: { owns: { 1208: ['Galbrena: Burning Drive'] } } } as unknown as ActionPlan)
    const id = Number(Object.keys(kits[1208].effects).find(id => kits[1208].effects[id].name === 'Galbrena: Burning Drive'))
    expect(kits[1208].effects[id].replayGrants).toBeUndefined()
    // the timeline holder stays plain; its native grant rule can create a new holder after a gap as well as refresh
    // an existing one
    const state = createEffectState(kits, combat)
    resolveAction(state, 1208, 'Skill - Encroach')
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(true)
    advanceEffectState(state, state.frame + 241)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(false)
    resolveAction(state, 1208, 'Skill - Ascent of Malice')
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)).toBe(true)
  })

  it('recreates Mornye fields after expiry even when reference snapshots have no new edge', async () => {
    const { rules, combat } = await isolated('1209')
    const kits = timelineKits(rules, { timelines: { owns: { 1209: ['Syntony Field', 'High Syntony Field'] } } } as unknown as ActionPlan)
    const fieldId = Number(Object.keys(kits[1209].effects).find(id => kits[1209].effects[id].name === 'Syntony Field'))
    const highId = Number(Object.keys(kits[1209].effects).find(id => kits[1209].effects[id].name === 'High Syntony Field'))
    expect(kits[1209].governed.has(fieldId)).toBe(false)
    expect(kits[1209].governed.has(highId)).toBe(false)
    const state = createEffectState(kits, combat)
    const cast = (name: string) => { resolveAction(state, 1209, name); advanceEffectState(state, state.readyAt) }
    const held = (id: number) => state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.stacks > 0 && effect.until > state.frame)
    cast('Forte - Syntony Field')
    cast('Liberation - Critical Protocol')
    expect(held(highId)).toBe(true)
    advanceEffectState(state, state.frame + 1501)
    expect(held(highId)).toBe(false)
    cast('Forte - Syntony Field')
    expect(held(fieldId)).toBe(true)
    cast('Liberation - Critical Protocol')
    expect(held(highId)).toBe(true)
    expect(held(fieldId)).toBe(false)
  })

  it('counts consecutive shields for Crown of Valor and refreshes the whole stack window', async () => {
    const { rules, combat } = await isolated('1410'), env = await environment()
    const sonata = env.gear.module('sonata', 20, 3)
    combat.members[0].sonata = sonata
    const state = createEffectState(rules, combat)
    const id = Number(Object.keys(sonata.effects)[0])
    const held = () => state.effects.find((effect: RuntimeRecord) => effect.id === id && effect.until > state.frame)
    playSupport(state, 1410, 'shield')
    playSupport(state, 1410, 'shield')
    expect(held()?.stacks).toBe(2)
    advanceEffectState(state, 200)
    for (let i = 0; i < 4; i++) playSupport(state, 1410, 'shield')
    expect(held()?.stacks).toBe(5)
    advanceEffectState(state, 241)
    expect(held()?.stacks).toBe(5)
    advanceEffectState(state, 400)
    playSupport(state, 1410, 'shield')
    expect(held()?.until).toBe(640)
    advanceEffectState(state, 640)
    expect(held()).toBeUndefined()
  })

  it('refreshes capped Law of Harmony with a repeated Echo without earning duplicate early stacks', async () => {
    const { rules, combat } = await isolated('1411'), env = await environment()
    const sonata = env.gear.module('sonata', 21, 3)
    combat.members[0].sonata = sonata
    const state = createEffectState(rules, combat)
    const effectId = Number(Object.keys(sonata.effects).find(id => sonata.effects[id].maxStacks === 4))
    for (let index = 0; index < 4; index++) rules[1411].actions[42 + index] = {
      name: `Test Echo ${index}`, cast: 6, timing: { duration: 1 }, events: [{ id: 420 + index, kind: 0, at: 0 }],
    }
    const cast = (index: number) => { playCast(state, 1411, 42 + index, 0); advanceEffectState(state, state.frame) }
    const held = () => state.effects.find((effect: RuntimeRecord) => effect.id === effectId && effect.until > state.frame)
    cast(0)
    const initialUntil = held().until
    advanceEffectState(state, 20)
    cast(0)
    expect(held().stacks).toBe(1)
    expect(held().until).toBe(initialUntil)
    for (let index = 1; index < 4; index++) cast(index)
    expect(held().stacks).toBe(4)
    advanceEffectState(state, 200)
    cast(0)
    expect(held().stacks).toBe(4)
    expect(held().until).toBe(2000)
    // the same handler serves weapons that forbid cap refresh
    state.effectDefinitions[effectId].refreshOnGrant = false
    advanceEffectState(state, 300)
    cast(0)
    expect(held().until).toBe(2000)
    const heavy = Number(Object.keys(sonata.effects).find(id => sonata.effects[id].maxStacks === 1))
    expect(sonata.effectControls[heavy]).toEqual([['runtime.state.controls.echoSet:21:bonus:lawOfHarmonyHeavy3p', true]])
    expect(sonata.effectControls[effectId]).toEqual([['runtime.state.controls.echoSet:21:bonus:lawOfHarmony3p', 'stacks']])
    advanceEffectState(state, 600)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === heavy && effect.until > state.frame)).toBe(false)
    expect(held().stacks).toBe(4)
    advanceEffectState(state, 2000)
    cast(0)
    expect(held().stacks).toBe(1)
    expect(held().sources).toEqual([42])
  })
  it('does not restore a cast-granted window over its narrower before-hit payout control', async () => {
    const { rules, combat } = await isolated('1205'), kit = rules['1205']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Liberation - Radiance of Fealty')! as [string, RuntimeRecord]
    const effectId = Number(Object.keys(kit.effects).find(id => kit.effects[id].name === 'Changli: Fiery Feather'))
    const path = 'runtime.state.controls.resonator:1205:fiery_feather:active'
    const cast = { type: 'cast', owner: 1205, actionId: Number(actionId), instance: 1, frame: 1 }
    const trace = [cast, { type: 'effect', owner: 1205, effectId, recipient: 'self', target: 1205,
      stacks: 1, until: 601, frame: 1, sourceActionId: Number(actionId), sourceInstance: 1,
      sourceEventId: action.events.find((event: RuntimeRecord) => event.kind === kit.codes.event.cast).id },
    { type: 'control', owner: 1205, path, value: false, frame: 9 },
    ...action.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) => ({
      type: 'hit', owner: 1205, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 10 }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 20 }, { frame: 20, trace, casts: [cast] }, {
      resonators: { 1205: await gameData('resonators/runtime-bundles/1205') }, effectControls: kit.effectControls,
      preambleChoices: [{ resonatorId: '1205', state: { path, kind: 'toggle', defaultValue: false } }],
    })
    const features = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(features.length).toBeGreaterThan(0)
    expect(features.every((node: RuntimeRecord) => !node.attached?.conditions.some((condition: RuntimeRecord) =>
      condition.changes.some((change: RuntimeRecord) => change.path === path && change.value === true)))).toBe(true)
  })

  it('preserves a complete attack split when its own earlier hit activates a weapon buff', async () => {
    const { rules, combat } = await isolated('1206'), kit = rules['1206']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Forte Skill - Returned from Ashes')! as [string, RuntimeRecord]
    const path = 'runtime.state.controls.weapon:21020036:passive:second'
    combat.members[0].weapon.effects[999] = { name: 'Basic damage bonus', recipient: 'self', maxStacks: 1, duration: 240 }
    const events = action.events.filter((event: RuntimeRecord) => event.damage)
    const cast = { type: 'cast', owner: 1206, actionId: Number(actionId), instance: 1, frame: 1 }
    const grant = { type: 'effect', owner: 1206, effectId: 999, recipient: 'self', target: 1206,
      stacks: 1, until: 251, frame: 11, sourceActionId: Number(actionId), sourceInstance: 1, sourceEventId: events[0].id }
    const hits = events.map((event: RuntimeRecord, index: number) => ({ type: 'hit', owner: 1206,
      actionId: Number(actionId), eventId: event.id, instance: 1, frame: 10 + index * 10 }))
    const editor = { resonators: { 1206: await gameData('resonators/runtime-bundles/1206') },
      effectControls: { 999: [[path, true]] },
      preambleChoices: [{ resonatorId: '1206', state: { path, kind: 'toggle', defaultValue: false } }] }
    const run = (trace: RuntimeRecord[]) => emitEditorProgram(rules, { ...combat, maxFrames: 60 },
      { frame: 60, trace, casts: [cast] }, editor).items.filter((node: RuntimeRecord) => node.type === 'feature')
    const features = run([cast, hits[0], grant, ...hits.slice(1)])
    expect(features.length).toBeGreaterThan(1)
    expect(features[0].attached).toBeUndefined()
    expect(features.slice(1).every((node: RuntimeRecord) => node.attached?.conditions.some((condition: RuntimeRecord) =>
      condition.changes.some((change: RuntimeRecord) => change.path === path && change.value === true)))).toBe(true)
    expect(features.reduce((sum: number, node: RuntimeRecord) => sum + node.multiplier, 0)).toBe(events.length)
    const stable = run([{ ...grant, frame: 0, sourceInstance: 0 }, cast, ...hits])
    expect(stable).toHaveLength(1)
    expect(stable[0].featureId).not.toContain(':hit:')
  })

  it('expires realms and gear between short-attack hits without applying a later activation', async () => {
    const { rules, combat } = await isolated('1511'), kit = rules['1511']
    const shorekeeper = await isolated('1505'), realm = shorekeeper.rules['1505']
    rules['1505'] = realm
    combat.members.push(shorekeeper.combat.members[0])
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Heavy - Locked Thread 2')! as [string, RuntimeRecord]
    const field = Number(Object.keys(realm.effects).find(id => realm.effects[id].name === 'Supernal Stellarealm'))
    const outro = Number(Object.keys(realm.effects).find(id => realm.effects[id].name === 'Binary Butterfly'))
    const path = 'runtime.state.controls.resonator:1505:supernal_stellarealm:active'
    const outroPath = 'runtime.state.controls.resonator:1505:binary_butterfly:active'
    const gearPath = 'runtime.state.controls.weapon:21030056:passive:spectro_stacks'
    combat.members[0].weapon.effects[999] = { name: 'Timed gear stacks', recipient: 'self', maxStacks: 3, duration: 20 }
    const cast = { type: 'cast', owner: 1511, actionId: Number(actionId), action: action.name, instance: 1, frame: 1 }
    const events = action.events.filter((event: RuntimeRecord) => event.damage)
    const trace = [{ type: 'effect', owner: 1505, effectId: field, recipient: 'team', target: 'team',
      stacks: 1, until: 20, frame: 0 }, { type: 'effect', owner: 1505, effectId: outro, recipient: 'team', target: 'team',
      stacks: 1, until: 20, frame: 0 }, { type: 'effect', owner: 1511, effectId: 999, recipient: 'self', target: 1511,
      stacks: 3, until: 20, frame: 0 }, cast,
      ...events.map((event: RuntimeRecord, index: number) => ({ type: 'hit', owner: 1511,
        actionId: Number(actionId), eventId: event.id, instance: 1, frame: index ? 25 + index : 10 }))]
    const editor = { resonators: { 1511: await gameData('resonators/runtime-bundles/1511'),
      1505: await gameData('resonators/runtime-bundles/1505') }, effectControls: { ...realm.effectControls, 999: [[gearPath, 'stacks']] },
      preambleChoices: [...[path, outroPath, 'runtime.state.controls.resonator:1505:inner_stellarealm:active']
        .map(path => ({ resonatorId: '1505', state: { path, kind: 'toggle', defaultValue: false } })),
      { resonatorId: '1511', state: { path: gearPath, kind: 'stack', defaultValue: 0 } }] }
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast] }, editor)
    const features = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(features[0].attached).toBeUndefined()
    expect(features.slice(1).every((node: RuntimeRecord) => node.attached?.conditions.some((condition: RuntimeRecord) =>
      condition.changes.some((change: RuntimeRecord) => change.path === path && change.value === false)))).toBe(true)
    expect(features.slice(1).every((node: RuntimeRecord) => node.attached?.conditions.some((condition: RuntimeRecord) =>
      condition.changes.some((change: RuntimeRecord) => change.path === gearPath && change.value === 0)))).toBe(true)
    expect(features.slice(1).every((node: RuntimeRecord) => node.attached?.conditions.some((condition: RuntimeRecord) =>
      condition.changes.some((change: RuntimeRecord) => change.path === outroPath && change.value === false)))).toBe(true)

    // a field created by a later prescribed cast cannot be moved back into the current short tail because those hits
    // resolve later
    const later = [{ ...trace[0], frame: 20, until: 100 }, cast, ...trace.filter(entry => entry.type === 'hit')]
      .sort((a, b) => a.frame - b.frame)
    const next = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace: later, casts: [cast] }, editor)
    expect(next.items.filter((node: RuntimeRecord) => node.type === 'feature').every((node: RuntimeRecord) => !node.attached)).toBe(true)
  })
  it('preserves a short attack split when another cast enables its weapon between hits', async () => {
    const { rules, combat } = await isolated('1109'), kit = rules['1109']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Basic - Tracing Forms 3')! as [string, RuntimeRecord]
    const path = 'runtime.state.controls.weapon:21050056:passive:stacks'
    combat.members[0].weapon.effects[999] = { name: 'Weapon window', recipient: 'self', maxStacks: 2, duration: 600 }
    const cast = { type: 'cast', owner: 1109, actionId: Number(actionId), action: action.name, instance: 1, frame: 0 }
    const otherId = Number(Object.keys(kit.actions).find(id => kit.actions[id].name === 'Forte Echo - Oblivion'))
    const otherCast = { type: 'cast', owner: 1109, actionId: otherId, instance: 2, frame: 35 }
    const events = action.events.filter((event: RuntimeRecord) => event.damage)
    const trace = [cast, otherCast, ...events.map((event: RuntimeRecord) => ({ type: 'hit', owner: 1109,
      actionId: Number(actionId), eventId: event.id, instance: 1, frame: event.at })),
    { type: 'effect', owner: 1109, effectId: 999, recipient: 'self', target: 1109,
      sourceActionId: otherId, sourceInstance: 2, stacks: 1, until: 600, frame: 35 }]
      .sort((a, b) => a.frame - b.frame)
    const editor = { resonators: { 1109: await gameData('resonators/runtime-bundles/1109') },
      effectControls: { 999: [[path, 'stacks']] }, preambleChoices: [
        { resonatorId: '1109', state: { path, kind: 'stack', defaultValue: 0 } }] }
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 150 }, { frame: 150, trace, casts: [cast, otherCast] }, editor)
    const features = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(features[0].featureId).toContain(':hit:')
    expect(features[0].attached).toBeUndefined()
    const later = features.slice(1)
    expect(later.length).toBeGreaterThan(0)
    expect(later.every((node: RuntimeRecord) => node.attached?.conditions.some((condition: RuntimeRecord) =>
      condition.changes.some((change: RuntimeRecord) => change.path === path && change.value === 1)))).toBe(true)
    expect(features.reduce((sum: number, node: RuntimeRecord) => sum + node.multiplier, 0)).toBe(events.length)
  })
  it('retains Heaven\'s Clarity through its consuming finisher without per-hit restoration nodes', async () => {
    const { rules, combat } = await isolated('1413'), kit = rules['1413']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === "Forte Heavy - Heaven's Reckoning")! as [string, RuntimeRecord]
    const clarity = Number(Object.keys(kit.effects).find(id => kit.effects[id].name === "Qingxiao: Heaven's Clarity"))
    expect(Number.isFinite(clarity)).toBe(true)
    const path = 'runtime.state.controls.resonator:1413:heavens_clarity:active'
    const effect = (stacks: number, frame: number) => ({ type: 'effect', owner: 1413, effectId: clarity,
      target: 1413, recipient: 'self', stacks, until: stacks ? 1000 : frame, frame })
    const cast = { type: 'cast', owner: 1413, actionId: Number(actionId), action: action.name, instance: 1, frame: 1,
      spentEffects: [{ owner: 1413, effectId: clarity, stacks: 1, consumed: 1 }] }
    const trace = [effect(1, 0), cast, effect(0, 1),
      ...action.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) => ({ type: 'hit',
        owner: 1413, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 2 })), effect(1, 3)]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast] },
      { resonators: { 1413: await gameData('resonators/runtime-bundles/1413') }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1413', state: { path, kind: 'toggle', defaultValue: false } }] })
    const features = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(features.map((node: RuntimeRecord) => node.featureId)).toEqual(['damage:1413406'])
    expect(features[0].attached).toBeUndefined()
    expect(output.items.filter((node: RuntimeRecord) => node.changes?.some((change: RuntimeRecord) => change.path === path))
      .map((node: RuntimeRecord) => node.changes[0].value)).toEqual([false, true])
  })
  it.each([
    { ids: [1308, 1110], recipient: 1308, control: 'inherent:1308:lvl50:hack_shifting' },
    { ids: [1308, 1110], recipient: 1110, control: 'inherent:1308:lvl50:hack_shifting' },
    { ids: [1508, 1509], recipient: 1508, control: 'resonator:1508:thread_of_bane:active' },
    { ids: [1508, 1509], recipient: 1509, control: 'resonator:1508:thread_of_bane:active' },
  ])('applies $control only to its marked recipient $recipient', async ({ ids, recipient, control }) => {
    const env = await environment(), rules = await env.characters.load(ids.map(String), 'beta')
    const resonators = Object.fromEntries(await Promise.all(ids.map(async id =>
      [id, await gameData(`resonators/runtime-bundles/${id}`)])))
    const members = ids.map(resonatorId => ({ resonatorId, build: { level: 90, sequence: 0 },
      weapon: { id: 0, effects: {}, rules: [] }, echoes: { main: { id: 0, effects: {}, rules: [] } }, sonata: { effects: {}, rules: [] } }))
    const kit = rules[ids[0]], path = `runtime.state.controls.${control}`
    const marker = kit.recipientConditions.find((condition: RuntimeRecord) => condition.path === path).effect
    const trace: RuntimeRecord[] = [{ type: 'effect', owner: ids[0], effectId: marker,
      target: recipient, recipient: 'self', stacks: 1, until: 1000, frame: 0 }]
    for (const [index, owner] of ids.entries()) {
      const [actionId, action] = Object.entries(rules[owner].actions).find(([key, action]) =>
        typeof rules[owner].nodeFeatures[key] === 'string' && (action as RuntimeRecord).events.some((event: RuntimeRecord) => event.damage))! as [string, RuntimeRecord]
      trace.push({ type: 'cast', owner, actionId: Number(actionId), action: action.name, instance: index + 1, frame: index + 1 })
      for (const event of action.events.filter((event: RuntimeRecord) => event.damage)) trace.push({ type: 'hit', owner,
        actionId: Number(actionId), eventId: event.id, instance: index + 1, frame: index + 1 })
    }
    const output = emitEditorProgram(rules, { members, initialOnFieldResonatorId: ids[0], maxFrames: 60 },
      { frame: 60, trace, casts: trace.filter(entry => entry.type === 'cast') },
      { resonators, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: String(ids[0]), state: { path, kind: 'toggle', defaultValue: false } }] })
    const features = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(features.some((node: RuntimeRecord) => Number(node.resonatorId) === recipient)).toBe(true)
    for (const node of features) {
      const denied = node.attached?.conditions?.flatMap((condition: RuntimeRecord) => condition.changes)
        .some((change: RuntimeRecord) => change.path === path && change.value === false) ?? false
      expect(denied).toBe(Number(node.resonatorId) !== recipient)
    }
  })
  it('refreshes Glint of Clouds at maximum without restarting its short stack ramp', async () => {
    const { rules, combat } = await isolated('1413'), env = await environment()
    const weapon = env.gear.module('weapon', 21020106, 1)
    combat.members[0].weapon = weapon
    const state = createEffectState(timelineKits(rules, { timelines: { owns: {}, names: [], runs: {} } } as unknown as ActionPlan), combat)
    const maximum = Number(Object.keys(weapon.effects).find(id => weapon.effects[id].name.endsWith('maximum')))
    const held = () => state.effects.find((effect: RuntimeRecord) => effect.id === maximum && effect.until > state.frame)
    for (let i = 0; i < 12 && !held(); i++) {
      resolveAction(state, 1413, 'Basic - Stringblade 1')
      advanceEffectState(state, state.readyAt)
    }
    expect(held()).toBeDefined()
    const previousExpiry = held()!.until
    advanceEffectState(state, previousExpiry - 90)
    resolveAction(state, 1413, 'Basic - Stringblade 1')
    advanceEffectState(state, previousExpiry + 1)
    expect(held()?.until).toBeGreaterThan(previousExpiry)
    expect(held()?.stacks).toBe(1)
  })
  it.each([27, 250])('uses each follow-up hit time even when the first hit lands at %i frames', async firstHit => {
    const { rules, combat } = await isolated('1410'), kit = rules['1410']
    const [actionId, original] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Forte Skill - Enhanced Arc Beyond the Edge')! as [string, RuntimeRecord]
    const action = structuredClone(original)
    action.events.forEach((event: RuntimeRecord) => { if (event.damage) event.at += 200 })
    kit.actions[actionId] = action
    const path = 'runtime.state.controls.resonator:1410:wan_light:stacks'
    kit.effects[999] = { name: 'Native field test', recipient: 'self', replayLifecycle: true }
    kit.effectControls[999] = [[path, 'stacks']]
    const handoffPath = 'runtime.state.controls.team:1410:gloom_to_gleam:active'
    combat.members[0].weapon.effects[1000] = { name: 'Pinned handoff test', recipient: 'incomingMember' }
    combat.members[0].weapon.effects[1001] = { name: 'Inactive mode alias', recipient: 'team', duration: 500, maxStacks: 1 }
    const damageEvents = action.events.filter((event: RuntimeRecord) => event.damage)
    const cast = { type: 'cast', owner: 1410, actionId: Number(actionId), action: action.name, instance: 1, frame: 0,
      hitFrames: [firstHit, 278] }
    const hit = (event: RuntimeRecord, frame: number) => ({ type: 'hit', owner: 1410,
      actionId: Number(actionId), eventId: event.id, instance: 1, frame })
    const trace = [{ type: 'control', owner: 1410, path: handoffPath, value: true, frame: 0 },
      cast, hit(damageEvents[0], firstHit), { type: 'effect', owner: 1410, effectId: 999,
      target: 1410, recipient: 'self', stacks: 10, until: 500, frame: 260 },
      { type: 'effect', owner: 1410, effectId: 1000, target: 1110, recipient: 'incomingMember', stacks: 1, until: 500, frame: 260 },
      hit(damageEvents[1], 278)]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 300 }, { frame: 300, trace, casts: [cast] },
      { resonators: { 1410: await gameData('resonators/runtime-bundles/1410') },
        effectControls: { ...kit.effectControls, 1000: [[handoffPath, true]], 1001: [[handoffPath, true]] },
        preambleChoices: [{ resonatorId: '1410', state: { path, kind: 'stack', defaultValue: 0 } },
          { resonatorId: '1410', state: { path: handoffPath, kind: 'toggle', defaultValue: false } }] })
    const hits = output.items.filter((node: RuntimeRecord) => node.featureId === 'damage:1410026:hit:1')
    expect(hits).toHaveLength(2)
    expect(hits[0].attached).toBeUndefined()
    expect(hits[1].attached.conditions[0].changes[0]).toMatchObject({ path, value: 10 })
    expect(hits.flatMap((node: RuntimeRecord) => node.attached?.conditions ?? [])
      .flatMap((condition: RuntimeRecord) => condition.changes).some((change: RuntimeRecord) => change.path === handoffPath)).toBe(false)
  })
  it('preserves different Wan Light states on the two Enhanced Arc hits without changing the timeline', async () => {
    const { rules, combat } = await isolated('1410'), kit = rules['1410']
    const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Forte Skill - Enhanced Arc Beyond the Edge')! as [string, RuntimeRecord]
    const path = 'runtime.state.controls.resonator:1410:wan_light:stacks'
    const cast = { type: 'cast', owner: 1410, actionId: Number(actionId), action: action.name, instance: 1, frame: 0,
      hitControls: [{ hit: 0, owner: 1410, path, value: 10 }, { hit: 1, owner: 1410, path, value: 0 }] }
    const trace = [cast, ...action.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
      ({ type: 'hit', owner: 1410, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 1 }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast] },
      { resonators: { 1410: await gameData('resonators/runtime-bundles/1410') }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1410', state: { path, kind: 'stack', defaultValue: 0 } }] })
    const hits = output.items.filter((node: RuntimeRecord) => node.featureId === 'damage:1410026:hit:1')
    expect(hits).toHaveLength(2)
    expect(hits[0].attached.conditions[0].changes[0]).toMatchObject({ path, value: 10, resonatorId: '1410' })
    expect(hits[1].attached).toBeUndefined()
    expect(output.items.filter((node: RuntimeRecord) => node.editorSection !== 'preamble' && node.changes?.some(
      (change: RuntimeRecord) => change.path === path))).toHaveLength(0)
  })
  it.each([0, 18])('places the Skill tail after the handoff and Intro field changes before an Outro delayed by %i frames', async delay => {
    const { rules, combat } = await isolated('1107'), kit = rules['1107']
    const bundle = await gameData('resonators/runtime-bundles/1107')
    const incoming = await isolated('1505'), incomingKit = incoming.rules['1505']
    rules['1505'] = incomingKit
    combat.members.push(incoming.combat.members[0])
    const [outroId, outro] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).cast === kit.codes.cast.outro)! as [string, RuntimeRecord]
    const [skillId, skill] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Skill - Chromatic Splendor')! as [string, RuntimeRecord]
    const [introId, intro] = Object.entries(incomingKit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Intro - Discernment')! as [string, RuntimeRecord]
    const inner = Number(Object.keys(incomingKit.effects).find(id => incomingKit.effects[id].name === 'Inner Stellarealm'))
    const path = 'runtime.state.controls.resonator:1505:inner_stellarealm:active'
    const outroHits = outro.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
      ({ type: 'hit', owner: 1107, actionId: Number(outroId), eventId: event.id, instance: 1, frame: 1 + delay }))
    const trace = [
      { type: 'effect', owner: 1505, effectId: inner, target: 'team', recipient: 'team', stacks: 1, until: 1000, frame: 0 },
      { type: 'cast', owner: 1107, actionId: Number(skillId), action: skill.name, instance: 3, frame: 0 },
      { type: 'cast', owner: 1107, actionId: Number(outroId), action: outro.name, instance: 1, frame: 1 },
      ...(delay === 0 ? outroHits : []),
      { type: 'swap', from: 1107, to: 1505, frame: 1 },
      { type: 'cast', owner: 1505, actionId: Number(introId), action: intro.name, instance: 2, frame: 1 },
      { type: 'effect', owner: 1505, effectId: inner, target: 'team', recipient: 'team', stacks: 0, until: 1, frame: 1 },
      ...intro.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
        ({ type: 'hit', owner: 1505, actionId: Number(introId), eventId: event.id, instance: 2, frame: 1 })),
      ...(delay > 0 ? outroHits : []),
      ...skill.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
        ({ type: 'hit', owner: 1107, actionId: Number(skillId), eventId: event.id, instance: 3, frame: 40 })),
    ]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 },
      { frame: 60, trace, casts: trace.filter(entry => entry.type === 'cast') },
      { resonators: { 1107: bundle, 1505: await gameData('resonators/runtime-bundles/1505') },
        effectControls: { ...kit.effectControls, ...incomingKit.effectControls },
        preambleChoices: [{ resonatorId: '1505', state: { path, kind: 'toggle', defaultValue: false } }] })
    const clearAt = output.items.findIndex((node: RuntimeRecord) => node.editorSection !== 'preamble' &&
      node.changes?.some((change: RuntimeRecord) => change.path === path && change.value === false))
    const outroAt = output.items.findIndex((node: RuntimeRecord) => node.featureId === 'damage:1107:outro')
    const swapAt = output.items.findIndex((node: RuntimeRecord) => node.changes?.some((change: RuntimeRecord) =>
      change.path === 'runtime.rotation.activeResonatorId' && change.value === '1505'))
    const skillAt = output.items.findIndex((node: RuntimeRecord) => node.featureId?.startsWith('damage:1107014'))
    expect(swapAt).toBeGreaterThanOrEqual(0)
    expect(skillAt).toBeGreaterThan(swapAt)
    expect(skillAt).toBeLessThan(clearAt)
    expect(clearAt).toBeGreaterThanOrEqual(0)
    expect(outroAt).toBeGreaterThan(clearAt)
    expect(output.diagnostics.castCoverage.every((cast: RuntimeRecord) => cast.emittedFeatures > 0)).toBe(true)
  })
  it('places a delayed Skill before the next prescribed cast creates its field', async () => {
    const { rules, combat } = await isolated('1505'), kit = rules['1505']
    const bundle = await gameData('resonators/runtime-bundles/1505')
    const action = (name: string) => Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === name)! as [string, RuntimeRecord]
    const [skillId, skill] = action('Skill - Chaos Theory'), [libId, lib] = action('Liberation - End Loop')
    const inner = Number(Object.keys(kit.effects).find(id => kit.effects[id].name === 'Inner Stellarealm'))
    const path = 'runtime.state.controls.resonator:1505:inner_stellarealm:active'
    const trace = [
      { type: 'cast', owner: 1505, actionId: Number(skillId), action: skill.name, instance: 1, frame: 0, timelineEvent: 1 },
      { type: 'effect', owner: 1505, effectId: inner, target: 'team', recipient: 'team', stacks: 1, until: 1000, frame: 1 },
      { type: 'cast', owner: 1505, actionId: Number(libId), action: lib.name, instance: 2, frame: 1, timelineEvent: 2 },
      ...skill.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
        ({ type: 'hit', owner: 1505, actionId: Number(skillId), eventId: event.id, instance: 1, frame: 2 })),
    ]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 },
      { frame: 60, trace, casts: trace.filter(entry => entry.type === 'cast') },
      { resonators: { 1505: bundle }, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1505', state: { path, kind: 'toggle', defaultValue: false } }] })
    const damageAt = output.items.findIndex((node: RuntimeRecord) => node.featureId === 'damage:1505010')
    const fieldAt = output.items.findIndex((node: RuntimeRecord) => node.changes?.some((change: RuntimeRecord) =>
      change.path === path && change.value === true))
    expect(damageAt).toBeGreaterThanOrEqual(0)
    expect(fieldAt).toBeGreaterThan(damageAt)
  })
  it('upgrades a pending short hit when another member cast enables a team listener buff', async () => {
    const { rules, combat } = await isolated('1105'), kit = rules['1105']
    const shorekeeper = await isolated('1505'), realm = shorekeeper.rules['1505']
    rules['1505'] = realm
    combat.members.push(shorekeeper.combat.members[0])
    const actionId = Number(Object.keys(kit.actions).find(id => kit.actions[id].name === 'Skill - Stroke of Genius'))
    const outroId = Number(Object.keys(kit.actions).find(id => kit.actions[id].cast === 5))
    const field = Number(Object.keys(realm.effects).find(id => realm.effects[id].name === 'Supernal Stellarealm'))
    const path = 'runtime.state.controls.resonator:1505:supernal_stellarealm:active'
    const cast = { type: 'cast', owner: 1105, actionId, instance: 1, frame: 0, timelineEvent: 1 }
    const outro = { type: 'cast', owner: 1105, actionId: outroId, instance: 2, frame: 20, timelineEvent: 2 }
    const trace = [cast, { type: 'swap', from: 1105, to: 1505, frame: 20 }, outro,
    { type: 'effect', owner: 1505, effectId: field, recipient: 'team', target: 1505,
      sourceOwner: 1105, sourceActionId: outroId, sourceInstance: 2, stacks: 1, until: 1000, frame: 20 },
    ...kit.actions[actionId].events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
      ({ type: 'hit', owner: 1105, actionId, eventId: event.id, instance: 1, frame: 46 }))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [cast, outro] },
      { resonators: { 1105: await gameData('resonators/runtime-bundles/1105'),
        1505: await gameData('resonators/runtime-bundles/1505') }, effectControls: realm.effectControls,
      preambleChoices: [path, 'runtime.state.controls.resonator:1505:inner_stellarealm:active']
        .map(path => ({ resonatorId: '1505', state: { path, kind: 'toggle', defaultValue: false } })) })
    const hit = output.items.find((node: RuntimeRecord) => node.featureId === 'damage:1105022')
    expect(hit, JSON.stringify(output.items)).toBeDefined()
    expect(hit?.attached?.conditions.some((condition: RuntimeRecord) => condition.changes.some((change: RuntimeRecord) =>
      change.path === path && change.value === true))).toBe(true)
    const state = createEffectState(rules, combat)
    const inner = Number(Object.keys(realm.effects).find(id => realm.effects[id].name === 'Inner Stellarealm'))
    const base = Number(Object.keys(realm.effects).find(id => realm.effects[id].name === 'Stellarealm'))
    holdEffect(state, 1505, base, 'team', 1)
    holdEffect(state, 1505, inner, 'team', 1)
    resolveAction(state, 1105, kit.actions[outroId].name, { next: 1505 })
    expect(state.trace.find((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === field))
      .toMatchObject({ owner: 1505, sourceOwner: 1105, sourceActionId: outroId })
  })
  it('retains Inner through Supernal and clears both when the realm ends', async () => {
    const { rules, combat } = await isolated('1505'), kit = rules['1505']
    const bundle = await gameData('resonators/runtime-bundles/1505')
    const effectId = (name: string) => Number(Object.keys(kit.effects).find(id => kit.effects[id].name === name))
    const inner = effectId('Inner Stellarealm'), supernal = effectId('Supernal Stellarealm')
    const paths = ['resonator:1505:inner_stellarealm:active', 'resonator:1505:supernal_stellarealm:active']
    const trace = [[0, inner, 1], [1, supernal, 1], [1, inner, 0], [2, supernal, 0]].map(([frame, effectId, stacks]) =>
      ({ type: 'effect', owner: 1505, target: 'team', recipient: 'team', effectId, stacks, frame, until: stacks ? 1000 : frame }))
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [] },
      { resonators: { 1505: bundle }, effectControls: kit.effectControls,
        preambleChoices: paths.map(path => ({ resonatorId: '1505',
          state: { path: `runtime.state.controls.${path}`, kind: 'toggle', defaultValue: false } })) })
    const changes = output.items.flatMap((node: RuntimeRecord) => node.changes ?? [])
    for (const path of paths) expect(changes.filter((change: RuntimeRecord) => change.path === `runtime.state.controls.${path}`)
      .map((change: RuntimeRecord) => change.value)).toEqual([false, true, false])
  })
  it('emits every Shorekeeper butterfly without repeating the whole Illation pull', async () => {
    const { rules, combat } = await isolated('1505'), kit = rules['1505']
    const bundle = await gameData('resonators/runtime-bundles/1505')
    const trace: RuntimeRecord[] = []
    for (const [index, name] of ['Skill - Chaos Theory', 'Forte Heavy - Illation'].entries()) {
      const [actionId, action] = Object.entries(kit.actions).find(([, action]) =>
        (action as RuntimeRecord).name === name)! as [string, RuntimeRecord]
      trace.push({ type: 'cast', owner: 1505, actionId: Number(actionId), action: name, instance: index + 1, frame: index })
      for (const event of action.events.filter((event: RuntimeRecord) => event.damage)) trace.push({ type: 'hit',
        owner: 1505, actionId: Number(actionId), eventId: event.id, instance: index + 1, frame: index })
    }
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 },
      { frame: 60, trace, casts: trace.filter(entry => entry.type === 'cast') },
      { resonators: { 1505: bundle }, preambleChoices: [{ resonatorId: '1505',
        state: { path: 'runtime.state.controls.resonator:1505:inner_stellarealm:active', kind: 'toggle', defaultValue: false } }] })
    const count = (featureId: string) => output.items.filter((node: RuntimeRecord) => node.featureId === featureId)
      .reduce((sum: number, node: RuntimeRecord) => sum + (node.multiplier ?? 1), 0)
    expect(count('damage:1505010')).toBe(5)
    expect(count('damage:1505026')).toBe(5)
    expect(count('damage:1505027:hit:1')).toBe(5)
    expect(count('damage:1505027')).toBe(0)
    expect(output.items.filter((node: RuntimeRecord) => node.type === 'feature')
      .every((node: RuntimeRecord) => Number.isInteger(node.multiplier ?? 1))).toBe(true)
  })
  it('activates Phasic Homogenizer when another teammate lands a Tune Break', async () => {
    const env = await environment(), lynae = await isolated('1509'), mornye = await isolated('1209')
    const rules = { ...lynae.rules, ...mornye.rules }
    const member: RuntimeRecord = lynae.combat.members[0]
    member.weapon = env.gear.module('weapon', 21030045, 1)
    const combat = { ...lynae.combat, members: [member, mornye.combat.members[0]], initialOnFieldResonatorId: 1209 }
    const state = createEffectState(rules, combat)
    const breaking = (Object.values(rules['1209'].actions) as RuntimeRecord[]).find(action => action.input === 'tuneBreak')!
    resolveAction(state, 1209, breaking.name)
    advanceEffectState(state, state.readyAt)
    const effects = new Set(Object.keys(member.weapon.effects).map(Number))
    expect(state.trace.some((entry: RuntimeRecord) => entry.type === 'effect' && entry.owner === 1509 &&
      effects.has(entry.effectId) && entry.stacks > 0)).toBe(true)
  })
  it('grants Suisui\'s Havoc conversion only to the recorded Bane consumer', async () => {
    const env = await environment(), ids = ['1110', '1508', '1610']
    const rules = await env.characters.load(ids, 'beta')
    rules['1508'] = withTuneBreak(rules['1508'], 1)
    const members = await Promise.all(ids.map(async id => (await isolated(id)).combat.members[0]))
    const resonators = Object.fromEntries(await Promise.all(ids.map(async id => [id, await gameData(`resonators/runtime-bundles/${id}`)])))
    const kit = rules['1110'], path = 'runtime.state.controls.team:1110:ceaseless_havoc_bane:active'
    const marker = kit.recipientConditions.find((condition: RuntimeRecord) => condition.path === path).effect
    const trace: RuntimeRecord[] = [
      { type: 'effect', owner: 1110, effectId: marker, target: 1610, recipient: 'self', stacks: 1, until: 1000, frame: 0 },
    ]
    for (const [index, id] of ['1508', '1610'].entries()) {
      const [actionId, action] = Object.entries(rules[id].actions).find(([key, action]) =>
        typeof rules[id].nodeFeatures[key] === 'string' && (action as RuntimeRecord).events.some((event: RuntimeRecord) => event.damage))! as [string, RuntimeRecord]
      trace.push({ type: 'cast', owner: Number(id), actionId: Number(actionId), action: action.name, instance: index + 1, frame: index + 1 })
      for (const event of action.events.filter((event: RuntimeRecord) => event.damage)) trace.push({ type: 'hit', owner: Number(id),
        actionId: Number(actionId), eventId: event.id, instance: index + 1, frame: index + 1 })
      const [breakId, breaking] = Object.entries(rules[id].actions).find(([, action]) =>
        (action as RuntimeRecord).input === 'tuneBreak')! as [string, RuntimeRecord]
      trace.push({ type: 'cast', owner: Number(id), actionId: Number(breakId), action: breaking.name, instance: index + 10, frame: index + 3 })
      for (const event of breaking.events.filter((event: RuntimeRecord) => event.damage)) trace.push({ type: 'hit', owner: Number(id),
        actionId: Number(breakId), eventId: event.id, instance: index + 10, frame: index + 3 })
    }
    trace.sort((left, right) => left.frame - right.frame)
    const output = emitEditorProgram(rules, { members, initialOnFieldResonatorId: 1508, maxFrames: 60 },
      { frame: 60, trace, casts: trace.filter(entry => entry.type === 'cast') },
      { resonators, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1110', state: { path, kind: 'toggle', defaultValue: false } }] })
    const denied = output.items.filter((node: RuntimeRecord) => node.type === 'feature' && node.resonatorId === '1508')
    const allowed = output.items.filter((node: RuntimeRecord) => node.type === 'feature' && node.resonatorId === '1610')
    expect(denied.length).toBeGreaterThan(0)
    expect(allowed.length).toBeGreaterThan(0)
    expect(denied.some((node: RuntimeRecord) => node.featureId === 'damage:1508:tune-break')).toBe(true)
    for (const node of denied) {
      // the generic break is Physical, so the Havoc-only control cannot affect it and needs no recipient attachment
      if (node.featureId === 'damage:1508:tune-break') expect(node.attached?.conditions ?? []).toHaveLength(0)
      else expect(node.attached.conditions[0].changes[0]).toMatchObject({ path, value: false })
    }
    for (const node of allowed) expect(node.attached?.conditions ?? []).toHaveLength(0)
  })
  it('preserves team buffs enabled by a source-held stance without a recipient marker', async () => {
    const env = await environment(), ids = ['1211', '1206']
    const rules = await env.characters.load(ids, 'beta')
    const members = await Promise.all(ids.map(async id => (await isolated(id)).combat.members[0]))
    const resonators = Object.fromEntries(await Promise.all(ids.map(async id => [id, await gameData(`resonators/runtime-bundles/${id}`)])))
    const path = 'runtime.state.controls.resonator:1211:entropy_shift:active'
    const [effectId] = Object.entries(rules['1211'].effects).find(([, effect]) =>
      (effect as RuntimeRecord).name === 'Entropy Shift: Breakdown Form')!
    const [actionId, action] = Object.entries(rules['1206'].actions).find(([key, action]) =>
      typeof rules['1206'].nodeFeatures[key] === 'string' && (action as RuntimeRecord).events.some((event: RuntimeRecord) => event.damage))! as [string, RuntimeRecord]
    const trace = [
      { type: 'effect', owner: 1211, effectId: Number(effectId), target: 1211, recipient: 'self', stacks: 1, until: 1000, frame: 0 },
      { type: 'cast', owner: 1206, actionId: Number(actionId), action: action.name, instance: 1, frame: 1 },
      ...action.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
        ({ type: 'hit', owner: 1206, actionId: Number(actionId), eventId: event.id, instance: 1, frame: 1 })),
    ]
    const output = emitEditorProgram(rules, { members, initialOnFieldResonatorId: 1206, maxFrames: 60 },
      { frame: 60, trace, casts: trace.filter(entry => entry.type === 'cast') },
      { resonators, effectControls: rules['1211'].effectControls,
        preambleChoices: [{ resonatorId: '1211', state: { path, kind: 'toggle', defaultValue: false } }] })
    const attacks = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(attacks.length).toBeGreaterThan(0)
    for (const node of attacks) expect(node.attached?.conditions ?? []).toHaveLength(0)
    expect(output.items.some((node: RuntimeRecord) => node.changes?.some((change: RuntimeRecord) =>
      change.path === path && change.value === true))).toBe(true)
  })
  it('uses Shared Light to scope Hsin\'s existing Outro control per recipient', async () => {
    const env = await environment(), ids = ['1311', '1312', '1110']
    const rules = await env.characters.load(ids, 'beta')
    const members = await Promise.all(ids.map(async id => (await isolated(id)).combat.members[0]))
    const resonators = Object.fromEntries(await Promise.all(ids.map(async id => [id, await gameData(`resonators/runtime-bundles/${id}`)])))
    const path = 'runtime.state.controls.team:1311:herself_a_thousand_lanterns:active'
    const modePath = 'runtime.state.controls.resonator:1311:mode:value'
    const kit = rules['1311']
    const outro = Object.keys(kit.effects).find(id => kit.effects[id].name === 'Hsin: Outro (unison)')!
    const marker = kit.recipientConditions[0].effect
    const trace: RuntimeRecord[] = [
      { type: 'effect', owner: 1311, effectId: Number(outro), target: 'team', recipient: 'team', stacks: 1, until: 1000, frame: 0 },
      { type: 'effect', owner: 1311, effectId: marker, target: 1312, recipient: 'self', stacks: 1, until: 1000, frame: 0 },
    ]
    for (const [index, id] of ['1110', '1312'].entries()) {
      const [actionId, action] = Object.entries(rules[id].actions).find(([key, action]) =>
        typeof rules[id].nodeFeatures[key] === 'string' && (action as RuntimeRecord).events.some((event: RuntimeRecord) => event.damage))! as [string, RuntimeRecord]
      trace.push({ type: 'cast', owner: Number(id), actionId: Number(actionId), action: action.name, instance: index + 1, frame: index + 1 })
      for (const event of action.events.filter((event: RuntimeRecord) => event.damage)) trace.push({ type: 'hit', owner: Number(id),
        actionId: Number(actionId), eventId: event.id, instance: index + 1, frame: index + 1 })
    }
    trace.push({ type: 'hit', owner: 1110, hitKind: 'glacioChafe', negativeEffectStacks: 1, frame: 3 })
    const output = emitEditorProgram(rules, { members, initialOnFieldResonatorId: 1110, maxFrames: 60 },
      { frame: 60, trace, casts: trace.filter(entry => entry.type === 'cast') },
      { resonators, effectControls: kit.effectControls, preambleChoices: [
        { resonatorId: '1311', state: { path, kind: 'toggle', defaultValue: false } },
        { resonatorId: '1311', state: { path: modePath, kind: 'select', defaultValue: 'unison' } },
      ] })
    const denied = output.items.filter((node: RuntimeRecord) => node.type === 'feature' && node.resonatorId === '1110' &&
      node.featureId !== 'damage:1110:negative-effect:glacio-chafe')
    const allowed = output.items.filter((node: RuntimeRecord) => node.type === 'feature' && node.resonatorId === '1312')
    expect(denied.length).toBeGreaterThan(0)
    expect(allowed.length).toBeGreaterThan(0)
    for (const node of denied) expect(node.attached.conditions[0].changes[0]).toMatchObject({ path, value: false })
    for (const node of allowed) expect(node.attached?.conditions ?? []).toHaveLength(0)
    expect(output.items.find((node: RuntimeRecord) => node.featureId === 'damage:1110:negative-effect:glacio-chafe')
      .attached?.conditions ?? []).toHaveLength(0)
  })
  it('classifies Deadlock as a Skill cast that deals Heavy Attack damage', async () => {
    const env = await environment(), rules = (await env.characters.load(['1511'], 'beta'))['1511']
    const action = (Object.values(rules.actions) as RuntimeRecord[]).find(action => action.name === 'Skill - Deadlock')!
    const bundle = await gameData('resonators/runtime-bundles/1511')
    expect(action.cast).toBe(rules.codes.cast.skill)
    expect(bundle.source.skills.find((skill: RuntimeRecord) => skill.id === '1511026')?.skillType).toEqual(['heavyAtk'])
  })
  it('separates named Tune responses from the generic break feature', async () => {
    const env = await environment(), index = await interpretationData('characters/index')
    for (const id of Object.keys(index.rulesets)) {
      const rules = (await env.characters.load([id], 'beta'))[id]
      const bundle = await gameData(`resonators/runtime-bundles/${id}`)
      for (const [key, action] of Object.entries(rules.actions) as [string, RuntimeRecord][]) {
        if (!/^Tune (?:Rupture|Hack|Strain) Response/.test(action.name)) continue
        const bindings = [rules.nodeFeatures[key]].flat()
        for (const binding of bindings) {
          const feature = bundle.source.features.find((feature: RuntimeRecord) =>
            typeof binding === 'string' ? feature.skillId === binding : feature.id === binding.feature)
          expect(feature, `${id} ${action.name}`).toBeDefined()
          expect(bundle.source.skills.find((skill: RuntimeRecord) => skill.id === feature.skillId)?.tab,
            `${id} ${action.name}`).not.toBe('tuneBreak')
        }
      }
    }
  })

  it('maps only Brant\'s enhanced conversion to My Moment', async () => {
    const env = await environment(), rules = (await env.characters.load(['1206'], 'beta'))['1206']
    const bound = Object.entries(rules.effects).filter(([id]) => rules.effectControls[id]?.some(
      ([path]: [string]) => path.endsWith('resonator:1206:my_moment:active')))
    expect(bound.map(([, effect]) => (effect as RuntimeRecord).name)).toEqual(['Brant: "My" Moment'])
  })
  it('counts Heliacal Ember for both Eternal Radiance triggers', async () => {
    const { rules, combat } = await isolated('1507')
    const env = await environment()
    const sonata = env.gear.module('sonata', 11, 5)
    const equipped: RuntimeRecord = combat.members[0]
    equipped.sonata = { ...sonata, onFieldEntryEffects: [] }
    const state = createEffectState(rules, combat)
    holdStatus(state, 1507, 'heliacalEmber', 10, false)
    resolveAction(state, 1507, 'Skill - Standard Defense Protocol')
    advanceEffectState(state, state.readyAt)
    for (const id of Object.keys(sonata.effects)) expect(state.trace.some((entry: RuntimeRecord) =>
      entry.type === 'effect' && String(entry.effectId) === id && entry.stacks > 0)).toBe(true)
  })
  it('scopes a consumed stance and an exact consumed count to the features that read them', async () => {
    const { rules, combat } = await isolated('1507')
    const kit = rules['1507'], bundle = await gameData('resonators/runtime-bundles/1507')
    const trace: RuntimeRecord[] = []
    for (const [index, name] of ['Liberation - The Last Stand', 'Forte Basic - Heavy Slash: Nightfall'].entries()) {
      const [actionId, action] = Object.entries(kit.actions).find(([, a]) => (a as RuntimeRecord).name === name)! as [string, RuntimeRecord]
      trace.push({ type: 'cast', owner: 1507, actionId: Number(actionId), action: name, instance: index + 1, frame: index,
        spentEffects: Object.entries(kit.effects).filter(([, e]) => ['Zani: Inferno Mode', 'Zani: Blaze'].includes((e as RuntimeRecord).name))
          .map(([effectId, e]) => ({ owner: 1507, effectId: Number(effectId),
            stacks: (e as RuntimeRecord).name === 'Zani: Blaze' ? 65 : 1,
            consumed: (e as RuntimeRecord).name === 'Zani: Blaze' ? 40 : 1 })) })
      for (const event of action.events.filter((e: RuntimeRecord) => e.damage)) trace.push({ type: 'hit',
        owner: 1507, actionId: Number(actionId), eventId: event.id, instance: index + 1, frame: index })
    }
    const paths = ['resonator:1507:inferno:active', 'resonator:1507:nightfall_blaze:value']
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: trace.filter(e => e.type === 'cast') },
      { resonators: { 1507: bundle }, effectControls: kit.effectControls,
        preambleChoices: paths.map(key => ({ resonatorId: '1507', state: { path: `runtime.state.controls.${key}`,
          kind: key.endsWith(':active') ? 'toggle' : 'number', defaultValue: key.endsWith(':active') ? false : 0 } })) })
    const finisher = output.items.find((node: RuntimeRecord) => node.featureId?.startsWith('damage:1507029'))
    const nightfall = output.items.find((node: RuntimeRecord) => node.featureId === 'damage:1507023')
    expect(finisher.attached.conditions[0].changes[0]).toMatchObject({ value: true, path: `runtime.state.controls.${paths[0]}` })
    expect(nightfall.attached.conditions[0].changes[0]).toMatchObject({ value: 40, path: `runtime.state.controls.${paths[1]}` })
  })
  it('stores no damage formulas, legality constraints or resource ledgers in the implemented character data', async () => {
    const forbidden = new Set(['resources', 'requirements', 'curve', 'scaling', 'progression', 'staminaCost', 'chainTransition',
      'availableOn', 'permanentModifiers', 'conversion', 'motionStop', 'skillLevel', 'commitAt', 'cancelAt', 'swapCancelAt',
      '__choices', '__translationDefinition', '__transitionSource'])
    const inspect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) { expect(forbidden.has(key), key).toBe(false); inspect(child) }
    }
    const index = await interpretationData('characters/index')
    for (const id of Object.keys(index.rulesets)) inspect(await interpretationData(`characters/${id}`))
    inspect(await interpretationData('gear/triggers'))
  })

  it('binds every damaging action in the five directly reviewed translations to an existing calculator feature', async () => {
    const env = await environment()
    for (const id of ['1502', '1506', '1509', '1505', '1209']) {
      const rules = (await env.characters.load([id], 'beta'))[id]
      const bundle = await gameData(`resonators/runtime-bundles/${id}`)
      for (const [key, action] of Object.entries(rules.actions) as [string, RuntimeRecord][]) {
        if (!action.events.some((event: RuntimeRecord) => event.damage)) continue
        const bindings = Array.isArray(rules.nodeFeatures[key]) ? rules.nodeFeatures[key] : [rules.nodeFeatures[key]]
        for (const binding of bindings) expect(bundle.source.features.some((feature: RuntimeRecord) =>
          typeof binding === 'string' ? feature.skillId === binding && feature.variant !== 'subHit' : feature.id === binding.feature), action.name).toBe(true)
      }
    }
  })

  it('accepts supplied actions regardless of gauges, skill cooldowns, combo prerequisites or sequence completeness', async () => {
    const env = await environment()
    for (const [id, names] of [
      ['1505', ['Liberation - End Loop', 'Liberation - End Loop']],
      ['1209', ['Forte Heavy - Geopotential Shift', 'Liberation - Critical Protocol']],
    ] as [string, string[]][]) {
      const { scenario, plan } = await simplePlan(id, names)
      const result = await interpretTeamActions(env, plan, scenario)
      expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    }
  })

  it('reports only a consumed transition gap and identifies its plan step', async () => {
    const env = await createInterpreterEnvironment({ mode: 'beta', gameData,
      interpretationData: async path => {
        const data = await interpretationData(path)
        if (path === 'characters/1505') data.translationGaps = [{ code: 'test-unconverted-transition',
          actions: [3975075642951326], message: 'Missing End Loop transition' }]
        return data
      } })
    const basic = await simplePlan('1505', ['Basic - Origin Calculus 1'])
    expect((await interpretTeamActions(env, basic.plan, basic.scenario)).status).toBe('interpreted')
    const liberation = await simplePlan('1505', ['Liberation - End Loop'])
    const blocked = await interpretTeamActions(env, liberation.plan, liberation.scenario)
    expect(blocked.status).toBe('unsupported')
    expect(blocked.diagnostics.gaps[0]).toMatchObject({ code: 'test-unconverted-transition',
      resonatorId: '1505', stepId: 'step0:0', action: 'Liberation - End Loop' })
  })

  it('translates a basic-only plan without the unrelated Suisui or Lily kit callbacks', async () => {
    const env = await environment()
    for (const [id, name] of [['1110', 'Basic - Zephyr Stance 1'], ['1512', 'Basic - Mend and Cleanse 1']]) {
      const { scenario, plan } = await simplePlan(id, [name])
      scenario.team.members[0].progression.sequence = 0
      const result = await interpretTeamActions(env, plan, scenario)
      expect(result.status, JSON.stringify(result.diagnostics)).toBe('interpreted')
    }
  })

  it('raises the field and emits its upgrade before the damage it modifies, without a Forte budget', async () => {
    const { rules, combat, state, cast } = await isolated('1209')
    cast('Forte Heavy - Geopotential Shift')
    expect(state.members[1209]).not.toHaveProperty('resources')
    expect(state.trace.some((entry: RuntimeRecord) => entry.type === 'cast' && entry.action === 'Forte - Syntony Field')).toBe(true)
    cast('Liberation - Critical Protocol')
    const bindings = rules['1209'].effectControls
    const paths = [...new Set(Object.values(bindings).flatMap(specs => (specs as Array<[string, unknown]>).map(([path]) => path)))]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: state.frame }, {
      frame: state.frame, trace: state.trace, casts: state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast'),
    }, { resonators: { 1209: await gameData('resonators/runtime-bundles/1209') },
      effectControls: bindings, preambleChoices: paths.map(path => ({ resonatorId: '1209',
        state: { path, kind: 'toggle', defaultValue: false } })) })
    const upgrade = output.items.findIndex((node: RuntimeRecord) => node.changes?.some((change: RuntimeRecord) =>
      change.path === 'runtime.state.controls.team:1209:high_syntony_field:active' && change.value === true))
    expect(upgrade).toBeGreaterThanOrEqual(0)
    expect(output.items.findIndex((node: RuntimeRecord) => node.featureId === 'damage:1209021')).toBeGreaterThan(upgrade)
  })

  it('doubles the Ephemeral basics while Heart Sword Intent is short, written once ahead of them', async () => {
    const { rules, combat, state, cast } = await isolated('1413')
    cast('Basic - Ephemeral Transcendence 1')
    cast('Basic - Ephemeral Transcendence 2')
    const path = 'runtime.state.controls.resonator:1413:ephemeral_transcendence:active'
    const output = emitEditorProgram(rules, { ...combat, maxFrames: state.frame }, {
      frame: state.frame, trace: state.trace, casts: state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast'),
    }, { resonators: { 1413: await gameData('resonators/runtime-bundles/1413') },
      effectControls: rules['1413'].effectControls, preambleChoices: [...new Set([path, ...Object.values(rules['1413'].effectControls)
        .flatMap(specs => (specs as Array<[string, unknown]>).map(([control]) => control))])]
        .map(control => ({ resonatorId: '1413', state: { path: control, kind: 'toggle', defaultValue: false } })) })
    // every hit resets the toggle and evaluates it again: only the net value is written
    const writes = output.items.filter((node: RuntimeRecord) => node.editorSection !== 'preamble' &&
      node.changes?.some((change: RuntimeRecord) => change.path === path))
    expect(writes.map((node: RuntimeRecord) => node.changes[0].value)).toEqual([true])
    expect(output.items.findIndex((node: RuntimeRecord) => node.featureId === 'damage:1413401')).toBeGreaterThan(output.items.indexOf(writes[0]))
    const first = output.items.find((node: RuntimeRecord) => node.featureId === 'damage:1413401')
    expect(first.attached?.conditions?.flatMap((condition: RuntimeRecord) => condition.changes) ?? [])
      .not.toContainEqual(expect.objectContaining({ path, value: false }))
  })

  it('turns the Tune Strain payout on with the Interfered the break applies', async () => {
    const { rules, combat } = await isolated('1413')
    const path = 'runtime.state.controls.combatState:1413:draw_and_sunder:active'
    const interfered = Number(Object.entries(rules['1413'].effects as Record<string, RuntimeRecord>)
      .find(([, effect]) => effect.name === 'Tune Strain - Interfered')![0])
    const trace = [{ type: 'effect', frame: 30, owner: 1413, effectId: interfered, target: 'enemy', recipient: 'enemy', stacks: 1, until: Infinity }]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [] },
      { resonators: { 1413: await gameData('resonators/runtime-bundles/1413') }, effectControls: rules['1413'].effectControls,
        preambleChoices: [{ resonatorId: '1413', state: { path, kind: 'toggle', defaultValue: false } }] })
    const writes = output.items.filter((node: RuntimeRecord) => node.changes?.some((change: RuntimeRecord) => change.path === path))
    expect(writes.map((node: RuntimeRecord) => [node.editorSection ?? 'rotation', node.changes[0].value]))
      .toEqual([['preamble', false], ['rotation', true]])
  })

  it('applies Sweet Dream consumed buds for the whole buff lifetime', async () => {
    const { rules, combat } = await isolated('1603')
    const path = 'runtime.state.controls.resonator:1603:sweet_dream:crimson_bud'
    const effectId = Number(Object.keys(rules['1603'].effects).find(id => rules['1603'].effects[id].name === 'Camellya: Sweet Dream'))
    const trace = [{ type: 'effect', frame: 10, owner: 1603, effectId, target: 1603, stacks: 11, until: 100 },
      { type: 'effect', frame: 20, owner: 1603, effectId, target: 1603, stacks: 0, until: 20 }]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [] },
      { resonators: { 1603: await gameData('resonators/runtime-bundles/1603') }, effectControls: rules['1603'].effectControls,
        preambleChoices: [{ resonatorId: '1603', state: { path, kind: 'select', defaultValue: '0' } },
          { resonatorId: '1603', state: { path: 'runtime.state.controls.resonator:1603:sweet_dream:active', kind: 'toggle', defaultValue: false } }] })
    const writes = output.items.flatMap((node: RuntimeRecord) => node.changes ?? [])
      .filter((change: RuntimeRecord) => change.path === path).map((change: RuntimeRecord) => change.value)
    expect(writes).toEqual(['0', '10', '0'])
  })

  it.each(['1413', '1510'])('tracks Interfered control snapshots for %s without a named effect', async id => {
    const { rules, combat } = await isolated(id)
    const path = `runtime.state.controls.${rules[id].strainPayoutControls[0]}`
    const trace = [1, 2, 0].map((value, index) => ({ type: 'control', frame: 10 + index * 10,
      owner: Number(id), path: 'enemy.status.tuneStrain', value }))
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace, casts: [] },
      { resonators: { [id]: await gameData(`resonators/runtime-bundles/${id}`) }, effectControls: rules[id].effectControls,
        preambleChoices: [{ resonatorId: id, state: { path, kind: 'toggle', defaultValue: false } },
          { resonatorId: id, state: { path: 'enemy.status.tuneStrain', kind: 'number', defaultValue: 0 } }] })
    const writes = output.items.flatMap((node: RuntimeRecord) => node.changes ?? [])
      .filter((change: RuntimeRecord) => change.path === path).map((change: RuntimeRecord) => change.value)
    expect(writes).toEqual([false, true, false])
  })

  it('attaches the Shifting surge to the hit that spends it and omits it from the timeline', async () => {
    const { rules, combat, state, cast } = await isolated('1211')
    cast('Basic - Stagecraft Form 1')
    const path = 'runtime.state.controls.team:1211:tune_strain_shifting:active'
    const surge = Number(Object.entries(rules['1211'].effects as Record<string, RuntimeRecord>)
      .find(([, effect]) => effect.name === 'Resonance Mode - Tune Strain')![0])
    const hit = state.trace.find((entry: RuntimeRecord) => entry.type === 'hit' && !entry.hitKind)
    const granted = { type: 'effect', frame: 0, owner: 1211, effectId: surge, target: 'team', recipient: 'team', stacks: 1, until: Infinity }
    const trace = [granted, ...state.trace, { type: 'effect', frame: hit.frame, owner: 1211, effectId: surge, target: 'team', recipient: 'team', stacks: 0, until: hit.frame }]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: state.frame }, {
      frame: state.frame, trace, casts: state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast'),
    }, { resonators: { 1211: await gameData('resonators/runtime-bundles/1211') }, effectControls: rules['1211'].effectControls,
      preambleChoices: [...new Set([path, ...Object.values(rules['1211'].effectControls)
        .flatMap(specs => (specs as Array<[string, unknown]>).map(([control]) => control))])]
        .map(control => ({ resonatorId: '1211', state: { path: control, kind: 'toggle', defaultValue: false } })) })
    const writes = output.items.filter((node: RuntimeRecord) => node.editorSection !== 'preamble' &&
      node.changes?.some((change: RuntimeRecord) => change.path === path))
    expect(writes).toHaveLength(0)
    const carriers = output.items.filter((node: RuntimeRecord) => node.attached?.conditions
      ?.some((condition: RuntimeRecord) => condition.changes.some((change: RuntimeRecord) => change.path === path && change.value === true)))
    // the consumed value applies to every matching hit of the skill
    expect(carriers).toHaveLength(1)
    expect(carriers[0].featureId).toMatch(/^damage:1211\d+$/)
  })

  it('uses the prescribed handoff response independently of Concerto', async () => {
    const { rules, combat, state } = await isolated('1505')
    const second = structuredClone(combat.members[0]); second.resonatorId = 1502
    const env = await environment(); Object.assign(rules, await env.characters.load(['1502'], 'beta'))
    combat.members.push(second)
    const first = createEffectState(rules, combat)
    resolveSwap(first, 1502)
    expect(first.trace.some((entry: RuntimeRecord) => entry.type === 'cast')).toBe(false)
    const explicit = createEffectState(rules, combat)
    resolveSwap(explicit, 1502, { outro: 'Outro - Binary Butterfly', intro: 'Intro - Waveshock' })
    expect(explicit.trace.filter((entry: RuntimeRecord) => entry.type === 'cast').map((entry: RuntimeRecord) => entry.action))
      .toEqual(['Outro - Binary Butterfly', 'Intro: Waveshock'])
    expect(state.members[1505]).not.toHaveProperty('resources')
  })

  it('separates a prescribed Tune Break from its triggered response', async () => {
    const { rules, combat } = await isolated('1509')
    combat.initialEnemy = { tuneRuptureShifting: true }
    const state = createEffectState(rules, combat)
    resolveAction(state, 1509, 'Tune Break Skill')
    advanceEffectState(state, state.readyAt)
    expect(state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast').map((entry: RuntimeRecord) => entry.action))
      .toEqual(['Tune Break Skill', 'Tune Rupture Response - Spectral Analysis'])
    const response = rules['1509'].actions['3459681097534104']
    expect(response.events.find((event: RuntimeRecord) => event.damage).damage.type).toBe(8)
    expect(rules['1509'].nodeFeatures['3459681097534104']).toBe('1509032')
  })

  it('requires missing Echo hit metadata only when the supplied build can react to those hits', async () => {
    const { state } = await isolated('1505')
    const member = state.members[1505]
    member.source.echoes.main.hitEventsUnavailable = true
    member.source.echoes.main.actions[999] = { id: 999, name: 'Equipped Echo', cast: 6, input: 'echo',
      timing: { duration: 0 }, events: [{ id: 999, kind: 0, at: 0 }] }
    const rule = { when: 1, phase: 'afterHit', conditions: [{ path: 'event.damageType', operator: 'eq', value: 0 }],
      operations: [{ op: 'grantEffect', effect: 123 }] }
    member.source.weapon.rules.push(rule)
    expect(() => resolveAction(state, 1505, 999)).not.toThrow()
    rule.conditions[0].value = 6
    expect(() => resolveAction(state, 1505, 999)).toThrow(/reacts to equipped Echo hits/)
  })
})
