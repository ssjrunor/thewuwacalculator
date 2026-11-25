/*
  Author: Runor Ewhro
  description: checks timeline event order, effect durations, and status updates.
*/

import { describe, expect, it } from 'vitest'
import { playTimeline, timelineKits } from '../events/timeline'
import { withTuneBreak } from '../events/offTune'
import { codes } from '../codes'
import { bindEquipmentConditions } from '../equipmentConditions'
import { emitEditorProgram } from '../editor/emitProgram'
import type { ActionPlan, ActionTimeline, TimelineEvent } from '../../../domain/rotationActions/types'
import type { RuntimeRecord } from '../types'
import gear from '../../../data/rotationGen/gear/triggers.json'
import { createEffectState, holdStatus } from '../events/execute'

// one member whose press lands three hits and, by its own rules, grants two effects and heals
function setup(rules?: RuntimeRecord[], owns = ['Kit: Stance'], extra: RuntimeRecord = {}) {
  const press = { name: 'Basic - Press', cast: codes.cast.basic, input: 'basic', timing: { duration: 20 },
    events: [{ id: 1, kind: codes.event.cast, at: 0 },
      ...[0, 1, 2].map((index) => ({ id: 2 + index, kind: codes.event.hit, index, at: 5 * index, damage: { type: 0 } }))] }
  const kit = withTuneBreak({ resonatorId: 1, mode: 'beta', codes, state: {},
    effects: { 7: { name: 'Kit: Stance', recipient: 'self', maxStacks: 3 }, 8: { name: 'Kit: Other', recipient: 'self', maxStacks: 1 },
      9: { name: '', recipient: 'self', maxStacks: 1 }, ...extra },
    rules: rules ?? [{ id: 1, when: 'afterCast', actions: [10], operations: [
      { op: 'grantEffect', effect: 7, recipient: 'self', stacks: 1 },
      { op: 'grantEffect', effect: 8, recipient: 'self', stacks: 1 },
      { op: 'heal' }] }],
    actions: { 10: press }, nodeFeatures: { 10: 'press' } }, 2)
  const combat: RuntimeRecord = { mode: 'beta', maxFrames: 4000, target: { class: 4 }, initialOnFieldResonatorId: 1,
    members: [{ resonatorId: 1, build: { level: 90, sequence: 0 }, initialControls: {}, offTuneByAction: {}, buildupRateEffects: [],
      weapon: { effects: {}, rules: [] }, echoes: { main: { effects: {}, rules: [] } },
      sonata: { effects: {}, rules: [], onFieldEntryEffects: [] } }] }
  const plan = { timelines: { owns: { 1: owns }, names: [], runs: {} } } as unknown as ActionPlan
  return { kits: timelineKits({ 1: kit }, plan), combat }
}

const play = (timeline: ActionTimeline, writable: string[] = [], rules?: RuntimeRecord[], owns?: string[], extra?: RuntimeRecord) => {
  const { kits, combat } = setup(rules, owns, extra)
  return { kits, ...playTimeline(kits, combat, timeline, new Set(writable), new Set()) }
}
const hits = (fight: RuntimeRecord) => fight.trace.filter((entry: RuntimeRecord) => entry.type === 'hit' && !entry.hitKind)
const stacksOf = (fight: RuntimeRecord, id: number) => fight.effects.find((effect: RuntimeRecord) => effect.id === id)?.stacks ?? 0

describe('reference timeline replay', () => {
  it.each([false, true])('preserves numeric stacks when a toggle shares their control (toggle last: %s)', toggleLast => {
    const { kits, combat } = setup([], [])
    const path = 'runtime.state.controls.shared'
    combat.members[0].sonata.effects = {
      80: { name: 'Heavy window', recipient: 'self' },
      81: { name: 'Echo stacks', recipient: 'team' },
    }
    combat.members[0].sonata.effectControls = { 80: [[path, true]], 81: [[path, 'stacks']] }
    const effects = [
      { type: 'effect', owner: 1, effectId: 80, target: 1, stacks: 1, until: 100, frame: 0 },
      { type: 'effect', owner: 1, effectId: 81, target: 1, stacks: 4, until: 100, frame: 0 },
    ]
    if (toggleLast) effects.reverse()
    const cast = { type: 'cast', owner: 1, actionId: 10, instance: 1, frame: 1,
      hitControls: [{ hit: 0, owner: 1, path, value: 2 }] }
    const output = emitEditorProgram(kits, { ...combat, maxFrames: 21 }, { frame: 21, casts: [cast], trace: [
      ...effects, cast, ...[0, 1, 2].map(index => ({ type: 'hit', owner: 1, actionId: 10,
        eventId: 2 + index, instance: 1, frame: 1 + index * 5 })),
    ] }, { effectControls: combat.members[0].sonata.effectControls,
      resonators: { 1: { source: { skills: [{ id: 'press' }],
      features: [{ id: 'damage:press', skillId: 'press' }] } } },
      preambleChoices: [{ resonatorId: '1', state: { path, kind: 'number', defaultValue: 0 } }] })
    const changes = output.items.flatMap((node: RuntimeRecord) => node.changes ?? [])
      .filter((change: RuntimeRecord) => change.path === path)
    expect(changes.at(-1)?.value).toBe(4)
    expect(output.items.find((node: RuntimeRecord) => node.type === 'feature').attached.conditions
      .flatMap((node: RuntimeRecord) => node.changes)).toContainEqual(expect.objectContaining({ path, value: 2 }))
  })

  it('keeps the departing Outro off field instead of restoring its pre-swap active snapshot', () => {
    const { kits, combat } = setup([], [])
    kits[1].actions[11] = { name: 'Outro - Depart', cast: codes.cast.outro, timing: { duration: 0 },
      events: [{ id: 20, kind: codes.event.cast, at: 0 },
        { id: 21, kind: codes.event.hit, at: 0, index: 0, damage: { type: 5 } }] }
    kits[1].nodeFeatures[11] = 'outro'
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    const cast = { type: 'cast', owner: 1, actionId: 11, instance: 1, frame: 0 }
    const trace = [cast, { type: 'hit', owner: 1, actionId: 11, eventId: 21, instance: 1, frame: 0 },
      { type: 'swap', from: 1, to: 2, frame: 0 }]
    const bundle = { source: { skills: [{ id: 'outro' }], features: [{ id: 'damage:outro', skillId: 'outro' }] } }
    const output = emitEditorProgram(kits, { ...combat, maxFrames: 1 }, { frame: 1, trace, casts: [cast] },
      { resonators: { 1: bundle, 2: bundle }, preambleChoices: [{ resonatorId: '1',
        state: { path: 'runtime.state.controls.test', kind: 'toggle', defaultValue: false } }] })
    const outro = output.items.find((node: RuntimeRecord) => node.featureId === 'damage:outro')
    expect(outro).toBeDefined()
    expect(outro.attached?.conditions?.flatMap((node: RuntimeRecord) => node.changes) ?? []).not.toContainEqual(
      expect.objectContaining({ path: 'runtime.rotation.activeResonatorId', value: '1' }))
    const at = output.items.indexOf(outro)
    expect(output.items.slice(0, at).flatMap((node: RuntimeRecord) => node.changes ?? [])
      .filter((change: RuntimeRecord) => change.path === 'runtime.rotation.activeResonatorId').at(-1)?.value).toBe('2')
  })
  it.each([false, true])('clears an expired incoming buff without retargeting it (equipment: %s)', equipment => {
    const path = 'runtime.state.controls.borrowed'
    const { kits, combat } = setup([], [])
    kits[1].effects[7] = { name: 'Incoming buff', recipient: 'incomingMember', duration: 14, maxStacks: 1, replayLifecycle: true }
    kits[1].effectControls = { 7: [[path, true]] }
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    if (equipment) {
      combat.members[0].sonata.effects = { 7: { ...kits[1].effects[7], replayLifecycle: false } }
      delete kits[1].effects[7]
      delete kits[2].effects[7]
    }
    const cast = { type: 'cast', owner: 2, actionId: 10, instance: 1, frame: 10 }
    const trace = [{ type: 'effect', owner: 1, effectId: 7, target: 2, recipient: 'incomingMember', stacks: 1, until: 14, frame: 0 },
      { type: 'swap', from: 1, to: 2, frame: 0 }, cast,
      ...[10, 15, 20].map((frame, index) => ({ type: 'hit', owner: 2, actionId: 10, instance: 1, eventId: 2 + index, frame }))]
    const later = { ...cast, instance: 2, frame: 30 }
    trace.push(later, ...[30, 35, 40].map((frame, index) => ({ type: 'hit', owner: 2,
      actionId: 10, instance: 2, eventId: 2 + index, frame })))
    const source = { source: { skills: [{ id: 'press', hits: [{ count: 1 }, { count: 1 }, { count: 1 }] }],
      features: [{ id: 'damage:press', skillId: 'press' }, ...[1, 2, 3].map(hit => ({ id: `damage:press:hit:${hit}`, skillId: 'press', variant: 'subHit', hitIndex: hit - 1 }))] } }
    const output = emitEditorProgram(kits, { ...combat, maxFrames: 41 }, { frame: 41, trace, casts: [cast, later] }, {
      resonators: { 1: source, 2: source }, effectControls: kits[1].effectControls,
      activeOtherControls: new Set([`1|${path}`]),
      preambleChoices: [{ resonatorId: '1', state: { path, kind: 'toggle', defaultValue: false } }],
    })
    const features = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(features).toHaveLength(4)
    expect(features[0].attached).toBeUndefined()
    for (const node of features.slice(1, 3)) expect(node.attached.conditions.flatMap((condition: RuntimeRecord) => condition.changes))
      .toContainEqual(expect.objectContaining({ path, value: false, resonatorId: '1' }))
    expect(features[3].attached).toBeUndefined()
    expect(features.flatMap((node: RuntimeRecord) => node.attached?.conditions ?? [])
      .flatMap((node: RuntimeRecord) => node.changes).some((change: RuntimeRecord) => change.value === true)).toBe(false)
  })

  it.each([false, true])('orders delayed hits and a same-frame cast with time stop %s', timeStop => {
    const { kits, combat } = setup([{ id: 1, when: codes.event.cast, actions: [20],
      operations: [{ op: 'grantEffect', effect: 8 }] }], [])
    kits[1].actions[20] = { ...kits[1].actions[10], name: 'Liberation - Cast', cast: codes.cast.liberation,
      timing: { duration: 20, ...(timeStop ? { timeStop: [0, 10] } : {}) },
      events: [{ id: 99, kind: codes.event.cast, at: 0 }] }
    const timeline = { seconds: 1, events: [
      [0, 'cast', 0, 'Basic - Press', 1, null, [0], [5]],
      [5, 'cast', 0, 'Liberation - Cast', 0],
    ] } as ActionTimeline
    const { state } = playTimeline(kits, combat, timeline, new Set(), new Set())
    const at = state.trace.filter((row: RuntimeRecord) => row.frame === 5)
    const cast = at.findIndex((row: RuntimeRecord) => row.type === 'cast' && row.actionId === 20)
    const buff = at.findIndex((row: RuntimeRecord) => row.type === 'effect' && row.effectId === 8)
    const hit = at.findIndex((row: RuntimeRecord) => row.type === 'hit' && row.actionId === 10)
    expect(cast).toBeGreaterThanOrEqual(0); expect(buff).toBeGreaterThan(cast)
    if (timeStop) expect(hit).toBeGreaterThan(buff)
    else expect(hit).toBeLessThan(cast)
  })

  it('keeps cast resource changes distinct from hit gains and remembers availability before clamping', () => {
    const path = 'runtime.state.controls.test:paid'
    const { kits, combat } = setup([
      { id: 1, when: 'afterCast', actions: [10], operations: [
        { op: 'add', path: 'state.outputCounter1', value: -18, floor: 0 }] },
      { id: 2, when: codes.event.hit, phase: 'beforeDamage', actions: [10], operations: [
        { op: 'setControl', path, value: { condition: { all: [
          { path: 'event.castCounterChanges.1', operator: 'lt', value: 0 },
          { path: 'event.counterBeforeCast.1', operator: 'gt', value: 0 },
          { path: 'event.counterChanges.2', operator: 'eq', value: 3 },
        ] } } }] },
    ], [])
    kits[1].state.outputCounter1 = { initial: 5 }
    kits[1].actions[10].counterChanges = { 1: -18 }
    kits[1].actions[10].events[1].counterChanges = { 2: 3 }
    const timeline = { seconds: 1, events: [
      [0, 'cast', 0, 'Basic - Press', 1, null, [0], [1]],
      [10, 'cast', 0, 'Basic - Press', 1, null, [0], [1]],
    ] } as ActionTimeline
    const { state } = playTimeline(kits, combat, timeline, new Set(), new Set())
    expect(state.trace.filter((row: RuntimeRecord) => row.type === 'control' && row.path === path)
      .map((row: RuntimeRecord) => row.value)).toEqual([true, false])
  })

  it('retains unchanged status observations without treating them as inflictions or changing ownership', () => {
    const { kits, combat } = setup([{ id: 11, when: 'statusApplied', operations: [
      { op: 'grantEffect', effect: 7, stacks: 1 },
    ] }], [])
    const state = createEffectState(kits, combat)
    holdStatus(state, 1, 'aeroErosion', 6, true)
    holdStatus(state, 2, 'aeroErosion', 6, true)
    expect(state.trace.filter((row: RuntimeRecord) => row.type === 'status').map((row: RuntimeRecord) => row.stacks)).toEqual([6, 6])
    expect(state.statusOwners.aeroErosion).toBe(1)
    expect(stacksOf(state, 7)).toBe(1)
  })

  it('reasserts recorded stacks after a cap dependency changes even when the recorded count repeats', () => {
    const { kits, combat } = setup([], [])
    const path = 'runtime.state.controls.team:1:raised_cap:active'
    kits[1].effectControls = { 7: [[path, true]] }
    const effect = (frame: number, stacks: number) => ({ type: 'effect', owner: 1, target: 1,
      effectId: 7, frame, stacks, until: stacks ? frame + 100 : frame, recipient: 'self' })
    const trace = [effect(1, 1), { type: 'status', frame: 2, owner: 1, status: 'aeroErosion', stacks: 6 },
      effect(3, 0), effect(4, 1), { type: 'status', frame: 5, owner: 1, status: 'aeroErosion', stacks: 6 },
      { type: 'status', frame: 6, owner: 1, status: 'aeroErosion', stacks: 6 }]
    const editor = { resonators: { 1: { source: { features: [], skills: [] } } },
      effectControls: kits[1].effectControls,
      preambleChoices: [{ resonatorId: '1', state: { path, kind: 'toggle', defaultValue: false } },
        { resonatorId: '1', state: { path: 'enemy.combat.aeroErosion', kind: 'number', defaultValue: 0 } }] }
    const values = (cap: boolean) => emitEditorProgram(kits, { ...combat, maxFrames: 7 },
      { frame: 7, trace, casts: [] }, { ...editor, negativeCapControls: new Set(cap ? [`1|${path}`] : []) })
      .items.flatMap((node: RuntimeRecord) => node.changes ?? []).filter((change: RuntimeRecord) =>
        change.path === 'enemy.combat.aeroErosion').map((change: RuntimeRecord) => change.value)
    expect(values(true)).toEqual([0, 6, 6])
    expect(values(false)).toEqual([0, 6])
  })

  it('triggers and refreshes Woodland reduction from positive Erosion counts, never an empty target', () => {
    const { kits, combat } = setup([], [])
    combat.members[0].weapon = structuredClone(gear.weapons['21030026'].variants[0])
    const weapon = combat.members[0].weapon
    const effect = Number(Object.keys(weapon.effects).find(id => weapon.effectControls[id]
      .some(([path]: [string]) => path.endsWith(':aero_shred'))))
    const { state } = playTimeline(kits, combat, { seconds: 3, events: [
      [0, 'status', 0, 'aeroErosion', 0], [1, 'cast', 0, 'Basic - Press', -1],
      [30, 'status', 0, 'aeroErosion', 3], [31, 'cast', 0, 'Basic - Press', -1],
      [60, 'status', 0, 'aeroErosion', 1], [61, 'cast', 0, 'Basic - Press', -1],
      [90, 'status', 0, 'aeroErosion', 0], [91, 'cast', 0, 'Basic - Press', -1],
    ] }, new Set(), new Set())
    const grants = state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' &&
      entry.effectId === effect && entry.stacks > 0)
    expect(grants.map((entry: RuntimeRecord) => entry.frame)).toEqual([31, 36, 41, 61, 66, 71])
    expect(grants.map((entry: RuntimeRecord) => entry.until - entry.frame)).toEqual(Array(6).fill(1200))
    expect(weapon.effects[effect].recipient).toBe('team')
  })

  it.each(['21050056', '21020066'])('keeps Echo-window cooldowns independent by cast identity (%s)', weaponId => {
    const { kits, combat } = setup([], [])
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    kits[1].actions[30] = { name: 'Considered Echo cast', cast: codes.cast.skill, additionalCasts: [codes.cast.echo],
      timing: { duration: 0 }, events: [{ id: 31, kind: codes.event.cast, at: 0 }] }
    kits[1].actions[40] = { name: 'Intro', cast: codes.cast.intro, timing: { duration: 0 },
      events: [{ id: 41, kind: codes.event.cast, at: 0 }] }
    combat.members[0].echoes.main = { id: 99, actionId: 20, effects: {}, rules: [],
      actions: { 20: { name: 'Echo', cast: codes.cast.echo, timing: { duration: 0 },
        events: [{ id: 21, kind: codes.event.cast, at: 0 }] } } }
    const weapon: RuntimeRecord = structuredClone(gear.weapons[weaponId as '21050056' | '21020066'].variants[0])
    combat.members[0].weapon = weapon
    const { state } = playTimeline(kits, combat, { seconds: 12, events: [
      [0, 'swap', 0], [0, 'cast', 0, 'Intro', -1], [1, 'cast', 0, '#echo', -1], [2, 'cast', 0, '#echo', -1],
      [3, 'cast', 0, 'Considered Echo cast', -1], [4, 'swap', 1], [5, 'swap', 0],
      [6, 'cast', 0, '#echo', -1], [601, 'cast', 0, 'Intro', -1], [602, 'cast', 0, '#echo', -1],
    ] }, new Set(), new Set())
    const stackId = Number(Object.keys(weapon.effects).find(id => weapon.effects[id].name.endsWith('Echo window')))
    expect(state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === stackId && entry.stacks > 0)
      .map((entry: RuntimeRecord) => [entry.frame, entry.stacks])).toEqual([[1, 1], [3, 2], [602, 1]])
    if (weaponId === '21020066') {
      const introId = Number(Object.keys(weapon.effects).find(id => weapon.effects[id].name.endsWith('Intro team')))
      expect(weapon.effectControls[stackId]).toEqual([['runtime.state.controls.weapon:21020066:passive:stacks', 'stacks']])
      expect(weapon.effectControls[introId]).toEqual([['runtime.state.controls.weapon:21020066:passive:active', true]])
      expect(state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === introId && entry.stacks > 0)
        .map((entry: RuntimeRecord) => [entry.frame, entry.recipient])).toEqual([[0, 'team'], [601, 'team']])
    }
  })

  it('lets a hit start its own status cooldown before later hits are gated', () => {
    const { kits, combat } = setup([{
      id: 1, when: codes.event.hit, phase: 'beforeHit', actions: [10],
      conditions: [{ path: 'effects.7.stacks', operator: 'lte', value: 0 }],
      operations: [{ op: 'grantEffect', effect: 7 }, { op: 'grantEffect', effect: 8, recipient: 'enemy' }],
    }], ['Kit: Stance', 'Tune Hack - Shifting'], {
      7: { name: 'Kit: Stance', recipient: 'self', maxStacks: 1, duration: 180, replayLifecycle: true },
      8: { name: 'Tune Hack - Shifting', recipient: 'enemy', maxStacks: 1 },
    })
    combat.members[0].weapon = { effects: { 11: { recipient: 'team', duration: 1800, maxStacks: 1 } },
      rules: [{ id: 2, when: 'statusApplied', conditions: [{ path: 'event.status', operator: 'eq', value: 'tuneHackShifting' }],
        operations: [{ op: 'grantEffect', effect: 11, recipient: 'team' }] }] }
    const { state } = playTimeline(kits, combat, { seconds: 4, events: [
      [0, 'state', 0, 'Kit: Stance', 1, 0], [0, 'cast', 0, 'Basic - Press', -1],
      [180, 'state', 0, 'Kit: Stance', 1, 0], [180, 'cast', 0, 'Basic - Press', -1],
    ] }, new Set(), new Set())
    expect(state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 11 && entry.stacks > 0)
      .map((entry: RuntimeRecord) => entry.frame)).toEqual([0, 180])
  })

  it.each([99, 100])('uses captured Echo timing only for its equipped identity (%s)', equippedId => {
    const { kits, combat } = setup([], [])
    combat.members[0].echoes.main = { id: equippedId, actionId: 20, effects: {}, rules: [],
      actions: { 20: { id: 20, name: 'Echo', cast: codes.cast.echo, input: 'echo', timing: { duration: 8 },
        events: [{ id: 21, kind: codes.event.cast, at: 0 },
          { id: 22, kind: codes.event.hit, at: 68, index: 0, damage: { type: codes.damage.echo } }] } } }
    const { state } = playTimeline(kits, combat, { seconds: 2,
      events: [[0, 'cast', 0, '#echo', 1, null, [0], [6], 99]] }, new Set(), new Set())
    expect(state.trace.filter((entry: RuntimeRecord) => entry.type === 'hit').map((entry: RuntimeRecord) => entry.frame))
      .toEqual([equippedId === 99 ? 6 : 68])
  })

  it.each([99, 100])('keeps zero landed Echo hits from triggering on-hit gear for the recorded identity (%s)', equippedId => {
    const { kits, combat } = setup([], [])
    combat.members[0].echoes.main = { id: equippedId, actionId: 20, effects: {},
      rules: [{ id: 'echo-hit-window', when: codes.event.hit, phase: 'afterHit',
        operations: [{ op: 'grantEffect', effect: 7, recipient: 'self' }] },
      { id: 'echo-cast-window', when: codes.event.cast,
        operations: [{ op: 'grantEffect', effect: 8, recipient: 'self' }] }],
      actions: { 20: { id: 20, name: 'Echo', cast: codes.cast.echo, input: 'echo', timing: { duration: 8 },
        events: [{ id: 21, kind: codes.event.cast, at: 0 },
          { id: 22, kind: codes.event.hit, at: 68, index: 0, damage: { type: codes.damage.echo } }] } } }
    const { state } = playTimeline(kits, combat, { seconds: 2,
      events: [[0, 'cast', 0, '#echo', 0, null, [], [], 99]] }, new Set(), new Set())
    expect(state.trace.filter((entry: RuntimeRecord) => entry.type === 'hit')).toHaveLength(equippedId === 99 ? 0 : 1)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === 7 && effect.stacks > 0)).toBe(equippedId !== 99)
    expect(state.trace.some((entry: RuntimeRecord) => entry.type === 'cast')).toBe(true)
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === 8 && effect.stacks > 0)).toBe(true)
  })

  it('omits captured Echo casts when the main slot is empty', () => {
    const { kits, combat } = setup([], [])
    combat.members[0].echoes.main = { id: null, effects: {}, rules: [], actions: {} }
    const { state } = playTimeline(kits, combat, { seconds: 2, events: [
      [0, 'cast', 0, '#echo', -1], [30, 'cast', 0, 'Basic - Press', -1],
    ] }, new Set(), new Set())
    expect(state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast').map((entry: RuntimeRecord) => entry.actionId)).toEqual([10])
  })

  it('projects a held off-field payout and actual active member onto outgoing hit tails', () => {
    const path = 'runtime.state.controls.weapon:1:off_field'
    const { kits, combat } = setup([], [])
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    combat.members[0].weapon = { effects: { 11: { recipient: 'self', ownerOnField: false, maxStacks: 1 } },
      rules: [], effectControls: { 11: [[path, true]] } }
    const trace = [
      { type: 'effect', owner: 1, effectId: 11, target: 1, recipient: 'self', stacks: 1, until: Infinity, frame: 0 },
      { type: 'cast', owner: 1, actionId: 10, instance: 1, frame: 1 },
      { type: 'hit', owner: 1, actionId: 10, instance: 1, eventId: 2, frame: 1 },
      { type: 'swap', from: 1, to: 2, frame: 4 },
      { type: 'hit', owner: 1, actionId: 10, instance: 1, eventId: 3, frame: 6 },
      { type: 'hit', owner: 1, actionId: 10, instance: 1, eventId: 4, frame: 11 },
    ]
    const source = { source: { skills: [{ id: 'press', hitTable: [{ count: 1 }, { count: 1 }, { count: 1 }] }],
      features: [{ id: 'damage:press', skillId: 'press' }, ...[0, 1, 2].map(hitIndex =>
        ({ id: `damage:press:hit:${hitIndex + 1}`, skillId: 'press', variant: 'subHit', hitIndex }))] } }
    const result = emitEditorProgram(kits, { ...combat, maxFrames: 20 }, { frame: 20, trace, casts: trace.filter(row => row.type === 'cast') }, {
      resonators: { 1: source, 2: source }, memberEffectControls: { 1: combat.members[0].weapon.effectControls },
      preambleChoices: [{ resonatorId: '1', state: { path, kind: 'toggle', defaultValue: false } }],
    })
    const features = result.items.filter((node: RuntimeRecord) => node.type === 'feature')
    const value = (node: RuntimeRecord, path: string, fallback: unknown) => node.attached?.conditions
      .flatMap((condition: RuntimeRecord) => condition.changes).find((change: RuntimeRecord) => change.path === path)?.value ?? fallback
    expect(features).toHaveLength(3)
    expect(features.map((node: RuntimeRecord) => value(node, path, false))).toEqual([false, true, true])
    expect(features.map((node: RuntimeRecord) => value(node, 'runtime.rotation.activeResonatorId', '1'))).toEqual(['1', '2', '2'])
  })

  it('retains a delayed hit status snapshot without rewriting the shared timeline', () => {
    const path = 'enemy.combat.havocBane'
    const { kits, combat } = setup([], [])
    const { state } = playTimeline(kits, combat, { seconds: 1, events: [
      [0, 'status', 0, 'havocBane', 3],
      ...[0, 1, 2].map(hit => [0, 'hitControl', 0, 'Basic - Press', hit, 0, path, '3'] as TimelineEvent),
      [0, 'cast', 0, 'Basic - Press', 3, null, [0, 1, 2], [5, 10, 15]],
      [1, 'status', 0, 'havocBane', 1],
    ] }, new Set([path]), new Set())
    const output = emitEditorProgram(kits, { ...combat, maxFrames: state.frame }, { frame: state.frame, trace: state.trace,
      casts: state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast') }, {
      resonators: { 1: { source: { skills: [{ id: 'press', hitTable: [{ count: 1 }, { count: 1 }, { count: 1 }] }],
        features: [{ id: 'damage:press', skillId: 'press' }, ...[0, 1, 2].map(hitIndex =>
          ({ id: `damage:press:hit:${hitIndex + 1}`, skillId: 'press', variant: 'subHit', hitIndex }))] } } },
      preambleChoices: [{ resonatorId: '1', state: { path, kind: 'stack', defaultValue: 0 } }],
    })
    let held = 0
    const atHits = []
    for (const node of output.items) {
      for (const change of node.changes ?? []) if (change.path === path) held = change.value
      if (node.type !== 'feature') continue
      const override = node.attached?.conditions.flatMap((condition: RuntimeRecord) => condition.changes)
        .find((change: RuntimeRecord) => change.path === path)
      atHits.push(override?.value ?? held)
    }
    expect(atHits).toEqual([3])
    expect(held).toBe(1)
    expect(state.enemy.havocBane).toBe(1)
  })

  it.each([false, true])('grants and refreshes Anthem only after coordinated damage (coordinated: %s)', coordinated => {
    const { kits, combat } = setup([], [])
    combat.members[0].sonata = structuredClone(gear.sonatas['13'].variants[1])
    for (const event of kits[1].actions[10].events) if (event.damage) event.coordinated = coordinated
    const { state } = playTimeline(kits, combat, { seconds: 6, events: [[0, 'cast', 0, 'Basic - Press', -1], [251, 'section', 1]] }, new Set(), new Set())
    const id = Number(Object.keys(gear.sonatas['13'].variants[1].effects)[0])
    const grants = state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === id && entry.stacks > 0)
    expect(grants.map((entry: RuntimeRecord) => [entry.frame, entry.until, entry.stacks]))
      .toEqual(coordinated ? [[0, 240, 1], [5, 245, 1], [10, 250, 1]] : [])
    if (coordinated) {
      expect(state.trace.findIndex((entry: RuntimeRecord) => entry.type === 'hit'))
        .toBeLessThan(state.trace.findIndex((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === id))
      expect(state.frame).toBeGreaterThanOrEqual(250)
      expect(state.effects.some((effect: RuntimeRecord) => effect.id === id && effect.stacks > 0 && effect.until > state.frame)).toBe(false)
    }
  })

  it('grants Kumokiri only to actual status inflictors, including an off-field owner', () => {
    const { kits, combat } = setup([], [])
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2,
      rules: [{ id: 20, when: 'afterCast', actions: [10], operations: [
        { op: 'signalStatus', status: 'tuneRuptureShifting', negative: false },
      ] }] }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    const weapon = structuredClone(gear.weapons['21010056'].variants[0])
    Object.assign(combat.members[0].weapon, weapon)
    const controls: Record<string, unknown[][]> = weapon.effectControls
    const stacks = Number(Object.keys(weapon.effects).find(id => controls[id].some(([path]) => String(path).endsWith(':stacks'))))
    const bonus = Number(Object.keys(weapon.effects).find(id => controls[id].some(([path]) => String(path).endsWith(':active'))))
    const { state } = playTimeline(kits, combat, { seconds: 1, events: [
      [0, 'swap', 1], [1, 'status', 0, 'havocBane', 1], [2, 'status', 0, 'havocBane', 2],
      [3, 'status', 0, 'havocBane', 3], [5, 'cast', 1, 'Basic - Press', -1],
      [30, 'status', 1, 'electroFlare', 1],
    ] }, new Set(), new Set())
    const grants = state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === bonus)
    expect(grants.map((entry: RuntimeRecord) => [entry.owner, entry.target, entry.frame]))
      .toEqual([[1, 1, 3], [1, 2, 30]])
    expect(state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === stacks)
      .map((entry: RuntimeRecord) => entry.stacks)).toEqual([1, 2, 3])
  })
  it.each([false, true])('scopes earned recipient bonuses across short parent attacks (active-only: %s)', activeRecipientOnly => {
    const path = 'runtime.state.controls.weapon:1:recipient_bonus'
    const { kits, combat } = setup([], [])
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    Object.assign(combat.members[0].weapon, {
      effects: { 11: { recipient: 'actorMember', activeRecipientOnly, maxStacks: 1, duration: 100 } },
      effectControls: { 11: [[path, true]] },
    })
    const cast = (owner: number, instance: number, frame: number) => ({ type: 'cast', owner, actionId: 10, instance, frame })
    const hit = (owner: number, instance: number, frame: number) => [2, 3, 4].map(eventId =>
      ({ type: 'hit', owner, actionId: 10, instance, frame, eventId }))
    const trace = [
      { type: 'effect', owner: 1, effectId: 11, target: 2, recipient: 'actorMember', stacks: 1, until: 100, frame: 0 },
      cast(2, 1, 1), ...hit(2, 1, 1), cast(1, 2, 20), ...hit(1, 2, 20),
      { type: 'effect', owner: 1, effectId: 11, target: 1, recipient: 'actorMember', stacks: 1, until: 100, frame: 30 },
      cast(1, 3, 31), ...hit(1, 3, 31),
    ]
    const source = { source: { skills: [{ id: 'press', hitTable: [{ count: 3 }] }],
      features: [{ id: 'damage:press', skillId: 'press' }] } }
    const output = emitEditorProgram(kits, { ...combat, maxFrames: 40 }, {
      frame: 40, trace, casts: trace.filter(entry => entry.type === 'cast'),
    }, { resonators: { 1: source, 2: source }, memberEffectControls: { 1: combat.members[0].weapon.effectControls },
      preambleChoices: [{ resonatorId: '1', state: { path, kind: 'toggle', defaultValue: false } }] })
    const features = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(features.map((node: RuntimeRecord) => node.resonatorId)).toEqual(['2', '1', '1'])
    expect(features.map((node: RuntimeRecord) => node.attached?.conditions.flatMap((condition: RuntimeRecord) =>
      condition.changes.filter((change: RuntimeRecord) => change.path === path).map((change: RuntimeRecord) => change.value)) ?? []))
      .toEqual([[], [false], []])
  })
  it('retains a bonus from an earlier hit group when the following uniform group uses its parent feature', () => {
    const path = 'runtime.state.controls.weapon:1:hit_bonus'
    const { kits, combat } = setup([], [])
    kits[1].nodeFeatures[10] = ['start', 'tail', 'tail']
    Object.assign(combat.members[0].weapon, {
      effects: { 11: { recipient: 'self', maxStacks: 1, duration: 100 } },
      rules: [{ id: 11, when: codes.event.hit, phase: 'afterHit', operations: [{ op: 'grantEffect', effect: 11 }] }],
      effectControls: { 11: [[path, true]] },
    })
    const { state } = playTimeline(kits, combat, { seconds: 1,
      events: [[0, 'swap', 0], [0, 'cast', 0, 'Basic - Press', -1]] }, new Set(), new Set())
    const output = emitEditorProgram(kits, { ...combat, maxFrames: state.frame }, {
      frame: state.frame, trace: state.trace, casts: state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast'),
    }, {
      resonators: { 1: { source: {
        skills: [{ id: 'start', hitTable: [{ count: 1 }] }, { id: 'tail', hitTable: [{ count: 2 }] }],
        features: [{ id: 'damage:start', skillId: 'start' }, { id: 'damage:tail', skillId: 'tail' }],
      } } },
      memberEffectControls: { 1: combat.members[0].weapon.effectControls },
      preambleChoices: [{ resonatorId: '1', state: { path, kind: 'toggle', defaultValue: false } }],
    })
    const features = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(features.map((node: RuntimeRecord) => [node.featureId, node.multiplier])).toEqual([
      ['damage:start', 1], ['damage:tail', 1],
    ])
    expect(features[0].attached?.conditions ?? []).toEqual([])
    expect(features[1].attached.conditions.flatMap((node: RuntimeRecord) => node.changes))
      .toEqual([{ type: 'set', path, value: true, resonatorId: '1' }])
  })
  it('requires every same-owner marker and refreshes dependent controls on marker expiry or removal', () => {
    const path = 'runtime.state.controls.weapon:1:both_marks'
    const { kits, combat } = setup([], [])
    Object.assign(combat.members[0].weapon, { effects: {
      11: { recipient: 'self', maxStacks: 1, duration: 10 },
      12: { recipient: 'self', maxStacks: 1, duration: 100 },
      13: { recipient: 'team', maxStacks: 1, duration: 100, requiresOwnerEffects: [11, 12] },
    }, effectControls: { 11: [], 12: [], 13: [[path, true]] } })
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    const effect = (owner: number, effectId: number, frame: number, until: number, stacks = 1) =>
      ({ type: 'effect', owner, effectId, frame, until, stacks, target: owner, recipient: 'self' })
    const output = emitEditorProgram(kits, { ...combat, maxFrames: 30 }, { frame: 30, casts: [], trace: [
      effect(1, 11, 1, 10), effect(1, 13, 1, 100), effect(2, 12, 2, 100),
      effect(1, 12, 3, 100), { type: 'clock', frame: 10 },
      effect(1, 11, 12, 20), effect(1, 12, 13, 13, 0), effect(1, 12, 14, 100), { type: 'clock', frame: 20 },
    ] }, { resonators: { 1: { source: { features: [], skills: [] } }, 2: { source: { features: [], skills: [] } } },
      memberEffectControls: { 1: combat.members[0].weapon.effectControls, 2: combat.members[1].weapon.effectControls },
      preambleChoices: [1, 2].map(owner => ({ resonatorId: String(owner), state: { path, kind: 'toggle', defaultValue: false } })) })
    expect(output.items.flatMap((node: RuntimeRecord) => node.changes ?? []).filter((change: RuntimeRecord) =>
      change.path === path && String(change.resonatorId) === '1').map((change: RuntimeRecord) => change.value))
      .toEqual([false, true, false, true, false, true, false])
    expect(output.items.flatMap((node: RuntimeRecord) => node.changes ?? []).filter((change: RuntimeRecord) =>
      change.path === path && String(change.resonatorId) === '2').map((change: RuntimeRecord) => change.value)).toEqual([false])
  })
  it('projects total stacks into additional-stack selects and restores their base stack on opening', () => {
    const active = 'runtime.state.controls.team:1:pack_hunt:active'
    const path = 'runtime.state.controls.team:1:pack_hunt:stacks'
    const { kits, combat } = setup([], ['Kit: Stance'])
    kits[1].effectControls = { 7: [[active, true], [path, { offset: -1 }]] }
    const editor: RuntimeRecord = {
      preambleChoices: [
        { resonatorId: '1', state: { path: active, kind: 'toggle', defaultValue: false } },
        { resonatorId: '1', state: { path, kind: 'select', defaultValue: '0',
          options: ['0', '1', '2'].map(id => ({ id, label: id })) } },
      ],
      resonators: { 1: { source: { features: [{ id: 'damage:press', skillId: 'press' }], skills: [{ id: 'press' }] } } },
    }
    combat.members[0].initialControls = { 'team:1:pack_hunt:active': true, 'team:1:pack_hunt:stacks': '0' }
    bindEquipmentConditions(editor, combat, kits, kits)
    expect(combat.members[0].initialEffectGrants).toEqual([{ effect: 7, stacks: 1 }])
    combat.members[0].initialControls['team:1:pack_hunt:active'] = false
    bindEquipmentConditions(editor, combat, kits, kits)
    expect(combat.members[0].initialEffectGrants).toEqual([])
    const { state } = playTimeline(kits, combat, { seconds: 2, events: [[0, 'swap', 0],
      [1, 'state', 0, 'Kit: Stance', 1, 0], [2, 'cast', 0, 'Basic - Press', -1],
      [30, 'state', 0, 'Kit: Stance', 2, 0], [31, 'cast', 0, 'Basic - Press', -1],
      [60, 'state', 0, 'Kit: Stance', 3, 0], [61, 'cast', 0, 'Basic - Press', -1],
      [90, 'state', 0, 'Kit: Stance', 0, 0], [91, 'cast', 0, 'Basic - Press', -1],
    ] }, new Set(), new Set())
    const output = emitEditorProgram(kits, { ...combat, maxFrames: state.frame }, {
      frame: state.frame, trace: state.trace, casts: state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast'),
    }, editor)
    expect(output.items.flatMap((node: RuntimeRecord) => node.changes ?? []).filter((change: RuntimeRecord) =>
      change.path === path).map((change: RuntimeRecord) => change.value)).toEqual(['0', '1', '2', '0'])
  })

  it('ends a governed recipient buff on swap without waiting for another held-state snapshot', () => {
    const { kits, combat } = setup([], ['Kit: Handoff'], {
      13: { name: 'Kit: Handoff', recipient: 'incomingMember', maxStacks: 1, duration: 840,
        endsOn: { recipientSwap: true } },
    })
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    const { state } = playTimeline(kits, combat, { seconds: 1, events: [
      [0, 'swap', 1], [0, 'state', 0, 'Kit: Handoff', 1, 1],
      [1, 'cast', 1, 'Basic - Press', -1], [30, 'swap', 0],
    ] }, new Set(), new Set())
    const cleared = state.trace.findIndex((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 13 && entry.stacks === 0)
    const swapped = state.trace.findIndex((entry: RuntimeRecord) => entry.type === 'swap' && entry.frame === 30)
    expect(cleared).toBeGreaterThan(-1)
    expect(cleared).toBeLessThan(swapped)
    expect(state.trace[cleared]).toMatchObject({ owner: 1, target: 2, frame: 30 })
    expect(stacksOf(state, 13)).toBe(0)
  })

  it('uses captured sparse hit offsets without changing the shared action timing', () => {
    const { kits, combat } = setup([], [])
    const { state } = playTimeline(kits, combat, { seconds: 1, events: [
      [0, 'swap', 0], [1, 'cast', 0, 'Basic - Press', 2, null, [0, 2], [0, 20]],
    ] }, new Set(), new Set())
    expect(hits(state).map((entry: RuntimeRecord) => [entry.eventId, entry.frame])).toEqual([[2, 1], [4, 21]])
    expect(kits[1].actions[10].events.filter((event: RuntimeRecord) => event.damage)
      .map((event: RuntimeRecord) => event.at)).toEqual([0, 5, 10])
  })

  it('lands a captured time-stopped hit at its captured offset, before a later field clear', () => {
    const { kits, combat } = setup([], ['Kit: Stance'])
    kits[1].actions[10].events = [kits[1].actions[10].events[0],
      { ...kits[1].actions[10].events[1], at: 186 }]
    const { state } = playTimeline(kits, combat, { seconds: 4, events: [
      [0, 'swap', 0], [0, 'state', 0, 'Kit: Stance', 1, 0],
      [1, 'cast', 0, 'Basic - Press', 1, null, [0], [0]], [2, 'state', 0, 'Kit: Stance', 0, 0],
    ] }, new Set(), new Set())
    const hit = state.trace.findIndex((entry: RuntimeRecord) => entry.type === 'hit')
    const clear = state.trace.findIndex((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 7 && entry.stacks === 0)
    expect(state.trace[hit].frame).toBe(1)
    expect(hit).toBeLessThan(clear)
  })

  it('emits converted Frazzle rungs on their inflictor without changing held enemy stacks', () => {
    const { state } = play({ seconds: 1, events: [
      [0, 'swap', 0], [0, 'status', 0, 'heliacalEmber', 28],
      [0, 'status', 0, 'spectroFrazzle', 0],
      [1, 'tick', 0, 'spectroFrazzle', 3], [1, 'tick', 0, 'spectroFrazzle', 2],
      [1, 'tick', 0, 'spectroFrazzle', 1],
    ] })
    expect(state.trace.filter((entry: RuntimeRecord) => entry.hitKind === 'spectroFrazzle')
      .map((entry: RuntimeRecord) => [entry.owner, entry.negativeEffectStacks])).toEqual([[1, 3], [1, 2], [1, 1]])
    expect(state.enemy.spectroFrazzle).toBe(0)
    expect(state.enemy.heliacalEmber).toBe(28)
  })

  it('pairs recorded Rage with only the same-frame Flare tick and scopes its existing input to that node', () => {
    const { kits, combat } = setup([], [])
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    const flare = 'enemy.combat.electroFlare', rage = 'enemy.combat.electroRage'
    const { state } = playTimeline(kits, combat, { seconds: 1, events: [
      [0, 'status', 0, 'electroFlare', 13], [0, 'status', 0, 'electroRage', 0],
      [1, 'tick', 0, 'electroFlare'], [1, 'status', 0, 'electroRage', 2],
      [1, 'tick', 0, 'electroRage'], [1, 'status', 0, 'electroRage', 0],
      [2, 'tick', 0, 'electroFlare'],
      [3, 'status', 0, 'electroRage', 5], [3, 'tick', 0, 'electroRage'],
      [4, 'tick', 0, 'electroFlare'],
      [5, 'tick', 0, 'electroFlare'], [5, 'status', 1, 'electroRage', 3], [5, 'tick', 1, 'electroRage'],
    ] }, new Set([flare, rage]), new Set())
    const ticks = state.trace.filter((entry: RuntimeRecord) => entry.hitKind === 'electroFlare')
    expect(ticks.map((entry: RuntimeRecord) => entry.negativeEffectAdditionalStacks)).toEqual([2, undefined, undefined, undefined])
    expect(state.enemy.electroRage).toBe(3)
    const feature = { id: 'damage:1:negative-effect:electro-flare', skillId: 'flare' }
    const editor = {
      resonators: { 1: { source: { features: [feature], skills: [{ id: 'flare' }] } },
        2: { source: { features: [], skills: [] } } },
      preambleChoices: [flare, rage].map(path => ({ resonatorId: '1', state: { path, kind: 'stack', defaultValue: 0 } })),
    }
    const output = emitEditorProgram(kits, { ...combat, maxFrames: state.frame },
      { frame: state.frame, trace: state.trace, casts: [] }, editor)
    const nodes = output.items.filter((node: RuntimeRecord) => node.type === 'feature')
    expect(nodes.reduce((count: number, node: RuntimeRecord) => count + node.multiplier, 0)).toBe(4)
    expect(nodes[0].attached.conditions.flatMap((condition: RuntimeRecord) => condition.changes)
      .map((change: RuntimeRecord) => [change.path, change.value])).toEqual([[rage, 2]])
    expect(nodes[1].attached).toBeUndefined()
    expect(nodes.slice(2).map((node: RuntimeRecord) => node.attached.conditions.flatMap((condition: RuntimeRecord) =>
      condition.changes.map((change: RuntimeRecord) => [change.path, change.value])))).toEqual([[[rage, 0]], [[rage, 0]]])
    const withoutRage = emitEditorProgram(kits, { ...combat, maxFrames: state.frame },
      { frame: state.frame, trace: ticks, casts: [] }, { ...editor, preambleChoices: editor.preambleChoices.slice(0, 1) })
    expect(withoutRage.items.filter((node: RuntimeRecord) => node.type === 'feature')
      .every((node: RuntimeRecord) => !node.attached)).toBe(true)
  })

  it('does not move a renewed post-cast grant before the older clear of that control', () => {
    const path = 'runtime.state.controls.refresh'
    const { kits, combat } = setup([], [])
    kits[1].effectControls = { 7: [[path, true]] }
    const effect = (frame: number, stacks: number, until: number, extra = {}) => ({
      type: 'effect', owner: 1, target: 1, recipient: 'self', effectId: 7, frame, stacks, until, ...extra })
    const cast = (frame: number, instance: number) => ({ type: 'cast', owner: 1, actionId: 10, action: 'Basic - Press', frame, instance })
    const landed = (frame: number, instance: number) => [2, 3, 4].map(eventId => ({ type: 'hit', owner: 1, actionId: 10,
      eventId, frame, instance }))
    const trace = [effect(0, 1, 10), cast(9, 1), ...landed(9, 1), effect(10, 0, 10),
      effect(10, 1, 100, { sourceActionId: 10, sourceInstance: 1 }), cast(11, 2), ...landed(11, 2)]
    const output = emitEditorProgram(kits, { ...combat, maxFrames: 11 }, { frame: 11, trace, casts: [cast(9, 1), cast(11, 2)] },
      { resonators: { 1: { source: { skills: [{ id: 'press' }], features: [{ id: 'damage:press', skillId: 'press' }] } } },
        effectControls: kits[1].effectControls,
        preambleChoices: [{ resonatorId: '1', state: { path, kind: 'toggle', defaultValue: false } }] })
    let active = false
    const atHits: boolean[] = []
    for (const node of output.items) {
      for (const change of node.changes ?? []) if (change.path === path) active = change.value
      if (node.type === 'feature') atHits.push(active)
    }
    expect(atHits).toEqual([true, true])
  })

  it('keeps later parent-hit stack grants after intervening attacks', () => {
    const path = 'runtime.state.controls.weapon:1:stacks'
    const { kits, combat } = setup([], [])
    kits[1].effectControls = { 7: [[path, 'stacks']] }
    kits[1].actions[20] = { name: 'Child', cast: codes.cast.skill, timing: { duration: 0 },
      events: [{ id: 21, kind: codes.event.hit, at: 0, index: 0, damage: { type: 1 } }] }
    kits[1].nodeFeatures[20] = 'child'
    const cast = (frame: number, actionId: number) => ({ type: 'cast', owner: 1, actionId, instance: 1, frame })
    const hit = (frame: number, actionId: number, eventId: number) => ({ type: 'hit', owner: 1, actionId, instance: 1, eventId, frame })
    const grant = (frame: number, stacks: number) => ({ type: 'effect', owner: 1, target: 1, recipient: 'self',
      effectId: 7, sourceActionId: 10, sourceInstance: 1, frame, stacks, until: 100 })
    const trace = [cast(0, 10), hit(0, 10, 2), grant(0, 1), cast(1, 20), hit(1, 20, 21),
      hit(5, 10, 3), grant(5, 2), hit(10, 10, 4), grant(10, 3)]
    const output = emitEditorProgram(kits, { ...combat, maxFrames: 10 }, {
      frame: 10, trace, casts: trace.filter(row => row.type === 'cast'),
    }, { resonators: { 1: { source: {
      skills: [{ id: 'press' }, { id: 'child' }],
      features: ['press', 'child'].map(id => ({ id: `damage:${id}`, skillId: id })),
    } } }, effectControls: kits[1].effectControls,
    preambleChoices: [{ resonatorId: '1', state: { path, kind: 'stack', defaultValue: 0 } }] })
    let stacks = 0
    let childStacks
    for (const node of output.items) {
      for (const change of node.changes ?? []) if (change.path === path) stacks = change.value
      if (node.featureId === 'damage:child') childStacks = stacks
    }
    expect(childStacks).toBe(1)
    expect(stacks).toBe(3)
  })

  it('does not preserve an expired numerical bonus as a cast availability condition', () => {
    const path = 'runtime.state.controls.bonus'
    const { kits, combat } = setup([{ id: 'gain', when: codes.event.cast,
      operations: [{ op: 'grantEffect', effect: 8 }] }], [], { 8: { name: 'Timed Bonus', duration: 2, maxStacks: 1, recipient: 'self' } })
    kits[1].effectControls = { 8: [[path, true]] }
    const { state } = playTimeline(kits, combat, { seconds: 1, events: [
      [0, 'cast', 0, 'Basic - Press', -1, null, [0, 1, 2], [4, 5, 6]],
    ] }, new Set(), new Set())
    const output = emitEditorProgram(kits, { ...combat, maxFrames: state.frame }, {
      frame: state.frame, trace: state.trace, casts: state.trace.filter((row: RuntimeRecord) => row.type === 'cast'),
    }, { resonators: { 1: { source: {
      features: [{ id: 'damage:press', skillId: 'press' }],
      skills: [{ id: 'press', hitTable: [{ count: 3, values: [1] }] }],
      effects: [{ trigger: 'skill', condition: { type: 'truthy', from: 'sourceRuntime', path: 'state.controls.bonus' },
        operations: [{ match: { skillIds: ['press'] } }] }],
    } } }, effectControls: kits[1].effectControls,
    preambleChoices: [{ resonatorId: '1', state: { path, kind: 'toggle', defaultValue: false } }] })
    const attack = output.items.find((node: RuntimeRecord) => node.type === 'feature')!
    expect(attack.attached?.conditions?.some((node: RuntimeRecord) => node.changes.some((change: RuntimeRecord) => change.path === path && change.value === true)) ?? false).toBe(false)
  })

  it.each([true, false])('emits a timed sequence window only when its control is editor-authorable (%s)', offered => {
    const path = 'runtime.state.controls.sequence:1:s4:active'
    const { kits, combat } = setup([], ['Kit: Stance'])
    kits[1].effectControls = { 7: [[path, true]] }
    const { state } = playTimeline(kits, combat, { seconds: 1, events: [
      [0, 'swap', 0], [1, 'state', 0, 'Kit: Stance', 1, 0], [2, 'cast', 0, 'Basic - Press', -1],
      [20, 'state', 0, 'Kit: Stance', 0, 0],
    ] }, new Set(), new Set())
    state.trace.unshift({ type: 'control', owner: 1, path, value: true, frame: 0 })
    state.trace.push({ type: 'control', owner: 1, path, value: true, frame: state.frame })
    const output = emitEditorProgram(kits, { ...combat, maxFrames: state.frame }, {
      trace: state.trace, casts: state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast'), frame: state.frame,
    }, { resonators: { 1: { source: { features: [{ id: 'damage:press', skillId: 'press' }], skills: [{ id: 'press' }] } } },
      effectControls: kits[1].effectControls, preambleChoices: [{ resonatorId: '1', state: {
        path: offered ? path : 'runtime.state.controls.other', kind: 'toggle', defaultValue: false } }] })
    const changes = output.items.flatMap((node: RuntimeRecord) => node.changes ?? [])
      .filter((change: RuntimeRecord) => change.path === path).map((change: RuntimeRecord) => change.value)
    expect(changes).toEqual(offered ? [false, true, false] : [])
  })

  it('writes a borrowed buff clear after intervening recipient hits', () => {
    const path = 'runtime.state.controls.borrowed'
    const { kits, combat } = setup([], ['Kit: Stance'])
    kits[1].effectControls = { 7: [[path, true]] }
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    kits[2].actions[12] = { name: 'Liberation - Finisher', cast: codes.cast.liberation, timing: { duration: 300, timeStop: [0, 300] },
      events: [{ id: 20, kind: codes.event.cast, at: 0 },
        { id: 21, kind: codes.event.hit, at: 216, index: 0, damage: { type: 3 } }] }
    kits[2].nodeFeatures = { 12: 'finisher' }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    const { state } = playTimeline(kits, combat, { seconds: 1, events: [
      [0, 'swap', 1], [0, 'state', 0, 'Kit: Stance', 1, 1],
      [10, 'cast', 0, 'Basic - Press', -1], [10, 'cast', 1, 'Liberation - Finisher', -1],
      [10, 'state', 0, 'Kit: Stance', 0, 1],
    ] }, new Set(), new Set())
    const clear = state.trace.find((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 7 && entry.stacks === 0)
    expect(clear.sourceActionId).toBeUndefined()
    const source = (id: string) => ({ source: { skills: [{ id }], features: [{ id: `damage:${id}`, skillId: id }] } })
    const output = emitEditorProgram(kits, { ...combat, maxFrames: state.frame }, {
      trace: state.trace, casts: state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast'), frame: state.frame,
    }, { resonators: { 1: source('press'), 2: source('finisher') }, effectControls: kits[1].effectControls,
      preambleChoices: [{ resonatorId: '1', state: { path, kind: 'toggle', defaultValue: false } }] })
    const finisher = output.items.findIndex((node: RuntimeRecord) => node.featureId === 'damage:finisher')
    const clearAt = output.items.findIndex((node: RuntimeRecord, index: number) => index > finisher &&
      node.changes?.some((change: RuntimeRecord) => change.path === path && change.value === false))
    expect(finisher).toBeGreaterThanOrEqual(0)
    expect(clearAt).toBeGreaterThan(finisher)
  })

  it('treats reviewed displayed contributor counts as counts, preserving raw bitmasks outside timelines', () => {
    const path = 'runtime.state.controls.inherent:1:contributors:stacks'
    const { kits, combat } = setup([], ['Kit: Stance'])
    kits[1].effectControls = { 7: [[path, { bitCount: 3, displayedCount: true }]] }
    const editor: RuntimeRecord = { preambleChoices: [{ resonatorId: '1', state: { path, kind: 'stack', defaultValue: 0 } }],
      resonators: { 1: { source: { features: [{ id: 'damage:press', skillId: 'press' }], skills: [{ id: 'press' }] } } } }
    bindEquipmentConditions(editor, combat, kits)
    expect(editor.memberEffectControls[1][7][0][1]).toEqual({ bitCount: 3, displayedCount: true })
    bindEquipmentConditions(editor, combat, kits, kits)
    expect(editor.memberEffectControls[1][7][0][1]).toBe('stacks')
    const { state } = playTimeline(kits, combat, { seconds: 1, events: [[0, 'swap', 0],
      [1, 'state', 0, 'Kit: Stance', 2, 0], [2, 'cast', 0, 'Basic - Press', -1]] }, new Set(), new Set())
    const output = emitEditorProgram(kits, { ...combat, maxFrames: state.frame }, {
      frame: state.frame, trace: state.trace, casts: state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast'),
    }, editor)
    expect(output.items.flatMap((node: RuntimeRecord) => node.changes ?? []).filter((change: RuntimeRecord) =>
      change.path === path).map((change: RuntimeRecord) => change.value)).toEqual([0, 2])
  })

  it.each(['before', 'after'])('binds Outro equipment when the swap is %s its cast and ends it when the recipient leaves', order => {
    const { kits, combat } = setup([], [])
    kits[1].actions[10].cast = codes.cast.outro
    kits[2] = { ...structuredClone(kits[1]), resonatorId: 2 }
    combat.members.push({ ...structuredClone(combat.members[0]), resonatorId: 2 })
    Object.assign(combat.members[0].sonata, {
      effects: { 14: { name: 'Incoming equipment buff', recipient: 'incomingMember', duration: 900,
        maxStacks: 1, endsOn: { recipientSwap: true } } },
      rules: [{ id: 14, when: codes.event.cast, actions: [10], operations: [
        { op: 'grantEffect', effect: 14, recipient: 'incomingMember', stacks: 1 }] }],
    })
    const swap: TimelineEvent = [10, 'swap', 1], cast: TimelineEvent = [10, 'cast', 0, 'Basic - Press', -1]
    const { state } = playTimeline(kits, combat, { seconds: 2, events: [[0, 'swap', 0],
      ...(order === 'before' ? [swap, cast] : [cast, swap]), [30, 'swap', 0]] }, new Set(), new Set())
    const events = state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 14)
    expect(events.map((entry: RuntimeRecord) => [entry.frame, entry.target, entry.stacks])).toEqual([[10, 2, 1], [30, 2, 0]])
    expect(state.effects.some((effect: RuntimeRecord) => effect.id === 14 && effect.until > state.frame)).toBe(false)
  })
  it('snapshots active governed Tune Break Boost into source-value effects', () => {
    const effects = { 13: { name: 'Kit: Team Boost', recipient: 'team', maxStacks: 1, duration: 600,
      triggerModifiers: [{ stat: 'tuneBreakBoost', value: 40 }] } }
    const { kits, combat } = setup([], ['Kit: Team Boost'], effects)
    Object.assign(combat.members[0], { baseTuneBreakBoost: 10 })
    Object.assign(combat.members[0].echoes, { equipped: [] })
    Object.assign(combat.members[0].sonata, {
      effects: { 14: { name: 'Source snapshot', recipient: 'team', maxStacks: 1, duration: 600,
        sourceValue: { stat: 'tuneBreakBoost' } } },
      rules: [{ id: 14, when: 'afterCast', actions: [10], operations: [
        { op: 'grantEffect', effect: 14, recipient: 'team', stacks: 1 }] }],
    })
    const { state } = playTimeline(kits, combat, { seconds: 2, events: [[0, 'swap', 0],
      [0, 'state', 0, 'Kit: Team Boost', 1, -1], [10, 'cast', 0, 'Basic - Press', -1],
      [40, 'state', 0, 'Kit: Team Boost', 0, -1], [50, 'cast', 0, 'Basic - Press', -1]] }, new Set(), new Set())
    expect(state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 14)
      .map((entry: RuntimeRecord) => entry.conditionalSourceValue)).toEqual([50, 10])
  })
  it('passes hit-local controls to their cast without changing persistent state', () => {
    const path = 'runtime.state.controls.resonator:1410:wan_light:stacks'
    const { state } = play({ seconds: 1, events: [[0, 'swap', 0],
      [0, 'hitControl', 0, 'Basic - Press', 0, 0, path, '10'],
      [0, 'hitControl', 0, 'Basic - Press', 2, 0, path, '0'],
      [0, 'cast', 0, 'Basic - Press', -1]] })
    expect(state.trace.find((entry: RuntimeRecord) => entry.type === 'cast')?.hitControls).toEqual([
      { hit: 0, owner: 1, path, value: 10 }, { hit: 2, owner: 1, path, value: 0 },
    ])
    expect(state.trace.some((entry: RuntimeRecord) => entry.type === 'control' && entry.path === path)).toBe(false)
  })
  it('uses the native lifecycle for timeline effects with replayLifecycle', () => {
    const rules = [{ id: 1, when: 0, actions: [10], operations: [
      { op: 'grantEffect', effect: 13, recipient: 'team', stacks: 1 }] }]
    const effects = { 13: { name: 'Kit: Native Field', recipient: 'team', maxStacks: 1, duration: 60, replayLifecycle: true } }
    const { kits, state } = play({ seconds: 3, events: [[0, 'swap', 0],
      [0, 'state', 0, 'Kit: Native Field', 1, -1],
      [30, 'cast', 0, 'Basic - Press', -1],
      [40, 'state', 0, 'Kit: Native Field', 0, -1],
      [100, 'state', 0, 'Kit: Native Field', 1, -1]] }, [], rules, ['Kit: Native Field'], effects)
    expect(kits[1].governed.has(13)).toBe(false)
    const grants = state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 13 && entry.stacks > 0)
    expect(grants.map((entry: RuntimeRecord) => [entry.frame, entry.until])).toEqual([[30, 90]])
    expect(stacksOf(state, 13)).toBe(0)
  })
  it('reacquires a reviewed deterministic cast buff after unobserved expiry', () => {
    const rules = [{ id: 1, when: 0, actions: [10], operations: [
      { op: 'grantEffect', effect: 13, recipient: 'self', stacks: 1 }] }]
    const effects = { 13: { name: 'Kit: Cast Buff', recipient: 'self', maxStacks: 1, duration: 60, replayGrants: true } }
    const { state } = play({ seconds: 3, events: [[0, 'swap', 0],
      [0, 'state', 0, 'Kit: Cast Buff', 1, 0], [0, 'cast', 0, 'Basic - Press', -1],
      [100, 'cast', 0, 'Basic - Press', -1]] }, [], rules, ['Kit: Cast Buff'], effects)
    const grants = state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 13 && entry.stacks > 0)
    expect(grants.some((entry: RuntimeRecord) => entry.frame === 0)).toBe(true)
    expect(grants.find((entry: RuntimeRecord) => entry.frame === 100)?.until).toBe(160)
  })
  it('refreshes the original team holder so a later clear cannot leave a ghost buff', () => {
    const rules = [{ id: 1, when: 'afterCast', actions: [10], operations: [
      { op: 'grantEffect', effect: 13, recipient: 'team', stacks: 1 }] }]
    const effects = { 13: { name: 'Kit: Team Timed', recipient: 'team', maxStacks: 1, duration: 60 } }
    const { state } = play({ seconds: 3, events: [[0, 'swap', 0],
      [0, 'state', 0, 'Kit: Team Timed', 1, -1], [30, 'cast', 0, 'Basic - Press', -1],
      [60, 'state', 0, 'Kit: Team Timed', 0, -1], [70, 'cast', 0, 'Basic - Press', -1]] },
    [], rules, ['Kit: Team Timed'], effects)
    const events = state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 13)
    expect(events.find((entry: RuntimeRecord) => entry.frame === 30 && entry.stacks > 0)?.target).toBe('team')
    expect(events.every((entry: RuntimeRecord) => entry.target === 'team' && entry.recipient === 'team')).toBe(true)
    expect(events.some((entry: RuntimeRecord) => entry.frame === 70 && entry.stacks > 0)).toBe(false)
  })
  it('keeps pre-cast availability distinct from a smaller observed spend', () => {
    const { state } = play({ seconds: 2, events: [[0, 'swap', 0],
      [0, 'state', 0, 'Kit: Fuel', 60, -1],
      [30, 'consume', 0, 'Kit: Fuel', 1, 'Basic - Press'],
      [30, 'cast', 0, 'Basic - Press', -1]] }, [], [], ['Kit: Fuel'],
    { 13: { name: 'Kit: Fuel', recipient: 'team', maxStacks: 100 } })
    expect(state.trace.find((entry: RuntimeRecord) => entry.type === 'cast')?.spentEffects).toEqual([
      { owner: 1, effectId: 13, stacks: 60, consumed: 1, observedSpend: true }])
  })

  it('uses recorded consumption when the same cast also grants stacks', () => {
    const { state } = play({ seconds: 2, events: [[0, 'swap', 0],
      [0, 'state', 0, 'Kit: Fuel', 65, -1],
      [30, 'consume', 0, 'Kit: Fuel', 40, 'Basic - Press'],
      [30, 'state', 0, 'Kit: Fuel', 35, -1],
      [30, 'cast', 0, 'Basic - Press', -1]] }, [], [], ['Kit: Fuel'],
    { 13: { name: 'Kit: Fuel', recipient: 'team', maxStacks: 100 } })
    expect(state.trace.find((entry: RuntimeRecord) => entry.type === 'cast')?.spentEffects).toEqual([
      { owner: 1, effectId: 13, stacks: 65, consumed: 40, observedSpend: true }])
  })
  it('refreshes a governed timed effect only while its timeline state is active', () => {
    const rules = [{ id: 1, when: 'afterCast', actions: [10], operations: [
      { op: 'grantEffect', effect: 13, recipient: 'self', stacks: 1 }] }]
    const effects = { 13: { name: 'Kit: Timed', recipient: 'self', maxStacks: 1, duration: 60 } }
    const { state } = play({ seconds: 5, events: [[0, 'swap', 0],
      [0, 'cast', 0, 'Basic - Press', -1],
      [30, 'state', 0, 'Kit: Timed', 1, 0], [60, 'cast', 0, 'Basic - Press', -1],
      [100, 'state', 0, 'Kit: Timed', 0, 0], [110, 'cast', 0, 'Basic - Press', -1],
      [150, 'state', 0, 'Kit: Timed', 1, 0], [160, 'cast', 0, 'Basic - Press', -1]] },
    [], rules, ['Kit: Timed'], effects)
    const grants = state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' &&
      entry.effectId === 13 && entry.stacks > 0)
    expect(grants.some((entry: RuntimeRecord) => entry.frame === 0 || entry.frame === 110)).toBe(false)
    expect(grants.find((entry: RuntimeRecord) => entry.frame === 60)?.until).toBe(120)
    expect(grants.find((entry: RuntimeRecord) => entry.frame === 160)?.until).toBe(220)
  })
  it('lands only the hits the reference landed', () => {
    const all = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'cast', 0, 'Basic - Press', -1]] })
    const two = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'cast', 0, 'Basic - Press', 2]] })
    const none = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'cast', 0, 'Basic - Press', 0]] })
    expect(hits(all.state)).toHaveLength(3)
    expect(hits(two.state)).toHaveLength(2)
    expect(hits(none.state)).toHaveLength(0)
    expect(none.state.trace.filter((entry: RuntimeRecord) => entry.type === 'cast')).toHaveLength(1)
  })

  it('applies timeline stack counts and retains rules for other effects', () => {
    const { kits, state } = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'cast', 0, 'Basic - Press', -1],
      [10, 'state', 0, 'Kit: Stance', 3, 0]] })
    const ops = kits[1].rules.flatMap((rule: RuntimeRecord) => rule.operations.map((operation: RuntimeRecord) => operation.op))
    expect(ops).toEqual(['grantEffect'])
    expect(kits[1].rules[0].operations[0].effect).toBe(8)
    expect(stacksOf(state, 7)).toBe(3)
    expect(stacksOf(state, 8)).toBe(1)
  })

  it('lets a cast\'s own rules see the state the reference shows it spending just ahead of it', () => {
    // the reference reads a cast's held state at its hits: Unison spent by its Outro is gone first
    const answer = [{ id: 1, when: 'afterCast', actions: [10], conditions: [{ path: 'effects.7.stacks', operator: 'gte', value: 1 }],
      operations: [{ op: 'grantEffect', effect: 8, recipient: 'self', stacks: 1 }] }]
    const { state } = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'state', 0, 'Kit: Stance', 1, 0],
      [30, 'state', 0, 'Kit: Stance', 0, 0], [30, 'cast', 0, 'Basic - Press', -1]] }, [], answer)
    expect(stacksOf(state, 8)).toBe(1)
    expect(stacksOf(state, 7)).toBe(0)
    const order = state.trace.filter((entry: RuntimeRecord) => entry.frame === 30 && ['effect', 'cast'].includes(entry.type))
      .map((entry: RuntimeRecord) => entry.type === 'cast' ? 'cast' : `${entry.effectId}:${entry.stacks}`)
    expect(order.slice(0, 2)).toEqual(['7:0', 'cast'])
  })

  it('never takes a nameless reference state for a nameless kit effect', () => {
    const { kits, skipped } = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'state', 0, '', 1, 0]] }, [], undefined, ['Kit: Stance', ''])
    expect(kits[1].governed.has(9)).toBe(false)
    expect(skipped).toHaveLength(1)
  })

  it('traces an extended effect until its updated expiry', () => {
    const rules = [{ id: 1, when: 'afterCast', actions: [10], operations: [{ op: 'grantEffect', effect: 11, recipient: 'self', stacks: 1 }] },
      { id: 2, when: codes.event.hit, phase: 'afterHit', operations: [
        { op: 'extendEffect', effect: 11, frames: 60, maxExtensions: 1, maxTotalFrames: 120 }] }]
    const { state } = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'cast', 0, 'Basic - Press', -1]] }, [], rules, [],
      { 11: { name: 'Kit: Timed', recipient: 'self', maxStacks: 1, duration: 30 } })
    const traced = state.trace.filter((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 11)
    expect(traced.map((entry: RuntimeRecord) => entry.until)).toEqual([30, 90])
  })

  it('signals a status reapplication when stacks stay at their cap', () => {
    // reapplying a status at its cap leaves the reference stack count unchanged.
    const rules = [{ id: 1, when: 'afterCast', actions: [10], operations: [{ op: 'grantEffect', effect: 12, stacks: 1 }] },
      { id: 2, when: 'statusApplied', conditions: [{ path: 'event.status', operator: 'eq', value: 'glacioChafe' }],
        operations: [{ op: 'grantEffect', effect: 8, recipient: 'self', stacks: 1 }] }]
    const effects = { 12: { name: 'Glacio Chafe', recipient: 'target', maxStacks: 10, status: { key: 'glacioChafe' } } }
    const capped = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'status', 0, 'glacioChafe', 10],
      [30, 'cast', 0, 'Basic - Press', -1]] }, [], rules, [], effects)
    expect(capped.kits[1].inflicts.has('glacioChafe')).toBe(true)
    expect(stacksOf(capped.state, 8)).toBe(1)
    // the held rise itself is no second application
    const rising = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'status', 0, 'glacioChafe', 1]] }, [], rules, [], effects)
    expect(stacksOf(rising.state, 8)).toBe(0)
  })

  it('dispatches each Shifting application while its timeline state remains active', () => {
    const rules = [{ id: 1, when: 'afterCast', actions: [10], operations: [{ op: 'grantEffect', effect: 12, recipient: 'enemy', stacks: 1 }] },
      { id: 2, when: 'statusApplied', conditions: [{ path: 'event.status', operator: 'eq', value: 'tuneStrainShifting' }],
        operations: [{ op: 'grantEffect', effect: 7, recipient: 'self', stacks: 1 }] },
      { id: 3, when: 'statusApplied', conditions: [{ path: 'event.negativeInflicted', operator: 'eq', value: true }],
        operations: [{ op: 'grantEffect', effect: 8, recipient: 'self', stacks: 1 }] }]
    const effects = { 12: { name: 'Tune Strain - Shifting', recipient: 'enemy', maxStacks: 1 } }
    const { kits, state } = play({ seconds: 2, events: [[0, 'swap', 0], [0, 'state', 0, 'Tune Strain - Shifting', 1, -2],
      [0, 'cast', 0, 'Basic - Press', -1], [30, 'cast', 0, 'Basic - Press', -1]] }, [], rules, [], effects)
    expect(kits[1].inflicts.has('tuneStrainShifting')).toBe(false)
    // both presses lay it again: each is an application the equipment answers
    expect(stacksOf(state, 7)).toBe(2)
    // and a Shifting is no negative status
    expect(stacksOf(state, 8)).toBe(0)
  })

  it('hands a heal the healer\'s running cast', () => {
    const rules = [{ id: 1, when: 'heal', conditions: [{ path: 'event.cast', operator: 'eq', value: codes.cast.basic }],
      operations: [{ op: 'grantEffect', effect: 8, recipient: 'self', stacks: 1 }] }]
    const { state } = play({ seconds: 1, events: [[0, 'swap', 0], [0, 'cast', 0, 'Basic - Press', -1], [5, 'heal', 0]] }, [], rules)
    expect(stacksOf(state, 8)).toBe(1)
  })

  it('applies recorded healing before a same-frame hit and retains its cast provenance', () => {
    const rules = [{ id: 'heal', when: 'heal', operations: [{ op: 'grantEffect', effect: 8 }] }]
    const { state } = play({ seconds: 1, events: [[0, 'cast', 0, 'Basic - Press', -1], [5, 'heal', 0]] }, [], rules)
    const before = state.trace.findIndex((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 8)
    const hit = state.trace.findIndex((entry: RuntimeRecord) => entry.type === 'hit' && entry.frame === 5)
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(hit)
    expect(state.trace[before]).toMatchObject({ sourceActionId: 10, sourceSupport: 'heal' })
    expect(state.trace.findIndex((entry: RuntimeRecord) => entry.type === 'hit' && entry.frame === 0)).toBeLessThan(before)
  })

  it('expires heal-triggered effects and refreshes their duration on another heal', () => {
    const rules = [{ id: 1, when: 'heal', operations: [{ op: 'grantEffect', effect: 13, recipient: 'self', stacks: 1 }] }]
    const effects = { 13: { name: 'Kit: Healed', recipient: 'self', maxStacks: 1, duration: 60 } }
    const { state } = play({ seconds: 10, events: [[0, 'swap', 0], [5, 'heal', 0], [55, 'heal', 0],
      [400, 'cast', 0, 'Basic - Press', -1]] }, [], rules, [], effects)
    expect(stacksOf(state, 13)).toBe(0)
    expect(state.trace.filter((row: RuntimeRecord) => row.type === 'effect' && row.effectId === 13)
      .map((row: RuntimeRecord) => [row.frame, row.stacks, row.until])).toEqual([[5, 1, 65], [55, 1, 115]])
  })

  it('writes a control only where the editor can, and skips the rest', () => {
    const events: ActionTimeline['events'] = [[0, 'swap', 0], [5, 'control', 'enemy.status.tuneStrain', 1]]
    const open = play({ seconds: 1, events }, ['enemy.status.tuneStrain'])
    const closed = play({ seconds: 1, events })
    expect(open.state.trace.some((entry: RuntimeRecord) => entry.type === 'control' && entry.path === 'enemy.status.tuneStrain')).toBe(true)
    expect(open.skipped).toHaveLength(0)
    expect(closed.skipped).toHaveLength(1)
  })
})
