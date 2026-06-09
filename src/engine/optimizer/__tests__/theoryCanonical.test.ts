/*
  Verifies the canonical-ordering prune: dropping duplicate builds at generation.
  A theory build's damage is permutation-invariant: it depends only on the
  multiset of (set, cost, main, id) specs across the five echoes, not on which
  slot holds which spec (all stat contributions are summed). With
  canonicalization ON the producer must emit (a) no two combos that are the same
  build (same spec-multiset + same main echo), and (b) the exact same SET of
  builds as the un-canonicalized space, nothing lost, only duplicates removed.
  cntThryEmt's count must also match the emitted total. Substats are deliberately
  distinct per slot to prove permutations collapse regardless of substat values.
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
import { buildSlotReps, cntThryEmt, gnrtThryCpuCm } from '@/engine/optimizer/target/theoryBatches.ts'
import { listOptTrgt } from '@/engine/optimizer/target/skills.ts'
import type { OptStartPay, PrepTheoryTarget } from '@/engine/optimizer/types.ts'

function mkEcho(cost: number, slot: number): EchoInstance {
  const def = listChsByCos(cost)[0]
  if (!def) throw new Error(`missing cost ${cost} echo`)
  const mainKey = Object.keys(ECHO_MAIN_STATS[cost] ?? {})[0] ?? 'atkPercent'
  const scnd = ECHO_SIDE_STATS[cost] ?? { key: 'atkFlat', value: 100 }
  return {
    uid: makeEchoUid(), id: def.id, set: def.sets[0] ?? 0, mainEcho: slot === 0,
    mainStats: { primary: { key: mainKey, value: ECHO_MAIN_STATS[cost]?.[mainKey] ?? 0 }, secondary: { key: scnd.key, value: scnd.value } },
    // DISTINCT substats per slot: all slots are still interchangeable because a
    // build's damage depends only on aggregate (summed) stats, so canonicalization
    // must collapse slot permutations regardless of per-slot substat differences.
    substats: { atkPercent: 10 + slot * 3, critRate: 11 + slot, critDmg: 12 + slot, atkFlat: 50 + slot * 5 },
  }
}

function mkPay(resId: string): OptStartPay {
  const seed = getResSeedBy(resId)
  if (!seed) throw new Error(`missing seed ${resId}`)
  const runtime = makeResRuntime(seed)
  runtime.build.echoes = [mkEcho(4, 0), mkEcho(3, 1), mkEcho(3, 2), mkEcho(1, 3), mkEcho(1, 4)]
  const base = makeOptSets()
  const settings = {
    ...base, searchMode: 'theory' as const, rotationMode: false,
    targetSkillId: listOptTrgt(runtime)[0]?.id ?? null, resultsLimit: 256,
    mainStatFilter: ['cr', 'cd', 'atk%', 'bonus'],
    allowedSets: { 1: base.allowedSets[1].slice(0, 2), 3: base.allowedSets[3].slice(0, 2), 5: base.allowedSets[5].slice(0, 2) },
  }
  return {
    resonatorId: seed.id, resSeed: seed, runtime, settings, invChs: [],
    enemyProfile: makeEnemy(), setConds: DEF_SET_COND, rotTms: runtime.rotation.personalItems,
  }
}

function collect(payload: PrepTheoryTarget, canonicalize: boolean): number[][] {
  const out: number[][] = []
  for (const batch of gnrtThryCpuCm({ payload, batchSize: 4096, canonicalize })) {
    for (let i = 0; i < batch.comboCount; i += 1) {
      const b = i * 5
      out.push([batch.combos[b]!, batch.combos[b + 1]!, batch.combos[b + 2]!, batch.combos[b + 3]!, batch.combos[b + 4]!])
    }
  }
  return out
}

describe('theory canonical-ordering prune', () => {
  for (const resId of ['1511', '1409']) {
    it(`${resId}: canonical set == full build set, with no duplicates`, { timeout: 20_000 }, () => {
      const compiled = compOptPay(mkPay(resId))
      if (compiled.mode !== 'theoryTarget') throw new Error(`mode ${compiled.mode}`)
      const reps = buildSlotReps(compiled.profs)

      // build identity = sorted multiset of (set, cost, main, id) specs with the
      // main echo marked. reps map every slot to one class, so the slot a spec
      // sits in does not enter the signature, so permutations collapse together.
      const sigOf = (combo: number[]): string =>
        combo
          .map((ri, k) => {
            const r = compiled.theoryRows[ri]!
            const spec = `${r.set}|${r.cost}|${r.main}|${r.mainOk ? r.id : ''}`
            return `${reps[r.slot]}#${spec}${k === 0 ? '*' : ''}`
          })
          .sort()
          .join(',')

      const full = collect(compiled, false)
      const canon = collect(compiled, true)

      expect(full.length).toBeGreaterThan(0)
      expect(canon.length).toBeGreaterThan(0)

      // (a) canonical output has no two combos with the same damage identity
      const canonSigs = canon.map(sigOf)
      expect(new Set(canonSigs).size).toBe(canon.length)

      // (b) it covers exactly the same set of distinct builds as the full space
      const fullSigSet = new Set(full.map(sigOf))
      expect(new Set(canonSigs)).toEqual(fullSigSet)

      // (c) it actually removed duplicates
      expect(canon.length).toBeLessThan(full.length)

      // (d) cntThryEmt with the same reps matches the emitted total exactly
      expect(cntThryEmt(compiled.theoryRows, reps)).toBe(canon.length)
    })
  }
})
