/*
  End-to-end CPU weapon search for combo (theory-rotation) mode: compile a theory
  rotation payload with includeWeapons on, make one weapon dominant by inflating
  its per-context FINAL_ATK, run the CPU pipeline, and assert every result is
  tagged with the dominant weapon, proving the weapon index threads through the
  rotation evaluator, collector, sort, and materialization.
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
import { matThryRslts } from '@/engine/optimizer/results/materialize.ts'
import { runOptWithWr } from '@/engine/optimizer/workers/pool.ts'
import { CTX_FLOATS, FINAL_ATK } from '@/engine/optimizer/config/constants.ts'
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

function mkPay(includeWeapons: boolean): OptStartPay {
  const seed = getResSeedBy(HIYUKI)
  if (!seed) throw new Error('missing Hiyuki seed')
  const runtime = makeResRuntime(seed)
  runtime.build.echoes = [mkEcho(4, 0), mkEcho(3, 1), mkEcho(3, 2), mkEcho(1, 3), mkEcho(1, 4)]
  const base = makeOptSets()
  const settings = {
    ...base,
    searchMode: 'theory' as const,
    rotationMode: true,
    includeWeapons,
    // single-worker eval so this CPU-heavy weapon run does not saturate every
    // core and starve other test files sharing the machine.
    lowMemoryMode: true,
    resultsLimit: 64,
    // hard-bound the combo space: weapon search multiplies eval cost by the
    // candidate count, so keep this run small to stay friendly to the suite.
    mainStatFilter: ['cr', 'cd'],
    allowedSets: {
      1: base.allowedSets[1].slice(0, 1),
      3: base.allowedSets[3].slice(0, 1),
      5: base.allowedSets[5].slice(0, 1),
    },
  }
  // restrict weapon search to 5★ candidates only: weapon search multiplies eval
  // cost by the candidate count, and a smaller pool keeps this test from
  // starving the parallel suite while still exercising count > 1.
  const weaponPlan = {
    mode: 'max' as const,
    target: 'max' as const,
    ranks: {},
    stdRank: 1,
    visible: { '5': true, '4': false, '3': false, '2': false, '1': false },
    states: {},
  }
  return {
    resonatorId: seed.id, resSeed: seed, runtime, settings, invChs: [],
    enemyProfile: makeEnemy(), setConds: DEF_SET_COND, rotTms: runtime.rotation.personalItems,
    weaponPlan,
  }
}

describe('weapon search end-to-end (rotation CPU)', () => {
  it('tags every result with the dominant weapon', { timeout: 120_000 }, async () => {
    const input = mkPay(true)
    const compiled = compOptPay(input)
    if (compiled.mode !== 'theoryRotation') throw new Error(`mode ${compiled.mode}`)

    // weapon search must have attached per-weapon context sets at compile time.
    expect(compiled.weaponContexts).toBeDefined()
    expect(compiled.weaponDisplayContexts).toBeDefined()
    expect(compiled.weaponCount ?? 0).toBeGreaterThan(1)
    if (!compiled.weaponContexts || !compiled.weaponDisplayContexts) return

    const weaponCount = compiled.weaponCount ?? 0
    const contextCount = compiled.contextCount
    const stride = compiled.contextStride
    expect(stride).toBe(CTX_FLOATS)
    expect(contextCount).toBeGreaterThan(0)

    // make the LAST weapon dominant: inflate FINAL_ATK in every one of its
    // contexts (and its display context) so it always wins regardless of combo.
    const dominant = weaponCount - 1
    const contexts = Float32Array.from(compiled.weaponContexts)
    const displays = Float32Array.from(compiled.weaponDisplayContexts)
    const perWeapon = contextCount * stride
    for (let c = 0; c < contextCount; c += 1) {
      const idx = dominant * perWeapon + c * stride + FINAL_ATK
      contexts[idx] = (contexts[idx] ?? 0) + 1_000_000
    }
    const dIdx = dominant * stride + FINAL_ATK
    displays[dIdx] = (displays[dIdx] ?? 0) + 1_000_000

    const withWeapons = {
      ...compiled,
      weaponContexts: contexts,
      weaponDisplayContexts: displays,
    }

    const results = await runOptWithWr(withWeapons, 'cpu')
    expect(results.length).toBeGreaterThan(0)

    for (const r of results) {
      expect((r as { weapon?: number }).weapon).toBe(dominant)
    }

    // materialization surfaces the weapon's catalog id (the result column)
    const materialized = matThryRslts(withWeapons, results, withWeapons.resultsLimit)
    expect(materialized.length).toBeGreaterThan(0)
    const dominantId = compiled.weaponIds?.[dominant]
    for (const row of materialized) {
      expect(row.weaponId).toBe(dominantId)
    }
  })

  it('omits weapon when contexts are absent (baseline unchanged)', { timeout: 120_000 }, async () => {
    // compile without weapon search so this stays cheap and asserts the genuine
    // no-weapon baseline.
    const input = mkPay(false)
    const compiled = compOptPay(input)
    if (compiled.mode !== 'theoryRotation') throw new Error(`mode ${compiled.mode}`)
    expect(compiled.weaponContexts).toBeUndefined()

    const results = await runOptWithWr(compiled, 'cpu')
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect((r as { weapon?: number }).weapon).toBeUndefined()
    }
  })
})
