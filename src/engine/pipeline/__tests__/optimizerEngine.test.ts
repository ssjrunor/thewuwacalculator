import { describe, expect, it } from 'vitest'
import { listChsByCos } from '@/domain/services/echoCatalogService'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { makeResRuntime, makeOptSets, makeEnemy } from '@/domain/state/defaults'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { cloneEchoFor } from '@/domain/entities/inventoryStorage'
import {
  DEF_SET_COND,
  withSntSet,
} from '@/domain/entities/sonataSetConditionals'
import { listRtSkills } from '@/domain/services/runtimeSourceService'
import {
  OPT_BATCH_SIZE,
  TARGET_GPU_JOB,
  MAIN_BUFF_LEN,
  OPT_RDC_K,
} from '@/engine/optimizer/config/constants'
import { runOptSrch } from '@/engine/optimizer/engine'
import { compOptPay } from '@/engine/optimizer/compiler'
import { psssCstrs as passesCpuConstraints, encStatCstrs } from '@/engine/optimizer/constraints/statConstraints'
import {
  buildSetRows,
  makeSetMask,
  getSetRowFfs,
  SETCNSTLUTST,
  SETRTTGLALL,
} from '@/engine/optimizer/encode/sets'
import {countOptRows, countOptCombos} from '@/engine/optimizer/search/counting'
import {
  evalPrepOptB,
  matOptRslts,
} from '@/engine/optimizer/results/materialize.ts'
import { evalTarget } from '@/engine/optimizer/target/evaluate'
import { runTgtSrchJo } from '@/engine/optimizer/search/targetCpu'
import { nrnkCmbn } from '@/engine/optimizer/combos/combinadic.ts'
import { OptResultSet, mkOptBagRslt } from '@/engine/optimizer/results/collector.ts'
import { compOptTgtCt } from '@/engine/optimizer/target/context'
import { packTargetSkill } from '@/engine/optimizer/payloads/targetPayload'
import { applyPersRot } from '@/engine/optimizer/rotation/runtime'
import { listOptTrgt } from '@/engine/optimizer/target/skills'
import {
  resTgtGpuCll,
  resTgtGpuJob,
} from '@/engine/optimizer/workers/pool'
import { mkTgtGpuSttc } from '@/engine/optimizer/workers/targetGpu'
import { runResSmlt } from '@/engine/pipeline'
import { prepSkill } from '@/engine/pipeline/prepareRuntimeSkill'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'
import { makeSkillDamage, calcSkillDamage } from '@/engine/formulas/damage'
import type { EchoInstance } from '@/domain/entities/runtime'

const setCol = (name: typeof SETCNSTLUTST[number]) => SETCNSTLUTST.indexOf(name)

function makeEchoInstance(
  id: string,
  set: number,
  uid: string,
  primaryValue: number,
): EchoInstance {
  return {
    uid,
    id,
    set,
    mainEcho: false,
    mainStats: {
      primary: { key: 'atkPercent', value: primaryValue },
      secondary: { key: 'atkFlat', value: 20 },
    },
    substats: {
      critRate: 4,
      critDmg: 8,
    },
  }
}

function buildCandidateRuntime(runtime: ReturnType<typeof makeResRuntime>, echoes: EchoInstance[]) {
  const mainEcho = echoes[0]

  return {
    ...runtime,
    build: {
      ...runtime.build,
      echoes: echoes.map((echo, index) => cloneEchoFor(echo, index)),
    },
    state: {
      ...runtime.state,
      controls: {
        ...runtime.state.controls,
        ...(mainEcho ? { [`echo:${mainEcho.id}:main:active`]: true } : {}),
      },
    },
  }
}

function stripRuntimeEchoes(runtime: ReturnType<typeof makeResRuntime>) {
  return {
    ...runtime,
    build: {
      ...runtime.build,
      echoes: [null, null, null, null, null],
    },
  }
}

function selectVisibleSkillId(
  runtime: ReturnType<typeof makeResRuntime>,
  predicate: (skill: ReturnType<typeof resolveSkill>) => boolean,
): string | null {
  const skill = listRtSkills(runtime)
    .map((entry) => resolveSkill(runtime, entry))
    .find((entry) => entry.visible && predicate(entry))
  return skill?.id ?? null
}

function evaluateCompiledDisplay(params: {
  resonatorId: string
  runtime: ReturnType<typeof makeResRuntime>
  enemy: ReturnType<typeof makeEnemy>
  echoes: EchoInstance[]
  skillId: string
  lockedMainEchoId: string
}) {
  const settings = makeOptSets()
  settings.enableGpu = true
  settings.targetSkillId = params.skillId
  settings.lockedMainEchoId = params.lockedMainEchoId

  const compiled = compOptPay({
    resonatorId: params.resonatorId,
    runtime: params.runtime,
    settings,
    invChs: params.echoes,
    enemyProfile: params.enemy,
  })

  expect(compiled.mode).toBe('targetSkill')
  if (compiled.mode !== 'targetSkill') {
    return null
  }

  const execution = packTargetSkill(compiled)

  return evalTarget({
    context: execution.context,
    stats: execution.stats,
    setConstLut: execution.setConstLut,
    mainEchoBuffs: execution.mainEchoBuffs,
    sets: execution.sets,
    kinds: execution.kinds,
    comboIds: Int32Array.from(params.echoes.map((_, index) => index)),
    mainIndex: 0,
    constraints: execution.constraints,
  })
}

function enumerateFiveEchoCombinations(echoes: EchoInstance[]): EchoInstance[][] {
  const out: EchoInstance[][] = []
  for (let a = 0; a < echoes.length - 4; a += 1) {
    for (let b = a + 1; b < echoes.length - 3; b += 1) {
      for (let c = b + 1; c < echoes.length - 2; c += 1) {
        for (let d = c + 1; d < echoes.length - 1; d += 1) {
          for (let e = d + 1; e < echoes.length; e += 1) {
            out.push([echoes[a], echoes[b], echoes[c], echoes[d], echoes[e]])
          }
        }
      }
    }
  }
  return out
}

function buildBruteForceBestForLockedMain(params: {
  resonatorId: string
  runtime: ReturnType<typeof makeResRuntime>
  enemy: ReturnType<typeof makeEnemy>
  echoes: EchoInstance[]
  skillId: string
  lockedMainEchoId: string
}): { damage: number; uids: string[] } | null {
  let best: { damage: number; uids: string[] } | null = null

  for (const combo of enumerateFiveEchoCombinations(params.echoes)) {
    if (!combo.some((echo) => echo.id === params.lockedMainEchoId)) {
      continue
    }

    const evaluated = evaluateCompiledDisplay({
      resonatorId: params.resonatorId,
      runtime: params.runtime,
      enemy: params.enemy,
      echoes: combo,
      skillId: params.skillId,
      lockedMainEchoId: params.lockedMainEchoId,
    })
    if (!evaluated) {
      continue
    }

    if (!best || evaluated.damage > best.damage) {
      best = {
        damage: evaluated.damage,
        uids: combo.map((echo) => echo.uid).sort(),
      }
    }
  }

  return best
}

describe('optimizer engine', () => {
  it('keeps the GPU reduce fan-out in sync with the target shaders', () => {
    expect(OPT_RDC_K).toBe(8)
  })

  it('hashes GPU static payloads using full typed-array bytes', () => {
    const makePayload = (tail: number, byteLength = 5) => ({
      context: new Float32Array([1, 2, 3, 4]),
      stats: new Float32Array([5, 6, 7, 8]),
      setConstLut: new Float32Array([9, 10, 11, 12]),
      costs: new Float32Array(byteLength).fill(1).map((value, index) => index === byteLength - 1 ? tail : value),
      constraints: new Float32Array([13, 14]),
      mainEchoBuffs: new Float32Array([15, 16, 17, 18]),
      sets: new Float32Array(byteLength).fill(2).map((value, index) => index === byteLength - 1 ? tail : value),
      kinds: new Int32Array([19, 20, 21]),
      comboN: 5,
      comboK: 5,
      totalCombos: 1,
      comboIndexMap: new Int32Array([0, 1, 2, 3, 4]),
      comboBinom: new Uint32Array([1, 5, 10, 10, 5, 1]),
      lockMainReq: false,
      lockMainCands: new Int32Array([0, 1, 2, 3, 4]),
    })

    expect(mkTgtGpuSttc(makePayload(5))).not.toBe(mkTgtGpuSttc(makePayload(6)))
    expect(mkTgtGpuSttc(makePayload(5, 5))).not.toBe(mkTgtGpuSttc(makePayload(5, 6)))
  })

  it('counts ordered slot-0 combinations and respects locked main echo filters', () => {
    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)

    expect(fourCost).toBeTruthy()
    expect(oneCosts).toHaveLength(4)

    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    expect(countOptRows(echoes, null)).toBe(5)
    expect(countOptRows(echoes, fourCost.id)).toBe(1)
    expect(countOptRows(echoes, 'missing-echo')).toBe(0)
    expect(countOptCombos(echoes, null, 'combos')).toBe(1)
    expect(countOptCombos(echoes, null, 'combinadic')).toBe(5)
  })

  it('returns scored optimizer results with the locked echo in slot 0', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10

    const targetSkill = runResSmlt(
      runtime,
      seed,
      makeEnemy(),
      makeRuntimeMap(runtime),
    ).perSkill.find((entry) => entry.avg > 0)?.skill

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = targetSkill.id
    settings.lockedMainEchoId = fourCost.id
    settings.resultsLimit = 8

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: makeEnemy(),
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.uids[0]).toBe('main-lock')
    expect(results[0]?.damage).toBeGreaterThan(0)
    expect(results[0]?.stats).not.toBeNull()
    expect(results[0]?.stats?.atk).toBeGreaterThan(0)
  })

  it('filters out combinations that fail stat constraints', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    const targetSkill = runResSmlt(
      runtime,
      seed,
      makeEnemy(),
      makeRuntimeMap(runtime),
    ).perSkill.find((entry) => entry.avg > 0)?.skill

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = targetSkill.id
    settings.statConstraints = {
      atk: { minTotal: '999999' },
    }

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: makeEnemy(),
    })

    expect(results).toHaveLength(0)
  })

  it('encodes disabled stat constraints with GPU fast-path sentinels', () => {
    const settings = makeOptSets()
    const encoded = encStatCstrs(settings)

    expect(Array.from(encoded)).toEqual([
      1, 0,
      1, 0,
      1, 0,
      1, 0,
      1, 0,
      1, 0,
      1, 0,
      1, 0,
    ])
  })

  it('treats disabled constraint sentinels as pass in CPU evaluation helpers', () => {
    const constraints = new Float32Array([
      1, 0,
      1, 0,
      1, 0,
      1, 0,
      1, 0,
      1, 0,
      1, 0,
      1, 0,
    ])

    expect(passesCpuConstraints(constraints, 10, 10, 10, 10, 10, 10, 10, 10)).toBe(true)
  })

  it('encodes stateful optimizer set effects at max without reading runtime toggles', () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.state.controls['echoSet:27:bonus:trailblazingStar5pc'] = false

    const setRows = buildSetRows(runtime)
    const row = getSetRowFfs(27, 4)

    expect(makeSetMask(runtime)).toBe(SETRTTGLALL)
    expect(setRows[row + setCol('critRate')]).toBeGreaterThan(0)
    expect(setRows[row + setCol('fusion')]).toBeGreaterThan(10)
  })

  it('encodes set atMax effects into static optimizer rows', () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.state.controls['echoSet:35:bonus:netherRoadStacks'] = 0

    const enabledRows = buildSetRows(runtime, DEF_SET_COND)
    const disabledRows = buildSetRows(runtime, withSntSet(DEF_SET_COND, [
      { setId: 35, partKey: 'netherRoadStacks', checked: false },
    ]))
    const row = getSetRowFfs(35, 4)

    expect(enabledRows[row + setCol('critRate')]).toBe(20)
    expect(enabledRows[row + setCol('fusion')]).toBe(15)
    expect(disabledRows[row + setCol('critRate')]).toBe(0)
    expect(disabledRows[row + setCol('fusion')]).toBe(0)
  })

  it('adds dynamic set atMax rows only when the runtime state is maxed', () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    const dynamicStateParts = [{ setId: 35, partKey: 'netherRoadStacks' }]
    const row = getSetRowFfs(35, 4)

    runtime.state.controls['echoSet:35:bonus:netherRoadStacks'] = 3
    const partial = buildSetRows(runtime, DEF_SET_COND, { dynamicStateParts })
    expect(partial[row + setCol('critRate')]).toBe(15)
    expect(partial[row + setCol('fusion')]).toBe(0)

    runtime.state.controls['echoSet:35:bonus:netherRoadStacks'] = 4
    const maxed = buildSetRows(runtime, DEF_SET_COND, { dynamicStateParts })
    expect(maxed[row + setCol('critRate')]).toBe(20)
    expect(maxed[row + setCol('fusion')]).toBe(15)

    runtime.state.controls['echoSet:35:bonus:netherRoadStacks'] = 0
    const inactive = buildSetRows(runtime, DEF_SET_COND, { dynamicStateParts })
    expect(inactive[row + setCol('critRate')]).toBe(0)
    expect(inactive[row + setCol('fusion')]).toBe(0)
  })

  it('omits disabled set conditional rows from the optimizer LUT', () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    const enabledRows = buildSetRows(runtime, DEF_SET_COND)
    const setConditionals = withSntSet(DEF_SET_COND, [
      { setId: 27, partKey: 'trailblazingStar5pc', checked: false },
    ])
    const disabledRows = buildSetRows(runtime, setConditionals)
    const row = getSetRowFfs(27, 4)

    expect(enabledRows[row + setCol('critRate')]).toBeGreaterThan(0)
    expect(disabledRows[row + setCol('critRate')]).toBe(0)
    expect(enabledRows[row + setCol('fusion')]).toBeGreaterThan(disabledRows[row + setCol('fusion')])
    expect(disabledRows[row + setCol('fusion')]).toBe(10)
  })

  it('removes runtime mask bits when set conditionals are toggled off', () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    const setConditionals = withSntSet(DEF_SET_COND, [
      { setId: 14, partKey: 'fivePiece', checked: false },
      { setId: 22, partKey: 'flamewingsShadow2pcP1', checked: false },
      { setId: 22, partKey: 'flamewingsShadow2pcP2', checked: false },
      { setId: 29, partKey: 'soundOfTrueName5pc', checked: false },
    ])

    expect(makeSetMask(runtime, setConditionals)).toBe(0)
  })

  it('still excludes activeOther set buffs from optimizer encoding', () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    const setRows = buildSetRows(runtime)

    const moonlitFive = getSetRowFfs(8, 3)
    expect(setRows[moonlitFive + 0]).toBe(0)

    const chromaticFive = getSetRowFfs(28, 4)
    expect(setRows[chromaticFive + setCol('fusion')]).toBe(20)
  })

  it('applies Trailblazing Star 5pc for a legal unique 5-piece combo', () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.resonanceLiberation = 10
    const enemy = makeEnemy()
    const skillId = '1210202'

    const fivePiece = [
      makeEchoInstance('6000191', 27, 's27-0', 22),
      makeEchoInstance('6000193', 27, 's27-1', 10),
      makeEchoInstance('6000194', 27, 's27-2', 10),
      makeEchoInstance('6000196', 27, 's27-3', 10),
      makeEchoInstance('6000197', 27, 's27-4', 10),
    ]
    const fourPiece = [
      makeEchoInstance('6000191', 27, 's27-0', 22),
      makeEchoInstance('6000193', 28, 's27-1', 10),
      makeEchoInstance('6000194', 27, 's27-2', 10),
      makeEchoInstance('6000196', 27, 's27-3', 10),
      makeEchoInstance('6000197', 27, 's27-4', 10),
    ]

    const evaluatedFive = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes: fivePiece,
      skillId,
      lockedMainEchoId: '6000191',
    })
    const evaluatedFour = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes: fourPiece,
      skillId,
      lockedMainEchoId: '6000191',
    })

    expect(evaluatedFive).toBeTruthy()
    expect(evaluatedFour).toBeTruthy()
    if (!evaluatedFive || !evaluatedFour) {
      return
    }

    expect(evaluatedFive.damage).toBeGreaterThan(evaluatedFour.damage)
  })

  it('preserves Trailblazing Star 5pc through the GPU target search path', async () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.resonanceLiberation = 10
    const enemy = makeEnemy()
    const echoes = [
      makeEchoInstance('6000191', 27, 's27-0', 22),
      makeEchoInstance('6000193', 27, 's27-1', 10),
      makeEchoInstance('6000194', 27, 's27-2', 10),
      makeEchoInstance('6000196', 27, 's27-3', 10),
      makeEchoInstance('6000197', 27, 's27-4', 10),
    ]

    const settings = makeOptSets()
    settings.enableGpu = true
    settings.targetSkillId = '1210202'
    settings.lockedMainEchoId = '6000191'
    settings.resultsLimit = 8

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(results).toHaveLength(1)

    const evaluated = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes,
      skillId: '1210202',
      lockedMainEchoId: '6000191',
    })

    expect(evaluated).toBeTruthy()
    if (!evaluated) {
      return
    }

    expect(Math.abs((results[0]?.damage ?? 0) - evaluated.damage)).toBeLessThan(0.01)
  })

  it('matches brute-force best combo for Trailblazing Star in a mixed bag on CPU and GPU', async () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.resonanceLiberation = 10
    const enemy = makeEnemy()
    const skillId = '1210202'
    const lockedMainEchoId = '6000191'

    const trailblazingCombo = [
      makeEchoInstance('6000191', 27, 's27-0', 22),
      makeEchoInstance('6000193', 27, 's27-1', 10),
      makeEchoInstance('6000194', 27, 's27-2', 10),
      makeEchoInstance('6000196', 27, 's27-3', 10),
      makeEchoInstance('6000197', 27, 's27-4', 10),
    ]
    const distractors = [
      makeEchoInstance('6000100', 1, 'other-0', 22),
      makeEchoInstance('6000102', 1, 'other-1', 22),
      makeEchoInstance('6000120', 12, 'other-2', 10),
    ]
    const bag = [...trailblazingCombo, ...distractors]

    const bruteForceBest = buildBruteForceBestForLockedMain({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes: bag,
      skillId,
      lockedMainEchoId,
    })

    expect(bruteForceBest).toBeTruthy()
    if (!bruteForceBest) {
      return
    }

    expect(bruteForceBest.uids).toEqual(trailblazingCombo.map((echo) => echo.uid).sort())

    const cpuSettings = makeOptSets()
    cpuSettings.enableGpu = false
    cpuSettings.targetSkillId = skillId
    cpuSettings.lockedMainEchoId = lockedMainEchoId
    cpuSettings.resultsLimit = 8
    cpuSettings.keepPercent = 0

    const gpuSettings = makeOptSets()
    gpuSettings.enableGpu = true
    gpuSettings.targetSkillId = skillId
    gpuSettings.lockedMainEchoId = lockedMainEchoId
    gpuSettings.resultsLimit = 8
    gpuSettings.keepPercent = 0

    const [cpuResults, gpuResults] = await Promise.all([
      runOptSrch({
        resonatorId: seed.id,
        runtime,
        settings: cpuSettings,
        invChs: bag,
        enemyProfile: enemy,
      }),
      runOptSrch({
        resonatorId: seed.id,
        runtime,
        settings: gpuSettings,
        invChs: bag,
        enemyProfile: enemy,
      }),
    ])

    expect(cpuResults[0]?.uids.slice().sort()).toEqual(bruteForceBest.uids)
    expect(gpuResults[0]?.uids.slice().sort()).toEqual(bruteForceBest.uids)
    expect(Math.abs((cpuResults[0]?.damage ?? 0) - bruteForceBest.damage)).toBeLessThan(0.01)
    expect(Math.abs((gpuResults[0]?.damage ?? 0) - bruteForceBest.damage)).toBeLessThan(0.01)
  })

  it('ignores over-cost combos in the CPU range path', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const targetSkill = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    ).perSkill.find((entry) => entry.avg > 0)?.skill

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const fourCosts = listChsByCos(4).slice(0, 3)
    const oneCosts = listChsByCos(1).slice(0, 3)
    expect(fourCosts).toHaveLength(3)
    expect(oneCosts).toHaveLength(3)

    const echoes = [
      makeEchoInstance(fourCosts[0].id, fourCosts[0].sets[0], 'main-lock', 22),
      makeEchoInstance(fourCosts[1].id, fourCosts[1].sets[0], 'heavy-a', 44),
      makeEchoInstance(fourCosts[2].id, fourCosts[2].sets[0], 'heavy-b', 46),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `light-${index}`, 8 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = targetSkill.id
    settings.lockedMainEchoId = fourCosts[0].id
    settings.resultsLimit = 8

    const validCombos = [
      [echoes[0], echoes[1], echoes[3], echoes[4], echoes[5]],
      [echoes[0], echoes[2], echoes[3], echoes[4], echoes[5]],
    ]

    const expected = validCombos
      .map((combo) => ({
        combo,
        evaluated: evaluateCompiledDisplay({
          resonatorId: seed.id,
          runtime,
          enemy,
          echoes: combo,
          skillId: targetSkill.id,
          lockedMainEchoId: fourCosts[0].id,
        }),
      }))
      .filter((entry): entry is { combo: EchoInstance[]; evaluated: NonNullable<ReturnType<typeof evaluateCompiledDisplay>> } => Boolean(entry.evaluated))
      .sort((left, right) => right.evaluated.damage - left.evaluated.damage)[0]

    expect(expected).toBeTruthy()
    if (!expected) {
      return
    }

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.uids.slice().sort()).toEqual(expected.combo.map((echo) => echo.uid).sort())
    expect(Math.abs((results[0]?.damage ?? 0) - expected.evaluated.damage)).toBeLessThan(0.01)
  })

  it('matches the full simulation target-skill result for the same fixed loadout', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const targetSkill = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    ).perSkill.find((entry) => entry.avg > 0)?.skill

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = targetSkill.id
    settings.lockedMainEchoId = fourCost.id
    settings.resultsLimit = 8

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(results).toHaveLength(1)

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)

    const expected = runResSmlt(
      candidateRuntime,
      seed,
      enemy,
      makeRuntimeMap(candidateRuntime),
    )
    const expectedSkill = expected.perSkill.find((entry) => entry.skill.id === targetSkill.id)

    expect(expectedSkill).toBeTruthy()
    if (!expectedSkill) {
      return
    }

    expect(results[0]?.damage).toBeCloseTo(expectedSkill.avg, 4)
    expect(results[0]?.stats?.atk).toBeCloseTo(expected.finalStats.atk.final, 4)
    expect(results[0]?.stats?.hp).toBeCloseTo(expected.finalStats.hp.final, 4)
    expect(results[0]?.stats?.def).toBeCloseTo(expected.finalStats.def.final, 4)
    expect(results[0]?.stats?.er).toBeCloseTo(expected.finalStats.energyRegen, 4)
    expect(results[0]?.stats?.cr).toBeCloseTo(expected.finalStats.critRate, 4)
    expect(results[0]?.stats?.cd).toBeCloseTo(expected.finalStats.critDmg, 4)
    expect(results[0]?.stats?.bonus).toBeCloseTo(expected.finalStats.dmgBonus, 4)
    expect(results[0]?.stats?.amp).toBeCloseTo(expected.finalStats.amplify, 4)
  })

  it('matches full simulation when echo rows include skill-specific stats in the old slot order', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const targetSkill = listRtSkills(runtime)
      .map((skill) => resolveSkill(runtime, skill))
      .find((skill) => skill.visible && skill.tab === 'normalAttack')

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      {
        ...makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock-basic', 22),
        substats: {
          critRate: 4,
          critDmg: 8,
          basicAtk: 15,
          healingBonus: 9,
        },
      },
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-basic-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = targetSkill.id
    settings.lockedMainEchoId = fourCost.id
    settings.resultsLimit = 8

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(results).toHaveLength(1)

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)

    const prepared = prepSkill({
      runtime: candidateRuntime,
      seed,
      enemy,
      skillId: targetSkill.id,
      runtimesById: makeRuntimeMap(candidateRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      candidateRuntime.base.level,
      candidateRuntime.state.combat,
    )

    expect(Math.abs((results[0]?.damage ?? 0) - expected.avg)).toBeLessThan(0.01)
  })

  it('matches the full simulation target-skill result for the rebuilt gpu payload path', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const targetSkill = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    ).perSkill.find((entry) => entry.avg > 0)?.skill

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = true
    settings.targetSkillId = targetSkill.id
    settings.lockedMainEchoId = fourCost.id

    const compiled = compOptPay({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(compiled.mode).toBe('targetSkill')
    if (compiled.mode !== 'targetSkill') {
      return
    }

    const execution = packTargetSkill(compiled)
    const display = evalTarget({
      context: execution.context,
      stats: execution.stats,
      setConstLut: execution.setConstLut,
      mainEchoBuffs: execution.mainEchoBuffs,
      sets: execution.sets,
      kinds: execution.kinds,
      comboIds: Int32Array.from([0, 1, 2, 3, 4]),
      mainIndex: 0,
      constraints: execution.constraints,
    })

    expect(display).toBeTruthy()
    if (!display) {
      return
    }

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)

    const expected = runResSmlt(
      candidateRuntime,
      seed,
      enemy,
      makeRuntimeMap(candidateRuntime),
    )
    const expectedSkill = expected.perSkill.find((entry) => entry.skill.id === targetSkill.id)

    expect(expectedSkill).toBeTruthy()
    if (!expectedSkill) {
      return
    }

    expect(display.damage).toBeCloseTo(expectedSkill.avg, 4)
  })

  it('matches direct evaluation for a non-zero CPU combo range job', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const targetSkill = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    ).perSkill.find((entry) => entry.avg > 0)?.skill

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 5)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-range', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-range-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = targetSkill.id
    settings.resultsLimit = 8

    const compiled = compOptPay({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(compiled.mode).toBe('targetSkill')
    if (compiled.mode !== 'targetSkill') {
      return
    }

    const execution = packTargetSkill(compiled)
    const comboIds = nrnkCmbn(3, {
      comboN: execution.comboN,
      comboK: execution.comboK,
      totalCombos: execution.totalCombos,
      indexMap: execution.comboIndexMap,
      binom: execution.comboBinom,
      lockedIndex: -1,
    })

    let expectedDamage = 0
    let expectedMainIndex = -1
    for (let index = 0; index < comboIds.length; index += 1) {
      const mainIndex = comboIds[index]
      const evaluated = evalTarget({
        context: execution.context,
        stats: execution.stats,
        setConstLut: execution.setConstLut,
        mainEchoBuffs: execution.mainEchoBuffs,
        sets: execution.sets,
        kinds: execution.kinds,
        comboIds,
        mainIndex,
        constraints: execution.constraints,
      })
      if (!evaluated) {
        continue
      }
      if (evaluated.damage > expectedDamage) {
        expectedDamage = evaluated.damage
        expectedMainIndex = mainIndex
      }
    }

    const results = await runTgtSrchJo(
      execution,
      {
        comboStart: 3,
        comboCount: 1,
        lockMainIdx: -1,
        jobResultLimit: 1,
      },
    )

    expect(results).toHaveLength(1)
    expect(Math.abs((results[0]?.damage ?? 0) - expectedDamage)).toBeLessThan(0.01)
    expect(mkOptBagRslt([
      results[0]!.i0,
      results[0]!.i1,
      results[0]!.i2,
      results[0]!.i3,
      results[0]!.i4,
    ])).toBe(mkOptBagRslt(Array.from(comboIds)))
    expect(results[0]?.i0).toBe(expectedMainIndex)
  })

  it('derives the no-echo target baseline from the shared damage pipeline', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()
    const strippedRuntime = stripRuntimeEchoes(runtime)

    const targetSkillId = selectVisibleSkillId(
      strippedRuntime,
      (skill) => skill.tab === 'normalAttack',
    )

    expect(targetSkillId).toBeTruthy()
    if (!targetSkillId) {
      return
    }

    const prepared = prepSkill({
      runtime: strippedRuntime,
      seed,
      enemy,
      skillId: targetSkillId,
      runtimesById: makeRuntimeMap(strippedRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = makeSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      strippedRuntime.base.level,
    )

    const compiled = compOptTgtCt({
      runtime: strippedRuntime,
      resonatorId: seed.id,
      skillId: targetSkillId,
      enemy,
      runtimesById: makeRuntimeMap(strippedRuntime),
    })

    expect(compiled.compiled.baseAtk).toBeCloseTo(expected.baseAtk, 8)
    expect(compiled.compiled.baseHp).toBeCloseTo(expected.baseHp, 8)
    expect(compiled.compiled.baseDef).toBeCloseTo(expected.baseDef, 8)
    expect(compiled.compiled.statFinAtk).toBeCloseTo(expected.finalAtk, 8)
    expect(compiled.compiled.statFinHp).toBeCloseTo(expected.finalHp, 8)
    expect(compiled.compiled.statFinDef).toBeCloseTo(expected.finalDef, 8)
    expect(compiled.compiled.statFinEr).toBeCloseTo(expected.finalER, 8)
    expect(compiled.compiled.statCritRate).toBeCloseTo(expected.critRate, 8)
    expect(compiled.compiled.statCritDmg).toBeCloseTo(expected.critDmg, 8)
    expect(compiled.compiled.statDmgBonus).toBeCloseTo(expected.dmgBonus, 8)
    expect(compiled.compiled.statAmp).toBeCloseTo(expected.amplify, 8)
    expect(compiled.compiled.resMult).toBeCloseTo(expected.resMult, 8)
    expect(compiled.compiled.defMult).toBeCloseTo(expected.defMult, 8)
    expect(compiled.compiled.dmgReduction).toBeCloseTo(expected.dmgVulnMult, 8)
  })

  it('does not double count Sigillum liberation bonus for Aemeath', async () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.resonanceLiberation = 10
    runtime.state.controls['echoSet:27:bonus:trailblazingStar5pc'] = true
    const enemy = makeEnemy()

    const targetSkill = listRtSkills(runtime)
      .map((skill) => resolveSkill(runtime, skill))
      .find((skill) => skill.id === '1210202')

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const setId = 27
    const echoIds = ['6000191', '6000193', '6000194', '6000197', '6000196']
    const echoes = echoIds.map((echoId, index) => makeEchoInstance(
      echoId,
      setId,
      `aemeath-${index}`,
      index === 0 ? 22 : 10 + index,
    ))

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = targetSkill.id
    settings.lockedMainEchoId = '6000191'
    settings.resultsLimit = 8

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(results).toHaveLength(1)

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)

    const prepared = prepSkill({
      runtime: candidateRuntime,
      seed,
      enemy,
      skillId: targetSkill.id,
      runtimesById: makeRuntimeMap(candidateRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      candidateRuntime.base.level,
      candidateRuntime.state.combat,
    )

    expect(Math.abs((results[0]?.damage ?? 0) - expected.avg)).toBeLessThan(0.01)
  })

  it('keeps live runtime controls in the no-echo target baseline', () => {
    const seed = getResSeedBy('1210')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const baseRuntime = makeResRuntime(seed)
    baseRuntime.base.level = 90
    baseRuntime.base.skillLevels.resonanceLiberation = 10
    const enemy = makeEnemy()
    const targetSkillId = '1210202'

    const controlledRuntime = stripRuntimeEchoes({
      ...baseRuntime,
      state: {
        ...baseRuntime.state,
        controls: {
          ...baseRuntime.state.controls,
          'resonator:1210:tune_rupture_mode:active': true,
          'inherent:1210:lvl70:stacks': 3,
        },
      },
    })

    const baselineCompiled = compOptTgtCt({
      runtime: stripRuntimeEchoes(baseRuntime),
      resonatorId: seed.id,
      skillId: targetSkillId,
      enemy,
      runtimesById: makeRuntimeMap(stripRuntimeEchoes(baseRuntime)),
    })

    const controlledCompiled = compOptTgtCt({
      runtime: controlledRuntime,
      resonatorId: seed.id,
      skillId: targetSkillId,
      enemy,
      runtimesById: makeRuntimeMap(controlledRuntime),
    })

    expect(controlledCompiled.compiled.statAmp).toBeGreaterThan(baselineCompiled.compiled.statAmp)
  })

  it('can optimize a visible skill even when the personal rotation is empty', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = []
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const targetSkill = listRtSkills(runtime)
      .map((skill) => resolveSkill(runtime, skill))
      .find((skill) => skill.visible && skill.tab === 'normalAttack')

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = targetSkill.id
    settings.lockedMainEchoId = fourCost.id
    settings.resultsLimit = 8

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.damage).toBeGreaterThan(0)
  })

  it('compiles explicit personal rotation items into weighted optimizer contexts', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const baseline = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    )
    const rotationFeature = baseline.allFeatures.find((entry) => (
      entry.aggregationType === 'damage' &&
      entry.skill.tab !== 'negativeEffect'
    ))

    expect(rotationFeature).toBeTruthy()
    if (!rotationFeature) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.rotationMode = true
    settings.targetComboSourceId = `live:${seed.id}`

    const compiled = compOptPay({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
      rotTms: [{
        id: 'optimizer-rotation-item',
        type: 'feature',
        featureId: rotationFeature.feature.id,
        enabled: true,
      }],
    })

    expect(compiled.mode).toBe('rotation')
    if (compiled.mode !== 'rotation') {
      return
    }

    expect(compiled.contextCount).toBe(1)
    expect(compiled.contextWeight[0]).toBeGreaterThan(0)
    expect(compiled.contexts.length).toBe(compiled.contextCount * compiled.contextStride)
    expect(compiled.contextStride).toBe(36)
    expect(compiled.stats.length).toBe(echoes.length * 20)
    expect(compiled.mainEchoBuffs.length).toBe(echoes.length * MAIN_BUFF_LEN)
  })

  it('ignores loop run counts when compiling rotation optimizer contexts', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const baseline = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    )
    const rotationFeature = baseline.allFeatures.find((entry) => (
      entry.aggregationType === 'damage' &&
      entry.skill.tab !== 'negativeEffect'
    ))

    expect(rotationFeature).toBeTruthy()
    if (!rotationFeature) {
      return
    }

    const rotationItems = [
      {
        id: 'loop-start',
        type: 'loop' as const,
        kind: 'start' as const,
        loopId: 'loop-a',
        runs: 3,
      },
      {
        id: 'loop-feature',
        type: 'feature' as const,
        featureId: rotationFeature.feature.id,
        enabled: true,
      },
      {
        id: 'loop-end',
        type: 'loop' as const,
        kind: 'end' as const,
        loopId: 'loop-a',
      },
    ]

    const normalRuntime = applyPersRot(runtime, rotationItems)
    const normalSimulation = runResSmlt(
      normalRuntime,
      seed,
      enemy,
      makeRuntimeMap(normalRuntime),
    )
    expect(normalSimulation.rotations.personal.entries.filter((entry) => entry.nodeId === 'loop-feature')).toHaveLength(3)

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.rotationMode = true
    settings.targetComboSourceId = `live:${seed.id}`

    const compiled = compOptPay({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
      rotTms: rotationItems,
    })

    expect(compiled.mode).toBe('rotation')
    if (compiled.mode !== 'rotation') {
      return
    }

    expect(compiled.contextCount).toBe(1)
    expect(Array.from(compiled.contextWeight)).toEqual([1])
  })

  it('matches the simulated personal rotation total for a fixed loadout', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const baseline = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    )
    const rotationFeature = baseline.allFeatures.find((entry) => (
      entry.aggregationType === 'damage' &&
      entry.skill.tab !== 'negativeEffect'
    ))

    expect(rotationFeature).toBeTruthy()
    if (!rotationFeature) {
      return
    }

    const rotationItems = [{
      id: 'optimizer-rotation-item',
      type: 'feature' as const,
      featureId: rotationFeature.feature.id,
      enabled: true,
    }]

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const candidateRuntime = applyPersRot(
      buildCandidateRuntime(runtime, echoes),
      rotationItems,
    )
    const expected = runResSmlt(
      candidateRuntime,
      seed,
      enemy,
      makeRuntimeMap(candidateRuntime),
    ).rotations.personal.total.avg

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.rotationMode = true
    settings.targetComboSourceId = `live:${seed.id}`
    settings.lockedMainEchoId = fourCost.id
    settings.resultsLimit = 8

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
      rotTms: rotationItems,
    })

    expect(results).toHaveLength(1)
    expect(Math.abs((results[0]?.damage ?? 0) - expected)).toBeLessThan(0.01)
  })

  it('matches the direct baseline evaluator against a single optimizer result', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()
    const skillId = selectVisibleSkillId(runtime, (skill) => skill.tab === 'normalAttack')

    expect(skillId).toBeTruthy()
    if (!skillId) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = skillId
    settings.lockedMainEchoId = fourCost.id
    settings.resultsLimit = 8

    const compiled = compOptPay({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })
    const baseline = evalPrepOptB(compiled, 0)

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(baseline).toBeTruthy()
    expect(results).toHaveLength(1)
    expect(Math.abs((baseline?.damage ?? 0) - (results[0]?.damage ?? 0))).toBeLessThan(0.01)
  })

  it('matches the rotation baseline evaluator against a single optimizer result', async () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const baseline = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    )
    const rotationFeature = baseline.allFeatures.find((entry) => (
      entry.aggregationType === 'damage' &&
      entry.skill.tab !== 'negativeEffect'
    ))

    expect(rotationFeature).toBeTruthy()
    if (!rotationFeature) {
      return
    }

    const rotationItems = [{
      id: 'optimizer-rotation-item',
      type: 'feature' as const,
      featureId: rotationFeature.feature.id,
      enabled: true,
    }]

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = false
    settings.rotationMode = true
    settings.targetComboSourceId = `live:${seed.id}`
    settings.lockedMainEchoId = fourCost.id
    settings.resultsLimit = 8

    const compiled = compOptPay({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
      rotTms: rotationItems,
    })
    const baselineEvaluation = evalPrepOptB(compiled, 0)

    const results = await runOptSrch({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
      rotTms: rotationItems,
    })

    expect(baselineEvaluation).toBeTruthy()
    expect(results).toHaveLength(1)
    expect(Math.abs((baselineEvaluation?.damage ?? 0) - (results[0]?.damage ?? 0))).toBeLessThan(0.01)
  })

  it('applies selected personal rotation items without mutating the source runtime', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    const enemy = makeEnemy()
    const baseline = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    )
    const rotationFeature = baseline.allFeatures.find((entry) => (
      entry.aggregationType === 'damage' &&
      entry.skill.tab !== 'negativeEffect'
    ))

    expect(rotationFeature).toBeTruthy()
    if (!rotationFeature) {
      return
    }

    const rotationItems = [{
      id: 'preview-rotation-item',
      type: 'feature' as const,
      featureId: rotationFeature.feature.id,
      enabled: true,
    }]
    const originalItems = structuredClone(runtime.rotation.personalItems)

    const previewRuntime = applyPersRot(runtime, rotationItems)

    expect(previewRuntime).not.toBe(runtime)
    expect(previewRuntime.rotation.personalItems).toEqual(rotationItems)
    expect(previewRuntime.rotation.personalItems).not.toBe(rotationItems)
    expect(runtime.rotation.personalItems).toEqual(originalItems)
  })

  it('matches the damage section standalone skill flow for a visible feature skill', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    const enemy = makeEnemy()
    const runtimeLookup = makeRuntimeMap(runtime)
    const simulation = runResSmlt(runtime, seed, enemy, runtimeLookup)
    const displayEntry = simulation.allSkills.find((entry) => entry.aggregationType === 'damage')

    expect(displayEntry).toBeTruthy()
    if (!displayEntry) {
      return
    }

    const prepared = prepSkill({
      runtime,
      seed,
      enemy,
      skillId: displayEntry.skill.id,
      runtimesById: runtimeLookup,
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const result = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      runtime.base.level,
      runtime.state.combat,
    )

    expect(result.avg).toBeCloseTo(displayEntry.avg, 8)
    expect(result.normal).toBeCloseTo(displayEntry.normal, 8)
    expect(result.crit).toBeCloseTo(displayEntry.crit, 8)
  })

  it('finalizes target GPU results using ordered main-first ids', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.skillLevels.normalAttack = 10
    const enemy = makeEnemy()

    const targetSkill = listRtSkills(runtime)
      .map((skill) => resolveSkill(runtime, skill))
      .find((skill) => skill.visible && skill.tab === 'normalAttack')

    expect(targetSkill).toBeTruthy()
    if (!targetSkill) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = true
    settings.targetSkillId = targetSkill.id

    const compiled = compOptPay({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(compiled.mode).toBe('targetSkill')
    if (compiled.mode !== 'targetSkill') {
      return
    }

    const [result] = matOptRslts(echoes, [{
      damage: 123456,
      i0: 2,
      i1: 0,
      i2: 1,
      i3: 3,
      i4: 4,
    }], {
      limit: compiled.resultsLimit,
    })

    expect(result).toBeTruthy()
    expect(result?.damage).toBe(123456)
    expect(result?.uids).toEqual([
      echoes[2]?.uid,
      echoes[0]?.uid,
      echoes[1]?.uid,
      echoes[3]?.uid,
      echoes[4]?.uid,
    ])
    expect(result?.stats).toBeNull()
  })

  it('uses legacy target GPU oversample limits', () => {
    expect(resTgtGpuJob(128)).toBe(256)
    expect(resTgtGpuCll(128)).toBe(1024)
    expect(resTgtGpuCll(8192)).toBe(65536)
    expect(resTgtGpuJob(65536)).toBe(65536)
  })

  it('uses the tuned target GPU batch size', () => {
    expect(TARGET_GPU_JOB).toBe(20_000_000)
    expect(OPT_BATCH_SIZE).toBe(50_000_000)
  })

  it('restores the legacy default optimizer result limit', () => {
    expect(makeOptSets().resultsLimit).toBe(128)
  })

  it('keeps the legacy target GPU row widths', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    const enemy = makeEnemy()
    const skillId = selectVisibleSkillId(runtime, (skill) => skill.tab === 'normalAttack')
    expect(skillId).toBeTruthy()
    if (!skillId) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ]

    const settings = makeOptSets()
    settings.enableGpu = true
    settings.targetSkillId = skillId

    const compiled = compOptPay({
      resonatorId: seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: enemy,
    })

    expect(compiled.mode).toBe('targetSkill')
    if (compiled.mode !== 'targetSkill') {
      return
    }

    expect(compiled.stats.length / echoes.length).toBe(20)
    expect(compiled.mainEchoBuffs.length / echoes.length).toBe(MAIN_BUFF_LEN)
  })

  it('uses the same set key for the same five ids regardless of order', () => {
    expect(mkOptBagRslt([4, 2, 0, 3, 1])).toBe(
      mkOptBagRslt([0, 1, 2, 3, 4]),
    )
  })

  it('dedupes equivalent target GPU sets and prunes to the configured top-k', () => {
    const collector = new OptResultSet(2)

    collector.push({
      damage: 100,
      i0: 0,
      i1: 1,
      i2: 2,
      i3: 3,
      i4: 4,
    })
    collector.push({
      damage: 140,
      i0: 4,
      i1: 3,
      i2: 2,
      i3: 1,
      i4: 0,
    })
    collector.push({
      damage: 120,
      i0: 5,
      i1: 6,
      i2: 7,
      i3: 8,
      i4: 9,
    })
    collector.push({
      damage: 110,
      i0: 10,
      i1: 11,
      i2: 12,
      i3: 13,
      i4: 14,
    })

    expect(collector.sorted()).toEqual([
      {
        damage: 140,
        i0: 4,
        i1: 3,
        i2: 2,
        i3: 1,
        i4: 0,
      },
      {
        damage: 120,
        i0: 5,
        i1: 6,
        i2: 7,
        i3: 8,
        i4: 9,
      },
    ])
  })

  it('keeps only the newest best entry for a duplicate target GPU set', () => {
    const collector = new OptResultSet(2)

    collector.push({
      damage: 100,
      i0: 0,
      i1: 1,
      i2: 2,
      i3: 3,
      i4: 4,
    })
    collector.push({
      damage: 110,
      i0: 5,
      i1: 6,
      i2: 7,
      i3: 8,
      i4: 9,
    })
    collector.push({
      damage: 130,
      i0: 4,
      i1: 3,
      i2: 2,
      i3: 1,
      i4: 0,
    })

    expect(collector.sorted()).toEqual([
      {
        damage: 130,
        i0: 4,
        i1: 3,
        i2: 2,
        i3: 1,
        i4: 0,
      },
      {
        damage: 110,
        i0: 5,
        i1: 6,
        i2: 7,
        i3: 8,
        i4: 9,
      },
    ])
  })

  it('pushes ordered combo ids without allocating an intermediate combo result', () => {
    const collector = new OptResultSet(2)

    collector.pushRdrdCmb(150, Int32Array.from([8, 3, 5, 6, 7]), 5)

    expect(collector.sorted()).toEqual([
      {
        damage: 150,
        i0: 5,
        i1: 8,
        i2: 3,
        i3: 6,
        i4: 7,
      },
    ])
  })

  it('does not reapply 1206 ER-to-ATK conversion in rebuild evaluation', () => {
    const seed = getResSeedBy('1206')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.state.controls['resonator:1206:my_moment:active'] = true
    const enemy = makeEnemy()

    const skillId = selectVisibleSkillId(runtime, (skill) => skill.tab === 'normalAttack')
    expect(skillId).toBeTruthy()
    if (!skillId) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      {
        ...makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-1206', 22),
        substats: { critRate: 4, critDmg: 8, energyRegen: 20 },
      },
      ...oneCosts.map((echo, index) => ({
        ...makeEchoInstance(echo.id, echo.sets[0], `tail-1206-${index}`, 10 + index),
        substats: { critRate: 4, critDmg: 8, energyRegen: 20 },
      })),
    ]

    const display = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes,
      skillId,
      lockedMainEchoId: fourCost.id,
    })

    expect(display).toBeTruthy()
    if (!display) {
      return
    }

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)
    const prepared = prepSkill({
      runtime: candidateRuntime,
      seed,
      enemy,
      skillId,
      runtimesById: makeRuntimeMap(candidateRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      candidateRuntime.base.level,
      candidateRuntime.state.combat,
    )

    expect(Math.abs(display.damage - expected.avg)).toBeLessThan(0.01)
  })

  it('does not reapply 1209 marker/liberation scaling in rebuild evaluation', () => {
    const seed = getResSeedBy('1209')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.state.controls['resonator:1209:interfered_marker:active'] = true
    const enemy = makeEnemy()

    const skillId =
      selectVisibleSkillId(runtime, (skill) => skill.id === '1209021') ??
      selectVisibleSkillId(runtime, (skill) => skill.tab === 'resonanceLiberation')
    expect(skillId).toBeTruthy()
    if (!skillId) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      {
        ...makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-1209', 22),
        substats: { critRate: 4, critDmg: 8, energyRegen: 20 },
      },
      ...oneCosts.map((echo, index) => ({
        ...makeEchoInstance(echo.id, echo.sets[0], `tail-1209-${index}`, 10 + index),
        substats: { critRate: 4, critDmg: 8, energyRegen: 20 },
      })),
    ]

    const display = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes,
      skillId,
      lockedMainEchoId: fourCost.id,
    })

    expect(display).toBeTruthy()
    if (!display) {
      return
    }

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)
    const prepared = prepSkill({
      runtime: candidateRuntime,
      seed,
      enemy,
      skillId,
      runtimesById: makeRuntimeMap(candidateRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      candidateRuntime.base.level,
      candidateRuntime.state.combat,
    )

    expect(Math.abs(display.damage - expected.avg)).toBeLessThan(0.01)
  })

  it('does not reapply 1306 crit conversion in rebuild evaluation', () => {
    const seed = getResSeedBy('1306')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.base.sequence = 6
    runtime.state.controls['resonator:1306:crown_of_wills:stacks'] = 2
    const enemy = makeEnemy()

    const skillId = selectVisibleSkillId(runtime, (skill) => skill.tab === 'resonanceSkill')
    expect(skillId).toBeTruthy()
    if (!skillId) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      {
        ...makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-1306', 22),
        substats: { critRate: 25, critDmg: 8, energyRegen: 10 },
      },
      ...oneCosts.map((echo, index) => ({
        ...makeEchoInstance(echo.id, echo.sets[0], `tail-1306-${index}`, 10 + index),
        substats: { critRate: 25, critDmg: 8, energyRegen: 10 },
      })),
    ]

    const display = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes,
      skillId,
      lockedMainEchoId: fourCost.id,
    })

    expect(display).toBeTruthy()
    if (!display) {
      return
    }

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)
    const prepared = prepSkill({
      runtime: candidateRuntime,
      seed,
      enemy,
      skillId,
      runtimesById: makeRuntimeMap(candidateRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      candidateRuntime.base.level,
      candidateRuntime.state.combat,
    )

    expect(Math.abs(display.damage - expected.avg)).toBeLessThan(0.001)
  })

  it('does not reapply 1412 echo-skill ER conversion in rebuild evaluation', () => {
    const seed = getResSeedBy('1412')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    const enemy = makeEnemy()

    const skillId = selectVisibleSkillId(
      runtime,
      (skill) => Array.isArray(skill.skillType) && skill.skillType.includes('echoSkill'),
    )
    expect(skillId).toBeTruthy()
    if (!skillId) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      {
        ...makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-1412', 22),
        substats: { critRate: 4, critDmg: 8, energyRegen: 20 },
      },
      ...oneCosts.map((echo, index) => ({
        ...makeEchoInstance(echo.id, echo.sets[0], `tail-1412-${index}`, 10 + index),
        substats: { critRate: 4, critDmg: 8, energyRegen: 20 },
      })),
    ]

    const display = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes,
      skillId,
      lockedMainEchoId: fourCost.id,
    })

    expect(display).toBeTruthy()
    if (!display) {
      return
    }

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)
    const prepared = prepSkill({
      runtime: candidateRuntime,
      seed,
      enemy,
      skillId,
      runtimesById: makeRuntimeMap(candidateRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      candidateRuntime.base.level,
      candidateRuntime.state.combat,
    )

    expect(Math.abs(display.damage - expected.avg)).toBeLessThan(0.001)
  })

  it('does not double count 6000106 aero bonus for aero rover targets', () => {
    const seed = getResSeedBy('1406')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    const enemy = makeEnemy()

    const skillId = selectVisibleSkillId(runtime, (skill) => skill.element === 'aero' && skill.tab !== 'echo')
    expect(skillId).toBeTruthy()
    if (!skillId) {
      return
    }

    const tailEchoes = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance('6000106', 6, 'main-6000106', 22),
      ...tailEchoes.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-6000106-${index}`, 10 + index)),
    ]

    const display = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes,
      skillId,
      lockedMainEchoId: '6000106',
    })

    expect(display).toBeTruthy()
    if (!display) {
      return
    }

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)
    const prepared = prepSkill({
      runtime: candidateRuntime,
      seed,
      enemy,
      skillId,
      runtimesById: makeRuntimeMap(candidateRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      candidateRuntime.base.level,
      candidateRuntime.state.combat,
    )

    expect(display.damage).toBeCloseTo(expected.avg, 4)
  })

  it('lists formula and negative-effect optimizer targets while excluding echo attacks', () => {
    const tuneSeed = getResSeedBy('1403')
    const negativeEffectSeed = getResSeedBy('1506')
    expect(tuneSeed).toBeTruthy()
    expect(negativeEffectSeed).toBeTruthy()
    if (!tuneSeed || !negativeEffectSeed) {
      return
    }

    const tuneTargets = listOptTrgt(makeResRuntime(tuneSeed))
    const negativeEffectTargets = listOptTrgt(makeResRuntime(negativeEffectSeed))

    expect(tuneTargets.some((skill) => skill.archetype === 'tuneRupture')).toBe(true)
    expect(tuneTargets.some((skill) => skill.tab === 'echoAttacks')).toBe(false)
    expect(negativeEffectTargets.some((skill) => skill.tab === 'negativeEffect')).toBe(true)
    expect(negativeEffectTargets.some((skill) => skill.tab === 'echoAttacks')).toBe(false)
  })

  it('matches computeSkillDamage for tune rupture targets', () => {
    const seed = getResSeedBy('1403')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    const enemy = makeEnemy()

    const skillId = selectVisibleSkillId(runtime, (skill) => skill.archetype === 'tuneRupture')
    expect(skillId).toBeTruthy()
    if (!skillId) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-1403-tune', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-1403-tune-${index}`, 10 + index)),
    ]

    const display = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes,
      skillId,
      lockedMainEchoId: fourCost.id,
    })

    expect(display).toBeTruthy()
    if (!display) {
      return
    }

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)
    const prepared = prepSkill({
      runtime: candidateRuntime,
      seed,
      enemy,
      skillId,
      runtimesById: makeRuntimeMap(candidateRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      candidateRuntime.base.level,
      candidateRuntime.state.combat,
    )

    expect(Math.abs(display.damage - expected.avg)).toBeLessThan(0.01)
  })

  it('matches computeSkillDamage for negative effect targets', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.state.combat.spectroFrazzle = 5
    const enemy = makeEnemy()

    const skillId = selectVisibleSkillId(runtime, (skill) => skill.archetype === 'spectroFrazzle')
    expect(skillId).toBeTruthy()
    if (!skillId) {
      return
    }

    const fourCost = listChsByCos(4)[0]
    const oneCosts = listChsByCos(1).slice(0, 4)
    const echoes = [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-1403-neg', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-1403-neg-${index}`, 10 + index)),
    ]

    const display = evaluateCompiledDisplay({
      resonatorId: seed.id,
      runtime,
      enemy,
      echoes,
      skillId,
      lockedMainEchoId: fourCost.id,
    })

    expect(display).toBeTruthy()
    if (!display) {
      return
    }

    const candidateRuntime = buildCandidateRuntime(runtime, echoes)
    const prepared = prepSkill({
      runtime: candidateRuntime,
      seed,
      enemy,
      skillId,
      runtimesById: makeRuntimeMap(candidateRuntime),
    })

    expect(prepared).toBeTruthy()
    if (!prepared) {
      return
    }

    const expected = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      enemy,
      candidateRuntime.base.level,
      candidateRuntime.state.combat,
    )

    expect(Math.abs(display.damage - expected.avg)).toBeLessThan(0.001)
  })
})
