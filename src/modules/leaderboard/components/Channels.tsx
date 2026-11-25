/*
  Author: Runor Ewhro
  description: the leaderboard channel band: one sticky band under the app
               header with a well per page (Activity, Boards, You, Staff) and its
               count, the finder, and the Pinned channel. Pinned opens a list of
               the viewer's pinned players and boards for any number of pins,
               with a filter, newest uploads first (signed in, from the account's
               feed) or A to Z, and an unpin per item.
*/

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Activity, CircleUserRound, LayoutGrid, Pin, Search, ShieldCheck, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { FeedResponse } from '@/domain/leaderboard/api'
import { queryClient } from '@/shared/lib/queryClient'
import { lbApi } from '../api/client'
import { LIVE_MS, lbKeys, lbq } from '../api/queries'
import { grp, resFace, resName } from '../model/format'
import { rankedOf } from '../model/players'
import { toggleBoardPin, togglePlayerPin, usePins, type PinnedPlayer } from '../model/pins'
import type { ScopeCtxValue } from '../state/ctx'
import { agoLong, boardPath, LB, plural, share } from '../model/listed'

export type Tab = 'activity' | 'boards' | 'me' | 'staff' | null

/** what the feed says of one pinned player or board: uploads since the feed was last read, and the latest one. */
interface Heard { fresh: number; at: number }

function heardOf(feed: FeedResponse | null) {
  const players = new Map<string, Heard>(), boards = new Map<string, Heard>()
  if (!feed) return { players, boards }
  const seen = feed.seenAt ?? 0
  const add = (m: Map<string, Heard>, k: string, at: number) => {
    const h = m.get(k) ?? { fresh: 0, at: 0 }
    m.set(k, { fresh: h.fresh + (at > seen ? 1 : 0), at: Math.max(h.at, at) })
  }
  for (const row of feed.rows) {
    if (row.uid) add(players, 'u:' + row.uid, row.at)
    add(players, 'b:' + row.buildId, row.at)
    add(boards, row.resonatorId, row.at)
  }
  return { players, boards }
}
const heardFor = (m: Map<string, Heard>, p: PinnedPlayer): Heard | null => (p.uid ? m.get('u:' + p.uid) : null) ?? m.get('b:' + p.buildId) ?? null

function PinnedList({ ctx, feed, onClose }: { ctx: ScopeCtxValue; feed: FeedResponse | null; onClose: () => void }) {
  const pins = usePins()
  const [tab, setTab] = useState<'players' | 'boards'>('players')
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<'new' | 'az'>(feed ? 'new' : 'az')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [tab])
  const heard = useMemo(() => heardOf(feed), [feed])
  const term = q.trim().toLowerCase()
  const go = (path: string) => { onClose(); ctx.go(path) }

  const players = useMemo(() => {
    const list = pins.players.filter((p) => !term || p.name.toLowerCase().includes(term) || (p.uid ?? '').includes(term.replace(/\s/g, '')))
      .map((p) => ({ p, h: heardFor(heard.players, p) }))
    return order === 'az' || !feed ? list.sort((a, b) => a.p.name.localeCompare(b.p.name))
      : list.sort((a, b) => (b.h?.fresh ? 1 : 0) - (a.h?.fresh ? 1 : 0) || (b.h?.at ?? 0) - (a.h?.at ?? 0) || a.p.name.localeCompare(b.p.name))
  }, [pins.players, term, heard, order, feed])
  const fresh = players.filter((x) => x.h?.fresh)
  const rest = order === 'new' && feed ? players.filter((x) => !x.h?.fresh) : players

  const mine = rankedOf(ctx.mine)
  const boards = pins.boards.filter((id) => !term || resName(id).toLowerCase().includes(term))
  const totals = new Map((ctx.boards?.boards ?? []).map((b) => [b.resonatorId, b.total]))

  const prow = ({ p, h }: { p: PinnedPlayer; h: Heard | null }) => (
    <div key={p.uid ?? p.buildId} className="pr" role="button" tabIndex={0} onClick={() => go(ctx.playerTo(p))}
      onKeyDown={(event) => { if (event.key === 'Enter') go(ctx.playerTo(p)) }}>
      <span className="mono">{p.name[0]?.toUpperCase() ?? '?'}</span>
      <span className="pr-n">{p.name}{p.uid ? <small>UID {p.uid}</small> : null}</span>
      <span className="pr-r">
        {h?.fresh ? <span className="nw">{h.fresh} new</span> : null}
        {p.faces.slice(0, 3).map((id) => <img key={id} src={resFace(id)} alt={resName(id)} title={resName(id)} />)}
        {h ? <span>{agoLong(h.at)}</span> : null}
        <i role="button" className="unp" aria-label={`Unpin ${p.name}`} title="Unpin" onClick={(event) => { event.stopPropagation(); togglePlayerPin(p) }}><X size={10} strokeWidth={2.4} /></i>
      </span>
    </div>
  )

  return (
    <div className="bpop on" role="dialog" aria-label="Pinned">
      <div className="bpop-h">
        <h2 className="k-ttl">Pinned</h2>
        <div className="flt">
          <button className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>Players {pins.players.length}</button>
          <button className={tab === 'boards' ? 'on' : ''} onClick={() => setTab('boards')}>Boards {pins.boards.length}</button>
        </div>
      </div>
      <label className="fld"><Search size={12} strokeWidth={2.4} />
        <input ref={input} value={q} onChange={(event) => setQ(event.target.value)} autoComplete="off"
          placeholder={tab === 'players' ? `Filter ${plural(pins.players.length, 'player')}` : `Filter ${plural(pins.boards.length, 'board')}`}
          aria-label="Filter pins" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }} />
      </label>
      {tab === 'players' && feed ? (
        <div className="bpop-tools"><div className="flt"><span>Order</span>
          <button className={order === 'new' ? 'on' : ''} onClick={() => setOrder('new')}>Latest upload</button>
          <button className={order === 'az' ? 'on' : ''} onClick={() => setOrder('az')}>A to Z</button>
        </div></div>
      ) : null}
      <div className="bpop-l">
        {tab === 'players'
          ? !pins.players.length ? <div className="empty">no pinned players yet! open a profile and pin someone to keep them here :P</div>
            : !players.length ? <div className="empty">hmm... no pinned player matches "{q.trim()}".</div>
            : <>
              {order === 'new' && fresh.length ? <><h6>New builds <b>{fresh.length}</b></h6>{fresh.map(prow)}</> : null}
              {order === 'new' && fresh.length && rest.length ? <h6>Earlier</h6> : null}
              {rest.map(prow)}
            </>
          : !pins.boards.length ? <div className="empty">no pinned boards yet! pin one from its board page :P</div>
            : !boards.length ? <div className="empty">hmm... no pinned board matches "{q.trim()}".</div>
            : boards.map((id) => {
              const b = mine.find((x) => x.resonatorId === id), h = heard.boards.get(id), total = totals.get(id) ?? 0
              return (
                <div key={id} className="pr" role="button" tabIndex={0} onClick={() => go(boardPath(id))} onKeyDown={(event) => { if (event.key === 'Enter') go(boardPath(id)) }}>
                  <img src={resFace(id)} alt="" />
                  <span className="pr-n">{resName(id)}<small>{plural(total, 'build')}</small></span>
                  <span className="pr-r">
                    {h?.fresh ? <span className="nw">{h.fresh} new</span> : null}
                    {b ? <span>you, top {share(b.rank, Math.max(b.total, total))}%</span> : null}
                    <i role="button" className="unp" aria-label={`Unpin ${resName(id)}`} title="Unpin" onClick={(event) => { event.stopPropagation(); toggleBoardPin(id) }}><X size={10} strokeWidth={2.4} /></i>
                  </span>
                </div>
              )
            })}
      </div>
      <div className="bpop-f">
        {feed ? <><span>{fresh.length ? `${plural(fresh.length, 'player')} uploaded since you last looked` : 'Nothing new since you last looked'}</span>
          <button onClick={() => go(`${LB}?kind=pins`)}>Show their builds</button></>
          : <span>your pins stay in this browser. sign in to sync them across devices :P</span>}
      </div>
    </div>
  )
}

export function Channels({ ctx, tab, staff, today, finder }: { ctx: ScopeCtxValue; tab: Tab; staff: boolean; today: number | null; finder: ReactNode }) {
  const pins = usePins()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const account = ctx.me?.account?.id ?? null
  // the feed marks pins that uploaded since the viewer's last look; it requires an account and is keyed by it, waits
  // for the page's own reads, and refetches each minute in view
  const feed = useQuery({ ...lbq.feed(account ?? ''), enabled: Boolean(account), refetchInterval: LIVE_MS }).data ?? null
  const setFeed = (next: FeedResponse) => { if (account) queryClient.setQueryData(lbKeys.feed(account), next) }

  const heard = useMemo(() => heardOf(feed), [feed])
  const fresh = feed ? pins.players.filter((p) => heardFor(heard.players, p)?.fresh).length : 0

  // closing the list after reading it marks the feed read.
  const close = () => {
    setOpen(false)
    if (feed && fresh) { lbApi.feedSeen().catch(() => undefined); setFeed({ ...feed, seenAt: Date.now(), fresh: 0 }) }
  }
  useEffect(() => {
    if (!open) return
    const down = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) close() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key) }
  })

  const mine = ctx.mine?.builds.length ?? 0
  const ch = (key: Exclude<Tab, null>, path: string, icon: ReactNode, label: string, sub: string) => (
    <button className={`ch${tab === key ? ' on' : ''}`} onClick={() => ctx.go(path)} aria-current={tab === key ? 'page' : undefined}>
      <span className="k-well">{icon}</span><span className="ch-t"><b>{label}</b><small>{sub}</small></span>
    </button>
  )
  return (
    <nav className="chb" aria-label="Leaderboard">
      {ch('activity', LB, <Activity size={14} strokeWidth={2.2} />, 'Activity', today == null ? 'Latest' : `${grp(today)} today`)}
      {ch('boards', `${LB}/boards`, <LayoutGrid size={14} strokeWidth={2.2} />, 'Boards', ctx.boards ? plural(ctx.boards.boards.length, 'board') : 'Every board')}
      {ch('me', `${LB}/me`, <CircleUserRound size={14} strokeWidth={2.2} />, 'You', ctx.session === 'unknown' ? 'Profile' : ctx.me?.uids.length ? plural(mine, 'build') : 'Sign in')}
      {staff ? ch('staff', `${LB}/staff`, <ShieldCheck size={14} strokeWidth={2.2} />, 'Staff', 'Queues') : null}
      <span className="sp" />
      {finder}
      <div className="pinw" ref={box}>
        <button className={`ch pinch${open ? ' open' : ''}`} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
          <span className="k-well"><Pin size={14} strokeWidth={2.2} />{fresh ? <em className="bdg">{fresh}</em> : null}</span>
          <span className="ch-t"><b>Pinned</b><small>{pins.players.length + pins.boards.length
            ? `${plural(pins.players.length, 'player')}, ${plural(pins.boards.length, 'board')}` : 'Nothing yet'}</small></span>
        </button>
        {open ? <PinnedList ctx={ctx} feed={feed} onClose={close} /> : null}
      </div>
    </nav>
  )
}
