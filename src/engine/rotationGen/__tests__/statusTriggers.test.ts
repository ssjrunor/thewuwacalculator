/*
  Author: Runor Ewhro
  description: checks status attribution, trigger conditions, and repeated applications.
*/

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { advanceEffectState, createEffectState, resolveAction, resolveSwap } from '../events/execute'
import { codes } from '../codes'
import type { RuntimeRecord } from '../types'

function chisaFight(sequence = 0) {
  const kit = JSON.parse(readFileSync('src/data/rotationGen/characters/1508.json', 'utf8'))
  kit.mode = 'beta'; kit.codes = codes
  const gear = JSON.parse(readFileSync('src/data/rotationGen/gear/triggers.json', 'utf8')).weapons[21010056].variants[0]
  const ally = { resonatorId: 2, mode: 'beta', codes, state: {}, effects: {}, rules: [], nodeFeatures: { 10: 'ally-attack' }, actions: {
    10: { name: 'Ally attack', cast: codes.cast.basic, timing: { duration: 120 }, events: [
      { id: 11, kind: codes.event.hit, at: 0, index: 0, damage: { type: codes.damage.basic } },
    ] },
  } }
  const members = [kit, ally].map(rules => ({ resonatorId: rules.resonatorId,
    build: { level: 90, sequence }, initialControls: {},
    weapon: rules === kit ? gear : { effects: {}, rules: [] },
    echoes: { main: { effects: {}, rules: [] } }, sonata: { effects: {}, rules: [] } }))
  const fight = createEffectState({ 1508: kit, 2: ally }, { mode: 'beta', maxFrames: 4000,
    members, initialOnFieldResonatorId: 1508 })
  const cast = (name: string) => resolveAction(fight, 1508,
    Number(Object.keys(kit.actions).find(id => kit.actions[id].name === name)))
  return { fight, kit, gear, cast }
}

describe('negative status triggers', () => {
  it('does not turn ordinary teammate hits into inflictions without Unseen Snare', () => {
    const { fight, gear, cast } = chisaFight()
    cast('Intro - Reverberance - Return')
    advanceEffectState(fight, 120)
    resolveSwap(fight, 2)
    resolveAction(fight, 2, 10)
    advanceEffectState(fight, 240)
    const bonusId = Number(Object.keys(gear.effects).find(id => gear.effects[id].name.includes('Attribute')))
    expect(fight.enemy.havocBane ?? 0).toBe(0)
    expect(fight.effects.some((row: RuntimeRecord) => row.id === bonusId)).toBe(false)
  })

  it('awards Thread of Bane only to the credited inflictor', () => {
    const { fight, kit, cast } = chisaFight()
    cast('Skill - Eye of Unraveling')
    advanceEffectState(fight, 20)
    cast('Outro - Unraveling - Law Zero')
    advanceEffectState(fight, 140)
    resolveSwap(fight, 2)
    resolveAction(fight, 2, 10)
    advanceEffectState(fight, 260)
    const threadId = Number(Object.keys(kit.effects).find(id => kit.effects[id].name === 'Chisa: Thread of Bane'))
    expect(fight.effects.filter((row: RuntimeRecord) => row.id === threadId)
      .map((row: RuntimeRecord) => row.target)).toEqual([1508])
  })

  it.each([[0, 120], [4, 60]])('inflicts Chisa-owned Havoc Bane and triggers Kumokiri at S%i', (sequence, cooldown) => {
    const { fight, gear, cast } = chisaFight(sequence)
    cast('Intro - Reverberance - Return')
    advanceEffectState(fight, 120)
    cast('Skill - Eye of Unraveling')
    advanceEffectState(fight, 140)
    resolveSwap(fight, 2)
    for (let i = 0; i < 4; i++) {
      resolveAction(fight, 2, 10)
      advanceEffectState(fight, fight.frame + cooldown)
    }
    const bane = fight.trace.filter((row: RuntimeRecord) => row.type === 'status' && row.status === 'havocBane')
    expect(bane.length).toBeGreaterThanOrEqual(3)
    expect(bane.every((row: RuntimeRecord) => row.owner === 1508)).toBe(true)
    expect(fight.enemy.havocBane).toBe(3)
    const stackId = Number(Object.keys(gear.effects).find(id => gear.effects[id].maxStacks === 3))
    const bonusId = Number(Object.keys(gear.effects).find(id => gear.effects[id].name.includes('Attribute')))
    expect(fight.effects.find((row: RuntimeRecord) => row.id === stackId)?.stacks).toBe(3)
    expect(fight.effects.some((row: RuntimeRecord) => row.id === bonusId)).toBe(true)
    const gains = bane.filter((row: RuntimeRecord, index: number) => !index || row.stacks > bane[index - 1].stacks)
    expect(gains.every((row: RuntimeRecord, index: number) => !index || row.frame - gains[index - 1].frame >= cooldown)).toBe(true)
  })
})
