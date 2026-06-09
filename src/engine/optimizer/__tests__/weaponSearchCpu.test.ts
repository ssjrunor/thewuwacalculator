/*
  End-to-end CPU weapon search: compile a theory payload, attach weapon overlays
  (with one weapon made dominant), run the CPU pipeline, and assert every result
  is tagged with the dominant weapon, proving the weapon index threads through
  the evaluator, collector, and sort.
*/

import { describe, expect, it } from 'vitest'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals.ts'
import { makeEchoUid } from '@/domain/entities/runtime.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { makeEnemy, makeOptSets, makeResRuntime } from '@/domain/state/defaults.ts'
import { listChsByCos } from '@/domain/services/echoCatalogService.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { compOptPay } from '@/engine/optimizer/compiler'
import { buildWeaponOverlays } from '@/engine/optimizer/context/weaponOverlays.ts'
import { matThryRslts } from '@/engine/optimizer/results/materialize.ts'
import { runOptWithWr } from '@/engine/optimizer/workers/pool.ts'
import { listOptTrgt } from '@/engine/optimizer/target/skills.ts'
import {
  BASE_ATK,
  FINAL_ATK,
  WEAPON_OVERLAY_SLOTS,
  WEAPON_OVERLAY_STRIDE,
} from '@/engine/optimizer/config/constants.ts'
import type { OptStartPay } from '@/engine/optimizer/types.ts'

const HIYUKI = '1108'

function mkEcho(cost: number, slot: number): EchoInstance {
  const def = listChsByCos(cost)[0]
  if (!def) throw new Error(`missing cost ${cost}`)
  const mainKey = Object.keys(ECHO_MAIN_STATS[cost] ?? {})[0] ?? 'atkPercent'
  const scnd = ECHO_SIDE_STATS[cost] ?? { key: 'atkFlat', value: 100 }
  return {
    uid: makeEchoUid(), id: def.id, set: def.sets[0] ?? 0, mainEcho: slot === 0,
    mainStats: { primary: { key: mainKey, value: ECHO_MAIN_STATS[cost]?.[mainKey] ?? 0 }, secondary: { key: scnd.key, value: scnd.value } },
    substats: { atkPercent: 11.6, critRate: 9, critDmg: 18, atkFlat: 60 },
  }
}

function mkPay(): OptStartPay {
  const seed = getResSeedBy(HIYUKI)
  if (!seed) throw new Error('missing Hiyuki seed')
  const runtime = makeResRuntime(seed)
  runtime.build.echoes = [mkEcho(4, 0), mkEcho(3, 1), mkEcho(3, 2), mkEcho(1, 3), mkEcho(1, 4)]
  const base = makeOptSets()
  const settings = {
    ...base,
    searchMode: 'theory' as const,
    rotationMode: false,
    targetSkillId: listOptTrgt(runtime)[0]?.id ?? null,
    resultsLimit: 128,
    // bound the combo space so the run is fast and deterministic
    mainStatFilter: ['cr', 'cd', 'atk%', 'bonus'],
    allowedSets: {
      1: base.allowedSets[1].slice(0, 2),
      3: base.allowedSets[3].slice(0, 2),
      5: base.allowedSets[5].slice(0, 2),
    },
  }
  return {
    resonatorId: seed.id, resSeed: seed, runtime, settings, invChs: [],
    enemyProfile: makeEnemy(), setConds: DEF_SET_COND, rotTms: runtime.rotation.personalItems,
  }
}

describe('weapon search end-to-end (CPU)', () => {
  it('tags every result with the dominant weapon', { timeout: 120_000 }, async () => {
    const input = mkPay()
    const compiled = compOptPay(input)
    if (compiled.mode !== 'theoryTarget') throw new Error(`mode ${compiled.mode}`)

    const weapons = buildWeaponOverlays(input)
    expect(weapons).not.toBeNull()
    if (!weapons) return
    expect(weapons.count).toBeGreaterThan(1)

    // make the LAST weapon dominant: a huge ATK overlay so it always wins.
    const dominant = weapons.count - 1
    const baseAtkSlot = WEAPON_OVERLAY_SLOTS.indexOf(BASE_ATK)
    const finalAtkSlot = WEAPON_OVERLAY_SLOTS.indexOf(FINAL_ATK)
    const dbase = dominant * WEAPON_OVERLAY_STRIDE
    weapons.overlays[dbase + baseAtkSlot] = (weapons.overlays[dbase + baseAtkSlot] ?? 0) + 100000
    weapons.overlays[dbase + finalAtkSlot] = (weapons.overlays[dbase + finalAtkSlot] ?? 0) + 100000

    const withWeapons = {
      ...compiled,
      weaponOverlays: weapons.overlays,
      weaponCount: weapons.count,
      weaponIds: weapons.weaponIds,
    }

    const results = await runOptWithWr(withWeapons, 'cpu')
    expect(results.length).toBeGreaterThan(0)

    for (const r of results) {
      expect((r as { weapon?: number }).weapon).toBe(dominant)
    }

    // materialization surfaces the weapon's catalog id (the result column)
    const materialized = matThryRslts(withWeapons, results, withWeapons.resultsLimit)
    expect(materialized.length).toBeGreaterThan(0)
    const dominantId = weapons.weaponIds[dominant]
    for (const row of materialized) {
      expect(row.weaponId).toBe(dominantId)
    }
  })

  it('omits weapon when overlays are absent (baseline unchanged)', async () => {
    const input = mkPay()
    const compiled = compOptPay(input)
    if (compiled.mode !== 'theoryTarget') throw new Error(`mode ${compiled.mode}`)

    // explicitly strip overlays so this asserts the no-weapon path regardless of
    // the includeWeapons setting (which may attach them during compile).
    const withoutWeapons = {
      ...compiled,
      weaponOverlays: undefined,
      weaponCount: undefined,
      weaponIds: undefined,
    }

    const results = await runOptWithWr(withoutWeapons, 'cpu')
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect((r as { weapon?: number }).weapon).toBeUndefined()
    }
  })
})
