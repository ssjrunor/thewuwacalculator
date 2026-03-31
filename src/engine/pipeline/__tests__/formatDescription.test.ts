import { describe, expect, it } from 'vitest'
import { formatDescription, formatDescriptionText } from '@/shared/lib/formatDescription'

describe('formatDescription', () => {
  it('preserves bold markup as highlight spans and injects params', () => {
    const result = formatDescription(
      '<span class="font-bold">Intro</span><br/>Deals {0} damage to Spectro Frazzle.',
      ['120%'],
    )

    expect(result).toContain('<span class="highlight">Intro</span>')
    expect(result).toContain('<strong class="highlight">120%</strong>')
    expect(result).toContain('color: rgb(202,179,63); font-weight: bold;')
  })

  it('formats plain-text tooltip output', () => {
    const result = formatDescriptionText(
      '<strong>Hold</strong><br/>Use {Cus:Ipt,Touch=Tap PC=Click Gamepad=Click}.',
      [],
    )

    expect(result).toContain('Hold')
    expect(result).toContain('Tap/Click')
    expect(result).not.toContain('<')
  })

  it('highlights element phrases and custom keywords using the original text rules', () => {
    const result = formatDescription(
      'Gain Aero DMG Bonus and reduce Aero RES by 10% during Judgment Tempest.',
      [],
      '#888',
      { extraKeywords: ['Judgment Tempest'] },
    )

    expect(result).toContain('<strong style="color: rgb(15,205,160); font-weight: bold;">Aero DMG Bonus</strong>')
    expect(result).toContain('<strong style="color: rgb(15,205,160); font-weight: bold;">Aero RES</strong>')
    expect(result).toContain('<strong class="highlight">10%</strong>')
    expect(result).toContain('<strong class="highlight">Judgment Tempest</strong>')
  })
})
