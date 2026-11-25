/*
  Author: Runor Ewhro
  description: a player's profile: the band (ProfileBand: identity and featured
               builds) over every submitted build as build rows. a build has a
               rank while it is the ranked card for its resonator, and the rest
               list the same way, unranked. the viewer's own profile adds submit,
               hide uid, their hidden builds (marked), and under an opened build:
               rank this card, hide or show it, delete it, then sign out or
               leave. signed out, it links to the sign-in modal. tabs under the
               band, beside the counts: builds, history, and (own profile with an
               account) saved builds. the own band edits the profile.
*/

import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, ExternalLink, Eye, EyeOff, Link2, PenLine, Pin, Upload } from 'lucide-react'
import type { PlayerProfileResponse } from '@/domain/leaderboard/api'
import { lbApi } from '../api/client'
import { lbq } from '../api/queries'
import { canWrite, notify, openSignIn, openSubmit } from '../chrome/chrome'
import { errorText } from '../model/cardTrack'
import { dayText, grp, resName } from '../model/format'
import { pinOf, playerPath, standingOf, type Who } from '../model/players'
import { pinsOnAccount, playerPinned, togglePlayerPin, usePins } from '../model/pins'
import { CopyIb, Ib } from '../components/IconButtons'
import { Rule } from './ActivityView'
import { BuildHead, BuildRow, Region } from '../components/build/BuildRow'
import { useScope } from '../state/ctx'
import { fmtUid, fromPlayer, reduced, scroller, type Row } from '../model/listed'
import { ProfileBand } from '../components/profile/ProfileBand'
import { seeRows } from '../model/seen'
import { toggler, useOpen } from '../state/useOpen'
import { HistoryView } from './HistoryView'
import { SavedView } from './SavedView'

const ProfileEditor = lazy(async () => ({ default: (await import('../components/profile/ProfileEditor')).ProfileEditor }))
type Tab = 'builds' | 'history' | 'saved'

// sortable column heads as on a board; # is the build's standing on its own board, Resonator sorts by name
type Sort = 'rank' | 'res' | 'cv' | 'atk' | 'er' | 'dmg' | 'score'
// unranked builds sort after the ranked ones on standing, and after the scored ones on score.
const SORT_BY: Record<Exclude<Sort, 'res'>, (x: Row) => number> = {
  rank: (x) => x.rank == null ? -Infinity : -x.rank / Math.max(1, x.total), cv: (x) => x.stats?.critValue ?? -1,
  atk: (x) => x.stats?.atk ?? -1, er: (x) => x.stats?.energyRegen ?? -1, dmg: (x) => x.dpr ?? -1, score: (x) => x.score ?? -1,
}

/** signed out: sign in (an account, or a fresh card), or submit a card without one. */
function Gate() {
  return (
    <main className="lpage pf">
      <section className="k-band gate">
        <Rule word="Your profile" />
        <h1 className="pg-h1">Sign in to see your profile</h1>
        <p className="gate-lead">sign in with Discord or Google for pins, likes, comments and an inbox! to manage your builds and privacy, change your build in game,
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

/** shown for a signed-in account with no uid yet. */
function NoUid() {
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
    </main>
  )
}

/** controls under the viewer's own opened build: hide or show it, delete it. */
function Owned({ x, onChanged }: { x: Row; onChanged: (message: string) => void }) {
  const { toast } = useScope()
  const [deleting, setDeleting] = useState(false)
  const act = (run: () => Promise<unknown>, message: string) => {
    void run().then(() => onChanged(message), (e: unknown) => toast(errorText(e), true))
  }
  if (deleting) return (
    <div className="acct own">
      <span>hold on... this permanently deletes the build, and this exact card cannot be submitted again. still want to delete it?</span>
      <button className="warn" onClick={() => act(() => lbApi.deleteBuild(x.buildId), 'build deleted. this exact card cannot be submitted again.')}>Delete</button>
      <button onClick={() => setDeleting(false)}>Keep</button>
    </div>
  )
  return (
    <div className="acct own">
      <button onClick={() => act(() => lbApi.setHidden(x.buildId, !x.hidden), x.hidden ? 'the build is visible again! :P' : 'build hidden! only you can see it now.')}>
        {x.hidden ? 'Show to everyone' : 'Hide from everyone'}</button>
      <button className="warn" onClick={() => setDeleting(true)}>Delete</button>
    </div>
  )
}

export function ProfileView({ who, own }: { who: Who | null; own: boolean }) {
  const { me, session, changed, toast } = useScope()
  const pins = usePins()
  const [sort, setSort] = useState<Sort>('score')
  const [leaving, setLeaving] = useState(false)
  const [tab, setTab] = useState<Tab>('builds')
  const [editing, setEditing] = useState(false)
  // on the viewer's own profile, the uid that uid settings (hide, anonymous, leave, rejoin) apply to
  const [picked, setPicked] = useState<string | null>(null)
  const [open, setOpen] = useOpen()
  const toggle = toggler(open, setOpen)

  const uid = who?.uid ?? null, buildId = who?.buildId ?? ''
  // the own profile is read privately, which includes hidden builds across every uid of the viewer
  const myUids = own ? me?.uids ?? [] : []
  const focus = myUids.find((row) => row.uid === picked) ?? myUids[0] ?? null
  const ownUid = focus?.uid ?? null
  const ownRead = useQuery({ ...lbq.myProfile(), enabled: Boolean(ownUid) })
  const otherRead = useQuery({ ...lbq.player({ uid, buildId }), enabled: !ownUid && Boolean(uid || buildId) })
  const read = ownUid ? ownRead : otherRead
  const profile: PlayerProfileResponse | null = read.data ?? null
  const error = read.error

  // pin count and the viewer's own pin, by uid, or through a build when the uid is hidden
  const socialRef = profile ? profile.uid ?? profile.builds[0]?.buildId ?? null : null
  // undefined while asking; null when it could not be read.
  const socialRead = useQuery({ ...lbq.playerSocial(socialRef ?? ''), enabled: Boolean(socialRef) })
  const social = socialRead.isError ? null : socialRead.data

  const standing = useMemo(() => standingOf(profile), [profile])
  const rows = useMemo(() => profile ? profile.builds.map((b) => fromPlayer(profile, b)) : [], [profile])
  useEffect(() => seeRows(rows), [rows])
  // featured builds lead, in the owner's order; the rest follow the sort.
  const featured = profile?.profile?.featured
  const sorted = useMemo(() => {
    const lead = (x: Row) => { const i = featured?.indexOf(x.buildId) ?? -1; return i < 0 ? Infinity : i }
    const by = (a: Row, b: Row) => sort === 'res'
      ? resName(a.resonatorId).localeCompare(resName(b.resonatorId)) || SORT_BY.score(b) - SORT_BY.score(a)
      : SORT_BY[sort](b) - SORT_BY[sort](a)
    return [...rows].sort((a, b) => lead(a) - lead(b) || by(a, b))
  }, [rows, sort, featured])
  const ranked = standing.builds.length

  // the own page waits for the session, since signed-out state is unknown until it responds
  if (own && session === 'unknown') return <main className="lpage pf"><div className="empty">loading the profile... :P</div></main>
  if (own && !me?.uids.length && !me?.account) return <Gate />
  if (own && !me?.uids.length) return <NoUid />
  if (error && !profile) return <main className="lpage pf"><div className="empty">{errorText(error)}</div></main>
  if (!profile) return <main className="lpage pf"><div className="empty">loading the profile... :P</div></main>

  const name = profile.name ?? 'Unnamed'
  const optedOut = own && Boolean(focus?.optedOut)
  const hidden = own ? Boolean(focus?.hideUid) : !profile.uid
  // only the owner ever opens an anonymous profile.
  const anonymous = own && Boolean(focus?.anonymous)
  const shownUid = own ? ownUid : profile.uid
  // submitting needs a uid still on the boards.
  const canSubmit = !own || myUids.some((row) => !row.optedOut)
  const pin = pinOf(profile, standing)
  const pinned = pin ? playerPinned(pins, pin) : false
  const best = standing.best
  // apply the viewer's own pin to the count at once, since the count was read before it
  const pinnedBy = social?.followers == null ? null
    : social.followers + (pinsOnAccount() && !own ? Number(pinned) - Number(social.following) : 0)
  const atTop = standing.builds.filter((b) => b.rank === 1).length
  const doc = profile.profile
  const linkTo = () => `${location.origin}${playerPath(profile.uid && !hidden ? { uid: profile.uid, buildId: '' } : { uid: null, buildId: best?.buildId ?? buildId })}`
  const signOut = () => { void lbApi.logout().then(() => changed('signed out! see you around :P')) }
  const avatar = doc?.avatar ? lbApi.mediaUrl(doc.avatar) : null
  const banner = doc?.banner ? lbApi.mediaUrl(doc.banner) : null
  const canSave = Boolean(me?.account)
  const openFrom = (id: string) => { setTab('builds'); setOpen(id) }
  const shownName = doc?.displayName ?? name
  const editProfile = () => canWrite(me) ? setEditing(true)
    : (notify('hold on... sign in with Discord or Google to edit your profile :P'), openSignIn())
  // a featured ribbon opens its row in the list and scrolls it under the sticky bar and head
  const openFeatured = (id: string) => {
    setTab('builds')
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
      <ProfileBand accent={doc?.accent ?? null} avatar={avatar} banner={banner} avatarFrame={doc?.avatarFrame} bannerFrame={doc?.bannerFrame} name={shownName} ign={shownName !== name ? name : null}
        meta={<><Region region={profile.region} />
          {own && myUids.length > 1 ? myUids.map((row) => (
            // several uids: each is a chip, and the one picked is what the uid settings act on.
            <span key={row.uid} className={`pfb-uid pick${row.uid === ownUid ? ' on' : ''}`}>
              <button type="button" aria-pressed={row.uid === ownUid} title="Pick for the UID settings" onClick={() => setPicked(row.uid)}>UID <b>{fmtUid(row.uid)}</b></button>
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
          {canSubmit ? <Ib icon={Upload} label="Submit a card" go className="txt" onClick={() => openSubmit()}>Submit</Ib> : null}
          <Ib icon={PenLine} label="Edit profile" onClick={editProfile} />
          {ownUid && !optedOut ? <Ib icon={hidden ? Eye : EyeOff} label={hidden ? 'Show UID' : 'Hide UID'} on={hidden}
            onClick={() => { void lbApi.patchUid(ownUid, { hideUid: !hidden }).then(() => changed(hidden ? 'your UID is visible again! :P' : 'your UID is hidden now. people can still open your profile through your builds.'), (e: unknown) => toast(errorText(e), true)) }} /> : null}
          {anonymous ? null : <CopyIb icon={Link2} label="Copy link" text={linkTo} />}
        </> : <>
          {pin ? <Ib icon={Pin} label={pinned ? 'Unpin player' : 'Pin player'} on={pinned} className="txt" onClick={() => togglePlayerPin(pin)}>{pinned ? 'Pinned' : 'Pin'}</Ib> : null}
          <CopyIb icon={Link2} label="Copy link" text={linkTo} />
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
          <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
          {own && canSave ? <button role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved</button> : null}
        </div>
        <span className="k-read pf-n"><span><b>{grp(rows.length)}</b> {rows.length === 1 ? 'build' : 'builds'}</span><span><b>{grp(ranked)}</b> ranked</span><span><b>{grp(atTop)}</b> at #1</span>
          {standing.last != null ? <span>latest upload {dayText(standing.last)}</span> : null}</span>
      </div>
      {tab === 'history' ? <HistoryView refId={ownUid ?? socialRef ?? ''} name={doc?.displayName ?? name} onOpen={openFrom} />
        : tab === 'saved' ? <SavedView />
        : <>
      <BuildHead o={{ res: true }} sort={sort} onSort={(k) => setSort((cur) => cur === k ? 'score' : k as Sort)} />
      <div id="list">
        {sorted.length ? sorted.map((x, i) => (
          <BuildRow key={x.buildId} x={x} i={i} o={{ res: true }} mine={own} open={open === x.buildId} onToggle={toggle(x.buildId)}>
            {ownUid ? <Owned x={x} onChanged={(message) => changed(message)} /> : null}
          </BuildRow>
        )) : <div className="empty">{own ? 'no builds yet... submit a card to add your first! :P' : 'no visible builds yet.'}</div>}
        {own && rows.length ? <div className="foot">that's all~</div> : null}
      </div>
      </>}

      {editing && profile ? <Suspense fallback={null}><ProfileEditor profile={profile} rows={rows} uid={ownUid} hideUid={hidden} anonymous={anonymous}
        onClose={() => setEditing(false)} onSaved={(message) => changed(message)} /></Suspense> : null}

      {own && ownUid ? (
        <div className="acct">
          {leaving ? <>
            <span>hold on... leaving hides {myUids.length > 1 ? `UID ${fmtUid(ownUid)}'s` : 'your'} builds from every board and erases its stored card images. you can rejoin later and submit a new card.</span>
            <button className="warn" onClick={() => { void lbApi.optOut(ownUid).then(() => { setLeaving(false); changed("you've left the boards. you can rejoin from your profile.") }, (e: unknown) => toast(errorText(e), true)) }}>Leave</button>
            <button onClick={() => setLeaving(false)}>Cancel</button>
          </> : <>
            <button onClick={signOut}>Sign out</button>
            {!optedOut ? <button onClick={() => setLeaving(true)}>Leave the boards</button> : null}
          </>}
        </div>
      ) : null}
    </main>
  )
}
