/*
  Author: Runor Ewhro
  Description: Locks catalog-missing echo repair across persisted calculator
               containers and loadout uniqueness rules.
*/

import { describe, expect, it } from 'vitest'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoDef } from '@/domain/entities/catalog'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService'
import {
  initAppState,
  makeAppState,
  makeResProfile,
  makeTeamMember,
} from '@/domain/state/defaults'
import {
  inferSavedEchoCost,
  repairEchoLoadoutForCatalog,
} from '@/domain/state/echoCatalogRepair'
import { listResSds } from '@/domain/services/resonatorSeedService'
import type { PersistedUnknown } from '@/domain/state/defaults'
import { makeSavedRotation } from '@/domain/entities/inventoryStorage'
import { makeScenarioFromProfiles } from '@/domain/state/defaults'
import { projectScenarioWorkspaceProfiles } from '@/domain/state/scenarioRuntime'

function makeEcho(definition: EchoDef, set: number, uid: string, slot = 0): EchoInstance {
  const primary = Object.entries(ECHO_MAIN_STATS[definition.cost] ?? {})[0]
  const secondary = ECHO_SIDE_STATS[definition.cost]
  if (!primary || !secondary) {
    throw new Error(`missing stat fixture for cost ${definition.cost}`)
  }

  return {
    uid,
    id: definition.id,
    set,
    mainEcho: slot === 0,
    mainStats: {
      primary: { key: primary[0], value: primary[1] },
      secondary: { ...secondary },
    },
    substats: { critRate: 6.3, critDmg: 12.6 },
  }
}

function findSharedSetFixture(): { set: number; definitions: EchoDef[] } {
  const bySet = new Map<number, EchoDef[]>()
  for (const definition of listEchoes()) {
    for (const set of definition.sets) {
      const definitions = bySet.get(set) ?? []
      definitions.push(definition)
      bySet.set(set, definitions)
    }
  }

  for (const [set, definitions] of bySet) {
    const byCost = new Map<number, EchoDef[]>()
    for (const definition of definitions) {
      const matches = byCost.get(definition.cost) ?? []
      matches.push(definition)
      byCost.set(definition.cost, matches)
    }
    const sameCost = [...byCost.values()].find((matches) => matches.length >= 2)
    if (sameCost) return { set, definitions: sameCost }
  }

  throw new Error('catalog has no same-set, same-cost echo fixture')
}

function expectValidUniqueLoadout(echoes: Array<EchoInstance | null>, expectedSet: number): void {
  const present = echoes.filter((echo): echo is EchoInstance => echo != null)
  const keys = present.map((echo) => `${echo.id}|${echo.set}`)
  expect(new Set(keys).size).toBe(keys.length)
  for (const echo of present) {
    const definition = getEchoById(echo.id)
    expect(definition).not.toBeNull()
    expect(definition?.sets).toContain(echo.set)
  }
  expect(present[1]?.set).toBe(expectedSet)
}

describe('echo catalog repair', () => {
  it('prefers the saved Sonata even when only a different-cost replacement exists', () => {
    const catalog = listEchoes()
    const targetSet = [...new Set(catalog.flatMap((echo) => echo.sets))].find((set) => {
      const costs = new Set(catalog.filter((echo) => echo.sets.includes(set)).map((echo) => echo.cost))
      return costs.size === 1 && !costs.has(1)
    })
    const source = catalog.find((echo) => echo.cost === 1)
    if (targetSet == null || !source) throw new Error('missing cross-cost repair fixture')

    const stale = { ...makeEcho(source, targetSet, 'cross-cost'), id: 'missing-cross-cost' }
    const repaired = repairEchoLoadoutForCatalog([stale])[0]
    const definition = repaired ? getEchoById(repaired.id) : null

    expect(repaired).not.toBeNull()
    expect(definition?.sets).toContain(targetSet)
    expect(definition?.cost).not.toBe(1)
    expect(inferSavedEchoCost(repaired!)).toBe(definition?.cost)
    expect(repaired?.uid).toBe(stale.uid)
    expect(repaired?.substats).toEqual(stale.substats)
  })

  it('repairs every persisted echo container without creating duplicate id/set pieces', () => {
    const seed = listResSds()[0]
    const teammateSeed = listResSds().find((candidate) => candidate.id !== seed?.id)
    if (!seed || !teammateSeed) throw new Error('missing resonator fixture')
    const { set, definitions } = findSharedSetFixture()
    const existing = makeEcho(definitions[0], set, 'existing', 0)
    const stale = {
      ...makeEcho(definitions[1], set, 'stale', 1),
      id: 'missing-saved-echo',
    }
    const loadout = () => [structuredClone(existing), structuredClone(stale), null, null, null]

    const raw = makeAppState() as unknown as PersistedUnknown
    const profile = makeResProfile(seed)
    profile.runtime.build.echoes = loadout()
    const teammate = makeTeamMember(teammateSeed)
    teammate.build.echoes = loadout()
    profile.runtime.teamRuntimes = [teammate, null]
    raw.combat = undefined
    raw.simulation = { ...raw.simulation, profiles: { [seed.id]: profile } }
    raw.library = {
      echoes: [{
      id: 'saved-echo',
      echo: structuredClone(stale),
      createdAt: 1,
      updatedAt: 1,
      }],
      builds: [{
      id: 'saved-build',
      name: 'Saved build',
      resonatorId: seed.id,
      resonatorName: seed.name,
      build: { weapon: profile.runtime.build.weapon, echoes: loadout() },
      createdAt: 2,
      updatedAt: 2,
      }],
      rotations: [makeSavedRotation({
        name: 'Saved rotation',
        duration: 10,
        scenario: makeScenarioFromProfiles({ [seed.id]: profile }, null, 0, seed.id),
      }, 3)],
      scenarios: [],
    }
    const hydrated = initAppState(raw)
    const hydratedProfile = projectScenarioWorkspaceProfiles(hydrated.combat)[seed.id]
    const savedRotation = hydrated.library.rotations[0]?.scenario
    const repairedLoadouts = [
      hydratedProfile.runtime.build.echoes,
      hydratedProfile.runtime.teamRuntimes[0]!.build.echoes,
      hydrated.library.builds[0]!.build.echoes,
      savedRotation!.team.members[0].loadout.echoes,
      savedRotation!.team.members[1]!.loadout.echoes,
    ]

    for (const repaired of repairedLoadouts) {
      expectValidUniqueLoadout(repaired, set)
      expect(repaired[1]?.id).not.toBe(stale.id)
      expect(getEchoById(repaired[1]!.id)?.cost).toBe(definitions[1].cost)
    }

    const inventoryEcho = hydrated.library.echoes[0]?.echo
    expect(inventoryEcho?.id).not.toBe(stale.id)
    expect(inventoryEcho?.set).toBe(set)
    expect(getEchoById(inventoryEcho!.id)).not.toBeNull()
  })
})
