/*
  Author: Runor Ewhro
  description: invariants for the leaderboard energy regen repair: it reaches
               the requirement inside the build's own budget, goes past the budget
               (paid tier for tier) only when the budget cannot reach it, adds no
               damage to a kit that does not convert energy regen, and marks a
               build short when the requirement is unreachable.
*/

import { describe, expect, it } from 'vitest'
import { getEchoById, listChsByCos } from '@/data/catalog/echoCatalogService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listResRttn } from '@/data/catalog/gameDataService'
import { ECHO_SIDE_STATS, getSbstStepP } from '@/data/gameData/catalog/echoStats'
import type { EchoInstance } from '@/domain/entities/runtime'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import { makeResRuntime } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { maxEchoStts } from '@/engine/runtime/sourceStateInit'
import { applyEvaluationAsm, EVALUATION_ENEMY } from '@/engine/evaluation/evaluationAssumptions'
import { evaluateProgramDamage } from '@/engine/evaluation/report.ts'
import { anchorErRequirement, anchorStateFor } from '@/engine/leaderboard/offlineAnchors'
import type { ScenarioAnchorsFile } from '@/domain/leaderboard/ruleset'

const RESONATOR = '1108'
const SET = 30

// a full build with no energy regen anywhere: every echo rolls five lines, mid tiers.
const SUBSTATS: Array<Record<string, number>> = [
  { critRate: 8.1, critDmg: 16.2, atkPercent: 8.6, basicAtk: 7.9, hpFlat: 430 },
  { critRate: 7.5, critDmg: 17.4, atkPercent: 9.4, defPercent: 10.9, heavyAtk: 7.1 },
  { critRate: 8.7, critDmg: 15, atkFlat: 40, resonanceSkill: 8.6, hpPercent: 7.9 },
  { critRate: 6.9, critDmg: 13.8, atkPercent: 7.9, resonanceLiberation: 9.4, defFlat: 50 },
  { critRate: 9.3, critDmg: 18.6, atkPercent: 7.1, basicAtk: 8.6, hpFlat: 390 },
]

function setup(substats: Array<Record<string, number>> = SUBSTATS) {
  const seed = getResSeedBy(RESONATOR)!
  let runtime = applyEvaluationAsm(makeResRuntime(seed))
  const used = new Set<string>()
  runtime.build.echoes = [4, 3, 3, 1, 1].map((cost, slot): EchoInstance => {
    const echo = listChsByCos(cost).find((entry) => entry.sets.includes(SET) && !used.has(entry.id))!
    used.add(echo.id)
    const primary = cost === 4 ? { key: 'critDmg', value: 44 } : { key: 'atkPercent', value: cost === 3 ? 30 : 18 }
    return { uid: `er-repair-${slot}`, id: echo.id, set: SET, mainEcho: slot === 0,
      mainStats: { primary, secondary: { ...ECHO_SIDE_STATS[cost] } }, substats: { ...substats[slot] } }
  })
  runtime = maxEchoStts(runtime)
  const input = { scenarioId: combatScenarioId('evaluation:er-repair'), memberId: teamMemberId(runtime.id), runtime,
    enemy: EVALUATION_ENEMY, runtimesById: makeRuntimeMap(runtime) }
  const items = (seed.rotations?.[0] ?? listResRttn(runtime.id)[0]).items
  return { input, program: { items }, echoes: runtime.build.echoes }
}

const tierSum = (echo: EchoInstance) => Object.entries(echo.substats)
  .reduce((sum, [key, value]) => sum + getSbstStepP(key).indexOf(value), 0)
// total tiers of a build's lines, counting each line at least as its lowest tier
const notches = (echoes: Array<EchoInstance | null>) => echoes.reduce((sum, echo) => sum + (echo
  ? Object.entries(echo.substats).reduce((own, [key, value]) => own + getSbstStepP(key).indexOf(value) + 1, 0) : 0), 0)
// the same build with every line at its lowest tier: nothing inside the budget can pay for a tier.
const LOWEST = SUBSTATS.map((lines) => Object.fromEntries(Object.keys(lines).map((key) => [key, getSbstStepP(key)[0]])))

describe('energy regen repair', () => {
  const { input, program, echoes } = setup()
  const own = evaluateProgramDamage(input, program)!

  it('leaves a build that carries its requirement alone', () => {
    expect(own.repair).toBeNull()
    const met = evaluateProgramDamage(input, program, { target: own.energyRegen, below: own.energyRegen - 0.2 })!
    expect(met).toEqual(own)
  }, 60_000)

  it('repairs within each echo: same lines, same tier steps, energy regen reached, no damage gained', () => {
    const target = own.energyRegen + 20
    const repaired = evaluateProgramDamage(input, program, { target, below: target - 0.2 })!
    const result = repaired.repair!
    expect(result.repair.short).toBe(false)
    expect(result.repair.overBudget).toBe(0)
    expect(result.repair.from).toBeCloseTo(own.energyRegen, 4)
    expect(repaired.energyRegen).toBeGreaterThanOrEqual(target - 1e-4)
    expect(result.repair.to).toBe(repaired.energyRegen)
    expect(repaired.damage).toBeLessThanOrEqual(own.damage)
    result.echoes.forEach((echo, slot) => {
      const before = echoes[slot]!
      expect(Object.keys(echo!.substats)).toHaveLength(Object.keys(before.substats).length)
      expect(tierSum(echo!)).toBe(tierSum(before))
      for (const [key, value] of Object.entries(echo!.substats)) expect(getSbstStepP(key)).toContain(value)
    })
    // the record lists exactly what differs.
    for (const line of result.repair.lines) {
      expect(echoes[line.slot]!.substats[line.key] ?? null).toBe(line.from)
      expect(result.echoes[line.slot]!.substats[line.key] ?? null).toBe(line.to)
    }
    expect(result.repair.lines.some((line) => line.key === 'energyRegen' && line.from === null)).toBe(true)
  }, 120_000)

  it('swaps a 3-cost main stat to energy regen when substats alone cannot reach the requirement', () => {
    // five energy regen lines at their top tier give 62, so the rest needs a main stat
    const target = own.energyRegen + 70
    const repaired = evaluateProgramDamage(input, program, { target, below: target - 0.2 })!
    const result = repaired.repair!
    expect(result.repair.short).toBe(false)
    expect(result.repair.mains.length).toBeGreaterThanOrEqual(1)
    for (const main of result.repair.mains) {
      expect(getEchoById(echoes[main.slot]!.id)?.cost).toBe(3)
      expect(result.echoes[main.slot]!.mainStats.primary).toEqual(main.to)
      expect(main.to.key).toBe('energyRegen')
    }
    expect(repaired.energyRegen).toBeGreaterThanOrEqual(target - 1e-4)
    result.echoes.forEach((echo, slot) => expect(tierSum(echo!)).toBe(tierSum(echoes[slot]!)))
  }, 120_000)

  it('goes past the budget only when the budget cannot reach, paying tier for tier', () => {
    const low = setup(LOWEST)
    const base = evaluateProgramDamage(low.input, low.program)!
    // five lowest energy regen lines (34) and both 3-cost mains (64) fall short; top lines (62) would not.
    const target = base.energyRegen + 100
    const repaired = evaluateProgramDamage(low.input, low.program, { target, below: target - 0.2 })!
    const result = repaired.repair!
    expect(result.repair.short).toBe(false)
    expect(result.repair.overBudget).toBeGreaterThan(0)
    expect(repaired.energyRegen).toBeGreaterThanOrEqual(target - 1e-4)
    expect(repaired.damage).toBeLessThanOrEqual(base.damage)
    expect(notches(result.echoes)).toBe(notches(low.echoes))
    result.echoes.forEach((echo) => {
      expect(Object.keys(echo!.substats).length).toBeLessThanOrEqual(5)
      for (const [key, value] of Object.entries(echo!.substats)) expect(getSbstStepP(key)).toContain(value)
    })
    // inside the budget the same build reaches what its lowest lines and mains provide
    const inside = evaluateProgramDamage(low.input, low.program, { target: base.energyRegen + 90, below: base.energyRegen + 89.8 })!
    expect(inside.repair!.repair).toMatchObject({ short: false, overBudget: 0 })
  }, 240_000)

  it('is short when no repair reaches the requirement, inside the budget or past it', () => {
    const target = own.energyRegen + 300
    const repaired = evaluateProgramDamage(input, program, { target, below: target - 0.2 })!
    expect(repaired.repair!.repair).toMatchObject({ short: true, from: repaired.energyRegen, to: repaired.energyRegen,
      lines: [], mains: [] })
    expect(repaired.damage).toBe(own.damage)
    expect(repaired.repair!.echoes).toBe(input.runtime.build.echoes)
  }, 120_000)
})

describe('anchor state choice', () => {
  const state = (er: number | null) => ({ er, baseline: 1, bench: 2, perfect: 3, exact: true })
  const file = (mode: ScenarioAnchorsFile['mode'], states: ReturnType<typeof state>[], floor?: number | null): ScenarioAnchorsFile =>
    ({ schema: 1, scenario: 'x:t:w', mode, sequences: { 0: { states, ...(floor !== undefined ? { floor } : {}) } } })

  it('takes need cases at their lowest state, past float noise only', () => {
    const requirement = anchorErRequirement(file('need', [state(126), state(125.6), state(126.4)]), 0)!
    expect(requirement.target).toBe(125.6)
    expect(requirement.below).toBeCloseTo(125.6 - 1e-4, 9)
  })
  it('takes search cases at their floor, and none without one', () => {
    expect(anchorErRequirement(file('search', [state(null)], 123.31), 0)?.target).toBe(123.31)
    expect(anchorErRequirement(file('search', [state(null)]), 0)).toBeNull()
    expect(anchorErRequirement(file('none', [state(null)]), 0)).toBeNull()
    expect(anchorErRequirement(file('need', [state(125.6)]), 3)).toBeNull()
  })

  it('measures a need build against the highest state it carries, never one carrying more', () => {
    const need = file('need', [state(125.6), state(126), state(126.4), state(126.8)])
    const at = (er: number) => anchorStateFor(need, 0, er)!.state.er
    expect(at(126.39)).toBe(126)
    expect(at(126.4)).toBe(126.4)
    expect(at(126.39999)).toBe(126.4)
    expect(at(140)).toBe(126.8)
    expect(at(125.6)).toBe(125.6)
    // under the range: only an unrepaired build lands here; it takes the least.
    expect(at(110)).toBe(125.6)
    expect(anchorStateFor(need, 0, 126.79)!.key).toBe('s0|er126.4')
  })
})
