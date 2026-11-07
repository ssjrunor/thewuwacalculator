/*
  Author: Runor Ewhro
  description: checks action transitions, counters, and response attribution.
*/

import { describe, expect, it } from 'vitest'
import { advanceEffectState, createEffectState, resolveAction, resolveSwap } from '../events/execute'
import { readFileSync } from 'node:fs'
import { codes } from '../codes'
import type { RuntimeRecord } from '../types'

function replay(rules: RuntimeRecord[], effects: RuntimeRecord = {}, state: RuntimeRecord = {}, teammates: RuntimeRecord[] = [], sonata: RuntimeRecord = {}) {
  const action = (name: string, duration = 0) => ({ name, cast: codes.cast.basic, input: 'basic',
    timing: { duration }, events: [{ id: name, kind: codes.event.cast, at: 0 }] })
  const kit = { resonatorId: 1, mode: 'beta', codes, state, effects, rules,
    actions: { 10: action('Start'), 11: action('Pause'), 12: action('Resume'), 13: action('Follow-up') }, nodeFeatures: {} }
  const kits = [kit, ...teammates.map(teammate => ({ ...kit, ...teammate }))]
  const combat = { mode: 'beta', maxFrames: 1000, members: kits.map(kit => ({ resonatorId: kit.resonatorId, build: { level: 90, sequence: 0 },
    initialControls: {}, weapon: { effects: {}, rules: [] }, echoes: { main: { effects: {}, rules: [] } },
    sonata: { effects: sonata.effects ?? {}, rules: sonata.rules ?? [],
      onFieldEntryEffects: sonata.onFieldEntryEffects ?? [] } })), initialOnFieldResonatorId: 1 }
  return createEffectState(Object.fromEntries(kits.map(kit => [kit.resonatorId, kit])), combat)
}

describe('event transition contracts', () => {
  it('expires a handoff buff and its dependents when its recipient leaves, preserving other pinned effects', () => {
    const fight = replay([{ when: 0, actions: [10], operations: [20, 21, 22].map(effect => ({ op: 'grantEffect', effect, recipient: 'incomingMember' })) }], {
      20: { name: 'Handoff', recipient: 'incomingMember', endsOn: { recipientSwap: true } },
      21: { name: 'Dependent', recipient: 'incomingMember', expiresWith: 20 },
      22: { name: 'Persistent', recipient: 'incomingMember' },
    }, {}, [{ resonatorId: 2, effects: {}, rules: [] }, { resonatorId: 3, effects: {}, rules: [] }])
    resolveSwap(fight, 2, { outro: 'Start', intro: 'Pause' })
    expect(fight.effects.map((effect: RuntimeRecord) => [effect.id, effect.target])).toEqual([[20, 2], [21, 2], [22, 2]])
    resolveSwap(fight, 3)
    expect(fight.effects.map((effect: RuntimeRecord) => [effect.id, effect.target])).toEqual([[22, 2]])
    resolveSwap(fight, 2)
    expect(fight.effects.map((effect: RuntimeRecord) => effect.id)).toEqual([22])
  })

  it('hands a held effect over on a teammate\'s Outro, still owned by the member who queued it', () => {
    const fight = replay([{ when: 0, listenTeam: true, conditions: [{ path: 'event.actor', operator: 'eq', value: 2 }],
      operations: [{ op: 'queueHandoffEffect', effect: 20, frameLimit: 600, from: { path: 'event.actor' } }] }],
    { 20: { name: 'Mist', recipient: 'incomingMember', endsOn: { recipientSwap: true } } }, {},
    [{ resonatorId: 2, effects: {}, rules: [] }, { resonatorId: 3, effects: {}, rules: [] }])
    resolveSwap(fight, 2)
    resolveSwap(fight, 3, { outro: 'Start', intro: 'Pause' })
    expect(fight.effects.map((effect: RuntimeRecord) => [effect.id, effect.owner, effect.target])).toEqual([[20, 1, 3]])
  })

  it('removes swap-expiring effects before the outgoing response is evaluated', () => {
    const fight = replay([{ when: 0, actions: [10], operations: [{ op: 'grantEffect', effect: 20 }] }],
      { 20: { name: 'On-field window', recipient: 'self', endsOn: { recipientSwap: true } } }, {},
      [{ resonatorId: 2, effects: {}, rules: [] }])
    resolveAction(fight, 1, 10)
    resolveSwap(fight, 2, { outro: 'Resume', intro: 'Pause' })
    const removed = fight.trace.findIndex((entry: RuntimeRecord) => entry.type === 'effect' && entry.effectId === 20 && entry.stacks === 0)
    expect(removed).toBeGreaterThan(-1)
    expect(removed).toBeLessThan(fight.trace.findIndex((entry: RuntimeRecord) => entry.type === 'cast' && entry.action === 'Resume'))
  })

  it('resets Lingering Tunes stacks and its cadence on leaving the field', () => {
    const gear = JSON.parse(readFileSync('src/data/rotationGen/gear/triggers.json', 'utf8')).sonatas[9].variants[1]
    const sonata = { effects: gear.effects, rules: gear.rules, onFieldEntryEffects: [gear.onFieldEntryEffect] }
    const fight = replay([], {}, {}, [{ resonatorId: 2, effects: {}, rules: [] }], sonata)
    const stackId = Number(Object.keys(gear.effectControls).find(id => gear.effectControls[id].length))
    resolveAction(fight, 1, 10); advanceEffectState(fight, 360)
    expect(fight.effects.find((effect: RuntimeRecord) => effect.id === stackId)?.stacks).toBe(4)
    resolveSwap(fight, 2)
    expect(fight.effects.find((effect: RuntimeRecord) => effect.id === stackId)).toBeUndefined()
    advanceEffectState(fight, 500); resolveSwap(fight, 1)
    advanceEffectState(fight, 589)
    expect(fight.effects.find((effect: RuntimeRecord) => effect.id === stackId)).toBeUndefined()
    advanceEffectState(fight, 590)
    expect(fight.effects.find((effect: RuntimeRecord) => effect.id === stackId)?.stacks).toBe(1)
  })

  it('shares teammate inflictions across hit phases before reactions are evaluated', () => {
    const fight = replay([{ when: 1, phase: 'afterDebuffs', conditions: [
      { path: 'event.appliedByOwner.20.2', operator: 'gt', value: 0 },
    ], operations: [{ op: 'shield' }] }], {}, {}, [{ resonatorId: 2,
      effects: { 20: { name: 'Teammate marker', maxStacks: 1, recipient: 'self' } }, rules: [
        { when: 1, phase: 'beforeHit', listenTeam: true, operations: [{ op: 'grantEffect', effect: 20 }] },
      ] }])
    fight.members[1].ruleset.actions[10].events.push({ id: 77, kind: 1, index: 0, at: 0, damage: { type: 0 } })
    fight.members[1].ruleset.nodeFeatures[10] = 'test'
    resolveAction(fight, 1, 10); advanceEffectState(fight, 0)
    expect(fight.trace.filter((entry: RuntimeRecord) => entry.type === 'shield').map((entry: RuntimeRecord) => entry.owner)).toEqual([1])
  })
  it('passes snapshotted stack counts into grants', () => {
    const fight = replay([{ when: 0, operations: [
      { op: 'snapshot', key: 'amount', value: 3 },
      { op: 'grantEffect', effect: 20, stacks: { path: 'locals.amount' } },
    ] }], { 20: { name: 'Counted', maxStacks: 5, recipient: 'self' } })
    resolveAction(fight, 1, 10)
    expect(fight.effects[0].stacks).toBe(3)
  })
  it('snapshots a local before later rules change the effect it read', () => {
    const fight = replay([
      { when: 0, operations: [{ op: 'snapshot', key: 'before', value: { path: 'effects.20.stacks', default: 0 } }] },
      { when: 0, operations: [{ op: 'grantEffect', effect: 20 }] },
      { when: 0, conditions: [{ path: 'locals.before', operator: 'eq', value: 0 }], operations: [{ op: 'shield' }] },
    ], { 20: { name: 'Latch', maxStacks: 1, recipient: 'self' } })
    resolveAction(fight, 1, 10)
    resolveAction(fight, 1, 10)
    expect(fight.trace.filter((event: RuntimeRecord) => event.type === 'shield')).toHaveLength(1)
  })

  it('pauses a periodic clock without banking paused frames and retains causal responses', () => {
    const fight = replay([
      { when: 0, actions: [10], operations: [{ op: 'grantEffect', effect: 20 }] },
      { when: 0, actions: [11], operations: [{ op: 'set', path: 'state.paused', value: true }] },
      { when: 0, actions: [12], operations: [{ op: 'set', path: 'state.paused', value: false }] },
    ], { 20: { name: 'Clock', maxStacks: 1, recipient: 'self', duration: 100,
      tick: { intervalFrames: { if: { path: 'state.paused', operator: 'eq', value: true }, then: 0, else: 10 },
        operations: [{ op: 'queueAction', action: 13, delayFrames: 2 }] } } }, { paused: { initial: false } })
    resolveAction(fight, 1, 10)
    advanceEffectState(fight, 5)
    resolveAction(fight, 1, 11)
    advanceEffectState(fight, 25)
    resolveAction(fight, 1, 12)
    advanceEffectState(fight, 32)
    const followups = fight.trace.filter((event: RuntimeRecord) => event.type === 'cast' && event.actionId === 13)
    expect(followups.map((event: RuntimeRecord) => event.frame)).toEqual([32])
    const response = fight.trace.find((event: RuntimeRecord) => event.type === 'response' && event.id === followups[0].responseId)
    expect(response.cause.type).toBe('response')
  })

  it('evaluates null literals and gates unsupported branches by the actual sequence', () => {
    const fight = replay([
      { when: 0, conditions: [{ left: null, operator: 'eq', value: null }], operations: [{ op: 'shield' }] },
      { when: 0, conditions: [{ path: 'progression.sequence', operator: 'gte', value: 6 }], operations: [{ op: 'translationGap', message: 'S6 only' }] },
    ])
    expect(() => resolveAction(fight, 1, 10)).not.toThrow()
    expect(fight.trace.filter((event: RuntimeRecord) => event.type === 'shield')).toHaveLength(1)
  })

  it('counts each Unison Boon granter once and allows it again after expiry', () => {
    const fight = replay([
      { when: 0, actions: [10], operations: [{ op: 'grantUnisonBoon', marker: 20 }] },
      { when: 0, actions: [11], operations: [{ op: 'grantUnisonBoon', marker: 21 }] },
    ])
    fight.frameLimit = 4000
    resolveAction(fight, 1, 10); resolveAction(fight, 1, 10); resolveAction(fight, 1, 11)
    expect(fight.unisonBoon.stacks).toBe(2)
    advanceEffectState(fight, 1800)
    resolveAction(fight, 1, 10)
    expect(fight.unisonBoon.stacks).toBe(1)
  })
})
