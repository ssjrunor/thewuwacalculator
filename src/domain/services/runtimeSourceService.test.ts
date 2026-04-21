import { describe, expect, it } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { createDefaultResonatorRuntime } from '@/domain/state/defaults'
import {
  buildPreparedRuntimeCatalog,
  getMainEchoSourceRef,
  listRuntimeSourceRefs,
} from '@/domain/services/runtimeSourceService'

function makeEcho(id: string, uid: string, mainEcho = false): EchoInstance {
  return {
    uid,
    id,
    set: 1,
    mainEcho,
    mainStats: {
      primary: { key: 'atkPercent', value: 30 },
      secondary: { key: 'atkFlat', value: 20 },
    },
    substats: {},
  }
}

describe('runtimeSourceService', () => {
  it('uses the echo marked as main echo when resolving runtime source refs', () => {
    const seed = getResonatorSeedById('1102')
    if (!seed) {
      throw new Error('missing Sanhua seed')
    }

    const runtime = createDefaultResonatorRuntime(seed)
    runtime.build.echoes = [
      makeEcho('6000100', 'slot-0'),
      makeEcho('6000052', 'slot-1', true),
      null,
      null,
      null,
    ]

    expect(getMainEchoSourceRef(runtime)).toEqual({ type: 'echo', id: '6000052' })
    expect(listRuntimeSourceRefs(runtime)).toContainEqual({ type: 'echo', id: '6000052' })
  })

  it('falls back to the first equipped echo when no slot is marked main and slot 0 is empty', () => {
    const seed = getResonatorSeedById('1102')
    if (!seed) {
      throw new Error('missing Sanhua seed')
    }

    const runtime = createDefaultResonatorRuntime(seed)
    runtime.build.echoes = [
      null,
      makeEcho('6000052', 'slot-1'),
      null,
      null,
      null,
    ]

    expect(getMainEchoSourceRef(runtime)).toEqual({ type: 'echo', id: '6000052' })
    expect(listRuntimeSourceRefs(runtime)).toContainEqual({ type: 'echo', id: '6000052' })
  })

  it('does not collapse distinct seed objects that share the same resonator id', () => {
    const seed = getResonatorSeedById('1102')
    if (!seed) {
      throw new Error('missing Sanhua seed')
    }

    const runtime = createDefaultResonatorRuntime(seed)
    const source = { type: 'resonator' as const, id: seed.id }
    const seedA = {
      ...seed,
      features: [
        ...(seed.features ?? []),
        {
          id: 'runtime-source-test:feature:a',
          label: 'Seed A Feature',
          source,
          kind: 'skill' as const,
          skillId: seed.skills?.[0]?.id ?? 'missing',
        },
      ],
    }
    const seedB = {
      ...seed,
      features: [
        ...(seed.features ?? []),
        {
          id: 'runtime-source-test:feature:b',
          label: 'Seed B Feature',
          source,
          kind: 'skill' as const,
          skillId: seed.skills?.[0]?.id ?? 'missing',
        },
      ],
    }

    const catalogA = buildPreparedRuntimeCatalog(runtime, seedA)
    const catalogB = buildPreparedRuntimeCatalog(runtime, seedB)

    expect(catalogA.featuresById['runtime-source-test:feature:a']?.label).toBe('Seed A Feature')
    expect(catalogA.featuresById['runtime-source-test:feature:b']).toBeUndefined()
    expect(catalogB.featuresById['runtime-source-test:feature:b']?.label).toBe('Seed B Feature')
    expect(catalogB.featuresById['runtime-source-test:feature:a']).toBeUndefined()
  })
})
