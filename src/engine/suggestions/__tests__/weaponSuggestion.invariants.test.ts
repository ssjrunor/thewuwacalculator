/*
  Author: Runor Ewhro
  Description: keeps rotation weapon suggestions numerically aligned with the
               canonical simulation after each candidate passive is applied.
*/

import { describe, expect, it } from 'vitest'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import type { ResRuntime } from '@/domain/entities/runtime'
import { makeEnemy, mkDefWpnSug, mkMaxResRt } from '@/domain/state/defaults'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { mkPrepWpnSu, resSuggDmg, runSuggSmlt } from '@/engine/suggestions/shared'
import { runPrepWpn } from '@/engine/suggestions/weapon-suggestion/compute'

describe('weapon suggestion parity', () => {
  it('scores rotation candidates through their fully materialized runtime', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) throw new Error('missing weapon suggestion fixture resonator')

    const runtime = mkMaxResRt(seed)
    const enemy = makeEnemy()
    const settings = {
      ...mkDefWpnSug(),
      mode: 'default' as const,
      visible: {
        '5': true,
        '4': false,
        '3': false,
        '2': false,
        '1': false,
      },
    }
    const input = {
      scenarioId: combatScenarioId('suggestions:weapon-parity'),
      memberId: teamMemberId(runtime.id),
      runtime,
      seed,
      enemy,
      runtimesById: makeRuntimeMap(runtime),
      selectedTargets: {},
      tgtFeatId: null,
      rotationMode: true,
      includeEchoAttacks: true,
      weapon: settings,
      topK: 5,
    }
    const prep = mkPrepWpnSu(input, runSuggSmlt(input))
    expect(prep).toBeTruthy()
    if (!prep) throw new Error('failed to prepare weapon suggestions')

    const results = runPrepWpn(prep)
    expect(results).not.toHaveLength(0)

    for (const result of results) {
      const candidate: ResRuntime = {
        ...prep.runtime,
        build: {
          ...prep.runtime.build,
          weapon: {
            id: result.weaponId,
            level: result.level,
            rank: result.rank,
            baseAtk: result.baseAtk,
          },
        },
        state: {
          ...prep.runtime.state,
          controls: {
            ...prep.runtime.state.controls,
            ...result.controls,
          },
        },
      }
      const candidateInput = { ...input, runtime: candidate }
      const expected = resSuggDmg(runSuggSmlt(candidateInput), candidateInput)

      expect(result.damage).toBeCloseTo(expected, 8)
    }
  })
})
