import { describe, expect, it } from 'vitest'
import { importLegacyInventoryEchoJson } from '@/domain/services/legacyInventoryImport'
import { importLegacyAppStateJson } from '@/domain/services/legacyAppStateImport'
import { createDefaultResonatorProfile } from '@/domain/state/defaults'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'

async function readFixture(name: string): Promise<string> {
  const response = await fetch(`/${name}`)
  return response.text()
}

describe('legacy app-state import', () => {
  it('lets the legacy echo importer read the full v1 all-data backup shape', async () => {
    const raw = await readFixture('all-data-backup (6).json')
    const result = importLegacyInventoryEchoJson(raw)

    expect(result.importedCount).toBe(159)
    expect(result.skippedCount).toBe(0)
    expect(result.echoes[0]?.id).toBe('6000121')
  })

  it('converts the v1 all-data backup into a v2 persisted snapshot', async () => {
    const raw = await readFixture('all-data-backup (6).json')
    const result = importLegacyAppStateJson(raw)

    expect(result.snapshot.version).toBe(22)
    expect(result.snapshot.ui.theme).toBe('dark')
    expect(result.snapshot.ui.bodyFontName).toBe('Fredoka')
    expect(result.snapshot.ui.leftPaneView).toBe('resonators')
    expect(result.snapshot.ui.mainMode).toBe('optimizer')
    expect(result.snapshot.calculator.session.activeResonatorId).toBe('1210')

    expect(Object.keys(result.snapshot.calculator.profiles)).toHaveLength(34)
    expect(result.snapshot.calculator.inventoryEchoes).toHaveLength(159)
    expect(result.snapshot.calculator.inventoryBuilds).toHaveLength(29)
    expect(result.snapshot.calculator.inventoryRotations).toHaveLength(0)

    const sanhua = result.snapshot.calculator.profiles['1102']
    const sanhuaDefault = createDefaultResonatorProfile(getResonatorSeedById('1102')!)
    expect(sanhua).toBeTruthy()
    expect(sanhua.runtime.progression.level).toBe(90)
    expect(sanhua.runtime.progression.sequence).toBe(6)
    expect(sanhua.runtime.progression.traceNodes.atk.percent).toBe(12)
    expect(sanhua.runtime.progression.traceNodes.attribute.glacio.dmgBonus).toBe(12)
    expect(sanhua.runtime.build.weapon.id).toBe('21020015')
    expect(sanhua.runtime.build.echoes).toHaveLength(5)
    expect(sanhua.runtime.local.controls).toEqual(sanhuaDefault.runtime.local.controls)
    expect(sanhua.runtime.local.combat).toEqual(sanhuaDefault.runtime.local.combat)
    expect(sanhua.runtime.rotation).toEqual(sanhuaDefault.runtime.rotation)

    const activeEnemy = result.snapshot.calculator.session.enemyProfile
    expect(activeEnemy.level).toBe(100)
    expect(activeEnemy.res[0]).toBe(20)
    expect(activeEnemy.res[6]).toBe(20)

    expect(result.report.importedProfileIds).toHaveLength(34)
    expect(result.report.skippedProfileIds).toHaveLength(0)
    expect(result.report.importedInventoryEchoes).toBe(159)
    expect(result.report.importedInventoryBuilds).toBe(29)
    expect(result.report.importedInventoryRotations).toBe(0)
  })
})
