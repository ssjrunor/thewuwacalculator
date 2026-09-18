/*
  Author: Runor Ewhro
  Description: Verifies beta acknowledgement survives reloads and expires daily.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeBetaNotice,
  isBetaNoticeAcknowledgedToday,
} from '../betaNotice'

describe('daily beta notice acknowledgement', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires acknowledgement on a first visit and remembers it across reloads', async () => {
    const morning = new Date(2026, 8, 18, 9)
    expect(isBetaNoticeAcknowledgedToday(morning)).toBe(false)

    acknowledgeBetaNotice(morning)
    vi.resetModules()
    const reloaded = await import('../betaNotice')

    expect(reloaded.isBetaNoticeAcknowledgedToday(new Date(2026, 8, 18, 23, 59))).toBe(true)
  })

  it('expires at local midnight, including across a year boundary', () => {
    acknowledgeBetaNotice(new Date(2026, 11, 31, 23, 59))

    expect(isBetaNoticeAcknowledgedToday(new Date(2027, 0, 1, 0, 0))).toBe(false)
    acknowledgeBetaNotice(new Date(2027, 0, 1, 0, 1))
    expect(isBetaNoticeAcknowledgedToday(new Date(2027, 0, 1, 12))).toBe(true)
  })

  it('does not treat an invalid stored value as acknowledgement', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'invalid-date' })
    expect(isBetaNoticeAcknowledgedToday()).toBe(false)
  })

  it('allows acknowledgement when browser storage is blocked', () => {
    const blocked = () => { throw new Error('Storage blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })

    expect(isBetaNoticeAcknowledgedToday()).toBe(false)
    expect(() => acknowledgeBetaNotice()).not.toThrow()
  })
})
