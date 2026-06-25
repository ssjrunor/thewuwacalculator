import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/domain/state/defaults'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { applyPersRot } from '@/engine/optimizer/rotation/runtime'
import { runResSmlt } from '@/engine/pipeline'
import { mkRotSuggCtx } from '@/engine/suggestions/shared'
import { getSetRowFfs, SETCNSTLUTST } from '@/engine/optimizer/encode/sets'

const setCol = (name: typeof SETCNSTLUTST[number]) => SETCNSTLUTST.indexOf(name)

describe('rotation suggestions', () => {
  it('ignores loop run counts when building rotation contexts', () => {
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

    const loopedRuntime = applyPersRot(runtime, rotationItems)
    const loopedSimulation = runResSmlt(
      loopedRuntime,
      seed,
      enemy,
      makeRuntimeMap(loopedRuntime),
    )
    expect(loopedSimulation.rotations.personal.entries.filter((entry) => entry.nodeId === 'loop-feature')).toHaveLength(3)

    const context = mkRotSuggCtx({
      runtime: loopedRuntime,
      seed,
      enemy,
      runtimesById: {},
      selectedTargets: {},
      tgtFeatId: null,
      rotationMode: true,
      topK: 10,
    }, loopedSimulation)

    expect(context?.contextCount).toBe(1)
    expect(context ? Array.from(context.contextWeight) : []).toEqual([1])
  })

  it('includes set atMax effects in suggestion contexts', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    const enemy = makeEnemy()
    const simulation = runResSmlt(
      runtime,
      seed,
      enemy,
      makeRuntimeMap(runtime),
    )
    const context = mkRotSuggCtx({
      runtime,
      seed,
      enemy,
      runtimesById: {},
      selectedTargets: {},
      tgtFeatId: null,
      rotationMode: true,
      topK: 10,
    }, simulation)
    expect(context).toBeTruthy()
    if (!context) {
      return
    }

    const row = getSetRowFfs(35, 4)
    expect(context.setConstLut[row + setCol('critRate')]).toBe(20)
    expect(context.setConstLut[row + setCol('fusion')]).toBe(15)
  })
})
