/*
  Author: Runor Ewhro
  Description: Verifies that OCR readings resolve to catalog identities,
               levels, skill levels, and contiguous sequence activation.
*/

import { describe, expect, it } from 'vitest'
import type { ResSeed } from '@/domain/entities/runtime'
import type { GenWpn } from '@/domain/entities/weapon'
import {
  resolveBuildScreenshotMetadata,
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
      player: { id: 'xuri', uid: '500395087' },
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

  it('does not count activated markers after the first inactive sequence', () => {
    const parsed = resolveBuildScreenshotMetadata(makeReadings({
      activeSequences: [true, true, false, true, true, true],
    }), { resonators, weapons })

    expect(parsed.resonator.sequence).toBe(2)
  })
})
