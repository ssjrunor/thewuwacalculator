/*
  Author: Runor Ewhro
  description: the leaderboard (Scope): a sticky channel band (a well per page,
               the finder and the Pinned channel) over its pages.

  routes: /leaderboard                        latest activity, the main page
          /leaderboard/boards                 the top build on every board
          /leaderboard/:resonatorId           one board, its dial folding into a sticky bar
          /leaderboard/me                     the viewer's profile
          /leaderboard/staff                  the staff queues (tab shown to moderators and admins)
          /leaderboard/player/:uid            a player
          /leaderboard/player/build/:buildId  a player with a hidden uid
          ?build=<id> opens that build's row.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { can } from '@/domain/leaderboard/permissions'
import { notify, ownsUid, sessionOf, useLbChrome, watchMe } from '../chrome/chrome'
import { invalidateLb, LIVE_MS, lbq } from '../api/queries'
import { resFace, resName } from '../model/format'
import { playerPath, type Who } from '../model/players'
import { ScopeCtx, type ScopeCtxValue } from '../state/ctx'
import { boardPath, dayKey, LB, plural, scroller } from '../model/listed'
import { seenPlayers } from '../model/seen'
import { ActivityView } from './ActivityView'
import { BoardsView } from './BoardsView'
import { BoardView } from './BoardView'
import { preloadFigures } from '../components/build/BuildRow'
import { markPage } from '@/shared/lib/timingLog'
import { ProfileView } from './ProfileView'
import { StaffView } from './StaffView'
import { PreviewLayer } from '../components/Preview'
import { KitHoverLayer } from '../components/build/KitHover'
import { Channels, type Tab } from '../components/Channels'

type View =
  | { page: 'activity' }
  | { page: 'boards' }
  | { page: 'board'; resonatorId: string }
  | { page: 'me' }
  | { page: 'staff' }
  | { page: 'player'; who: Who }

function viewOf(pathname: string): View {
  const rest = pathname.slice(LB.length).split('/').filter(Boolean)
  if (rest[0] === 'boards') return { page: 'boards' }
  if (rest[0] === 'me') return { page: 'me' }
  if (rest[0] === 'staff') return { page: 'staff' }
  if (rest[0] === 'player') return rest[1] === 'build' ? { page: 'player', who: { uid: null, buildId: rest[2] ?? '' } } : { page: 'player', who: { uid: rest[1] ?? null, buildId: '' } }
  if (rest[0] && /^\d{4}$/.test(rest[0])) return { page: 'board', resonatorId: rest[0] }
  return { page: 'activity' }
}

/** the Activity channel's count: today's uploads from the activity strip's quarter hours. */
const todayOf = (r: { slots: Array<{ at: number; entries: number }> }) => {
  const day = dayKey(Date.now())
  return r.slots.filter((s) => dayKey(s.at) === day).reduce((n, s) => n + s.entries, 0)
}

function Finder({ ctx }: { ctx: ScopeCtxValue }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const t = event.target as HTMLElement
      if (event.key === '/' && !t.closest('input, textarea, select, [contenteditable]')) { event.preventDefault(); input.current?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const term = q.trim().toLowerCase()
  const digits = term.replace(/\s/g, '')
  const boards = term ? (ctx.boards?.boards ?? []).filter((b) => resName(b.resonatorId).toLowerCase().includes(term)).slice(0, 4) : []
  const players = term ? [...seenPlayers.values()].filter((p) => (p.name ?? '').toLowerCase().includes(term) || (p.uid ?? '').includes(digits)).slice(0, 5) : []
  const uid = /^\d{9}$/.test(digits) && !players.some((p) => p.uid === digits) ? digits : null
  const pick = (path: string) => { setQ(''); setOpen(false); input.current?.blur(); ctx.go(path) }
  const first = boards[0] ? boardPath(boards[0].resonatorId) : players[0] ? playerPath(players[0]) : uid ? `${LB}/player/${uid}` : null
  return (
    <div className="gfind">
      <label className="fld"><Search size={12} strokeWidth={2.4} />
        <input ref={input} value={q} placeholder="find a board, a seen player or a full UID" autoComplete="off" aria-label="find a board, a seen player or a full UID"
          onChange={(event) => { setQ(event.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => { if (event.key === 'Enter' && first) pick(first); if (event.key === 'Escape') { setOpen(false); event.currentTarget.blur() } }} />
        <kbd>/</kbd>
      </label>
      <div className={`gres${open && term ? ' on' : ''}`}>
        {boards.length ? <><h6>Boards</h6>{boards.map((b, i) => (
          <button key={b.resonatorId} className={i === 0 ? 'hl' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(boardPath(b.resonatorId))}>
            <img src={resFace(b.resonatorId)} alt="" />{resName(b.resonatorId)}<small>{plural(b.total, 'build')}</small>
          </button>))}</> : null}
        {players.length ? <><h6>Players</h6>{players.map((p, i) => (
          <button key={p.uid ?? p.buildId} className={!boards.length && i === 0 ? 'hl' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(playerPath(p))}>
            <span className="mono">{(p.name ?? '?')[0].toUpperCase()}</span>{p.name ?? 'Unnamed'}{p.uid ? <small>UID {p.uid}</small> : null}
          </button>))}</> : null}
        {uid ? <><h6>UID</h6><button className={boards.length + players.length ? '' : 'hl'} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(`${LB}/player/${uid}`)}>
          <span className="mono">#</span>Open player {uid}</button></> : null}
        {term && !boards.length && !players.length && !uid ? <div className="none">hmm... no board or previously seen player matches "{q.trim()}". try a full 9-digit UID to open a player directly :P</div> : null}
      </div>
    </div>
  )
}

export function ScopePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const view = viewOf(location.pathname)
  // the opened-build code comes after the page has painted, before anyone opens a row.
  useEffect(() => {
    markPage('leaderboard page mounted')
    preloadFigures()
  }, [])

  // the viewer comes from the chrome's single /me observer (started by the header on every page); each region below
  // reads its own key and draws when it loads, independent of the others. a settled card from the submit dock or a
  // viewer change invalidates every key (chrome noteSettled, changed below), and lists others write to refetch each
  // minute in view
  useEffect(() => watchMe(), [])
  const me = useLbChrome((s) => s.me)
  const session = useLbChrome(sessionOf)
  const boards = useQuery({ ...lbq.boards(), refetchInterval: LIVE_MS }).data ?? null
  const live = useQuery(lbq.live()).data ?? null
  // additive reads (a count, the viewer's standings) start once the viewer is known, after the rest
  const known = session !== 'unknown'
  const today = useQuery({ ...lbq.activity(1), select: todayOf, enabled: known, refetchInterval: LIVE_MS }).data ?? null
  // the viewer's standings: every build of every uid of theirs, read privately
  const mineRead = useQuery({ ...lbq.myProfile(), enabled: Boolean(me?.uids.length) }).data ?? null
  // a disabled query still returns cached data, so viewers with no uid get no standings
  const mine = me?.uids.length ? mineRead : null
  const toast = notify

  const go = useCallback((path: string) => {
    navigate(path)
    scroller()?.scrollTo({ top: 0 })
  }, [navigate])
  const playerTo = useCallback((who: Who) => ownsUid(me, who.uid) ? `${LB}/me` : playerPath(who), [me])
  const changed = useCallback((message?: string) => {
    void invalidateLb()
    if (message) notify(message)
  }, [])

  const ctx = useMemo<ScopeCtxValue>(() => ({ me, session, mine, boards, live, go, playerTo, changed, toast }),
    [me, session, mine, boards, live, go, playerTo, changed, toast])

  const tab: Tab = view.page === 'activity' ? 'activity' : view.page === 'boards' || view.page === 'board' ? 'boards' : view.page === 'me' ? 'me'
    : view.page === 'staff' ? 'staff' : null
  const staff = can(me?.account?.role ?? 'user', 'reports.review')

  return (
    <ScopeCtx.Provider value={ctx}>
      <div className="lbs">
        <Channels ctx={ctx} tab={tab} staff={staff} today={today} finder={<Finder ctx={ctx} />} />
        {view.page === 'activity' ? <ActivityView />
          : view.page === 'boards' ? <BoardsView />
          : view.page === 'board' ? <BoardView key={view.resonatorId} resonatorId={view.resonatorId} />
          : view.page === 'me' ? <ProfileView who={null} own />
          : view.page === 'staff' ? <StaffView />
          : <ProfileView key={view.who.uid ?? view.who.buildId} who={view.who} own={ownsUid(me, view.who.uid)} />}
        <PreviewLayer />
        <KitHoverLayer />
      </div>
    </ScopeCtx.Provider>
  )
}

export default ScopePage
