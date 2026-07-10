/*
  Author: Runor Ewhro
  Description: protects generated resonator-source invariants that are easy to
               regress during authored override updates.
*/

import { describe, expect, it } from 'vitest'
import type { EffectScope, FormExpr, SrcPkg } from '@/domain/gameData/contracts'
import { evalForm } from '@/engine/effects/evaluator'

const sourceLoaders = import.meta.glob('../../../../public/data/resonator-sources.json', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

const loadResonatorSources = sourceLoaders['../../../../public/data/resonator-sources.json']

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

describe('resonator source invariants', () => {
  it('caps Xuanling Unbroken Vow at 66 amplify across six Havoc Bane stacks', async () => {
    const sources = JSON.parse(await loadResonatorSources()) as SrcPkg[]
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
