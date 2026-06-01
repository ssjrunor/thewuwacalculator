import { beforeEach, describe, expect, it } from 'vitest'
import { makeAppState, makeResProfile, makeSuggest, makeTeamMember } from '@/domain/state/defaults'
import { mkMptyHistSt } from '@/domain/state/history'
import { mkRtFromProf } from '@/domain/state/runtimeAdapters'
import { useAppStore } from '@/domain/state/store'
import { getResSeedBy, listResSds } from '@/domain/services/resonatorSeedService'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { mkDefEchoNst } from '@/modules/calculator/features/echoes/lib/echoPane'

function resetStore() {
  useAppStore.getState().resetState()
  useAppStore.setState((state) => ({
    ...state,
    ...makeAppState(),
    invOpen: false,
    invEchoQ: '',
    invMounted: false,
    invHydr: false,
    history: mkMptyHistSt(),
  }))
}

function requireSeed(id: string) {
  const seed = getResSeedBy(id)
  expect(seed).toBeTruthy()
  return seed!
}

function findDistinctSeed(excludedIds: string[]) {
  const seed = listResSds().find((entry) => !excludedIds.includes(entry.id))
  expect(seed).toBeTruthy()
  return seed!
}

function requireAltWeaponId(resonatorId: string, currentWeaponId: string | null) {
  const seed = requireSeed(resonatorId)
  const weapon = listWpnsByTy(seed.weaponType).find((entry) => entry.id !== currentWeaponId)
  expect(weapon).toBeTruthy()
  return weapon!.id
}

function requireEcho(index: number) {
  const echo = listEchoes()[index]
  expect(echo).toBeTruthy()
  return echo!
}

function findDistinctEchoIds(count: number, excludedIds: string[]) {
  const ids = listEchoes()
    .map((entry) => entry.id)
    .filter((id) => !excludedIds.includes(id))
    .slice(0, count)

  expect(ids).toHaveLength(count)
  return ids
}

describe('picker frequency tracking', () => {
  beforeEach(() => {
    resetStore()
  })

  it('keeps ordered top three ids without duplicates', () => {
    const store = useAppStore.getState()

    store.bumpPickFr({ bucket: 'resonator', ids: ['a'] })
    store.bumpPickFr({ bucket: 'resonator', ids: ['b'] })
    store.bumpPickFr({ bucket: 'resonator', ids: ['c'] })
    store.bumpPickFr({ bucket: 'resonator', ids: ['d'] })
    store.bumpPickFr({ bucket: 'resonator', ids: ['b'] })

    expect(useAppStore.getState().ui.itemFreq.resonator.ids).toEqual(['b', 'd', 'c'])
    expect(useAppStore.getState().ui.itemFreq.resonator.counts).toEqual({
      b: 2,
      c: 1,
      d: 1,
    })
    expect(useAppStore.getState().history.past).toHaveLength(0)
  })

  it('updates weapon and echo buckets for direct picker bumps', () => {
    const store = useAppStore.getState()
    const activeId = store.calculator.session.activeResonatorId
    expect(activeId).toBeTruthy()

    const altWeaponId = requireAltWeaponId(activeId!, store.calculator.profiles[activeId!]?.runtime.build.weapon.id ?? null)
    const existingRuntime = mkRtFromProf(store.calculator, activeId!)
    const existingEchoIds = existingRuntime?.build.echoes
      .map((entry) => entry?.id ?? null)
      .filter((value): value is string => Boolean(value)) ?? []
    const [mainEchoId, sideEchoId] = findDistinctEchoIds(2, existingEchoIds)
    const mainEcho = mkDefEchoNst(mainEchoId, 0, null)!
    const sideEcho = mkDefEchoNst(sideEchoId, 1, null)!
    const activeSeed = requireSeed(activeId!)

    store.bumpPickFr([
      {
        bucket: 'echo',
        ids: [mainEcho.id, sideEcho.id],
      },
      {
        bucket: 'weapon',
        weaponType:
          activeSeed.weaponType === 1 ? 'broadblade'
            : activeSeed.weaponType === 2 ? 'sword'
              : activeSeed.weaponType === 3 ? 'pistols'
                : activeSeed.weaponType === 4 ? 'gauntlets'
                  : 'rectifier',
        ids: [altWeaponId],
      },
    ])

    const { itemFreq } = useAppStore.getState().ui

    expect(itemFreq.echo.ids).toEqual([mainEcho.id, sideEcho.id])
    expect(itemFreq.echo.counts).toEqual({
      [mainEcho.id]: 1,
      [sideEcho.id]: 1,
    })

    switch (activeSeed.weaponType) {
      case 1:
        expect(itemFreq.weaponByType.broadblade.ids[0]).toBe(altWeaponId)
        expect(itemFreq.weaponByType.broadblade.counts[altWeaponId]).toBe(1)
        break
      case 2:
        expect(itemFreq.weaponByType.sword.ids[0]).toBe(altWeaponId)
        expect(itemFreq.weaponByType.sword.counts[altWeaponId]).toBe(1)
        break
      case 3:
        expect(itemFreq.weaponByType.pistols.ids[0]).toBe(altWeaponId)
        expect(itemFreq.weaponByType.pistols.counts[altWeaponId]).toBe(1)
        break
      case 4:
        expect(itemFreq.weaponByType.gauntlets.ids[0]).toBe(altWeaponId)
        expect(itemFreq.weaponByType.gauntlets.counts[altWeaponId]).toBe(1)
        break
      case 5:
        expect(itemFreq.weaponByType.rectifier.ids[0]).toBe(altWeaponId)
        expect(itemFreq.weaponByType.rectifier.counts[altWeaponId]).toBe(1)
        break
    }
  })

  it('only bumps enemy frequency when the enemy id changes', () => {
    const store = useAppStore.getState()
    const currentEnemy = store.calculator.session.enemyProfile

    store.setEnemy({
      ...currentEnemy,
      id: '110',
    })

    expect(useAppStore.getState().ui.itemFreq.enemy.ids).toEqual(['110'])
    expect(useAppStore.getState().ui.itemFreq.enemy.counts).toEqual({ '110': 1 })

    store.setEnemy({
      ...useAppStore.getState().calculator.session.enemyProfile,
      level: currentEnemy.level + 10,
    })

    expect(useAppStore.getState().ui.itemFreq.enemy.ids).toEqual(['110'])
    expect(useAppStore.getState().ui.itemFreq.enemy.counts).toEqual({ '110': 1 })
  })

  it('tracks imported profile ids across active, team, weapon, and echo buckets', () => {
    const store = useAppStore.getState()
    const activeSeed = requireSeed('1506')
    const teammate1 = findDistinctSeed([activeSeed.id])
    const teammate2 = findDistinctSeed([activeSeed.id, teammate1.id])
    const activeWeaponId = requireAltWeaponId(activeSeed.id, null)
    const teammate1WeaponId = requireAltWeaponId(teammate1.id, null)
    const teammate2WeaponId = requireAltWeaponId(teammate2.id, null)
    const activeEcho = mkDefEchoNst(requireEcho(0).id, 0, null)
    const teammate1Echo = mkDefEchoNst(requireEcho(1).id, 0, null)
    const teammate2Echo = mkDefEchoNst(requireEcho(2).id, 0, null)

    expect(activeEcho && teammate1Echo && teammate2Echo).toBeTruthy()

    const profile = makeResProfile(activeSeed)
    profile.runtime.build.weapon.id = activeWeaponId
    profile.runtime.build.echoes = [activeEcho, null, null, null, null]
    profile.runtime.team = [activeSeed.id, teammate1.id, teammate2.id]

    const teammate1Runtime = makeTeamMember(teammate1)
    teammate1Runtime.build.weapon.id = teammate1WeaponId
    teammate1Runtime.build.echoes = [teammate1Echo, null, null, null, null]

    const teammate2Runtime = makeTeamMember(teammate2)
    teammate2Runtime.build.weapon.id = teammate2WeaponId
    teammate2Runtime.build.echoes = [teammate2Echo, null, null, null, null]

    profile.runtime.teamRuntimes = [teammate1Runtime, teammate2Runtime]

    useAppStore.setState((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        suggestionsByResonatorId: {
          ...state.calculator.suggestionsByResonatorId,
          [activeSeed.id]: makeSuggest(),
          [teammate1.id]: makeSuggest(),
          [teammate2.id]: makeSuggest(),
        },
      },
    }))

    store.loadResProf(profile)

    const { itemFreq } = useAppStore.getState().ui

    expect(itemFreq.resonator.ids[0]).toBe(activeSeed.id)
    expect(itemFreq.resonator.counts[activeSeed.id]).toBe(1)
    expect(itemFreq.resonatorByTeamSlot.active.ids[0]).toBe(activeSeed.id)
    expect(itemFreq.resonatorByTeamSlot.active.counts[activeSeed.id]).toBe(1)
    expect(itemFreq.resonatorByTeamSlot.teammate1.ids[0]).toBe(teammate1.id)
    expect(itemFreq.resonatorByTeamSlot.teammate1.counts[teammate1.id]).toBe(1)
    expect(itemFreq.resonatorByTeamSlot.teammate2.ids[0]).toBe(teammate2.id)
    expect(itemFreq.resonatorByTeamSlot.teammate2.counts[teammate2.id]).toBe(1)
    expect(itemFreq.echo.ids).toEqual([activeEcho!.id, teammate1Echo!.id, teammate2Echo!.id])
    expect(itemFreq.echo.counts).toEqual({
      [activeEcho!.id]: 1,
      [teammate1Echo!.id]: 1,
      [teammate2Echo!.id]: 1,
    })
  })
})
