/*
  Author: Runor Ewhro
  description: tests a rotation's peak conditions stored on the scored input:
               the card's scenario starts at them, and a run opened by its
               preamble is unaffected by them.
*/

import { describe, expect, it } from 'vitest'
import type { CombatScenario } from '@/domain/entities/combatScenario'
import type { ScenarioInput } from '@/domain/leaderboard/scenarioInput'
import type { RotationNode } from '@/domain/gameData/contracts'
import { ensureResonatorData } from '@/data/gameData'
import { createScenario } from '@/engine/leaderboard'
import { peakControls, withInputPeaks } from '@/engine/leaderboard/peakControls'
import { computeShowcaseStats } from '@/engine/evaluation/showcaseStats'
import { executeCombatScenarioProgram, prepareCombatScenario } from '@/engine/pipeline/combatScenario'
import { sumRotTtls } from '@/engine/pipeline/rotationTotals'
import { mkActRt, mkPartRtLkp } from '@/engine/runtime/runtimeAdapters'
import { makeEnemy } from '@/engine/runtime/defaults'

const echoes = [{ uid: 'e0', id: '6000199', set: 30, mainEcho: true,
  mainStats: { primary: { key: 'critDmg', value: 44 }, secondary: { key: 'atkFlat', value: 150 } }, substats: {} }]
const input: ScenarioInput = { v: 1, scenarioId: 'peak', teamId: 't', scoredSlot: 0, enemy: makeEnemy(), members: [
  { slot: 0, resonatorId: '1507', role: 'scored', mode: null, sequence: 0, weapon: { id: '21040036', rank: 1 }, echoes },
] }

const STACK = 'resonator:1507:nightfall_blaze:value'
const TOGGLE = 'weapon:21040036:passive:active'
const set = (id: string, key: string, value: number | boolean): RotationNode =>
  ({ id, type: 'condition', resonatorId: '1507', changes: [{ type: 'set', path: `runtime.state.controls.${key}`, value }] })
// the run snapshots state at each hit, so a value counts once a hit reads it
const hit = (id: string): RotationNode => ({ id, type: 'feature', resonatorId: '1507', featureId: 'damage:1507036', multiplier: 1 })
// the preamble writes every state first, as generated programs do.
const program: RotationNode[] = [set('p1', STACK, 0), set('p2', TOGGLE, false),
  set('a', STACK, 30), set('b', TOGGLE, true), hit('h1'),
  set('c', STACK, 10), set('d', TOGGLE, false), set('e', STACK, 60), set('f', STACK, 5), hit('h2')]

const withProgram = (scenario: CombatScenario): CombatScenario => ({ ...scenario, program: { ...scenario.program, program } })
const combat = (s: CombatScenario) => computeShowcaseStats({ runtime: mkActRt(s)!, runtimesById: mkPartRtLkp(s), enemy: s.target, selectedTargets: {} })
const damage = (s: CombatScenario) => sumRotTtls(executeCombatScenarioProgram(prepareCombatScenario(s), program)!.entries).avg

describe('peak controls', () => {
  it('keeps each control at the highest value a hit saw', async () => {
    await ensureResonatorData(['1507'])
    const peaks = peakControls(withProgram(createScenario(input)))['1507']
    // the stack rises to 30 and falls back; 60 is set and cleared before any hit reads it
    expect(peaks[STACK]).toBe(30)
    // on for the first hit, off for the second.
    expect(peaks[TOGGLE]).toBe(true)
  }, 60_000)

  it('starts the card scenario at the peaks while the run itself scores the same', async () => {
    await ensureResonatorData(['1507'])
    const bare = withProgram(createScenario(input))
    const kept = withInputPeaks(input, peakControls(bare))
    expect(kept.members[0].controls).toMatchObject({ [STACK]: 30, [TOGGLE]: true })
    const seeded = withProgram(createScenario(kept))
    expect(mkActRt(seeded)!.state.controls[TOGGLE]).toBe(true)
    expect(combat(seeded)).not.toEqual(combat(bare))
    // the preamble writes every state before the first hit, so the seeded start leaves the run unchanged
    expect(damage(seeded)).toBe(damage(bare))
  }, 60_000)
})
