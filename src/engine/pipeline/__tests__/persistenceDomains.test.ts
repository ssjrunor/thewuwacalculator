import { beforeEach, describe, expect, it } from 'vitest'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { getResById } from '@/domain/services/resonatorCatalogService'
import { DEF_RES_ID } from '@/domain/state/defaults'
import { useAppStore } from '@/domain/state/store'
import { consumePersist } from '@/infra/persistence/storage'

function makeEchoInstance(echoId: string, slotIndex = 0): EchoInstance {
  const definition = listEchoes().find((echo) => echo.id === echoId)
  if (!definition) {
    throw new Error(`missing echo ${echoId}`)
  }

  const primaryStats = ECHO_MAIN_STATS[definition.cost]
  const secondaryStat = ECHO_SIDE_STATS[definition.cost]
  const primaryKey = Object.keys(primaryStats)[0]

  return {
    uid: makeEchoUid(),
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
    consumePersist()

    const defaultSeed = getResById(DEF_RES_ID)
    if (!defaultSeed) {
      throw new Error(`missing default resonator ${DEF_RES_ID}`)
    }

    useAppStore.getState().actRes(defaultSeed)
    consumePersist()
  })

  it('marks only appearance persistence for theme changes', () => {
    useAppStore.getState().setTheme('dark')

    expect(consumePersist()).toEqual(['ui.appearance'])
  })

  it('marks layout and optimizer context when switching to optimizer mode', () => {
    useAppStore.getState().setMainMode('optimizer')

    expect(consumePersist()).toEqual(['ui.layout', 'calculator.optimizerContext'])
  })

  it('marks session and layout domains for enemy updates', () => {
    const { enemyProfile } = useAppStore.getState().calculator.session
    useAppStore.getState().setEnemy({
      ...enemyProfile,
      level: enemyProfile.level + 1,
    })

    expect(consumePersist()).toEqual(['calculator.session', 'ui.layout'])
  })

  it('marks only echo inventory persistence when adding an echo', () => {
    useAppStore.getState().addInvEcho(makeEchoInstance(listEchoes()[0].id))

    expect(consumePersist()).toEqual(['calculator.inventory.echoes'])
  })
})
