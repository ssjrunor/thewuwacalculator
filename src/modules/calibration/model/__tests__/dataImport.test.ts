/*
  Author: Runor Ewhro
  Description: Locks the off-thread import resolver to the same current and
               legacy persistence contracts used by the settings page.
*/

import { describe, expect, it } from 'vitest'
import { makeAppState } from '@/engine/runtime/defaults'
import { runDataImportJob } from '../dataImport'

describe('calibration data import jobs', () => {
  it('resolves a current snapshot supplied as transferred file bytes', async () => {
    const snapshot = makeAppState()
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).buffer
    const resolved = await runDataImportJob({
      kind: 'snapshot',
      source: { kind: 'bytes', bytes },
      currentState: snapshot,
    })

    expect(resolved.kind).toBe('snapshot')
    if (resolved.kind === 'snapshot') {
      expect(resolved.result.label).toBe('full snapshot')
      expect(resolved.result.snapshot).toEqual(snapshot)
    }
  })

  it('preserves the current state outside an imported settings slice', async () => {
    const currentState = makeAppState()
    const changedUi = {
      ...currentState.ui,
      compactInv: !currentState.ui.compactInv,
    }
    const raw = JSON.stringify({
      exportFormat: 'wwcalc-data',
      version: 1,
      kind: 'settings',
      exportedAt: '2026-09-15T00:00:00.000Z',
      data: { ui: changedUi },
    })
    const resolved = await runDataImportJob({
      kind: 'snapshot',
      source: { kind: 'text', raw },
      currentState,
    })

    expect(resolved.kind).toBe('snapshot')
    if (resolved.kind === 'snapshot') {
      expect(resolved.result.label).toBe('settings backup')
      expect(resolved.result.snapshot.ui.compactInv).toBe(changedUi.compactInv)
      expect(resolved.result.snapshot.combat).toEqual(currentState.combat)
      expect(resolved.result.snapshot.library).toEqual(currentState.library)
    }
  })
})
