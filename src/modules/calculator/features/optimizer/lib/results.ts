/*
  Author: Runor Ewhro
  Description: translates raw optimizer result rows into display-friendly
               structures for cards, stat summaries, and equip previews.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { cloneEchoFor } from '@/domain/entities/inventoryStorage.ts'
import {
  evalThryRsltS,
  evalOptBagcz,
  matThryRsltCh,
  resOptRsltCh,
} from '@/engine/optimizer/results/materialize.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService.ts'
import type {
  OptBagResult,
  OptRawResult,
  OptResultStats,
  PrepOptPay,
  TheoryResult,
  TheoryResultRow,
} from '@/engine/optimizer/types.ts'
import {
  normEchoLdt,
  smmrEchoLdt,
} from '@/modules/calculator/features/optimizer/lib/helpers.ts'
import type { OptDisplayRow } from '@/modules/calculator/features/optimizer/Row.tsx'

export interface LegOptRsltEn {
  damage: number
  uids: string[]
  stats: OptDisplayRow['stats']
}

export function plchRslt(): OptDisplayRow {
  return {
    damage: 0,
    stats: {
      atk: 0,
      hp: 0,
      def: 0,
      er: 0,
      cr: 0,
      cd: 0,
      bonus: 0,
      amp: 0,
    },
    costs: null,
    sets: [],
    mainEchoIcon: null,
    weaponIcon: null,
    weaponName: null,
  }
}

// resolve the chosen weapon (id, icon, name) for one result, if weapon search
// produced one. raw theory bag results carry an index into the run's weaponIds;
// materialized theory results carry the resolved weaponId directly.
function weaponDisplay(
    entry: OptBagResult | LegOptRsltEn | TheoryResult | TheoryResultRow,
    payload: PrepOptPay | null,
): { weaponIcon: string | null; weaponName: string | null } {
  let weaponId: string | null = null

  if (entry && typeof entry === 'object' && 'weaponId' in entry && entry.weaponId) {
    weaponId = entry.weaponId
  } else if (
      entry && typeof entry === 'object' && 'weapon' in entry &&
      typeof entry.weapon === 'number' && entry.weapon >= 0 &&
      payload && 'weaponIds' in payload && payload.weaponIds
  ) {
    weaponId = payload.weaponIds[entry.weapon] ?? null
  }

  if (!weaponId) {
    return { weaponIcon: null, weaponName: null }
  }

  const weapon = getWpnById(weaponId)
  return {
    weaponIcon: weapon?.icon ?? null,
    weaponName: weapon?.name ?? null,
  }
}

export function isLegRslt(entry: unknown): entry is LegOptRsltEn {
  if (!entry || typeof entry !== 'object') {
    return false
  }

  return Array.isArray((entry as { uids?: unknown }).uids)
}

function isThryRslt(entry: unknown): entry is TheoryResult {
  if (!entry || typeof entry !== 'object') {
    return false
  }

  return Array.isArray((entry as { echoes?: unknown }).echoes)
}

function isThryPay(payload: PrepOptPay | null): payload is Extract<PrepOptPay, { mode: 'theoryTarget' | 'theoryRotation' }> {
  return payload?.mode === 'theoryTarget' || payload?.mode === 'theoryRotation'
}

function isRawThry(entry: unknown): entry is OptRawResult {
  if (!entry || typeof entry !== 'object') {
    return false
  }

  const value = entry as Partial<OptRawResult>
  return Array.isArray((value as TheoryResultRow).ids) ||
      typeof (value as OptBagResult).i0 === 'number'
}

function isBagRslt(entry: unknown): entry is OptBagResult {
  return Boolean(entry && typeof entry === 'object' && typeof (entry as OptBagResult).i0 === 'number')
}

function cloneRsltChs(echoes: Array<EchoInstance | null>) {
  return normEchoLdt(
    echoes.map((echo, slotIndex) => (echo ? cloneEchoFor(echo, slotIndex) : null)),
  )
}

// resolve how many equipped pieces of a set actually clear an activation
// threshold (2/3/5 depending on the set's max), or null when none do. shared
// by the display badges and the facet extractor so both agree on the plan.
function effPieces(setId: number, count: number): number | null {
  const setDef = getEchoSetDe(setId)
  if (!setDef) {
    return null
  }

  if (setDef.setMax === 1) {
    return count >= 1 ? 1 : null
  }
  if (setDef.setMax === 3) {
    return count >= 3 ? 3 : null
  }
  return count >= 5 ? 5 : count >= 2 ? 2 : null
}

// threshold-met set plan as plain { id, count } entries, sorted for display
// (largest piece count first, then set id). icons are derived later by setBdgs.
function setPlanEntries(counts: Map<number, number>): Array<{ id: number; count: number }> {
  return Array.from(counts.entries())
    .flatMap(([id, count]) => {
      const pcs = effPieces(id, count)
      return pcs == null ? [] : [{ id, count: pcs }]
    })
    .sort((left, right) => right.count - left.count || left.id - right.id)
}

function setBdgs(counts: Map<number, number>) {
  return setPlanEntries(counts).map(({ id, count }) => ({
    id,
    count,
    icon: getSntSetIco(id),
  }))
}

// theory row cards only need the build identity: set plan, total cost, and
// fixed main echo. filler echo ids stay unresolved until preview/equip.
function thryBagSum(
    payload: Extract<PrepOptPay, { mode: 'theoryTarget' | 'theoryRotation' }>,
    result: OptBagResult,
) {
  const rowIds = [result.i0, result.i1, result.i2, result.i3, result.i4]
  const counts = new Map<number, number>()
  const costs: number[] = []

  for (const rowId of rowIds) {
    const row = payload.theoryRows[rowId]
    if (!row) {
      continue
    }

    counts.set(row.set, (counts.get(row.set) ?? 0) + 1)
    if (row.cost > 0) {
      costs.push(row.cost)
    }
  }

  costs.sort((a, b) => b - a)
  const mainId = payload.theoryRows[result.i0]?.id ?? null
  return {
    costs: costs.length > 0 ? costs : null,
    sets: setBdgs(counts),
    mainEchoIcon: mainId ? getEchoById(mainId)?.icon ?? null : null,
  }
}

function thryIdSum(result: TheoryResultRow) {
  const counts = new Map<number, number>()
  const costs: number[] = []

  for (let index = 0; index < result.ids.length; index += 1) {
    const id = result.ids[index]
    const setId = result.sets[index]
    if (setId != null) {
      counts.set(setId, (counts.get(setId) ?? 0) + 1)
    }
    if (id) {
      const echoCost = getEchoById(id)?.cost ?? 0
      if (echoCost > 0) {
        costs.push(echoCost)
      }
    }
  }

  costs.sort((a, b) => b - a)
  const mainId = result.ids[result.main] ?? null
  return {
    costs: costs.length > 0 ? costs : null,
    sets: setBdgs(counts),
    mainEchoIcon: mainId ? getEchoById(mainId)?.icon ?? null : null,
  }
}

interface RsltDsplCtx {
  invChsByUid: Map<string, EchoInstance>
  optResultEchoes: EchoInstance[]
  optResultData: PrepOptPay | null
}

// build one display row from a raw result entry, branching across the three
// row shapes (theory raw / materialized theory / legacy uid / bag index).
function dsplRowFor(
  entry: OptBagResult | LegOptRsltEn | TheoryResult | TheoryResultRow,
  ctx: RsltDsplCtx,
): OptDisplayRow {
  const { invChsByUid, optResultEchoes: ptmzRsltChs, optResultData: ptmzRsltPyld } = ctx
  const weapon = weaponDisplay(entry, ptmzRsltPyld)

  if (isThryPay(ptmzRsltPyld) && isRawThry(entry)) {
    const summary = isBagRslt(entry)
      ? thryBagSum(ptmzRsltPyld, entry)
      : thryIdSum(entry)
    return {
      damage: entry.damage,
      costs: summary.costs,
      sets: summary.sets,
      mainEchoIcon: summary.mainEchoIcon,
      ...weapon,
      stats: evalThryRsltS(ptmzRsltPyld, entry),
    }
  }

  if (isThryRslt(entry)) {
    const summary = smmrEchoLdt(entry.echoes)
    return {
      damage: entry.damage,
      costs: summary.costs,
      sets: summary.sets,
      mainEchoIcon: summary.mainEchoIcon,
      ...weapon,
      stats: entry.stats ?? null,
    }
  }

  if (isLegRslt(entry)) {
    const echoes = entry.uids.map((uid) => invChsByUid.get(uid) ?? null)
    const summary = smmrEchoLdt(echoes)
    return {
      damage: entry.damage,
      costs: summary.costs,
      sets: summary.sets,
      mainEchoIcon: summary.mainEchoIcon,
      ...weapon,
      stats: entry.stats ?? null,
    }
  }

  if (!isBagRslt(entry)) {
    return plchRslt()
  }

  const echoes = resOptRsltCh(ptmzRsltChs, entry)
  const summary = smmrEchoLdt(echoes)
  return {
    damage: entry.damage,
    costs: summary.costs,
    sets: summary.sets,
    mainEchoIcon: summary.mainEchoIcon,
    ...weapon,
    stats: ptmzRsltPyld
      ? evalOptBagcz(ptmzRsltPyld, entry)
      : null,
  }
}

export function vsblRslts(args: {
  optResults: Array<OptBagResult | LegOptRsltEn | TheoryResult | TheoryResultRow>
  pageStart: number
  pageEnd: number
  invChsByUid: Map<string, EchoInstance>
  optResultEchoes: EchoInstance[]
  optResultData: PrepOptPay | null
}): OptDisplayRow[] {
  const { optResults: ptmzRslt, pageEnd, pageStart, ...ctx } = args
  return ptmzRslt.slice(pageStart, pageEnd).map((entry) => dsplRowFor(entry, ctx))
}

// render rows for an explicit list of original result indices (the current
// page of a filtered/sorted view). missing indices fall back to a placeholder.
export function vsblRsltsAt(args: {
  optResults: Array<OptBagResult | LegOptRsltEn | TheoryResult | TheoryResultRow>
  indices: number[]
  invChsByUid: Map<string, EchoInstance>
  optResultEchoes: EchoInstance[]
  optResultData: PrepOptPay | null
}): OptDisplayRow[] {
  const { optResults: ptmzRslt, indices, ...ctx } = args
  return indices.map((index) => {
    const entry = ptmzRslt[index]
    return entry ? dsplRowFor(entry, ctx) : plchRslt()
  })
}

export function prvwChs(args: {
  optResults: Array<OptBagResult | LegOptRsltEn | TheoryResult | TheoryResultRow>
  rslvPrvwIdx: number | null
  invChsByUid: Map<string, EchoInstance>
  optResultEchoes: EchoInstance[]
  optResultData: PrepOptPay | null
  fllbChs: ReadonlyArray<EchoInstance | null | undefined>
}): Array<EchoInstance | null> {
  const {
    fllbChs: fllbChs,
    invChsByUid: invChsByUid,
    optResultEchoes: ptmzRsltChs,
    optResultData: ptmzRsltPyld,
    optResults: ptmzRslt,
    rslvPrvwIdx: rslvPrvwNdx,
  } = args

  if (rslvPrvwNdx == null) {
    return normEchoLdt(fllbChs)
  }

  const entry = ptmzRslt[rslvPrvwNdx]
  if (!entry) {
    return normEchoLdt(fllbChs)
  }

  if (isThryPay(ptmzRsltPyld) && isRawThry(entry)) {
    return normEchoLdt(matThryRsltCh(ptmzRsltPyld, entry) ?? [])
  }

  if (isThryRslt(entry)) {
    return normEchoLdt(entry.echoes)
  }

  if (isLegRslt(entry)) {
    return normEchoLdt(entry.uids.map((uid) => invChsByUid.get(uid) ?? null))
  }

  return isBagRslt(entry)
    ? normEchoLdt(resOptRsltCh(ptmzRsltChs, entry))
    : normEchoLdt(fllbChs)
}

export function rsltLdt(args: {
  optResults: Array<OptBagResult | LegOptRsltEn | TheoryResult | TheoryResultRow>
  index: number
  invChsByUid: Map<string, EchoInstance>
  optResultEchoes: EchoInstance[]
  optResultData: PrepOptPay | null
}): Array<EchoInstance | null> {
  const { index, invChsByUid: invChsByUid, optResultEchoes: ptmzRsltChs, optResultData: ptmzRsltPyld, optResults: ptmzRslt } = args
  const entry = ptmzRslt[index]
  if (!entry) {
    return normEchoLdt([])
  }

  if (isThryPay(ptmzRsltPyld) && isRawThry(entry)) {
    return cloneRsltChs(matThryRsltCh(ptmzRsltPyld, entry) ?? [])
  }

  if (isThryRslt(entry)) {
    return cloneRsltChs(entry.echoes)
  }

  if (isLegRslt(entry)) {
    return cloneRsltChs(entry.uids.map((uid) => invChsByUid.get(uid) ?? null))
  }

  return isBagRslt(entry)
    ? cloneRsltChs(resOptRsltCh(ptmzRsltChs, entry))
    : normEchoLdt([])
}

export type RsltEntry = OptBagResult | LegOptRsltEn | TheoryResult | TheoryResultRow

export interface ResultFacet {
  damage: number
  // echo catalog id of the main (slot-0) echo, '' when unresolved.
  mainId: string
  // sum of every equipped echo's cost.
  totalCost: number
  // threshold-met set plan, e.g. [{ id: 22, count: 2 }, { id: 14, count: 2 }].
  setBadges: Array<{ id: number; count: number }>
  // canonical set-plan key (sorted by set id), '' when no set activates.
  planKey: string
  // resolved stat line (atk/hp/def/er/cr/cd/bonus/amp), null when unevaluated.
  stats: OptResultStats | null
}

// canonical, order-independent string for a set plan so equal plans group and
// compare cheaply.
function planKeyOf(badges: Array<{ id: number; count: number }>): string {
  return [...badges]
    .sort((a, b) => a.id - b.id)
    .map((b) => `${b.id}:${b.count}`)
    .join('|')
}

function facetFromEchoes(echoes: Array<EchoInstance | null>): {
  mainId: string
  totalCost: number
  counts: Map<number, number>
} {
  const counts = new Map<number, number>()
  const seenIdsBySet = new Map<number, Set<string>>()
  let totalCost = 0

  for (const echo of echoes) {
    if (!echo) {
      continue
    }
    totalCost += getEchoById(echo.id)?.cost ?? 0

    // pieces count per sonata: a repeated echo id in one sonata counts once, the
    // same id in a different sonata counts again.
    let seenIds = seenIdsBySet.get(echo.set)
    if (!seenIds) {
      seenIds = new Set<string>()
      seenIdsBySet.set(echo.set, seenIds)
    }
    if (seenIds.has(echo.id)) {
      continue
    }
    seenIds.add(echo.id)
    counts.set(echo.set, (counts.get(echo.set) ?? 0) + 1)
  }

  return { mainId: echoes[0]?.id ?? '', totalCost, counts }
}

function facetFor(entry: RsltEntry, ctx: RsltDsplCtx): ResultFacet {
  const { invChsByUid, optResultEchoes: ptmzRsltChs, optResultData: ptmzRsltPyld } = ctx

  let mainId = ''
  let totalCost = 0
  let counts = new Map<number, number>()
  let stats: OptResultStats | null = null

  if (isThryPay(ptmzRsltPyld) && isRawThry(entry)) {
    stats = evalThryRsltS(ptmzRsltPyld, entry)
    if (isBagRslt(entry)) {
      const rowIds = [entry.i0, entry.i1, entry.i2, entry.i3, entry.i4]
      for (const rowId of rowIds) {
        const row = ptmzRsltPyld.theoryRows[rowId]
        if (!row) {
          continue
        }
        counts.set(row.set, (counts.get(row.set) ?? 0) + 1)
        if (row.cost > 0) {
          totalCost += row.cost
        }
      }
      mainId = ptmzRsltPyld.theoryRows[entry.i0]?.id ?? ''
    } else {
      for (let index = 0; index < entry.ids.length; index += 1) {
        const setId = entry.sets[index]
        if (setId != null) {
          counts.set(setId, (counts.get(setId) ?? 0) + 1)
        }
        const id = entry.ids[index]
        if (id) {
          totalCost += getEchoById(id)?.cost ?? 0
        }
      }
      mainId = entry.ids[entry.main] ?? ''
    }
  } else if (isThryRslt(entry)) {
    const summary = facetFromEchoes(entry.echoes)
    mainId = summary.mainId
    totalCost = summary.totalCost
    counts = summary.counts
    stats = entry.stats ?? null
  } else if (isLegRslt(entry)) {
    const summary = facetFromEchoes(entry.uids.map((uid) => invChsByUid.get(uid) ?? null))
    mainId = summary.mainId
    totalCost = summary.totalCost
    counts = summary.counts
    stats = entry.stats ?? null
  } else if (isBagRslt(entry)) {
    const summary = facetFromEchoes(resOptRsltCh(ptmzRsltChs, entry))
    mainId = summary.mainId
    totalCost = summary.totalCost
    counts = summary.counts
    stats = ptmzRsltPyld ? evalOptBagcz(ptmzRsltPyld, entry) : null
  }

  const setBadges = setPlanEntries(counts)
  return { damage: entry.damage, mainId, totalCost, setBadges, planKey: planKeyOf(setBadges), stats }
}

export function buildFacetTable(args: {
  optResults: RsltEntry[]
  invChsByUid: Map<string, EchoInstance>
  optResultEchoes: EchoInstance[]
  optResultData: PrepOptPay | null
}): ResultFacet[] {
  return buildFacetSlice({
    ...args,
    start: 0,
    end: args.optResults.length,
  })
}

export function buildFacetSlice(args: {
  optResults: RsltEntry[]
  start: number
  end: number
  invChsByUid: Map<string, EchoInstance>
  optResultEchoes: EchoInstance[]
  optResultData: PrepOptPay | null
}): ResultFacet[] {
  const { optResults: ptmzRslt, start, end, ...ctx } = args
  const out: ResultFacet[] = []
  const safeEnd = Math.min(end, ptmzRslt.length)
  for (let index = Math.max(0, start); index < safeEnd; index += 1) {
    out.push(facetFor(ptmzRslt[index]!, ctx))
  }
  return out
}

// ── comprehensive column / predicate model ────────────────────────────────
// every result column is addressable: numeric columns (damage, cost, and the
// eight stats) take a comparison operator + number; categorical columns (main
// echo, set, set plan) take an equality/contains value. predicates AND together
// and back both the filter (WHERE, subsets) and find (jump-to) flows.

export type CmpOp = 'gte' | 'gt' | 'eq' | 'lte' | 'lt'
export type NumCol =
  | 'damage' | 'cost'
  | 'atk' | 'hp' | 'def' | 'er' | 'cr' | 'cd' | 'bonus' | 'amp'
export type CatCol = 'main' | 'set' | 'plan'

export interface NumPredicate { kind: 'num'; col: NumCol; op: CmpOp; value: number }
export interface CatPredicate { kind: 'cat'; col: CatCol; value: string }
export type Predicate = NumPredicate | CatPredicate

export interface ColumnMeta {
  key: NumCol | CatCol
  label: string
  kind: 'num' | 'cat'
}

export const VIEW_COLUMNS: ColumnMeta[] = [
  { key: 'damage', label: 'DMG', kind: 'num' },
  { key: 'cost', label: 'Cost', kind: 'num' },
  { key: 'atk', label: 'ATK', kind: 'num' },
  { key: 'hp', label: 'HP', kind: 'num' },
  { key: 'def', label: 'DEF', kind: 'num' },
  { key: 'er', label: 'ER%', kind: 'num' },
  { key: 'cr', label: 'CR%', kind: 'num' },
  { key: 'cd', label: 'CD%', kind: 'num' },
  { key: 'bonus', label: 'BNS%', kind: 'num' },
  { key: 'amp', label: 'AMP%', kind: 'num' },
  { key: 'main', label: 'Main Echo', kind: 'cat' },
  { key: 'set', label: 'Set', kind: 'cat' },
  { key: 'plan', label: 'Set Plan', kind: 'cat' },
]

export const OP_SYMBOL: Record<CmpOp, string> = {
  gte: '≥', gt: '>', eq: '=', lte: '≤', lt: '<',
}

export type ViewSortKey = NumCol | 'mainEcho'

export interface ResultViewCriteria {
  sortKey: ViewSortKey
  sortDir: 'asc' | 'desc'
  filter: Predicate[]
}

export const DEFAULT_VIEW_CRITERIA: ResultViewCriteria = {
  sortKey: 'damage',
  sortDir: 'desc',
  filter: [],
}

// the default view is the identity ordering already produced by the optimizer
// (damage desc, no filters); the surface skips facet work entirely for it.
export function isDefaultViewCriteria(c: ResultViewCriteria): boolean {
  return c.sortKey === 'damage' && c.sortDir === 'desc' && c.filter.length === 0
}

// resolve a numeric column off a facet, null when the stat line is unevaluated.
function facetNum(facet: ResultFacet, col: NumCol): number | null {
  if (col === 'damage') {
    return facet.damage
  }
  if (col === 'cost') {
    return facet.totalCost
  }
  return facet.stats ? facet.stats[col as keyof OptResultStats] : null
}

function cmpNum(a: number, op: CmpOp, b: number): boolean {
  switch (op) {
    case 'gte': return a >= b
    case 'gt': return a > b
    case 'eq': return a === b
    case 'lte': return a <= b
    case 'lt': return a < b
  }
}

// does a facet satisfy every predicate (AND semantics)?
export function facetMatches(facet: ResultFacet, predicates: Predicate[]): boolean {
  for (const pred of predicates) {
    if (pred.kind === 'num') {
      const value = facetNum(facet, pred.col)
      if (value == null || !cmpNum(value, pred.op, pred.value)) {
        return false
      }
    } else if (pred.col === 'main') {
      if (facet.mainId !== pred.value) {
        return false
      }
    } else if (pred.col === 'set') {
      if (!facet.setBadges.some((badge) => String(badge.id) === pred.value)) {
        return false
      }
    } else if (facet.planKey !== pred.value) {
      return false
    }
  }
  return true
}

function facetSortValue(facet: ResultFacet, key: ViewSortKey): number {
  if (key === 'mainEcho') {
    // main echo ids are numeric strings; unresolved sorts as 0.
    const parsed = Number(facet.mainId)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return facetNum(facet, key) ?? 0
}

// apply WHERE (filters) then ORDER BY (sort) to produce the ordered list of
// original result indices the view should render. ties break by original index
// so the order stays stable.
export function buildResultView(
  facets: ResultFacet[],
  criteria: ResultViewCriteria,
): number[] {
  const indices: number[] = []
  for (let i = 0; i < facets.length; i += 1) {
    if (facetMatches(facets[i], criteria.filter)) {
      indices.push(i)
    }
  }

  const dir = criteria.sortDir === 'asc' ? 1 : -1
  indices.sort((a, b) => {
    const delta = facetSortValue(facets[a], criteria.sortKey) - facetSortValue(facets[b], criteria.sortKey)
    return delta !== 0 ? delta * dir : a - b
  })

  return indices
}

export interface PlanFacet {
  planKey: string
  count: number
  badges: Array<{ id: number; count: number }>
}

// distinct set plans present in the results, each with its row count, ordered
// by frequency for the faceted set-plan filter (group-by style).
export function facetPlans(facets: ResultFacet[]): PlanFacet[] {
  const byKey = new Map<string, PlanFacet>()
  for (const facet of facets) {
    if (!facet.planKey) {
      continue
    }
    const existing = byKey.get(facet.planKey)
    if (existing) {
      existing.count += 1
    } else {
      byKey.set(facet.planKey, { planKey: facet.planKey, count: 1, badges: facet.setBadges })
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.count - a.count)
}

// distinct main echoes present, by frequency for the main-echo filter.
export function facetMainEchoes(facets: ResultFacet[]): Array<{ id: string; count: number }> {
  const byId = new Map<string, number>()
  for (const facet of facets) {
    if (!facet.mainId) {
      continue
    }
    byId.set(facet.mainId, (byId.get(facet.mainId) ?? 0) + 1)
  }
  return Array.from(byId.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
}

// distinct activated sets present across all plans for the contains-set
// filter.
export function facetSets(facets: ResultFacet[]): Array<{ id: number; count: number }> {
  const byId = new Map<number, number>()
  for (const facet of facets) {
    for (const badge of facet.setBadges) {
      byId.set(badge.id, (byId.get(badge.id) ?? 0) + 1)
    }
  }
  return Array.from(byId.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
}
