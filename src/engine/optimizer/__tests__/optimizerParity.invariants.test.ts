/*
  Author: Runor Ewhro
  description: checks optimizer damage results against the simulation formula for the same builds.
*/

import { describe, expect, it } from 'vitest'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import type { SkillDef } from '@/domain/entities/stats.ts'
import { cloneEchoFor } from '@/domain/entities/inventoryStorage'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeOptSets, makeResRuntime, mkMaxResRt } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { compOptPay, compileBaseline } from '@/engine/optimizer/compiler'
import { buildSetRows, listDynamicSetStateParts, makeSetMask } from '@/engine/search/encode/sets'
import { runOptSrch } from '@/engine/optimizer/engine'
import { evalPrepOptB } from '@/engine/optimizer/results/materialize'
import { runResSmlt } from '@/engine/pipeline'
import { prepSkill } from '@/engine/pipeline/prepareRuntimeSkill'
import { calcSkillDamage } from '@/engine/formulas/damage'
import { makeOptContext } from '@/engine/search/context/compiled.ts'
import { packTargetCtx } from '@/engine/search/context/pack.ts'
import { AUX0, DMG_AMP } from '@/engine/search/layout/constants.ts'
import { getGameData } from '@/data/gameData'
import { listSrcStts } from '@/data/gameData/registry'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import { DEF_SET_COND, withSntSet } from '@/domain/entities/sonataSetConditionals'

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
    selectedTargets?: Record<string, string | null>,
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
    selectedTargets,
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

function makeSuiSuiFeatherRuntime(): { seed: ReturnType<typeof listResSds>[number]; runtime: ResRuntime; echoes: EchoInstance[] } {
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
  it('packs Final DMG together with Tune Break Boost for level-scaled damage', () => {
    const fixture = cases[0]
    expect(fixture).toBeTruthy()
    if (!fixture) return
    const seed = listResSds().find((entry) => entry.id === fixture.id)
    expect(seed).toBeTruthy()
    if (!seed) return

    const runtime = makeResRuntime(seed)
    const prepared = prepSkill({
      runtime,
      seed,
      enemy,
      skillId: fixture.skillId,
      runtimesById: makeRuntimeMap(runtime),
    })
    expect(prepared).toBeTruthy()
    if (!prepared) return

    const tuneSkill: SkillDef = {
      ...prepared.skill,
      id: 'optimizer-final-dmg-tune-rupture',
      label: 'Tune Rupture',
      tab: 'tuneBreak',
      archetype: 'tuneRupture',
      skillType: ['tuneRupture'],
      hits: [],
      tuneRuptureScale: 16,
      tuneRuptureCritRate: 0,
      tuneRuptureCritDmg: 1,
    }

    const finalStats = {
      ...prepared.context.finalStats,
      amplify: 75,
      tbb: 40,
      finalDmg: 25,
    }
    const compiled = makeOptContext({
      resonatorId: seed.id,
      runtime,
      skill: tuneSkill,
      finalStats,
      enemy,
      combatState: runtime.state.combat,
    })
    const packed = packTargetCtx({
      compiled,
      skill: tuneSkill,
      runtime,
      comboN: 5,
      comboK: 5,
      comboCount: 1,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: 0,
    })

    expect(compiled.statFinalDmg).toBe(25)
    expect(compiled.statAmp).toBe(0)
    expect(packed[DMG_AMP]).toBe(1)
    expect(packed[AUX0]).toBeCloseTo(1.4 * 1.25, 6)

    const negativeSkill: SkillDef = {
      ...tuneSkill,
      id: 'optimizer-spectro-frazzle',
      archetype: 'spectroFrazzle',
      element: 'spectro',
      skillType: ['basicAtk', 'spectroFrazzle'],
      skillBuffs: { amplify: 20 },
      hits: [{ count: 1, multiplier: 1 }],
    }
    const negativeStats = {
      ...finalStats,
      attribute: {
        ...finalStats.attribute,
        spectro: { ...finalStats.attribute.spectro, amplify: 15 },
      },
      skillType: {
        ...finalStats.skillType,
        all: { ...finalStats.skillType.all, amplify: 25 },
        basicAtk: { ...finalStats.skillType.basicAtk, amplify: 30 },
        spectroFrazzle: { ...finalStats.skillType.spectroFrazzle, amplify: 40 },
      },
    }
    const negativeCompiled = makeOptContext({
      resonatorId: seed.id,
      runtime,
      skill: negativeSkill,
      finalStats: negativeStats,
      enemy,
      combatState: { ...runtime.state.combat, spectroFrazzle: 1 },
    })
    const negativePacked = packTargetCtx({
      compiled: negativeCompiled,
      skill: negativeSkill,
      runtime,
      comboN: 5,
      comboK: 5,
      comboCount: 1,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: 0,
    })
    expect(negativeCompiled.statAmp).toBe(60)
    expect(negativePacked[DMG_AMP]).toBeCloseTo(1.6, 6)
  })

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
        scenarioId: combatScenarioId('optimizer:test'),
        memberId: teamMemberId(seedId),
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
      scenarioId: combatScenarioId('optimizer:test'),
      memberId: teamMemberId(seed.id),
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

  it.each([
    { extraER: 0, landscape: true, routedAway: false },
    { extraER: 100, landscape: true, routedAway: false },
    { extraER: 100, landscape: false, routedAway: false },
    { extraER: 100, landscape: true, routedAway: true },
  ])('applies Song of Feathered Trace and Reflecting Shadows after candidate echo stats (%j)', ({ extraER, landscape, routedAway }) => {
    const { seed, runtime, echoes } = makeSuiSuiFeatherRuntime()
    runtime.state.manualBuffs.quick.energyRegen += extraER
    runtime.state.controls['team:1110:ceaseless_landscape:active'] = landscape
    const selectedTargets = routedAway ? { 'team:1110:reflecting_shadows': '1404' } : undefined
    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = '1110101'
    settings.resultsLimit = 1

    const payload = compOptPay({
      scenarioId: combatScenarioId('optimizer:test'),
      memberId: teamMemberId(seed.id),
      resonatorId: seed.id,
      resSeed: seed,
      runtime,
      selectedTargets,
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

    const truth = canonicalDamageForMain(seed, runtime, settings.targetSkillId, echoes, 0, selectedTargets)
    expect(Math.abs(packed.damage - truth.damage)).toBeLessThanOrEqual(Math.max(1, truth.damage * 1e-4))
    expect(packed.stats.atk).toBeCloseTo(truth.atk, 3)
  })

  it('treats a zero packed set mask as all special set effects disabled', () => {
    const { seed, runtime, echoes } = makeSuiSuiFeatherRuntime()
    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = '1110101'
    const setConds = withSntSet(DEF_SET_COND, [
      { setId: 14, partKey: 'fivePiece', checked: false },
      { setId: 22, partKey: 'flamewingsShadow2pcP1', checked: false },
      { setId: 22, partKey: 'flamewingsShadow2pcP2', checked: false },
      { setId: 29, partKey: 'soundOfTrueName5pc', checked: false },
      { setId: 33, partKey: 'xuanlingsFeather', checked: false },
      { setId: 33, partKey: 'chongmingsFeather', checked: false },
    ])
    const score = (invChs: EchoInstance[]) => {
      const payload = compOptPay({
        scenarioId: combatScenarioId('optimizer:set-mask-zero'),
        memberId: teamMemberId(seed.id),
        resonatorId: seed.id,
        resSeed: seed,
        runtime,
        settings,
        invChs,
        enemyProfile: enemy,
        setConds,
      })
      expect(payload.mode).toBe('targetSkill')
      if (payload.mode !== 'targetSkill') throw new Error('expected target payload')
      expect(payload.setRtMask).toBe(0)
      return evalPrepOptB(payload, 0)?.damage
    }
    const twoPiece = echoes.map((echo, index) => index < 2 ? echo : { ...echo, set: 0 })

    expect(score(echoes)).toBeCloseTo(score(twoPiece) ?? 0, 8)
  })
})

// search controls never enter the equipped baseline's numeric result.
it.each([false, true])('dedicated baseline preserves packed results (rotation %s)', (rotationMode) => {
  const { seed, runtime } = makeShorekeeperRuntime()
  const settings = { ...makeOptSets(), rotationMode, searchMode: 'inventory' as const, targetSkillId: '1505021' }
  const input = {
    scenarioId: combatScenarioId('optimizer:baseline'), memberId: teamMemberId(seed.id),
    resonatorId: seed.id, resSeed: seed, runtime, settings,
    invChs: makeHighErInventory(), enemyProfile: enemy,
  }
  const full = compOptPay(input)
  const baseline = compileBaseline(input)
  expect(evalPrepOptB(baseline, 0)).toEqual(evalPrepOptB(full, 0))
  expect(baseline.comboBinom.length).toBe(0)
  expect(baseline.comboIndexMap.length).toBe(0)
  expect(baseline.constraints.length).toBe(0)
})

it.each([false, true])('compact theory finalization matches materialized results (rotation %s)', async (rotationMode) => {
  const { seed, runtime } = makeShorekeeperRuntime()
  runtime.build.echoes = makeHighErInventory()
  const settings = { ...makeOptSets(), rotationMode, searchMode: 'theory' as const, targetSkillId: '1505021', includeWeapons: true, resultsLimit: 8,
    allowedSets: { 1: [], 3: [], 5: [runtime.build.echoes[0]!.set] },
    lockedMainEchoId: runtime.build.echoes[0]!.id, mainStatFilter: ['atk%'],
  }
  const payload = compOptPay({
    scenarioId: combatScenarioId('optimizer:compact'), memberId: teamMemberId(seed.id),
    resonatorId: seed.id, resSeed: seed, runtime, settings, invChs: [], enemyProfile: enemy,
  })
  if (payload.mode !== 'theoryTarget' && payload.mode !== 'theoryRotation') throw new Error('expected theory')
  const { gnrtThryCpuCm } = await import('../target/theoryBatches')
  const { compactTheoryResults, matThryRslts } = await import('../results/materialize')
  const { compactTheoryEchoes } = await import('../results/theoryEchoes')
  const batch = gnrtThryCpuCm({ payload, batchSize: 8 }).next().value
  expect(batch).toBeTruthy()
  const raw = Array.from({ length: batch!.comboCount }, (_, i) => ({
    damage: 100 - i, i0: batch!.combos[i * 5]!, i1: batch!.combos[i * 5 + 1]!, i2: batch!.combos[i * 5 + 2]!,
    i3: batch!.combos[i * 5 + 3]!, i4: batch!.combos[i * 5 + 4]!, weapon: 0,
  }))
  const compact = compactTheoryResults(payload, raw)
  const materialized = matThryRslts(payload, raw)
  expect(compact.length).toBeGreaterThan(0)
  expect(compact.map((result) => { const echoes = compactTheoryEchoes(result); return {
    damage: result.damage, stats: result.stats, weaponId: result.weaponId, echoes, uids: echoes.map((echo) => echo.uid),
  } })).toEqual(materialized)
}, 60_000)
