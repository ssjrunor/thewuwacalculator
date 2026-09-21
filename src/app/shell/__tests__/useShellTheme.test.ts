/*
  Author: Runor Ewhro
  Description: Protects the persistent shell selector from returning nested
               allocations that invalidate Zustand snapshots on every read.
*/

import { describe, expect, it } from 'vitest'
import { shallow } from 'zustand/vanilla/shallow'
import { useAppStore } from '@/application/state'
import { selectShellTheme } from '@/app/shell/useShellTheme.ts'

describe('selectShellTheme', () => {
  it('returns a shallow-stable snapshot for unchanged app state', () => {
    const state = useAppStore.getState()
    const first = selectShellTheme(state)
    const second = selectShellTheme(state)

    expect(shallow(first, second)).toBe(true)
    expect(Object.values(first).every((value) => typeof value !== 'object')).toBe(true)
  })
})
