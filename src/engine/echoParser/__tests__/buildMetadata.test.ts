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
  settleZhName,
  smallKana,
  tidyName,
  trustName,
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
    // an incomplete check retains the app's lenient uid without marking agreement
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

  it('ranks the read variant name over a misread Rover attribute', () => {
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

  it('accepts a uid only when its two reads agree', () => {
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

  it('marks an icon that overrode a different name match', () => {
    const read = { id: '21020076', name: 'Everbright Polestar', level: 90 }
    expect(settleWeapon(read, [{ id: '21020046', score: 500 }, { id: '21020076', score: 4000 }], weapons))
      .toEqual({ id: '21020046', name: "Bloodpact's Pledge", level: 90, iconOverrode: true })
    const same = { id: '21020046', name: "Bloodpact's Pledge", level: 90 }
    expect(settleWeapon(same, [{ id: '21020046', score: 500 }, { id: '21020076', score: 4000 }], weapons)).toEqual(same)
  })

  it('uses the name line when the icon is not clear', () => {
    const read = { id: '21020076', name: 'Everbright Polestar', level: 90 }
    expect(settleWeapon(read, [{ id: '21020046', score: 500 }, { id: '21020076', score: 600 }], weapons)).toBe(read)
  })
})

describe('player name trust', () => {
  it('retains a full-size card\'s marks', () => {
    expect(trustName('~Marmalade~', false)).toBe('~Marmalade~')
    expect(trustName('Chinatsu.', false)).toBe('Chinatsu.')
  })

  it('leaves a shrunk card\'s name blank when a mark sits at either end', () => {
    expect(trustName('~Marmalade-', true)).toBeNull()
    expect(trustName('-TETHYS-C3FM', true)).toBeNull()
    expect(trustName('Chinatsu.', true)).toBeNull()
  })

  it('retains a shrunk card\'s name with marks only inside it', () => {
    expect(trustName('TETHYS-C3FM', true)).toBe('TETHYS-C3FM')
    expect(trustName('xuri', true)).toBe('xuri')
    expect(trustName(null, true)).toBeNull()
  })
})

// reads the three models returned on the local leaderboard's chinese cards
describe('chinese card names', () => {
  const vote = (english: string[], chinese: [string, string], japanese: string) => settleZhName({ english, chinese, japanese })

  it('retains a space only between latin letters or digits', () => {
    expect(tidyName(' Dan  Heng ')).toBe('Dan Heng')
    expect(tidyName('本 源 之 心')).toBe('本源之心')
    expect(tidyName('老婆 <3')).toBe('老婆<3')
  })

  it('confirms a latin name two models read alike, in the english letters', () => {
    expect(vote(['Kazusa0l', 'Kazusa0l', 'Kazusa0l'], ['Kazusa01', 'KazuSsa01'], 'Kazusa01')).toEqual({ name: 'Kazusa01', confirmed: false, askGreek: false })
    expect(vote(['Tielle', 'Tielle', 'Tielle'], ['Tiellte', 'Tielle'], 'Tielle')).toEqual({ name: 'Tielle', confirmed: true, askGreek: false })
    expect(vote(['Beboo.', 'Beboo', 'Beboo'], ['Beboo', 'Bebog'], 'Bebodi')).toEqual({ name: 'Beboo', confirmed: true, askGreek: false })
    expect(vote(['sito', 'sito', 'sito'], ['Sito', 'Sito'], 'sito').name).toBe('sito')
    expect(vote(['Dan Heng', 'Dan Heng', 'Dan Heng'], ['Dan Heng', 'Dan Heng'], 'Dan Heng').name).toBe('Dan Heng')
  })

  it('leaves names in chinese characters unconfirmed, even when two models agree', () => {
    // both read the rare "暝" as "暖"
    expect(vote(['BRAY', 'BRAY', 'BRAY'], ['暖 紋', '蝦 紋'], '暖 紋')).toEqual({ name: '暖紋', confirmed: false, askGreek: false })
    expect(vote(['173', '173', ''], ['灰', '灰'], 'リツ')).toEqual({ name: '灰', confirmed: false, askGreek: false })
  })

  it('takes kana from the japanese model when the chinese one cannot resolve it', () => {
    expect(vote(['yOv k', 'ely bk', 'yay bk'], ['鎊 銜 兒 口 導 上', '錠 和 悶 兒 口 層 下'], 'シャ ル ロ ッ ト').name).toBe('シャルロット')
    expect(vote(['Doggy F', 'Doggy F', 'Doggy FF'], ['Doggy 下 十', 'Doggy 下 竺'], 'Doggy ド キ').name).toBe('Doggyドキ')
  })

  it('drops a lone english read the chinese model did not see as latin', () => {
    expect(vote(['ER', '', ''], ['', ''], '').name).toBe('')
    expect(vote(['2', '', 'EE'], ['', '墨 管'], '').name).toBe('墨管')
    expect(vote(['', 'bd', 'bd'], ['7', '自'], 'テッ')).toEqual({ name: '自', confirmed: false, askGreek: false })
  })

  it('runs the greek model only when the latin reads share little', () => {
    expect(vote(['Nea', 'Nea', 'Nea'], ['Aaet', 'AaeQ'], 'ハ asa')).toEqual({ name: 'Nea', confirmed: false, askGreek: true })
    expect(vote(['OhMyJ4rJer', 'OhMyJdrJer', 'OhMyJ4rJer'], ['OhMyJrJer', 'OhMyJArJer'], 'OhMyJarJer')).toEqual({ name: 'OhMyJ4rJer', confirmed: false, askGreek: false })
  })
})

// cell ink heights measured on the local leaderboard's japanese cards
describe('small kana', () => {
  it('sets a kana well short of the line to its small form', () => {
    expect(smallKana('ひいちゃ', [14, 9, 15, 13])).toBe('ひぃちゃ')
  })

  it('retains a full kana a little short of the line', () => {
    expect(smallKana('あいにゃす', [15, 13, 15, 13, 15])).toBe('あいにゃす')
    expect(smallKana('どらぐん', [15, 15, 15, 15])).toBe('どらぐん')
  })

  it('leaves a name that does not fit the cells unchanged', () => {
    expect(smallKana('ひいちゃ', [])).toBe('ひいちゃ')
    expect(smallKana('Ponsan', [14, 9, 9, 9, 9, 9])).toBe('Ponsan')
  })
})
