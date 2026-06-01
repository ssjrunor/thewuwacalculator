import { describe, expect, it } from 'vitest'
import { skillTab } from '@/modules/calculator/features/main/lib/skillData.ts'

describe('skillTab', () => {
  it('uses a direct resonator skill tab when present', () => {
    const result = skillTab(
      {
        skill: {
          tab: 'resonanceSkill',
          skillType: ['resonanceSkill'],
        },
      } as never,
      {
        skillsByTab: {
          resonanceSkill: { id: 'skill' },
        },
      } as never,
    )

    expect(result).toBe('resonanceSkill')
  })

  it('maps combo rows back to normal attack skill data', () => {
    const result = skillTab(
      {
        skill: {
          tab: 'combo',
          skillType: ['basicAtk'],
        },
      } as never,
      {
        skillsByTab: {
          normalAttack: { id: 'normal' },
        },
      } as never,
    )

    expect(result).toBe('normalAttack')
  })

  it('returns null when no matching skill-data tab exists', () => {
    const result = skillTab(
      {
        skill: {
          tab: 'echoAttacks',
          skillType: ['echoSkill'],
        },
      } as never,
      {
        skillsByTab: {},
      } as never,
    )

    expect(result).toBeNull()
  })
})
