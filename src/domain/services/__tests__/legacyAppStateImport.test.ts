import { describe, expect, it } from 'vitest'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { importLegacyInventoryEchoJson } from '@/domain/services/legacyInventoryImport'
import { importLegacyApp } from '@/domain/services/legacyAppStateImport'
import { makeResProfile } from '@/domain/state/defaults'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'

function makeLegacyEcho(uid: string, echoId = listEchoes()[0]?.id) {
  const definition = listEchoes().find((echo) => echo.id === echoId)
  if (!definition) {
    throw new Error(`missing echo fixture ${echoId}`)
  }

  const primaryStats = ECHO_MAIN_STATS[definition.cost]
  const secondaryStat = ECHO_SIDE_STATS[definition.cost]
  const primaryKey = Object.keys(primaryStats)[0]

  return {
    uid,
    id: definition.id,
    set: definition.sets[0],
    mainStats: {
      primary: {
        key: primaryKey,
        value: primaryStats[primaryKey],
      },
      secondary: {
        key: secondaryStat.key,
        value: secondaryStat.value,
      },
    },
    substats: {
      critRate: 6.3,
      critDmg: 12.6,
    },
  }
}

function makeLegacyBackupRaw() {
  return JSON.stringify({
    charInfo: {
      activeCharacterId: '1102',
      enemyLevel: 95,
      enemyRes: 15,
      characterRuntimeStates: {
        '1102': {
          Id: '1102',
          CharacterLevel: 90,
          SkillLevels: {
            sequence: 6,
            normalAttack: 9,
            resonanceSkill: 8,
            forteCircuit: 7,
            resonanceLiberation: 6,
            introSkill: 5,
          },
          TraceNodeBuffs: {
            atkPercent: 12,
            glacio: 12,
          },
          CombatState: {
            weaponId: '21020015',
            weaponLevel: 90,
            weaponRank: 5,
          },
          equippedEchoes: [makeLegacyEcho('equipped-echo')],
        },
      },
    },
    controls: {
      'user-theme': 'dark',
      leftPaneView: 'characters',
      showOptimizer: true,
    },
    stores: {
      echoBag: [
        makeLegacyEcho('bag-echo-1'),
        makeLegacyEcho('bag-echo-2'),
      ],
      echoPresets: [
        {
          id: 'preset-1',
          name: 'Imported Sanhua',
          charId: '1102',
          charName: 'Sanhua',
          echoes: [makeLegacyEcho('preset-echo')],
        },
      ],
    },
  })
}

describe('legacy app-state import', () => {
  it('lets the legacy echo importer read the full v1 all-data backup shape', () => {
    const raw = makeLegacyBackupRaw()
    const result = importLegacyInventoryEchoJson(raw)

    expect(result.importedCount).toBe(2)
    expect(result.skippedCount).toBe(0)
    expect(result.echoes.map((echo) => echo.uid)).toEqual(['bag-echo-1', 'bag-echo-2'])
  })

  it('converts the v1 all-data backup into a v2 persisted snapshot', () => {
    const raw = makeLegacyBackupRaw()
    const result = importLegacyApp(raw)

    expect(result.snapshot.version).toBe(22)
    expect(result.snapshot.ui.theme).toBe('dark')
    expect(result.snapshot.ui.leftPaneView).toBe('resonators')
    expect(result.snapshot.ui.mainMode).toBe('optimizer')
    expect(result.snapshot.calculator.session.activeResonatorId).toBe('1102')

    expect(Object.keys(result.snapshot.calculator.profiles)).toEqual(['1102'])
    expect(result.snapshot.calculator.inventoryEchoes).toHaveLength(2)
    expect(result.snapshot.calculator.inventoryBuilds).toHaveLength(1)
    expect(result.snapshot.calculator.inventoryRotations).toHaveLength(0)

    const sanhua = result.snapshot.calculator.profiles['1102']
    const sanhuaDefault = makeResProfile(getResSeedBy('1102')!)
    expect(sanhua).toBeTruthy()
    expect(sanhua.runtime.progression.level).toBe(90)
    expect(sanhua.runtime.progression.sequence).toBe(6)
    expect(sanhua.runtime.progression.traceNodes.atk.percent).toBe(12)
    expect(sanhua.runtime.progression.traceNodes.attribute.glacio.dmgBonus).toBe(12)
    expect(sanhua.runtime.build.weapon.id).toBe('21020015')
    expect(sanhua.runtime.build.echoes).toHaveLength(1)
    expect(sanhua.runtime.local.controls).toEqual(sanhuaDefault.runtime.local.controls)
    expect(sanhua.runtime.local.combat).toEqual(sanhuaDefault.runtime.local.combat)
    expect(sanhua.runtime.rotation).toEqual(sanhuaDefault.runtime.rotation)

    const activeEnemy = result.snapshot.calculator.session.enemyProfile
    expect(activeEnemy.level).toBe(95)
    expect(activeEnemy.res[0]).toBe(15)
    expect(activeEnemy.res[6]).toBe(15)

    expect(result.report.importedProfileIds).toEqual(['1102'])
    expect(result.report.skippedProfileIds).toHaveLength(0)
    expect(result.report.importedInventoryEchoes).toBe(2)
    expect(result.report.importedInventoryBuilds).toBe(1)
    expect(result.report.importedInventoryRotations).toBe(0)
  })
})
