/*
  Author: Runor Ewhro
  Description: Verifies the rotationPayload.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { normalizeImportedRotationEntries } from '@/application/imports/rotationPayload.ts'
import { makeRotationExportPayload } from '@/modules/simulation/surfaces/rotation/program-editor/saved/share.ts'
import { makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'

function savedRotation(): SavedRotation {
  const seed = getResSeedBy('1108')
  if (!seed) throw new Error('Missing test resonator 1108')
  return {
    id: 'saved',
    name: 'Saved rotation',
    duration: 20,
    note: '',
    scenario: makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id),
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('rotation payload boundaries', () => {
  it('omits obsolete summaries from exports even if one survives in memory', () => {
    const entry = savedRotation()
    ;(entry as unknown as { summary: unknown }).summary = {
      total: { normal: 1, avg: 2, crit: 3 },
    }

    expect(makeRotationExportPayload(entry).rotation).not.toHaveProperty('summary')
  })

  it('discards summaries from legacy imports', () => {
    const legacy = {
      ...savedRotation(),
      summary: { total: { normal: 1, avg: 2, crit: 3 } },
    }

    expect(normalizeImportedRotationEntries(legacy)[0]).not.toHaveProperty('summary')
  })
})
