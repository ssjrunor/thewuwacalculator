/*
  Author: Runor Ewhro
  Description: Guards saved detail scheduling against live and unavailable ids.
*/

import { describe, expect, it } from 'vitest'
import { makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { makeLiveRotationEntry } from '@/engine/runtime/liveRotationEntry.ts'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import type { RunResult } from '../simulation/runProgram.ts'
import { pendingSavedRotationDetails } from '../simulation/simulation.ts'

function fixture() {
  const seed = getResSeedBy('1108')!
  const scenario = makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id)
  const live = makeLiveRotationEntry(scenario, seed.name, { lastRanAt: 1 })!
  const saved: SavedRotation = { ...live, id: 'saved-rotation' }
  return { live, saved }
}

describe('saved rotation detail scheduling', () => {
  it('does not schedule an empty batch for a live comparison', () => {
    const { live, saved } = fixture()
    const completed = new Map<string, RunResult | null>([[saved.id, null]])

    expect(pendingSavedRotationDetails([saved], [live.id], completed)).toEqual([])
    expect(pendingSavedRotationDetails([saved], [saved.id, live.id], completed)).toEqual([])
  })

  it('loads saved details once when comparing against the live run', () => {
    const { live, saved } = fixture()
    const requested = [live.id, saved.id]
    const completed = new Map<string, RunResult | null>()

    expect(pendingSavedRotationDetails([saved], requested, completed)).toEqual([saved])
    // Even an unavailable simulation is a completed lookup, so it is not retried.
    completed.set(saved.id, null)
    expect(pendingSavedRotationDetails([saved], requested, completed)).toEqual([])
  })

  it('ignores removed entries and resumes when an entry becomes available', () => {
    const { saved } = fixture()
    const completed = new Map<string, RunResult | null>()

    expect(pendingSavedRotationDetails([], [saved.id], completed)).toEqual([])
    expect(pendingSavedRotationDetails([saved], [saved.id], completed)).toEqual([saved])
    expect(pendingSavedRotationDetails([saved], [], completed)).toEqual([])
  })
})
