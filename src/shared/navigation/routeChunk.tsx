/*
  Author: Runor Ewhro
  Description: Retryable lazy component primitive shared by route owners.
*/

import { createElement } from 'react'
import type { ComponentType } from 'react'

export interface RouteChunk<P> {
  Mount: ComponentType<P>
  warm: () => Promise<void>
  isWarm: () => boolean
}

export function createRouteChunk<P extends object>(load: () => Promise<ComponentType<P>>): RouteChunk<P> {
  let loaded: ComponentType<P> | null = null
  let pending: Promise<void> | null = null

  const warm = () => {
    if (loaded) return Promise.resolve()
    pending ??= load()
      .then((component) => {
        loaded = component
      })
      .catch((error: unknown) => {
        pending = null
        throw error
      })
    return pending
  }

  function Mount(props: P) {
    if (!loaded) throw warm()
    return createElement(loaded, props)
  }

  return { Mount, warm, isWarm: () => loaded !== null }
}
