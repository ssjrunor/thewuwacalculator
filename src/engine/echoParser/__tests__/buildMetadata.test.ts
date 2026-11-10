/*
  Author: Runor Ewhro
  description: verifies that ocr readings resolve to catalog identities,
               levels, skill levels, and contiguous sequence activation.
*/

import { describe, expect, it } from 'vitest'
import type { ResSeed } from '@/domain/entities/runtime'
import type { GenWpn } from '@/domain/entities/weapon'
import {
  ART_MARGIN,
  resolveBuildScreenshotMetadata,
  settleResonatorArt,
  settleWeapon,
  type RawBuildScreenshotReadings,
} from '@/engine/echoParser/buildMetadata'

const resonators = [
  { id: '1210', name: 'Aemeath', attribute: 'fusion', weaponType: 2 },
  { id: '1406', name: 'Rover: Aero', attribute: 'aero', weaponType: 2 },
  { id: '1408', name: 'Rover: Aero', attribute: 'aero', weaponType: 2 },
] as ResSeed[]

const weapons = [
  { id: '21020076', name: 'Everbright Polestar', weaponType: 2 },
  { id: '21020046', name: "Bloodpact's Pledge", weaponType: 2 },
] as GenWpn[]

function makeReadings(
    overrides: Partial<RawBuildScreenshotReadings> = {},
): RawBuildScreenshotReadings {
  return {
    playerIdText: 'Player ID:xuri',
    uidText: 'UID:500395087',
    resonatorNameText: 'Aemeath mw',
    resonatorLevelText: 'Ath LV.90 7',
    weaponNameText: 'Everbright Polestar',
    weaponLevelText: 'LV.90',
    skillLevelText: {
      normalAttack: 'Lv.1/10',
      resonanceLiberation: 'Lv.10/10',
      forteCircuit: 'Lv.10/10',
      introSkill: 'Lv.1/10',
      resonanceSkill: 'Lv.8/10',
    },
    attribute: 'fusion',
    activeSequences: [false, false, false, false, false, false],
    ...overrides,
  }
}

describe('build screenshot metadata', () => {
  it('resolves the Aemeath screenshot readings', () => {
    const parsed = resolveBuildScreenshotMetadata(makeReadings(), { resonators, weapons })

    expect(parsed).toEqual({
      player: { id: 'xuri', uid: '500395087', uidAgreed: false },
      resonator: {
        id: '1210',
        candidateIds: ['1210'],
        name: 'Aemeath',
        attribute: 'fusion',
        level: 90,
        sequence: 0,
        skillLevels: {
          normalAttack: 1,
          resonanceLiberation: 10,
          forteCircuit: 10,
          introSkill: 1,
          resonanceSkill: 8,
        },
      },
      weapon: {
        id: '21020076',
        name: 'Everbright Polestar',
        level: 90,
      },
    })
  })

  it('marks the uid agreed only when both complete reads match', () => {
    const read = (uidCheckText?: string) => resolveBuildScreenshotMetadata(
      makeReadings({ uidCheckText }), { resonators, weapons },
    ).player
    expect(read('500395087')).toEqual({ id: 'xuri', uid: '500395087', uidAgreed: true })
    // an incomplete check keeps the app's lenient uid but is not agreement
    expect(read('5003950')).toEqual({ id: 'xuri', uid: '500395087', uidAgreed: false })
    expect(read('500395081')).toEqual({ id: 'xuri', uid: null, uidAgreed: false })
  })

  it('reads past the label digit the digits-only check picks up', () => {
    const read = (uidText: string, uidCheckText: string) => resolveBuildScreenshotMetadata(
      makeReadings({ uidText, uidCheckText }), { resonators, weapons },
    ).player.uidAgreed
    // measured on real cards: the label's I comes back as a leading 1
    expect(read('UID:500395087', '1500395087')).toBe(true)
    expect(read('U1ID:904457107', '1904457107')).toBe(true)
    // the digits must still match the first read exactly
    expect(read('UID:500395087', '1500395081')).toBe(false)
    expect(read('UID:500395087', '15003950')).toBe(false)
  })

  it('uses the attribute to resolve Rover and preserves gender candidates', () => {
    const parsed = resolveBuildScreenshotMetadata(makeReadings({
      resonatorNameText: 'Rover',
      weaponNameText: 'Bloodpacts Pledge',
      attribute: 'aero',
      activeSequences: [true, true, true, true, true, true],
      skillLevelText: {
        normalAttack: 'Lv.1/10',
        resonanceLiberation: 'Lv.10/10',
        forteCircuit: 'Lv.10/10',
        introSkill: 'Lv.1/10',
        resonanceSkill: 'Lv.10/10',
      },
    }), { resonators, weapons })

    expect(parsed.resonator).toMatchObject({
      id: null,
      candidateIds: ['1406', '1408'],
      name: 'Rover: Aero',
      attribute: 'aero',
      sequence: 6,
    })
    expect(parsed.weapon).toEqual({
      id: '21020046',
      name: "Bloodpact's Pledge",
      level: 90,
    })
  })

  it('lets the read variant name outrank a misread Rover attribute', () => {
    const parsed = resolveBuildScreenshotMetadata(makeReadings({
      resonatorNameText: 'Rover: Electro',
      attribute: 'havoc',
    }), {
      resonators: [
        ...resonators,
        { id: '1604', name: 'Rover: Havoc', attribute: 'havoc', weaponType: 2 },
        { id: '1608', name: 'Rover: Electro', attribute: 'electro', weaponType: 2 },
      ] as ResSeed[],
      weapons,
    })

    expect(parsed.resonator).toMatchObject({ id: '1608', name: 'Rover: Electro' })
  })

  it('keeps a uid only when its two reads agree', () => {
    const settle = (uidText: string, uidCheckText?: string) => resolveBuildScreenshotMetadata(
      makeReadings({ uidText, uidCheckText }),
      { resonators, weapons },
    ).player.uid

    expect(settle('UID:500395087', '500395087')).toBe('500395087')
    expect(settle('UID:500395087', '500395081')).toBeNull()
    expect(settle('UID:5003 95087', '500395087')).toBe('500395087')
    expect(settle('UID:5003 95087', '5003')).toBeNull()
  })

  it('strips a misread player id label', () => {
    for (const playerIdText of ['Player 1D:xuri', 'Player I1D:xuri', 'Player ID:xuri']) {
      expect(resolveBuildScreenshotMetadata(
        makeReadings({ playerIdText }),
        { resonators, weapons },
      ).player.id).toBe('xuri')
    }
  })

  it('does not count activated markers after the first inactive sequence', () => {
    const parsed = resolveBuildScreenshotMetadata(makeReadings({
      activeSequences: [true, true, false, true, true, true],
    }), { resonators, weapons })

    expect(parsed.resonator.sequence).toBe(2)
  })
})

describe('art and icon matching', () => {
  const attributes: Record<string, 'aero' | 'havoc' | 'fusion'> = { 1406: 'aero', 1604: 'havoc', 1210: 'fusion' }
  const attributeOf = (id: string) => attributes[id] ?? null

  it('names a resonator from its portrait only well clear of the rest', () => {
    expect(settleResonatorArt([{ id: '1210', score: 20 }, { id: '1406', score: 60 }], ART_MARGIN.catalog, attributeOf, null)).toBe('1210')
    expect(settleResonatorArt([{ id: '1210', score: 20 }, { id: '1406', score: 24 }], ART_MARGIN.catalog, attributeOf, null)).toBeNull()
    expect(settleResonatorArt([], ART_MARGIN.catalog, attributeOf, null)).toBeNull()
  })

  it('splits shared rover art by the attribute icon, and only by it', () => {
    const ranks = [{ id: '1406', score: 20 }, { id: '1604', score: 20.4 }, { id: '1210', score: 70 }]
    expect(settleResonatorArt(ranks, ART_MARGIN.catalog, attributeOf, 'havoc')).toBe('1604')
    expect(settleResonatorArt(ranks, ART_MARGIN.catalog, attributeOf, null)).toBeNull()
  })

  it('takes the weapon from a clear icon over the name line', () => {
    const read = { id: null, name: 'Lux amp Umbra', level: 90 }
    expect(settleWeapon(read, [{ id: '21020046', score: 500 }, { id: '21020076', score: 4000 }], weapons))
      .toEqual({ id: '21020046', name: "Bloodpact's Pledge", level: 90 })
  })

  it('drops the escaped ampersand however it reads', () => {
    const lux = [...weapons, { id: '21050036', name: 'Lux & Umbra', weaponType: 5 }] as GenWpn[]
    for (const text of ['Lux amp: Umbra', 'Lux ampj Umbra', 'Lux &amp; Umbra']) {
      expect(resolveBuildScreenshotMetadata(makeReadings({ weaponNameText: text }), { resonators, weapons: lux }).weapon.name)
        .toBe('Lux & Umbra')
    }
  })

  it('keeps the name line when the icon is not clear', () => {
    const read = { id: '21020076', name: 'Everbright Polestar', level: 90 }
    expect(settleWeapon(read, [{ id: '21020046', score: 500 }, { id: '21020076', score: 600 }], weapons)).toBe(read)
  })
})
