/*
  Author: Runor Ewhro
  Description: Simulates the browser flow for locking a main echo through
               the store. Confirms updOptSets persists lockedMainEchoId and
               that selOptCtx reads back the change so the chip would see
               the locked echo.
*/

import { describe, expect, it } from 'vitest'
import { useAppStore } from '@/domain/state/store'
import { selOptCtx } from '@/domain/state/selectors'
import { getEchoById } from '@/domain/services/echoCatalogService'

const LUCY = '1511'
const TARGET = '6000201'

function setActResonator(resId: string) {
  const state = useAppStore.getState()
  state.swRes(resId)
}

describe('main-echo lock store roundtrip', () => {
  it('persists lockedMainEchoId via updOptSets and reads it back', () => {
    setActResonator(LUCY)

    // mimic the useEffect that runs on optimizer mount
    useAppStore.getState().ensureOptimizer()

    const before = selOptCtx(useAppStore.getState())
    expect(before?.resonatorId).toBe(LUCY)
    expect(before?.settings.lockedMainEchoId).toBeNull()

    // simulate the EchoPicker onSelect → updOptSets path
    useAppStore.getState().updOptSets((settings) => ({
      ...settings,
      lockedMainEchoId: TARGET,
    }))

    const after = selOptCtx(useAppStore.getState())
    expect(after?.settings.lockedMainEchoId).toBe(TARGET)

    // the chip's selMainEchoF derives from this + getEchoById; verify the
    // catalog lookup also succeeds so the chip would actually render the
    // locked variant rather than falling back to null.
    const echo = getEchoById(TARGET)
    expect(echo).not.toBeNull()
    expect(echo?.id).toBe(TARGET)
  })

  it('survives an ensureOptimizer re-run (mimics actResId-change useEffect)', () => {
    setActResonator(LUCY)
    useAppStore.getState().ensureOptimizer()
    useAppStore.getState().updOptSets((settings) => ({
      ...settings,
      lockedMainEchoId: TARGET,
    }))

    // ensureOptimizer fires again whenever actResId changes; verify it preserves
    // the lock (getSyncOptCt returns the existing context when ids match).
    useAppStore.getState().ensureOptimizer()

    const after = selOptCtx(useAppStore.getState())
    expect(after?.settings.lockedMainEchoId).toBe(TARGET)
  })
})
