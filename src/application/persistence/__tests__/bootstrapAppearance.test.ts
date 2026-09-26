/*
  Author: Runor Ewhro
  Description: Protects pre-app appearance restoration when startup fails.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPSTOREUIPP } from '@/application/persistence/storageKeys'
import { applyBootstrapAppearance } from '@/application/persistence/bootstrapAppearance'

function makeClasses() {
  const values = new Set<string>()
  return {
    values,
    add: (...names: string[]) => names.forEach((name) => values.add(name)),
    remove: (...names: string[]) => names.forEach((name) => values.delete(name)),
  }
}

describe('bootstrap appearance', () => {
  const storage = new Map<string, string>()
  const rootClasses = makeClasses()
  const bodyClasses = makeClasses()
  const properties = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    rootClasses.values.clear()
    bodyClasses.values.clear()
    properties.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null })
    vi.stubGlobal('document', {
      documentElement: {
        classList: rootClasses,
        style: { setProperty: (name: string, value: string) => properties.set(name, value) },
      },
      body: { classList: bodyClasses },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses the current appearance slice and chosen dark variant', () => {
    storage.set(APPSTOREUIPP, JSON.stringify({ ui: {
      theme: 'dark', themePreference: 'dark', darkVariant: 'cosmic-rainbow',
      blurMode: true, entranceAnimations: false,
    } }))
    bodyClasses.add('light', 'light-text')

    expect(applyBootstrapAppearance()).toBeNull()
    expect(rootClasses.values).toEqual(new Set([
      'cosmic-rainbow', 'dark-text', 'blur-off', 'no-entrance-anim', 'reduce-animation',
    ]))
    expect(bodyClasses.values.size).toBe(0)
  })

  it('restores the background image, color, and saved text mode', () => {
    storage.set(APPSTOREUIPP, JSON.stringify({ ui: {
      theme: 'background', themePreference: 'background',
      backgroundVariant: 'frosted-aurora',
      backgroundTextMode: 'light',
      backgroundImageKey: 'builtin:wallpaperflare8.jpg',
    } }))
    storage.set('user-bg-main-color', JSON.stringify('#aabbcc'))

    expect(applyBootstrapAppearance()).toBeNull()
    expect(rootClasses.values).toContain('frosted-aurora')
    expect(rootClasses.values).toContain('light-text')
    expect(properties.get('--bg-main-color')).toBe('#aabbcc')
    expect(properties.get('--background-wallpaper-image'))
      .toBe('url("/assets/app/backgrounds/wallpaperflare8-2560.webp")')
  })

  it('uses the current system preference even when the stored resolved mode is stale', () => {
    storage.set(APPSTOREUIPP, JSON.stringify({ ui: {
      theme: 'dark', themePreference: 'system', lightVariant: 'pastel-blue',
    } }))
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })

    applyBootstrapAppearance()

    expect(rootClasses.values).toContain('pastel-blue')
    expect(rootClasses.values).toContain('light-text')
  })
})
