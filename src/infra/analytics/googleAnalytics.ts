/*
  Author: Runor Ewhro
  Description: Lazily loads Google Analytics and provides manual page-view
               tracking helpers.
*/

export const GOOGLE_ANALYTICS_MEASUREMENT_ID = 'G-W502BDD62S'
const GOOGLE_ANALYTICS_SCRIPT_ID = 'wwcalc-google-analytics'

type GtagFn = (...args: unknown[]) => void

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: GtagFn
    __wwcalcGoogleAnalyticsLoadPromise__?: Promise<boolean>
  }
}

function canUseDom(): boolean {
  return typeof window !== 'undefined'
    && typeof document !== 'undefined'
}

function ensureGtagStub(): void {
  window.dataLayer = window.dataLayer ?? []
  window.gtag = window.gtag ?? ((...args: unknown[]) => {
    window.dataLayer?.push(args)
  })
}

function configureGoogleAnalytics(): void {
  if (typeof window.gtag !== 'function') {
    return
  }

  window.gtag('js', new Date())
  window.gtag('config', GOOGLE_ANALYTICS_MEASUREMENT_ID, {
    anonymize_ip: true,
    send_page_view: false,
  })
}

export function loadGoogleAnalytics(): Promise<boolean> {
  if (!canUseDom()) {
    return Promise.resolve(false)
  }

  if (window.__wwcalcGoogleAnalyticsLoadPromise__) {
    return window.__wwcalcGoogleAnalyticsLoadPromise__
  }

  ensureGtagStub()
  configureGoogleAnalytics()

  window.__wwcalcGoogleAnalyticsLoadPromise__ = new Promise<boolean>((resolve) => {
    const existing = document.getElementById(GOOGLE_ANALYTICS_SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve(true)
        return
      }

      existing.addEventListener('load', () => {
        existing.dataset.loaded = 'true'
        resolve(true)
      }, { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = GOOGLE_ANALYTICS_SCRIPT_ID
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_MEASUREMENT_ID}`
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true'
      resolve(true)
    }, { once: true })
    script.addEventListener('error', () => resolve(false), { once: true })
    document.head.appendChild(script)
  })

  return window.__wwcalcGoogleAnalyticsLoadPromise__
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
