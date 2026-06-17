import { describe, expect, it } from 'vitest'
import { fmtDscr, fmtDscrText } from '@/shared/lib/formatDescription'
import { ATTR_COLORS } from '@/modules/calculator/model/display'

describe('formatDescription', () => {
  it('preserves bold markup as highlight spans and injects params', () => {
    const result = fmtDscr(
      '<span class="font-bold">Intro</span><br/>Deals {0} damage to Spectro Frazzle.',
      ['120%'],
    )

    expect(result).toContain('<span class="highlight">Intro</span>')
    expect(result).toContain('<strong class="highlight">120%</strong>')
    expect(result).toContain(`color: ${ATTR_COLORS.spectro}; font-weight: bold;`)
  })

  it('formats plain-text tooltip output', () => {
    const result = fmtDscrText(
      '<strong>Hold</strong><br/>Use {Cus:Ipt,Touch=Tap PC=Click Gamepad=Click}.',
      [],
    )

    expect(result).toContain('Hold')
    expect(result).toContain('Tap/Click')
    expect(result).not.toContain('<')
  })

  it('cleans stale Nanoka color tag residue', () => {
    const result = fmtDscrText(
      'While casting this skill, consume all color=Highlight>Stillness</span> and enter color=Highlight>Cleansing Rain</span>.',
    )

    expect(result).toBe('While casting this skill, consume all Stillness and enter Cleansing Rain.')
    expect(result).not.toContain('color=Highlight>')
    expect(result).not.toContain('</span>')
  })

  it('highlights element phrases and custom keywords using the original text rules', () => {
    const result = fmtDscr(
      'Gain Aero DMG Bonus and reduce Aero RES by 10% during Judgment Tempest.',
      [],
      '#888',
      { xtrKywr: ['Judgment Tempest'] },
    )

    expect(result).toContain(`<strong style="color: ${ATTR_COLORS.aero}; font-weight: bold;">Aero DMG Bonus</strong>`)
    expect(result).toContain(`<strong style="color: ${ATTR_COLORS.aero}; font-weight: bold;">Aero RES</strong>`)
    expect(result).toContain('<strong class="highlight">10%</strong>')
    expect(result).toContain('<strong class="highlight">Judgment Tempest</strong>')
  })

  it('keeps fixed elemental status damage phrases in the element color', () => {
    const result = fmtDscr(
      'glacio bite dmg is increased.',
      [],
      '#888',
      { xtrKywr: ['dmg'] },
    )

    expect(result).toContain(
      `<strong style="color: ${ATTR_COLORS.glacio}; font-weight: bold;">glacio bite dmg</strong>`,
    )
    expect(result).not.toContain('<strong class="highlight">dmg</strong>')
  })

  it('removes generic highlight wrappers around fixed elemental status damage phrases', () => {
    const result = fmtDscr(
      '<span class="font-bold">Glacio Bite</span> <span class="font-bold">DMG</span> is increased.',
    )

    expect(result).toContain(
      `<strong style="color: ${ATTR_COLORS.glacio}; font-weight: bold;">Glacio Bite DMG</strong>`,
    )
    expect(result).not.toContain('<span class="highlight">Glacio Bite</span>')
    expect(result).not.toContain('<span class="highlight">DMG</span>')
  })
})
