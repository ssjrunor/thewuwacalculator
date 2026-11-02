/*
  Author: Runor Ewhro
  description: tests stat recognition against printed names, legal rolls, and common ocr errors.
*/

import { describe, expect, it } from 'vitest'
import {
  costForMain,
  namesMain,
  namesSubstat,
  readSubstat,
  readSubstats,
  resolveMainByValue,
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

  it('forgives a letter slip in a long label', () => {
    expect(readSubstat('Crit. MG 17.4%')).toMatchObject({ key: 'critDmg', value: 17.4 })
    expect(readSubstat('Enengy Regen 9.2%')).toMatchObject({ key: 'energyRegen', value: 9.2 })
  })

  it('leaves a short label read with a slip to the ink-shape reader', () => {
    expect(readSubstat('AK 40')).toBeNull()
    expect(readSubstat('DE 50')).toBeNull()
    expect(namesSubstat('DE')).toBe(false)
    expect(namesSubstat('DEF')).toBe(true)
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

  it('never names an unreadable label from its number', () => {
    expect(readSubstat('## 430')).toBeNull()
    expect(readSubstat('## 13.8%')).toBeNull()
  })

  it('snaps only a read that sits beside one roll', () => {
    expect(readSubstat('Crit. Rate 8.2%')).toMatchObject({ key: 'critRate', value: 8.1, fix: 'snapped' })
    // the midpoint between legal rolls is not accepted.
    expect(readSubstat('Crit. Rate 8.4%')).toBeNull()
  })

  it('reads a merged glyph as one slip', () => {
    expect(readSubstat('Cnt. DMG', '18.6%')).toMatchObject({ key: 'critDmg', value: 18.6, fix: 'exact' })
  })

  it('takes a worn label only with an exact roll of its one stat', () => {
    expect(readSubstat('Cnt. OMG', '12.6%')).toMatchObject({ key: 'critDmg', value: 12.6, looseLabel: true })
    expect(readSubstat('Cnt. OMG', '12.9%')).toBeNull()
  })

  it('never snaps a flat stat', () => {
    expect(readSubstat('ATK 45')).toBeNull()
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

  it('refuses a short label read with a slip, which noise also produces', () => {
    expect(resolveMainKey('Cot hE', 4)).toBeNull()
    expect(resolveMainKey('at', 3)).toBeNull()
    expect(resolveMainKey('Crit DMC', 4)).toBe('critDmg')
  })

  it('names the cost a main stat belongs to, when only one can carry it', () => {
    expect(costForMain('Electro DMG Bonus')).toBe(3)
    expect(costForMain('Crit. DMG')).toBe(4)
    expect(costForMain('ATK')).toBeNull()
  })

  it('knows a main stat label at any cost', () => {
    expect(namesMain('Crit. DMG')).toBe(true)
    expect(namesMain('Havoc DMG Bonus')).toBe(true)
    expect(namesMain('Cot hE')).toBe(false)
  })
})

describe('main stat by its printed value', () => {
  it.each([
    ['44', 4, 'critDmg'],
    ['22%', 4, 'critRate'],
    ['41.5', 4, 'defPercent'],
    ['26.0%', 4, 'healingBonus'],
    ['32', 3, 'energyRegen'],
    ['38', 3, 'defPercent'],
    ['22.8', 1, 'hpPercent'],
  ])('settles %s on a %i-cost echo', (value, cost, key) => {
    expect(resolveMainByValue('', value, cost)).toBe(key)
  })

  it('lets a loose label choose among mains that share the value', () => {
    expect(resolveMainByValue('Havc DMG Bnus', '30', 3)).toBe('havoc')
    expect(resolveMainByValue('AK', '18', 1)).toBe('atkPercent')
    expect(resolveMainByValue('Cot hE', '33', 4)).toBe('hpPercent')
  })

  it('leaves a shared value unsettled without a label', () => {
    expect(resolveMainByValue('', '30', 3)).toBeNull()
    expect(resolveMainByValue('', '33', 4)).toBeNull()
  })

  it('refuses a value the cost cannot carry', () => {
    expect(resolveMainByValue('', '44', 3)).toBeNull()
    expect(resolveMainByValue('', '', 4)).toBeNull()
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

describe('a stray word from the row above', () => {
  it('still reads the label it belongs to', () => {
    expect(readSubstat('ATK Lad dh', '10.1%')).toMatchObject({ key: 'atkPercent', value: 10.1 })
    expect(readSubstat('Bonus HP', '7.9%')).toMatchObject({ key: 'hpPercent', value: 7.9 })
  })

  it('does not invent a stat out of the stray word alone', () => {
    expect(readSubstat('Lad dh', '10.1%')).toBeNull()
  })
})
