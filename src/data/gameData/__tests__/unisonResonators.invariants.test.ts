/*
  Author: Runor Ewhro
  description: protects shared Unison Boon ownership and team-derived limits.
*/

import { describe, expect, it } from 'vitest'
import type { SrcPkg } from '@/domain/gameData/contracts'
import { resolveUnisonBoon, unisonBoonSource } from '@/domain/gameData/unisonBoon'
import { listOwnersFor, listStatesFor } from '@/data/catalog/gameDataService'
import resonatorSourcesRaw from '../../../../public/data/beta/resonators/sources.json?raw'

const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]

function sourceFor(resonatorId: string): SrcPkg {
  const source = sources.find((candidate) => candidate.source.id === resonatorId)
  if (!source) {
    throw new Error(`Missing generated source for Resonator ${resonatorId}`)
  }
  return source
}

describe('shared Unison Boon contracts', () => {
  it('authors one shared Unison Boon effect and derives its cap and strength from the team', () => {
    const makeMember = (id: string, level = 90, sequence = 0, mode = 'unison') => ({
      resonatorId: id,
      progression: { level, sequence },
      local: { controls: id === '1311' ? { 'resonator:1311:mode:value': mode } : {} },
    }) as Parameters<typeof resolveUnisonBoon>[0][number]
    const suoming = makeMember('1312')
    const hsin = makeMember('1311')

    expect(unisonBoonSource.effects).toHaveLength(1)
    expect(listStatesFor('teamEffect', 'unisonBoon')).toHaveLength(1)
    expect(unisonBoonSource.effects?.[0]?.ownerKey).toBe('teamEffect:unisonBoon')
    expect(sourceFor('1311').effects?.some((effect) => effect.id.includes('unison-boon'))).toBe(false)
    expect(sourceFor('1312').effects?.some((effect) => effect.id.includes('unison-boon'))).toBe(false)
    for (const id of ['1311', '1312']) {
      expect(listStatesFor('resonator', id).some((state) => state.controlKey.includes('unison_boon'))).toBe(false)
      expect(listOwnersFor('resonator', id).some((owner) => owner.id === 'unison_boon')).toBe(false)
    }
    expect(resolveUnisonBoon([suoming], 4)).toEqual({ stacks: 2, max: 2, perStack: 3 })
    expect(resolveUnisonBoon([suoming, hsin], 4)).toEqual({ stacks: 3, max: 3, perStack: 3 })
    expect(resolveUnisonBoon([suoming, makeMember('1311', 90, 6)], 4)).toEqual({ stacks: 4, max: 4, perStack: 3 })
    expect(resolveUnisonBoon([suoming, makeMember('1311', 1, 0)], 4).max).toBe(2)
    expect(resolveUnisonBoon([suoming, makeMember('1311', 90, 6, 'electro_flare')], 4).max).toBe(2)
    expect(resolveUnisonBoon([makeMember('1312', 90, 6), hsin], 4)).toEqual({ stacks: 3, max: 3, perStack: 4.5 })
  })
})
