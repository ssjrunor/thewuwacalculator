/*
  Author: Runor Ewhro
  description: the Account tab of the viewer's profile: logins, uids, privacy, blocks, sanctions and account deletion.
*/

import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LogOut, Shield, X } from 'lucide-react'
import type { LoginProvider, MeResponse, OwnSanction, PlayerProfileResponse } from '@/domain/leaderboard/api'
import type { ProfileDoc } from '@/domain/leaderboard/documents'
import { queryClient } from '@/shared/lib/queryClient'
import { mainPortal } from '@/shared/lib/portalTarget'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal'
import { useConfirm } from '@/shared/hooks/useConfirmation'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { lbApi } from '../../api/client'
import { invalidate, lbKeys, lbq } from '../../api/queries'
import { noteViewerChanged } from '../../chrome/chrome'
import { Claim, MARK, NAME, day, here } from '../../chrome/SignIn'
import { errorText } from '../../model/cardTrack'
import { dayText } from '../../model/format'
import { fmtUid } from '../../model/listed'
import { playerName } from '../../model/players'
import { KIND, TROUBLE_WORD, covers, running, troubleOf } from '../../model/standing'
import { useScope } from '../../state/ctx'

export type Section = 'signin' | 'uids' | 'privacy' | 'blocked' | 'status' | 'leave'
const SECTIONS: Section[] = ['signin', 'uids', 'privacy', 'blocked', 'status', 'leave']
export const isSection = (value: string | null): value is Section => SECTIONS.includes(value as Section)
const MAX_APPEAL = 2000

function Row({ mark, label, sub, hi, children }: { mark?: ReactNode; label: ReactNode; sub?: ReactNode; hi?: boolean; children?: ReactNode }) {
  return (
    <div className={`acr-r${hi ? ' hi' : ''}`}>
      {mark}
      <span className="acr-l"><b>{label}</b>{sub ? <small>{sub}</small> : null}</span>
      {children}
    </div>
  )
}

function Switch({ on, label, busy, onChange }: { on: boolean; label: string; busy?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" className={`acr-sw${on ? ' on' : ''}`} aria-checked={on} aria-label={label} disabled={busy} onClick={() => onChange(!on)}>
      <span>{on ? 'Shown' : 'Hidden'}</span><i aria-hidden="true" />
    </button>
  )
}

const initial = (name: string | null) => (name ?? '?').trim().charAt(0).toUpperCase() || '?'

function Appeal({ s, onSent }: { s: OwnSanction; onSent: () => void }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  if (!open) return <div className="acr-apl"><button type="button" className="act" onClick={() => setOpen(true)}>Appeal</button></div>
  const send = () => {
    if (!body.trim()) return
    setBusy(true)
    setNote(null)
    lbApi.appeal(s.id, body.trim()).then(() => { setBody(''); setOpen(false); onSent() }, (e: unknown) => setNote(errorText(e))).finally(() => setBusy(false))
  }
  return (
    <form className="acr-apl open" onSubmit={(event) => { event.preventDefault(); send() }}>
      <textarea value={body} maxLength={MAX_APPEAL} rows={4} autoFocus placeholder="what should staff reconsider?" aria-label="Appeal" onChange={(event) => setBody(event.target.value)} />
      <div className="acr-apl-f">
        {note ? <span className="bad" role="alert">{note}</span> : <span>{body.length} / {MAX_APPEAL}</span>}
        <button type="button" className="act" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="act go" disabled={busy || !body.trim()}>Send appeal</button>
      </div>
    </form>
  )
}

function Sanction({ s, now, onSent }: { s: OwnSanction; now: number; onSent: () => void }) {
  const live = running(s, now)
  const a = s.appeal
  return (
    <section className={`acr-sx${live ? ' live' : ''}`}>
      <header><b>{KIND[s.kind]}</b><span className={`acr-tag${live ? ' on' : ''}`}>{s.liftedAt ? 'Lifted' : live ? 'Active' : 'Ended'}</span><time>{dayText(s.createdAt)}</time></header>
      <Row label="Reason"><span className="acr-v">{s.reason}</span></Row>
      <Row label="Covers"><span className="acr-v">{covers(s)}</span></Row>
      {s.kind !== 'warn' ? <Row label="Until"><span className="acr-v">{s.liftedAt ? `lifted ${dayText(s.liftedAt)}` : s.expiresAt ? dayText(s.expiresAt) : 'until staff lift it'}</span></Row> : null}
      {a ? <Row label={a.status === 'open' ? 'Appeal sent' : a.status === 'granted' ? 'Appeal granted' : 'Appeal denied'} sub={dayText(a.decidedAt ?? a.createdAt)}>
        <span className="acr-v">{a.response ? <>{a.response}</> : <q>{a.body}</q>}</span></Row> : null}
      {live && a?.status !== 'open' ? <Appeal s={s} onSent={onSent} /> : null}
    </section>
  )
}

export function AccountTab({ me, profile, initialSection }: {
  me: MeResponse
  // the viewer's own profile, for the pin count switch
  profile: PlayerProfileResponse | null
  initialSection: Section | null
}) {
  const { changed, toast, go } = useScope()
  const account = me.account
  const sanctionsRead = useQuery({ ...lbq.sanctions(), enabled: Boolean(account) })
  const sanctions = sanctionsRead.data?.sanctions ?? null
  const blocksRead = useQuery({ ...lbq.blocks(), enabled: Boolean(account) })
  const blocks = blocksRead.data?.players ?? null
  const [offered, setOffered] = useState<LoginProvider[] | null | 'failed'>(null)
  useEffect(() => {
    if (offered) return
    lbApi.providers().then((r) => setOffered(r.providers), () => setOffered('failed'))
  }, [offered])
  // read once per load, so "running" stays stable while the viewer reads it
  const [now] = useState(() => Date.now())
  const trouble = troubleOf(me, sanctions, now)
  const [picked, setPicked] = useState<Section | null>(initialSection)
  const section: Section = picked ?? (trouble ? 'status' : 'signin')
  const [uidPick, setUidPick] = useState<string | null>(null)
  const focus = me.uids.find((u) => u.uid === uidPick) ?? me.uids[0] ?? null
  const [busy, setBusy] = useState(false)
  const confirmation = useConfirm()

  const run = (act: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(true)
    act().then(() => { after?.(); changed(done) }, (e: unknown) => toast(errorText(e), true)).finally(() => setBusy(false))
  }

  const have = account?.logins.map((l) => l.provider) ?? []
  const left = Array.isArray(offered) ? offered.filter((p) => !have.includes(p)) : []
  const followers = profile?.profile?.privacy.followers ?? true
  const setFollowers = (on: boolean) => {
    const doc: ProfileDoc = { links: [], featured: [], ...(profile?.profile ?? {}), privacy: { followers: on } }
    run(() => lbApi.putProfile(doc), on ? 'your pin count shows again! :P' : 'your pin count is hidden now.')
  }
  const patch = (uid: string, change: { hideUid?: boolean; anonymous?: boolean }, done: string) => run(() => lbApi.patchUid(uid, change), done)
  const leaveBoards = (uid: string) => confirmation.confirm({
    title: 'Leave the boards?',
    message: `UID ${fmtUid(uid)}'s builds leave every board and their stored card images are erased. You can rejoin later and submit a new card.`,
    confirmLabel: 'Leave the boards',
    variant: 'danger',
    onConfirm: () => run(() => lbApi.optOut(uid), "you've left the boards. you can rejoin from your account."),
  })
  const deleteAccount = () => confirmation.confirm({
    title: 'Delete your account?',
    message: 'Pins, saves, card looks, presets and uploads are deleted for good. Builds stay on their UIDs. This cannot be undone.',
    confirmLabel: 'Delete account',
    cancelLabel: 'Keep it',
    variant: 'danger',
    onConfirm: () => {
      setBusy(true)
      lbApi.deleteAccount().then(() => { toast('account deleted.'); void noteViewerChanged(); go(APP_ROUTES.leaderboard) },
        (e: unknown) => toast(errorText(e), true)).finally(() => setBusy(false))
    },
  })
  const signOut = () => run(() => lbApi.logout(), 'signed out! see you around :P')
  const unblock = (id: string) => {
    setBusy(true)
    lbApi.unblock(id).then((r) => { queryClient.setQueryData(lbKeys.blocks(), r); toast('unblocked.') }, (e: unknown) => toast(errorText(e), true)).finally(() => setBusy(false))
  }

  const index: Array<{ key: Section; word: string; read: string; bad?: boolean }> = [
    { key: 'signin', word: 'Sign-in', read: account ? have.map((p) => NAME[p]).join(', ') : 'Card session' },
    { key: 'uids', word: 'UIDs', read: String(me.uids.length) },
    { key: 'privacy', word: 'Privacy', read: !focus ? '' : focus.anonymous ? 'Anonymous' : focus.hideUid ? 'UID hidden' : 'UID shown' },
    ...(account ? [
      { key: 'blocked' as const, word: 'Blocked', read: blocks ? String(blocks.length) : '' },
      { key: 'status' as const, word: 'Status', read: trouble ? TROUBLE_WORD[trouble] : sanctions ? 'Clear' : '', bad: Boolean(trouble) },
    ] : []),
    { key: 'leave', word: 'Leave', read: '' },
  ]

  const stop = account?.suspension ?? null
  const pane: Record<Section, [string, ReactNode, ReactNode]> = {
    signin: ['Sign-in', account ? 'Ways into this account. Any one of them signs you in.' : 'Sign in to keep your UIDs on an account across devices, and to pin, like and save.', <>
      {account?.logins.map((l) => (
        <Row key={l.provider} mark={<span className={`acr-mk ${l.provider}`} aria-hidden="true">{MARK[l.provider]}</span>} label={NAME[l.provider]} sub={`last used ${day(l.lastUsedAt)}`}>
          {account.logins.length > 1 ? <button type="button" className="act" disabled={busy} onClick={() => run(() => lbApi.removeLogin(l.provider), `${NAME[l.provider]} removed.`)}>Remove</button>
            : <span className="acr-ok">Linked</span>}
        </Row>
      ))}
      {left.map((p) => (
        <Row key={p} mark={<span className={`acr-mk ${p}`} aria-hidden="true">{MARK[p]}</span>} label={NAME[p]} sub="not linked">
          <a className="act" href={lbApi.signInUrl(p, here())}>{account ? `Link ${NAME[p]}` : `Continue with ${NAME[p]}`}</a>
        </Row>
      ))}
      {offered === 'failed' ? <p className="acr-q" role="alert">couldn't load the sign-in options. <button type="button" className="lk" onClick={() => setOffered(null)}>Try again</button></p>
        : !offered ? <p className="acr-q">loading sign-in options...</p>
        : !offered.length && !account ? <p className="acr-q">account sign-in isn't available on this site yet.</p> : null}
    </>],
    uids: ['UIDs', 'Builds belong to a UID. Claiming one brings its builds here.', <>
      {me.uids.map((u) => (
        <Row key={u.uid} hi={u.uid === focus?.uid && me.uids.length > 1} mark={<span className="acr-mk" aria-hidden="true">{initial(u.name)}</span>}
          label={u.name ?? 'Unnamed'} sub={`UID ${fmtUid(u.uid)}, ${u.optedOut ? 'off the boards' : u.linked ? 'on this account' : 'this browser only'}`}>
          {u.optedOut ? <button type="button" className="act go" disabled={busy} onClick={() => run(() => lbApi.optIn(u.uid), 'welcome back! submit a card to return to the boards :P')}>Rejoin</button>
            : <button type="button" className="act" disabled={busy} onClick={() => leaveBoards(u.uid)}>Leave the boards</button>}
          <button type="button" className="k-tool ibs" disabled={busy} aria-label={u.linked ? 'Unlink from the account' : 'Let go of this UID'} data-l={u.linked ? 'Unlink' : 'Let go'}
            onClick={() => u.linked ? run(() => lbApi.unlinkUid(u.uid), 'UID unlinked from your account.') : run(() => lbApi.release(u.uid), 'UID let go.')}><X className="lu" aria-hidden="true" /></button>
        </Row>
      ))}
      <div className="acr-claim">
        <span className="acr-l"><b>Claim {me.uids.length ? 'another' : 'a'} UID</b><small>change the build in game, generate a new card and paste it within 15 minutes</small></span>
        <Claim />
      </div>
    </>],
    privacy: ['Privacy', 'What others see on your builds and profile.', <>
      {me.uids.length > 1 ? <div className="acr-pick" role="radiogroup" aria-label="UID">
        {me.uids.map((u) => <button key={u.uid} type="button" role="radio" aria-checked={u.uid === focus?.uid} className={u.uid === focus?.uid ? 'on' : ''} onClick={() => setUidPick(u.uid)}>{fmtUid(u.uid)}</button>)}
      </div> : null}
      {focus ? <>
        <Row label="UID" sub="hidden: the number is masked on your builds, and people reach your profile through them">
          <Switch on={!focus.hideUid} label="Show UID" busy={busy || focus.optedOut} onChange={(on) => patch(focus.uid, { hideUid: !on }, on ? 'your UID is visible again! :P' : 'your UID is hidden now.')} />
        </Row>
        <Row label="Profile" sub="hidden: you show as anon with your server, and only you can open your profile">
          <Switch on={!focus.anonymous} label="Show profile" busy={busy || focus.optedOut} onChange={(on) => patch(focus.uid, { anonymous: !on }, on ? 'your profile shows again! :P' : "you're anonymous on the boards now.")} />
        </Row>
      </> : null}
      {account ? <Row label="Pin count" sub="how many players pinned you, on your profile">
        <Switch on={followers} label="Show pin count" busy={busy || !profile} onChange={setFollowers} />
      </Row> : null}
    </>],
    blocked: ['Blocked', 'Their inbox items stop showing for you. They are not told.', <>
      {blocksRead.isError && !blocks ? <p className="acr-q" role="alert">{errorText(blocksRead.error)}</p>
        : !blocks ? <p className="acr-q">loading...</p>
        : !blocks.length ? <p className="acr-q">no one blocked. block a player from the More menu on their profile.</p>
        : blocks.map((b) => (
          <Row key={b.id} mark={<span className="acr-mk" aria-hidden="true">{initial(playerName(b))}</span>} label={playerName(b)} sub={`since ${dayText(b.at)}`}>
            <button type="button" className="act" disabled={busy} onClick={() => unblock(b.id)}>Unblock</button>
          </Row>
        ))}
    </>],
    status: ['Status', stop ? <>{stop.kind === 'ban' ? 'Banned' : 'Suspended'} {stop.expiresAt ? `until ${dayText(stop.expiresAt)}` : 'until staff lift it'}. Reading, your inbox and appeals still work.</>
      : trouble === 'muted' ? 'Muted. Profile edits, card looks and uploads are paused; everything else works.'
      : 'Sanctions on this account and its UIDs.', <>
      {sanctionsRead.isError && !sanctions ? <p className="acr-q" role="alert">{errorText(sanctionsRead.error)}</p>
        : !sanctions ? <p className="acr-q">checking your status...</p>
        : !sanctions.length ? <p className="acr-q"><Shield className="lu" aria-hidden="true" />no sanctions. all clear!</p>
        : sanctions.map((s) => <Sanction key={s.id} s={s} now={now} onSent={() => { toast('appeal sent! staff will reply in your inbox.'); void invalidate(lbKeys.sanctions()) }} />)}
    </>],
    leave: ['Leave', account ? 'Signing out keeps everything. Deleting the account cannot be undone.' : "Signing out forgets this browser's claims.", <>
      <Row label="Sign out" sub="this browser only"><button type="button" className="act" disabled={busy} onClick={signOut}><LogOut className="lu" aria-hidden="true" />Sign out</button></Row>
      {account ? <Row label={<span className="bad">Delete account</span>} sub="pins, saves, looks and uploads go">
        <button type="button" className="act danger" disabled={busy} onClick={deleteAccount}>Delete</button>
      </Row> : null}
    </>],
  }
  const [title, lead, body] = pane[section]

  return (
    <div className="acr">
      <nav className="acr-ix" aria-label="Account">
        {index.map((entry) => (
          <button key={entry.key} type="button" className={`${entry.key === section ? 'on' : ''}${entry.bad ? ' bad' : ''}`}
            aria-current={entry.key === section ? 'true' : undefined} onClick={() => setPicked(entry.key)}>
            <span>{entry.word}</span><small>{entry.read}</small>
          </button>
        ))}
      </nav>
      <div className="acr-pane" key={section}>
        <h3>{title}</h3>
        <p>{lead}</p>
        <div className="acr-rows">{body}</div>
      </div>
      <ConfirmHost control={confirmation} portalTarget={mainPortal()} />
    </div>
  )
}
