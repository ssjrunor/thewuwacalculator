/*
  Author: Runor Ewhro
  description: checks Off-Tune buildup, break inputs, and shifting responses.
*/

import { describe, expect, it } from 'vitest'
import { advanceEffectState, createEffectState, maybeTuneBreak, resolveAction } from '../events/execute'
import { withTuneBreak } from '../events/offTune'
import { codes } from '../codes'
import type { RuntimeRecord } from '../types'

// one member whose press lands a single 20 Off-Tune hit, on a class 4 target (a 39.2 bar)
function replay() {
  const press = { name: 'Press', cast: codes.cast.basic, input: 'basic', timing: { duration: 10 },
    events: [{ id: 76, kind: codes.event.cast, at: 0 }, { id: 77, kind: codes.event.hit, index: 0, at: 0, damage: { type: 0 } }] }
  const kit = withTuneBreak({ resonatorId: 1, mode: 'beta', codes, state: {}, effects: {}, rules: [],
    actions: { 10: press }, nodeFeatures: { 10: 'press' } }, 2)
  const combat = { mode: 'beta', maxFrames: 4000, target: { class: 4 }, initialOnFieldResonatorId: 1,
    members: [{ resonatorId: 1, build: { level: 90, sequence: 0 }, initialControls: {},
      offTuneByAction: { 10: { 77: 20 } }, buildupRateEffects: [],
      weapon: { effects: {}, rules: [] }, echoes: { main: { effects: {}, rules: [] } },
      sonata: { effects: {}, rules: [], onFieldEntryEffects: [] } }] }
  return createEffectState({ 1: kit }, combat)
}

const press = (fight: RuntimeRecord) => {
  advanceEffectState(fight, Math.max(fight.frame, fight.readyAt ?? 0))
  resolveAction(fight, 1, 10)
  advanceEffectState(fight, fight.frame)
}

describe('automatic Tune Break', () => {
  it('breaks once the bar is full, only behind a cut that leaves an opening', () => {
    const fight = replay()
    press(fight)
    expect(fight.offTune.value).toBe(20)
    expect(maybeTuneBreak(fight, 1, 10)).toBe(false)
    press(fight)
    expect(fight.offTune.value).toBeCloseTo(fight.offTune.max)
    expect(maybeTuneBreak(fight, 1, 10, 'hold cancel')).toBe(false)
    expect(maybeTuneBreak(fight, 1, 10, 'cancel')).toBe(true)
    expect(fight.offTune.value).toBe(0)
    expect(fight.trace.filter((entry: RuntimeRecord) => entry.type === 'cast' && entry.actionId === fight.members[1].ruleset.tuneBreakAction))
      .toHaveLength(1)
  })

  it('discards what is built during the Tune Break Cooldown', () => {
    const fight = replay()
    press(fight); press(fight)
    maybeTuneBreak(fight, 1, 10)
    press(fight)
    expect(fight.offTune.value).toBe(0)
    advanceEffectState(fight, fight.offTune.blockedUntil)
    press(fight)
    expect(fight.offTune.value).toBe(20)
  })
})
