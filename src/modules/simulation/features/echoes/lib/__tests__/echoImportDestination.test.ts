/*
  Author: Runor Ewhro
  Description: Locks the import boundary between standalone context profiles
               and same-resonator teammate instances.
*/

import { describe, expect, it } from 'vitest'
import { makeResProfile, makeResRuntime } from '@/engine/runtime/defaults.ts'
import { listResSds } from '@/data/catalog/resonatorSeedService.ts'
import {
  mergeEchoImportIntoProfile,
  resolveEchoImportRuntime,
} from '@/modules/simulation/features/echoes/lib/echoImportDestination.ts'

describe('Echo import destinations', () => {
  const seed = listResSds()[0]
  const contextRuntime = makeResRuntime(seed)
  const teamRuntime = {
    ...makeResRuntime(seed),
    base: { ...makeResRuntime(seed).base, level: 77 },
  }

  it('keeps a context and teammate with the same resonator id distinct', () => {
    const contexts = { [seed.id]: contextRuntime }
    const team = { [seed.id]: teamRuntime }

    expect(resolveEchoImportRuntime(
      { kind: 'context', resonatorId: seed.id },
      contexts,
      team,
    )).toBe(contextRuntime)
    expect(resolveEchoImportRuntime(
      { kind: 'team', resonatorId: seed.id, slotIndex: 1 },
      contexts,
      team,
    )).toBe(teamRuntime)
  })

  it('writes imported build fields into a context profile without replacing its team', () => {
    const profile = makeResProfile(seed)
    const importedRuntime = {
      ...contextRuntime,
      base: { ...contextRuntime.base, level: 83, sequence: 4 },
      build: {
        ...contextRuntime.build,
        weapon: { ...contextRuntime.build.weapon, level: 70 },
      },
    }
    const next = mergeEchoImportIntoProfile(profile, importedRuntime)

    expect(next.runtime.progression.level).toBe(83)
    expect(next.runtime.progression.sequence).toBe(4)
    expect(next.runtime.build.weapon.level).toBe(70)
    expect(next.runtime.local.controls).toEqual(importedRuntime.state.controls)
    expect(next.runtime.team).toEqual(profile.runtime.team)
    expect(next.runtime.teamRuntimes).toEqual(profile.runtime.teamRuntimes)
  })
})
