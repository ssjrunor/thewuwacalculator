import { beforeEach, describe, expect, it } from 'vitest'
import { ECHO_PRIMARY_STATS, ECHO_SECONDARY_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoInstance } from '@/domain/entities/runtime'
import { createEchoUid } from '@/domain/entities/runtime'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { getResonatorById } from '@/domain/services/resonatorCatalogService'
import { DEFAULT_RESONATOR_ID } from '@/domain/state/defaults'
import { useAppStore } from '@/domain/state/store'
import { consumeDirtyPersistedDomains } from '@/infra/persistence/storage'

function makeEchoInstance(echoId: string, slotIndex = 0): EchoInstance {
  const definition = listEchoes().find((echo) => echo.id === echoId)
  if (!definition) {
    throw new Error(`missing echo ${echoId}`)
  }

  const primaryStats = ECHO_PRIMARY_STATS[definition.cost]
  const secondaryStat = ECHO_SECONDARY_STATS[definition.cost]
  const primaryKey = Object.keys(primaryStats)[0]

  return {
    uid: createEchoUid(),
    id: definition.id,
    set: definition.sets[0] ?? 0,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { key: primaryKey, value: primaryStats[primaryKey] },
      secondary: { key: secondaryStat.key, value: secondaryStat.value },
    },
    substats: {
      critRate: 6.3,
      critDmg: 12.6,
    },
  }
}

describe('persistence domain routing', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumeDirtyPersistedDomains()

    const defaultSeed = getResonatorById(DEFAULT_RESONATOR_ID)
    if (!defaultSeed) {
      throw new Error(`missing default resonator ${DEFAULT_RESONATOR_ID}`)
    }

    useAppStore.getState().activateResonator(defaultSeed)
    consumeDirtyPersistedDomains()
  })

  it('marks only appearance persistence for theme changes', () => {
    useAppStore.getState().setTheme('dark')

    expect(consumeDirtyPersistedDomains()).toEqual(['ui.appearance'])
  })

  it('marks layout and optimizer context when switching to optimizer mode', () => {
    useAppStore.getState().setMainMode('optimizer')

    expect(consumeDirtyPersistedDomains()).toEqual(['ui.layout', 'calculator.optimizerContext'])
  })

  it('marks only the session domain for enemy updates', () => {
    const { enemyProfile } = useAppStore.getState().calculator.session
    useAppStore.getState().setEnemyProfile({
      ...enemyProfile,
      level: enemyProfile.level + 1,
    })

    expect(consumeDirtyPersistedDomains()).toEqual(['calculator.session'])
  })

  it('marks only echo inventory persistence when adding an echo', () => {
    useAppStore.getState().addEchoToInventory(makeEchoInstance(listEchoes()[0].id))

    expect(consumeDirtyPersistedDomains()).toEqual(['calculator.inventory.echoes'])
  })
})
