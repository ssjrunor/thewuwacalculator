/*
  Author: Runor Ewhro
  description: a player's profile and every build they submitted; the own profile adds the saved, looks and account
               tabs.
*/

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Ban, Copy, Ellipsis, ExternalLink, Link2, PenLine, Pin, Search } from 'lucide-react'
import type { MeResponse, PlayerProfileResponse, PlayerSocialResponse } from '@/domain/leaderboard/api'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { queryClient } from '@/shared/lib/queryClient'
import { AnchoredAppPopup, useAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'
import { lbApi } from '../api/client'
import { invalidate, lbKeys, lbq } from '../api/queries'
import { canWrite, notify, openSignIn, openSubmit } from '../chrome/chrome'
import { troubleOf } from '../model/standing'
import { isSection } from '../components/account/AccountTab'
import { errorText } from '../model/cardTrack'
import { resName, wpnOf } from '../model/format'
import { pinOf, playerPath, standingOf, type Who } from '../model/players'
import { pinsOnAccount, playerPinned, togglePlayerPin, usePins } from '../model/pins'
import { CopyIb, Ib } from '../components/IconButtons'
import { Rule } from './ActivityView'
import { BuildHead, BuildRow, Region } from '../components/build/BuildRow'
import { useScope } from '../state/ctx'
import { fmtUid, fromPlayer, reduced, scroller, type Row } from '../model/listed'
import { ProfileHeader } from '../components/profile/ProfileHeader'
import { seeRows } from '../model/seen'
import { toggler, useOpen } from '../state/useOpen'
import { SavedView } from './SavedView'

const ProfileEditor = lazy(async () => ({ default: (await import('../components/profile/ProfileEditor')).ProfileEditor }))
const AccountTab = lazy(async () => ({ default: (await import('../components/account/AccountTab')).AccountTab }))
const LooksTab = lazy(async () => ({ default: (await import('../components/account/LooksTab')).LooksTab }))
type Tab = 'builds' | 'saved' | 'looks' | 'account'
const TABS: Tab[] = ['builds', 'saved', 'looks', 'account']
const ME = `${APP_ROUTES.leaderboard}/me`
const roomWait = <div className="empty">opening... :P</div>

// the own profile's tab, from the address: /me, /me/saved, /me/looks, /me/account
function useTab(own: boolean): [Tab, (tab: Tab) => void] {
  const location = useLocation()
  const navigate = useNavigate()
  const word = own ? location.pathname.slice(ME.length).split('/').filter(Boolean)[0] ?? 'builds' : 'builds'
  const [local, setLocal] = useState<Tab>('builds')
  const tab = own ? TABS.includes(word as Tab) ? word as Tab : 'builds' : local
  const set = (next: Tab) => {
    if (!own) { setLocal(next); return }
    if (next !== tab) navigate(next === 'builds' ? ME : `${ME}/${next}`, { replace: true })
  }
  return [tab, set]
}

// another player's More menu: block them, or lift the block
function More({ refKey, social }: { refKey: string; social: PlayerSocialResponse | null | undefined }) {
  const { me, toast } = useScope()
  const menu = useAppPopup()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  useAppPopupDismiss({ open: menu.visible, onDismiss: menu.hide, hostRef: trigger, popupRef: popup, returnFocusRef: trigger })
  const blocked = Boolean(social?.blocked)
  const block = () => {
    menu.hide()
    if (!me?.account) { openSignIn(); return }
    ;(blocked ? lbApi.unblock(refKey) : lbApi.block(refKey)).then((r) => {
      queryClient.setQueryData(lbKeys.blocks(), r)
      queryClient.setQueryData<PlayerSocialResponse>(lbKeys.playerSocial(refKey), (s) => s ? { ...s, blocked: !blocked } : s)
      void invalidate(lbKeys.notifications())
      toast(blocked ? 'unblocked.' : "blocked. their inbox items won't show for you. unblock from Account > Blocked.")
    }, (e: unknown) => toast(errorText(e), true))
  }
  return (
    <>
      <button ref={trigger} type="button" className={`act ib${menu.visible ? ' on' : ''}`} aria-label="More" data-l="More" aria-haspopup="menu" aria-expanded={menu.visible}
        onClick={(event) => { event.stopPropagation(); menu.toggle() }}><Ellipsis className="lu" /></button>
      <AnchoredAppPopup visible={menu.visible} open={menu.open} closing={menu.closing} anchorRef={trigger} popupRef={popup}
        preferredPlacement="down" align="end" minHeight={0} offset={8} className="pfm" role="menu" aria-label="More">
        <button type="button" role="menuitem" className="pfm-i warn" onClick={block}><Ban aria-hidden="true" />{blocked ? 'Unblock player' : 'Block player'}</button>
      </AnchoredAppPopup>
    </>
  )
}

// sortable column heads as on a board; # is the build's standing on its own board, Resonator sorts by name
type Sort = 'rank' | 'res' | 'cv' | 'er' | 'dmg' | 'score'
// unranked builds sort after the ranked ones on standing, and after the scored ones on score
const SORT_BY: Record<Exclude<Sort, 'res'>, (x: Row) => number> = {
  rank: (x) => x.rank == null ? -Infinity : -x.rank / Math.max(1, x.total), cv: (x) => x.stats?.critValue ?? -1,
  er: (x) => x.stats?.energyRegen ?? -1, dmg: (x) => x.dpr ?? -1, score: (x) => x.score ?? -1,
}

// signed out: sign in (an account, or a fresh card), or submit a card without one
function Gate() {
  return (
    <main className="lpage pf">
      <section className="k-band gate">
        <Rule word="Your profile" />
        <h1 className="pg-h1">Sign in to see your profile</h1>
        <p className="gate-lead">sign in with Discord or Google for pins, saves and an inbox! to manage your builds and privacy, change your build in game,
          generate a new card and claim its UID within 15 minutes :P</p>
        <div className="gate-acts">
          <button type="button" className="act go" onClick={openSignIn}>Sign in</button>
          <button type="button" className="act" onClick={() => openSubmit()}>Submit a card</button>
        </div>
        <p className="gate-foot">no account needed to submit! each supported build gets its own rank; builds without scoring data stay saved and unranked.</p>
      </section>
    </main>
  )
}

// shown for a signed-in account with no uid yet; the account itself still opens below
function NoUid({ me }: { me: MeResponse }) {
  const location = useLocation()
  const section = new URLSearchParams(location.search).get('s')
  return (
    <main className="lpage pf">
      <section className="k-band gate">
        <Rule word="Your profile" />
        <h1 className="pg-h1">Claim your UID</h1>
        <p className="gate-lead">no UID linked yet! change your build in game, generate a new card and claim it within 15 minutes. claiming while signed in keeps the UID on your account :P</p>
        <div className="gate-acts">
          <button type="button" className="act go" onClick={openSignIn}>Claim a UID</button>
          <button type="button" className="act" onClick={() => openSubmit()}>Submit a card</button>
        </div>
      </section>
      <div className="av-bar"><div className="pf-tabs" role="tablist"><button role="tab" aria-selected className="on">Account</button></div></div>
      <Suspense fallback={roomWait}><AccountTab me={me} profile={null} initialSection={isSection(section) ? section : null} /></Suspense>
    </main>
  )
}

export function ProfileView({ who, own }: { who: Who | null; own: boolean }) {
  const { me, session, changed, toast } = useScope()
  const { search: query } = useLocation()
  const pins = usePins()
  const [sort, setSort] = useState<Sort>('score')
  const [tab, setTab] = useTab(own)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useOpen()
  const toggle = toggler(open, setOpen)

  const uid = who?.uid ?? null, buildId = who?.buildId ?? ''
  // the own profile is read privately, which includes hidden builds across every uid of the viewer
  const myUids = own ? me?.uids ?? [] : []
  const focus = myUids[0] ?? null
  const ownUid = focus?.uid ?? null
  const ownRead = useQuery({ ...lbq.myProfile(), enabled: Boolean(ownUid) })
  const otherRead = useQuery({ ...lbq.player({ uid, buildId }), enabled: !ownUid && Boolean(uid || buildId) })
  const read = ownUid ? ownRead : otherRead
  const profile: PlayerProfileResponse | null = read.data ?? null
  const error = read.error

  // pin count and the viewer's own pin, by uid, or through a build when the uid is hidden
  const socialRef = profile ? profile.uid ?? profile.builds[0]?.buildId ?? null : null
  // undefined while loading; null when it could not be read
  const socialRead = useQuery({ ...lbq.playerSocial(socialRef ?? ''), enabled: Boolean(socialRef) })
  const social = socialRead.isError ? null : socialRead.data
  // a running mute, suspension or ban marks the Account tab
  const sanctionsRead = useQuery({ ...lbq.sanctions(), enabled: own && Boolean(me?.account) })
  const trouble = own ? troubleOf(me, sanctionsRead.data?.sanctions) : null
  const search = new URLSearchParams(query)

  const standing = useMemo(() => standingOf(profile), [profile])
  const rows = useMemo(() => profile ? profile.builds.map((b) => fromPlayer(profile, b)) : [], [profile])
  useEffect(() => seeRows(rows), [rows])
  // featured builds lead, in the owner's order; the rest follow the sort
  const featured = profile?.profile?.featured
  const sorted = useMemo(() => {
    const lead = (x: Row) => { const i = featured?.indexOf(x.buildId) ?? -1; return i < 0 ? Infinity : i }
    const by = (a: Row, b: Row) => sort === 'res'
      ? resName(a.resonatorId).localeCompare(resName(b.resonatorId)) || SORT_BY.score(b) - SORT_BY.score(a)
      : SORT_BY[sort](b) - SORT_BY[sort](a)
    return [...rows].sort((a, b) => lead(a) - lead(b) || by(a, b))
  }, [rows, sort, featured])
  const term = q.trim().toLowerCase()
  const visible = term ? sorted.filter((x) => resName(x.resonatorId).toLowerCase().includes(term)
    || (x.weaponId ? wpnOf(x.weaponId)?.name.toLowerCase().includes(term) : false)) : sorted

  // the own page waits for the session, because the signed-out state is unknown until it responds
  if (own && session === 'unknown') return <main className="lpage pf"><div className="empty">loading the profile... :P</div></main>
  if (own && !me?.uids.length && !me?.account) return <Gate />
  if (own && !me?.uids.length) return me ? <NoUid me={me} /> : <Gate />
  if (error && !profile) return <main className="lpage pf"><div className="empty">{errorText(error)}</div></main>
  if (!profile) return <main className="lpage pf"><div className="empty">loading the profile... :P</div></main>

  const name = profile.name ?? 'Unnamed'
  const optedOut = own && Boolean(focus?.optedOut)
  const hidden = own ? Boolean(focus?.hideUid) : !profile.uid
  // only the owner opens an anonymous profile
  const anonymous = own && Boolean(focus?.anonymous)
  const shownUid = own ? ownUid : profile.uid
  const pin = pinOf(profile, standing)
  const pinned = pin ? playerPinned(pins, pin) : false
  const best = standing.best
  // apply the viewer's own pin to the count at once, because the count was read before it
  const pinnedBy = social?.followers == null ? null
    : social.followers + (pinsOnAccount() && !own ? Number(pinned) - Number(social.following) : 0)
  const doc = profile.profile
  const linkTo = () => `${location.origin}${playerPath(profile.uid && !hidden ? { uid: profile.uid, buildId: '' } : { uid: null, buildId: best?.buildId ?? buildId })}`
  const avatar = doc?.avatar ? lbApi.mediaUrl(doc.avatar) : null
  const banner = doc?.banner ? lbApi.mediaUrl(doc.banner) : null
  const canSave = Boolean(me?.account)
  const shownName = doc?.displayName ?? name
  const editProfile = () => canWrite(me) ? setEditing(true)
    : (notify('hold on... sign in with Discord or Google to edit your profile :P'), openSignIn())
  // a featured ribbon opens its row in the list and scrolls it under the sticky bar and head
  const openFeatured = (id: string) => {
    setTab('builds')
    // a filter can hide the featured row
    setQ('')
    setOpen(id)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector(`[data-row="${id}"]`), s = scroller()
      if (!el || !s) return
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const y = el.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - 4.5 * rem - 12
      s.scrollTo({ top: y, behavior: reduced() ? 'auto' : 'smooth' })
    }))
  }

  // a player's accent colours their whole page, like a resonator's colours its board: the leaderboard colour (--res)
  // and the app accent its controls read
  const ink = doc?.accent ? { '--res': doc.accent, '--accent': doc.accent, '--accent-2': `color-mix(in srgb, ${doc.accent} 74%, var(--text))` } as CSSProperties : undefined
  return (
    <main className={`lpage pf${ink ? ' tint' : ''}`} style={ink}>
      <ProfileHeader accent={doc?.accent ?? null} avatar={avatar} banner={banner} avatarFrame={doc?.avatarFrame} bannerFrame={doc?.bannerFrame} name={shownName} ign={shownName !== name ? name : null}
        meta={<><Region region={profile.region} />
          {own && myUids.length > 1 ? myUids.map((row) => (
            <span key={row.uid} className="pfb-uid">
              UID <b>{fmtUid(row.uid)}</b>
              <CopyIb small icon={Copy} label="Copy UID" text={() => row.uid} />
              {row.hideUid ? <em>hidden from others</em> : null}{row.anonymous ? <em>anonymous to others</em> : null}
            </span>
          )) : <>
            {shownUid && !(hidden && !own) ? <span className="pfb-uid">UID <b>{fmtUid(shownUid)}</b><CopyIb small icon={Copy} label="Copy UID" text={() => shownUid} />{own && hidden ? <em>hidden from others</em> : null}</span>
              : null}
            {anonymous ? <span className="pfb-uid"><em>anonymous to others</em></span> : null}
          </>}</>}
        bio={doc?.bio ?? null}
        links={doc?.links.length ? <div className="pfb-links">{doc.links.map((link) => (
          <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer nofollow ugc"><ExternalLink className="lu" aria-hidden="true" />{link.label}</a>
        ))}</div> : null}
        pinnedBy={social?.followers != null ? pinnedBy : null}
        tools={own ? <>
          <Ib icon={PenLine} label="Edit profile" onClick={editProfile} />
          {anonymous ? null : <CopyIb icon={Link2} label="Copy link" text={linkTo} />}
        </> : <>
          {pin ? <Ib icon={Pin} label={pinned ? 'Unpin player' : 'Pin player'} on={pinned} className="txt" onClick={() => togglePlayerPin(pin)}>{pinned ? 'Pinned' : 'Pin'}</Ib> : null}
          <CopyIb icon={Link2} label="Copy link" text={linkTo} />
          {socialRef ? <More refKey={socialRef} social={social} /> : null}
        </>}
        rows={rows} featured={featured ?? []} open={tab === 'builds' ? open : null} onOpen={openFeatured}
        onEditFeatured={own ? editProfile : null} />

      {optedOut ? (
        <section className="note-band">
          <p>you've left the boards. your builds are hidden, and we can't accept new cards for this UID until you rejoin.</p>
          <button className="act go" onClick={() => { if (ownUid) void lbApi.optIn(ownUid).then(() => changed('welcome back! submit a card to return to the boards :P'), (e: unknown) => toast(errorText(e), true)) }}>Rejoin</button>
        </section>
      ) : null}

      <div className="av-bar">
        <div className="pf-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'builds'} className={tab === 'builds' ? 'on' : ''} onClick={() => setTab('builds')}>{own ? 'Your builds' : 'Builds'}<small>{rows.length}</small></button>
          {own && canSave ? <button role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved</button> : null}
          {own && canSave ? <button role="tab" aria-selected={tab === 'looks'} className={tab === 'looks' ? 'on' : ''} onClick={() => setTab('looks')}>Looks</button> : null}
          {own ? <button role="tab" aria-selected={tab === 'account'} className={`${tab === 'account' ? 'on' : ''}${trouble ? ' bad' : ''}`} onClick={() => setTab('account')}
            title={trouble ? 'Your account has a running sanction' : undefined}>Account{trouble ? <i className="pf-dot" aria-label="needs attention" /> : null}</button> : null}
        </div>
        {tab === 'builds' ? <label className="fld"><Search size={12} strokeWidth={2.4} /><input value={q} onChange={(event) => setQ(event.target.value)}
          placeholder="Filter by resonator or weapon" autoComplete="off" aria-label="Filter by resonator or weapon" /></label> : null}
      </div>
      {tab === 'saved' && own && canSave ? <SavedView />
        : tab === 'looks' && own && canSave ? <Suspense fallback={roomWait}><LooksTab key={search.get('res') ?? ''} rows={rows} initial={search.get('res')} /></Suspense>
        : tab === 'account' && own && me ? <Suspense fallback={roomWait}><AccountTab me={me} profile={profile} initialSection={isSection(search.get('s')) ? search.get('s') as never : null} /></Suspense>
        : <>
      <BuildHead o={{ res: true }} sort={sort} onSort={(k) => setSort((cur) => cur === k ? 'score' : k as Sort)} />
      <div id="list">
        {visible.length ? visible.map((x, i) => (
          <BuildRow key={x.buildId} x={x} i={i} o={{ res: true }} mine={own} open={open === x.buildId} onToggle={toggle(x.buildId)} />
        )) : <div className="empty">{term && rows.length ? <>hmm... no builds match this filter. <button onClick={() => setQ('')}>Clear filter</button></>
          : own ? 'no builds yet... submit a card to add your first! :P' : 'no visible builds yet.'}</div>}
        {own && visible.length ? <div className="foot">that's all~</div> : null}
      </div>
      </>}

      {editing && profile ? <Suspense fallback={null}><ProfileEditor profile={profile} rows={rows}
        onClose={() => setEditing(false)} onSaved={(message) => changed(message)} /></Suspense> : null}

    </main>
  )
}
