/*
  Author: Runor Ewhro
  description: the profiles index: every uid with a public profile, sorted, filtered and searched on the service.
*/

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Pin, Search } from 'lucide-react'
import type { ProfileListRow, ProfileSort } from '@/domain/leaderboard/api'
import { lbApi } from '../api/client'
import { lbq } from '../api/queries'
import { ownsUid } from '../chrome/chrome'
import { dayText, SERVERS } from '../model/format'
import { agoLong, fmtUid, plural, SERVER_INK } from '../model/listed'
import { playerPinned, togglePlayerPin, usePins } from '../model/pins'
import { Region } from '../components/build/BuildRow'
import { Ib } from '../components/IconButtons'
import { pvPlayer } from '../components/Preview'
import { Framed } from '../components/profile/Framed'
import { useScope } from '../state/ctx'
import { Rule } from './ActivityView'

const SORTS: Array<[ProfileSort, string]> = [['upload', 'Last upload'], ['age', 'Profile age'], ['builds', 'Builds'], ['name', 'Name']]
// how long typing rests before the search is sent
const TYPE_MS = 220

function Band({ x, own }: { x: ProfileListRow; own: boolean }) {
  const { go, playerTo } = useScope()
  const pins = usePins()
  const look = x.look
  const name = x.name ?? 'Unnamed'
  const who = { uid: x.uid, buildId: x.buildId }
  const to = playerTo(who)
  const pinned = playerPinned(pins, who)
  // a plain click moves in place like the app's links; a modified one opens a tab
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go(to)
  }
  return (
    <div className={`pix-row${look?.accent ? ' tuned' : ''}${look?.banner ? ' bn' : ''}`}
      style={look?.accent ? { '--pa': look.accent } as CSSProperties : undefined}>
      {look?.banner ? <Framed className="pix-bn" src={lbApi.mediaUrl(look.banner)} frame={look.bannerFrame} /> : null}
      <Link to={to} className="pix-hit" onClick={click} {...pvPlayer({ ...who, name: look?.displayName ?? x.name })}>
        {look?.avatar ? <Framed className="pix-av" src={lbApi.mediaUrl(look.avatar)} frame={look.avatarFrame} />
          : <span className="pix-av">{[...name.trim()][0]?.toUpperCase() ?? '?'}</span>}
        <i className="pix-div" aria-hidden="true" />
        <span className="pix-id">
          <span className="pix-l1">
            <b className="pix-nm">{name}</b>
            {x.uid ? <span className="pix-tag"><Region region={x.region} />{fmtUid(x.uid)}</span> : null}
            {own ? <span className="k-you">You</span> : null}
          </span>
          <span className="pix-l2">
            <span className="pix-bc">{plural(x.builds, 'build')}</span>
            <span className="pix-at">uploaded {agoLong(x.lastSeenAt)}</span>
            <span className="pix-at">joined {dayText(x.firstSeenAt)}</span>
            {x.bio ? <span className="pix-bio">{x.bio}</span> : null}
          </span>
        </span>
      </Link>
      <Ib icon={Pin} className="pix-pin" label={pinned ? `Unpin ${name}` : `Pin ${name}`} on={pinned}
        onClick={() => togglePlayerPin({ ...who, name, faces: x.resonators })} />
    </div>
  )
}

export function ProfilesView() {
  const { me, mine, boards } = useScope()
  const [sort, setSort] = useState<ProfileSort>('upload')
  const [reverse, setReverse] = useState(false)
  const [region, setRegion] = useState('')
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(typed.trim()), TYPE_MS)
    return () => window.clearTimeout(timer)
  }, [typed])

  const read = useInfiniteQuery({ ...lbq.profiles({ sort, reverse, region: region || undefined, q: q || undefined }), placeholderData: keepPreviousData })
  const rows = read.data?.pages.flatMap((page) => page.rows) ?? []
  const shown = read.data?.pages[0]?.total ?? null

  // the next page loads as the list's end comes near
  const end = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = read
  useEffect(() => {
    const el = end.current
    if (!el || !hasNextPage) return
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    }, { rootMargin: '900px 0px' })
    seen.observe(el)
    return () => seen.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // choosing the order in use reverses it
  const order = (key: ProfileSort) => {
    if (key === sort) setReverse((r) => !r)
    else { setSort(key); setReverse(false) }
  }
  const mineIds = new Set(mine?.builds.map((b) => b.buildId) ?? [])
  const clear = () => { setRegion(''); setTyped(''); setQ('') }

  return (
    <main className="lpage tp pix">
      <section className="tp-top">
        <div><Rule word="Leaderboards" /><h1 className="pg-h1">Profiles</h1>
          <span className="k-read">{boards?.profiles != null ? plural(boards.profiles, 'profile') : ' '}</span></div>
      </section>
      <div className="av-bar">
        <div className="flt"><span>Sort</span>{SORTS.map(([key, label]) => (
          <button key={key} className={sort === key ? 'on' : ''} onClick={() => order(key)}
            aria-label={sort === key ? `${label}, ${reverse ? 'reversed' : 'usual order'}` : label}>
            {label}{sort === key ? reverse ? <ChevronUp size={10} strokeWidth={2.6} /> : <ChevronDown size={10} strokeWidth={2.6} /> : null}
          </button>))}</div>
        <div className="flt pix-sv"><span>Server</span>
          <button className={region ? '' : 'on'} onClick={() => setRegion('')}>All</button>
          {Object.entries(SERVERS).map(([digit, server]) => (
            <button key={digit} className={`rg${region === digit ? ' on' : ''}`} title={server.name} style={{ '--rc': SERVER_INK[digit] } as CSSProperties}
              onClick={() => setRegion(digit)}>{server.code}</button>))}
        </div>
        <span className="k-read">{shown != null ? `${shown.toLocaleString('en-US')} shown` : ''}</span><span className="sp" />
        <label className="fld"><Search size={12} strokeWidth={2.4} /><input value={typed} onChange={(event) => setTyped(event.target.value)}
          placeholder="filter by name or UID" autoComplete="off" aria-label="filter by name or UID" /></label>
      </div>
      <div className={`pix-list${read.isPlaceholderData ? ' wait' : ''}`}>
        {read.isError && !rows.length ? <div className="empty">hmm... the profiles didn't load. <button onClick={() => void read.refetch()}>Try again</button></div>
          : !read.data ? <div className="empty">loading the profiles... :P</div>
          : rows.length ? rows.map((x) => <Band key={x.uid ?? x.buildId} x={x} own={ownsUid(me, x.uid) || mineIds.has(x.buildId)} />)
          : <div className="empty">{region || q ? <>hmm... no profiles match these filters. <button onClick={clear}>Clear filters</button></> : 'no profiles yet... check back later :P'}</div>}
      </div>
      <div ref={end} className="pix-end" aria-hidden="true" />
    </main>
  )
}
