/*
  Author: Runor Ewhro
  description: the sign-in modal: Discord or Google sign-in, uid claims and linked logins.
*/

import { useEffect, useState } from 'react'
import { CreditCard, LogOut, X } from 'lucide-react'
import type { LoginProvider, MeResponse } from '@/domain/leaderboard/api'
import { errorText } from '../model/cardTrack'
import { fmtUid } from '../model/listed'
import { TURNSTILE_KEY, Turnstile } from '../components/Turnstile'
import { lbApi } from '../api/client'
import { closeSignIn, noteViewerChanged, notify, useLbChrome } from './chrome'
import { LbModal } from './LbModal'

export const NAME: Record<LoginProvider, string> = { discord: 'Discord', google: 'Google' }
export const MARK: Record<LoginProvider, string> = { discord: 'D', google: 'G' }
export const day = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// where the provider redirects the browser: this page, without an earlier sign-in result
export function here(): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('signin')
  return `${url.pathname}${url.search}`
}

function Providers({ have, offered, linking, onRetry }: { have: LoginProvider[]; offered: LoginProvider[] | null | 'failed'; linking: boolean; onRetry: () => void }) {
  if (offered === 'failed') return <p className="lbm-quiet" role="alert">oopsies... we couldn't load the sign-in options. <button type="button" className="lk" onClick={onRetry}>Try again</button></p>
  if (!offered) return <p className="lbm-quiet">loading sign-in options... :P</p>
  const left = offered.filter((p) => !have.includes(p))
  if (!offered.length) return <p className="lbm-quiet">account sign-in isn't available on this site yet :( you can still claim a UID with a card.</p>
  if (!left.length) return null
  return (
    <div className="lsi-prov">
      {left.map((p) => (
        <a key={p} className={`lsi-pv ${p}`} href={lbApi.signInUrl(p, here())}>
          <span className="lsi-mk" aria-hidden="true">{MARK[p]}</span>{linking ? `Link ${NAME[p]}` : `Continue with ${NAME[p]}`}
        </a>
      ))}
    </div>
  )
}

// claim a uid with a card drawn in the last 15 minutes
export function Claim() {
  const [input, setInput] = useState('')
  const [token, setToken] = useState<string | null>(null)
  // a turnstile token is valid for one request, so each try renders a new widget
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const send = async () => {
    if (!input.trim()) { setNote("hmm... paste a card link or file name first :P"); return }
    if (!token) { setNote(TURNSTILE_KEY ? "hold on... let the bot check finish, then try again :P" : "oopsies... UID claims aren't available on this site yet :("); return }
    setBusy(true)
    setNote(null)
    try {
      await lbApi.login({ input: input.trim(), turnstileToken: token })
      setInput('')
      notify('UID claimed! :P')
      await noteViewerChanged()
    } catch (error) {
      setNote(errorText(error))
    } finally {
      setBusy(false)
      setToken(null)
      setRound((r) => r + 1)
    }
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); void send() }}>
      <label className="lbd-field">
        <CreditCard aria-hidden="true" />
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="paste a newly generated card link" autoComplete="off" aria-label="Card link" />
        <button type="submit" className="lbd-go" disabled={busy}>{busy ? 'Claiming' : 'Claim'}</button>
      </label>
      <Turnstile key={round} onToken={setToken} />
      {note ? <p className="lbd-note" role="alert">{note}</p> : null}
    </form>
  )
}

function Held({ me, busy, run }: { me: MeResponse; busy: boolean; run: (act: () => Promise<unknown>, done: string) => void }) {
  if (!me.uids.length) return null
  return (
    <div className="lsi-list">
      {me.uids.map((h) => (
        <div key={h.uid} className="lsi-row">
          <span className="lsi-mono">{(h.name ?? '?')[0]?.toUpperCase()}</span>
          <span className="lsi-tx"><b>{h.name ?? 'Unnamed'}</b><small>UID {fmtUid(h.uid)}{h.linked ? ', on this account' : ', this browser only'}</small></span>
          {h.linked ? <button type="button" className="lsi-ic" disabled={busy} aria-label="Unlink this UID" title="Unlink from the account"
            onClick={() => run(() => lbApi.unlinkUid(h.uid), 'UID unlinked from your account.')}><X aria-hidden="true" /></button>
            : <button type="button" className="lsi-ic" disabled={busy} aria-label="Let this UID go" title="Let go of this UID"
              onClick={() => run(() => lbApi.release(h.uid), 'UID let go.')}><X aria-hidden="true" /></button>}
        </div>
      ))}
    </div>
  )
}

export function SignInWindow() {
  const open = useLbChrome((s) => s.signIn)
  const me = useLbChrome((s) => s.me)
  const [offered, setOffered] = useState<LoginProvider[] | null | 'failed'>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!open || offered) return
    lbApi.providers().then((r) => setOffered(r.providers), () => setOffered('failed'))
  }, [open, offered])

  const run = (act: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setNote(null)
    act().then(() => { notify(done); return noteViewerChanged() }, (e: unknown) => setNote(errorText(e))).finally(() => setBusy(false))
  }
  const signOut = () => run(() => lbApi.logout(), 'signed out! see you around :P')

  const account = me?.account ?? null
  const have = account?.logins.map((l) => l.provider) ?? []
  const title = account ? 'Your account' : me ? 'Keep this UID' : 'Sign in'

  return (
    <LbModal open={open} onClose={closeSignIn} over="Leaderboard" title={title} className="lsi"
      foot={me ? <>
        <span className="lsi-foot">{account ? `Account since ${day(Math.min(...account.logins.map((l) => l.createdAt)))}` : 'Card session'}</span>
        <span className="amdl__fill" />
        <button type="button" className="amdl__act" disabled={busy} onClick={signOut}><LogOut aria-hidden="true" />Sign out</button>
      </> : null}>
      {account ? (
        <section className="amdl__grp">
          <h3 className="amdl__grp-name">Logins</h3>
          <div className="lsi-list">
            {account.logins.map((l) => (
              <div key={l.provider} className="lsi-row">
                <span className={`lsi-mk ${l.provider}`} aria-hidden="true">{MARK[l.provider]}</span>
                <span className="lsi-tx"><b>{NAME[l.provider]}</b><small>last used {day(l.lastUsedAt)}</small></span>
                {account.logins.length > 1 ? <button type="button" className="lsi-ic" disabled={busy} aria-label={`Remove ${NAME[l.provider]}`} title="Remove this login"
                  onClick={() => run(() => lbApi.removeLogin(l.provider), `${NAME[l.provider]} removed.`)}><X aria-hidden="true" /></button> : null}
              </div>
            ))}
          </div>
          <Providers have={have} offered={offered} linking onRetry={() => setOffered(null)} />
        </section>
      ) : (
        <section className="amdl__grp">
          <h3 className="amdl__grp-name">Account</h3>
          <p className="lbm-lead">{me
            ? 'sign in to keep your freshly claimed UID across devices, pin players, save builds and get an inbox :P'
            : 'sign in for pins, saves and an inbox! freshly claimed UIDs stay on your account across devices :P'}</p>
          <Providers have={have} offered={offered} linking={false} onRetry={() => setOffered(null)} />
        </section>
      )}

      <section className="amdl__grp">
        <h3 className="amdl__grp-name">{me?.uids.length ? 'UIDs' : 'Your UID'}</h3>
        {me ? <Held me={me} busy={busy} run={run} /> : null}
        <p className="lbm-lead">{me?.uids.length
          ? 'another UID? change its build in game, generate a new card and claim it within 15 minutes. an unchanged build can give you an old card again :P'
          : 'change your build in game, generate a new card and claim its UID within 15 minutes. an unchanged build can reuse an old card! you can claim without an account, too :P'}</p>
        <Claim />
      </section>
      {note ? <p className="lbm-note" role="alert">{note}</p> : null}
    </LbModal>
  )
}
