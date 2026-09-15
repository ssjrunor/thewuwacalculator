/*
  Author: Runor Ewhro
  Description: protects generated resonator-source invariants that are easy to
               regress during authored override updates.
*/

import { describe, expect, it } from 'vitest'
import type { EffectScope, FormExpr, SrcPkg } from '@/domain/gameData/contracts'
import { evalForm } from '@/engine/effects/evaluator'
import resonatorSourcesRaw from '../../../../public/data/beta/resonators/sources.json?raw'

const TUNE_STRAIN_RESPONSE_EFFECTS = [
  ['1209', '1209:decoupling', 1],
  ['1211', '1211:shattered-hours', 1],
  ['1413', '1413:draw-and-sunder', 1],
  ['1413', '1413:s6:tune-strain-extra', 0.4],
  ['1509', '1509:spectral-analysis', 1],
  ['1510', '1510:silent-debate', 1],
] as const

function makeTuneStrainScope(tbb: number, tuneStrain: number): EffectScope {
  const runtime = {
    state: {
      combat: {},
    },
  } as EffectScope['sourceRuntime']
  const finalStats = { tbb } as NonNullable<EffectScope['finalStats']>

  return {
    sourceRuntime: runtime,
    sourceFinalStats: finalStats,
    targetRuntime: runtime,
    finalStats,
    context: {
      source: { type: 'resonator', id: '1209' },
      sourceRuntime: runtime,
      targetRuntime: runtime,
      targetRuntimeId: '1209',
      activeResonatorId: '1209',
      teamMemberIds: ['1209'],
      sourceFinalStats: finalStats,
      finalStats,
      enemy: {
        status: { tuneStrain },
      },
    } as EffectScope['context'],
  }
}

function makeScope(havocBane: number): EffectScope {
  const runtime = {
    state: {
      combat: {
        havocBane,
      },
    },
  } as EffectScope['sourceRuntime']

  return {
    sourceRuntime: runtime,
    targetRuntime: runtime,
    context: {
      echoSetCounts: {},
      team: {},
      source: { type: 'resonator', id: '1610' },
      sourceRuntime: runtime,
      targetRuntime: runtime,
      targetRuntimeId: '1610',
      activeResonatorId: '1610',
      teamMemberIds: ['1610'],
    } as EffectScope['context'],
  }
}

function makeSanhuaScope(stacks: number): EffectScope {
  const runtime = {
    base: { sequence: 6 },
    state: {
      controls: {
        'sequence:1102:s6:stacks': stacks,
      },
      combat: {},
    },
  } as unknown as EffectScope['sourceRuntime']

  return {
    sourceRuntime: runtime,
    targetRuntime: runtime,
  } as EffectScope
}

describe('resonator source invariants', () => {
  it('converts Sanhua Daybreak Radiance stacks to 10% team ATK each', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const sanhua = sources.find((source) => source.source.id === '1102')
    const effect = sanhua?.effects?.find(
      (candidate) => candidate.id === '1102:s6:daybreak-radiance',
    )
    const operation = effect?.operations[0]

    expect(effect).toMatchObject({
      targetScope: 'teamWide',
      operations: [{ type: 'add_base_stat', stat: 'atk', field: 'percent' }],
    })
    if (!operation || !('value' in operation)) {
      throw new Error('Sanhua Daybreak Radiance is missing its ATK formula')
    }

    expect(evalForm(operation.value, makeSanhuaScope(0))).toBe(0)
    expect(evalForm(operation.value, makeSanhuaScope(1))).toBe(10)
    expect(evalForm(operation.value, makeSanhuaScope(2))).toBe(20)
  })

  it('routes Tune Strain responder damage increases through finalDmg', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]

    for (const [resonatorId, effectId, responseScale] of TUNE_STRAIN_RESPONSE_EFFECTS) {
      const resonator = sources.find((source) => source.source.id === resonatorId)
      const effect = resonator?.effects?.find((candidate) => candidate.id === effectId)
      const operation = effect?.operations[0]

      expect(effect, `${resonatorId} is missing ${effectId}`).toBeDefined()
      expect(effect?.operations).toHaveLength(1)
      expect(operation).toMatchObject({
        type: 'add_top_stat',
        stat: 'finalDmg',
      })
      if (!operation || !('value' in operation)) {
        throw new Error(`${effectId} is missing its value formula`)
      }

      expect(evalForm(operation.value, makeTuneStrainScope(100, 2))).toBeCloseTo(24 * responseScale)
    }
  })

  it('caps Xuanling Unbroken Vow at 66 amplify across six Havoc Bane stacks', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const xuanling = sources.find((source) => source.source.id === '1610')
    expect(xuanling).toBeDefined()

    const expectedByStack = [10, 20, 30, 42, 54, 66]
    const effects = xuanling?.effects?.filter((effect) => effect.id.startsWith('1610:unbroken-vow:')) ?? []

    expect(effects).toHaveLength(2)

    for (const [index, expected] of expectedByStack.entries()) {
      const stack = index + 1
      const effect = effects.find((candidate) => (
        stack < 4
          ? candidate.id === '1610:unbroken-vow:low'
          : candidate.id === '1610:unbroken-vow:high'
      ))
      const operation = effect?.operations[0]
      const value = operation && 'value' in operation ? operation.value : undefined

      expect(value).toBeDefined()
      expect(evalForm(value as FormExpr, makeScope(stack))).toBe(expected)
    }
  })
})
