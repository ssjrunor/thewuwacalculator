/*
  Author: Runor Ewhro
  Description: Provides Google Analytics helpers backed by the static gtag
               snippet in index.html.
*/

export const GOOGLE_ANALYTICS_MEASUREMENT_ID = 'G-W502BDD62S'

type GtagFn = (...args: unknown[]) => void

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: GtagFn
  }
}

function canUseDom(): boolean {
  return typeof window !== 'undefined'
    && typeof document !== 'undefined'
}

export function loadGoogleAnalytics(): Promise<boolean> {
  if (!canUseDom()) {
    return Promise.resolve(false)
  }

  return Promise.resolve(typeof window.gtag === 'function')
}

export async function trackGoogleAnalyticsPageView(input: {
  pagePath: string
  pageLocation: string
  pageTitle: string
}): Promise<void> {
  const loaded = await loadGoogleAnalytics()
  if (!loaded || typeof window.gtag !== 'function') {
    return
  }

  window.gtag('event', 'page_view', {
    page_path: input.pagePath,
    page_location: input.pageLocation,
    page_title: input.pageTitle,
  })
}
