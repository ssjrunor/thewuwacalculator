/*
  Author: Runor Ewhro
  Description: Keeps unqualified Amplify in the global top-stat lane instead
               of encoding it as a synthetic all-attribute or all-skill scope.
*/

import { describe, expect, it } from 'vitest'
import type { EffectOp, SrcPkg } from '@/domain/gameData/contracts'
import betaEchoSourcesRaw from '../../../../public/data/beta/echoes/sources.json?raw'
import betaResonatorSourcesRaw from '../../../../public/data/beta/resonators/sources.json?raw'
import betaWeaponSourcesRaw from '../../../../public/data/beta/weapons/sources.json?raw'
import liveEchoSourcesRaw from '../../../../public/data/live/echoes/sources.json?raw'
import liveResonatorSourcesRaw from '../../../../public/data/live/resonators/sources.json?raw'
import liveWeaponSourcesRaw from '../../../../public/data/live/weapons/sources.json?raw'

const SOURCE_SETS = [
  ['beta echoes', betaEchoSourcesRaw],
  ['beta resonators', betaResonatorSourcesRaw],
  ['beta weapons', betaWeaponSourcesRaw],
  ['live echoes', liveEchoSourcesRaw],
  ['live resonators', liveResonatorSourcesRaw],
  ['live weapons', liveWeaponSourcesRaw],
] as const

function isSyntheticUniversalAmplify(operation: EffectOp): boolean {
  if (operation.type === 'add_attribute_mod') {
    return operation.attribute === 'all' && operation.mod === 'amplify'
  }
  if (operation.type === 'add_skilltype_mod') {
    return operation.skillType === 'all' && operation.mod === 'amplify'
  }
  return false
}

describe('generated Amplify scope invariants', () => {
  it.each(SOURCE_SETS)('%s keeps unqualified Amplify in the top-stat lane', (_label, rawSources) => {
    const sources = JSON.parse(rawSources) as SrcPkg[]
    const invalidEffects = sources.flatMap((source) =>
      (source.effects ?? [])
        .filter((effect) => effect.operations.some(isSyntheticUniversalAmplify))
        .map((effect) => `${source.source.type}:${source.source.id}:${effect.id}`),
    )

    expect(invalidEffects).toEqual([])
  })
})
