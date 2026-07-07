/*
  Author: Runor Ewhro
  Description: compiles theoretical optimizer payloads by keeping equipped
               substat profiles fixed while preparing catalog echo metadata
               and normal optimizer target or rotation contexts.
*/

import { listEchoes } from '@/domain/services/echoCatalogService.ts'
import { getGameData } from '@/data/gameData'
import {
  ECHO_MAIN_STATS,
  ECHO_SIDE_STATS,
} from '@/data/gameData/catalog/echoStats.ts'
import { listEffects } from '@/domain/gameData/registry.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import type {
  OptStartPay,
  PrepTheoryRot,
  PrepTheoryTarget,
  ThryEchoCt,
  ThryProf,
  TheoryRow,
} from '@/engine/optimizer/types.ts'
import { compTgtRun } from '@/engine/optimizer/compiler/target.ts'
import { compRotRun } from '@/engine/optimizer/compiler/rotation.ts'
import { countTheory } from '@/engine/optimizer/search/counting.ts'
import { buildWeaponOverlays } from '@/engine/optimizer/context/weaponOverlays.ts'
import { cntThryEmt, buildSlotReps } from '@/engine/optimizer/target/theoryBatches.ts'
import { optSetIdSet } from '@/engine/optimizer/config/allowedSets.ts'
import {
  encEchoRows,
  mkGnrcMainEc,
  mkMainEchoRo,
} from '@/engine/optimizer/encode/echoes.ts'
import {
  ARCH_DAMAGE,
  ARCHETYPE,
  ECHO_STAT_STRIDE,
  MAIN_BUFF_LEN,
  SCALING_ATK,
  SCALING_DEF,
  SCALING_ER,
  SCALING_HP,
  SKILL_ID,
} from '@/engine/optimizer/config/constants.ts'

const ELEMBNSKEYS = new Set(['aero', 'glacio', 'fusion', 'spectro', 'havoc', 'electro'])
const STAT_ATK_P = 0
const STAT_ATK_F = 1
const STAT_HP_P = 2
const STAT_HP_F = 3
const STAT_DEF_P = 4
const STAT_DEF_F = 5
const STAT_CR = 6
const STAT_CD = 7
const STAT_ER = 8
const STAT_BASIC = 10
const STAT_HEAVY = 11
const STAT_SKILL = 12
const STAT_LIB = 13
const STAT_AERO = 14
const STAT_SPECTRO = 15
const STAT_FUSION = 16
const STAT_GLACIO = 17
const STAT_HAVOC = 18
const STAT_ELECTRO = 19
const MAIN_ATK_P = 0
const MAIN_ATK_F = 1
const MAIN_BASIC = 2
const MAIN_HEAVY = 3
const MAIN_SKILL = 4
const MAIN_LIB = 5
const MAIN_AERO = 6
const MAIN_GLACIO = 7
const MAIN_FUSION = 8
const MAIN_SPECTRO = 9
const MAIN_HAVOC = 10
const MAIN_ELECTRO = 11
const MAIN_ER = 12
const MAIN_ECHO = 13
const MAIN_COORD = 14
// see encode/echoes.ts for the layout. these slots receive top_stat
// contributions (cr/cd/dmgBonus) routed by addMainOp.
const MAIN_CR = 15
const MAIN_CD = 16
const MAIN_DMG_BNS = 17

function fltrKey(key: string): string | null {
  if (key === 'atkPercent') return 'atk%'
  if (key === 'hpPercent') return 'hp%'
  if (key === 'defPercent') return 'def%'
  if (key === 'energyRegen') return 'er'
  if (key === 'critRate') return 'cr'
  if (key === 'critDmg') return 'cd'
  if (key === 'healingBonus') return 'healing'
  if (ELEMBNSKEYS.has(key)) return 'bonus'
  return null
}

function mainOpts(input: OptStartPay, cost: number): string[] {
  const all = Object.keys(ECHO_MAIN_STATS[cost] ?? {})
  const filters = input.settings.mainStatFilter
  if (all.length === 0 || filters.length === 0) {
    return all
  }

  const filterSet = new Set(filters)
  const picked = all.filter((key) => {
    const bucket = fltrKey(key)
    if (!bucket || !filterSet.has(bucket)) {
      return false
    }
    return bucket !== 'bonus' || !input.settings.selectedBonus || key === input.settings.selectedBonus
  })

  return picked.length > 0 ? picked : all
}

// an echo qualifies as "self-buff" and can serve as the main echo in
// theory search when at least one of its registered effects targets self
// (either via explicit `targetScope: 'self'` or the implicit default).
function hasSelfBff(echoId: string): boolean {
  const registry = getGameData()
  const effects = listEffects(registry, { type: 'echo', id: echoId })
  for (const effect of effects) {
    const scope = effect.targetScope ?? 'self'
    if (scope === 'self') {
      return true
    }
  }
  return false
}

// collect the fixed substat profiles from the current equipped build
// theory search can change catalog identity, set, cost, and main stat later.
function mkThryProfs(input: OptStartPay): ThryProf[] {
  return input.runtime.build.echoes
      .filter((echo) => echo != null)
      .map((echo) => ({
        uid: echo.uid,
        substats: { ...echo.substats },
      }))
}

// collect catalog echo rows that can participate in theoretical set plans
// allowed-set filtering is kept here so later generators start from the same search space.
function mkThryCats(input: OptStartPay): ThryEchoCt[] {
  const setIds = optSetIdSet(input.settings.allowedSets)

  return listEchoes()
      .filter((echo) => (
        setIds.size === 0 || echo.sets.some((setId) => setIds.has(setId))
      ))
      .map((echo) => ({
        id: echo.id,
        cost: echo.cost,
        sets: setIds.size === 0
            ? [...echo.sets]
            : echo.sets.filter((setId) => setIds.has(setId)),
        hasSelfBff: hasSelfBff(echo.id),
      }))
}

// expose locked-main catalog candidates in the shared payload slot
// the real generator will use catalog ids, but this keeps logging/routing meaningful now.
function mkMainCand(input: OptStartPay, cats: ThryEchoCt[]): Int32Array {
  const locked = input.settings.lockedMainEchoId
  const out: number[] = []

  for (let index = 0; index < cats.length; index += 1) {
    if (!locked || cats[index]?.id === locked) {
      out.push(index)
    }
  }

  return Int32Array.from(out)
}

function firstCatByKey(cats: ThryEchoCt[]): Map<string, ThryEchoCt> {
  const out = new Map<string, ThryEchoCt>()
  for (const cat of cats) {
    for (const setId of cat.sets) {
      const key = `${cat.cost}|${setId}`
      if (!out.has(key)) {
        out.set(key, cat)
      }
    }
  }
  return out
}

function idsByKey(cats: ThryEchoCt[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const cat of cats) {
    for (const setId of cat.sets) {
      const key = `${cat.cost}|${setId}`
      const list = out.get(key) ?? []
      list.push(cat.id)
      out.set(key, list)
    }
  }
  return out
}

function mkThryRows(
    input: OptStartPay,
    cats: ThryEchoCt[],
): {
  echoes: EchoInstance[]
  rows: TheoryRow[]
} {
  const echoes: EchoInstance[] = []
  const rows: TheoryRow[] = []
  const catByKey = firstCatByKey(cats)
  const idsByShape = idsByKey(cats)
  const locked = input.settings.lockedMainEchoId

  function pushRow(options: {
    slot: number
    cat: ThryEchoCt
    ids: string[]
    id: string | null
    setId: number
    main: string
    mainOk: boolean
  }): void {
    const secondary = ECHO_SIDE_STATS[options.cat.cost]
    const primaryValue = ECHO_MAIN_STATS[options.cat.cost]?.[options.main]
    const prof = input.runtime.build.echoes[options.slot]
    if (!secondary || primaryValue == null || !prof) {
      return
    }

    rows.push({
      slot: options.slot,
      id: options.id,
      ids: options.ids,
      set: options.setId,
      main: options.main,
      cost: options.cat.cost,
      mainOk: options.mainOk,
    })

    echoes.push({
      uid: `theory-row:${options.slot}:${rows.length - 1}`,
      id: options.id ?? options.cat.id,
      set: options.setId,
      mainEcho: false,
      mainStats: {
        primary: {
          key: options.main,
          value: primaryValue,
        },
        secondary: {
          key: secondary.key,
          value: secondary.value,
        },
      },
      substats: { ...prof.substats },
    })
  }

  for (let slot = 0; slot < input.runtime.build.echoes.length; slot += 1) {
    if (!input.runtime.build.echoes[slot]) {
      continue
    }

    for (const [key, cat] of catByKey.entries()) {
      const [, setPart] = key.split('|')
      const setId = Number(setPart)
      const ids = idsByShape.get(key) ?? []
      for (const main of mainOpts(input, cat.cost)) {
        pushRow({
          slot,
          cat,
          ids,
          id: null,
          setId,
          main,
          mainOk: false,
        })
      }
    }

    for (const cat of cats) {
      const canMain = locked ? cat.id === locked : cat.hasSelfBff
      if (!canMain) {
        continue
      }

      for (const setId of cat.sets) {
        for (const main of mainOpts(input, cat.cost)) {
          pushRow({
            slot,
            cat,
            ids: [cat.id],
            id: cat.id,
            setId,
            main,
            mainOk: true,
          })
        }
      }
    }
  }

  return { echoes, rows }
}

function allMask(size: number): boolean[] {
  return Array.from({ length: size }, () => true)
}

function emptyMask(size: number): boolean[] {
  return Array.from({ length: size }, () => false)
}

function hasActCstr(values: Float32Array): boolean {
  for (let index = 0; index < values.length; index += 2) {
    if ((values[index] ?? 1) <= (values[index + 1] ?? 0)) {
      return true
    }
  }
  return false
}

function elemStatIdx(element: string): number | null {
  switch (element) {
    case 'aero': return STAT_AERO
    case 'glacio': return STAT_GLACIO
    case 'fusion': return STAT_FUSION
    case 'spectro': return STAT_SPECTRO
    case 'havoc': return STAT_HAVOC
    case 'electro': return STAT_ELECTRO
    default: return null
  }
}

function elemMainIdx(element: string): number | null {
  switch (element) {
    case 'aero': return MAIN_AERO
    case 'glacio': return MAIN_GLACIO
    case 'fusion': return MAIN_FUSION
    case 'spectro': return MAIN_SPECTRO
    case 'havoc': return MAIN_HAVOC
    case 'electro': return MAIN_ELECTRO
    default: return null
  }
}

function addSkllMasks(
    statMask: boolean[],
    mainMask: boolean[],
    skillTypes: readonly string[],
): void {
  const all = skillTypes.includes('all')
  if (all || skillTypes.includes('basicAtk')) {
    statMask[STAT_BASIC] = true
    mainMask[MAIN_BASIC] = true
  }
  if (all || skillTypes.includes('heavyAtk')) {
    statMask[STAT_HEAVY] = true
    mainMask[MAIN_HEAVY] = true
  }
  if (all || skillTypes.includes('resonanceSkill')) {
    statMask[STAT_SKILL] = true
    mainMask[MAIN_SKILL] = true
  }
  if (all || skillTypes.includes('resonanceLiberation')) {
    statMask[STAT_LIB] = true
    mainMask[MAIN_LIB] = true
  }
  if (all || skillTypes.includes('echoSkill')) {
    mainMask[MAIN_ECHO] = true
  }
  if (all || skillTypes.includes('coord')) {
    mainMask[MAIN_COORD] = true
  }
}

function addSkllBits(
    statMask: boolean[],
    mainMask: boolean[],
    skillMask: number,
): void {
  if ((skillMask & (1 << 0)) !== 0) {
    statMask[STAT_BASIC] = true
    mainMask[MAIN_BASIC] = true
  }
  if ((skillMask & (1 << 1)) !== 0) {
    statMask[STAT_HEAVY] = true
    mainMask[MAIN_HEAVY] = true
  }
  if ((skillMask & (1 << 2)) !== 0) {
    statMask[STAT_SKILL] = true
    mainMask[MAIN_SKILL] = true
  }
  if ((skillMask & (1 << 3)) !== 0) {
    statMask[STAT_LIB] = true
    mainMask[MAIN_LIB] = true
  }
  if ((skillMask & (1 << 6)) !== 0) {
    mainMask[MAIN_ECHO] = true
  }
  if ((skillMask & (1 << 7)) !== 0) {
    mainMask[MAIN_COORD] = true
  }
}

function addElemBits(
    statMask: boolean[],
    mainMask: boolean[],
    elemIndex: number,
): void {
  const statByElem = [
    STAT_AERO,
    STAT_GLACIO,
    STAT_FUSION,
    STAT_SPECTRO,
    STAT_HAVOC,
    STAT_ELECTRO,
  ]
  const mainByElem = [
    MAIN_AERO,
    MAIN_GLACIO,
    MAIN_FUSION,
    MAIN_SPECTRO,
    MAIN_HAVOC,
    MAIN_ELECTRO,
  ]
  const statIndex = statByElem[elemIndex]
  const mainIndex = mainByElem[elemIndex]
  if (statIndex != null) statMask[statIndex] = true
  if (mainIndex != null) mainMask[mainIndex] = true
}

function addNormalCtxMs(
    statMask: boolean[],
    mainMask: boolean[],
    options: {
      scalingAtk: number
      scalingHp: number
      scalingDef: number
      scalingEr: number
      characterId?: number
      skillMask: number
      elemIndex: number
    },
): void {
  if (options.scalingAtk !== 0) {
    statMask[STAT_ATK_P] = true
    statMask[STAT_ATK_F] = true
    mainMask[MAIN_ATK_P] = true
    mainMask[MAIN_ATK_F] = true
  }
  if (options.scalingHp !== 0) {
    statMask[STAT_HP_P] = true
    statMask[STAT_HP_F] = true
  }
  if (options.scalingDef !== 0) {
    statMask[STAT_DEF_P] = true
    statMask[STAT_DEF_F] = true
  }
  if (
      options.scalingEr !== 0 ||
      (options.characterId != null && [1206, 1209, 1412, 1505].includes(options.characterId))
  ) {
    statMask[STAT_ER] = true
    mainMask[MAIN_ER] = true
  }

  statMask[STAT_CR] = true
  statMask[STAT_CD] = true
  // main-echo cr/cd/dmgBonus contributions always affect damage, so include
  // them in the mainSig dedupe key. without this, prnThryRows would treat
  // rows that differ only in their main-echo cr/cd contribution as
  // equivalent and collapse them away.
  mainMask[MAIN_CR] = true
  mainMask[MAIN_CD] = true
  mainMask[MAIN_DMG_BNS] = true
  if (options.skillMask !== 0) {
    addSkllBits(statMask, mainMask, options.skillMask)
  }
  if (options.elemIndex >= 0) {
    addElemBits(statMask, mainMask, options.elemIndex)
  }
}

function addRotCtxMs(
    statMask: boolean[],
    mainMask: boolean[],
    context: Float32Array,
    base: number,
): void {
  if ((context[base + ARCHETYPE] ?? 0) !== ARCH_DAMAGE) {
    return
  }

  const packedSkill = new Uint32Array(
      context.buffer,
      context.byteOffset,
      context.length,
  )[base + SKILL_ID] ?? 0

  addNormalCtxMs(statMask, mainMask, {
    scalingAtk: context[base + SCALING_ATK] ?? 0,
    scalingHp: context[base + SCALING_HP] ?? 0,
    scalingDef: context[base + SCALING_DEF] ?? 0,
    scalingEr: context[base + SCALING_ER] ?? 0,
    skillMask: packedSkill & 0x7fff,
    elemIndex: Math.max(0, Math.min(5, (packedSkill >>> 15) & 0x7)),
  })
}

// build contribution masks for row compaction.
// fields outside the mask cannot affect the selected calculation, so they
// should not multiply the theory search space.
function mkCntrMasks(payload: PrepTheoryTarget | PrepTheoryRot): {
  statMask: boolean[]
  mainMask: boolean[]
} {
  if (hasActCstr(payload.constraints)) {
    return {
      statMask: allMask(ECHO_STAT_STRIDE),
      mainMask: allMask(MAIN_BUFF_LEN),
    }
  }

  const statMask = emptyMask(ECHO_STAT_STRIDE)
  const mainMask = emptyMask(MAIN_BUFF_LEN)

  if (payload.mode === 'theoryRotation') {
    for (let index = 0; index < payload.contextCount; index += 1) {
      addRotCtxMs(statMask, mainMask, payload.contexts, index * payload.contextStride)
    }
    return { statMask, mainMask }
  }

  const cmp = payload.compiled

  if (cmp.archetype !== ARCH_DAMAGE || cmp.fixedDmg > 0) {
    return { statMask, mainMask }
  }

  addNormalCtxMs(statMask, mainMask, {
    scalingAtk: cmp.scalingAtk,
    scalingHp: cmp.scalingHp,
    scalingDef: cmp.scalingDef,
    scalingEr: cmp.scalingER,
    characterId: cmp.characterId,
    skillMask: 0,
    elemIndex: -1,
  })
  addSkllMasks(statMask, mainMask, payload.selectedSkill.skillType)

  const stElem = elemStatIdx(payload.selectedSkill.element)
  const mnElem = elemMainIdx(payload.selectedSkill.element)
  if (stElem != null) statMask[stElem] = true
  if (mnElem != null) mainMask[mnElem] = true

  return { statMask, mainMask }
}

function sigRow(
    values: Float32Array,
    base: number,
    mask: readonly boolean[],
): string {
  const parts: string[] = []
  for (let offset = 0; offset < mask.length; offset += 1) {
    if (mask[offset]) {
      parts.push(String(Math.round((values[base + offset] ?? 0) * 100_000)))
    }
  }
  return parts.join(',')
}

function mergeIds(left: TheoryRow, right: TheoryRow): void {
  const ids = new Set(left.ids)
  for (const id of right.ids) {
    ids.add(id)
  }
  left.ids = [...ids]

  if (left.id !== right.id) {
    left.id = ids.size === 1 ? (left.ids[0] ?? null) : null
  }
}

// collapse rows that are identical for the active calculation before search.
// this keeps irrelevant main stats and equivalent main-echo effects from
// becoming real CPU combinations.
function prnThryRows<T extends PrepTheoryTarget | PrepTheoryRot>(
    payload: T,
    rows: TheoryRow[],
    encoded: ReturnType<typeof encEchoRows>,
    mainEchoBuffs: Float32Array,
): T {
  const { statMask, mainMask } = mkCntrMasks(payload)
  const rowMap = new Map<string, number>()
  const outRows: TheoryRow[] = []
  const costs = new Uint8Array(rows.length)
  const sets = new Uint8Array(rows.length)
  const stats = new Float32Array(rows.length * ECHO_STAT_STRIDE)
  const mains = new Float32Array(rows.length * MAIN_BUFF_LEN)
  const keepSet = statMask.some(Boolean) || mainMask.some(Boolean)

  function copyPacked(dst: number, src: number): void {
    costs[dst] = encoded.costs[src] ?? 0
    sets[dst] = encoded.sets[src] ?? 0

    for (let offset = 0; offset < ECHO_STAT_STRIDE; offset += 1) {
      stats[dst * ECHO_STAT_STRIDE + offset] = encoded.stats[src * ECHO_STAT_STRIDE + offset] ?? 0
    }
    for (let offset = 0; offset < MAIN_BUFF_LEN; offset += 1) {
      mains[dst * MAIN_BUFF_LEN + offset] = mainEchoBuffs[src * MAIN_BUFF_LEN + offset] ?? 0
    }
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) {
      continue
    }

    const statSig = sigRow(encoded.stats, index * ECHO_STAT_STRIDE, statMask)
    const mainSig = row.mainOk
        ? sigRow(mainEchoBuffs, index * MAIN_BUFF_LEN, mainMask)
        : ''
    const key = [
      row.slot,
      keepSet ? row.set : '*',
      row.mainOk ? 1 : 0,
      statSig,
      mainSig,
    ].join('|')
    const seen = rowMap.get(key)

    if (seen != null) {
      const prev = outRows[seen]!
      if (row.cost !== prev.cost) {
        if (row.cost < prev.cost) {
          outRows[seen] = { ...row, ids: [...row.ids] }
          copyPacked(seen, index)
        }
        continue
      }

      if (!keepSet && row.set !== prev.set) {
        if (row.ids.length > prev.ids.length) {
          outRows[seen] = { ...row, ids: [...row.ids] }
          copyPacked(seen, index)
        }
        continue
      }

      mergeIds(prev, row)
      continue
    }

    rowMap.set(key, outRows.length)
    outRows.push({ ...row, ids: [...row.ids] })
    const dst = outRows.length - 1
    copyPacked(dst, index)
  }

  const kinds = new Uint16Array(outRows.length)
  for (let index = 0; index < outRows.length; index += 1) {
    kinds[index] = outRows[index]?.slot ?? 0
  }

  // walk the (dedupe-free) combo space once on this thread to derive the exact
  // count the producer will emit. cntThryEmt mirrors gnrtThryCpuCm's loop
  // structure with no per-combo allocation, so it completes in ms and gives an
  // exact progress denominator from t=0 (countTheory only gives a looser upper
  // bound). the same slot-equivalence reps the producer uses for
  // canonicalization are passed so the count matches the emitted set.
  const slotReps = payload.profs ? buildSlotReps(payload.profs) : null
  const exactTtl = cntThryEmt(outRows, slotReps)

  return {
    ...payload,
    costs: costs.slice(0, outRows.length),
    sets: sets.slice(0, outRows.length),
    kinds,
    comboN: outRows.length,
    totalCombos: exactTtl,
    lockMainCands: Int32Array.from(outRows
        .map((row, index) => row.mainOk ? index : -1)
        .filter((index) => index >= 0)),
    stats: stats.slice(0, outRows.length * ECHO_STAT_STRIDE),
    mainEchoBuffs: mains.slice(0, outRows.length * MAIN_BUFF_LEN),
    theoryTotal: exactTtl,
    theoryRows: outRows,
  }
}

function applyTheoryRows<T extends PrepTheoryTarget | PrepTheoryRot>(
    payload: T,
    input: OptStartPay,
    echoes: EchoInstance[],
    rows: TheoryRow[],
): T {
  const skll = payload.mode === 'theoryTarget'
      ? payload.selectedSkill
      : {
        id: 'theory:rotation',
        tab: 'rotation',
        element: 'physical' as const,
        skillType: [],
        archetype: 'skillDamage' as const,
      }
  const encoded = encEchoRows(echoes, skll, 'self')
  const mainEchoBuffs = payload.mode === 'theoryTarget'
      ? mkMainEchoRo({
        echoes,
        runtime: input.runtime,
        sourceBaseStats: payload.sourceBaseStats,
        sourceFinals: payload.sourceFinals,
        selectedSkill: payload.selectedSkill,
        mode: 'self',
      })
      : mkGnrcMainEc({
        echoes,
        runtime: input.runtime,
        sourceBaseStats: payload.sourceBaseStats,
        sourceFinals: payload.sourceFinals,
        mode: 'self',
      })

  // theory rows use profile slots as kind ids so set-piece counting mirrors a
  // legal five-echo build even when abstract filler rows share placeholder ids.
  const kinds = new Uint16Array(rows.length)
  for (let index = 0; index < rows.length; index += 1) {
    kinds[index] = rows[index]?.slot ?? 0
  }
  const thryTotal = countTheory(input.settings, input.runtime)
  const nextPayload = {
    ...payload,
    costs: encoded.costs,
    sets: encoded.sets,
    kinds,
    comboN: rows.length,
    totalCombos: thryTotal,
    lockMainReq: true,
    lockMainCands: Int32Array.from(rows
        .map((row, index) => row.mainOk ? index : -1)
        .filter((index) => index >= 0)),
    progFact: 1,
    stats: encoded.stats,
    mainEchoBuffs,
    theoryTotal: thryTotal,
    theoryRows: rows,
  }

  return prnThryRows(nextPayload, rows, encoded, mainEchoBuffs)
}

// compile single-target theory payloads by reusing the normal target context compiler
// with an empty bag, then attaching theory-specific catalog/profile inputs.
export function compThryTgt(input: OptStartPay): PrepTheoryTarget {
  const profs = mkThryProfs(input)
  const cats = mkThryCats(input)
  const theory = mkThryRows(input, cats)
  const base = compTgtRun({
    ...input,
    invChs: [],
  })

  // weapon search: score each build against every visible weapon and tag it
  // with the best. weapons
  // are a context axis, so the combo space (theory.rows) is unchanged, only
  // evaluation gains the weapon overlay loop.
  const weapons = input.settings.includeWeapons
      ? buildWeaponOverlays(input)
      : null

  const payload: PrepTheoryTarget = {
    ...base,
    mode: 'theoryTarget',
    staticData: input.staticData,
    theoryTotal: countTheory(input.settings, input.runtime),
    lockMainCands: mkMainCand(input, cats),
    profs,
    cats,
    mainFltr: [...input.settings.mainStatFilter],
    selBonus: input.settings.selectedBonus,
    theoryRows: [],
    weaponOverlays: weapons?.overlays,
    weaponCount: weapons?.count,
    weaponIds: weapons?.weaponIds,
  }

  return applyTheoryRows(payload, input, theory.echoes, theory.rows)
}

// compile rotation theory payloads by reusing the normal rotation context compiler
// with an empty bag, then attaching theory-specific catalog/profile inputs.
export function compThryRot(input: OptStartPay): PrepTheoryRot {
  const profs = mkThryProfs(input)
  const cats = mkThryCats(input)
  const theory = mkThryRows(input, cats)
  // weapon search is a theory-mode feature; opt the rotation compiler into
  // building per-weapon context sets when includeWeapons is on.
  const base = compRotRun(
      {
        ...input,
        invChs: [],
      },
      { weaponSearch: true },
  )

  const payload: PrepTheoryRot = {
    ...base,
    mode: 'theoryRotation',
    staticData: input.staticData,
    theoryTotal: countTheory(input.settings, input.runtime),
    lockMainCands: mkMainCand(input, cats),
    profs,
    cats,
    mainFltr: [...input.settings.mainStatFilter],
    selBonus: input.settings.selectedBonus,
    theoryRows: [],
  }

  return applyTheoryRows(payload, input, theory.echoes, theory.rows)
}
