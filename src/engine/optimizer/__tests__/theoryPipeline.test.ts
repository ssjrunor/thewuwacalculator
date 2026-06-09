/*
  Author: Runor Ewhro
  Description: Covers theoretical optimizer backend routing, compact result
               rows, and generated echo materialization.
*/

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals.ts'
import { makeEchoUid } from '@/domain/entities/runtime.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { makeEnemy, makeOptSets, makeResRuntime } from '@/domain/state/defaults.ts'
import { listChsByCos, listEchoes } from '@/domain/services/echoCatalogService.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { compOptPay } from '@/engine/optimizer/compiler'
import { ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from '@/engine/optimizer/config/constants.ts'
import { matThryEcho, matThryRslts } from '@/engine/optimizer/results/materialize.ts'
import { gnrtThryCpuCm } from '@/engine/optimizer/target/theoryBatches.ts'
import { runOptWithWr } from '@/engine/optimizer/workers/pool.ts'
import { listOptTrgt } from '@/engine/optimizer/target/skills.ts'
import type { OptStartPay, PrepTheoryTarget, TheoryRow, TheoryResult, TheoryResultRow } from '@/engine/optimizer/types.ts'
import type { EchoDef } from '@/domain/entities/catalog.ts'
import { initEchoCat } from '@/data/gameData/catalog/echoes.ts'
import { listEffects } from '@/domain/gameData/registry.ts'
import { getGameData } from '@/data/gameData'

const STAT_STRIDE = ECHO_STAT_STRIDE
const MAIN_STRIDE = MAIN_BUFF_LEN
const LUCY = '1511'
const TARGET_MAIN_ECHO = '6000201'
const MIXED_SET_CATALOG_IDS = [
  TARGET_MAIN_ECHO,
  '6000049',
  '6000058',
  '6020007',
  '390077025',
  '6000078',
  '6000080',
  '6000104',
  '6000095',
  '390070078',
  '390070079',
]

// make one equipped echo whose substats act as a fixed theory profile
function mkEcho(cost: number, slot: number): EchoInstance {
  const def = listChsByCos(cost)[0]
  if (!def) {
    throw new Error(`missing cost ${cost} echo`)
  }

  const mainKey = Object.keys(ECHO_MAIN_STATS[cost] ?? {})[0]
  const secondary = ECHO_SIDE_STATS[cost]
  if (!mainKey || !secondary) {
    throw new Error(`missing cost ${cost} stats`)
  }

  return {
    uid: makeEchoUid(),
    id: def.id,
    set: def.sets[0] ?? 0,
    mainEcho: slot === 0,
    mainStats: {
      primary: {
        key: mainKey,
        value: ECHO_MAIN_STATS[cost]?.[mainKey] ?? 0,
      },
      secondary: {
        key: secondary.key,
        value: secondary.value,
      },
    },
    substats: {
      critRate: 7 + slot,
      critDmg: 14 + slot,
    },
  }
}

function mkPay(rotationMode = false): OptStartPay {
  const seed = getResSeedBy('1506')
  if (!seed) {
    throw new Error('missing seed 1506')
  }

  const runtime = makeResRuntime(seed)
  runtime.build.echoes = [
    mkEcho(4, 0),
    mkEcho(3, 1),
    mkEcho(3, 2),
    mkEcho(1, 3),
    mkEcho(1, 4),
  ]

  const settings = {
    ...makeOptSets(),
    searchMode: 'theory' as const,
    rotationMode,
    targetSkillId: listOptTrgt(runtime)[0]?.id ?? null,
  }

  return {
    resonatorId: seed.id,
    resSeed: seed,
    runtime,
    settings,
    invChs: [],
    enemyProfile: makeEnemy(),
    setConds: DEF_SET_COND,
    rotTms: runtime.rotation.personalItems,
  }
}

function mkPayFor(
    resonatorId: string,
    rotationMode = false,
    optPatch: Partial<ReturnType<typeof makeOptSets>> = {},
): OptStartPay {
  const seed = getResSeedBy(resonatorId)
  if (!seed) {
    throw new Error(`missing seed ${resonatorId}`)
  }

  const runtime = makeResRuntime(seed)
  runtime.build.echoes = [
    mkEcho(4, 0),
    mkEcho(3, 1),
    mkEcho(3, 2),
    mkEcho(1, 3),
    mkEcho(1, 4),
  ]

  const settings = {
    ...makeOptSets(),
    searchMode: 'theory' as const,
    rotationMode,
    targetSkillId: listOptTrgt(runtime)[0]?.id ?? null,
    resultsLimit: 128,
    ...optPatch,
  }

  return {
    resonatorId: seed.id,
    resSeed: seed,
    runtime,
    settings,
    invChs: [],
    enemyProfile: makeEnemy(),
    setConds: DEF_SET_COND,
    rotTms: runtime.rotation.personalItems,
  }
}

function highRollEcho(
    cost: number,
    catalogId: string,
    focus: 'cd' | 'cr' | 'atk' | 'heavy' | 'flex',
): EchoInstance {
  const mainKey = Object.keys(ECHO_MAIN_STATS[cost] ?? {})[0] ?? 'atkPercent'
  const secondary = ECHO_SIDE_STATS[cost] ?? { key: 'atkFlat', value: 100 }
  const substats: Record<string, number> = {
    atkPercent: 11.6,
    critRate: 10.5,
    critDmg: 21,
    heavyAtk: 11.6,
    atkFlat: 60,
  }

  if (focus === 'flex') {
    substats.basicAtk = 11.6
  }

  return {
    uid: makeEchoUid(),
    id: catalogId,
    set: 0,
    mainEcho: false,
    mainStats: {
      primary: { key: mainKey, value: ECHO_MAIN_STATS[cost]?.[mainKey] ?? 0 },
      secondary: { key: secondary.key, value: secondary.value },
    },
    substats,
  }
}

function mkLucyMixedSetPay(): OptStartPay {
  const seed = getResSeedBy(LUCY)
  if (!seed) {
    throw new Error(`missing seed ${LUCY}`)
  }

  const runtime = makeResRuntime(seed)
  runtime.build.echoes = [
    highRollEcho(4, TARGET_MAIN_ECHO, 'cd'),
    highRollEcho(3, '6000049', 'cr'),
    highRollEcho(3, '6020007', 'atk'),
    highRollEcho(1, '6000095', 'heavy'),
    highRollEcho(1, '390070078', 'flex'),
  ]

  const settings = {
    ...makeOptSets(),
    searchMode: 'theory' as const,
    rotationMode: false,
    targetSkillId: listOptTrgt(runtime)[0]?.id ?? null,
    resultsLimit: 256,
  }

  return {
    resonatorId: seed.id,
    resSeed: seed,
    runtime,
    settings,
    invChs: [],
    enemyProfile: makeEnemy(),
    setConds: DEF_SET_COND,
    rotTms: runtime.rotation.personalItems,
  }
}

function inspectResultSets(entry: TheoryResult) {
  const echoes = entry.echoes
  if (!echoes || echoes.length === 0) return null

  const setCounts = new Map<number, number>()
  for (const echo of echoes) {
    setCounts.set(echo.set, (setCounts.get(echo.set) ?? 0) + 1)
  }

  return {
    mainEchoId: echoes.find((echo) => echo.mainEcho)?.id ?? echoes[0]?.id ?? null,
    counts: [...setCounts.values()].sort((a, b) => b - a),
  }
}

function mkRow(payload: PrepTheoryTarget): TheoryResultRow {
  const cats = payload.cats.slice(0, payload.profs.length)
  return {
    damage: 123,
    ids: cats.map((cat) => cat.id),
    sets: cats.map((cat) => cat.sets[0] ?? 0),
    mains: cats.map((cat) => Object.keys(ECHO_MAIN_STATS[cat.cost] ?? {})[0] ?? 'atkPercent'),
    main: 2,
    stats: null,
  }
}

// gather the packed theory row buffers after trimming the fixture search space
function shrinkRows(payload: PrepTheoryTarget, cats: PrepTheoryTarget['cats']): PrepTheoryTarget {
  const byShape = new Map<string, string[]>()
  const catIds = new Set(cats.map((cat) => cat.id))

  for (const cat of cats) {
    for (const setId of cat.sets) {
      const key = `${cat.cost}|${setId}`
      byShape.set(key, [...(byShape.get(key) ?? []), cat.id])
    }
  }

  const rowPairs: Array<{ oldIndex: number; row: TheoryRow }> = []
  for (let index = 0; index < payload.theoryRows.length; index += 1) {
    const row = payload.theoryRows[index]
    if (!row) {
      continue
    }

    if (row.mainOk) {
      if (row.id && catIds.has(row.id)) {
        rowPairs.push({ oldIndex: index, row: { ...row, ids: [row.id] } })
      }
      continue
    }

    const ids = byShape.get(`${row.cost}|${row.set}`) ?? []
    if (ids.length > 0) {
      rowPairs.push({ oldIndex: index, row: { ...row, ids } })
    }
  }

  const costs = new Uint8Array(rowPairs.length)
  const sets = new Uint8Array(rowPairs.length)
  const kinds = new Uint16Array(rowPairs.length)
  const stats = new Float32Array(rowPairs.length * STAT_STRIDE)
  const mainEchoBuffs = new Float32Array(rowPairs.length * MAIN_STRIDE)

  for (let index = 0; index < rowPairs.length; index += 1) {
    const pair = rowPairs[index]
    const oldIndex = pair.oldIndex
    costs[index] = payload.costs[oldIndex] ?? 0
    sets[index] = payload.sets[oldIndex] ?? 0
    kinds[index] = payload.kinds[oldIndex] ?? 0
    stats.set(
        payload.stats.subarray(oldIndex * STAT_STRIDE, (oldIndex + 1) * STAT_STRIDE),
        index * STAT_STRIDE,
    )
    mainEchoBuffs.set(
        payload.mainEchoBuffs.subarray(oldIndex * MAIN_STRIDE, (oldIndex + 1) * MAIN_STRIDE),
        index * MAIN_STRIDE,
    )
  }

  return {
    ...payload,
    cats,
    costs,
    sets,
    kinds,
    stats,
    mainEchoBuffs,
    comboN: rowPairs.length,
    totalCombos: 1,
    theoryTotal: 1,
    lockMainCands: Int32Array.from(rowPairs
        .map((pair, index) => pair.row.mainOk ? index : -1)
        .filter((index) => index >= 0)),
    theoryRows: rowPairs.map((pair) => pair.row),
  }
}

// keep search fixtures tiny; the production path uses the full catalog.
function smllPay(): PrepTheoryTarget {
  const payload = compOptPay(mkPay(false))
  expect(payload.mode).toBe('theoryTarget')
  if (payload.mode !== 'theoryTarget') {
    throw new Error('expected target theory payload')
  }

  const costs = [4, 3, 3, 1, 1]
  const setIds = new Set(payload.cats.flatMap((cat) => cat.sets))
  const setId = [...setIds].find((candidate) => (
    costs.every((cost) => (
      payload.cats.filter((cat) => cat.cost === cost && cat.sets.includes(candidate)).length >=
          costs.filter((entry) => entry === cost).length
    )) &&
    costs.some((cost) => payload.cats.some((cat) => (
      cat.cost === cost &&
      cat.hasSelfBff &&
      cat.sets.includes(candidate)
    )))
  ))
  if (setId == null) {
    throw new Error('missing compact theory fixture set')
  }

  const used = new Set<string>()
  let pickedMain = false
  const cats = costs.map((cost) => {
    const cat = payload.cats.find((entry) => (
      entry.cost === cost &&
      entry.sets.includes(setId) &&
      !used.has(entry.id) &&
      (!pickedMain ? entry.hasSelfBff : true)
    ))
    if (!cat) {
      throw new Error(`missing unique cost ${cost} echo`)
    }
    used.add(cat.id)
    pickedMain ||= cat.hasSelfBff
    return {
      ...cat,
      sets: [setId],
    }
  })

  return shrinkRows({
    ...payload,
    mainFltr: ['atk%'],
    selBonus: null,
  }, cats)
}

// shrink the hydrated echo catalog so cntThryEmt's emit-count walk is bounded
// in Node test runs. the production catalog is ~150 echoes; that explodes the
// dedupe-free combo space past the test timeout. picking only echoes from a
// single shared set keeps the smllPay fixture finder happy while reducing the
// row count by 20-30x.
function pickTinyCatalog(): EchoDef[] {
  const reg = getGameData()
  const all = listEchoes()
  const hasSelf = (echo: EchoDef) => listEffects(reg, { type: 'echo', id: echo.id })
      .some((effect) => (effect.targetScope ?? 'self') === 'self')

  // requirement matches the cost layout in mkPay + smllPay's set search:
  // need >=1 cost-4 (with self-buff), >=2 cost-3 (one with self), >=2 cost-1.
  const requirement = [
    { cost: 4, withSelf: 1, total: 1 },
    { cost: 3, withSelf: 1, total: 2 },
    { cost: 1, withSelf: 0, total: 2 },
  ]

  const setIds = new Set<number>()
  for (const echo of all) {
    for (const setId of echo.sets) setIds.add(setId)
  }

  for (const setId of setIds) {
    const inSet = all.filter((echo) => echo.sets.includes(setId))
    const meetsAll = requirement.every((req) => {
      const bucket = inSet.filter((echo) => echo.cost === req.cost)
      return (
        bucket.length >= req.total &&
        bucket.filter(hasSelf).length >= req.withSelf
      )
    })
    if (!meetsAll) continue

    const picked: EchoDef[] = []
    for (const req of requirement) {
      const bucket = inSet.filter((echo) => echo.cost === req.cost)
      const withSelf = bucket.filter(hasSelf).slice(0, req.withSelf)
      const fill = bucket
          .filter((echo) => !withSelf.includes(echo))
          .slice(0, req.total - withSelf.length)
      picked.push(...withSelf, ...fill)
    }
    // collapse each echo's set list to just the shared set so the theory
    // catalog stays small and predictable.
    return picked.map((echo) => ({ ...echo, sets: [setId] }))
  }

  throw new Error('no shared set satisfies the theory pipeline fixture requirement')
}

describe('theory optimizer pipeline', () => {
  let originalCatalog: EchoDef[] = []
  let tinyCatalog: EchoDef[] = []

  beforeAll(() => {
    originalCatalog = listEchoes().slice()
    tinyCatalog = pickTinyCatalog()
    initEchoCat(tinyCatalog)
  })

  afterAll(() => {
    initEchoCat(originalCatalog)
  })

  it('compiles target and rotation theory payloads', () => {
    const target = compOptPay(mkPay(false))
    expect(target.mode).toBe('theoryTarget')
    expect('profs' in target ? target.profs : []).toHaveLength(5)
    expect('cats' in target ? target.cats.length : 0).toBeGreaterThan(0)

    const rotation = compOptPay(mkPay(true))
    expect(rotation.mode).toBe('theoryRotation')
    expect('profs' in rotation ? rotation.profs : []).toHaveLength(5)
  })

  it('routes theory cpu search through packed batch result refs', async () => {
    const payload = smllPay()
    const results = await runOptWithWr(payload, 'cpu')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.damage ?? 0).toBeGreaterThan(0)
    expect('i0' in (results[0] ?? {})).toBe(true)
  })

  it('emits target theory batches for compacted Hiyuki rows', () => {
    const payload = compOptPay(mkPayFor('1108', false, {
      mainStatFilter: ['atk%', 'cr', 'cd', 'bonus'],
      selectedBonus: 'glacio',
    }))
    expect(payload.mode).toBe('theoryTarget')
    if (payload.mode !== 'theoryTarget') return

    let combos = 0
    for (const batch of gnrtThryCpuCm({ payload, batchSize: 2048 })) {
      combos += batch.comboCount
      if (combos > 0) {
        break
      }
    }

    expect(combos).toBeGreaterThan(0)
  })

  it('materializes compact theory rows with slot-locked substats', () => {
    const payload = compOptPay(mkPay(false))
    expect(payload.mode).toBe('theoryTarget')
    if (payload.mode !== 'theoryTarget') return

    const row = mkRow(payload)
    const echoes = matThryEcho(payload, row)
    expect(echoes).toHaveLength(5)
    expect(echoes?.[2]?.mainEcho).toBe(true)
    expect(echoes?.map((echo) => echo.id)).toEqual(row.ids)
    expect(echoes?.map((echo) => echo.set)).toEqual(row.sets)
    expect(echoes?.[3]?.substats).toEqual(payload.profs[3]?.substats)
  })

  it('rejects duplicate catalog ids in theory materialization', () => {
    const payload = compOptPay(mkPay(false))
    expect(payload.mode).toBe('theoryTarget')
    if (payload.mode !== 'theoryTarget') return

    const row = mkRow(payload)
    row.ids[1] = row.ids[0] ?? row.ids[1]

    expect(matThryEcho(payload, row)).toBeNull()
  })

  it('supports mixed 1pc + 2pc + 2pc theory plans and locked main echoes', { timeout: 20_000 }, async () => {
    const subset = originalCatalog.filter((echo) => MIXED_SET_CATALOG_IDS.includes(echo.id))
    if (subset.length !== MIXED_SET_CATALOG_IDS.length) {
      const missing = MIXED_SET_CATALOG_IDS.filter((id) => !subset.find((echo) => echo.id === id))
      throw new Error(`mixed theory catalog missing ids: ${missing.join(', ')}`)
    }

    initEchoCat(subset)
    try {
      const startPay = mkLucyMixedSetPay()
      const compiled = compOptPay(startPay)
      expect(compiled.mode).toBe('theoryTarget')
      if (compiled.mode !== 'theoryTarget') return

      const rawResults = await runOptWithWr(compiled, 'cpu')
      const inspected = matThryRslts(compiled, rawResults, compiled.resultsLimit)
          .map((row) => inspectResultSets(row))
          .filter(Boolean) as Array<NonNullable<ReturnType<typeof inspectResultSets>>>

      expect(inspected.some((row) => (
        row.counts.length >= 3 &&
        row.counts[0] === 2 &&
        row.counts[1] === 2 &&
        row.counts[2] === 1
      ))).toBe(true)

      const locked = compOptPay({
        ...startPay,
        settings: {
          ...startPay.settings,
          lockedMainEchoId: TARGET_MAIN_ECHO,
        },
      })
      expect(locked.mode).toBe('theoryTarget')
      if (locked.mode !== 'theoryTarget') return

      const mainOkIds = new Set(locked.theoryRows.filter((row) => row.mainOk).map((row) => row.id))
      expect(mainOkIds).toEqual(new Set([TARGET_MAIN_ECHO]))

      const lockedResults = matThryRslts(
        locked,
        await runOptWithWr(locked, 'cpu'),
        locked.resultsLimit,
      )
          .map((row) => inspectResultSets(row))
          .filter(Boolean) as Array<NonNullable<ReturnType<typeof inspectResultSets>>>

      expect(lockedResults.length).toBeGreaterThan(0)
      expect(new Set(lockedResults.map((row) => row.mainEchoId))).toEqual(new Set([TARGET_MAIN_ECHO]))
    } finally {
      initEchoCat(tinyCatalog)
    }
  })
})
