/*
  Author: Runor Ewhro
  Description: Builds an echo loadout from explicit quick setup controls:
               echo count, slot costs/main stats, Sonata plan, main echo,
               and repeated substat templates.
*/

import type { EchoDef } from '@/domain/entities/catalog.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { getEchoById, listChsByCos } from '@/domain/services/echoCatalogService.ts'
import {
  ECHO_MAIN_STATS,
  SUBSTAT_KEYS,
  getSbstStepP,
  snapToNrstSb,
} from '@/data/gameData/catalog/echoStats.ts'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import { cmptSetCnts, mkDefEchoNst } from '@/modules/calculator/features/echoes/lib/echoPane.ts'

export const QUICK_SLOT_COUNT = 5
export const QUICK_COSTS = [1, 3, 4] as const

const MAX_COST = 12
const DEFAULT_COSTS = [4, 3, 3, 1, 1]

export interface QuickSubstat {
  key: string
  value: number
}

export interface QuickSubstatGroup {
  count: number
  substats: QuickSubstat[]
}

export interface QuickSlot {
  cost: number
  mainStat: string | null
}

export interface SetPreference {
  setId: number
  count: number
}

export interface QuickSetupConfig {
  echoCount: number
  mainEchoId: string | null
  setPreferences: SetPreference[]
  slots: QuickSlot[]
  substatGroups: QuickSubstatGroup[]
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function pickRandom<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[Math.floor(Math.random() * items.length)] : undefined
}

function shuffle<T>(items: readonly T[]): T[] {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
  }
  return next
}

function validCost(value: number | null | undefined, fallback: number): number {
  return QUICK_COSTS.includes(value as (typeof QUICK_COSTS)[number])
    ? Number(value)
    : fallback
}

function emptySlots(): QuickSlot[] {
  return Array.from({ length: QUICK_SLOT_COUNT }, (_, index) => ({
    cost: DEFAULT_COSTS[index] ?? 1,
    mainStat: null,
  }))
}

function mainStatFits(cost: number, mainStat: string | null | undefined): boolean {
  return !mainStat || ECHO_MAIN_STATS[cost]?.[mainStat] != null
}

function echoPool(cost: number, setId: number | null): EchoDef[] {
  const byCost = listChsByCos(cost)
  return setId == null ? byCost : byCost.filter((echo) => echo.sets.includes(setId))
}

function firstFilledCount(echoes: Array<EchoInstance | null>): number {
  let count = 0
  for (const echo of echoes.slice(0, QUICK_SLOT_COUNT)) {
    if (!echo) {
      break
    }
    count += 1
  }
  return count
}

function subSig(substats: Record<string, number> | undefined): string {
  return Object.entries(substats ?? {})
    .filter(([key]) => SUBSTAT_KEYS.includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${snapToNrstSb(key, value)}`)
    .join('|')
}

function substatsFromSig(signature: string): QuickSubstat[] {
  if (!signature) {
    return []
  }

  return signature.split('|')
    .map((part) => {
      const [key, rawValue] = part.split(':')
      return { key, value: Number(rawValue) }
    })
    .filter((entry) => entry.key && Number.isFinite(entry.value))
}

function groupsFromEchoes(echoes: Array<EchoInstance | null>): QuickSubstatGroup[] {
  const groups = new Map<string, number>()

  for (const echo of echoes.slice(0, QUICK_SLOT_COUNT)) {
    if (!echo) {
      continue
    }

    const signature = subSig(echo.substats)
    if (!signature) {
      continue
    }

    groups.set(signature, (groups.get(signature) ?? 0) + 1)
  }

  return Array.from(groups, ([signature, count]) => ({
    count: clampInt(count, 1, QUICK_SLOT_COUNT),
    substats: substatsFromSig(signature),
  })).slice(0, QUICK_SLOT_COUNT)
}

function setPlanFromEchoes(echoes: Array<EchoInstance | null>, echoCount: number): SetPreference[] {
  const counts = cmptSetCnts(echoes.slice(0, QUICK_SLOT_COUNT))
  return normSetPlan(
    Object.entries(counts)
      .map(([setId, count]) => ({ setId: Number(setId), count }))
      .filter((pref) => pref.count > 0),
    echoCount,
  )
}

export function makeQuickConfig(echoes?: Array<EchoInstance | null>): QuickSetupConfig {
  const slots = emptySlots()

  if (!echoes) {
    return {
      echoCount: QUICK_SLOT_COUNT,
      mainEchoId: null,
      setPreferences: [],
      slots,
      substatGroups: [],
    }
  }

  const echoCount = firstFilledCount(echoes) || QUICK_SLOT_COUNT
  echoes.slice(0, QUICK_SLOT_COUNT).forEach((echo, index) => {
    if (!echo) {
      return
    }

    const definition = getEchoById(echo.id)
    const cost = validCost(definition?.cost, slots[index].cost)
    slots[index] = {
      cost,
      mainStat: mainStatFits(cost, echo.mainStats.primary.key)
        ? echo.mainStats.primary.key
        : null,
    }
  })

  return fitQuickConfig({
    echoCount,
    mainEchoId: echoes[0]?.id ?? null,
    setPreferences: setPlanFromEchoes(echoes, echoCount),
    slots,
    substatGroups: groupsFromEchoes(echoes),
  })
}

export function setCountOptions(setId: number, maxPieces = QUICK_SLOT_COUNT): number[] {
  const definition = ECHO_SET_DEFS.find((entry) => entry.id === setId)
  if (!definition || maxPieces <= 0) {
    return []
  }

  const options = definition.setMax === 1
    ? [1]
    : definition.setMax === 3
      ? [3]
      : [2, 5]

  return options.filter((count) => count <= maxPieces)
}

export function normSetPlan(
  preferences: SetPreference[],
  maxPieces = QUICK_SLOT_COUNT,
): SetPreference[] {
  const seen = new Set<number>()
  const next: SetPreference[] = []

  for (const pref of preferences) {
    if (seen.has(pref.setId) || next.length >= 3) {
      continue
    }

    const counts = setCountOptions(pref.setId, maxPieces)
    if (counts.length === 0) {
      continue
    }

    const count = counts.includes(pref.count)
      ? pref.count
      : counts.reduce((best, cur) => (
        Math.abs(cur - pref.count) < Math.abs(best - pref.count) ? cur : best
      ))

    seen.add(pref.setId)
    next.push({ setId: pref.setId, count })
  }

  let total = next.reduce((sum, pref) => sum + pref.count, 0)
  while (total > maxPieces && next.length > 0) {
    next.pop()
    total = next.reduce((sum, pref) => sum + pref.count, 0)
  }

  return next
}

function normSlots(config: QuickSetupConfig, echoCount: number): QuickSlot[] {
  const slots = Array.from({ length: QUICK_SLOT_COUNT }, (_, index) => {
    const raw = config.slots[index]
    const cost = validCost(raw?.cost, DEFAULT_COSTS[index] ?? 1)
    return {
      cost,
      mainStat: mainStatFits(cost, raw?.mainStat) ? raw?.mainStat ?? null : null,
    }
  })

  const mainEcho = config.mainEchoId ? getEchoById(config.mainEchoId) : null
  if (mainEcho && echoCount > 0) {
    slots[0] = {
      cost: validCost(mainEcho.cost, slots[0].cost),
      mainStat: mainStatFits(mainEcho.cost, slots[0].mainStat) ? slots[0].mainStat : null,
    }
  }

  for (let index = echoCount - 1; index >= 0; index -= 1) {
    while (slots.slice(0, echoCount).reduce((sum, slot) => sum + slot.cost, 0) > MAX_COST) {
      const nextCost = slots[index].cost === 4 ? 3 : slots[index].cost === 3 ? 1 : null
      if (nextCost == null || (index === 0 && mainEcho)) {
        break
      }
      slots[index] = {
        cost: nextCost,
        mainStat: mainStatFits(nextCost, slots[index].mainStat) ? slots[index].mainStat : null,
      }
    }
  }

  return slots
}

function normSubGroups(groups: QuickSubstatGroup[], echoCount: number): QuickSubstatGroup[] {
  const out: QuickSubstatGroup[] = []
  let used = 0

  for (const group of groups.slice(0, QUICK_SLOT_COUNT)) {
    if (used >= echoCount) {
      break
    }

    const count = clampInt(group.count, 1, echoCount - used)
    const substats = group.substats
      .filter((entry, index, list) =>
        SUBSTAT_KEYS.includes(entry.key) &&
        list.findIndex((other) => other.key === entry.key) === index,
      )
      .slice(0, 5)
      .map((entry) => ({ key: entry.key, value: snapToNrstSb(entry.key, entry.value) }))

    out.push({ count, substats })
    used += count
  }

  return out
}

export function fitQuickConfig(config: QuickSetupConfig): QuickSetupConfig {
  const echoCount = clampInt(config.echoCount, 1, QUICK_SLOT_COUNT)
  const slots = normSlots(config, echoCount)
  return {
    echoCount,
    mainEchoId: echoCount > 0 ? config.mainEchoId : null,
    setPreferences: normSetPlan(config.setPreferences, echoCount),
    slots,
    substatGroups: normSubGroups(config.substatGroups, echoCount),
  }
}

export function maxSubCount(config: QuickSetupConfig, groupIndex: number): number {
  const fitted = fitQuickConfig(config)
  if (groupIndex < 0 || groupIndex >= fitted.substatGroups.length) {
    return 1
  }

  return Math.max(1, fitted.echoCount - Math.max(0, fitted.substatGroups.length - 1))
}

export function setSubCount(
  config: QuickSetupConfig,
  groupIndex: number,
  count: number,
): QuickSetupConfig {
  const fitted = fitQuickConfig(config)
  if (groupIndex < 0 || groupIndex >= fitted.substatGroups.length) {
    return fitted
  }

  const groups = fitted.substatGroups.map((group) => ({
    ...group,
    substats: group.substats.map((entry) => ({ ...entry })),
  }))
  groups[groupIndex].count = clampInt(count, 1, maxSubCount(fitted, groupIndex))

  let excess = groups.reduce((sum, group) => sum + group.count, 0) - fitted.echoCount
  while (excess > 0) {
    const donorIndex = groups.reduce((best, group, index) => {
      if (index === groupIndex || group.count <= 1) {
        return best
      }
      if (best < 0 || group.count > groups[best].count) {
        return index
      }
      return best
    }, -1)

    if (donorIndex < 0) {
      break
    }

    const moved = Math.min(excess, groups[donorIndex].count - 1)
    groups[donorIndex].count -= moved
    excess -= moved
  }

  return fitQuickConfig({ ...fitted, substatGroups: groups })
}

export function quickCostOptions(config: QuickSetupConfig, slotIndex: number): number[] {
  const fitted = fitQuickConfig(config)
  if (slotIndex >= fitted.echoCount) {
    return [...QUICK_COSTS]
  }

  const mainEcho = fitted.mainEchoId ? getEchoById(fitted.mainEchoId) : null
  if (slotIndex === 0 && mainEcho) {
    return [mainEcho.cost].filter((cost) => QUICK_COSTS.includes(cost as (typeof QUICK_COSTS)[number]))
  }

  return QUICK_COSTS.filter((cost) => {
    const slots = fitted.slots.map((slot, index) => (index === slotIndex ? { ...slot, cost } : slot))
    return slots.slice(0, fitted.echoCount).reduce((sum, slot) => sum + slot.cost, 0) <= MAX_COST
  })
}

export function quickMainStatKeys(config: QuickSetupConfig, slotIndex: number): string[] {
  const fitted = fitQuickConfig(config)
  const cost = fitted.slots[slotIndex]?.cost ?? 1
  return Object.keys(ECHO_MAIN_STATS[cost] ?? {})
}

function setPieces(setPreferences: SetPreference[], echoCount: number): number[] {
  return normSetPlan(setPreferences, echoCount)
    .flatMap((pref) => Array.from({ length: pref.count }, () => pref.setId))
}

function slotCanUseSet(
  cost: number,
  slotIndex: number,
  setId: number,
  config: QuickSetupConfig,
): boolean {
  if (slotIndex === 0 && config.mainEchoId) {
    return Boolean(getEchoById(config.mainEchoId)?.sets.includes(setId))
  }

  return echoPool(cost, setId).length > 0
}

function assignSetPieces(
  pieces: number[],
  costs: readonly number[],
  fitsSlot: (slotIndex: number, setId: number) => boolean,
): Array<number | null> | null {
  const plan: Array<number | null> = Array.from({ length: costs.length }, () => null)
  if (pieces.length === 0) {
    return plan
  }

  const orderedPieces = shuffle(pieces).sort((left, right) => {
    const leftSlots = costs.filter((_, index) => fitsSlot(index, left)).length
    const rightSlots = costs.filter((_, index) => fitsSlot(index, right)).length
    return leftSlots - rightSlots
  })

  function assign(pieceIndex: number): boolean {
    if (pieceIndex >= orderedPieces.length) {
      return true
    }

    const setId = orderedPieces[pieceIndex]
    for (const slotIndex of shuffle(Array.from({ length: costs.length }, (_, index) => index))) {
      if (plan[slotIndex] != null || !fitsSlot(slotIndex, setId)) {
        continue
      }

      plan[slotIndex] = setId
      if (assign(pieceIndex + 1)) {
        return true
      }
      plan[slotIndex] = null
    }

    return false
  }

  return assign(0) ? plan : null
}

function assignSets(costs: number[], config: QuickSetupConfig): Array<number | null> | null {
  return assignSetPieces(
    setPieces(config.setPreferences, config.echoCount),
    costs,
    (slotIndex, setId) => slotCanUseSet(costs[slotIndex], slotIndex, setId, config),
  )
}

function setFitsSlot(
  costs: readonly number[],
  slotIndex: number,
  setId: number,
  mainEcho: EchoDef,
): boolean {
  const cost = costs[slotIndex]
  if (slotIndex === 0) {
    return mainEcho.cost === cost && mainEcho.sets.includes(setId)
  }

  return echoPool(cost, setId).length > 0
}

export function canMainEchoFitSetPlan(
  mainEchoId: string | null | undefined,
  setPreferences: SetPreference[],
  costs: readonly number[],
): boolean {
  if (!mainEchoId) {
    return true
  }

  const mainEcho = getEchoById(mainEchoId)
  if (!mainEcho || costs.length === 0 || mainEcho.cost !== costs[0]) {
    return false
  }
  const pinnedMain = mainEcho

  const pieces = normSetPlan(setPreferences, costs.length)
    .flatMap((pref) => Array.from({ length: pref.count }, () => pref.setId))
  if (pieces.length === 0) {
    return true
  }

  return assignSetPieces(
    pieces,
    costs,
    (slotIndex, setId) => setFitsSlot(costs, slotIndex, setId, pinnedMain),
  ) != null
}

export function expandSetPlan(
  setPreferences: SetPreference[],
  costs?: number[],
  config?: QuickSetupConfig,
): Array<number | null> {
  if (costs && config) {
    return assignSets(costs, { ...config, setPreferences }) ?? Array.from({ length: costs.length }, () => null)
  }

  const plan: Array<number | null> = Array.from({ length: QUICK_SLOT_COUNT }, () => null)
  setPieces(setPreferences, QUICK_SLOT_COUNT).forEach((setId, index) => {
    if (index < plan.length) {
      plan[index] = setId
    }
  })
  return plan
}

function rollSubstatValue(key: string): number {
  const steps = getSbstStepP(key)
  return steps.length > 0 ? (pickRandom(steps) ?? steps[steps.length - 1]) : 0
}

export function buildSubstats(pinned: QuickSubstat[]): Record<string, number> {
  const out: Record<string, number> = {}
  const used = new Set<string>()

  for (const { key, value } of pinned) {
    if (!key || used.has(key) || !SUBSTAT_KEYS.includes(key)) {
      continue
    }

    out[key] = snapToNrstSb(key, value)
    used.add(key)
    if (used.size >= 5) {
      return out
    }
  }

  const pool = SUBSTAT_KEYS.filter((key) => !used.has(key))
  while (used.size < 5 && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length)
    const [key] = pool.splice(index, 1)
    out[key] = rollSubstatValue(key)
    used.add(key)
  }

  return out
}

function buildSubstatPlan(config: QuickSetupConfig): Array<Record<string, number>> {
  const plan = config.substatGroups.flatMap((group) =>
    Array.from({ length: group.count }, () => buildSubstats(group.substats)),
  )

  while (plan.length < config.echoCount) {
    plan.push(buildSubstats([]))
  }

  return plan.slice(0, config.echoCount)
}

function chooseEcho(
  cost: number,
  setId: number | null,
  usedBySet: Map<number, Set<string>>,
): EchoDef | null {
  const pool = echoPool(cost, setId)
  const used = setId == null ? null : usedBySet.get(setId)
  const freshPool = used ? pool.filter((echo) => !used.has(echo.id)) : pool

  return pickRandom(freshPool.length > 0 ? freshPool : pool) ?? null
}

function markUsed(echoId: string, setId: number, usedBySet: Map<number, Set<string>>): void {
  const used = usedBySet.get(setId) ?? new Set<string>()
  used.add(echoId)
  usedBySet.set(setId, used)
}

function resolveEchoDef(
  cost: number,
  slotIndex: number,
  setId: number | null,
  config: QuickSetupConfig,
  usedBySet: Map<number, Set<string>>,
): EchoDef | null {
  if (slotIndex === 0 && config.mainEchoId) {
    const mainEcho = getEchoById(config.mainEchoId)
    if (mainEcho?.cost === cost && (setId == null || mainEcho.sets.includes(setId))) {
      return mainEcho
    }
    return null
  }

  return chooseEcho(cost, setId, usedBySet)
}

function resolveSet(echo: EchoDef, requestedSet: number | null): number {
  if (requestedSet != null && echo.sets.includes(requestedSet)) {
    return requestedSet
  }

  return echo.sets[0] ?? 0
}

function resolveMainStat(cost: number, wanted: string | null | undefined, fallback: string): string {
  const options = ECHO_MAIN_STATS[cost] ?? {}
  if (wanted && options[wanted] != null) {
    return wanted
  }

  return pickRandom(Object.keys(options)) ?? fallback
}

function buildSlot(
  cost: number,
  slotIndex: number,
  config: QuickSetupConfig,
  plan: Array<number | null>,
  substats: Record<string, number>,
  usedBySet: Map<number, Set<string>>,
): EchoInstance | null {
  const requestedSet = plan[slotIndex] ?? null
  const echo = resolveEchoDef(cost, slotIndex, requestedSet, config, usedBySet)
  if (!echo) {
    return null
  }

  const base = mkDefEchoNst(echo.id, slotIndex, null)
  if (!base) {
    return null
  }

  const set = resolveSet(echo, requestedSet)
  const primaryKey = resolveMainStat(cost, config.slots[slotIndex]?.mainStat, base.mainStats.primary.key)
  const primaryValue = ECHO_MAIN_STATS[cost]?.[primaryKey] ?? base.mainStats.primary.value

  if (set > 0) {
    markUsed(echo.id, set, usedBySet)
  }

  return {
    ...base,
    set,
    mainStats: {
      primary: { key: primaryKey, value: primaryValue },
      secondary: { ...base.mainStats.secondary },
    },
    substats: { ...substats },
  }
}

function rollBuild(config: QuickSetupConfig): EchoInstance[] | null {
  const costs = config.slots.slice(0, config.echoCount).map((slot) => slot.cost)
  const mainEchoId = config.mainEchoId && canMainEchoFitSetPlan(config.mainEchoId, config.setPreferences, costs)
    ? config.mainEchoId
    : null
  const buildConfig = mainEchoId !== config.mainEchoId
    ? { ...config, mainEchoId }
    : config
  const setPlan = assignSets(costs, buildConfig)
  if (!setPlan) {
    return null
  }

  const substatPlan = buildSubstatPlan(buildConfig)
  const usedBySet = new Map<number, Set<string>>()
  const echoes = costs.map((cost, index) =>
    buildSlot(cost, index, buildConfig, setPlan, substatPlan[index] ?? {}, usedBySet),
  )

  return echoes.every((echo): echo is EchoInstance => Boolean(echo)) ? echoes : null
}

export function generateQuickBuild(config: QuickSetupConfig): Array<EchoInstance | null> {
  const normalizedConfig = fitQuickConfig(config)

  const echoes = rollBuild(normalizedConfig)
  if (echoes) {
    return [
      ...echoes,
      ...Array.from({ length: QUICK_SLOT_COUNT - echoes.length }, () => null),
    ]
  }

  const fallback = rollBuild({ ...normalizedConfig, setPreferences: [] })
  return fallback
    ? [...fallback, ...Array.from({ length: QUICK_SLOT_COUNT - fallback.length }, () => null)]
    : Array.from({ length: QUICK_SLOT_COUNT }, () => null)
}
