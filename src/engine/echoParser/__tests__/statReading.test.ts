/*
  Author: Runor Ewhro
  Description: Holds the stat reader to the card's printed names and legal
               rolls, over clean lines and the misreads OCR actually makes.
*/

import { describe, expect, it } from 'vitest'
import {
  costForMain,
  readSubstat,
  readSubstats,
  resolveMainKey,
} from '@/engine/echoParser/statReading'

describe('substat lines', () => {
  it.each([
    ['Crit. Rate 8.1%', 'critRate', 8.1],
    ['Crit. DMG 19.8%', 'critDmg', 19.8],
    ['ATK 40', 'atkFlat', 40],
    ['ATK 10.1%', 'atkPercent', 10.1],
    ['HP 320', 'hpFlat', 320],
    ['HP 6.4%', 'hpPercent', 6.4],
    ['DEF 50', 'defFlat', 50],
    ['DEF 9%', 'defPercent', 9],
    ['Energy Regen 10%', 'energyRegen', 10],
    ['Basic Attack DMG Bonus 9.4%', 'basicAtk', 9.4],
    ['Heavy Attack DMG Bonus 7.9%', 'heavyAtk', 7.9],
  ])('reads %s', (row, key, value) => {
    expect(readSubstat(row)).toMatchObject({ key, value, fix: 'exact' })
  })

  it('keeps a wrapped label whose second line lands after the number', () => {
    expect(readSubstat('Resonance Liberation 8.6% DMG Bonus')).toMatchObject({ key: 'resonanceLiberation', value: 8.6 })
    expect(readSubstat('Resonance Skill DMG 10.9% Bonus a')).toMatchObject({ key: 'resonanceSkill', value: 10.9 })
  })

  it('keeps a wrapped label that lost its second line', () => {
    expect(readSubstat('Resonance Skill DMG 7.9%')).toMatchObject({ key: 'resonanceSkill', value: 7.9 })
  })

  it('forgives a letter slip in the label', () => {
    expect(readSubstat('AK 40')).toMatchObject({ key: 'atkFlat', value: 40 })
    expect(readSubstat('Crit. MG 17.4%')).toMatchObject({ key: 'critDmg', value: 17.4 })
    expect(readSubstat('Enengy Regen 9.2%')).toMatchObject({ key: 'energyRegen', value: 9.2 })
  })

  it('never lets a short name drift into another short name', () => {
    expect(readSubstat('HP 470')?.key).toBe('hpFlat')
    expect(readSubstat('DEF 60')?.key).toBe('defFlat')
  })

  it('corrects a 7 read as a 1', () => {
    expect(readSubstat('Crit. Rate 1.5%')).toMatchObject({ key: 'critRate', value: 7.5, fix: 'corrected' })
  })

  it('corrects a dropped decimal point', () => {
    expect(readSubstat('Crit. DMG 186%')).toMatchObject({ key: 'critDmg', value: 18.6, fix: 'corrected' })
  })

  it('decides flat or percent by the roll when the % sign is lost', () => {
    expect(readSubstat('ATK 8.6')).toMatchObject({ key: 'atkPercent', value: 8.6 })
    expect(readSubstat('DEF 10')).toMatchObject({ key: 'defPercent', value: 10 })
  })

  it('names an unreadable label only when one stat can roll the number', () => {
    expect(readSubstat('## 430')).toMatchObject({ key: 'hpFlat', value: 430 })
    expect(readSubstat('## 13.8%')).toBeNull()
  })

  it('snaps a number no single slip explains, and says so', () => {
    expect(readSubstat('Crit. Rate 8.4%')).toMatchObject({ key: 'critRate', fix: 'snapped' })
  })

  it('ignores a line with no number', () => {
    expect(readSubstat('Crit. Rate')).toBeNull()
    expect(readSubstat('')).toBeNull()
  })

  it('keeps the better of two readings of one stat', () => {
    expect(readSubstats(['Crit. Rate 8.4%', 'Crit. Rate 8.1%'])).toEqual({ critRate: 8.1 })
  })
})

describe('main stat', () => {
  it.each([
    ['Crit. DMG', 4, 'critDmg'],
    ['Crit. Rate', 4, 'critRate'],
    ['Healing Bonus', 4, 'healingBonus'],
    ['Havoc DMG Bonus', 3, 'havoc'],
    ['Energy Regen', 3, 'energyRegen'],
    ['ATK', 3, 'atkPercent'],
    ['HP', 1, 'hpPercent'],
    ['DEF', 1, 'defPercent'],
  ])('reads %s on a %i-cost echo', (label, cost, key) => {
    expect(resolveMainKey(label, cost)).toBe(key)
  })

  it('refuses a main stat the cost cannot carry', () => {
    expect(resolveMainKey('Electro DMG Bonus', 4)).toBeNull()
    expect(resolveMainKey('Crit. Rate', 1)).toBeNull()
  })

  it('refuses noise', () => {
    expect(resolveMainKey('blag', 1)).toBeNull()
  })

  it('names the cost a main stat belongs to, when only one can carry it', () => {
    expect(costForMain('Electro DMG Bonus')).toBe(3)
    expect(costForMain('Crit. DMG')).toBe(4)
    expect(costForMain('ATK')).toBeNull()
  })
})

describe('substat lines read in two halves', () => {
  it('takes the number from its own read', () => {
    expect(readSubstat('Energy Regen', '10.8%')).toMatchObject({ key: 'energyRegen', value: 10.8, fix: 'exact' })
    expect(readSubstat('DEF', '60')).toMatchObject({ key: 'defFlat', value: 60 })
  })

  it('keeps a wrapped label whole', () => {
    expect(readSubstat('Resonance Liberation DMG Bonus', '8.6%')).toMatchObject({ key: 'resonanceLiberation', value: 8.6 })
  })

  it('falls back on a number inside the label when its own read is empty', () => {
    expect(readSubstat('Crit. DMG 21%', '')).toMatchObject({ key: 'critDmg', value: 21 })
  })
})
