/*
  Author: Runor Ewhro
  Description: Discovers benchmark echo, main-stat, Sonata, and main-Echo candidates.
*/
import type { EchoInstance } from '@/domain/entities/runtime';
import type { SkillTypeKey } from '@/domain/entities/stats';
import { SUBSTAT_KEYS, getSbstStepP, ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats';
import { getEchoById, listChsByCos, listEchoes } from '@/domain/services/echoCatalogService';
import type { EchoDef } from '@/domain/entities/catalog';
import { ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from '@/engine/optimizer/config/constants';
import { addEchoStat, encEchoRows } from '@/engine/optimizer/encode/echoes';
import { getSetCntBkt, getSetRowFfs, SET_ROT_TOGGLES, SETCNSTLUTRO, SETRTTGLST14, SETRTTGLST22, SETRTTGLST29 } from '@/engine/optimizer/encode/sets';
import { mkSuggMainEc } from '@/engine/suggestions/shared';
import type { SuggestContext } from '@/engine/suggestions/types';
import { scoreStats } from '@/data/scoring/benchmark/scoring';
import type { SetPlanEntry } from '@/engine/suggestions/types';
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets';
import { listEffectsFor } from '@/domain/services/gameDataService';
import { isMaxSetPlan, isUtilitySet, makeEffectiveSetPlan } from '@/domain/gameData/sonataPlan';
import type { BenchmarkBuildSnapshot, BenchmarkEchoSlot, BenchmarkFeature, BenchmarkFeatureGroup, BenchmarkFeatureGroups, BenchmarkOverviewStats, BenchmarkSetSummary, BenchmarkStatContribution, BenchmarkSubstatEntry, BenchmarkSubstatMode } from './types.ts';
import { addStatTotal, collectMainStatSources, formatFeatureTabLabel, getBenchmarkStatKeys, type BenchmarkEchoFrame, type MainEchoChoice, type MainEchoProfile, type MainStatCandidate, type MainStatSourceSummary } from './stats.ts';


export function cloneEchoSlot(echo: EchoInstance): EchoInstance {
  return {
    ...echo,
    mainStats: {
      primary: { ...echo.mainStats.primary },
      secondary: { ...echo.mainStats.secondary },
    },
    substats: { ...echo.substats },
  }
}


export function makeSetSummary(setRows: Uint8Array, echoes: EchoInstance[]): BenchmarkSetSummary[] {
  const idsBySet = new Map<number, Set<string>>()
  for (let index = 0; index < setRows.length; index += 1) {
    const setId = setRows[index] ?? 0
    if (setId > 0) {
      const ids = idsBySet.get(setId) ?? new Set<string>()
      ids.add(echoes[index]?.id ?? `slot:${index}`)
      idsBySet.set(setId, ids)
    }
  }
  return makeEffectiveSetPlan(
    [...idsBySet.entries()].map(([setId, ids]) => [setId, ids.size] as const),
  ).map(({ setId, pieces }) => ({ setId, name: getSntSetNam(setId), pieces }))
}

export function utilityPlanFor(equipped: Array<EchoInstance | null>): SetPlanEntry[] {
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (echoes.length === 0) return []
  const setRows = Uint8Array.from(echoes.map((echo) => echo.set))
  return makeSetSummary(setRows, echoes)
    .filter((set) => isUtilitySet(set.setId) && isMaxSetPlan(set.setId, set.pieces))
    .map((set) => ({ setId: set.setId, pieces: set.pieces }))
}

export function retainsUtilityPlan(plan: SetPlanEntry[], required: SetPlanEntry[]): boolean {
  return required.every((utility) => plan.some((entry) => (
    entry.setId === utility.setId && entry.pieces === utility.pieces
  )))
}

export function makeReferenceBenchmarkEchoes(
  costPlan: readonly number[],
  selectedMainEcho: EchoInstance | null,
): EchoInstance[] {
  const forcedCost = selectedMainEcho ? getEchoById(selectedMainEcho.id)?.cost ?? null : null
  const orderedCostPlan = [...costPlan]
  let forcedSlot = forcedCost == null ? -1 : orderedCostPlan.indexOf(forcedCost)
  if (forcedSlot > 0) {
    const [mainCost] = orderedCostPlan.splice(forcedSlot, 1)
    orderedCostPlan.unshift(mainCost)
    forcedSlot = 0
  }
  const usedIds = new Set<string>()
  if (selectedMainEcho) {
    usedIds.add(selectedMainEcho.id)
  }
  const echoes: EchoInstance[] = []

  for (let index = 0; index < orderedCostPlan.length; index += 1) {
    const cost = orderedCostPlan[index]
    if (index === forcedSlot && selectedMainEcho && forcedCost === cost) {
      const next = cloneEchoSlot(selectedMainEcho)
      next.mainEcho = true
      next.substats = {}
      echoes.push(next)
      continue
    }

    const byCost = listChsByCos(cost)
    const definition = byCost.find((entry) => !usedIds.has(entry.id))
      ?? byCost[0]
      ?? listChsByCos(4)[0]
      ?? listChsByCos(3)[0]
      ?? listChsByCos(1)[0]
    const primary = Object.entries(ECHO_MAIN_STATS[cost] ?? {})[0]
    const secondary = ECHO_SIDE_STATS[cost]
    if (!definition || !primary || !secondary) {
      continue
    }

    const [key, value] = primary
    const set = definition.sets[0] ?? 0
    usedIds.add(definition.id)
    echoes.push({
      uid: `benchmark-reference-${orderedCostPlan.join('')}-${index + 1}`,
      id: definition.id,
      set,
      mainEcho: false,
      mainStats: {
        primary: { key, value },
        secondary: { ...secondary },
      },
      substats: {},
    })
  }

  return echoes
}

export function makeMainEchoFixture(def: EchoDef, set = def.sets[0] ?? 0): EchoInstance | null {
  const primary = Object.entries(ECHO_MAIN_STATS[def.cost] ?? {})[0]
  const secondary = ECHO_SIDE_STATS[def.cost]
  if (!primary || !secondary) return null
  return {
    uid: `benchmark-main-${def.id}`,
    id: def.id,
    set,
    mainEcho: true,
    mainStats: {
      primary: { key: primary[0], value: primary[1] },
      secondary: { ...secondary },
    },
    substats: {},
  }
}

export function mainEchoEffectSig(buffer: Float32Array): string {
  return Array.from(buffer, (value) => Math.abs(value) < 0.000001 ? 0 : value).join(',')
}

export function hasNonSelfMainEchoBuff(echoId: string): boolean {
  return listEffectsFor('echo', echoId, 'runtime').some((effect) => (
    (effect.targetScope ?? 'self') !== 'self'
    && effect.operations.some((operation) => operation.type !== 'add_immunity')
  ))
}

export function preservedMainEchoFor(equipped: Array<EchoInstance | null>): EchoInstance | null {
  const mainEcho = equipped.find((echo): echo is EchoInstance => Boolean(echo?.mainEcho)) ?? null
  return mainEcho && hasNonSelfMainEchoBuff(mainEcho.id) ? mainEcho : null
}

export function makeMainEchoProfiles(ctx: SuggestContext): MainEchoProfile[] {
  const fixtures = listEchoes().flatMap((def) => {
    const echo = makeMainEchoFixture(def, 0)
    return echo ? [{ def, echo }] : []
  })
  const allBuffs = mkSuggMainEc(ctx, fixtures.map(({ echo }) => echo))

  return fixtures.map(({ def, echo }, index) => {
    const buffs = allBuffs.slice(index * MAIN_BUFF_LEN, (index + 1) * MAIN_BUFF_LEN)
    const buffed = makeBenchmarkEchoFrame(ctx, [echo], buffs)
    const neutral = makeBenchmarkEchoFrame(ctx, [echo], new Float32Array(MAIN_BUFF_LEN))
    const baseDamage = neutral.score(neutral.stats, neutral.sets)
    const buffedDamage = buffed.score(buffed.stats, buffed.sets)
    const epsilon = Math.max(0.000001, Math.abs(baseDamage) * 1e-9)
    const relevant = Math.abs(buffedDamage - baseDamage) > epsilon
    return {
      def,
      buffs,
      effectSig: relevant ? mainEchoEffectSig(buffs) : 'neutral',
      relevant,
    }
  })
}

export function mainBuffDominates(left: Float32Array, right: Float32Array): boolean {
  let strictlyBetter = false
  for (let index = 0; index < MAIN_BUFF_LEN; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    if (leftValue + 0.000001 < rightValue) return false
    if (leftValue > rightValue + 0.000001) strictlyBetter = true
  }
  return strictlyBetter
}

export function mainEchoChoices(
  profiles: MainEchoProfile[],
  costPlan: readonly number[],
  setPlan: SetPlanEntry[],
  requiredMainEchoId: string | null = null,
): MainEchoChoice[] {
  const costs = new Set(costPlan)
  const plannedSets = new Set(setPlan.map((entry) => entry.setId))
  const choices = new Map<string, MainEchoChoice>()

  for (const profile of profiles) {
    if (!costs.has(profile.def.cost)) continue
    if (requiredMainEchoId && profile.def.id !== requiredMainEchoId) continue
    const carrierSets = profile.def.sets.filter((setId) => plannedSets.has(setId))

    if (profile.relevant) {
      if (carrierSets.length === 0) {
        if (!requiredMainEchoId && profiles.some((candidate) => (
          candidate !== profile
          && candidate.relevant
          && candidate.def.cost === profile.def.cost
          && mainBuffDominates(candidate.buffs, profile.buffs)
        ))) continue
        const echo = makeMainEchoFixture(profile.def)
        if (echo) choices.set(`${profile.def.cost}:${profile.effectSig}:filler`, { echo, effectSig: profile.effectSig })
      } else {
        for (const setId of carrierSets) {
          if (!requiredMainEchoId && profiles.some((candidate) => (
            candidate !== profile
            && candidate.relevant
            && candidate.def.cost === profile.def.cost
            && candidate.def.sets.includes(setId)
            && mainBuffDominates(candidate.buffs, profile.buffs)
          ))) continue
          const echo = makeMainEchoFixture(profile.def, setId)
          if (echo) choices.set(`${profile.def.cost}:${profile.effectSig}:${setId}`, { echo, effectSig: profile.effectSig })
        }
      }
      continue
    }

    for (const setId of carrierSets) {
      const echo = makeMainEchoFixture(profile.def, setId)
      if (echo) choices.set(`${profile.def.cost}:neutral:${setId}`, { echo, effectSig: 'neutral' })
    }
  }

  return [...choices.values()]
}

export function setPlanSignature(plan: ReadonlyArray<{ setId: number; pieces: number }>): string {
  return plan
    .map((entry) => `${entry.setId}:${entry.pieces}`)
    .sort()
    .join('|')
}

export function echoesMatchSetPlan(echoes: EchoInstance[], plan: SetPlanEntry[]): boolean {
  const setRows = Uint8Array.from(echoes.map((echo) => echo.set))
  return setPlanSignature(makeSetSummary(setRows, echoes)) === setPlanSignature(plan)
}

export function setEffectSig(ctx: SuggestContext, plan: SetPlanEntry[]): string {
  const totals = new Float64Array(SETCNSTLUTRO)
  for (const entry of plan) {
    const row = getSetRowFfs(entry.setId, getSetCntBkt(entry.pieces))
    for (let index = 0; index < SETCNSTLUTRO; index += 1) {
      totals[index] += ctx.setConstLut[row + index] ?? 0
    }
  }
  const special = plan
    .filter((entry) => (
      (entry.setId === 14 && (ctx.setRtMask & SETRTTGLST14) !== 0)
      || (entry.setId === 22 && (ctx.setRtMask & (SETRTTGLST22 | SET_ROT_TOGGLES)) !== 0)
      || (entry.setId === 29 && (ctx.setRtMask & SETRTTGLST29) !== 0)
    ))
    .map((entry) => `${entry.setId}:${entry.pieces}`)
    .join(',')
  return `${Array.from(totals).join(',')}|${special}`
}

export function makeEchoSlots(
  echoes: EchoInstance[],
  setRows: Uint8Array,
  primaryStats: Array<{ key: string; value: number }>,
): BenchmarkEchoSlot[] {
  return echoes.map((echo, index) => {
    const definition = getEchoById(echo.id)
    const setId = setRows[index] ?? echo.set
    return {
      echoId: echo.id,
      echoName: definition?.name ?? echo.id,
      cost: definition?.cost ?? 0,
      mainEcho: echo.mainEcho,
      setId,
      setName: setId > 0 ? getSntSetNam(setId) : 'No set',
      primary: {
        key: primaryStats[index]?.key ?? echo.mainStats.primary.key,
        value: primaryStats[index]?.value ?? echo.mainStats.primary.value,
      },
      secondary: {
        key: echo.mainStats.secondary.key,
        value: echo.mainStats.secondary.value,
      },
      equippedSubstats: Object.entries(echo.substats)
        .map(([key, value]) => ({ key, value }))
        .sort((left, right) => right.value - left.value),
    }
  })
}

export function makeBenchmarkBuildSnapshot({
  label,
  score,
  damage,
  echoes,
  setRows,
  primaryStats,
  substats,
  stats,
  scoreDamage,
  features,
  overviewStats,
  substatMode,
  includeStatRows = true,
}: {
  label: string
  score: number
  damage: number
  echoes: EchoInstance[]
  setRows: Uint8Array
  primaryStats: Array<{ key: string; value: number }>
  substats: BenchmarkSubstatEntry[]
  stats: Float32Array
  scoreDamage: (buffer: Float32Array) => number
  features: BenchmarkFeature[]
  overviewStats: BenchmarkOverviewStats
  substatMode: BenchmarkSubstatMode
  includeStatRows?: boolean
}): BenchmarkBuildSnapshot {
  const mainStats = collectMainStatSources(echoes, primaryStats)
  const statContributions = includeStatRows
    ? makeStatContributions(stats, mainStats, substats, damage, scoreDamage)
    : []
  const featureGroups = makeFeatureGroups(features)
  return {
    label,
    score,
    damage,
    sets: makeSetSummary(setRows, echoes),
    echoes: makeEchoSlots(echoes, setRows, primaryStats),
    substatMode,
    statRows: statContributions,
    overviewStats,
    features,
    featureGroups,
  }
}

export function makeFeatureGroups(features: BenchmarkFeature[]): BenchmarkFeatureGroups {
  const bySkillType = new Map<string, BenchmarkFeatureGroup & { weightedDamage: number }>()
  const byTab = new Map<string, BenchmarkFeatureGroup & { weightedDamage: number }>()

  const add = (
    map: Map<string, BenchmarkFeatureGroup & { weightedDamage: number }>,
    key: string,
    label: string,
    row: BenchmarkFeature,
    skillType?: SkillTypeKey,
  ) => {
    const existing = map.get(key) ?? {
      key,
      label,
      weightedDamage: 0,
      sharePct: 0,
      skillType,
    }
    existing.weightedDamage += Math.max(0, row.weightedDamage)
    map.set(key, existing)
  }

  for (const row of features) {
    const skillType = row.skillType[0]
    const skillTypeKey = skillType ?? 'feature'
    const tabKey = row.tab || 'feature'
    add(bySkillType, skillTypeKey, skillTypeKey, row, skillType)
    add(byTab, tabKey, formatFeatureTabLabel(tabKey), row)
  }

  const normalize = (map: Map<string, BenchmarkFeatureGroup & { weightedDamage: number }>) => {
    const total = [...map.values()].reduce((sum, group) => sum + Math.max(0, group.weightedDamage), 0)
    return [...map.values()]
      .map((group) => ({
        key: group.key,
        label: group.label,
        sharePct: total > 0 ? (Math.max(0, group.weightedDamage) / total) * 100 : 0,
        skillType: group.skillType,
        sortDamage: group.weightedDamage,
      }))
      .sort((left, right) => right.sortDamage - left.sortDamage)
      .map(({ key, label, sharePct, skillType }) => ({ key, label, sharePct, skillType }))
  }

  return {
    skillTypes: normalize(bySkillType),
    tabs: normalize(byTab),
  }
}

export function makeStatContributions(
  stats: Float32Array,
  mains: MainStatSourceSummary,
  substats: BenchmarkSubstatEntry[],
  baseDamage: number,
  score: (buffer: Float32Array) => number,
): BenchmarkStatContribution[] {
  const substatByKey = new Map(substats.map((entry) => [entry.key, entry]))
  const rows = getBenchmarkStatKeys(mains, substats).map((key) => {
    const substat = substatByKey.get(key)
    const mainTotal = mains.totalByKey[key] ?? 0
    const mainCount = (mains.primarySlots[key]?.length ?? 0) + (mains.secondarySlots[key]?.length ?? 0)
    const substatTotal = substat?.total ?? 0
    const total = mainTotal + substatTotal
    const trialTotal = stats.slice()

    if (total) {
      addStatTotal(trialTotal, key, -total)
    }

    const damage = total ? baseDamage - score(trialTotal) : 0
    const maxRoll = getSbstStepP(key).at(-1) ?? 0
    const substatMax = (substat?.count ?? 0) * maxRoll
    const qualityMax = mainTotal + substatMax
    const qualityPct = qualityMax > 0
      ? (total / qualityMax) * 100
      : 0

    return {
      key,
      mainTotal,
      mainCount,
      substatTotal,
      total,
      substatCount: substat?.count ?? 0,
      qualityPct,
      damage,
      sharePct: 0,
    }
  })

  const sum = rows.reduce((total, row) => total + Math.max(0, row.damage), 0)
  return rows
    .map((row) => ({
      ...row,
      sharePct: sum > 0 ? (Math.max(0, row.damage) / sum) * 100 : 0,
    }))
    .sort((left, right) => right.damage - left.damage || right.total - left.total)
}

// Yields one candidate per legal main-stat assignment. Each candidate's
// `stats` / `primaryStats` / `mainCounts` ALIAS the live recursion buffers and
// are only valid for the duration of that iteration: the consumer reads what it
// needs synchronously and deep-copies on a new best (see `consider` in
// search.ts). Streaming this keeps peak memory at O(one candidate) and avoids a
// per-candidate Float32Array slice for the (vast majority of) candidates that
// never become the running best.
export function* enumerateMainStatCandidates(
  frame: BenchmarkEchoFrame,
  mainsOnly: Float32Array,
  usefulStats: ReadonlySet<string>,
): Generator<MainStatCandidate> {
  const working = mainsOnly.slice()
  const primaryStats = frame.echoes.map((echo) => ({ ...echo.mainStats.primary }))
  const mainCounts: Record<string, number> = {}

  function* visit(slotIndex: number): Generator<MainStatCandidate> {
    if (slotIndex >= frame.echoes.length) {
      yield { frame, stats: working, primaryStats, mainCounts }
      return
    }

    const echo = frame.echoes[slotIndex]
    const row = working.subarray(slotIndex * ECHO_STAT_STRIDE, (slotIndex + 1) * ECHO_STAT_STRIDE)
    const cost = getEchoById(echo.id)?.cost ?? 0
    const allLegalMains = Object.entries(ECHO_MAIN_STATS[cost] ?? {
      [echo.mainStats.primary.key]: echo.mainStats.primary.value,
    })
    const usefulMains = allLegalMains.filter(([key]) => usefulStats.has(key))
    const legalMains = usefulMains.length > 0 ? usefulMains : allLegalMains.slice(0, 1)

    addEchoStat(row, echo.mainStats.primary.key, -echo.mainStats.primary.value)
    for (const [key, value] of legalMains) {
      addEchoStat(row, key, value)
      primaryStats[slotIndex] = { key, value }
      mainCounts[key] = (mainCounts[key] ?? 0) + 1

      yield* visit(slotIndex + 1)

      mainCounts[key] -= 1
      if (mainCounts[key] === 0) {
        delete mainCounts[key]
      }
      addEchoStat(row, key, -value)
    }
    addEchoStat(row, echo.mainStats.primary.key, echo.mainStats.primary.value)
    primaryStats[slotIndex] = { ...echo.mainStats.primary }
  }

  yield* visit(0)
}

let benchmarkProbeValues: Record<string, number> | null = null

export function getBenchmarkProbeValues(): Record<string, number> {
  if (benchmarkProbeValues) return benchmarkProbeValues
  const legalMainValues: Record<string, number> = {}
  for (const stats of Object.values(ECHO_MAIN_STATS)) {
    for (const [key, value] of Object.entries(stats)) {
      legalMainValues[key] = Math.max(legalMainValues[key] ?? 0, value)
    }
  }
  const probeValues: Record<string, number> = { ...legalMainValues }
  for (const key of SUBSTAT_KEYS) {
    const maxRoll = getSbstStepP(key).at(-1) ?? 0
    probeValues[key] = Math.max(probeValues[key] ?? 0, maxRoll)
  }
  benchmarkProbeValues = probeValues
  return probeValues
}

export function findUsefulStats(
  frame: BenchmarkEchoFrame,
  mainsOnly: Float32Array,
): Set<string> {
  return new Set(findUsefulStatImpacts(frame, mainsOnly).map((entry) => entry.key))
}

export function findUsefulStatImpacts(
  frame: BenchmarkEchoFrame,
  mainsOnly: Float32Array,
): Array<{ key: string; impact: number }> {
  const probe = mainsOnly.slice()
  for (let index = 0; index < frame.echoes.length; index += 1) {
    const primary = frame.echoes[index].mainStats.primary
    const row = probe.subarray(index * ECHO_STAT_STRIDE, (index + 1) * ECHO_STAT_STRIDE)
    addEchoStat(row, primary.key, -primary.value)
  }

  const probeValues = getBenchmarkProbeValues()

  for (const [key, value] of Object.entries(probeValues)) {
    if (value > 0) {
      addStatTotal(probe, key, value)
    }
  }
  const fullDamage = frame.score(probe, frame.sets)
  const epsilon = Math.max(0.000001, Math.abs(fullDamage) * 1e-9)
  const impacts: Array<{ key: string; impact: number }> = []
  // Reuse one scratch buffer across probe keys instead of allocating a fresh
  // `probe.slice()` per key (~20 throwaway Float32Arrays/frame x ~4500 frames).
  // `scratch.set(probe)` reproduces the bytes of `probe.slice()` exactly, so the
  // resulting useful impact list is byte-identical to the per-key-allocation
  // version before normalization.
  const scratch = new Float32Array(probe.length)
  for (const [key, value] of Object.entries(probeValues)) {
    if (value <= 0) continue
    scratch.set(probe)
    addStatTotal(scratch, key, -value)
    const delta = Math.abs(fullDamage - frame.score(scratch, frame.sets))
    if (delta > epsilon) {
      impacts.push({
        key,
        impact: delta / Math.max(1, Math.abs(fullDamage)),
      })
    }
  }
  return impacts
}

export function makeBenchmarkEchoFrame(
  ctx: SuggestContext,
  echoes: EchoInstance[],
  mainEchoBuffs: Float32Array,
  setPlan: SetPlanEntry[] = [],
): BenchmarkEchoFrame {
  const { stats, sets, kinds } = encEchoRows(echoes, ctx.selectedSkill, 'self')
  const comboIds = Int32Array.from(echoes.map((_, index) => index))
  const mainIndex = Math.max(0, echoes.findIndex((echo) => echo.mainEcho))
  const score = (buffer: Float32Array, setRows = sets) =>
    scoreStats(ctx, buffer, setRows, kinds, comboIds, mainEchoBuffs, mainIndex)

  return {
    echoes,
    setPlan,
    stats,
    sets,
    kinds,
    comboIds,
    mainEchoBuffs,
    mainIndex,
    score,
  }
}
