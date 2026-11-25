/*
  Author: Runor Ewhro
  description: tests rover form binding: resolving each element to one form and
               rewriting resonator references in action plans and timelines.
*/

import { describe, expect, it } from 'vitest'
import { bindResonatorReferences, mapResonatorNamespaces, roverIdentityResolver } from '../../entities/roverIdentityBinding'
import { bindActionPlanIdentities, bindTimelineIdentities } from '../identityBinding'
import type { ActionPlan, ActionTimeline } from '../types'

describe('Rover form binding', () => {
  it('binds every pair independently and rejects duplicate forms of one combat identity', () => {
    const resolve = roverIdentityResolver(['1501', '1605', '1310', '1408'])
    expect(['1502', '1604', '1309', '1406'].map(resolve)).toEqual(['1501', '1605', '1310', '1408'])
    expect(mapResonatorNamespaces('runtime.state.controls.team:1406:storms_echo:active', resolve))
      .toBe('runtime.state.controls.team:1408:storms_echo:active')
    expect(() => roverIdentityResolver(['1406', '1408'])).toThrow('Both Rover forms')
  })

  it('binds teammate predicates, control paths and source references without rewriting opaque identifiers or counters', () => {
    const source = { resonatorId: 1311, source: { type: 'resonator', id: '1309' },
      rules: [{ id: 'opaque:1309:rule', actions: [1309], conditions: [
        { path: 'actorMember.resonator.id', operator: 'eq', value: 1309 },
        { left: { path: 'event.owner' }, operator: 'eq', value: '1406' },
        { path: 'state.counter', operator: 'eq', value: 1309 },
      ], operations: [{ op: 'setControl', path: 'runtime.state.controls.team:1309:buff:active', value: true },
        { op: 'grantEffect', effect: 'effect:1309:opaque', source: 1309 }] }],
      actions: { 'action:1309:opaque': { id: 1309, timing: { duration: 1309 } } },
      effects: { 'effect:1309:opaque': { expiresWith: 'effect:1309:other', name: 'Label 1309' } },
      nodeFeatures: { 'action:1309:opaque': ['1309001', '1309:outro'] } }
    const before = structuredClone(source), bound = bindResonatorReferences(source, roverIdentityResolver(['1310', '1408']))
    expect(source).toEqual(before)
    expect(bound.source.id).toBe('1310')
    expect(bound.rules[0]!.conditions.map(condition => condition.value)).toEqual([1310, '1408', 1309])
    expect(bound.rules[0]!.operations).toEqual([
      { op: 'setControl', path: 'runtime.state.controls.team:1310:buff:active', value: true },
      { op: 'grantEffect', effect: 'effect:1309:opaque', source: 1310 },
    ])
    expect(bound.actions).toEqual(source.actions)
    expect(bound.effects).toEqual(source.effects)
    expect(bound.rules[0]!.id).toBe(source.rules[0]!.id)
    expect(bound.rules[0]!.actions).toEqual([1309])
    expect(bound.nodeFeatures['action:1309:opaque']).toEqual(['1309001', '1310:outro'])
  })

  it('binds plan ownership and exact timeline fields while retaining source order and actor seats', () => {
    const resolve = roverIdentityResolver(['1408', '1501'])
    const plan = { team: [{ resonatorId: '1406' }, { resonatorId: '1502' }], actions: {
      'opaque:1406:action': { kind: 'resonator', resonatorId: '1406', sourceName: 'Aero 1406' },
    }, timelines: { owns: { 1406: ['Realm'], 1502: ['Shimmer'] }, names: ['opaque:1406:action'], runs: {} } } as unknown as ActionPlan
    const bound = bindActionPlanIdentities(plan, resolve)
    expect(bound.timelines!.owns).toEqual({ 1408: ['Realm'], 1501: ['Shimmer'] })
    expect(bound.team.map(member => member.resonatorId)).toEqual(['1408', '1501'])
    expect(bound.actions['opaque:1406:action']).toEqual({ kind: 'resonator', resonatorId: '1408', sourceName: 'Aero 1406' })
    const timeline: ActionTimeline = { seconds: 1, events: [
      [0, 'state', 0, 'Realm', 1, -1],
      [0, 'control', 'runtime.state.controls.team:1406:storms_echo:active', 1],
      [0, 'control', 'runtime.rotation.activeResonatorId', 1406],
      [0, 'hitControl', 0, 'Aero 1406', 0, 1, 'runtime.state.controls.sequence:1502:s1:active', 'true'],
      [0, 'hitControl', 0, 'Aero 1406', 1, 0, 'runtime.rotation.activeResonatorId', '"1406"'],
      [0, 'hitInfliction', 0, 'Aero 1406', 1, 0, 'aeroErosion', 4],
    ] }
    const mapped = bindTimelineIdentities(timeline, resolve)
    expect(mapped.events[1]).toEqual([0, 'control', 'runtime.state.controls.team:1408:storms_echo:active', 1])
    expect(mapped.events[2]).toEqual([0, 'control', 'runtime.rotation.activeResonatorId', 1408])
    expect(mapped.events[3]).toEqual([0, 'hitControl', 0, 'Aero 1406', 0, 1, 'runtime.state.controls.sequence:1501:s1:active', 'true'])
    expect(mapped.events[4]?.[7]).toBe('"1408"')
    expect(mapped.events[5]).toEqual(timeline.events[5])
    expect(timeline.events[1]?.[2]).toContain('1406')
  })
})
