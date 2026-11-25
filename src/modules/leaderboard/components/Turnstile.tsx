/*
  Author: Runor Ewhro
  description: the cloudflare turnstile check required by every card submit and
               card login. the site key comes from VITE_TURNSTILE_SITE_KEY, and
               dev falls back to cloudflare's always-passing test key.
*/

import { useEffect, useRef } from 'react'

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const TEST_KEY = '1x00000000000000000000AA'
export const TURNSTILE_KEY: string | null = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? (import.meta.env.DEV ? TEST_KEY : null)

let loading: Promise<TurnstileApi> | null = null
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load'))
    script.onerror = () => { loading = null; reject(new Error('Turnstile did not load')) }
    document.head.appendChild(script)
  })
  return loading
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const report = useRef(onToken)
  useEffect(() => { report.current = onToken })
  useEffect(() => {
    if (!TURNSTILE_KEY) return
    let id: string | null = null
    let live = true
    void loadTurnstile().then((api) => {
      if (!live || !host.current) return
      id = api.render(host.current, {
        sitekey: TURNSTILE_KEY, theme: 'auto', size: 'flexible', appearance: 'interaction-only',
        callback: (token: string) => report.current(token),
        'expired-callback': () => report.current(null),
        'error-callback': () => report.current(null),
      })
    }).catch(() => report.current(null))
    return () => { live = false; if (id && window.turnstile) window.turnstile.remove(id) }
  }, [])
  return <div className="sbm-ts" ref={host} />
}
