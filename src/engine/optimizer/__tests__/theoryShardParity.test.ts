/*
  Verifies that sharding gnrtThryCpuCm across N producers reproduces the exact
  same combo multiset as a single producer - i.e. the union of shards [0,N) is
  identical to the unsharded output, and the shards are disjoint. This is the
  correctness guarantee behind the parallel theory producer.
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
import { gnrtThryCpuCm } from '@/engine/optimizer/target/theoryBatches.ts'
import { listOptTrgt } from '@/engine/optimizer/target/skills.ts'
import type { OptStartPay, PrepTheoryTarget } from '@/engine/optimizer/types.ts'

function mkEcho(cost: number, slot: number): EchoInstance {
  const def = listChsByCos(cost)[0]
  if (!def) throw new Error(`missing cost ${cost} echo`)
  const mainKey = Object.keys(ECHO_MAIN_STATS[cost] ?? {})[0] ?? 'atkPercent'
  const scnd = ECHO_SIDE_STATS[cost] ?? { key: 'atkFlat', value: 100 }
  return {
    uid: makeEchoUid(),
    id: def.id,
    set: def.sets[0] ?? 0,
    mainEcho: slot === 0,
    mainStats: {
      primary: { key: mainKey, value: ECHO_MAIN_STATS[cost]?.[mainKey] ?? 0 },
      secondary: { key: scnd.key, value: scnd.value },
    },
    substats: { atkPercent: 11.6, critRate: 9, critDmg: 18, atkFlat: 60 },
  }
}

function mkFilteredPayload(resId: string): OptStartPay {
  const seed = getResSeedBy(resId)
  if (!seed) throw new Error(`missing seed ${resId}`)
  const runtime = makeResRuntime(seed)
  runtime.build.echoes = [
    mkEcho(4, 0),
    mkEcho(3, 1),
    mkEcho(3, 2),
    mkEcho(1, 3),
    mkEcho(1, 4),
  ]
  const base = makeOptSets()
  const settings = {
    ...base,
    searchMode: 'theory' as const,
    rotationMode: false,
    targetSkillId: listOptTrgt(runtime)[0]?.id ?? null,
    resultsLimit: 256,
    // keep the combo space bounded for a fast, deterministic parity check
    mainStatFilter: ['cr', 'cd', 'atk%', 'bonus'],
    allowedSets: {
      1: base.allowedSets[1].slice(0, 2),
      3: base.allowedSets[3].slice(0, 2),
      5: base.allowedSets[5].slice(0, 2),
    },
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

// collect every emitted 5-echo combo as a canonical sorted-tuple string. the
// combo order within a row is meaningful (slot 0 is the main), so we keep the
// positional tuple as-is rather than sorting the 5 ids.
function collectCombos(
    payload: PrepTheoryTarget,
    shard?: { index: number; count: number },
): string[] {
  const out: string[] = []
  for (const batch of gnrtThryCpuCm({ payload, batchSize: 4096, shard })) {
    for (let i = 0; i < batch.comboCount; i += 1) {
      const base = i * 5
      out.push(
        `${batch.combos[base]},${batch.combos[base + 1]},` +
        `${batch.combos[base + 2]},${batch.combos[base + 3]},${batch.combos[base + 4]}`,
      )
    }
  }
  return out
}

describe('theory producer sharding parity', () => {
  for (const resId of ['1511', '1409']) {
    for (const shardCount of [2, 3, 6]) {
      it(`${resId}: union of ${shardCount} shards == single producer`, () => {
        const compiled = compOptPay(mkFilteredPayload(resId))
        if (compiled.mode !== 'theoryTarget') {
          throw new Error(`expected theoryTarget, got ${compiled.mode}`)
        }

        const single = collectCombos(compiled).sort()
        expect(single.length).toBeGreaterThan(0)

        const shardOutputs = Array.from({ length: shardCount }, (_, index) =>
          collectCombos(compiled, { index, count: shardCount }),
        )

        // shards must be non-empty (balanced enough) and disjoint
        const seen = new Set<string>()
        for (const shard of shardOutputs) {
          expect(shard.length).toBeGreaterThan(0)
          for (const combo of shard) {
            // disjointness only holds at the (plan,main)-unit level; within the
            // full space the same positional tuple can recur across plans, so
            // we compare multisets below rather than asserting per-tuple here.
            seen.add(combo)
          }
        }

        const union = shardOutputs.flat().sort()
        expect(union.length).toBe(single.length)
        expect(union).toEqual(single)
      })
    }
  }
})
