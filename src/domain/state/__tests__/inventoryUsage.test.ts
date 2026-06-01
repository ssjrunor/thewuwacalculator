import { describe, expect, it } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { cloneEchoFor } from '@/domain/entities/inventoryStorage.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeResProfile } from '@/domain/state/defaults.ts'
import {
  mkInvMkSgNms,
  mkInvEchoSgB,
} from '@/domain/state/inventoryUsage.ts'

function makeEcho(uid: string): EchoInstance {
  return {
    uid,
    id: 'echo-test',
    set: 1,
    mainEcho: false,
    mainStats: {
      primary: { key: 'atk', value: 30 },
      secondary: { key: 'atk', value: 100 },
    },
    substats: {
      critRate: 6.3,
    },
  }
}

describe('inventory usage', () => {
  it('indexes equipped echoes by preserved inventory uid', () => {
    const sanhua = getResSeedBy('1102')
    const baizhi = getResSeedBy('1103')
    if (!sanhua || !baizhi) {
      throw new Error('missing resonator seeds for inventory usage test')
    }

    const inventoryEcho = makeEcho('echo-uid-1')
    const sanhuaProfile = makeResProfile(sanhua)
    const baizhiProfile = makeResProfile(baizhi)
    sanhuaProfile.runtime.build.echoes[0] = cloneEchoFor(inventoryEcho, 0)
    baizhiProfile.runtime.build.echoes[2] = cloneEchoFor(inventoryEcho, 2)

    const usageByUid = mkInvEchoSgB({
      [sanhua.id]: sanhuaProfile,
      [baizhi.id]: baizhiProfile,
    })

    expect(sanhuaProfile.runtime.build.echoes[0]?.uid).toBe(inventoryEcho.uid)
    expect(usageByUid[inventoryEcho.uid]).toEqual([
      expect.objectContaining({
        resonatorId: sanhua.id,
        resName: sanhua.name,
        icon: sanhua.profile,
        rarity: sanhua.rarity,
        slotIndex: 0,
      }),
      expect.objectContaining({
        resonatorId: baizhi.id,
        resName: baizhi.name,
        icon: baizhi.profile,
        rarity: baizhi.rarity,
        slotIndex: 2,
      }),
    ])
    expect(usageByUid['unused-uid']).toBeUndefined()
  })

  it('indexes saved build usage by current profile build signature', () => {
    const sanhua = getResSeedBy('1102')
    if (!sanhua) {
      throw new Error('missing Sanhua seed for inventory build usage test')
    }

    const profile = makeResProfile(sanhua)
    const inventoryBuild = {
      id: 'build-1',
      name: 'Sanhua build',
      resonatorId: sanhua.id,
      resonatorName: sanhua.name,
      build: {
        weapon: { ...profile.runtime.build.weapon },
        echoes: profile.runtime.build.echoes,
      },
      createdAt: 1,
      updatedAt: 1,
    }

    expect(mkInvMkSgNms({ [sanhua.id]: profile }, [inventoryBuild])).toEqual({
      [inventoryBuild.id]: [sanhua.name],
    })
  })
})
