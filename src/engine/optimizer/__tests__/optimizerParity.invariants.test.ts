/*
  Author: Runor Ewhro
  Description: accuracy guard for the optimizer's fast path. The optimizer scores
               builds with an encoded re-implementation of the damage formula
               (cpu/computeDamage + target/evaluate); if it drifts from the
               canonical calcSkillDamage, every ranking and reported number is
               wrong. This sweeps real optimizer results and asserts each
               reported damage equals what you actually get by equipping that
               build and recomputing through the real pipeline + formula.
*/

import { describe, expect, it } from 'vitest'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import { cloneEchoFor } from '@/domain/entities/inventoryStorage'
import { listChsByCos } from '@/domain/services/echoCatalogService'
import { listResSds } from '@/domain/services/resonatorSeedService'
import { makeEnemy, makeOptSets, makeResRuntime, mkMaxResRt } from '@/domain/state/defaults'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { compOptPay } from '@/engine/optimizer/compiler'
import { buildSetRows, listDynamicSetStateParts, makeSetMask } from '@/engine/optimizer/encode/sets'
import { runOptSrch } from '@/engine/optimizer/engine'
import { evalPrepOptB } from '@/engine/optimizer/results/materialize'
import { runResSmlt } from '@/engine/pipeline'
import { prepSkill } from '@/engine/pipeline/prepareRuntimeSkill'
import { calcSkillDamage } from '@/engine/formulas/damage'
import { getGameData } from '@/data/gameData'
import { listSrcStts } from '@/domain/gameData/registry'

const enemy = makeEnemy()

// a spread of inventory echoes (varied costs, sets, and primary values) so the
// search has real choices and returns several distinct builds to check.
function makeInventory(): EchoInstance[] {
  const pick = (cost: number, take: number) => listChsByCos(cost).slice(0, take)
  const echoes: EchoInstance[] = []
  let n = 0
  const push = (id: string, set: number, _cost: number, primary: number) => {
    echoes.push({
      uid: `inv-${n += 1}`,
      id,
      set,
      mainEcho: false,
      mainStats: {
        primary: { key: 'atkPercent', value: primary },
        secondary: { key: 'atkFlat', value: 18 },
      },
      substats: { critRate: 4 + (n % 3), critDmg: 8 + (n % 4), atkPercent: 6 },
    })
  }
  for (const def of pick(4, 3)) push(def.id, def.sets[0] ?? 0, 4, 30 + echoes.length)
  for (const def of pick(3, 3)) push(def.id, def.sets[0] ?? 0, 3, 24 + echoes.length)
  for (const def of pick(1, 5)) push(def.id, def.sets[0] ?? 0, 1, 18 + echoes.length)
  return echoes
}

function makeHighErInventory(): EchoInstance[] {
  const fourCost = listChsByCos(4)[0]
  const threeCosts = listChsByCos(3).slice(0, 2)
  const oneCosts = listChsByCos(1).slice(0, 2)

  expect(fourCost).toBeTruthy()
  expect(threeCosts).toHaveLength(2)
  expect(oneCosts).toHaveLength(2)
  if (!fourCost || threeCosts.length < 2 || oneCosts.length < 2) {
    throw new Error('missing high-er optimizer echo fixtures')
  }

  const makeEcho = (
      id: string,
      set: number,
      uid: string,
      cost: 1 | 3 | 4,
      primary: { key: string; value: number },
  ): EchoInstance => ({
    uid,
    id,
    set,
    mainEcho: false,
    mainStats: {
      primary,
      secondary: {
        key: cost === 1 ? 'hpFlat' : 'atkFlat',
        value: cost === 1 ? 2280 : cost === 3 ? 100 : 150,
      },
    },
    substats: {
      energyRegen: 12.4,
      critRate: 10.5,
      critDmg: 21,
      atkPercent: 11.6,
    },
  })

  return [
    makeEcho(fourCost.id, fourCost.sets[0] ?? 0, 'shore-main', 4, { key: 'critRate', value: 22 }),
    makeEcho(threeCosts[0].id, threeCosts[0].sets[0] ?? 0, 'shore-er-a', 3, { key: 'energyRegen', value: 32 }),
    makeEcho(threeCosts[1].id, threeCosts[1].sets[0] ?? 0, 'shore-er-b', 3, { key: 'energyRegen', value: 32 }),
    makeEcho(oneCosts[0].id, oneCosts[0].sets[0] ?? 0, 'shore-atk-a', 1, { key: 'atkPercent', value: 18 }),
    makeEcho(oneCosts[1].id, oneCosts[1].sets[0] ?? 0, 'shore-atk-b', 1, { key: 'atkPercent', value: 18 }),
  ]
}

function forceMainEchoStates(
    controls: ResRuntime['state']['controls'],
    echoId: string,
): ResRuntime['state']['controls'] {
  const next = { ...controls }
  for (const state of listSrcStts(getGameData(), { type: 'echo', id: echoId })) {
    if (state.kind === 'toggle') {
      next[state.controlKey] = true
    } else if (state.kind === 'stack' || state.kind === 'number') {
      if (typeof state.max === 'number') next[state.controlKey] = state.max
    } else if (state.kind === 'select') {
      const value = state.defaultValue ?? state.options?.[0]?.id
      if (value != null) next[state.controlKey] = value
    }
  }
  return next
}

function canonicalDamage(seedId: string, skillId: string, ordered: EchoInstance[]): number {
  const seed = listResSds().find((entry) => entry.id === seedId)!
  const base = makeResRuntime(seed)
  return canonicalDamageForRuntime(seed, base, skillId, ordered)
}

function canonicalDamageForRuntime(
    seed: ReturnType<typeof listResSds>[number],
    base: ResRuntime,
    skillId: string,
    ordered: EchoInstance[],
): number {
  let best = 0
  for (let mainIndex = 0; mainIndex < Math.min(5, ordered.length); mainIndex += 1) {
    const nextEchoes: Array<EchoInstance | null> = [null, null, null, null, null]
    for (let index = 0; index < Math.min(5, ordered.length); index += 1) {
      const echo = cloneEchoFor(ordered[index], index)
      nextEchoes[index] = { ...echo, mainEcho: index === mainIndex }
    }

    const controls = forceMainEchoStates(base.state.controls, ordered[mainIndex].id)
    const runtime = {
      ...base,
      build: { ...base.build, echoes: nextEchoes },
      state: { ...base.state, controls },
    }

    const prepared = prepSkill({
      runtime,
      seed,
      enemy,
      skillId,
      runtimesById: makeRuntimeMap(runtime),
    })
    if (!prepared) throw new Error(`skill ${skillId} unavailable on ${seed.id}`)

    const damage = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      runtime.base.level,
      runtime.state.combat,
    ).avg

    if (damage > best) best = damage
  }

  return best
}

function canonicalDamageForMain(
    seed: ReturnType<typeof listResSds>[number],
    base: ResRuntime,
    skillId: string,
    ordered: EchoInstance[],
    mainIndex: number,
): { damage: number; atk: number } {
  const nextEchoes: Array<EchoInstance | null> = [null, null, null, null, null]
  for (let index = 0; index < Math.min(5, ordered.length); index += 1) {
    const echo = cloneEchoFor(ordered[index], index)
    nextEchoes[index] = { ...echo, mainEcho: index === mainIndex }
  }

  const controls = forceMainEchoStates(base.state.controls, ordered[mainIndex].id)
  const runtime = {
    ...base,
    build: { ...base.build, echoes: nextEchoes },
    state: { ...base.state, controls },
  }

  const prepared = prepSkill({
    runtime,
    seed,
    enemy,
    skillId,
    runtimesById: makeRuntimeMap(runtime),
  })
  if (!prepared) throw new Error(`skill ${skillId} unavailable on ${seed.id}`)

  return {
    damage: calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      runtime.base.level,
      runtime.state.combat,
    ).avg,
    atk: prepared.context.finalStats.atk.final,
  }
}

function makeShorekeeperRuntime() {
  const seed = listResSds().find((entry) => entry.id === '1505')
  expect(seed).toBeTruthy()
  if (!seed) throw new Error('missing Shorekeeper seed')

  const runtime = mkMaxResRt(seed, 6)
  return {
    seed,
    runtime: {
      ...runtime,
      state: {
        ...runtime.state,
        controls: {
          ...runtime.state.controls,
          'resonator:1505:inner_stellarealm:active': true,
          'resonator:1505:supernal_stellarealm:active': true,
        },
      },
    },
  }
}

function makeSuiSuiFeatherRuntime() {
  const seed = listResSds().find((entry) => entry.id === '1110')
  expect(seed).toBeTruthy()
  if (!seed) throw new Error('missing SuiSui seed')

  const runtime = mkMaxResRt(seed, 0)
  const makeEcho = (
      uid: string,
      id: string,
      primary: EchoInstance['mainStats']['primary'],
      secondary: EchoInstance['mainStats']['secondary'],
  ): EchoInstance => ({
    uid,
    id,
    set: 33,
    mainEcho: false,
    mainStats: { primary, secondary },
    substats: {
      energyRegen: 12.4,
      critRate: 6.9,
      critDmg: 13.8,
      hpPercent: 7.1,
      resonanceSkill: 7.1,
    },
  })

  const echoes = [
    makeEcho('sui-main', '6000216', { key: 'hpPercent', value: 30 }, { key: 'atkFlat', value: 100 }),
    makeEcho('sui-four', '6000218', { key: 'critDmg', value: 44 }, { key: 'atkFlat', value: 150 }),
    makeEcho('sui-er', '6010216', { key: 'energyRegen', value: 32 }, { key: 'atkFlat', value: 100 }),
    makeEcho('sui-one-a', '6000202', { key: 'hpPercent', value: 22.8 }, { key: 'hpFlat', value: 2280 }),
    makeEcho('sui-one-b', '6000212', { key: 'hpPercent', value: 22.8 }, { key: 'hpFlat', value: 2280 }),
  ]

  return {
    seed,
    runtime: {
      ...runtime,
      state: {
        ...runtime.state,
        controls: {
          ...runtime.state.controls,
          'echoSet:33:bonus:xuanlingsFeather': false,
          'echoSet:33:bonus:chongmingsFeather': true,
        },
      },
    },
    echoes,
  }
}

// resonators that expose a directly targetable damage skill in a bare runtime.
function targetableSeeds(limit: number): Array<{ id: string; skillId: string }> {
  const found: Array<{ id: string; skillId: string }> = []
  for (const seed of listResSds()) {
    const runtime = makeResRuntime(seed)
    const sim = runResSmlt(runtime, seed, enemy, makeRuntimeMap(runtime))
    const skill = sim.allSkills.find((entry) => entry.aggregationType === 'damage' && entry.avg > 0)?.skill
    if (skill) found.push({ id: seed.id, skillId: skill.id })
    if (found.length >= limit) break
  }
  return found
}

const cases = targetableSeeds(5)

describe('optimizer parity invariants', () => {
  it('finds targetable resonators to check', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it.each(cases.map((entry) => [entry.id, entry.skillId] as const))(
    'optimizer damage matches the canonical formula for every result (%s / %s)',
    async (seedId, skillId) => {
      const seed = listResSds().find((entry) => entry.id === seedId)!
      const invChs = makeInventory()
      const runtime = makeResRuntime(seed)
      const settings = makeOptSets()
      settings.enableGpu = false
      settings.targetSkillId = skillId
      settings.resultsLimit = 8

      const results = await runOptSrch({
        resonatorId: seedId,
        runtime,
        settings,
        invChs,
        enemyProfile: enemy,
      })

      expect(results.length).toBeGreaterThan(0)

      const byUid = new Map(invChs.map((echo) => [echo.uid, echo]))
      for (const result of results) {
        const ordered = result.uids
          .map((uid) => byUid.get(uid))
          .filter((echo): echo is EchoInstance => Boolean(echo))
        expect(ordered).toHaveLength(result.uids.length)

        const truth = canonicalDamage(seedId, skillId, ordered)
        // the optimizer packs stats into Float32Array, so allow float32-scale
        // slack, but anything beyond that means the fast path drifted.
        expect(Math.abs(result.damage - truth)).toBeLessThanOrEqual(Math.max(1, truth * 1e-4))
      }

      // results are returned best-first; the reported damages must be sorted.
      const damages = results.map((result) => result.damage)
      for (let index = 1; index < damages.length; index += 1) {
        expect(damages[index - 1]).toBeGreaterThanOrEqual(damages[index])
      }
    },
  )

  it('reapplies Shorekeeper ER-sourced team crit after candidate echo stats', () => {
    const { seed, runtime } = makeShorekeeperRuntime()
    const invChs = makeHighErInventory()
    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = '1505021'
    settings.resultsLimit = 1

    const payload = compOptPay({
      resonatorId: seed.id,
      resSeed: seed,
      runtime,
      settings,
      invChs,
      enemyProfile: enemy,
    })

    const packed = evalPrepOptB(payload, 0)
    expect(packed).not.toBeNull()
    if (!packed) {
      return
    }

    const truth = canonicalDamageForRuntime(seed, runtime, settings.targetSkillId, invChs)
    expect(Math.abs(packed.damage - truth)).toBeLessThanOrEqual(Math.max(1, truth * 1e-4))
  })

  it('applies Song of Feathered Trace ER-sourced ATK after candidate echo stats', () => {
    const { seed, runtime, echoes } = makeSuiSuiFeatherRuntime()
    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = '1110101'
    settings.resultsLimit = 1

    const payload = compOptPay({
      resonatorId: seed.id,
      resSeed: seed,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    if (payload.mode !== 'targetSkill') {
      throw new Error('expected target payload')
    }
    const dynamicStateParts = listDynamicSetStateParts(payload.runtime)
    const displayPayload = {
      ...payload,
      setRtMask: makeSetMask(payload.runtime, undefined, { dynamicStateParts }),
      setConstLut: buildSetRows(payload.runtime, undefined, { dynamicStateParts }),
    }

    const packed = evalPrepOptB(displayPayload, 0)
    expect(packed).not.toBeNull()
    if (!packed?.stats) {
      return
    }

    const truth = canonicalDamageForMain(seed, runtime, settings.targetSkillId, echoes, 0)
    expect(Math.abs(packed.damage - truth.damage)).toBeLessThanOrEqual(Math.max(1, truth.damage * 1e-4))
    expect(packed.stats.atk).toBeCloseTo(truth.atk, 3)
  })
})
