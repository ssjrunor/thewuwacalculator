/*
  Author: Runor Ewhro
  description: checks authored effects against their generated editor bindings.
*/

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createEffectState, resolveAction, advanceEffectState } from '../events/execute'
import { codes } from '../codes'
import { validateCharacterRules } from '../validateCharacterRules'

describe('effect audit regressions', () => {
  it('rejects comparisons whose dynamic input disappeared during conversion', () => {
    expect(() => validateCharacterRules({ schemaVersion: 2, resonatorId: 1, actions: {},
      effects: {}, state: {}, nodeFeatures: {}, rules: [{ conditions: [{ operator: 'eq', value: 'Lucy' }] }] }))
      .toThrow(/Unresolved comparison/)
  })

  it('preserves the action node classification used by mode-changing callbacks', () => {
    const kit = { resonatorId: 1, mode: 'beta', codes, state: {}, effects: {},
      rules: [{ when: 0, conditions: [{ path: 'event.node', operator: 'eq', value: 1 }],
        operations: [{ op: 'shield' }] }], nodeFeatures: {}, actions: {
        10: { name: 'Normal', cast: 0, node: 0, timing: { duration: 0 }, events: [{ kind: 0, at: 0 }] },
        11: { name: 'Forte', cast: 0, node: 1, timing: { duration: 0 }, events: [{ kind: 0, at: 0 }] },
      } }
    const fight = createEffectState({ 1: kit }, { mode: 'beta', maxFrames: 100, initialOnFieldResonatorId: 1,
      members: [{ resonatorId: 1, build: { level: 90, sequence: 0 }, initialControls: {},
        weapon: { effects: {}, rules: [] }, echoes: { main: { effects: {}, rules: [] } }, sonata: { effects: {}, rules: [] } }] })
    resolveAction(fight, 1, 10); resolveAction(fight, 1, 11)
    expect(fight.trace.filter((row: { type: string }) => row.type === 'shield')).toHaveLength(1)
  })

  it('delivers a teammate Tune Break to Lynae and Mornye response callbacks', () => {
    const load = (id: number) => ({ ...JSON.parse(readFileSync(`src/data/rotationGen/characters/${id}.json`, 'utf8')), mode: 'beta', codes })
    const rules = { resonatorId: 1, mode: 'beta', codes, state: {}, effects: {}, rules: [],
      actions: { 10: { name: 'Tune Break', cast: 8, timing: { duration: 1 }, events: [
        { id: 11, kind: 1, index: 0, at: 0, damage: { type: 7 } },
      ] } }, nodeFeatures: { 10: 'test-break' } }
    const kits = [rules, load(1209), load(1509)]
    const members = kits.map(kit => ({ resonatorId: kit.resonatorId, build: { level: 90, sequence: 0 },
      initialControls: {}, initialState: { mode: 'tuneRupture' }, weapon: { effects: {}, rules: [] },
      echoes: { main: { effects: {}, rules: [] } }, sonata: { effects: {}, rules: [] } }))
    const fight = createEffectState(Object.fromEntries(kits.map(kit => [kit.resonatorId, kit])), {
      mode: 'beta', maxFrames: 1000, members, initialOnFieldResonatorId: 1,
      initialEnemy: { tuneRuptureShifting: true },
    })
    resolveAction(fight, 1, 10); advanceEffectState(fight, 100)
    const casts = fight.trace.filter((row: { type: string }) => row.type === 'cast')
    expect(casts.some((row: { owner: number, actionId: number }) => row.owner === 1209 && row.actionId === 3386583488606014)).toBe(true)
    expect(casts.some((row: { owner: number, actionId: number }) => row.owner === 1509 && row.actionId === 3459681097534104)).toBe(true)
  })
})
