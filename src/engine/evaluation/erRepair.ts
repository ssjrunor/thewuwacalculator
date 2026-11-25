/*
  Author: Runor Ewhro
  description: raises a build with less final energy regen than its scoring
               case requires up to the requirement, inside the budget the build
               already spends. the case's reference builds include that energy
               regen, and a build without it would spend the budget on damage.

               substats: energy regen is worth the median of the resonator's top
               five substats (ranked by one minimum line's gain, as the bench
               ranks them). in each echo it replaces that median stat, else the
               next best, else the next worst (ranks 3, 2, 1, 4, 5); an echo with
               none of the top five walks the ranks past them while each stays
               meaningful, and an echo with nothing to give gets no energy regen.
               the new line keeps the replaced line's tier index, which preserves
               lines and tier steps. when the placed lines fall short, an energy
               regen line rises a tier and the echo's next-worth line (just above
               energy regen's rank, else the closest below) falls one, and a
               surplus is returned the same way.
               main stats: 3-cost echoes can take energy regen as their main
               stat. every set of swaps up to the shortfall is tried with the
               substat repair after it, and the repaired build with the most
               damage wins.
               past the budget: when no repair inside the budget reaches the
               requirement, energy regen rises a tier at a time (a new line
               counts as its lowest tier, in a free slot or replacing the echo's
               least-worth line) and each tier is paid with one tier of the stat
               energy regen is worth, the median of the top five, wherever on the
               build it costs least damage; a line at its lowest tier is removed.
               with none of that stat left it pays with the next in the same order
               (ranks 3, 2, 1, 4, 5, then past them while each stays meaningful),
               and `overBudget` counts these tiers. a build that still cannot
               reach the requirement (energy regen lines all at their top tier,
               nothing left to pay with) is short.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_MAIN_STATS, SUBSTAT_KEYS, getSbstStepP } from '@/data/gameData/catalog/echoStats'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import type { SuggestContext } from '@/engine/suggestions/types'
import { mkSuggMainEc } from '@/engine/suggestions/shared'
import { makeEvaluationSearchFrame } from './echoDiscovery'
import { addStatTotal, ENERGY_REGEN } from './stats'

/** one substat line the repair changed: `from` null is a line it added, `to` null one it removed. */
export interface ErRepairLine {
  slot: number
  key: string
  from: number | null
  to: number | null
}

export interface ErRepairMain {
  slot: number
  from: { key: string; value: number }
  to: { key: string; value: number }
}

export interface ErRepair {
  /** the final energy regen the case requires. */
  target: number
  /** the submitted build's final energy regen. */
  from: number
  /** the scored build's final energy regen; equal to `from` when short. */
  to: number
  /** no repair reaches `target`, inside the build's budget or past it. */
  short: boolean
  lines: ErRepairLine[]
  mains: ErRepairMain[]
  /** energy regen tiers taken past the build's budget, each paid by a tier of another stat; 0 inside it. */
  overBudget: number
  /** the repair rule the result follows (ER_REPAIR_RULE); absent on results from before rules were counted. */
  rule: number
}

/** repair rule version, bumped with any change to how builds are repaired, which retakes stored repairs it can
    change; rule 2 repairs past the budget where rule 1 was short. */
export const ER_REPAIR_RULE = 2

export interface ErRepairResult {
  repair: ErRepair
  /** the repaired build in its slots; the submitted echoes when short. */
  echoes: Array<EchoInstance | null>
}

/** the repaired build's exact damage and final energy regen, from the caller's full evaluator. */
export type ErRepairMeasure = (echoes: Array<EchoInstance | null>) => { damage: number; energyRegen: number }

const TOLERANCE = 1e-4
/** energy regen's rank among the top five: their median. */
const ER_RANK = 2
const TOP_RANKS = [2, 1, 0, 3, 4]
/** past the top five, a stat is meaningful while its worth is at least this share of the best stat's... */
const MEANINGFUL_OF_BEST = 0.1
/** ...and of the rank before it. */
const MEANINGFUL_OF_PREVIOUS = 0.5
const MAIN_ER_COST = 3
/** substat lines an echo rolls at most. */
const MAX_LINES = 5

interface EchoModel {
  slot: number
  echo: EchoInstance
  /** substat key -> tier index, as submitted. */
  before: ReadonlyMap<string, number>
  /** substat key -> tier index, as the repair has it now. */
  lines: Map<string, number>
  /** the lowest tier a surplus may lower each energy regen line to: its own tier, or 0 for a placed line. */
  erFloor: number
  /** the stat energy regen replaces here; null when the echo has none to give or already rolls energy regen. */
  placeKey: string | null
  mainSwapped: boolean
}

function tierIndex(tiers: readonly number[], value: number): number {
  let best = 0
  for (let index = 1; index < tiers.length; index += 1) {
    if (Math.abs(tiers[index] - value) < Math.abs(tiers[best] - value)) best = index
  }
  return best
}

function* subsets<T>(items: readonly T[], size: number, start = 0, picked: T[] = []): Generator<T[]> {
  if (picked.length === size) { yield picked.slice(); return }
  for (let index = start; index < items.length; index += 1) {
    picked.push(items[index])
    yield* subsets(items, size, index + 1, picked)
    picked.pop()
  }
}

/**
 * repairs `equipped` up to `target` final energy regen; `energyRegen` is the build's own final energy regen as
 * `measure` reports it. null when the build already meets the target.
 */
export function repairEnergyRegen(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  energyRegen: number,
  target: number,
  measure: ErRepairMeasure,
): ErRepairResult | null {
  if (energyRegen >= target - TOLERANCE) return null
  const short = (): ErRepairResult => ({
    repair: { target, from: energyRegen, to: energyRegen, short: true, lines: [], mains: [], overBudget: 0, rule: ER_REPAIR_RULE },
    echoes: equipped,
  })
  const present = equipped.flatMap((echo, slot) => echo ? [{ echo, slot }] : [])
  if (!present.length) return short()

  const tiers = Object.fromEntries(SUBSTAT_KEYS.map((key) => [key, getSbstStepP(key)])) as Record<string, number[]>
  const erTiers = tiers[ENERGY_REGEN]
  const mainEr = ECHO_MAIN_STATS[MAIN_ER_COST]?.[ENERGY_REGEN] ?? 0

  // the compact search model proposes; every finished proposal is measured exactly.
  const echoes = present.map(({ echo }) => echo)
  const frame = makeEvaluationSearchFrame(ctx, echoes, mkSuggMainEc(ctx, equipped))
  const base = frame.stats
  const score = frame.prepareFirstLaneScore(base)
  const working = new Float32Array(base.length)
  const scoreDeltas = (deltas: ReadonlyMap<string, number>) => {
    working.set(base)
    for (const [key, delta] of deltas) if (delta) addStatTotal(working, key, delta)
    return score(working)
  }

  // worth: one minimum line of each substat on the build as submitted.
  const baseDamage = scoreDeltas(new Map())
  const ranked = SUBSTAT_KEYS.filter((key) => key !== ENERGY_REGEN && tiers[key]?.length)
    .map((key) => ({ key, gain: scoreDeltas(new Map([[key, tiers[key][0]]])) - baseDamage }))
    .sort((a, b) => b.gain - a.gain || a.key.localeCompare(b.key))
  const rank = new Map(ranked.map((entry, index) => [entry.key, index]))

  const placeKeyFor = (lines: ReadonlyMap<string, number>): string | null => {
    if (lines.has(ENERGY_REGEN) || lines.size === 0) return null
    for (const index of TOP_RANKS) {
      const key = ranked[index]?.key
      if (key && lines.has(key)) return key
    }
    for (let index = TOP_RANKS.length; index < ranked.length; index += 1) {
      const { gain, key } = ranked[index]
      if (gain <= 0 || gain < MEANINGFUL_OF_BEST * ranked[0].gain || gain < MEANINGFUL_OF_PREVIOUS * ranked[index - 1].gain) return null
      if (lines.has(key)) return key
    }
    return null
  }

  // past the budget, the stats that pay for energy regen, in turn: the same walk as placeKeyFor.
  const payers: string[] = TOP_RANKS.flatMap((index) => ranked[index] ? [ranked[index].key] : [])
  for (let index = TOP_RANKS.length; index < ranked.length; index += 1) {
    const { gain, key } = ranked[index]
    if (gain <= 0 || gain < MEANINGFUL_OF_BEST * ranked[0].gain || gain < MEANINGFUL_OF_PREVIOUS * ranked[index - 1].gain) break
    payers.push(key)
  }

  // the lines an energy regen line trades tiers with: just above its rank first (closest first), then below.
  const partners = (model: EchoModel) => {
    const others = [...model.lines.keys()].filter((key) => key !== ENERGY_REGEN)
      .map((key) => ({ key, rank: rank.get(key) ?? ranked.length }))
    const above = others.filter((entry) => entry.rank <= ER_RANK).sort((a, b) => b.rank - a.rank)
    const below = others.filter((entry) => entry.rank > ER_RANK).sort((a, b) => a.rank - b.rank)
    return [...above, ...below].map((entry) => entry.key)
  }
  const donorOf = (model: EchoModel) => partners(model).find((key) => model.lines.get(key)! > 0) ?? null
  const receiverOf = (model: EchoModel) => partners(model).find((key) => model.lines.get(key)! < tiers[key].length - 1) ?? null

  const originals = present.map(({ echo, slot }) => {
    const lines = new Map<string, number>()
    for (const [key, value] of Object.entries(echo.substats ?? {})) {
      if (tiers[key]?.length && value) lines.set(key, tierIndex(tiers[key], value))
    }
    return { slot, echo, lines }
  })

  const valueOf = (key: string, index: number) => tiers[key][index]
  // the stat change against the submitted build: every changed line and swapped main.
  const deltasOf = (models: readonly EchoModel[]) => {
    const deltas = new Map<string, number>()
    const add = (key: string, value: number) => deltas.set(key, (deltas.get(key) ?? 0) + value)
    for (const model of models) {
      const own = model.echo.substats ?? {}
      for (const key of new Set([...model.before.keys(), ...model.lines.keys()])) {
        const before = model.before.has(key) ? own[key] : 0
        const index = model.lines.get(key)
        const after = index == null ? 0 : model.before.get(key) === index ? before : valueOf(key, index)
        if (after !== before) add(key, after - before)
      }
      if (model.mainSwapped) {
        add(model.echo.mainStats.primary.key, -model.echo.mainStats.primary.value)
        add(ENERGY_REGEN, mainEr)
      }
    }
    return deltas
  }
  const erOf = (deltas: ReadonlyMap<string, number>) => energyRegen + (deltas.get(ENERGY_REGEN) ?? 0)

  // one main-stat swap set and the substat repair after it, past the budget when `overBudget` allows; null when it
  // cannot reach the target.
  const repairWith = (swapped: ReadonlySet<number>, overBudget: boolean): { models: EchoModel[]; overBudget: number } | null => {
    const models: EchoModel[] = originals.map(({ slot, echo, lines }) => ({
      slot, echo, before: lines, lines: new Map(lines), erFloor: lines.get(ENERGY_REGEN) ?? 0, placeKey: placeKeyFor(lines),
      mainSwapped: swapped.has(slot),
    }))
    let deltas = deltasOf(models)
    let damage = scoreDeltas(deltas)
    // try a change on a copy of one echo's lines, keeping the best by damage lost per energy regen gained
    const tryChange = (model: EchoModel, change: (lines: Map<string, number>) => void) => {
      const saved = model.lines
      model.lines = new Map(saved)
      change(model.lines)
      const trialDeltas = deltasOf(models)
      const trial = { damage: scoreDeltas(trialDeltas), deltas: trialDeltas, lines: model.lines }
      model.lines = saved
      return trial
    }
    const pick = (moves: Array<{ model: EchoModel; change: (lines: Map<string, number>) => void }>) => {
      let best: { model: EchoModel; lines: Map<string, number>; damage: number; deltas: Map<string, number>; cost: number } | null = null
      for (const { model, change } of moves) {
        const trial = tryChange(model, change)
        const gained = erOf(trial.deltas) - erOf(deltas)
        const cost = gained > 0 ? (damage - trial.damage) / gained : Infinity
        if (!best || cost < best.cost) best = { model, ...trial, cost }
      }
      if (!best || !Number.isFinite(best.cost)) return false
      best.model.lines = best.lines
      deltas = best.deltas
      damage = best.damage
      return true
    }

    // place energy regen lines, cheapest echo first.
    while (erOf(deltas) < target - TOLERANCE) {
      const moves = models.filter((model) => model.placeKey && !model.lines.has(ENERGY_REGEN)).map((model) => ({
        model,
        change: (lines: Map<string, number>) => {
          const index = Math.min(lines.get(model.placeKey!)!, erTiers.length - 1)
          lines.delete(model.placeKey!)
          lines.set(ENERGY_REGEN, index)
        },
      }))
      if (!pick(moves)) break
    }
    // raise energy regen lines a tier each, paid by their echo's next-worth line.
    while (erOf(deltas) < target - TOLERANCE) {
      const moves = models.flatMap((model) => {
        const index = model.lines.get(ENERGY_REGEN)
        const donor = index != null && index < erTiers.length - 1 ? donorOf(model) : null
        return donor ? [{ model, change: (lines: Map<string, number>) => {
          lines.set(ENERGY_REGEN, index! + 1)
          lines.set(donor, lines.get(donor)! - 1)
        } }] : []
      })
      if (!pick(moves)) break
    }
    // past the budget: an energy regen tier anywhere, paid by a tier of the current payer stat wherever that
    // costs least damage per energy regen gained.
    let forced = 0
    while (overBudget && erOf(deltas) < target - TOLERANCE) {
      const payer = payers.find((key) => models.some((model) => model.lines.has(key)))
      if (!payer) break
      const raises = models.flatMap((model) => {
        const index = model.lines.get(ENERGY_REGEN)
        if (index != null) return index < erTiers.length - 1 ? [{ model, raise: (lines: Map<string, number>) => { lines.set(ENERGY_REGEN, index + 1) } }] : []
        return [{ model, raise: (lines: Map<string, number>) => {
          if (lines.size >= MAX_LINES) {
            const least = [...lines.keys()].filter((key) => key !== payer)
              .sort((a, b) => (rank.get(b) ?? ranked.length) - (rank.get(a) ?? ranked.length))[0]
            if (least) lines.delete(least)
          }
          if (lines.size < MAX_LINES) lines.set(ENERGY_REGEN, 0)
        } }]
      })
      let best: { changed: Map<EchoModel, Map<string, number>>; damage: number; deltas: Map<string, number>; cost: number } | null = null
      for (const { model, raise } of raises) {
        for (const paying of models.filter((entry) => entry.lines.has(payer))) {
          const saved = new Map(models.map((entry) => [entry, entry.lines]))
          const changed = new Map<EchoModel, Map<string, number>>()
          const linesOf = (entry: EchoModel) => changed.get(entry) ?? changed.set(entry, new Map(entry.lines)).get(entry)!
          raise(linesOf(model))
          const paid = linesOf(paying)
          const index = paid.get(payer)
          if (index == null) continue
          if (index > 0) paid.set(payer, index - 1)
          else paid.delete(payer)
          for (const [entry, lines] of changed) entry.lines = lines
          const trialDeltas = deltasOf(models)
          for (const [entry, lines] of saved) entry.lines = lines
          const gained = erOf(trialDeltas) - erOf(deltas)
          if (gained <= 0) continue
          const trialDamage = scoreDeltas(trialDeltas)
          const cost = (damage - trialDamage) / gained
          if (!best || cost < best.cost) best = { changed, damage: trialDamage, deltas: trialDeltas, cost }
        }
      }
      if (!best) break
      for (const [entry, lines] of best.changed) entry.lines = lines
      deltas = best.deltas
      damage = best.damage
      forced += 1
    }
    if (erOf(deltas) < target - TOLERANCE) return null

    // return a surplus: lower an energy regen line a tier while the target is met, best damage first
    for (;;) {
      let best: { model: EchoModel; lines: Map<string, number>; damage: number; deltas: Map<string, number> } | null = null
      for (const model of models) {
        const index = model.lines.get(ENERGY_REGEN)
        if (index == null || index <= model.erFloor) continue
        if (erOf(deltas) - (erTiers[index] - erTiers[index - 1]) < target - TOLERANCE) continue
        const receiver = receiverOf(model)
        if (!receiver) continue
        const trial = tryChange(model, (lines) => {
          lines.set(ENERGY_REGEN, index - 1)
          lines.set(receiver, lines.get(receiver)! + 1)
        })
        if (trial.damage > damage && (!best || trial.damage > best.damage)) best = { model, ...trial }
      }
      if (!best) break
      best.model.lines = best.lines
      deltas = best.deltas
      damage = best.damage
    }
    return { models, overBudget: forced }
  }

  const materialize = (models: readonly EchoModel[]) => {
    const repaired = equipped.slice()
    const lines: ErRepairLine[] = []
    const mains: ErRepairMain[] = []
    for (const model of models) {
      const own = model.echo.substats ?? {}
      const substats: Record<string, number> = {}
      // lines the repair does not model (no tiers) pass through untouched.
      for (const [key, value] of Object.entries(own)) if (!model.before.has(key)) substats[key] = value
      for (const [key, index] of model.lines) substats[key] = model.before.get(key) === index ? own[key] : valueOf(key, index)
      for (const key of new Set([...Object.keys(own), ...Object.keys(substats)])) {
        const from = own[key] ?? null
        const to = substats[key] ?? null
        if (from !== to) lines.push({ slot: model.slot, key, from, to })
      }
      const primary = model.mainSwapped ? { key: ENERGY_REGEN, value: mainEr } : { ...model.echo.mainStats.primary }
      if (model.mainSwapped) mains.push({ slot: model.slot, from: { ...model.echo.mainStats.primary }, to: { ...primary } })
      repaired[model.slot] = {
        ...model.echo,
        mainStats: { primary, secondary: { ...model.echo.mainStats.secondary } },
        substats,
      }
    }
    return { repaired, lines, mains }
  }

  // try every main-stat swap set up to the shortfall from mains alone, then its substat repair, and keep the repaired
  // build with the most exact damage (fewer swaps, then lower slots, on a tie); inside the budget first, and past it
  // only when no swap set reaches the target inside it
  const swappable = originals.filter(({ echo }) => getEchoById(echo.id)?.cost === MAIN_ER_COST &&
    echo.mainStats.primary.key !== ENERGY_REGEN).map(({ slot }) => slot)
  const maxSwaps = mainEr > 0 ? Math.min(swappable.length, Math.ceil((target - energyRegen) / mainEr)) : 0
  const attempt = (overBudget: boolean) => {
    let best: { result: ErRepairResult; damage: number } | null = null
    for (let size = 0; size <= maxSwaps; size += 1) {
      for (const swap of subsets(swappable, size)) {
        const done = repairWith(new Set(swap), overBudget)
        if (!done) continue
        const { repaired, lines, mains } = materialize(done.models)
        const measured = measure(repaired)
        if (measured.energyRegen < target - TOLERANCE) continue
        if (!best || measured.damage > best.damage) {
          best = { damage: measured.damage, result: { echoes: repaired, repair: { target, from: energyRegen,
            to: measured.energyRegen, short: false, lines, mains, overBudget: done.overBudget, rule: ER_REPAIR_RULE } } }
        }
      }
    }
    return best?.result ?? null
  }
  return attempt(false) ?? attempt(true) ?? short()
}
