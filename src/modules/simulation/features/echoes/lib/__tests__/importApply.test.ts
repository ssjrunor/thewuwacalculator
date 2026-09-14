/*
  Author: Runor Ewhro
  Description: Locks what a build-card import writes: the bands it is handed and
               nothing else, with the values the card cannot see left alone.
*/

import { describe, expect, it } from 'vitest'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { ParsedBuildScreenshot } from '@/engine/echoParser/ocrParsing'
import { makeResRuntime } from '@/domain/state/defaults'
import { listResSds } from '@/domain/services/resonatorSeedService'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService'
import { applyImprtRd } from '@/modules/simulation/features/echoes/lib/importApply'

function makeRead(weaponId: string | null): ParsedBuildScreenshot {
  return {
    player: { id: 'xuri', uid: '500395087' },
    resonator: {
      id: null,
      candidateIds: [],
      name: 'Hiyuki',
      attribute: 'glacio',
      level: 90,
      sequence: 3,
      skillLevels: {
        normalAttack: 10,
        resonanceSkill: 1,
        forteCircuit: 10,
        resonanceLiberation: 10,
        introSkill: 1,
      },
    },
    weapon: { id: weaponId, name: 'Frostburn', level: 90 },
    echoes: [],
  }
}

describe('applyImprtRd', () => {
  const seed = listResSds()[0]
  const base: ResRuntime = makeResRuntime(seed)

  it('writes only the bands it is handed', () => {
    const next = applyImprtRd(base, makeRead(null), [], {
      resonator: false,
      weapon: false,
      echoes: false,
    })

    expect(next).toBe(base)
  })

  it('moves level, sequence and the five forte levels the card carries', () => {
    const next = applyImprtRd(base, makeRead(null), [], {
      resonator: true,
      weapon: false,
      echoes: false,
    })

    expect(next.base.level).toBe(90)
    expect(next.base.sequence).toBe(3)
    expect(next.base.skillLevels.normalAttack).toBe(10)
    expect(next.base.skillLevels.resonanceSkill).toBe(1)
    expect(next.base.skillLevels.introSkill).toBe(1)
    // tune break is not drawn on the card, so it keeps whatever the build had
    expect(next.base.skillLevels.tuneBreak).toBe(base.base.skillLevels.tuneBreak)
  })

  it('keeps the synthesis rank the card cannot see when the weapon changes', () => {
    const weapon = listWpnsByTy(seed.weaponType).find((entry) => entry.id !== base.build.weapon.id)!
    const ranked: ResRuntime = {
      ...base,
      build: { ...base.build, weapon: { ...base.build.weapon, rank: 4 } },
    }
    const next = applyImprtRd(ranked, makeRead(weapon.id), [], {
      resonator: false,
      weapon: true,
      echoes: false,
    })

    expect(next.build.weapon.id).toBe(weapon.id)
    expect(next.build.weapon.level).toBe(90)
    expect(next.build.weapon.rank).toBe(4)
  })

  it('leaves the weapon alone when the card names one the catalog does not have', () => {
    const next = applyImprtRd(base, makeRead(null), [], {
      resonator: false,
      weapon: true,
      echoes: false,
    })

    expect(next.build.weapon).toEqual(base.build.weapon)
  })

  it('leaves the weapon alone when its type does not match the destination', () => {
    const otherSeed = listResSds().find((candidate) => candidate.weaponType !== seed.weaponType)!
    const weapon = listWpnsByTy(otherSeed.weaponType)[0]!
    const next = applyImprtRd(base, makeRead(weapon.id), [], {
      resonator: false,
      weapon: true,
      echoes: false,
    })

    expect(next.build.weapon).toEqual(base.build.weapon)
  })
})
