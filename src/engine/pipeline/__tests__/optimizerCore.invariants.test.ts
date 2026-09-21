/*
  Author: Runor Ewhro
  Description: protects optimizer internals that span cpu search, gpu packing,
               set-state encoding, stat constraints, and generated echo data.
*/

import { describe, expect, it } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeOptSets, makeResRuntime } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import {
  OPT_RDC_K,
  SET_SLOT_COUNT,
} from '@/engine/optimizer/config/constants'
import { ECHO_SET_DEFS, getEchoSetCn } from '@/data/gameData/echoSets/effects'
import { runOptSrch } from '@/engine/optimizer/engine'
import { psssCstrs as passesCpuConstraints, encStatCstrs } from '@/engine/optimizer/constraints/statConstraints'
import {
  applySetVec,
  buildSetRows,
  listDynamicSetStateParts,
  SETCNSTLUTSE,
} from '@/engine/optimizer/encode/sets'
import { countOptCombos, countOptRows } from '@/engine/optimizer/search/counting'
import { mkTgtGpuSttc } from '@/engine/optimizer/workers/targetGpu'
import { runResSmlt } from '@/engine/pipeline'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import targetShader from '@/engine/optimizer/shaders/target.wgsl?raw'
import rotationShader from '@/engine/optimizer/shaders/rotation.wgsl?raw'
import weaponSearchShader from '@/engine/optimizer/shaders/weaponSearch.wgsl?raw'

function makeEchoInstance(
  id: string,
  set: number,
  uid: string,
  primaryValue: number,
): EchoInstance {
  // optimizer tests only need enough echo shape to exercise cost, set, primary
  // stat, and uid behavior without depending on user inventory state
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

function makeInventoryEchoes() {
  // use real catalog choices so slot counts and locked-main behavior track
  // generated data rather than a synthetic echo definition
  const fourCost = listChsByCos(4)[0]
  const oneCosts = listChsByCos(1).slice(0, 4)

  expect(fourCost).toBeTruthy()
  expect(oneCosts).toHaveLength(4)
  if (!fourCost || oneCosts.length < 4) {
    throw new Error('missing generic optimizer echo fixtures')
  }

  return {
    fourCost,
    echoes: [
      makeEchoInstance(fourCost.id, fourCost.sets[0], 'main-lock', 22),
      ...oneCosts.map((echo, index) => makeEchoInstance(echo.id, echo.sets[0], `tail-${index}`, 10 + index)),
    ],
  }
}

function pickTargetableSeed() {
  // target-mode scoring needs a real generated skill that produces damage; this
  // scan keeps the test resilient if the default resonator changes
  for (const seed of listResSds()) {
    const runtime = makeResRuntime(seed)
    const result = runResSmlt(runtime, seed, makeEnemy(), makeRuntimeMap(runtime))
    const skill = result.perSkill.find((entry) => entry.avg > 0)?.skill
    if (skill) {
      return { seed, skillId: skill.id }
    }
  }

  return null
}

function echoSetStateMax(state: (typeof ECHO_SET_DEFS)[number]['states'][string]): boolean | number {
  // echo set controls may be booleans or stack counts, so derive the runtime
  // value that should activate the authored maximum state
  const perStep = state.perStep ?? state.perStack ?? state.max
  const isToggle = perStep.every((step, index) => step.value === state.max[index].value)
  if (isToggle) {
    return true
  }

  return Math.round(
    Math.max(...perStep.map((step, index) => state.max[index].value / step.value)),
  )
}

describe('optimizer core invariants', () => {
  it('keeps every authored Sonata set addressable by CPU and GPU set buffers', () => {
    const maxSetId = Math.max(...ECHO_SET_DEFS.map((definition) => definition.id))

    expect(SETCNSTLUTSE).toBe(SET_SLOT_COUNT)
    expect(maxSetId).toBeLessThan(SET_SLOT_COUNT)
    for (const shader of [targetShader, rotationShader, weaponSearchShader]) {
      expect(shader).toContain(`const SET_SLOTS : u32 = ${SET_SLOT_COUNT}u;`)
    }
  })

  it('packs the new Sonata effects into optimizer rows', () => {
    const seed = listResSds()[0]
    expect(seed).toBeTruthy()
    if (!seed) return

    const rows = buildSetRows(makeResRuntime(seed))
    const bonuses = [36, 37, 38].map((setId) => {
      const setCounts = new Uint8Array(SET_SLOT_COUNT)
      setCounts[setId] = 5
      return applySetVec(setCounts, 0xffffffff, rows, 0xffffffff)
    })

    expect(bonuses[0]).toMatchObject({ critRate: 15, electro: 32.5 })
    expect(bonuses[1]).toMatchObject({ electro: 20 })
    expect(bonuses[2]).toMatchObject({ atkP: 25 })
  })

  it('keeps the GPU reduce fan-out in sync with the target shaders', () => {
    expect(OPT_RDC_K).toBe(8)
  })

  it('hashes GPU static payloads using full typed-array bytes', () => {
    // hash keys must include byte length and trailing bytes or gpu workers can
    // reuse stale static buffers for different candidate universes
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
    const { fourCost, echoes } = makeInventoryEchoes()

    expect(countOptRows(echoes, null)).toBe(5)
    expect(countOptRows(echoes, fourCost.id)).toBe(1)
    expect(countOptRows(echoes, 'missing-echo')).toBe(0)
    expect(countOptCombos(echoes, null, 'combos')).toBe(1)
    expect(countOptCombos(echoes, null, 'combinadic')).toBe(5)
  })

  it('returns scored optimizer results with the locked echo in slot 0', async () => {
    const fixture = pickTargetableSeed()
    expect(fixture).toBeTruthy()
    if (!fixture) {
      return
    }

    const { fourCost, echoes } = makeInventoryEchoes()
    const runtime = makeResRuntime(fixture.seed)
    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = fixture.skillId
    settings.lockedMainEchoId = fourCost.id
    settings.resultsLimit = 8

    const results = await runOptSrch({
      scenarioId: combatScenarioId('optimizer:test'),
      memberId: teamMemberId(fixture.seed.id),
      resonatorId: fixture.seed.id,
      runtime,
      settings,
      invChs: echoes,
      enemyProfile: makeEnemy(),
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.uids[0]).toBe('main-lock')
    expect(results[0]?.damage).toBeGreaterThan(0)
    expect(results[0]?.stats).not.toBeNull()
  })

  it('filters out combinations that fail stat constraints', async () => {
    const fixture = pickTargetableSeed()
    expect(fixture).toBeTruthy()
    if (!fixture) {
      return
    }

    const { echoes } = makeInventoryEchoes()
    const runtime = makeResRuntime(fixture.seed)
    const settings = makeOptSets()
    settings.enableGpu = false
    settings.targetSkillId = fixture.skillId
    settings.statConstraints = {
      atk: { minTotal: '999999' },
    }

    const results = await runOptSrch({
      scenarioId: combatScenarioId('optimizer:test'),
      memberId: teamMemberId(fixture.seed.id),
      resonatorId: fixture.seed.id,
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

  it('packs runtime-controlled echo set states for display-only set rows', () => {
    // display rows and scoring rows share packed set-state data; this searches
    // generated sets until it finds a runtime-controlled state that changes rows
    const seed = listResSds()[0]
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    for (const def of ECHO_SET_DEFS) {
      for (const [partKey, state] of Object.entries(def.states)) {
        const controlKey = getEchoSetCn(def.id, partKey)
        const maxValue = echoSetStateMax(state)
        const baseRuntime = makeResRuntime(seed)
        const offRuntime = {
          ...baseRuntime,
          state: {
            ...baseRuntime.state,
            controls: {
              ...baseRuntime.state.controls,
              [controlKey]: false,
            },
          },
        }
        const onRuntime = {
          ...baseRuntime,
          state: {
            ...baseRuntime.state,
            controls: {
              ...baseRuntime.state.controls,
              [controlKey]: maxValue,
            },
          },
        }
        const setCounts = new Uint8Array(SETCNSTLUTSE)
        setCounts[def.id] = def.setMax
        const offRows = buildSetRows(offRuntime, undefined, {
          dynamicStateParts: listDynamicSetStateParts(offRuntime),
        })
        const onRows = buildSetRows(onRuntime, undefined, {
          dynamicStateParts: listDynamicSetStateParts(onRuntime),
        })
        const offBonus = applySetVec(setCounts, 0xffffffff, offRows, 0xffffffff)
        const onBonus = applySetVec(setCounts, 0xffffffff, onRows, 0xffffffff)

        if (JSON.stringify(offBonus) !== JSON.stringify(onBonus)) {
          expect(listDynamicSetStateParts(onRuntime)).toContainEqual({ setId: def.id, partKey })
          return
        }
      }
    }

    throw new Error('No runtime-controlled echo set state affected display set rows')
  })
})
