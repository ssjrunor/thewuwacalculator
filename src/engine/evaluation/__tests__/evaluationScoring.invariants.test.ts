/*
  Author: Runor Ewhro
  Description: stable invariants for evaluation scoring internals: request-key
               determinism, anchor cache reuse, and persisted-fixture output
               characterization.
*/

import { describe, expect, it } from 'vitest'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import { getResSeedBy, listResSds } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime, makeTeamMember, normProfTeam } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { matRtFromPro } from '@/engine/runtime/runtimeMaterialization'
import { initWpnStts } from '@/engine/runtime/sourceStateInit'
import { catWpnAtk } from '@/engine/runtime/weaponState'
import { maxResRt } from '@/engine/gameData/resonatorMax'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import type { ResProf } from '@/domain/entities/profile'
import type { EchoInstance } from '@/domain/entities/runtime'
import { runResSmlt } from '@/engine/pipeline'
import { sumOptRotDmg } from '@/engine/optimizer/rules/eligibility'
import { mkSuggMainEc, mkSuggVltnCt } from '@/engine/suggestions/shared'
import type { SuggestContext } from '@/engine/suggestions/types'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { assembleEvaluation, buildEvaluation, buildEvaluationAnchors } from '@/engine/evaluation/evaluation/search.ts'
import { makeEvaluationEchoFrame, preservedMainEchoFor } from '@/engine/evaluation/evaluation/echoDiscovery.ts'
import { evaluationAnchorCacheKey } from '@/engine/evaluation/evaluation/report.ts'
import { makeEvaluationOverviewStats } from '@/engine/evaluation/evaluation/stats.ts'
import { resolveEvaluationStats } from '@/engine/evaluation/evaluation/scoring.ts'
import {
  rotationBuildEvaluationReport,
  type BuildEvaluation,
} from '@/engine/evaluation/buildEvaluation.ts'
import { makeEvaluationKey } from '@/engine/evaluation/buildEvaluationKey'
import {
  applyEvaluationAsm,
  EVALUATION_ENEMY,
  makeEvaluationEnemy,
} from '@/modules/simulation/model/evaluationAssumptions'
import { getTuneStrainMaxForTeam } from '@/engine/gameData/tuneStrain'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'

const prodAppLoaders = import.meta.glob('../../../../prod-app.json', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

const loadProdApp = prodAppLoaders['../../../../prod-app.json']
const AUGUSTA_ID = '1306'

function buildInvariantEchoes(subKey: string): Array<EchoInstance | null> {
  // anchors should be reusable across different substat layouts, so this keeps
  // cost and main-stat structure stable while swapping one rolled substat family
  const spec: Array<[number, string]> = [
    [4, 'critRate'],
    [4, 'critDmg'],
    [3, 'atkPercent'],
    [1, 'atkPercent'],
    [1, 'atkPercent'],
  ]

  return spec.map(([cost, mainKey], slot) => {
    const definition = listChsByCos(cost)[0]
    const mainVal = ECHO_MAIN_STATS[cost]?.[mainKey] ?? Object.values(ECHO_MAIN_STATS[cost] ?? {})[0] ?? 0

    return {
      uid: `cache-${cost}-${slot}`,
      id: definition.id,
      set: 0,
      mainEcho: cost === 4 && slot === 0,
      mainStats: {
        primary: { key: mainKey, value: mainVal },
        secondary: { ...ECHO_SIDE_STATS[cost] },
      },
      substats: { [subKey]: 9, atkPercent: 6 },
    } as EchoInstance
  })
}

function evaluationContextFor(seedId: string, echoes: Array<EchoInstance | null>): SuggestContext | null {
  // evaluation anchors are built from suggestion context; the fixture therefore
  // runs the same simulation path the app uses before entering scoring helpers
  const enemy = makeEnemy()
  const seed = listResSds().find((entry) => entry.id === seedId)
  if (!seed) {
    return null
  }

  const runtime = makeResRuntime(seed)
  runtime.build.echoes = echoes
  const simulation = runResSmlt(runtime, seed, enemy, makeRuntimeMap(runtime, {}), {})

  return mkSuggVltnCt({
    scenarioId: combatScenarioId('evaluation:test'),
    memberId: teamMemberId(runtime.id),
    runtime,
    seed,
    enemy,
    runtimesById: {},
    selectedTargets: {},
    tgtFeatId: null,
    rotationMode: false,
  }, simulation)
}

function round(value: number, places: number): number {
  return Number(value.toFixed(places))
}

function materialize(profile: ResProf) {
  // persisted fixtures are profile-shaped, not runtime-shaped, so this mirrors
  // production hydration before scoring them
  const seed = getResSeedBy(profile.resonatorId)
  if (!seed) {
    throw new Error(`missing seed ${profile.resonatorId}`)
  }

  const runtime = matRtFromPro({
    seed,
    profile,
    slotId: 'active',
    localState: profile.runtime.local,
    teamSlots: normProfTeam(profile.resonatorId, profile.runtime.team),
    rotation: profile.runtime.rotation,
  })

  return { profile, runtime, seed }
}

async function loadFixtureProfiles(): Promise<ResProf[]> {
  // local fixture coverage is optional: pull the named augusta fixture and a
  // small deterministic slice from the prod snapshot when that file exists
  const profiles: ResProf[] = []

  if (loadProdApp) {
    const snapshot = JSON.parse(await loadProdApp()) as {
      calculator: { profiles: Record<string, ResProf> }
    }
    const augusta = snapshot.calculator.profiles[AUGUSTA_ID]
    if (augusta) {
      profiles.push(augusta)
    }
    profiles.push(
      ...Object.values(snapshot.calculator.profiles)
        .filter((profile) => profile.resonatorId !== AUGUSTA_ID)
        .sort((left, right) => left.resonatorId.localeCompare(right.resonatorId))
        .slice(0, 2),
    )
  }

  return profiles
}

function buildSignature(build: BuildEvaluation['builds']['referenceBuild']) {
  // signatures intentionally ignore echo uids and ordering noise, leaving only
  // the evaluation-relevant build shape and stat totals
  return {
    sets: build.sets.map((set) => `${set.setId}:${set.pieces}`).sort(),
    mainEcho: build.echoes.find((echo) => echo.mainEcho)?.echoId ?? null,
    costs: build.echoes.map((echo) => echo.cost).sort((left, right) => left - right),
    substats: build.statRows
      .filter((row) => row.substatCount > 0)
      .map((row) => `${row.key}:${round(row.substatCount, 3)}:${round(row.total, 3)}`)
      .sort(),
  }
}

function echoSlot(
  id: string,
  set: number,
  mainEcho: boolean,
  primary: EchoInstance['mainStats']['primary'],
  secondary: EchoInstance['mainStats']['secondary'],
  substats: EchoInstance['substats'] = {},
): EchoInstance {
  return {
    uid: `evaluation-main-preserve-${id}-${mainEcho ? 'main' : 'slot'}`,
    id,
    set,
    mainEcho,
    mainStats: {
      primary: { ...primary },
      secondary: { ...secondary },
    },
    substats: { ...substats },
  }
}

function fingerprint(evaluation: BuildEvaluation) {
  // numeric fields are rounded so snapshots catch meaningful evaluation drift
  // without failing on tiny floating-point serialization differences
  return {
    percent: round(evaluation.percent * 100, 4),
    grade: evaluation.grade,
    userDamage: round(evaluation.userDamage, 2),
    baselineDamage: round(evaluation.baselineDamage, 2),
    referenceDamage: round(evaluation.referenceDamage, 2),
    maximumDamage: round(evaluation.maximumDamage, 2),
    referenceBuild: buildSignature(evaluation.builds.referenceBuild),
    maximumBuild: buildSignature(evaluation.builds.maximumBuild),
  }
}

async function runEvaluation(profile: ResProf) {
  // The report is the only evaluation entry point, so fixture fingerprints
  // exercise both its score and detail fields together.
  const { runtime, seed } = materialize(profile)
  const enemy = makeEnemy()
  const runtimesById = makeRuntimeMap(runtime)
  const simulation = runResSmlt(
    runtime,
    seed,
    enemy,
    runtimesById,
    profile.runtime.routing.selectedTargetsByOwnerKey,
  )
  const input = {
    scenarioId: combatScenarioId('evaluation:test'),
    memberId: teamMemberId(runtime.id),
    runtime,
    simulation,
    enemy,
    runtimesById,
  }
  const report = rotationBuildEvaluationReport(input)
  if (!report) {
    throw new Error(`no evaluation for ${profile.resonatorId}`)
  }

  return { input, report }
}

const norm = (value: unknown) => JSON.parse(
  JSON.stringify(value, (key, entry) => (key === 'uid' ? undefined : entry)),
)

describe('evaluation scoring invariants', () => {
  it('keeps ordinary Echo stat edits out of the anchor cache key', () => {
    const seed = getResSeedBy('1212')
    if (!seed) throw new Error('missing Jingran seed')

    const baseEchoes = buildInvariantEchoes('hpPercent')
    const editedEchoes = buildInvariantEchoes('critDmg')
    const context = evaluationContextFor(seed.id, baseEchoes)
    if (!context) throw new Error('missing Jingran evaluation context')

    const baseRuntime = makeResRuntime(seed)
    baseRuntime.build.echoes = baseEchoes
    const editedRuntime = makeResRuntime(seed)
    editedRuntime.build.echoes = editedEchoes

    const enemy = makeEnemy()
    expect(evaluationAnchorCacheKey(context, baseRuntime, enemy))
      .toBe(evaluationAnchorCacheKey(context, editedRuntime, enemy))
  })

  it('uses conversion-aware evaluator totals in evaluation overview stats', () => {
    const hpEchoes = buildInvariantEchoes('hpPercent')
    const nonHpEchoes = buildInvariantEchoes('critDmg')
    const context = evaluationContextFor('1212', hpEchoes)
    if (!context) throw new Error('missing Jingran evaluation context')

    const overviewFor = (echoes: Array<EchoInstance | null>) => {
      const concrete = echoes.filter((echo): echo is EchoInstance => echo != null)
      const frame = makeEvaluationEchoFrame(context, concrete, mkSuggMainEc(context, echoes))
      const build = {
        stats: frame.stats,
        sets: frame.sets,
        kinds: frame.kinds,
        comboIds: frame.comboIds,
        mainEchoBuffs: frame.mainEchoBuffs,
        mainIndex: frame.mainIndex,
      }
      return {
        overview: makeEvaluationOverviewStats({
          ctx: context,
          ...build,
          setRows: frame.sets,
        }),
        resolved: resolveEvaluationStats(context, build),
      }
    }

    const withoutHp = overviewFor(nonHpEchoes)
    const withHp = overviewFor(hpEchoes)
    const withoutHpAtk = withoutHp.overview.mainStats.find((row) => row.key === 'atk')?.total
    const withHpAtk = withHp.overview.mainStats.find((row) => row.key === 'atk')?.total

    expect(withoutHp.resolved).not.toBeNull()
    expect(withHp.resolved).not.toBeNull()
    expect(withoutHpAtk).toBeCloseTo(withoutHp.resolved?.atk ?? 0, 5)
    expect(withHpAtk).toBeCloseTo(withHp.resolved?.atk ?? 0, 5)
    expect(withHpAtk).toBeGreaterThan(withoutHpAtk ?? Number.POSITIVE_INFINITY)
  })

  it('builds compact deterministic request keys', () => {
    const left = makeEvaluationKey({ runtime: { id: 'fixture-a', level: 90 }, values: new Float32Array([1, 2, 3]) })
    const right = makeEvaluationKey({ values: new Float32Array([1, 2, 3]), runtime: { level: 90, id: 'fixture-a' } })

    expect(left).toBe(right)
    expect(left.length).toBeLessThan(40)
    expect(makeEvaluationKey({ id: 'fixture-a', level: 90 })).not.toBe(makeEvaluationKey({ id: 'fixture-a', level: 80 }))
  })

  it('hashes typed-array views by their visible window rather than the shared backing buffer', () => {
    const shared = new Uint8Array([1, 2, 3, 4]).buffer

    expect(
      makeEvaluationKey({ values: new Uint8Array(shared, 0, 3) }),
    ).toBe(
      makeEvaluationKey({ values: new Uint8Array([1, 2, 3]) }),
    )
    expect(
      makeEvaluationKey({ values: new Uint8Array(shared, 0, 3) }),
    ).not.toBe(
      makeEvaluationKey({ values: new Uint8Array(shared, 1, 3) }),
    )
  })

  it('remains deterministic for circular object graphs', () => {
    const left: Record<string, unknown> = { id: 'fixture-a' }
    left.self = left

    const right: Record<string, unknown> = {}
    right.self = right
    right.id = 'fixture-a'

    expect(makeEvaluationKey(left)).toBe(makeEvaluationKey(right))
  })

  it('reuses one build anchor set to score another build without changing the result', () => {
    // anchor generation is expensive; this proves cached anchors can be reused
    // when the target context is the same but equipped substats differ
    const seedIds = listResSds().slice(0, 5).map((seed) => seed.id)
    let checked = 0

    for (const seedId of seedIds) {
      const buildA = buildInvariantEchoes('critRate')
      const buildB = buildInvariantEchoes('critDmg')
      const ctxA = evaluationContextFor(seedId, buildA)
      const ctxB = evaluationContextFor(seedId, buildB)
      if (!ctxA || !ctxB) {
        continue
      }

      const anchorsA = buildEvaluationAnchors(ctxA, buildA)
      const full = buildEvaluation(ctxB, buildB)
      if (!anchorsA || !full) {
        continue
      }
      checked += 1

      const cached = assembleEvaluation(ctxB, buildB, anchorsA)

      expect(cached.baselineDamage).toBe(full.baselineDamage)
      expect(cached.referenceDamage).toBe(full.referenceDamage)
      expect(cached.maximumDamage).toBe(full.maximumDamage)
      expect(norm(cached.builds.baselineBuild)).toEqual(norm(full.builds.baselineBuild))
      expect(norm(cached.builds.referenceBuild)).toEqual(norm(full.builds.referenceBuild))
      expect(norm(cached.builds.maximumBuild)).toEqual(norm(full.builds.maximumBuild))
      expect(cached.userDamage).toBe(full.userDamage)
      expect(cached.percent).toBe(full.percent)
      expect(cached.grade).toBe(full.grade)
      expect(norm(cached.builds.active)).toEqual(norm(full.builds.active))
    }

    expect(checked).toBeGreaterThan(0)
  }, 120000)

  it.runIf(Boolean(loadProdApp))(
    'pins scoring fingerprints for representative persisted fixtures',
    async () => {
      const profiles = await loadFixtureProfiles()
      expect(profiles.length).toBeGreaterThan(0)

      const fingerprints = []
      for (const profile of profiles) {
        const { report } = await runEvaluation(profile)
        fingerprints.push(fingerprint(report.evaluation))
      }

      expect(fingerprints).toMatchSnapshot()
    },
    120000,
  )

  it('keeps team-buffed Brant maximum-roll builds within the generated 200% anchor', () => {
    const seed = getResSeedBy('1206')
    if (!seed) throw new Error('missing Brant seed')
    const lupaSeed = getResSeedBy('1207')
    const mornyeSeed = getResSeedBy('1209')
    if (!lupaSeed || !mornyeSeed) throw new Error('missing Brant teammate seed')

    let runtime = maxResRt(
      makeResRuntime(seed),
      getResDtlsBy()[seed.id],
      { targetSequence: 6 },
    )
    const previousWeaponId = runtime.build.weapon.id
    runtime = {
      ...runtime,
      build: {
        ...runtime.build,
        weapon: catWpnAtk({
          id: '21020036',
          level: 90,
          rank: 5,
        }),
      },
    }
    runtime = applyEvaluationAsm(initWpnStts(runtime, {
      weaponId: runtime.build.weapon.id,
      prevWpnId: previousWeaponId,
      maxed: true,
    }))

    const maxSubstats = {
      energyRegen: 12.4,
      critDmg: 21,
      critRate: 10.5,
      atkPercent: 11.6,
      basicAtk: 11.6,
    }
    runtime.build.echoes = [
      echoSlot('6000084', 14, true, { key: 'critDmg', value: 44 }, { key: 'atkFlat', value: 150 }, maxSubstats),
      echoSlot('6000074', 14, false, { key: 'energyRegen', value: 32 }, { key: 'atkFlat', value: 100 }, maxSubstats),
      echoSlot('6000079', 14, false, { key: 'energyRegen', value: 32 }, { key: 'atkFlat', value: 100 }, maxSubstats),
      echoSlot('6000064', 14, false, { key: 'atkPercent', value: 18 }, { key: 'hpFlat', value: 2280 }, maxSubstats),
      echoSlot('6000070', 14, false, { key: 'atkPercent', value: 18 }, { key: 'hpFlat', value: 2280 }, maxSubstats),
    ]

    const lupa = makeTeamMember(lupaSeed)
    lupa.build.weapon = { id: '21010036', rank: 1, baseAtk: 587.5 }
    const mornye = makeTeamMember(mornyeSeed)
    mornye.build.weapon = { id: '21010066', rank: 1, baseAtk: 412.5 }
    runtime.build.team = ['1206', '1207', '1209']
    runtime.teamRuntimes = [lupa, mornye]
    Object.assign(runtime.state.controls, {
      'team:1207:resonator:1207:wildfire_banner:active': true,
      'team:1207:team:1207:pack_hunt:active': true,
      'team:1207:team:1207:pack_hunt:stacks': '2',
      'team:1207:team:1207:stand_by_me_warrior:active': true,
      'team:1207:inherent:1207:lvl70:stacks': '3',
      'team:1207:weapon:21010036:passive:ult_buff': true,
      'team:1207:weapon:21010036:passive:fusion_buff': true,
      'team:1209:resonator:1209:interfered_marker:active': true,
      'team:1209:resonator:1209:recursion:active': true,
      'team:1209:resonator:1209:decoupling:active': true,
      'team:1209:team:1209:high_syntony_field:active': true,
      'team:1209:weapon:21010066:passive:active': true,
    })

    expect(runtime.state.controls['resonator:1206:my_moment:active']).toBe(true)

    const runtimesById = makeRuntimeMap(runtime)
    const enemy = makeEvaluationEnemy(getTuneStrainMaxForTeam(runtime))
    const simulation = runResSmlt(runtime, seed, enemy, runtimesById, {})
    const report = rotationBuildEvaluationReport({
      scenarioId: combatScenarioId('evaluation:test'),
      memberId: teamMemberId(runtime.id),
      runtime,
      simulation,
      enemy,
      runtimesById,
    })
    const evaluation = report?.evaluation
    if (!evaluation) throw new Error('missing Brant evaluation')
    const rotationDamage = sumOptRotDmg(
      simulation.rotation.sequence.entries,
      runtime.id,
    )

    expect(evaluation.percent * 100).toBeLessThanOrEqual(200.00001)
    expect(simulation.finalStats.attribute.all.dmgBonus).toBeGreaterThanOrEqual(30)
    expect(Math.abs(rotationDamage - evaluation.userDamage))
      .toBeLessThanOrEqual(Math.max(1, rotationDamage * 1e-4))
    expect(evaluation.userDamage).toBeLessThanOrEqual(
      evaluation.maximumDamage + Math.max(1, evaluation.maximumDamage * 1e-7),
    )
    expect(evaluation.builds.maximumBuild.echoes.map((echo) => echo.primary.key))
      .toContain('atkPercent')
    expect(evaluation.builds.maximumBuild.statRows.find((row) => row.key === 'basicAtk')?.substatCount)
      .toBe(5)
    expect(evaluation.builds.maximumBuild.statRows.reduce((total, row) => total + row.substatCount, 0))
      .toBeCloseTo(25, 8)
  }, 120000)

  it('does not lock a self-only non-4-cost main echo into generated evaluation anchors', () => {
    const seed = getResSeedBy('1506')
    if (!seed) throw new Error('missing Phoebe seed')

    const runtime = applyEvaluationAsm(makeResRuntime(seed))
    runtime.build.echoes = [
      echoSlot('6000104', 11, true, { key: 'spectro', value: 30 }, { key: 'atkFlat', value: 100 }),
      echoSlot('6000071', 11, false, { key: 'atkPercent', value: 18 }, { key: 'hpFlat', value: 2280 }),
      echoSlot('6000093', 11, false, { key: 'atkPercent', value: 18 }, { key: 'hpFlat', value: 2280 }),
      echoSlot('6000092', 11, false, { key: 'critDmg', value: 44 }, { key: 'atkFlat', value: 150 }),
      echoSlot('6000096', 11, false, { key: 'spectro', value: 30 }, { key: 'atkFlat', value: 100 }),
    ]
    expect(preservedMainEchoFor(runtime.build.echoes)).toBeNull()

    const runtimesById = makeRuntimeMap(runtime)
    const simulation = runResSmlt(runtime, seed, EVALUATION_ENEMY, runtimesById, {})
    const report = rotationBuildEvaluationReport({
      scenarioId: combatScenarioId('evaluation:test'),
      memberId: teamMemberId(runtime.id),
      runtime,
      simulation,
      enemy: EVALUATION_ENEMY,
      runtimesById,
    })

    expect(report?.evaluation.builds.referenceBuild.echoes.find((echo) => echo.mainEcho)?.echoId).toBe('6000104')
    // Corrected legal-substat ranking makes Capitaneus the independent maximum
    // winner too; `preservedMainEchoFor` remaining null is the no-lock contract.
    expect(report?.evaluation.builds.maximumBuild.echoes.find((echo) => echo.mainEcho)?.echoId).toBe('6000104')
  }, 120000)
})
