/*
  Author: Runor Ewhro
  description: checks main Echo effects across costs, targets, and equivalent display states.
*/

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import { getEchoById, listChsByCos } from '@/data/catalog/echoCatalogService'
import * as gameData from '@/data/catalog/gameDataService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { makeEnemy, mkMaxResRt } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import * as shared from '@/engine/suggestions/shared'
import * as candidateScorer from '@/engine/rotation/candidateScorer'
import { ScalarBuilder, ScalarOp } from '@/engine/rotation/portable/ir'
import { TEAM_INPUT } from '@/engine/rotation/portable/layout'
import { applySetPlan } from '@/engine/suggestions/mutate'
import { runSetSggs } from '@/engine/suggestions/setPlan/suggest'

function fixture(costs: number[]) {
  const seed = getResSeedBy('1208')!
  const runtime = mkMaxResRt(seed, 6)
  const used = new Set<string>()
  runtime.build.echoes = costs.map((cost, index): EchoInstance => {
    const def = listChsByCos(cost).find((entry) => !used.has(entry.id))!
    used.add(def.id)
    const key = cost === 4 ? 'critDmg' : cost === 3 ? 'fusion' : 'atkPercent'
    return {
      uid: `main-search:${index}`, id: def.id, set: def.sets[0]!, mainEcho: index === 0,
      mainStats: { primary: { key, value: ECHO_MAIN_STATS[cost][key] }, secondary: { ...ECHO_SIDE_STATS[cost] } },
      substats: { critRate: index + 1, atkPercent: index + 2 },
    }
  })
  return {
    scenarioId: combatScenarioId('main-search'), memberId: teamMemberId(runtime.id),
    runtime, seed, enemy: makeEnemy(), runtimesById: makeRuntimeMap(runtime),
    selectedTargets: {}, tgtFeatId: 'damage:1208018', rotationMode: true,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('Sonata main search across build costs', () => {
  it('keeps an explicit Echo damage target when other main bodies remove that skill', () => {
    const input = { ...fixture([1, 4, 4, 1, 1]), rotationMode: false, includeEchoAttacks: true }
    const target = shared.runSuggSmlt(input).allSkills.find((entry) => entry.skill.tab === 'echoAttacks' && entry.aggregationType === 'damage')!
    expect(target).toBeDefined()
    input.tgtFeatId = target.id
    const result = runSetSggs(input, { fivePcSets: [9], thrPcSets: [] })
    expect(result.results.length).toBeGreaterThan(0)
    for (const row of result.results) {
      const choice = row.mainEchoId && row.mainEchoSetId != null ? { id: row.mainEchoId, setId: row.mainEchoSetId } : undefined
      const echoes = applySetPlan(row.setPlan, input.runtime.build.echoes, choice)
      const candidate = { ...input, runtime: { ...input.runtime, build: { ...input.runtime.build, echoes } } }
      const damage = shared.runSuggSmlt(candidate).allSkills.find((entry) => entry.id === target.id)?.avg ?? 0
      expect(row.avgDamage).toBeCloseTo(damage, 8)
      expect(echoes[0]?.id).toBe(input.runtime.build.echoes[0]?.id)
    }
  })

  it('retains conditionally useful rotation mains and ignores display-only differences', () => {
    const input = fixture([4, 3, 3, 1, 1])
    const prepared = shared.mkPrepSetPla(input, shared.runSuggSmlt(input))!
    if (prepared.context.mode !== 'rotation' || !prepared.context.candidatePlan) throw new Error('Missing rotation fixture')
    const plan = prepared.context.candidatePlan
    const ir = new ScalarBuilder()
    const main = ir.input(TEAM_INPUT.mainId)
    const sets = ir.input(TEAM_INPUT.setCounts + 9)
    const conditional = ir.mul(ir.eq(main, ir.one), ir.operation(ScalarOp.le, ir.constant(2), sets))
    const damage = ir.add(ir.add(ir.constant(100), ir.mul(sets, ir.constant(10))),
      ir.mul(conditional, ir.input(TEAM_INPUT.totals)))
    const scalar = ir.finish([damage, ir.eq(main, ir.constant(2))])
    candidateScorer.adoptRotationCandidateCompilation(plan, {
      program: {
        scalar, displayScalar: scalar, shownOffset: -1, echoSymbols: Uint32Array.from([1, 2, 3]),
        participantIds: [input.runtime.id],
      },
      symbols: [['conditional', 1], ['display-only', 2], ['inert', 3]],
    })
    expect(candidateScorer.rotationMainEchoCanContribute(plan, 'conditional')).toBe(true)
    expect(candidateScorer.rotationMainEchoCanContribute(plan, 'display-only')).toBe(false)
    expect(candidateScorer.rotationMainEchoCanContribute(plan, 'inert')).toBe(false)
    const stream = candidateScorer.prepareRotationCandidateStream(plan)
    const echoes = input.runtime.build.echoes.slice(0, 2).map((echo, index) => ({
      ...echo!, id: index === 0 ? 'conditional' : 'inert', set: 9,
    }))
    stream.load(echoes)
    expect(stream.score()).toBeGreaterThan(120)
    stream.load(echoes, true, false)
    expect(stream.score()).toBe(120)
  })

  it.each([{ costs: [4, 4, 1, 1, 1] }, { costs: [4, 3, 3, 1, 1] }])('moves same-cost stats when applying a main to $costs', ({ costs }) => {
    const echoes = fixture(costs).runtime.build.echoes
    const original = structuredClone(echoes)
    for (const cost of new Set(costs)) {
      const def = listChsByCos(cost).find((entry) => entry.sets.includes(9))!
      const result = applySetPlan([{ setId: 9, pieces: 2 }], echoes, { id: def.id, setId: 9 })
      expect(result[0]?.id).toBe(def.id)
      expect(result[0]?.mainStats).toEqual(echoes[costs.indexOf(cost)]?.mainStats)
      expect(result[0]?.substats).toEqual(echoes[costs.indexOf(cost)]?.substats)
      expect(result.map((echo) => getEchoById(echo!.id)!.cost).sort()).toEqual([...costs].sort())
      expect(result.map((echo) => JSON.stringify([echo!.mainStats, echo!.substats])).sort())
        .toEqual(echoes.map((echo) => JSON.stringify([echo!.mainStats, echo!.substats])).sort())
      expect(result.filter((echo) => echo?.mainEcho)).toHaveLength(1)
    }
    expect(echoes).toEqual(original)
  })

  it.each([
    { costs: [4, 4, 1, 1, 1], winner: 1 },
    { costs: [4, 3, 3, 1, 1], winner: 3 },
    { costs: [4, 4, 1, 1, 1], winner: 4 },
    { costs: [4, 3, 3, 1, 1], winner: 0 },
  ])('selects the contributing cost-$winner main once for $costs', ({ costs, winner }) => {
    const input = fixture(costs)
    vi.spyOn(candidateScorer, 'rotationMainEchoCanContribute').mockReturnValue(true)
    const definitions = [1, 3, 4].map((cost) => listChsByCos(cost).find((entry) => entry.sets.includes(9))!)
    const weights = new Map(definitions.map((def) => [def.id, def.cost === winner ? 30 : 0]))
    const sampleEffects = gameData.listEffectsFor('echo', '6000060')
    const effects = vi.spyOn(gameData, 'listEffectsFor').mockImplementation((_type, id) => (
      weights.has(id) ? sampleEffects : []
    ))
    const score = (echoes: Array<EchoInstance | null>, enabled = true) => {
      const pieces = new Set(echoes.filter((echo) => echo?.set === 9).map((echo) => echo!.id)).size
      return 1000 + (pieces >= 2 ? 100 : 0) + (enabled ? weights.get(echoes[0]?.id ?? '') ?? 0 : 0)
    }
    const scoredIds = new Set<string>()
    vi.spyOn(shared, 'evalSuggChs').mockImplementation((_ctx, echoes) => {
      scoredIds.add(echoes[0]?.id ?? '')
      return score(echoes)
    })
    vi.spyOn(shared, 'evalSuggChsW').mockImplementation((_ctx, echoes, _buffs, self = true, main = true) => score(echoes, self && main))
    const result = runSetSggs(input, { fivePcSets: [9], thrPcSets: [] })
    const plan = result.results.find((row) => row.setPlan.length === 1 && row.setPlan[0].setId === 9)
    expect(plan).toBeDefined()
    expect(plan?.mainEchoId).toBe(definitions.find((def) => def.cost === winner)?.id)
    expect(plan?.avgDamage).toBe(winner ? 1130 : 1100)
    expect(result.results.every((row) => !row.mainEchoId || weights.get(row.mainEchoId) === 30)).toBe(true)
    expect(result.results.filter((row) => row.setPlan.length === 0)).toHaveLength(winner ? 1 : 0)
    expect(new Set(result.results.map((row) => JSON.stringify(row.setPlan))).size).toBe(result.results.length)
    for (const def of definitions) expect(scoredIds.has(def.id)).toBe(costs.includes(def.cost))
    // screen catalog effects once for each cost.
    const available = [...new Set(costs)].reduce((sum, cost) => sum + listChsByCos(cost).length, 0)
    expect(effects).toHaveBeenCalledTimes(available)
  })
})
