/*
  Author: Runor Ewhro
  Description: Protects cross-link navigation ordering and retryable route
               chunks, the two contracts hidden behind page transitions.
*/

import { describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { createNavigationIntentTracker } from '@/shared/navigation/useNavX'
import { createRouteChunk } from '@/shared/navigation/routeChunk'

describe('navigation intent ordering', () => {
  it('allows only the newest navigation request to commit', () => {
    const tracker = createNavigationIntentTracker()
    const first = tracker.begin()
    const second = tracker.begin()

    expect(tracker.isCurrent(first)).toBe(false)
    expect(tracker.isCurrent(second)).toBe(true)
  })
})

describe('route chunk loading', () => {
  it('shares an in-flight request', async () => {
    let resolveLoad!: (component: ComponentType<object>) => void
    const load = vi.fn(() => new Promise<ComponentType<object>>((resolve) => {
      resolveLoad = resolve
    }))
    const route = createRouteChunk(load)

    const first = route.warm()
    const second = route.warm()
    expect(load).toHaveBeenCalledTimes(1)

    resolveLoad(() => null)
    await Promise.all([first, second])
    expect(route.isWarm()).toBe(true)
  })

  it('releases a failed request so a later intent can retry', async () => {
    const Page = () => null
    const load = vi.fn<() => Promise<ComponentType<object>>>()
      .mockRejectedValueOnce(new Error('stale deployment chunk'))
      .mockResolvedValueOnce(Page)
    const route = createRouteChunk(load)

    await expect(route.warm()).rejects.toThrow('stale deployment chunk')
    expect(route.isWarm()).toBe(false)

    await expect(route.warm()).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
    expect(route.isWarm()).toBe(true)
  })
})
