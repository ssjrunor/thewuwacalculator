/*
  Author: Runor Ewhro
  Description: Verifies the rotationClipboard.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import {
  makeSavedRotClip,
  parseRotClip,
  readRotClip,
  serializeRotClip,
  writeRotClip,
} from '@/modules/simulation/features/rotation/shared/rotationClipboard.ts'
import { makeResProfile, makeScenarioFromProfiles } from '@/domain/state/defaults.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'

function saved(id: string, name: string): SavedRotation {
  const seed = getResSeedBy('1108')
  if (!seed) throw new Error('Missing test resonator 1108')
  return {
    id,
    name,
    duration: 20,
    note: `${name} note`,
    scenario: makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id),
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('saved rotation clipboard', () => {
  it('round-trips every selected saved entry in selection order', () => {
    const entries = [saved('a', 'First'), saved('b', 'Second')]
    const payload = makeSavedRotClip(entries)

    expect(payload).not.toBeNull()
    const parsed = parseRotClip(serializeRotClip(payload!))
    expect(parsed?.source).toBe('saved')
    expect(parsed?.savedEntries?.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(parsed?.savedEntries?.map((entry) => entry.name)).toEqual(['First', 'Second'])
  })

  it('keeps an isolated fallback copy for cross-surface paste', async () => {
    const entry = saved('a', 'Original')
    const payload = makeSavedRotClip([entry])
    expect(payload).not.toBeNull()

    await writeRotClip(payload!)
    entry.name = 'Changed after copy'
    const pasted = await readRotClip()

    expect(pasted?.savedEntries?.[0]?.name).toBe('Original')
  })

  it('strips obsolete calculated summaries from clipboard payloads', () => {
    const entry = saved('a', 'Legacy')
    ;(entry as unknown as { summary: unknown }).summary = {
      total: { normal: 1, avg: 2, crit: 3 },
    }

    const payload = makeSavedRotClip([entry])

    expect(payload?.savedEntries?.[0]).not.toHaveProperty('summary')
    expect(parseRotClip(serializeRotClip(payload!))?.savedEntries?.[0])
      .not.toHaveProperty('summary')
  })
})
