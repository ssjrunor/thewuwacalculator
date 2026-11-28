/*
  Author: Runor Ewhro
  description: the leaderboard activity page: daily upload counts and recent uploads.
*/

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import type { ActivityRow } from '@/domain/leaderboard/api'
import { ACTIVITY_DAYS, ACTIVITY_ROWS, LIVE_MS, activityFrom, lbq } from '../api/queries'
import { errorText, noRuleset } from '../model/cardTrack'
import { grp, resName } from '../model/format'
import { usePins } from '../model/pins'
import { BuildHead, BuildRow } from '../components/build/BuildRow'
import { useScope } from '../state/ctx'
import { BoardRef, PlayerRef } from '../components/Ref'
import { playerName } from '../model/players'
import { agoLong, dayKey, dayLabel, entries, fromActivity, hm, plural, scroller, type Row } from '../model/listed'
import { seeRows } from '../model/seen'
import { toggler, useOpen } from '../state/useOpen'
import { ownsUid } from '../chrome/chrome'

const LIMIT = ACTIVITY_ROWS
type Kind = '' | 'top' | 'top10' | 'pins' | 'mine'
const KINDS: Array<[Kind, string]> = [['', 'Everything'], ['top', 'At #1'], ['top10', 'Top 10'], ['pins', 'Pinned'], ['mine', 'Yours']]

// an upload and its row; one off its board lists unranked
interface Item { row: ActivityRow; x: Row }

export function Rule({ word }: { word: string }) {
  return <div className="k-rule"><i /><b>{word}</b><i /></div>
}

interface Cell { entries: number; tops: number; me: boolean }
interface Day { key: string; t: number; entries: number; tops: number; cells: Cell[] }
// a day is twelve two-hour cells
const CELLS = 12
const clock = (h: number) => `${String(h).padStart(2, '0')}:00`

function Strip({ days, day, onDay }: { days: Day[]; day: string | null; onDay: (key: string) => void }) {
  const [hover, setHover] = useState<{ d: Day; h: number | null } | null>(null)
  // square-root ink: a burst in one cell stays the brightest without blanking the quiet ones
  const mx = Math.max(1, ...days.flatMap((d) => d.cells.map((x) => x.entries)))
  const all = days.reduce((n, d) => n + d.entries, 0)
  const tops = days.reduce((n, d) => n + d.tops, 0)
  const say = (d: Day, h: number | null) => {
    const x = h == null ? d : d.cells[h]
    return <><b>{dayLabel(d.t)}{h == null ? null : `, ${clock(h * 2)} to ${clock(h * 2 + 2)}`}</b> {entries(x.entries)}{x.tops ? <>, <em className="t">{x.tops} at #1</em></> : null}</>
  }
  const picked = day ? days.find((d) => d.key === day) ?? null : null
  const last = days.length - 1
  return (
    <section className="avs" aria-label="Entries per day">
      <div className="avs-head">
        <span className="avs-read">{hover ? say(hover.d, hover.h) : picked ? say(picked, null)
          : <><b>Last {plural(days.length, 'day')}</b> {entries(all)}, <em className="t">{tops} at #1</em></>}</span>
        <span className="avs-key"><span>Fewer<i className="ramp" />More</span><span><i className="avs-c me" />Yours</span></span>
      </div>
      <div className="avs-plot" onMouseLeave={() => setHover(null)}>
        <span className="avs-hrs" aria-hidden="true"><i>00</i><i>06</i><i>12</i><i>18</i></span>
        {days.map((d, c) => {
          const dt = new Date(d.t)
          return (
            <button key={d.key} className={`avs-d${day === d.key ? ' on' : ''}${day && day !== d.key ? ' off' : ''}`} onClick={() => onDay(d.key)}
              onMouseEnter={() => setHover({ d, h: null })} onFocus={() => setHover({ d, h: null })} aria-label={`${dayLabel(d.t)}: ${entries(d.entries)}`}>
              <span className="avs-n">{d.entries ? d.entries.toLocaleString('en-US') : ''}</span>
              <span className="avs-cells">{d.cells.map((x, h) => (
                <i key={h} className={`avs-c${x.me ? ' me' : ''}`} onMouseEnter={() => setHover({ d, h })} onMouseLeave={() => setHover({ d, h: null })}
                  style={{ '--c': c, '--a': `${x.entries ? (8 + 80 * Math.sqrt(x.entries / mx)).toFixed(1) : 3.5}%` } as CSSProperties} />
              ))}</span>
              <span className="avs-ax" /><span className="avs-gap" />
              <span className="avs-x"><b>{c === last ? 'Today' : dt.getDate()}</b><i>{c === last ? '' : dt.toLocaleDateString('en-US', { weekday: 'short' })}</i></span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function ActivityView() {
  const { me, boards } = useScope()
  const pins = usePins()
  // other players' uploads appear here too: refetch each minute in view while showing the last data
  // the per-board counts cover the strip's days; the key moves at local midnight with the strip
  const from = activityFrom()
  const activity = useQuery({ ...lbq.activity(LIMIT, from), refetchInterval: LIVE_MS, placeholderData: keepPreviousData })
  const data = activity.data ?? null
  const error = activity.error
  const [params] = useSearchParams()
  // the Pinned list's "show their builds" links here with ?kind=pins
  const [kind, setKind] = useState<Kind>(() => KINDS.find(([k]) => k && k === params.get('kind'))?.[0] ?? '')
  const [cur, setCur] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useOpen()
  const toggle = toggler(open, setOpen)

  const items = useMemo<Item[]>(() => {
    // an entry's board size can lag the index; the index is the newer count
    const totals = new Map((boards?.boards ?? []).map((b) => [b.resonatorId, b.total]))
    return (data?.rows ?? []).map((row) => {
      const x = fromActivity(row)
      return { row, x: { ...x, total: Math.max(x.total, totals.get(x.resonatorId) ?? 0) } }
    })
  }, [data, boards])
  useEffect(() => seeRows(items.map((it) => it.x)), [items])
  const rows = useMemo(() => items.map((it) => it.row), [items])

  const days = useMemo<Day[]>(() => {
    // the strip counts every write from the server's quarter hours; rows are only the newest few
    const slots = data?.slots ?? rows.map((x) => ({ at: x.at, entries: 1, tops: x.rank === 1 ? 1 : 0 }))
    const end = new Date(); end.setHours(0, 0, 0, 0)
    const out: Day[] = []
    // step by calendar day, so daylight saving changes never repeat a date
    for (const c = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (ACTIVITY_DAYS - 1)); c <= end; c.setDate(c.getDate() + 1)) {
      out.push({ key: dayKey(c.getTime()), t: c.getTime(), entries: 0, tops: 0, cells: Array.from({ length: CELLS }, () => ({ entries: 0, tops: 0, me: false })) })
    }
    const byKey = new Map(out.map((d) => [d.key, d]))
    const cellOf = (at: number) => {
      const d = byKey.get(dayKey(at))
      return d ? { d, x: d.cells[Math.floor(new Date(at).getHours() / 2)] } : null
    }
    for (const slot of slots) {
      const hit = cellOf(slot.at)
      if (!hit) continue
      hit.d.entries += slot.entries; hit.d.tops += slot.tops
      hit.x.entries += slot.entries; hit.x.tops += slot.tops
    }
    for (const x of rows) if (ownsUid(me, x.uid)) { const hit = cellOf(x.at); if (hit) hit.x.me = true }
    return out
  }, [data, rows, me])
  const total = days.reduce((n, d) => n + d.entries, 0)

  const term = q.trim().toLowerCase()
  const visible = items.filter(({ row: x }) => {
    if (day && dayKey(x.at) !== day) return false
    if (kind === 'top' && x.rank !== 1) return false
    if (kind === 'top10' && (x.rank == null || x.rank > 10)) return false
    if (kind === 'pins' && !(pins.boards.includes(x.resonatorId) || pins.players.some((p) => (p.uid && p.uid === x.uid) || p.buildId === x.buildId))) return false
    if (kind === 'mine' && !ownsUid(me, x.uid)) return false
    if (term && !((x.name ?? '').toLowerCase().includes(term) || resName(x.resonatorId).toLowerCase().includes(term))) return false
    return true
  })
  const groups: Array<{ key: string; t: number; rows: Item[] }> = []
  for (const it of visible) {
    const key = dayKey(it.row.at)
    if (groups[groups.length - 1]?.key !== key) groups.push({ key, t: it.row.at, rows: [] })
    groups[groups.length - 1].rows.push(it)
  }

  const here = new Set(groups.map((g) => g.key))
  // go to a day's entries, under the sticky bars; a day older than the loaded entries is applied as a filter
  const goDay = (key: string) => {
    const s = scroller(), el = s?.querySelector<HTMLElement>(`.feed [data-day="${key}"]`)
    if (!s || !el || day) { setDay((d) => d === key ? null : key); setOpen(null); return }
    const bars = ['.chb', '.av-bar', '.av-bar + .colh'].reduce((h, sel) => h + (s.querySelector<HTMLElement>(`.lbs ${sel}`)?.offsetHeight ?? 0), 0)
    s.scrollTo({ top: el.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - bars, behavior: 'smooth' })
  }
  // the day at the top of the list, for the bar's strip
  const track = useCallback(() => {
    const s = scroller()
    if (!s) return
    const line = s.getBoundingClientRect().top + ['.chb', '.av-bar', '.av-bar + .colh'].reduce((h, sel) => h + (s.querySelector<HTMLElement>(`.lbs ${sel}`)?.offsetHeight ?? 0), 0) + 48
    let at: string | null = null
    for (const el of s.querySelectorAll<HTMLElement>('.feed [data-day]')) { if (el.getBoundingClientRect().top <= line) at = el.dataset.day ?? null; else break }
    setCur((c) => c === at ? c : at)
  }, [])
  useEffect(() => {
    const s = scroller()
    let frame = 0
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; track() }) }
    s?.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { cancelAnimationFrame(frame); s?.removeEventListener('scroll', onScroll) }
  }, [track, data])
  const dmx = Math.max(1, ...days.map((d) => d.entries))
  const curDay = days.find((d) => d.key === (cur ?? groups[0]?.key)) ?? null

  const latest = rows[0] ?? null
  // every upload over the strip's days, per board, loaded rows or not: the figures match the header's count
  const counts = data?.boards.counts ?? []
  const most = Math.max(0, ...counts.map((b) => b.entries))
  const busiest = counts.filter((b) => b.entries === most).sort((a, b) => resName(a.resonatorId).localeCompare(resName(b.resonatorId)))
  const busy = most ? busiest[0] : null
  // a day's loaded rows against its count on the strip: the oldest loaded day is often only partly loaded
  const dayCount = (key: string, shown: number) => {
    const all = days.find((d) => d.key === key)?.entries ?? 0
    return !kind && !term && all > shown ? `${shown} of ${entries(all)}` : entries(shown)
  }
  const clear = () => { setKind(''); setDay(null); setQ('') }
  let n = 0

  return (
    <main className="lpage av">
      <section className="av-top">
        <div><Rule word="Leaderboard" /><h1 className="pg-h1">Latest activity</h1>
          <span className="k-read">{data ? `${plural(data.builds.ranked + data.builds.unranked, 'build')}: ${grp(data.builds.ranked)} ranked, ${grp(data.builds.unranked)} unranked` : ' '}</span></div>
        {latest ? (
          <div className="av-cells">
            <div><span>Last upload</span><b>{agoLong(latest.at)}</b><em><PlayerRef who={latest}>{playerName(latest)}</PlayerRef> on <BoardRef id={latest.resonatorId}>{resName(latest.resonatorId)}</BoardRef></em></div>
            {busy ? <div><span>Busiest board</span><b><BoardRef id={busy.resonatorId}>{resName(busy.resonatorId)}</BoardRef></b>
              <em>{entries(busy.entries)}{busiest.length > 1 ? `, tied with ${busiest.length - 1}` : ''}</em></div> : null}
          </div>
        ) : null}
      </section>

      {data && total ? <Strip days={days} day={day} onDay={goDay} /> : null}

      <div className="av-bar">
        <div className="flt">{KINDS.map(([key, label]) => <button key={key} className={kind === key ? 'on' : ''} onClick={() => { setKind(key); setOpen(null) }}>{label}</button>)}</div>
        {day ? <span className="chip">{dayLabel(days.find((d) => d.key === day)?.t ?? Date.now())}<i role="button" aria-label="Show every day" onClick={() => setDay(null)}>×</i></span> : null}
        <span className="k-read">{entries(visible.length)}</span><span className="sp" />
        {data && total && !day ? <>
          <div className="bdays" role="group" aria-label="Go to a day">{days.map((d) => (
            <button key={d.key} className={curDay?.key === d.key ? 'on' : ''} disabled={!here.has(d.key)} onClick={() => goDay(d.key)}
              title={`${dayLabel(d.t)}: ${entries(d.entries)}${here.has(d.key) ? '' : ', older than the loaded entries'}`}
              style={{ '--a': d.entries ? (10 + 50 * Math.sqrt(d.entries / dmx)).toFixed(1) : 4 } as CSSProperties} />
          ))}</div>
          <span className="k-read bday">{curDay ? dayLabel(curDay.t) : ''}</span>
        </> : null}
        <label className="fld"><Search size={12} strokeWidth={2.4} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Filter by player or resonator" autoComplete="off" aria-label="Filter by player or resonator" /></label>
      </div>

      <BuildHead o={{ lead: { kind: 'up', text: '' }, res: true }} />
      <div className="feed">
        {error && !data ? <div className="empty">{noRuleset(error) ? "no boards yet... scoring hasn't started. check back later :P" : errorText(error)}</div>
          : !data ? <div className="empty">assembling the latest entries... :P</div>
          : groups.length ? groups.map((g) => (
            <div key={g.key} data-day={g.key}>
              <div className="day"><b>{dayLabel(g.t)}</b><span>{dayCount(g.key, g.rows.length)}</span><i /></div>
              {g.rows.map(({ x }) => (
                <BuildRow key={x.buildId} x={x} i={n++} open={open === x.buildId} onToggle={toggle(x.buildId)}
                  o={{ lead: { kind: x.rank === 1 ? 'top' : 'up', text: hm(x.at) }, res: true }} />))}
            </div>
          ))
          : <div className="empty">{day && !rows.some((x) => dayKey(x.at) === day) ? <>hmm... this day has no entries in the latest {LIMIT} uploads we loaded. try another day :P <button onClick={() => setDay(null)}>Show every day</button></>
            : rows.length ? <>hmm... no loaded entries match these filters. <button onClick={clear}>Clear filters</button></> : 'no uploads yet... yours could be the first! :P'}</div>}
      </div>
      {rows.length >= LIMIT ? <div className="foot">The latest <b>{LIMIT}</b> entries.</div> : null}
    </main>
  )
}
