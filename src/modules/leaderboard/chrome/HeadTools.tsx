/*
  Author: Runor Ewhro
  description: the leaderboard controls in the app header on every page: card
               submit (also U, or pasting a card link anywhere) and, for a
               signed-in account, the inbox bell with its unread count. the
               account button opens the sign-in window, and a sign-in returning
               from Discord or Google (?signin=) is reported here. it also syncs
               pins to the signed-in account.
*/

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, CircleUserRound, Upload } from 'lucide-react'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { isDtblVntTgt } from '@/shared/lib/isEditableEventTarget'
import { Tooltip } from '@/shared/ui/Tooltip'
import { syncPins } from '../model/pins'
import { looksLikeCard, noteViewerChanged, notify, openSignIn, openSubmit, useLbChrome, watchMe } from './chrome'

const InboxPop = lazy(async () => ({ default: (await import('./InboxPop')).InboxPop }))
const SignInWindow = lazy(async () => ({ default: (await import('./SignIn')).SignInWindow }))

const SIGNED: Record<string, [string, boolean]> = {
  ok: ['signed in! welcome back :P', false],
  denied: ['sign-in cancelled. you can try again whenever you like :P', true],
  failed: ["oopsies... sign-in didn't go through. try again? :(", true],
  suspended: ['this account is suspended. check your account standing for details and appeals.', true],
}

let handledReturn: string | null = null

/** a sign in back from the provider: say how it went, drop it from the address, and reload the viewer. */
function useSignInResult() {
  const location = useLocation()
  const navigate = useNavigate()
  const result = new URLSearchParams(location.search).get('signin')
  useEffect(() => {
    // one report per return: the effect can run twice before the address drops the result.
    if (!result || handledReturn === location.key) return
    handledReturn = location.key
    const params = new URLSearchParams(location.search)
    params.delete('signin')
    const said = SIGNED[result] ?? SIGNED.failed
    notify(...said)
    void noteViewerChanged()
    navigate({ pathname: result === 'suspended' ? `${APP_ROUTES.leaderboard}/me` : location.pathname, search: params.toString() }, { replace: true })
  }, [result, location.key, location.pathname, location.search, navigate])
}


export function LbHeadTools() {
  const me = useLbChrome((s) => s.me)
  const known = useLbChrome((s) => s.known)
  const signIn = useLbChrome((s) => s.signIn)
  const [signInAsked, setSignInAsked] = useState(signIn)
  if (signIn && !signInAsked) setSignInAsked(true)
  const [inbox, setInbox] = useState(false)
  useSignInResult()
  const anchor = useRef<HTMLDivElement>(null)
  const bell = useRef<HTMLButtonElement>(null)
  // mount on first open, then stay mounted so the popup can play its exit
  const [inboxAsked, setInboxAsked] = useState(false)
  if (inbox && !inboxAsked) setInboxAsked(true)

  useEffect(() => {
    // who is viewing, asked first on every page, then again each minute in view and when the tab is shown.
    watchMe()
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'u' && event.key !== 'U') return
      if (event.metaKey || event.ctrlKey || event.altKey || isDtblVntTgt(event.target)) return
      event.preventDefault()
      openSubmit()
    }
    const paste = (event: ClipboardEvent) => {
      if (isDtblVntTgt(event.target)) return
      const text = event.clipboardData?.getData('text') ?? ''
      if (!looksLikeCard(text)) return
      event.preventDefault()
      openSubmit(text.trim())
    }
    window.addEventListener('keydown', key)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('paste', paste)
    }
  }, [])

  // pins sync to the session's account; undefined until the service first responds
  const accountId = me ? me.account?.id ?? null : undefined
  useEffect(() => { if (accountId !== undefined) void syncPins(accountId) }, [accountId])

  const unread = me?.account?.unread.notifications ?? 0

  return (
    <>
      <Tooltip content="Submit a card (U)" placement="bottom">
        <button type="button" className="ax-g" aria-label="Submit a card" onClick={() => openSubmit()}>
          <Upload aria-hidden="true" />
        </button>
      </Tooltip>
      {me?.account ? (
        <div className="lbi-at" ref={anchor}>
          <Tooltip content="Inbox" placement="bottom">
            <button ref={bell} type="button" className={`ax-g${inbox ? ' is-open' : ''}`} aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'}
              aria-expanded={inbox} onClick={() => setInbox((v) => !v)}>
              <Bell aria-hidden="true" />
              {unread ? <span className="lbi-badge">{unread > 99 ? '99+' : unread}</span> : null}
            </button>
          </Tooltip>
          {inboxAsked ? <Suspense fallback={null}><InboxPop open={inbox} host={anchor} trigger={bell} onClose={() => setInbox(false)} /></Suspense> : null}
        </div>
      ) : null}
      {known ? (
        <Tooltip content={me?.account ? 'Your account' : 'Sign in'} placement="bottom">
          <button type="button" className={`ax-g${me?.account ? ' lbi-on' : ''}`} aria-label={me?.account ? 'Your account' : 'Sign in'} onClick={openSignIn}>
            <CircleUserRound aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
      {signInAsked ? <Suspense fallback={null}><SignInWindow /></Suspense> : null}
    </>
  )
}
