import { describe, expect, it } from 'vitest'
import { ECHO_PRIMARY_STATS, ECHO_SECONDARY_STATS } from '@/data/gameData/catalog/echoStats'
import { listEchoes } from '@/domain/services/catalogService'
import { importLegacyInventoryEchoJson } from '@/domain/services/legacyInventoryImport'

describe('legacy inventory import', () => {
  it('imports a raw legacy echo bag array into current echo instances', () => {
    const definition = listEchoes().find((echo) => echo.cost === 4)
    if (!definition) {
      throw new Error('missing cost-4 echo definition')
    }

    const payload = JSON.stringify([
      {
        id: definition.id,
        name: definition.name,
        selectedSet: definition.sets[0],
        mainStats: {
          critRate: ECHO_PRIMARY_STATS[4].critRate,
          atkFlat: ECHO_SECONDARY_STATS[4].value,
        },
        subStats: {
          critRate: 6.3,
          critDmg: 12.6,
        },
      },
    ])

    const result = importLegacyInventoryEchoJson(payload)

    expect(result.importedCount).toBe(1)
    expect(result.skippedCount).toBe(0)
    expect(result.echoes[0]).toEqual({
      uid: expect.any(String),
      id: definition.id,
      set: definition.sets[0],
      mainEcho: false,
      mainStats: {
        primary: { key: 'critRate', value: ECHO_PRIMARY_STATS[4].critRate },
        secondary: { key: 'atkFlat', value: ECHO_SECONDARY_STATS[4].value },
      },
      substats: {
        critRate: 6.3,
        critDmg: 12.6,
      },
    })
  })

  it('imports an object payload containing a stringified legacy echoBag', () => {
    const definition = listEchoes().find((echo) => echo.cost === 3)
    if (!definition) {
      throw new Error('missing cost-3 echo definition')
    }

    const echoBag = JSON.stringify([
      {
        name: definition.name,
        selectedSet: definition.sets[0],
        mainStats: {
          fusion: ECHO_PRIMARY_STATS[3].fusion,
          atkFlat: ECHO_SECONDARY_STATS[3].value,
        },
        subStats: {
          energyRegen: 8.6,
        },
      },
    ])

    const result = importLegacyInventoryEchoJson(JSON.stringify({ echoBag }))

    expect(result.importedCount).toBe(1)
    expect(result.skippedCount).toBe(0)
    expect(result.echoes[0]?.id).toBe(definition.id)
    expect(result.echoes[0]?.uid).toEqual(expect.any(String))
    expect(result.echoes[0]?.mainStats.primary.key).toBe('fusion')
    expect(result.echoes[0]?.mainStats.primary.value).toBe(ECHO_PRIMARY_STATS[3].fusion)
  })

  it('imports the titled legacy backup shape using `Echo Bag`', () => {
    const definition = listEchoes().find((echo) => echo.cost === 1)
    if (!definition) {
      throw new Error('missing cost-1 echo definition')
    }

    const result = importLegacyInventoryEchoJson(JSON.stringify({
      'Echo Bag': [
        {
          uid: 'legacy-echo-1',
          id: definition.id,
          name: definition.name,
          selectedSet: definition.sets[0],
          mainStats: {
            atkPercent: ECHO_PRIMARY_STATS[1].atkPercent,
            hpFlat: ECHO_SECONDARY_STATS[1].value,
          },
          subStats: {
            critRate: 6.9,
          },
        },
      ],
    }))

    expect(result.importedCount).toBe(1)
    expect(result.skippedCount).toBe(0)
    expect(result.echoes[0]?.id).toBe(definition.id)
    expect(result.echoes[0]?.uid).toBe('legacy-echo-1')
    expect(result.echoes[0]?.mainStats.primary.key).toBe('atkPercent')
  })
})
