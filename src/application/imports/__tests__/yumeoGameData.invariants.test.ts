/*
  Author: Runor Ewhro
  description: verifies Yumeo JSON parsing, equipment conflict resolution,
               and preservation of imported scenario and Echo identities.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/application/state/store'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { ROVER_PAIRS } from '@/domain/entities/roverGender'
import { selectedCombatScenario, scenarioIdForContextResonator } from '@/domain/entities/scenarioLibrary'
import { makeAppState, makeResProfile, makeScenarioFromProfiles, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { addSelectedOptionalYumeoGameDataEchoes, applyConvertedYumeoGameData, applyPreparedYumeoGameData, convertYumeoGameData, parseYumeoGameData, prepareYumeoGameData, resolveYumeoGameDataEquipmentConflicts } from '../yumeoGameData'

function sample() {
  return {
    version: 1 as const,
    resonators: [{
      resonatorId: 1402, level: 80, chain: 6,
      skills: [
        { nodeId: 1000101, level: 6 },
        { nodeId: 1000102, level: 6 },
        { nodeId: 1000103, level: 6 },
        { nodeId: 1000106, level: 6 },
        { nodeId: 1000107, level: 6 },
        { nodeId: 1000109, level: 1 },
      ],
    }],
    weapons: [{ itemId: 21020024, level: 90, rank: 5, equippedByResonatorId: 1402 }],
    echoes: [1860, 1861].map((instanceId) => ({
      instanceId, monsterId: 6000053, echoSetId: 6, level: 25,
      mainStats: [{ statId: 5001, value: 22 }, { statId: 50003, value: 150 }],
      subStats: [{ statId: 11, value: 6.3 }],
      ...(instanceId === 1860 ? { equippedByResonatorId: 1402, slotIndex: 0 } : {}),
    })),
  }
}

describe('game-data conversion', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    useAppStore.setState({ ...makeAppState(), invHydr: true })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it.each(ROVER_PAIRS.flatMap(pair => [
    { sourceId: pair.female, targetId: pair.male, gender: 'male' as const },
    { sourceId: pair.male, targetId: pair.female, gender: 'female' as const },
  ]))('imports $sourceId into $targetId without replacing scenario state', async ({ sourceId, targetId, gender }) => {
    useAppStore.getState().setRoverGender(gender)
    const profile = makeResProfile(getResSeedBy(targetId)!)
    const scenario = makeScenarioFromProfiles({ [targetId]: profile }, null, 0, targetId)
    scenario.team.members[0].local.controls.importSentinel = true
    scenario.program.program = [{ id: 'existing-note', type: 'note', text: 'Keep the authored rotation' }]
    const contextId = useAppStore.getState().applyScenarioSnapshot(scenario)
    const other = selectedCombatScenario(makeAppState().combat)
    const otherId = useAppStore.getState().applyScenarioSnapshot(other)
    useAppStore.getState().insertScenarioMember(otherId, 1, makeScenarioMemberFromProfile(profile))

    const capture = sample()
    capture.resonators = [{ resonatorId: Number(sourceId), level: 80, chain: 6, skills: [] }]
    capture.weapons = [{ itemId: 21020046, level: 90, rank: 5, equippedByResonatorId: Number(sourceId) }]
    capture.echoes[0] = { ...capture.echoes[0], equippedByResonatorId: Number(sourceId), slotIndex: 2 }
    const prepared = await prepareYumeoGameData(JSON.stringify(capture))
    expect(prepared.review.resonators[0].id).toBe(sourceId)
    applyPreparedYumeoGameData(prepared)

    const state = useAppStore.getState()
    expect(scenarioIdForContextResonator(state.combat, targetId)).toBe(contextId)
    expect(scenarioIdForContextResonator(state.combat, sourceId)).toBeNull()
    const updated = state.combat.scenariosById[contextId]
    expect(updated.team.members[0].local.controls.importSentinel).toBe(true)
    expect(updated.program.program).toEqual(scenario.program.program)
    for (const member of [updated.team.members[0], state.combat.scenariosById[otherId].team.members[1]!]) {
      expect(member.resonatorId).toBe(targetId)
      expect(member.progression).toMatchObject({ level: 80, sequence: 6 })
      expect(member.loadout.weapon.id).toBe('21020046')
      expect(member.loadout.echoes.map(echo => echo?.uid ?? null)).toEqual([null, null, 'game:1860', null, null])
    }
  })

it('updates a dormant Rover loadout while leaving the teammate inactive', async () => {
    useAppStore.getState().setRoverGender('male')
    const scenario = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
    const member = makeScenarioMemberFromProfile(makeResProfile(getResSeedBy('1406')!))
    member.local.controls.keep = true
    scenario.dormantMembersByResonatorId = { '1406': { member } }
    const scenarioId = useAppStore.getState().applyScenarioSnapshot(scenario)
    const capture = sample()
    capture.resonators = [{ resonatorId: 1408, level: 80, chain: 6, skills: [] }]
    capture.weapons = [{ itemId: 21020046, level: 90, rank: 5, equippedByResonatorId: 1408 }]
    capture.echoes[0] = { ...capture.echoes[0], equippedByResonatorId: 1408, slotIndex: 0 }
    applyPreparedYumeoGameData(await prepareYumeoGameData(JSON.stringify(capture)))
    const stored = useAppStore.getState().combat.scenariosById[scenarioId]
    expect(stored.team.members.some(value => value.resonatorId === '1406')).toBe(false)
    expect(stored.dormantMembersByResonatorId?.['1406'].member).toMatchObject({
      progression: { level: 80, sequence: 6 },
      loadout: { weapon: { id: '21020046' } },
      local: { controls: { keep: true } },
    })
    expect(stored.dormantMembersByResonatorId?.['1406'].member.loadout.echoes[0]?.uid).toBe('game:1860')
  })

  it('keeps Both genders and different elements independent during import', async () => {
    for (const id of ['1406', '1408', '1502']) {
      const profile = makeResProfile(getResSeedBy(id)!)
      profile.runtime.progression.level = 20
      useAppStore.getState().upsertRes([profile])
    }
    const capture = sample()
    capture.resonators = [{ resonatorId: 1408, level: 80, chain: 6, skills: [] }]
    capture.weapons = [{ itemId: 21020046, level: 90, rank: 5, equippedByResonatorId: 1408 }]
    capture.echoes[0] = { ...capture.echoes[0], equippedByResonatorId: 1408, slotIndex: 0 }
    applyPreparedYumeoGameData(await prepareYumeoGameData(JSON.stringify(capture)))
    const { combat } = useAppStore.getState()
    for (const id of ['1406', '1408', '1502']) {
      const scenarioId = scenarioIdForContextResonator(combat, id)!
      expect(combat.scenariosById[scenarioId].team.members[0].progression.level).toBe(id === '1408' ? 80 : 20)
    }
  })

  it('uses inventory signatures for duplicates and reuses saved Echo identity when equipping', () => {
    const converted = convertYumeoGameData(parseYumeoGameData(JSON.stringify(sample())))
    expect(converted.resonators[0].skillLevels).toEqual({
      normalAttack: 6, resonanceSkill: 6, resonanceLiberation: 6,
      introSkill: 6, forteCircuit: 6,
    })
    expect(converted.resonators[0].weapon?.baseAtk).toBeGreaterThan(0)
    expect(converted.inventoryEchoes.map((echo) => echo.uid)).toEqual(['game:1860', 'game:1861'])

    expect(applyConvertedYumeoGameData(converted)).toMatchObject({
      echoesAdded: 1, echoesSkippedDuplicates: 1,
    })
    const state = useAppStore.getState()
    const scenarioId = scenarioIdForContextResonator(state.combat, '1402')!
    const member = state.combat.scenariosById[scenarioId].team.members[0]
    expect(member.progression.level).toBe(80)
    expect(member.progression.sequence).toBe(6)
    expect(member.loadout.weapon.id).toBe('21020024')
    expect(member.loadout.echoes[0]?.uid).toBe('game:1860')
    expect(state.library.echoes).toHaveLength(1)
    expect(member.loadout.echoes[0]?.uid).toBe(state.library.echoes[0].echo.uid)

    expect(applyConvertedYumeoGameData(convertYumeoGameData(sample()))).toMatchObject({
      echoesAdded: 0, echoesSkippedDuplicates: 2,
    })

    const changed = sample()
    changed.echoes[0].subStats[0].value = 7
    const again = applyConvertedYumeoGameData(convertYumeoGameData(changed))
    expect(again).toMatchObject({ echoesAdded: 1, echoesSkippedDuplicates: 1 })
    expect(useAppStore.getState().library.echoes).toHaveLength(2)
    const updated = useAppStore.getState()
    const equipped = updated.combat.scenariosById[scenarioId].team.members[0].loadout.echoes[0]
    expect(equipped?.substats.critRate).toBe(6.9)
    expect(updated.library.echoes.some((entry) => entry.echo.uid === equipped?.uid)).toBe(true)
    expect(updated.library.echoes.some((entry) => entry.echo.substats.critRate === 6.3)).toBe(true)
    expect(selectedCombatScenario(useAppStore.getState().combat).team.members[0].resonatorId).toBe('1506')
  })

  it('uses only the resonator\'s exact skill node IDs and preserves unmatched levels', () => {
    expect(getResDtlsBy()['1402'].skillsByTab.normalAttack).not.toHaveProperty('nodeId')
    const capture = sample()
    capture.resonators[0].skills.push(
      { nodeId: 9999901, level: 10 }, // Same suffix as Normal Attack, different node.
      { nodeId: 1000109, level: 10 }, // A valid node with no app skill level.
    )
    const converted = convertYumeoGameData(capture)
    expect(converted.resonators[0].skillLevels).toEqual({
      normalAttack: 6, resonanceSkill: 6, resonanceLiberation: 6,
      introSkill: 6, forteCircuit: 6,
    })

    capture.resonators[0].skills = [{ nodeId: 9999901, level: 10 }]
    expect(convertYumeoGameData(capture).resonators[0].skillLevels).toEqual({})

    applyConvertedYumeoGameData(convertYumeoGameData(capture))
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1402')!
    const normalAttackLevel = () => useAppStore.getState().combat.scenariosById[scenarioId]
      .team.members[0].progression.skillLevels.normalAttack
    expect(normalAttackLevel()).toBe(1)

    applyConvertedYumeoGameData(converted)
    expect(normalAttackLevel()).toBe(6)
    applyConvertedYumeoGameData(convertYumeoGameData(capture))
    expect(normalAttackLevel()).toBe(6)
  })

  it('equips the already saved Echo when its stats match a captured Echo', () => {
    const converted = convertYumeoGameData(sample())
    const existing = { ...converted.inventoryEchoes[0], uid: 'saved-by-user' }
    expect(useAppStore.getState().addInvEcho(existing)).not.toBeNull()

    expect(applyConvertedYumeoGameData(converted)).toMatchObject({
      echoesAdded: 0, echoesSkippedDuplicates: 2,
    })
    const state = useAppStore.getState()
    const scenarioId = scenarioIdForContextResonator(state.combat, '1402')!
    expect(state.library.echoes).toHaveLength(1)
    expect(state.combat.scenariosById[scenarioId].team.members[0].loadout.echoes[0]?.uid).toBe('saved-by-user')
  })

  it('keeps both captured slots when distinct game Echoes share one saved UID', () => {
    const capture = sample()
    capture.echoes[1] = {
      ...capture.echoes[1], equippedByResonatorId: 1402, slotIndex: 1,
    }
    const converted = convertYumeoGameData(capture)
    expect(converted.conflicts.echoSlots).toHaveLength(0)

    expect(applyConvertedYumeoGameData(converted)).toMatchObject({
      echoesAdded: 1, echoesSkippedDuplicates: 1,
    })
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1402')!
    const equipped = useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].loadout.echoes
    expect(equipped[0]?.uid).toBe('game:1860')
    expect(equipped[1]?.uid).toBe('game:1860')
    expect(useAppStore.getState().library.echoes).toHaveLength(1)

    applyConvertedYumeoGameData(converted)
    const repeated = useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].loadout.echoes
    expect(repeated[0]?.uid).toBe('game:1860')
    expect(repeated[1]?.uid).toBe('game:1860')
  })

  it('builds a new resonator with only the captured Echo slots equipped', () => {
    const capture = sample()
    capture.echoes = [0, 2, 4].map((slotIndex) => ({
      ...sample().echoes[0], instanceId: 1860 + slotIndex, slotIndex,
      subStats: [{ statId: 11, value: 6.3 + slotIndex * 0.6 }],
    }))

    applyConvertedYumeoGameData(convertYumeoGameData(capture))
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1402')!
    const echoes = useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].loadout.echoes
    expect(echoes.map((echo) => echo?.uid ?? null)).toEqual([
      'game:1860', null, 'game:1862', null, 'game:1864',
    ])
  })

  it('rebuilds an existing resonator Echo grid from each successful capture', () => {
    const capture = sample()
    capture.resonators = [{ ...capture.resonators[0], resonatorId: 1506 }]
    capture.weapons = []
    capture.echoes = Array.from({ length: 5 }, (_, slotIndex) => ({
      ...sample().echoes[0], instanceId: 1860 + slotIndex,
      equippedByResonatorId: 1506, slotIndex,
      subStats: [{ statId: 11, value: 6.3 + slotIndex * 0.6 }],
    }))
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1506')!

    applyConvertedYumeoGameData(convertYumeoGameData(capture))
    const equippedUids = () => useAppStore.getState().combat.scenariosById[scenarioId]
      .team.members[0].loadout.echoes.map((echo) => echo?.uid ?? null)
    expect(equippedUids()).toEqual([0, 1, 2, 3, 4].map((index) => `game:${1860 + index}`))

    capture.echoes = capture.echoes.filter((echo) => echo.slotIndex != null && [0, 2, 4].includes(echo.slotIndex))
    applyConvertedYumeoGameData(convertYumeoGameData(capture))
    expect(equippedUids()).toEqual(['game:1860', null, 'game:1862', null, 'game:1864'])

    capture.echoes = []
    applyConvertedYumeoGameData(convertYumeoGameData(capture))
    expect(equippedUids()).toEqual([null, null, null, null, null])
  })

it('patches a context and preserves its scenario and omitted fields', () => {
    const before = selectedCombatScenario(useAppStore.getState().combat)
    const weapon = before.team.members[0].loadout.weapon
    const capture = sample()
    capture.resonators[0] = { resonatorId: 1506, level: 72, chain: 2, skills: [] }
    capture.weapons = [{ itemId: 21010044, level: 90, rank: 5, equippedByResonatorId: 1506 }]
    capture.echoes = []

    expect(applyConvertedYumeoGameData(convertYumeoGameData(capture)).skipped.weapons).toBe(1)
    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(after.id).toBe(before.id)
    expect(after.team.members[0].progression.level).toBe(72)
    expect(after.team.members[0].progression.sequence).toBe(2)
    expect(after.team.members[0].loadout.weapon).toEqual(weapon)
    expect(after.environment).toEqual(before.environment)
    expect(after.program).toEqual(before.program)
  })

  it('skips a mismatched weapon while adding the resonator with its default weapon', () => {
    const capture = sample()
    capture.weapons[0].itemId = 21010044
    const converted = convertYumeoGameData(capture)
    expect(converted.skipped.weapons).toBe(1)
    expect(converted.resonators[0].weapon).toBeUndefined()

    applyConvertedYumeoGameData(converted)
    const state = useAppStore.getState()
    const scenarioId = scenarioIdForContextResonator(state.combat, '1402')!
    expect(state.combat.scenariosById[scenarioId].team.members[0].loadout.weapon.id).toBe('21020015')
    expect(state.library.echoes).toHaveLength(1)
  })

  it('counts unequipped weapons as skipped, including a zero owner sentinel', () => {
    const capture = parseYumeoGameData(JSON.stringify(sample()))
    capture.weapons.push(
      { itemId: 21020015, level: 1, rank: 1 },
      { itemId: 21020015, level: 1, rank: 1, equippedByResonatorId: 0 },
    )

    const converted = convertYumeoGameData(capture)
    expect(converted.skipped.weapons).toBe(2)
    expect(converted.skipped.unequippedWeapons).toBe(2)
    expect(converted.conflicts.weapons).toHaveLength(0)
    expect(converted.resonators[0].weapon?.id).toBe('21020024')
  })

  it('ignores zero instance IDs before counting or resolving equipment', () => {
    const capture = parseYumeoGameData(JSON.stringify(sample()))
    capture.weapons.unshift({
      instanceId: 0, itemId: 21020015, level: 1, rank: 1, equippedByResonatorId: 1402,
    })
    capture.weapons.push({ instanceId: 0, itemId: 0, level: 1, rank: 1 })
    const zeroEcho = { ...capture.echoes[0], instanceId: 0 }
    capture.echoes.unshift(zeroEcho)
    capture.echoes.push(
      { ...zeroEcho, level: 12, equippedByResonatorId: undefined, slotIndex: undefined },
      { ...zeroEcho, level: 0, equippedByResonatorId: undefined, slotIndex: undefined },
      { ...zeroEcho, level: 25, equippedByResonatorId: undefined, slotIndex: undefined },
    )

    const converted = convertYumeoGameData(capture)
    expect(converted.skipped).toEqual({
      resonators: 0, weapons: 0, unequippedWeapons: 0, echoes: 0, echoEquipments: 0, unlevelledEchoes: 0,
    })
    expect(converted.conflicts).toEqual({ weapons: [], echoSlots: [] })
    expect(converted.resonators[0].weapon?.id).toBe('21020024')
    expect(converted.resonators[0].echoes.map(({ echo }) => echo.uid)).toEqual(['game:1860'])
    expect(converted.inventoryEchoes.map((echo) => echo.uid)).toEqual(['game:1860', 'game:1861'])
    expect(converted.optionalEchoes).toEqual([])
  })

  it('skips unresolvable items and uses catalog defaults for recoverable fields', () => {
    const capture = JSON.parse(JSON.stringify(sample())) as Record<string, unknown>
    const resonators = capture.resonators as Array<Record<string, unknown>>
    resonators.push({ resonatorId: 999999, level: 80 })
    resonators.push({ level: 80 })
    resonators[0].level = 'wrong'
    const weapons = capture.weapons as Array<Record<string, unknown>>
    weapons.push({ itemId: 999999, equippedByResonatorId: 1402 })
    weapons[0].rank = 'wrong'
    const echoes = capture.echoes as Array<Record<string, unknown>>
    echoes.push({ instanceId: 1862, monsterId: 999999 })
    echoes.push({ monsterId: 6000053 })
    echoes[1].mainStats = [{ statId: 5002 }, { statId: 50003 }]
    echoes[1].subStats = [{ statId: 11, value: 'wrong' }]

    const converted = convertYumeoGameData(parseYumeoGameData(JSON.stringify(capture)))
    expect(converted.skipped).toEqual({
      resonators: 2, weapons: 1, unequippedWeapons: 0, echoes: 2, echoEquipments: 0, unlevelledEchoes: 0,
    })
    expect(converted.resonators[0].level).toBeUndefined()
    expect(converted.resonators[0].weapon?.rank).toBe(1)
    expect(converted.inventoryEchoes[0].set).toBe(6)
    expect(converted.inventoryEchoes[0].mainStats.primary).toEqual({ key: 'critRate', value: 22 })
    expect(converted.inventoryEchoes[1].substats.critRate).toBe(6.3)

    applyConvertedYumeoGameData(converted)
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1402')!
    expect(useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].progression.level).toBe(1)
    expect(useAppStore.getState().library.echoes).toHaveLength(2)
  })

it('accepts a catalog set outside the first position', () => {
    const capture = sample()
    capture.echoes[0].monsterId = 390080005
    capture.echoes[0].echoSetId = 8

    const converted = convertYumeoGameData(capture)
    expect(converted.inventoryEchoes[0].set).toBe(8)
    expect(converted.resonators[0].echoes[0].echo.set).toBe(8)
  })

  it('accepts every app-supported Hecate set, including the original six', () => {
    expect(getEchoById('6000085')?.sets).toEqual([1, 2, 3, 4, 5, 6, 13])
    for (const set of [1, 2, 3, 4, 5, 6, 13]) {
      const capture = sample()
      capture.echoes = [{ ...capture.echoes[0], monsterId: 6000085, echoSetId: set }]
      const converted = convertYumeoGameData(capture)
      expect(converted.skipped.echoes).toBe(0)
      expect(converted.inventoryEchoes[0].set).toBe(set)
    }

    const capture = sample()
    capture.echoes = [{ ...capture.echoes[0], monsterId: 6000085, echoSetId: 7 }]
    expect(convertYumeoGameData(capture).skipped.echoes).toBe(1)

    capture.echoes = [{
      ...capture.echoes[0], echoSetId: 2, level: 0,
      equippedByResonatorId: undefined, slotIndex: undefined,
    }]
    expect(convertYumeoGameData(capture).skipped).toMatchObject({ echoes: 0, unlevelledEchoes: 1 })
  })

  it('rejects Echoes with unmatched set IDs or unknown stat IDs', () => {
    const invalidEchoes = [
      { echoSetId: undefined },
      { echoSetId: 999 },
      { echoSetId: 7 }, // Valid set ID, but not for Dreamless.
      { mainStats: [{ statId: 9999, statKey: 'critRate' }] },
      { mainStats: [{ key: 'critRate' }] },
      { subStats: [{ key: 'critRate', value: 6.3 }] },
      { subStats: [{ statId: 999, statKey: 'critRate', value: 6.3 }] },
      { subStats: [{ statId: 11, value: 6.3 }, { statId: 14, value: 6.3 }] },
      { mainStats: undefined },
      { subStats: undefined },
    ]
    for (const change of invalidEchoes) {
      const base = sample()
      const capture = parseYumeoGameData(JSON.stringify({ ...base, echoes: [{ ...base.echoes[0], ...change }] }))
      const converted = convertYumeoGameData(capture)
      expect(converted.skipped.echoes).toBe(1)
      expect(converted.inventoryEchoes).toEqual([])
      expect(converted.resonators[0].echoes).toEqual([])
    }
  })

it('uses numeric stat IDs and snaps substat values while preserving the Echo', () => {
    const capture = JSON.parse(JSON.stringify(sample())) as Record<string, unknown>
    const echo = (capture.echoes as Array<Record<string, unknown>>)[0]
    echo.mainStats = [{ statId: 5001, statKey: 'critDmg', value: 'wrong' }, { statId: 50003, statKey: 'hpFlat', value: -999 }]
    echo.subStats = [{ statId: 11, statKey: 'critDmg', value: 7 }]

    const converted = convertYumeoGameData(parseYumeoGameData(JSON.stringify(capture)))
    expect(converted.skipped.echoes).toBe(0)
    expect(converted.inventoryEchoes[0].mainStats).toEqual({
      primary: { key: 'critRate', value: 22 },
      secondary: { key: 'atkFlat', value: 150 },
    })
    expect(converted.inventoryEchoes[0].substats.critRate).toBe(6.9)
  })

  it('keeps a valid Echo in inventory when its equipment link is invalid', () => {
    const capture = sample()
    capture.echoes[0].slotIndex = 7

    const converted = convertYumeoGameData(capture)
    expect(converted.skipped).toEqual({
      resonators: 0, weapons: 0, unequippedWeapons: 0, echoes: 0, echoEquipments: 1, unlevelledEchoes: 0,
    })
    expect(converted.inventoryEchoes).toHaveLength(2)
    expect(converted.resonators[0].echoes).toHaveLength(0)
    expect(converted.resonators[0].weapon?.id).toBe('21020024')
  })

  it('flags multiple equipped weapons and leaves the weapon unchanged until one is selected', () => {
    const capture = sample()
    capture.weapons.push({ itemId: 21020015, level: 1, rank: 1, equippedByResonatorId: 1402 })
    const converted = convertYumeoGameData(capture)
    expect(converted.skipped.weapons).toBe(0)
    expect(converted.resonators[0].weapon).toBeUndefined()
    expect(converted.conflicts.weapons).toMatchObject([{
      resonatorId: '1402',
      candidates: [{ sourceIndex: 0, weapon: { id: '21020024' } }, { sourceIndex: 1, weapon: { id: '21020015' } }],
    }])

    const unresolved = applyConvertedYumeoGameData(converted)
    expect(unresolved.conflicts.weapons).toHaveLength(1)
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1402')!
    expect(useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].loadout.weapon.id).toBe('21020015')

    expect(() => resolveYumeoGameDataEquipmentConflicts(converted, {
      weapons: [{ resonatorId: '1402', sourceIndex: 99 }],
    })).toThrow('Invalid weapon conflict selection')
    const selected = resolveYumeoGameDataEquipmentConflicts(converted, {
      weapons: [{ resonatorId: '1402', sourceIndex: 0 }],
    })
    expect(applyConvertedYumeoGameData(selected).conflicts.weapons).toHaveLength(0)
    expect(useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].loadout.weapon.id).toBe('21020024')
  })

  it('flags Echo slot conflicts while saving both Echoes to inventory', () => {
    const capture = sample()
    capture.echoes[1] = {
      ...capture.echoes[1], level: 0,
      subStats: [{ statId: 11, value: 8.1 }],
      equippedByResonatorId: 1402, slotIndex: 0,
    }
    const converted = convertYumeoGameData(capture)
    expect(converted.skipped.echoEquipments).toBe(0)
    expect(converted.resonators[0].echoes).toHaveLength(0)
    expect(converted.inventoryEchoes).toHaveLength(2)
    expect(converted.conflicts.echoSlots).toMatchObject([{
      resonatorId: '1402', slotIndex: 0,
      candidates: [{ sourceIndex: 0, instanceId: 1860 }, { sourceIndex: 1, instanceId: 1861 }],
    }])

    const unresolved = applyConvertedYumeoGameData(converted)
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1402')!
    expect(unresolved.conflicts.echoSlots).toHaveLength(1)
    expect(useAppStore.getState().library.echoes).toHaveLength(2)
    expect(useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].loadout.echoes[0]).toBeNull()

    const selected = resolveYumeoGameDataEquipmentConflicts(converted, {
      echoSlots: [{ resonatorId: '1402', slotIndex: 0, sourceIndex: 1 }],
    })
    expect(applyConvertedYumeoGameData(selected).conflicts.echoSlots).toHaveLength(0)
    const equipped = useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].loadout.echoes[0]
    expect(equipped?.substats.critRate).toBe(8.1)
    expect(useAppStore.getState().library.echoes.some((entry) => entry.echo.uid === equipped?.uid)).toBe(true)
  })

  it('imports equipped and level 25 Echoes, skips unequipped level 0, and leaves levels 1–24 for selection', () => {
    const capture = sample()
    const template = capture.echoes[1]
    capture.echoes[0].level = 0 // Equipped Echoes stay in the build and inventory.
    capture.echoes[1].level = 0
    capture.echoes.push(
      { ...template, instanceId: 1862, level: 1, subStats: [{ statId: 11, value: 8.1 }] },
      { ...template, instanceId: 1863, level: 24, subStats: [{ statId: 11, value: 7.5 }] },
      { ...template, instanceId: 1864, level: 25, subStats: [{ statId: 11, value: 6.9 }] },
    )

    const converted = convertYumeoGameData(capture)
    expect(converted.inventoryEchoes.map((echo) => echo.uid)).toEqual(['game:1860', 'game:1864'])
    expect(converted.optionalEchoes.map(({ level, echo }) => [level, echo.uid])).toEqual([
      [1, 'game:1862'], [24, 'game:1863'],
    ])
    expect(converted.skipped.unlevelledEchoes).toBe(1)

    const result = applyConvertedYumeoGameData(converted)
    expect(result.echoesAdded).toBe(2)
    expect(result.optionalEchoes).toEqual(converted.optionalEchoes)
    expect(useAppStore.getState().library.echoes.map((entry) => entry.echo.uid)).toEqual([
      'game:1860', 'game:1864',
    ])

    expect(addSelectedOptionalYumeoGameDataEchoes(result.optionalEchoes, ['game:1863'])).toHaveLength(1)
    expect(useAppStore.getState().library.echoes.map((entry) => entry.echo.uid)).toEqual([
      'game:1860', 'game:1864', 'game:1863',
    ])
    expect(addSelectedOptionalYumeoGameDataEchoes(result.optionalEchoes, ['game:1863'])).toHaveLength(0)
  })

it('excludes saved and duplicate Echoes from optional imports', () => {
    const capture = sample()
    const template = capture.echoes[1]
    capture.echoes.push(
      { ...template, instanceId: 1862, level: 12 }, // Same stats as the equipped Echo.
      { ...template, instanceId: 1863, level: 18, subStats: [{ statId: 11, value: 7.5 }] },
      { ...template, instanceId: 1864, level: 20, subStats: [{ statId: 11, value: 8.1 }] },
      { ...template, instanceId: 1865, level: 22, subStats: [{ statId: 11, value: 7.5 }] },
    )
    const converted = convertYumeoGameData(capture)
    const saved = { ...converted.optionalEchoes[2].echo, uid: 'already-saved' }
    expect(useAppStore.getState().addInvEcho(saved)).not.toBeNull()

    const result = applyConvertedYumeoGameData(converted)
    expect(result.echoesAdded).toBe(1)
    expect(result.optionalEchoes.map(({ echo }) => echo.uid)).toEqual(['game:1863'])
    expect(useAppStore.getState().library.echoes).toHaveLength(2)
  })

it('prepares a review before applying selected conflicts and optional Echoes', async () => {
    const capture = sample()
    capture.weapons.push({ itemId: 21020015, level: 1, rank: 1, equippedByResonatorId: 1402 })
    capture.echoes[1] = {
      ...capture.echoes[1], instanceId: 1861, level: 12,
      subStats: [{ statId: 11, value: 8.1 }],
    }
    const prepared = await prepareYumeoGameData(JSON.stringify(capture))
    expect(prepared.review.resonators).toHaveLength(1)
    expect(prepared.review.inventoryEchoesToAdd).toHaveLength(1)
    expect(prepared.review.optionalEchoes.map(({ echo }) => echo.uid)).toEqual(['game:1861'])
    expect(prepared.review.conflicts.weapons).toHaveLength(1)
    expect(useAppStore.getState().library.echoes).toHaveLength(0)

    const wrongMode = { ...prepared, mode: prepared.mode === 'live' ? 'beta' as const : 'live' as const }
    expect(() => applyPreparedYumeoGameData(wrongMode)).toThrow('Game data mode changed')
    expect(() => applyPreparedYumeoGameData(prepared)).toThrow('Resolve every equipment conflict')
    expect(() => applyPreparedYumeoGameData(prepared, {
      equipment: { weapons: [{ resonatorId: '1402', sourceIndex: 1 }] },
      optionalEchoUids: ['game:missing'],
    })).toThrow('Invalid optional Echo selection')
    expect(useAppStore.getState().library.echoes).toHaveLength(0)

    const result = applyPreparedYumeoGameData(prepared, {
      equipment: { weapons: [{ resonatorId: '1402', sourceIndex: 1 }] },
      optionalEchoUids: ['game:1861'],
    })
    expect(result).toMatchObject({ echoesAdded: 1, optionalEchoesAdded: 1 })
    expect(result.conflicts).toEqual({ weapons: [], echoSlots: [] })
    expect(useAppStore.getState().library.echoes).toHaveLength(2)
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1402')!
    expect(useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].loadout.weapon.id).toBe('21020015')
  })

it('skips a resonator and its conflicts and releases its equipped Echoes', async () => {
    const capture = sample()
    capture.weapons.push({ itemId: 21020015, level: 1, rank: 1, equippedByResonatorId: 1402 })
    const prepared = await prepareYumeoGameData(JSON.stringify(capture))
    expect(prepared.review.echoMeta['game:1860']).toEqual({ level: 25, ownerId: '1402', slotIndex: 0 })
    expect(prepared.review.echoMeta['game:1861']).toEqual({ level: 25 })
    expect(() => applyPreparedYumeoGameData(prepared, { skipResonatorIds: ['9999'] })).toThrow('Invalid resonator skip')

    const result = applyPreparedYumeoGameData(prepared, {
      skipResonatorIds: ['1402'],
      excludedEchoUids: ['game:1860'],
    })
    expect(result.resonators).toBe(0)
    expect(scenarioIdForContextResonator(useAppStore.getState().combat, '1402')).toBeFalsy()
    expect(useAppStore.getState().library.echoes).toHaveLength(1)
  })

  it('never excludes an echo a kept resonator wears, but drops a Lv 25 one from the bag', async () => {
    const prepared = await prepareYumeoGameData(JSON.stringify(sample()))
    expect(() => applyPreparedYumeoGameData(prepared, { excludedEchoUids: ['game:1860'] })).toThrow('Invalid Echo exclusion')
    expect(useAppStore.getState().library.echoes).toHaveLength(0)

    const result = applyPreparedYumeoGameData(prepared, { excludedEchoUids: ['game:1861'] })
    expect(result).toMatchObject({ resonators: 1, echoesAdded: 1 })
    expect(useAppStore.getState().library.echoes).toHaveLength(1)
  })

  it('rejects an incomplete converted Echo inventory before any saved state changes', () => {
    const converted = convertYumeoGameData(sample())
    converted.inventoryEchoes = []
    expect(() => applyConvertedYumeoGameData(converted)).toThrow('missing from the import inventory')
    expect(useAppStore.getState().library.echoes).toHaveLength(0)
    expect(scenarioIdForContextResonator(useAppStore.getState().combat, '1402')).toBeFalsy()
  })

  it('requires a reviewed choice for a conflicting Echo slot before committing', async () => {
    const capture = sample()
    capture.echoes[1] = {
      ...capture.echoes[1], equippedByResonatorId: 1402, slotIndex: 0,
      subStats: [{ statId: 11, value: 8.1 }],
    }
    const prepared = await prepareYumeoGameData(JSON.stringify(capture))
    expect(prepared.review.conflicts.echoSlots).toHaveLength(1)
    expect(() => applyPreparedYumeoGameData(prepared)).toThrow('Resolve every equipment conflict')
    expect(useAppStore.getState().library.echoes).toHaveLength(0)

    const result = applyPreparedYumeoGameData(prepared, {
      equipment: { echoSlots: [{ resonatorId: '1402', slotIndex: 0, sourceIndex: 1 }] },
    })
    expect(result.conflicts.echoSlots).toHaveLength(0)
    expect(useAppStore.getState().library.echoes).toHaveLength(2)
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1402')!
    expect(useAppStore.getState().combat.scenariosById[scenarioId].team.members[0].loadout.echoes[0]?.substats.critRate).toBe(8.1)
  })

it('excludes an unselected contested Echo while retaining the equipped choice', async () => {
    const capture = sample()
    capture.echoes[1] = {
      ...capture.echoes[1], equippedByResonatorId: 1402, slotIndex: 0,
      subStats: [{ statId: 11, value: 8.1 }],
    }
    const prepared = await prepareYumeoGameData(JSON.stringify(capture))
    const equipment = { echoSlots: [{ resonatorId: '1402', slotIndex: 0, sourceIndex: 1 }] }
    expect(() => applyPreparedYumeoGameData(prepared, { equipment, excludedEchoUids: ['game:1861'] })).toThrow('Invalid Echo exclusion')

    const result = applyPreparedYumeoGameData(prepared, { equipment, excludedEchoUids: ['game:1860'] })
    expect(result.conflicts.echoSlots).toHaveLength(0)
    expect(useAppStore.getState().library.echoes.map((entry) => entry.echo.substats.critRate)).toEqual([8.1])
  })
})
