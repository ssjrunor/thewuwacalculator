/*
  Author: Runor Ewhro
  Description: builds, mutates, and validates durable main-stat and set-plan
               suggestion Echo loadouts.
*/

import type { EchoDef } from '@/domain/entities/catalog'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import { getEchoById, getEchoSets, listEchoes, listChsByCos } from '@/domain/services/echoCatalogService'
import {
  ECHO_MAIN_STATS,
  ECHO_SIDE_STATS,
} from '@/data/gameData/catalog/echoStats'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'
import type { SetPlanEntry } from '@/engine/suggestions/types'
import { MAIN_STAT_IDS } from '@/engine/suggestions/MAIN_STAT_FILTER_ORDER.ts'

// elemental bonus main stats are handled as a grouped "bonus" filter,
// but we still need to know the individual keys when resolving the best one.
const ELEMENT_KEYS = new Set(['aero', 'glacio', 'fusion', 'spectro', 'havoc', 'electro'])

// 3-piece sets behave differently from normal 2/5-piece sets when checking
// whether accidental extra set activations need to be broken up.
const THRPCSETIDS = new Set(
    ECHO_SET_DEFS.filter((entry) => entry.setMax === 3).map((entry) => entry.id),
)

export type SuggMainStat = (typeof MAIN_STAT_IDS)[number]

export interface SuggMainStsc {
  allowedFilter: Set<SuggMainStat>
  selBonus: string | null
}

type SetCostAvailability = Map<number, Map<number, Set<string>>>
let setAvailCache: SetCostAvailability | null = null
const setPlanCache = new Map<number, SetPlanEntry[][]>()

function getSetAvail(): SetCostAvailability {
  if (setAvailCache) return setAvailCache

  const availability: SetCostAvailability = new Map()
  for (const echo of listEchoes()) {
    for (const setId of echo.sets) {
      const byCost = availability.get(setId) ?? new Map<number, Set<string>>()
      const ids = byCost.get(echo.cost) ?? new Set<string>()
      ids.add(echo.id)
      byCost.set(echo.cost, ids)
      availability.set(setId, byCost)
    }
  }
  setAvailCache = availability
  return availability
}

// resolve the catalog cost for a runtime echo instance
function getEchoCost(echo: EchoInstance | null | undefined): number | null {
  if (!echo) {
    return null
  }

  return getEchoById(echo.id)?.cost ?? null
}

// clone an echo and assign a fresh uid so suggestion outputs remain distinct
function cloneEchoWit(echo: EchoInstance, slotIndex: number): EchoInstance {
  return {
    uid: makeEchoUid(),
    id: echo.id,
    set: echo.set,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { ...echo.mainStats.primary },
      secondary: { ...echo.mainStats.secondary },
    },
    substats: { ...echo.substats },
  }
}

// build a brand-new echo instance from a catalog definition,
// while allowing the caller to force set, primary stat, and substats
function mkEchoNstnyk(
    definition: EchoDef,
    options: {
      slotIndex: number
      setId?: number | null
      primaryKey: string
      substats?: Record<string, number>
    },
): EchoInstance {
  const secondary = ECHO_SIDE_STATS[definition.cost]

  return {
    uid: makeEchoUid(),
    id: definition.id,
    set: options.setId && definition.sets.includes(options.setId)
        ? options.setId
        : definition.sets[0] ?? 0,
    mainEcho: options.slotIndex === 0,
    mainStats: {
      primary: {
        key: options.primaryKey,
        value: ECHO_MAIN_STATS[definition.cost]?.[options.primaryKey] ?? 0,
      },
      secondary: {
        key: secondary?.key ?? 'atkFlat',
        value: secondary?.value ?? 0,
      },
    },
    substats: { ...(options.substats ?? {}) },
  }
}

// convert internal stat keys into main-stat filter labels
function mapWghtKeyei(
    key: string,
): SuggMainStat | null {
  if (key === 'atkPercent') return 'atk%'
  if (key === 'hpPercent') return 'hp%'
  if (key === 'defPercent') return 'def%'
  if (key === 'energyRegen') return 'er'
  if (key === 'critRate') return 'cr'
  if (key === 'critDmg') return 'cd'
  if (key === 'healingBonus') return 'healing'
  if (ELEMENT_KEYS.has(key)) return 'bonus'
  return null
}

// derive the allowed main-stat filter set from optimizer weights.
// elemental bonuses are collapsed into a single filter, but the strongest
// element is still remembered so later picks can favor the correct one.
export function derSuggMainS(
    weights: OptStatWeight,
    resonatorId: string,
): SuggMainStsc {
  const allowedFilter = new Set<SuggMainStat>()
  let selectedBonus: string | null = null
  let bestBnsWght = 0

  for (const [key, value] of Object.entries(weights)) {
    if ((value ?? 0) <= 0) {
      continue
    }

    const filterKey = mapWghtKeyei(key)
    if (filterKey) {
      allowedFilter.add(filterKey)
    }

    // among all element bonus keys, keep the one with the largest weight
    if (ELEMENT_KEYS.has(key) && (value ?? 0) > bestBnsWght) {
      bestBnsWght = value ?? 0
      selectedBonus = key
    }
  }

  // special-case characters that often want ER in the option pool
  const numericId = Number.parseInt(resonatorId, 10)
  if (numericId === 1206 || numericId === 1209 || numericId === 1412 || numericId === 1505 || numericId == 1110) {
    allowedFilter.add('er')
  }

  return {
    allowedFilter: allowedFilter,
    selBonus: selectedBonus,
  }
}

// build the valid primary main-stat choices for a given echo cost,
// filtered by the current suggestion config if one exists.
export function mkMainStatPt(
    cost: number,
    config: SuggMainStsc,
): Array<{ key: string; value: number }> {
  const valid = ECHO_MAIN_STATS[cost] ?? {}
  const entries = Object.entries(valid)

  // no filter means every valid main stat for this cost is allowed
  if (config.allowedFilter.size === 0) {
    return entries.map(([key, value]) => ({ key, value }))
  }

  const filtered = entries.filter(([key]) => {
    const filterKey = mapWghtKeyei(key)
    if (!filterKey || !config.allowedFilter.has(filterKey)) {
      return false
    }

    // when bonus is selected, only keep the strongest chosen element
    if (filterKey === 'bonus' && config.selBonus) {
      return key === config.selBonus
    }

    return true
  })

  // if filtering becomes too strict, fall back to all valid options
  return (filtered.length > 0 ? filtered : entries).map(([key, value]) => ({ key, value }))
}

// apply a chosen primary main-stat layout onto already-equipped echoes
// while preserving their identities, sets, and substats where possible.
export function applyMainSur(
    qppdChs: Array<EchoInstance | null>,
    prmrKeysBySl: Array<string | null>,
): Array<EchoInstance | null> {
  return qppdChs.map((echo, slotIndex) => {
    if (!echo) {
      return null
    }

    const key = prmrKeysBySl[slotIndex]
    if (!key) {
      return cloneEchoWit(echo, slotIndex)
    }

    const definition = getEchoById(echo.id)
    const cost = definition?.cost ?? getEchoCost(echo)
    if (!cost) {
      return cloneEchoWit(echo, slotIndex)
    }

    return {
      ...cloneEchoWit(echo, slotIndex),
      mainStats: {
        primary: {
          key,
          value: ECHO_MAIN_STATS[cost]?.[key] ?? echo.mainStats.primary.value,
        },
        secondary: {
          ...ECHO_SIDE_STATS[cost],
        },
      },
    }
  })
}

// expand a compact set plan like [{setId: 4, pieces: 2}] into a slot-aligned
// list of target set ids, attempting to keep the main echo inside a compatible
// planned set whenever possible.
function xpndSetPlanT(
    setPlan: SetPlanEntry[],
    qppdChs: Array<EchoInstance | null>,
    mainIndex = 0,
): Array<number | null> {
  const targets = new Array<number | null>(qppdChs.length).fill(null)
  if (setPlan.length === 0) {
    return targets
  }

  // flatten the requested piece counts into a simple ordered pool
  const pieces: number[] = []
  for (const entry of setPlan) {
    for (let index = 0; index < Math.max(0, entry.pieces); index += 1) {
      pieces.push(entry.setId)
    }
  }

  if (pieces.length === 0) {
    return targets
  }

  const nonNullSlots = qppdChs
      .map((echo, index) => (echo ? index : -1))
      .filter((index) => index >= 0)

  if (nonNullSlots.length === 0) {
    return targets
  }

  const mainEcho = qppdChs[mainIndex]
  // if the main echo can naturally support one of the requested sets,
  // try to reserve that set for slot 0 first.
  const mainSpprPlan = setPlan.find((entry) => (
      mainEcho && getEchoSets(mainEcho.id).includes(entry.setId) && entry.pieces > 0
  ))?.setId ?? null

  // Use the main Echo when its catalog definition supports the plan. Its
  // currently selected set must not influence plan assignment.
  const mustUseMain = mainSpprPlan != null || pieces.length >= nonNullSlots.length
  const rmnnPcs = [...pieces]
  const prfrNdcs: number[] = []

  if (mustUseMain && nonNullSlots.includes(mainIndex)) {
    prfrNdcs.push(mainIndex)

    if (mainSpprPlan != null) {
      const removeIndex = rmnnPcs.indexOf(mainSpprPlan)
      if (removeIndex >= 0) {
        targets[mainIndex] = mainSpprPlan
        rmnnPcs.splice(removeIndex, 1)
      }
    }
  }

  // after slot 0, fill remaining live slots in order
  for (const index of nonNullSlots) {
    if (index !== mainIndex) {
      prfrNdcs.push(index)
    }
  }

  let pieceIndex = 0
  for (const slotIndex of prfrNdcs) {
    if (targets[slotIndex] != null) {
      continue
    }
    if (pieceIndex >= rmnnPcs.length) {
      break
    }

    targets[slotIndex] = rmnnPcs[pieceIndex]
    pieceIndex += 1
  }

  return targets
}

// choose a replacement echo definition that matches both set and cost if possible
function pickTmplDefF(
    setId: number,
    cost: number | null,
    usedKeys: Set<string>,
): EchoDef | null {
  const candidates = (cost ? listChsByCos(cost) : listEchoes())
      .filter((entry) => entry.sets.includes(setId))

  // an id is only "used up" for THIS set; the same id is still free for others.
  const unused = candidates.filter((entry) => !usedKeys.has(echoSetKey(entry.id, setId)))
  const pool = unused.length > 0 ? unused : candidates

  return pool[0] ?? null
}

// choose a replacement echo definition that avoids activating forbidden sets
function pickRplcDef(
    cost: number | null,
    avoidSetIds: Set<number>,
    usedKeys: Set<string>,
): EchoDef | null {
  const candidates = (cost ? listChsByCos(cost) : listEchoes())
      .filter((entry) => entry.sets.every((setId) => !avoidSetIds.has(setId)))

  const unused = candidates.filter((entry) => !usedKeys.has(echoSetKey(entry.id, entry.sets[0] ?? 0)))
  const pool = unused.length > 0 ? unused : candidates

  return pool[0] ?? null
}

// after applying a plan, remove accidental over-activation of planned or unplanned sets
function normSetSlct(
    echoes: Array<EchoInstance | null>,
    setPlan: SetPlanEntry[],
    usedKeys: Set<string>,
): Array<EchoInstance | null> {
  const planCounts = new Map(setPlan.map((entry) => [entry.setId, entry.pieces]))
  const result = echoes.map((echo, slotIndex) => (
      echo ? cloneEchoWit(echo, slotIndex) : null
  ))

  const cntNdcsBySet = () => {
    const setMap = new Map<number, number[]>()

    result.forEach((echo, index) => {
      if (!echo) {
        return
      }

      const indices = setMap.get(echo.set) ?? []
      indices.push(index)
      setMap.set(echo.set, indices)
    })

    return setMap
  }

  // replace one echo in a problematic set with a same-cost echo
  // that avoids all currently planned sets plus the set being broken.
  const rplcAtNdx = (setIdToBreak: number, index: number) => {
    const original = result[index]
    if (!original) {
      return
    }

    const rplcDef = pickRplcDef(
        getEchoCost(original),
        new Set([...planCounts.keys(), setIdToBreak]),
        usedKeys,
    )

    if (!rplcDef) {
      return
    }

    usedKeys.add(echoSetKey(rplcDef.id, rplcDef.sets[0] ?? 0))

    result[index] = {
      ...mkEchoNstnyk(rplcDef, {
        slotIndex: index,
        setId: rplcDef.sets[0] ?? 0,
        primaryKey: original.mainStats.primary.key,
        substats: original.substats,
      }),
      mainStats: {
        primary: { ...original.mainStats.primary },
        secondary: { ...original.mainStats.secondary },
      },
    }
  }

  let counts = cntNdcsBySet()

  // first enforce exact or capped counts for sets explicitly in the plan
  for (const [setId, desired] of planCounts.entries()) {
    const indices = counts.get(setId) ?? []
    if (indices.length <= desired) {
      continue
    }

    let toRemove = indices.length - desired

    // prefer replacing non-main slots first
    for (const index of [...indices].sort((left, right) => Number(left === 0) - Number(right === 0))) {
      if (toRemove <= 0) {
        break
      }

      if (index === 0 && indices.length > 1) {
        continue
      }

      rplcAtNdx(setId, index)
      toRemove -= 1
    }
  }

  counts = cntNdcsBySet()

  // then break any accidental set activation for sets not in the plan
  for (const [setId, indices] of counts.entries()) {
    if (planCounts.has(setId)) {
      continue
    }

    const threshold = THRPCSETIDS.has(setId) ? 3 : 2
    const allowedMax = threshold - 1

    if (indices.length <= allowedMax) {
      continue
    }

    let toFix = indices.length - allowedMax

    for (const index of [...indices].sort((left, right) => Number(left === 0) - Number(right === 0))) {
      if (toFix <= 0) {
        break
      }

      if (index === 0 && indices.length > 1) {
        continue
      }

      rplcAtNdx(setId, index)
      toFix -= 1
    }
  }

  return result
}

function echoSetKey(id: string, set: number): string {
  return `${id}|${set}`
}

// apply a set plan onto the current equipped echoes, preserving
// originals when compatible and swapping in matching templates when needed.
export function applySetPlan(
    setPlan: SetPlanEntry[],
    qppdChs: Array<EchoInstance | null>,
): Array<EchoInstance | null> {
  const targetSets = xpndSetPlanT(setPlan, qppdChs)
  const usedKeys = new Set<string>()
  const result: Array<EchoInstance | null> = []

  for (let slotIndex = 0; slotIndex < qppdChs.length; slotIndex += 1) {
    const original = qppdChs[slotIndex]
    const targetSet = targetSets[slotIndex]

    if (!original) {
      result.push(null)
      continue
    }

    // no set assignment for this slot means keep the original echo body
    if (targetSet == null) {
      result.push(cloneEchoWit(original, slotIndex))
      usedKeys.add(echoSetKey(original.id, original.set))
      continue
    }

    const originalSets = getEchoSets(original.id)

    // if the original echo already supports the target set and that id|set pair
    // hasn't been reused, keep it and just rewrite the active set id.
    if (originalSets.includes(targetSet) && !usedKeys.has(echoSetKey(original.id, targetSet))) {
      result.push({
        ...cloneEchoWit(original, slotIndex),
        set: targetSet,
      })
      usedKeys.add(echoSetKey(original.id, targetSet))
      continue
    }

    // otherwise swap in a compatible template of the same cost if possible
    const rplcDef = pickTmplDefF(targetSet, getEchoCost(original), usedKeys)
    if (!rplcDef) {
      // final fallback: keep the original echo and force the set id anyway
      result.push({
        ...cloneEchoWit(original, slotIndex),
        set: targetSet,
      })
      continue
    }

    usedKeys.add(echoSetKey(rplcDef.id, targetSet))
    result.push({
      ...mkEchoNstnyk(rplcDef, {
        slotIndex,
        setId: targetSet,
        primaryKey: original.mainStats.primary.key,
        substats: original.substats,
      }),
      mainStats: {
        primary: { ...original.mainStats.primary },
        secondary: { ...original.mainStats.secondary },
      },
    })
  }

  return normSetSlct(result, setPlan, usedKeys)
}

// verify whether a set plan can actually be realized on the current
// slot-count and catalog/cost constraints.
export function prepSetPlanFsb(
    qppdChs: Array<EchoInstance | null>,
): (setPlan: SetPlanEntry[]) => boolean {
  const slots = Array.isArray(qppdChs) ? qppdChs : []
  const slotCount = slots.length
  const slotsByCost = new Map<number, number>()
  for (const echo of slots) {
    const cost = getEchoCost(echo)
    if (!cost) {
      continue
    }
    slotsByCost.set(cost, (slotsByCost.get(cost) ?? 0) + 1)
  }
  const available = getSetAvail()

  return (setPlan: SetPlanEntry[]): boolean => {
    if (slotCount === 0 || setPlan.length === 0) return false
    const totalPieces = setPlan.reduce((sum, entry) => sum + Math.max(0, entry.pieces), 0)
    if (totalPieces > slotCount) return false

    for (const entry of setPlan) {
      const costMap = available.get(entry.setId)
      if (!costMap) return false

      let capacity = 0
      for (const [cost, ids] of costMap.entries()) {
        capacity += Math.min(slotsByCost.get(cost) ?? 0, ids.size)
      }
      if (capacity < entry.pieces) return false
    }
    return true
  }
}

export function isSetPlanFsb(
    setPlan: SetPlanEntry[],
    qppdChs: Array<EchoInstance | null>,
): boolean {
  return prepSetPlanFsb(qppdChs)(setPlan)
}

// enumerate all simple set-plan candidates allowed by the current slot count
export function mkSetPlanCnd(slotCount: number): SetPlanEntry[][] {
  const cached = setPlanCache.get(slotCount)
  if (cached) return cached

  const fivePcSetIds = ECHO_SET_DEFS
      .filter((entry) => entry.setMax === 5)
      .map((entry) => entry.id)

  const thrPcSetIds = ECHO_SET_DEFS
      .filter((entry) => entry.setMax === 3)
      .map((entry) => entry.id)

  const onePcSetIds = ECHO_SET_DEFS
      .filter((entry) => entry.setMax === 1)
      .map((entry) => entry.id)

  const plans: SetPlanEntry[][] = []

  // standalone 1pc plans
  for (const setId of onePcSetIds) {
    if (slotCount >= 1) {
      plans.push([{ setId, pieces: 1 }])
    }
  }

  // standalone 2pc / 5pc plans
  for (const setId of fivePcSetIds) {
    if (slotCount >= 2) {
      plans.push([{ setId, pieces: 2 }])
    }
    if (slotCount >= 5) {
      plans.push([{ setId, pieces: 5 }])
    }
  }

  // standalone 3pc plans
  for (const setId of thrPcSetIds) {
    if (slotCount >= 3) {
      plans.push([{ setId, pieces: 3 }])
    }
  }

  // two different 2pc plans
  for (let left = 0; left < fivePcSetIds.length; left += 1) {
    for (let right = left + 1; right < fivePcSetIds.length; right += 1) {
      if (slotCount >= 4) {
        plans.push([
          { setId: fivePcSetIds[left], pieces: 2 },
          { setId: fivePcSetIds[right], pieces: 2 },
        ])
      }
    }
  }

  // mixed 2pc + 3pc plans
  for (const fiveSetId of fivePcSetIds) {
    for (const threeSetId of thrPcSetIds) {
      if (slotCount >= 5) {
        plans.push([
          { setId: fiveSetId, pieces: 2 },
          { setId: threeSetId, pieces: 3 },
        ])
      }
    }
  }

  // mixed 1pc + other plans
  for (const oneSetId of onePcSetIds) {
    // 1pc + 5pc (2pc/5pc)
    for (const fiveSetId of fivePcSetIds) {
      if (slotCount >= 3) {
        plans.push([
          { setId: oneSetId, pieces: 1 },
          { setId: fiveSetId, pieces: 2 },
        ])
      }
      if (slotCount >= 6) { // not possible with 5 slots, but for completeness
        plans.push([
          { setId: oneSetId, pieces: 1 },
          { setId: fiveSetId, pieces: 5 },
        ])
      }
    }
    // 1pc + 3pc
    for (const threeSetId of thrPcSetIds) {
      if (slotCount >= 4) {
        plans.push([
          { setId: oneSetId, pieces: 1 },
          { setId: threeSetId, pieces: 3 },
        ])
      }
    }
    // 1pc + 2pc + 2pc
    for (let left = 0; left < fivePcSetIds.length; left += 1) {
      for (let right = left + 1; right < fivePcSetIds.length; right += 1) {
        if (slotCount >= 5) {
          plans.push([
            { setId: oneSetId, pieces: 1 },
            { setId: fivePcSetIds[left], pieces: 2 },
            { setId: fivePcSetIds[right], pieces: 2 },
          ])
        }
      }
    }
  }

  if (ECHO_SET_DEFS.length > 0) setPlanCache.set(slotCount, plans)
  return plans
}

// build a deterministic signature for only the main-stat layout of a loadout.
// this is useful for deduplication when only cost and main stats matter.
export function mkEchoMainSt(echoes: Array<EchoInstance | null>): string {
  return echoes
      .filter((echo): echo is EchoInstance => echo != null)
      .map((echo) => [
        getEchoCost(echo) ?? 0,
        echo.mainStats.primary.key,
        echo.mainStats.primary.value,
        echo.mainStats.secondary.key,
        echo.mainStats.secondary.value,
      ].join('::'))
      .sort()
      .join('||')
}
