/*
  Author: Runor Ewhro
  Description: Verifies the skillDisplay.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import { skillDisplayColor } from '@/modules/simulation/features/rotation/shared/skillDisplay.ts'

describe('skillDisplayColor', () => {
  it.each([
    ['healing', 'var(--calc-support-healing-color)'],
    ['shield', 'var(--calc-support-shield-color)'],
  ] as const)('uses the %s support color before the skill element', (aggregationType, expected) => {
    expect(skillDisplayColor({aggregationType, element: 'fusion'})).toBe(expected)
  })

  it('uses the skill element for damage skills', () => {
    expect(skillDisplayColor({aggregationType: 'damage', element: 'fusion'})).toBe('#f0734d')
  })
})
