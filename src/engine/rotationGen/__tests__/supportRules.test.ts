/*
  Author: Runor Ewhro
  description: checks equipment, teammate effects, and their activation conditions.
*/

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInterpreterEnvironment, interpretTeamActions } from '../index'
import { advanceEffectState, createEffectState, holdStatus, playSupport, resolveAction, resolveSwap } from '../events/execute'
import { emitEditorProgram } from '../editor/emitProgram'
import { withTuneBreak } from '../events/offTune'
import { timelineKits } from '../events/timeline'
import type { ActionPlan } from '@/domain/rotationActions/types'
import type { RuntimeRecord } from '../types'

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
  it('expires realms and gear between short-attack hits without borrowing a later activation', async () => {
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

    // a field created by a later prescribed cast still cannot be moved back
    // into the current short tail merely because those hits resolve later.
    const later = [{ ...trace[0], frame: 20, until: 100 }, cast, ...trace.filter(entry => entry.type === 'hit')]
      .sort((a, b) => a.frame - b.frame)
    const next = emitEditorProgram(rules, { ...combat, maxFrames: 60 }, { frame: 60, trace: later, casts: [cast] }, editor)
    expect(next.items.filter((node: RuntimeRecord) => node.type === 'feature').every((node: RuntimeRecord) => !node.attached)).toBe(true)
  })
  it('keeps Heaven\'s Clarity through its consuming finisher without per-hit restoration nodes', async () => {
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
  it.each([1308, 1110])('applies Rebecca\'s Shifting Tune Break Boost only to recipient %i', async recipient => {
    const env = await environment(), rules = await env.characters.load(['1308', '1110'], 'beta')
    const resonators = Object.fromEntries(await Promise.all(['1308', '1110'].map(async id =>
      [id, await gameData(`resonators/runtime-bundles/${id}`)])))
    const members = [1308, 1110].map(resonatorId => ({ resonatorId, build: { level: 90, sequence: 0 },
      weapon: { id: 0, effects: {}, rules: [] }, echoes: { main: { id: 0, effects: {}, rules: [] } }, sonata: { effects: {}, rules: [] } }))
    const kit = rules['1308'], path = 'runtime.state.controls.inherent:1308:lvl50:hack_shifting'
    const marker = kit.recipientConditions.find((condition: RuntimeRecord) => condition.path === path).effect
    const trace: RuntimeRecord[] = [{ type: 'effect', owner: 1308, effectId: marker,
      target: recipient, recipient: 'self', stacks: 1, until: 1000, frame: 0 }]
    for (const [index, owner] of [1308, 1110].entries()) {
      const [actionId, action] = Object.entries(rules[owner].actions).find(([key, action]) =>
        typeof rules[owner].nodeFeatures[key] === 'string' && (action as RuntimeRecord).events.some((event: RuntimeRecord) => event.damage))! as [string, RuntimeRecord]
      trace.push({ type: 'cast', owner, actionId: Number(actionId), action: action.name, instance: index + 1, frame: index + 1 })
      for (const event of action.events.filter((event: RuntimeRecord) => event.damage)) trace.push({ type: 'hit', owner,
        actionId: Number(actionId), eventId: event.id, instance: index + 1, frame: index + 1 })
    }
    const output = emitEditorProgram(rules, { members, initialOnFieldResonatorId: 1308, maxFrames: 60 },
      { frame: 60, trace, casts: trace.filter(entry => entry.type === 'cast') },
      { resonators, effectControls: kit.effectControls,
        preambleChoices: [{ resonatorId: '1308', state: { path, kind: 'toggle', defaultValue: false } }] })
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
  it('uses a native field stage at each long follow-up hit, even when the features are emitted together', async () => {
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
    const damageEvents = action.events.filter((event: RuntimeRecord) => event.damage)
    const cast = { type: 'cast', owner: 1410, actionId: Number(actionId), action: action.name, instance: 1, frame: 0 }
    const hit = (event: RuntimeRecord, frame: number) => ({ type: 'hit', owner: 1410,
      actionId: Number(actionId), eventId: event.id, instance: 1, frame })
    const trace = [cast, hit(damageEvents[0], 250), { type: 'effect', owner: 1410, effectId: 999,
      target: 1410, recipient: 'self', stacks: 10, until: 500, frame: 260 },
      { type: 'effect', owner: 1410, effectId: 1000, target: 1110, recipient: 'incomingMember', stacks: 1, until: 500, frame: 260 },
      hit(damageEvents[1], 278)]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 300 }, { frame: 300, trace, casts: [cast] },
      { resonators: { 1410: await gameData('resonators/runtime-bundles/1410') },
        effectControls: { ...kit.effectControls, 1000: [[handoffPath, true]] },
        preambleChoices: [{ resonatorId: '1410', state: { path, kind: 'stack', defaultValue: 0 } },
          { resonatorId: '1410', state: { path: handoffPath, kind: 'toggle', defaultValue: false } }] })
    const hits = output.items.filter((node: RuntimeRecord) => node.featureId === 'damage:1410026:hit:1')
    expect(hits).toHaveLength(2)
    expect(hits[0].attached).toBeUndefined()
    expect(hits[1].attached.conditions[0].changes[0]).toMatchObject({ path, value: 10 })
    expect(hits.flatMap((node: RuntimeRecord) => node.attached?.conditions ?? [])
      .flatMap((condition: RuntimeRecord) => condition.changes).some((change: RuntimeRecord) => change.path === handoffPath)).toBe(false)
  })
  it('keeps different Wan Light states on the two Enhanced Arc hits without changing the timeline', async () => {
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
  it('resolves incoming Intro field changes before outgoing Outro damage in the same handoff frame', async () => {
    const { rules, combat } = await isolated('1107'), kit = rules['1107']
    const bundle = await gameData('resonators/runtime-bundles/1107')
    const incoming = await isolated('1505'), incomingKit = incoming.rules['1505']
    rules['1505'] = incomingKit
    combat.members.push(incoming.combat.members[0])
    const [outroId, outro] = Object.entries(kit.actions).find(([, action]) =>
      (action as RuntimeRecord).cast === kit.codes.cast.outro)! as [string, RuntimeRecord]
    const [introId, intro] = Object.entries(incomingKit.actions).find(([, action]) =>
      (action as RuntimeRecord).name === 'Intro - Discernment')! as [string, RuntimeRecord]
    const inner = Number(Object.keys(incomingKit.effects).find(id => incomingKit.effects[id].name === 'Inner Stellarealm'))
    const path = 'runtime.state.controls.resonator:1505:inner_stellarealm:active'
    const trace = [
      { type: 'effect', owner: 1505, effectId: inner, target: 'team', recipient: 'team', stacks: 1, until: 1000, frame: 0 },
      { type: 'cast', owner: 1107, actionId: Number(outroId), action: outro.name, instance: 1, frame: 1 },
      ...outro.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
        ({ type: 'hit', owner: 1107, actionId: Number(outroId), eventId: event.id, instance: 1, frame: 1 })),
      { type: 'swap', from: 1107, to: 1505, frame: 1 },
      { type: 'cast', owner: 1505, actionId: Number(introId), action: intro.name, instance: 2, frame: 1 },
      { type: 'effect', owner: 1505, effectId: inner, target: 'team', recipient: 'team', stacks: 0, until: 1, frame: 1 },
      ...intro.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) =>
        ({ type: 'hit', owner: 1505, actionId: Number(introId), eventId: event.id, instance: 2, frame: 1 })),
    ]
    const output = emitEditorProgram(rules, { ...combat, maxFrames: 60 },
      { frame: 60, trace, casts: trace.filter(entry => entry.type === 'cast') },
      { resonators: { 1107: bundle, 1505: await gameData('resonators/runtime-bundles/1505') },
        effectControls: { ...kit.effectControls, ...incomingKit.effectControls },
        preambleChoices: [{ resonatorId: '1505', state: { path, kind: 'toggle', defaultValue: false } }] })
    const clearAt = output.items.findIndex((node: RuntimeRecord) => node.editorSection !== 'preamble' &&
      node.changes?.some((change: RuntimeRecord) => change.path === path && change.value === false))
    const outroAt = output.items.findIndex((node: RuntimeRecord) => node.featureId === 'damage:1107:outro')
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
  it('keeps Inner active through Supernal and clears both when the realm ends', async () => {
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
      // the current generic break is Physical, so the Havoc-only control
      // cannot affect it and needs no recipient attachment.
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
  it('keeps Deadlock as a Skill cast that deals Heavy Attack damage', async () => {
    const env = await environment(), rules = (await env.characters.load(['1511'], 'beta'))['1511']
    const action = (Object.values(rules.actions) as RuntimeRecord[]).find(action => action.name === 'Skill - Deadlock')!
    const bundle = await gameData('resonators/runtime-bundles/1511')
    expect(action.cast).toBe(rules.codes.cast.skill)
    expect(bundle.source.skills.find((skill: RuntimeRecord) => skill.id === '1511026')?.skillType).toEqual(['heavyAtk'])
  })
  it('keeps named Tune responses separate from the generic break feature', async () => {
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
  it('keeps no damage formulas, legality constraints or resource ledgers in the implemented character data', async () => {
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

  it('can translate a basic-only plan without requiring Suisui or Lily’s unrelated kit callbacks', async () => {
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
    // every hit resets the toggle and decides it again: only the net value is written
    const writes = output.items.filter((node: RuntimeRecord) => node.editorSection !== 'preamble' &&
      node.changes?.some((change: RuntimeRecord) => change.path === path))
    expect(writes.map((node: RuntimeRecord) => node.changes[0].value)).toEqual([true])
    expect(output.items.findIndex((node: RuntimeRecord) => node.featureId === 'damage:1413401')).toBeGreaterThan(output.items.indexOf(writes[0]))
    const first = output.items.find((node: RuntimeRecord) => node.featureId === 'damage:1413401')
    expect(first.attached?.conditions?.flatMap((condition: RuntimeRecord) => condition.changes) ?? [])
      .not.toContainEqual(expect.objectContaining({ path, value: false }))
  })

  it('turns the Tune Strain payout on with the Interfered the break leaves, not at the opening', async () => {
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

  it('attaches the Shifting surge to the hit that spends it and never writes it on the timeline', async () => {
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
    // the consumed value applies to every matching hit of the skill.
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

  it('keeps a prescribed Tune Break distinct from its triggered response', async () => {
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
