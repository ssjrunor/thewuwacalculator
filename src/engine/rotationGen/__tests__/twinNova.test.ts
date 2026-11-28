/*
  Author: Runor Ewhro
  description: checks paired Echo selection, owner-local stack lifetimes and recorded channel hits through the
               generator's replay.
*/

import { describe, expect, it } from 'vitest'
import { createGearLibrary, prepareEquipment } from '../gear'
import { codes } from '../codes'
import { advanceEffectState, createEffectState, playCast, playSwap, resolveAction } from '../events/execute'
import { playTimeline } from '../events/timeline'
import type { RuntimeRecord } from '../types'
import gear from '@/data/rotationGen/gear/triggers.json'

function setup(id = 6000179, paired = true) {
  const other = id === 6000179 ? 6000180 : 6000179
  const equipment = prepareEquipment({
    loadout: { echoes: [{ id: String(id), set: 26, mainEcho: true },
      ...(paired ? [{ id: String(other), set: 26, mainEcho: false }] : [])],
    weapon: { id: '21020086', rank: 1, level: 90 } },
    echoCatalog: [id, other].map(id => ({ id: String(id), sets: [26] })),
    weaponBundle: { weapon: { statKey: 'critRate', statsByLevel: { 90: { secondaryStatValue: 24.3 } } } },
    gearLibrary: createGearLibrary(gear),
  })
  // isolate Echo rules, retaining the real prepared equipment and paired selection
  equipment.weapon = { effects: {}, rules: [] }
  equipment.sonata = { effects: {}, rules: [] }
  const action = (name: string, cast: number) => ({ name, input: cast === 0 ? 'basic' : 'skill', cast,
    timing: { duration: 0 }, events: [{ id: cast + 1, kind: 0, at: 0 }] })
  const kit = { resonatorId: 1, mode: 'beta', codes, state: {}, effects: {}, rules: [],
    actions: { 10: action('Basic', 0), 11: action('Skill', 2) }, nodeFeatures: {} }
  const member = { resonatorId: 1, build: { level: 90, sequence: 0 }, initialControls: {}, ...equipment }
  const combat: RuntimeRecord = { mode: 'beta', maxFrames: 2000, target: {}, initialOnFieldResonatorId: 1,
    members: [member, { ...structuredClone(member), resonatorId: 2 }] }
  const kits: RuntimeRecord = { 1: kit, 2: { ...structuredClone(kit), resonatorId: 2 } }
  const fight = createEffectState(kits, combat)
  const main = member.echoes.main
  const stackId = Number(Object.keys(main.effects)[0])
  const stacks = (owner = 1) => fight.effects.find((effect: RuntimeRecord) =>
    effect.owner === owner && effect.id === stackId && effect.until > fight.frame)?.stacks ?? 0
  return { fight, main, stacks, kits, combat }
}

describe('Twin Nova rotation generation', () => {
  it.each([6000179, 6000180])('gains 1/3 stacks per Basic/Skill cast, caps at six and refreshes eight seconds (%s)', id => {
    const { fight, stacks } = setup(id)
    resolveAction(fight, 1, 10); expect(stacks()).toBe(1)
    resolveAction(fight, 1, 11); expect(stacks()).toBe(4)
    advanceEffectState(fight, 479)
    resolveAction(fight, 1, 11); expect(stacks()).toBe(6)
    expect(stacks(2)).toBe(0)
    advanceEffectState(fight, 958); expect(stacks()).toBe(6)
    advanceEffectState(fight, 959); expect(stacks()).toBe(0)
  })

  it.each([6000179, 6000180])('alternates generic recorded casts from its equipped form, with one main Echo identity (%s)', id => {
    const { combat, kits } = setup(id)
    const { state } = playTimeline(kits, combat, { seconds: 20, events: [
      [0, 'cast', 0, 'Skill', 0], [1, 'cast', 0, '#echo', 0],
      [400, 'cast', 0, '#echo', 0], [800, 'cast', 0, '#echo', 0],
    ] }, new Set(), new Set())
    expect(state.trace.filter((row: RuntimeRecord) => row.type === 'cast' && row.action.startsWith('Twin Nova'))
      .map((row: RuntimeRecord) => row.action)).toEqual(id === 6000179
      ? ['Twin Nova: Nebulous Cannon', 'Twin Nova: Collapsar Blade', 'Twin Nova: Nebulous Cannon']
      : ['Twin Nova: Collapsar Blade', 'Twin Nova: Nebulous Cannon', 'Twin Nova: Collapsar Blade'])
    expect(combat.members[0].echoes.main.id).toBe(id)
    expect((Object.values(combat.members[0].echoes.main.actions) as RuntimeRecord[]).flatMap((action: RuntimeRecord) =>
      action.events.filter((event: RuntimeRecord) => event.damage).map((event: RuntimeRecord) => event.element)))
      .toEqual([320, 320])
  })

  it.each([6000179, 6000180])('has no pair rules, stacks or alternate form without its sibling (%s)', id => {
    const { fight, main, stacks } = setup(id, false)
    resolveAction(fight, 1, 11)
    expect(stacks()).toBe(0)
    expect(main.rules).toEqual([])
    expect(Object.keys(main.actions)).toHaveLength(1)
    expect(main.action.timing.charges).toBe(1)
  })

  it('clears after the final Cannon hit, and an interrupted tail leaves a later gain', () => {
    const { fight, main, stacks } = setup()
    resolveAction(fight, 1, 11)
    playCast(fight, 1, main.actionId, 2)
    advanceEffectState(fight, 32); expect(stacks()).toBe(3)
    advanceEffectState(fight, 38); expect(stacks()).toBe(0)
    resolveAction(fight, 1, 11)
    playCast(fight, 1, main.actionId, 2)
    advanceEffectState(fight, 50)
    resolveAction(fight, 1, 10)
    expect(stacks()).toBe(1)
    advanceEffectState(fight, 76)
    expect(stacks()).toBe(1)
    expect(fight.trace.filter((row: RuntimeRecord) => row.type === 'hit' && row.frame > 50)
      .map((row: RuntimeRecord) => row.frame)).toEqual([70])
  })

  it('preserves stacks on ordinary swaps, but ends a running transformation on swap', () => {
    const { fight, main, stacks } = setup()
    resolveAction(fight, 1, 11)
    playSwap(fight, 2); expect(stacks()).toBe(3)
    playSwap(fight, 1)
    resolveAction(fight, 1, main.actionId)
    playSwap(fight, 2); expect(stacks()).toBe(0)
    advanceEffectState(fight, 38)
    expect(fight.trace.filter((row: RuntimeRecord) => row.type === 'hit')
      .map((row: RuntimeRecord) => row.frame)).toEqual([11, 32])
  })

  it('uses captured channel ticks and rejects unknown ticks only when hit-triggered effects require them', () => {
    const { fight, main } = setup(6000180)
    fight.members[1].source.weapon.rules.push({ id: 999, when: 1,
      conditions: [{ path: 'event.cast', operator: 'eq', value: 6 }], operations: [] })
    expect(() => resolveAction(fight, 1, main.actionId)).toThrow(/event timing\/count/)
    playCast(fight, 1, main.actionId, 2, undefined, undefined, [3, 7], undefined, [10, 20])
    advanceEffectState(fight, 20)
    const hits = fight.trace.filter((row: RuntimeRecord) => row.type === 'hit')
    expect(hits.map((row: RuntimeRecord) => row.frame)).toEqual([10, 20])
    expect(main.actions[main.actionId].events.filter((event: RuntimeRecord) => event.damage)
      .map((event: RuntimeRecord) => event.element)).toEqual([320, 320])
    resolveAction(fight, 1, main.actionId) // the next paired form is the timed Cannon
    expect(() => resolveAction(fight, 1, main.actionId)).toThrow(/event timing\/count/)
  })

  it('treats both paired forms as one named Echo for distinct-cast bonuses', () => {
    const { combat, kits, main } = setup()
    combat.members[0].sonata = createGearLibrary(gear).module('sonata', 21, 3)
    const fight = createEffectState(kits, combat)
    playCast(fight, 1, main.actionId, 0)
    advanceEffectState(fight, 38)
    const alternate = fight.members[1].gearFlags.nextEchoAction
    playCast(fight, 1, alternate, 0)
    const echoStacks = Object.keys(combat.members[0].sonata.effects).find(id =>
      combat.members[0].sonata.effectControls[id]?.[0]?.[1] === 'stacks')
    expect(fight.effects.find((effect: RuntimeRecord) => String(effect.id) === echoStacks)?.stacks).toBe(1)
  })
})
