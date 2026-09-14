/*
  Author: Runor Ewhro
  Description: Verifies the programOrder.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { orderStoredRotationProgram } from '@/engine/rotation/programOrder.ts'

describe('stored advanced-program ordering', () => {
  it('keeps an already ordered program by identity', () => {
    const items: RotationNode[] = [
      { id: 'setup', type: 'condition', editorSection: 'preamble', changes: [] },
      { id: 'hit', type: 'feature', featureId: 'hit' },
    ]
    expect(orderStoredRotationProgram(items)).toBe(items)
  })

  it('moves all preamble entries before Main while preserving each section order', () => {
    const items: RotationNode[] = [
      { id: 'main-a', type: 'feature', featureId: 'a' },
      { id: 'setup-a', type: 'condition', editorSection: 'preamble', changes: [] },
      { id: 'main-b', type: 'feature', featureId: 'b' },
      { id: 'setup-b', type: 'condition', editorSection: 'preamble', changes: [] },
    ]
    expect(orderStoredRotationProgram(items).map((item) => item.id))
      .toEqual(['setup-a', 'setup-b', 'main-a', 'main-b'])
  })
})
