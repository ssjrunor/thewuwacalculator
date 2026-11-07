/*
  Author: Runor Ewhro
  description: checks timeline event order, effect durations, and status updates.
*/

import { describe, expect, it } from 'vitest'
import { playTimeline, timelineKits } from '../events/timeline'
import { withTuneBreak } from '../events/offTune'
import { codes } from '../codes'
import type { ActionPlan, ActionTimeline, TimelineEvent } from '../../../domain/rotationActions/types'
import type { RuntimeRecord } from '../types'

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
  const combat = { mode: 'beta', maxFrames: 4000, target: { class: 4 }, initialOnFieldResonatorId: 1,
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
  it('uses recorded consumption when the same cast also grants stacks', () => {
    const { state } = play({ seconds: 2, events: [[0, 'swap', 0],
      [0, 'state', 0, 'Kit: Fuel', 65, -1],
      [30, 'consume', 0, 'Kit: Fuel', 40, 'Basic - Press'],
      [30, 'state', 0, 'Kit: Fuel', 35, -1],
      [30, 'cast', 0, 'Basic - Press', -1]] }, [], [], ['Kit: Fuel'],
    { 13: { name: 'Kit: Fuel', recipient: 'team', maxStacks: 100 } })
    expect(state.trace.find((entry: RuntimeRecord) => entry.type === 'cast')?.spentEffects).toEqual([
      { owner: 1, effectId: 13, stacks: 65, consumed: 40 }])
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

  it('preserves heal-triggered effects from the first heal through the fight', () => {
    const rules = [{ id: 1, when: 'heal', operations: [{ op: 'grantEffect', effect: 13, recipient: 'self', stacks: 1 }] }]
    const effects = { 13: { name: 'Kit: Healed', recipient: 'self', maxStacks: 1, duration: 60 } }
    const { state } = play({ seconds: 10, events: [[0, 'swap', 0], [5, 'heal', 0], [400, 'cast', 0, 'Basic - Press', -1]] }, [], rules, [], effects)
    // long past its own 1s: the reference's heal is one beat of a healing that keeps going
    expect(stacksOf(state, 13)).toBe(1)
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
