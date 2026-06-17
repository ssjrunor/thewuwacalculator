/*
  Author: Runor Ewhro
  Description: Covers the SQL-style result view: facet extraction (incl. stats),
               the comprehensive predicate model (facetMatches), filter/sort
               (buildResultView), and the facet grouping helpers.
*/

import { describe, expect, it } from 'vitest'
import type { EchoDef } from '@/domain/entities/catalog.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import type { OptResultStats } from '@/engine/optimizer/types.ts'
import { listEchoes } from '@/domain/services/echoCatalogService.ts'
import {
  DEFAULT_VIEW_CRITERIA,
  buildFacetTable,
  buildResultView,
  facetMainEchoes,
  facetMatches,
  facetPlans,
  facetSets,
  isDefaultViewCriteria,
  type Predicate,
  type ResultFacet,
  type ResultViewCriteria,
} from '@/modules/calculator/features/optimizer/lib/results.ts'
import type { LegOptRsltEn } from '@/modules/calculator/features/optimizer/lib/results.ts'

function mkStats(over: Partial<OptResultStats> = {}): OptResultStats {
  return { atk: 0, hp: 0, def: 0, er: 0, cr: 0, cd: 0, bonus: 0, amp: 0, ...over }
}

function mkFacet(over: Partial<ResultFacet>): ResultFacet {
  return { damage: 0, mainId: '', totalCost: 0, setBadges: [], planKey: '', stats: null, ...over }
}

function crit(over: Partial<ResultViewCriteria>): ResultViewCriteria {
  return { ...DEFAULT_VIEW_CRITERIA, ...over }
}

function whereFilter(...filter: Predicate[]): ResultViewCriteria {
  return crit({ filter })
}

describe('isDefaultViewCriteria', () => {
  it('is true for the default and false when any field differs', () => {
    expect(isDefaultViewCriteria(DEFAULT_VIEW_CRITERIA)).toBe(true)
    expect(isDefaultViewCriteria(crit({ sortKey: 'mainEcho' }))).toBe(false)
    expect(isDefaultViewCriteria(crit({ sortDir: 'asc' }))).toBe(false)
    expect(isDefaultViewCriteria(crit({ filter: [{ kind: 'cat', col: 'main', value: '6000201' }] }))).toBe(false)
  })
})

describe('buildResultView ordering', () => {
  const facets = [
    mkFacet({ damage: 10, mainId: '300', totalCost: 8, stats: mkStats({ cr: 50 }) }),
    mkFacet({ damage: 30, mainId: '100', totalCost: 12, stats: mkStats({ cr: 70 }) }),
    mkFacet({ damage: 20, mainId: '200', totalCost: 4, stats: mkStats({ cr: 60 }) }),
  ]

  it('default sorts by damage desc', () => {
    expect(buildResultView(facets, DEFAULT_VIEW_CRITERIA)).toEqual([1, 2, 0])
  })

  it('sorts by main echo id numerically', () => {
    expect(buildResultView(facets, crit({ sortKey: 'mainEcho', sortDir: 'asc' }))).toEqual([1, 2, 0])
    expect(buildResultView(facets, crit({ sortKey: 'mainEcho', sortDir: 'desc' }))).toEqual([0, 2, 1])
  })

  it('sorts by total cost', () => {
    expect(buildResultView(facets, crit({ sortKey: 'cost', sortDir: 'asc' }))).toEqual([2, 0, 1])
  })

  it('sorts by a stat column', () => {
    expect(buildResultView(facets, crit({ sortKey: 'cr', sortDir: 'desc' }))).toEqual([1, 2, 0])
    expect(buildResultView(facets, crit({ sortKey: 'cr', sortDir: 'asc' }))).toEqual([0, 2, 1])
  })

  it('breaks ties by original index', () => {
    const tied = [mkFacet({ damage: 5 }), mkFacet({ damage: 5 }), mkFacet({ damage: 5 })]
    expect(buildResultView(tied, DEFAULT_VIEW_CRITERIA)).toEqual([0, 1, 2])
  })
})

describe('facetMatches - comprehensive predicates', () => {
  const facet = mkFacet({
    damage: 100000,
    mainId: '6000201',
    totalCost: 11,
    setBadges: [{ id: 5, count: 2 }, { id: 9, count: 2 }],
    planKey: '5:2|9:2',
    stats: mkStats({ cr: 62, cd: 210, atk: 2400 }),
  })

  it('matches numeric operators on any column', () => {
    expect(facetMatches(facet, [{ kind: 'num', col: 'cr', op: 'gte', value: 60 }])).toBe(true)
    expect(facetMatches(facet, [{ kind: 'num', col: 'cr', op: 'gt', value: 62 }])).toBe(false)
    expect(facetMatches(facet, [{ kind: 'num', col: 'cd', op: 'lte', value: 210 }])).toBe(true)
    expect(facetMatches(facet, [{ kind: 'num', col: 'cd', op: 'lt', value: 210 }])).toBe(false)
    expect(facetMatches(facet, [{ kind: 'num', col: 'cr', op: 'eq', value: 62 }])).toBe(true)
    expect(facetMatches(facet, [{ kind: 'num', col: 'damage', op: 'gt', value: 99999 }])).toBe(true)
    expect(facetMatches(facet, [{ kind: 'num', col: 'cost', op: 'lte', value: 11 }])).toBe(true)
  })

  it('fails numeric predicates when the stat line is missing', () => {
    const noStats = mkFacet({ damage: 5, stats: null })
    expect(facetMatches(noStats, [{ kind: 'num', col: 'cr', op: 'gte', value: 1 }])).toBe(false)
    // damage/cost do not depend on the stat line
    expect(facetMatches(noStats, [{ kind: 'num', col: 'damage', op: 'gte', value: 1 }])).toBe(true)
  })

  it('matches categorical predicates (main / set / plan)', () => {
    expect(facetMatches(facet, [{ kind: 'cat', col: 'main', value: '6000201' }])).toBe(true)
    expect(facetMatches(facet, [{ kind: 'cat', col: 'main', value: '9' }])).toBe(false)
    expect(facetMatches(facet, [{ kind: 'cat', col: 'set', value: '5' }])).toBe(true)
    expect(facetMatches(facet, [{ kind: 'cat', col: 'set', value: '7' }])).toBe(false)
    expect(facetMatches(facet, [{ kind: 'cat', col: 'plan', value: '5:2|9:2' }])).toBe(true)
  })

  it('ANDs multiple predicates', () => {
    expect(facetMatches(facet, [
      { kind: 'num', col: 'cr', op: 'gte', value: 60 },
      { kind: 'cat', col: 'set', value: '9' },
    ])).toBe(true)
    expect(facetMatches(facet, [
      { kind: 'num', col: 'cr', op: 'gte', value: 60 },
      { kind: 'num', col: 'cd', op: 'gte', value: 999 },
    ])).toBe(false)
  })
})

describe('buildResultView filtering (WHERE)', () => {
  const facets = [
    mkFacet({ damage: 10, mainId: '100', setBadges: [{ id: 5, count: 2 }], planKey: '5:2', stats: mkStats({ cr: 50 }) }),
    mkFacet({ damage: 20, mainId: '200', setBadges: [{ id: 9, count: 5 }], planKey: '9:5', stats: mkStats({ cr: 70 }) }),
    mkFacet({ damage: 30, mainId: '100', setBadges: [{ id: 5, count: 2 }, { id: 9, count: 2 }], planKey: '5:2|9:2', stats: mkStats({ cr: 65 }) }),
  ]

  it('subsets by a numeric predicate, keeping sort order (damage desc)', () => {
    expect(buildResultView(facets, whereFilter({ kind: 'num', col: 'cr', op: 'gte', value: 60 }))).toEqual([2, 1])
  })

  it('subsets by a contained set', () => {
    expect(buildResultView(facets, whereFilter({ kind: 'cat', col: 'set', value: '5' }))).toEqual([2, 0])
  })

  it('returns an empty view when nothing matches', () => {
    expect(buildResultView(facets, whereFilter({ kind: 'num', col: 'cr', op: 'gt', value: 999 }))).toEqual([])
  })
})

describe('facet grouping helpers', () => {
  const facets = [
    mkFacet({ mainId: '100', setBadges: [{ id: 5, count: 2 }], planKey: '5:2' }),
    mkFacet({ mainId: '100', setBadges: [{ id: 5, count: 2 }], planKey: '5:2' }),
    mkFacet({ mainId: '200', setBadges: [{ id: 5, count: 2 }, { id: 9, count: 2 }], planKey: '5:2|9:2' }),
  ]

  it('groups set plans by frequency', () => {
    expect(facetPlans(facets).map((p) => [p.planKey, p.count])).toEqual([
      ['5:2', 2],
      ['5:2|9:2', 1],
    ])
  })

  it('lists distinct main echoes by frequency', () => {
    expect(facetMainEchoes(facets)).toEqual([
      { id: '100', count: 2 },
      { id: '200', count: 1 },
    ])
  })

  it('lists distinct activated sets by frequency', () => {
    expect(facetSets(facets)).toEqual([
      { id: 5, count: 3 },
      { id: 9, count: 1 },
    ])
  })
})

describe('buildFacetTable extraction', () => {
  function mkEchoInst(def: EchoDef, uid: string): EchoInstance {
    return {
      uid,
      id: def.id,
      set: def.sets[0] ?? 0,
      mainEcho: false,
      mainStats: { primary: { key: 'atk', value: 0 }, secondary: { key: 'atk', value: 0 } },
      substats: {},
    }
  }

  it('extracts damage, main echo, cost, plan key, and passes stats through', () => {
    const def = listEchoes()[0]
    expect(def).toBeTruthy()

    const uids = ['u0', 'u1', 'u2', 'u3', 'u4']
    const invChsByUid = new Map<string, EchoInstance>(
      uids.map((uid) => [uid, mkEchoInst(def, uid)] as const),
    )
    const stats = mkStats({ cr: 64, cd: 200 })
    const row: LegOptRsltEn = { damage: 1234, uids, stats }

    const [facet] = buildFacetTable({
      optResults: [row],
      invChsByUid,
      optResultEchoes: [],
      optResultData: null,
    })

    expect(facet.damage).toBe(1234)
    expect(facet.mainId).toBe(def.id)
    expect(facet.totalCost).toBe(def.cost * 5)
    expect(facet.stats).toEqual(stats)
    const expectedKey = [...facet.setBadges]
      .sort((a, b) => a.id - b.id)
      .map((b) => `${b.id}:${b.count}`)
      .join('|')
    expect(facet.planKey).toBe(expectedKey)
  })
})
