/*
  Author: Runor Ewhro
  Description: defers expensive UI work until a page has stopped changing and
               the browser has an idle slice available.
*/

export interface SettledScheduleOptions {
  settleDelayMs?: number
  idleTimeoutMs?: number
}

export function scheduleAfterSettled(
  callback: () => void,
  {
    settleDelayMs = 220,
    idleTimeoutMs = 500,
  }: SettledScheduleOptions = {},
): () => void {
  if (typeof window === 'undefined') {
    callback()
    return () => undefined
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }
  let settleTimer: number | null = null
  let idleHandle: number | null = null
  let fallbackTimer: number | null = null
  let cancelled = false

  // The idle callback can race with cleanup in a concurrent render.
  const guarded = () => {
    if (!cancelled) callback()
  }

  settleTimer = window.setTimeout(() => {
    settleTimer = null
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(guarded, { timeout: idleTimeoutMs })
      return
    }
    fallbackTimer = window.setTimeout(guarded, 32)
  }, settleDelayMs)

  const cancel = () => {
    cancelled = true
    if (settleTimer != null) window.clearTimeout(settleTimer)
    if (idleHandle != null) idleWindow.cancelIdleCallback?.(idleHandle)
    if (fallbackTimer != null) window.clearTimeout(fallbackTimer)
    settleTimer = null
    idleHandle = null
    fallbackTimer = null
  }

  return cancel
}
