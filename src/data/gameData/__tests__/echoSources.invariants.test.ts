/*
  Author: Runor Ewhro
  Description: protects authored Echo mechanics that depend on generated
               runtime state rather than only the Echo skill multiplier.
*/

import { describe, expect, it } from 'vitest'
import type { SrcPkg } from '@/domain/gameData/contracts'
import betaEchoSourcesRaw from '../../../../public/data/beta/echoes/sources.json?raw'
import liveEchoSourcesRaw from '../../../../public/data/live/echoes/sources.json?raw'

function getEchoSource(sources: SrcPkg[], echoId: string): SrcPkg {
  const source = sources.find((candidate) => candidate.source.type === 'echo' && candidate.source.id === echoId)
  expect(source, `echo ${echoId} is missing its generated source package`).toBeDefined()
  return source as SrcPkg
}

describe.each([
  ['beta', betaEchoSourcesRaw],
  ['live', liveEchoSourcesRaw],
])('%s echo source invariants', (_mode, rawSources) => {
  it.each([
    ['6000179', '6000180', 'Twin Nova: Nebulous Cannon'],
    ['6000180', '6000179', 'Twin Nova: Collapsar Blade'],
  ])('applies Dyad Origins stacks for %s', (echoId, pairedEchoId, label) => {
    const source = getEchoSource(JSON.parse(rawSources) as SrcPkg[], echoId)
    const controlPath = `runtime.state.controls.echo:${echoId}:main:stacks`
    const skillIds = [`echo:${echoId}:skill:1`, `echo:${echoId}:skill:2`]

    expect(source.states).toContainEqual(expect.objectContaining({
      id: 'stacks',
      path: controlPath,
      kind: 'stack',
      min: 0,
      max: 6,
    }))
    expect(source.effects).toContainEqual(expect.objectContaining({
      id: `echo:${echoId}:effect:skill-stacks`,
      label: `${label} Stacks`,
      trigger: 'skill',
      condition: {
        type: 'and',
        values: [
          {
            type: 'or',
            values: [1, 2, 3, 4].map((slotIndex) => ({
              type: 'eq',
              from: 'sourceRuntime',
              path: `build.echoes.${slotIndex}.id`,
              value: pairedEchoId,
            })),
          },
          {
            type: 'truthy',
            from: 'sourceRuntime',
            path: `state.controls.echo:${echoId}:main:stacks`,
          },
        ],
      },
      operations: [{
        type: 'add_skill_mod',
        mod: 'dmgBonus',
        value: {
          type: 'mul',
          values: [
            { type: 'const', value: 10 },
            {
              type: 'read',
              from: 'sourceRuntime',
              path: `state.controls.echo:${echoId}:main:stacks`,
              default: 0,
            },
          ],
        },
        match: { skillIds },
      }],
    }))
  })
})
