/*
  Author: Runor Ewhro
  description: one board. the dial draws every build as one line, ranked
               clockwise from the top, longer for a higher build score. the head
               scrolls with the page; the Builds bar and the column head stick
               under the band, and once stuck the bar shows the board's face and
               name, with a map line under the column head showing the rows in
               view, the viewer's build and the top % marks (press or drag it to
               move). the list is the whole board, with pages loaded where the
               viewer looks. G, Y, J and K go to the top, the viewer's build, and
               row by row; the find field accepts a rank (#500), a share (10%) or
               "me", or filters loaded rows by player. team wells (keys 1-5),
               weapon wells (Q W E R T), server and sequence filter on the
               service, and signed-in viewers can save filters as named views.
*/

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { BoardResponse, ScenarioSummary } from '@/domain/leaderboard/api'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay'
import { queryClient } from '@/shared/lib/queryClient'
import { LIVE_MS, lbq } from '../api/queries'
import { errorText, noRuleset } from '../model/cardTrack'
import { grp, resAttr, resColor, resFace, resName, SERVERS, wpnOf } from '../model/format'
import { boardPinned, toggleBoardPin, usePins } from '../model/pins'
import { playerName, rankedOf } from '../model/players'
import { PinIb } from '../components/IconButtons'
import { Rule } from './ActivityView'
import { BoardList, type ListApi } from '../components/board/BoardList'
import { BuildHead, BuildRow, Region } from '../components/build/BuildRow'
import { useScope } from '../state/ctx'
import { SavedBoardFilters } from '../components/board/SavedBoardFilters'
import { clamp, eout, fromBoard, lerp, plural, reduced, scroller, share, shareSpan, type Listed } from '../model/listed'
import { seeRows } from '../model/seen'
import { useOpen } from '../state/useOpen'
import { ownsUid } from '../chrome/chrome'

const PAGE = 100
const DIAL = { cx: 584, cy: 252, r0: 126, L: 58 }
const ang = (i: number, N: number) => (270 + i / N * 340) * Math.PI / 180
const polarAt = (i: number, N: number, r: number): [number, number] => [DIAL.cx + Math.cos(ang(i, N)) * r, DIAL.cy + Math.sin(ang(i, N)) * r]

/** width in rem of a row of n wells (.lbs .wells: 3.4rem wells, 1rem apart); a ruleset has at most 5 teams and 5 weapons per resonator. */
const wellsRem = (n: number) => Math.max(0, n * 4.4 - 1)
const WELLS = 5

interface Tick { v: number; cls: string; row: Listed | null; rank: number; score: number }

/** the dial's lines, drawn straight to the DOM: they grow in, and hover runs every frame. */
class Dial {
  ticks: Tick[] = []
  G = 0
  hov = -1
  cache: number[][] = []
  raf = 0
  sc: HTMLElement
  tip: HTMLElement
  lines: NodeListOf<SVGLineElement>
  constructor(sc: HTMLElement, tip: HTMLElement) { this.sc = sc; this.tip = tip; this.lines = sc.querySelectorAll('.t') }

  tickXY(i: number) {
    const N = this.ticks.length, it = this.ticks[i], gi = eout(clamp(this.G * 1.7 - i / N * .7))
    const a = ang(i, N), l = (8 + it.v * DIAL.L) * gi, c = Math.cos(a), s = Math.sin(a)
    return [DIAL.cx + c * DIAL.r0, DIAL.cy + s * DIAL.r0, DIAL.cx + c * (DIAL.r0 + l), DIAL.cy + s * (DIAL.r0 + l)]
  }

  draw() {
    this.lines = this.sc.querySelectorAll('.t')
    this.cache = this.ticks.map((_, i) => this.tickXY(i))
    this.lines.forEach((ln, i) => {
      const c = this.cache[i]
      if (!c) return
      ln.setAttribute('x1', c[0].toFixed(1)); ln.setAttribute('y1', c[1].toFixed(1)); ln.setAttribute('x2', c[2].toFixed(1)); ln.setAttribute('y2', c[3].toFixed(1))
    })
    if (this.hov >= 0) this.placeTip()
  }

  grow() {
    cancelAnimationFrame(this.raf)
    if (reduced()) { this.G = 1; this.draw(); return }
    const t0 = performance.now(), g0 = this.G
    const step = (t: number) => {
      this.G = lerp(g0, 1, eout(clamp((t - t0) / 950)))
      this.draw()
      if (this.G < 1) this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  hit(x: number, y: number): number {
    const N = this.ticks.length
    if (!N) return -1
    const dx = x - DIAL.cx, dy = y - DIAL.cy, r = Math.hypot(dx, dy)
    if (r < DIAL.r0 - 14 || r > DIAL.r0 + DIAL.L + 40) return -1
    const a = ((Math.atan2(dy, dx) * 180 / Math.PI) - 270 + 720) % 360
    if (a > 346) return -1
    return clamp(Math.round(a / 340 * N), 0, N - 1)
  }

  placeTip() {
    const c = this.cache[this.hov]
    if (!c) return
    const w = this.tip.offsetWidth
    this.tip.style.transform = `translate(${(c[2] >= DIAL.cx ? c[2] + 14 : c[2] - 14 - w).toFixed(0)}px,${(c[3] - 16).toFixed(0)}px)`
  }
}


const SEQS: Array<[number | null, string]> = [[null, 'Any'], [0, 'S0'], [1, 'S1'], [2, 'S2'], [3, 'S3'], [4, 'S4'], [5, 'S5'], [6, 'S6']]
type Sort = 'rank' | 'cv' | 'atk' | 'er' | 'dmg' | 'score'
const SORT_BY: Record<Sort, (x: Listed) => number> = {
  rank: (x) => -x.rank, cv: (x) => x.stats?.critValue ?? -1, atk: (x) => x.stats?.atk ?? -1, er: (x) => x.stats?.energyRegen ?? -1,
  dmg: (x) => x.dpr ?? -1, score: (x) => x.score,
}
const teamName = (s: ScenarioSummary, rid: string) => s.members.filter((id) => id !== rid).map(resName).join(' + ')
const pct = (v: number) => `${v.toFixed(1)}%`
/** the top % marks on the map line. */
const CUTS = [1, 5, 10, 25, 50]

interface Filter { team: string | null; weapon: string | null; region: string | null; sequence: number | null }
const NONE: Filter = { team: null, weapon: null, region: null, sequence: null }
const query = (resonatorId: string, f: Filter, offset?: number) => ({
  resonatorId, team: f.team ?? undefined, weapon: f.weapon ?? undefined, region: f.region ?? undefined, sequence: f.sequence ?? undefined,
  offset: offset || undefined, limit: PAGE,
})

/** a find-field target: a rank ("#500"), the edge of a share ("10%", "top 10%") or the viewer's build ("me"). */
type Seek = { kind: 'rank' | 'share' | 'me'; rank: number; label: string }
function seekOf(q: string, n: number, mine: number | null): Seek | null {
  const s = q.trim().toLowerCase()
  if (!n) return null
  const r = /^#\s*(\d{1,7})$/.exec(s)
  if (r) { const rank = clamp(Number(r[1]), 1, n); return { kind: 'rank', rank, label: `Go to #${grp(rank)}, top ${share(rank, n)}%` } }
  const p = /^(?:top\s*)?(\d{1,3}(?:\.\d{1,3})?)\s*%$/.exec(s)
  if (p && Number(p[1]) > 0 && Number(p[1]) <= 100) {
    // the last build still inside that share.
    const rank = clamp(Math.floor(n * Number(p[1]) / 100 + 1e-9), 1, n)
    return { kind: 'share', rank, label: `Go to the edge of the top ${p[1]}%, #${grp(rank)}` }
  }
  if ((s === 'me' || s === 'you') && mine) return { kind: 'me', rank: mine, label: `Go to your build, top ${share(mine, n)}%` }
  return null
}

/** the board's loaded pages for one filter set, each read through its own query key (lbq.board). a new revision
    (gen: the first page refetched after an invalidation or the minute refetch) moves the pages to stale, shown until
    new copies load; a page requested under an older revision still lands as stale and is refetched. */
interface Pages { key: string; gen: number; total: number | null; pages: Map<number, Listed[]>; stale: Map<number, Listed[]>; asked: Map<number, number> }
const fresh = (key: string): Pages => ({ key, gen: 0, total: null, pages: new Map(), stale: new Map(), asked: new Map() })

/** a new list seeded with the cached first page (stored from the last visit or fetched earlier) as stale rows. */
function withKept(pages: Pages, rid: string, filter: Filter): Pages {
  const kept = queryClient.getQueryData(lbq.board(query(rid, filter, 0)).queryKey)
  if (kept) {
    pages.stale.set(0, kept.rows.map((row) => fromBoard(rid, kept.total, row)))
    pages.total = kept.total
  }
  return pages
}

export function BoardView({ resonatorId: rid }: { resonatorId: string }) {
  const { mine, live, me } = useScope()
  const pins = usePins()
  const stats = useQuery(lbq.boardStats(rid)).data ?? null
  const [filter, setFilter] = useState<Filter>(NONE)
  const [error, setError] = useState<unknown>(null)
  const [sort, setSort] = useState<Sort>('score')
  const [q, setQ] = useState('')
  const [open, setOpen] = useOpen()
  const [hov, setHov] = useState(-1)
  const [flash, setFlash] = useState<number | null>(null)
  const [ver, setVer] = useState(0)

  const scRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const stkRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const dial = useRef<Dial | null>(null)
  const list = useRef<ListApi | null>(null)
  const range = useRef<[number, number]>([1, 1])
  const winRef = useRef<HTMLElement>(null)
  const meRef = useRef<HTMLElement>(null)
  const toolRead = useRef<HTMLSpanElement>(null)

  const filtered = Boolean(filter.team || filter.weapon || filter.region || filter.sequence != null)
  const key = JSON.stringify(filter)
  // the first page stored from the last visit shows until the board responds
  const data = useRef<Pages>(withKept(fresh(key), rid, filter))
  // the first page for these filters, refetched each minute in view; each new response is a new revision
  const rev = useQuery({ ...lbq.board(query(rid, filter, 0)), refetchInterval: LIVE_MS }).dataUpdatedAt

  /** load the pages covering rows first to last that are not loaded or asked for. */
  const need = useCallback((first: number, last: number) => {
    const d = data.current
    for (let pg = Math.max(0, Math.floor(first / PAGE)); pg <= Math.floor(Math.max(first, last) / PAGE); pg++) {
      if (d.pages.has(pg) || d.asked.get(pg) === d.gen || (d.total != null && pg * PAGE >= d.total && pg > 0)) continue
      const gen = d.gen
      d.asked.set(pg, gen)
      queryClient.fetchQuery(lbq.board(query(rid, filter, pg * PAGE))).then((value: BoardResponse) => {
        if (data.current !== d) return
        const rows = value.rows.map((row) => fromBoard(rid, value.total, row))
        if (d.asked.get(pg) === gen) d.asked.delete(pg)
        if (gen === d.gen) { d.pages.set(pg, rows); d.stale.delete(pg); d.total = value.total } else d.stale.set(pg, rows)
        seeRows(rows)
        setError(null)
        setVer((v) => v + 1)
      }, (e: unknown) => { if (data.current === d) { if (d.asked.get(pg) === gen) d.asked.delete(pg); setError(e); setVer((v) => v + 1) } })
    }
  }, [rid, filter])

  // new filters reset the list; a new revision refetches the pages in view while the old rows stay visible
  const seen = useRef({ key, rev })
  useEffect(() => {
    const was = seen.current
    seen.current = { key, rev }
    const d = data.current
    if (was.key !== key) data.current = withKept(fresh(key), rid, filter)
    else if (was.rev !== rev) { for (const [pg, rows] of d.pages) d.stale.set(pg, rows); d.pages.clear(); d.gen++ }
    setVer((v) => v + 1)
    const [a, b] = range.current
    need(0, 0)
    if (data.current.total != null) need(a - 1, b - 1)
    // rid and filter change with need, and filter with key.
  }, [key, rev, need, rid, filter])

  const rowAt = useCallback((i: number): Listed | null => {
    const d = data.current, pg = Math.floor(i / PAGE)
    return (d.pages.get(pg) ?? d.stale.get(pg))?.[i % PAGE] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver names a page landing.
  }, [ver])
  const loaded = useMemo(() => {
    const d = data.current, out: Listed[] = []
    for (const pg of [...new Set([...d.pages.keys(), ...d.stale.keys()])].sort((a, b) => a - b)) out.push(...(d.pages.get(pg) ?? d.stale.get(pg) ?? []))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver names a page landing.
  }, [ver])
  const n = data.current.total ?? 0

  const scen = useMemo(() => (live?.scenarios ?? []).filter((s) => s.resonatorId === rid).sort((a, b) => a.teamRank - b.teamRank), [live, rid])
  const teams = useMemo(() => {
    const seenTeams = new Map<string, ScenarioSummary>()
    for (const s of scen) if (!seenTeams.has(s.teamKey)) seenTeams.set(s.teamKey, s)
    return [...seenTeams.values()].slice(0, WELLS)
  }, [scen])
  const weapons = useMemo(() => [...new Set(scen.map((s) => s.weaponId))].slice(0, WELLS), [scen])

  // each well's build count for every team and weapon in one response; wells with none are dimmed and disabled
  const countsRead = useQuery(lbq.boardCounts(rid))
  const counts = useMemo<Record<string, number>>(() => {
    const r = countsRead.data
    if (!r || countsRead.isError) return {}
    return Object.fromEntries([...teams.map((t) => ['t:' + t.teamKey, r.teams[t.teamKey] ?? 0] as const),
      ...weapons.map((w) => ['w:' + w, r.weapons[w] ?? 0] as const)])
  }, [countsRead.data, countsRead.isError, teams, weapons])

  const T = stats?.total ?? (filtered ? 0 : n)
  const field = useMemo(() => stats?.field ?? [], [stats])
  const N = field.length
  const hi = field[0] ?? 0, lo = field[N - 1] ?? 0
  const posOf = useCallback((i: number) => N === T || N < 2 ? i : Math.round(i * (T - 1) / (N - 1)), [N, T])
  /** the line a score would stand at: the first one at or below it. */
  const tickOf = useCallback((score: number) => {
    let a = 0, b = N - 1
    while (a < b) { const m = (a + b) >> 1; if (field[m] <= score + 1e-6) b = m; else a = m + 1 }
    return a
  }, [field, N])

  const myBuild = rankedOf(mine).find((b) => b.resonatorId === rid) ?? null
  // the viewer's position on this list: the board rank, or, when filtered, their loaded row's rank
  const myRank = !filtered ? myBuild?.rank ?? null : loaded.find((x) => ownsUid(me, x.uid))?.rank ?? null
  const seek = seekOf(q, n, myRank)
  const term = seek ? '' : q.trim().toLowerCase().replace(/\s/g, '')
  // the list is the whole board in its order; sorting by another column or filtering by name lists the loaded rows.
  const whole = (sort === 'score' || sort === 'rank') && !term
  const picked = useMemo(() => whole ? [] : loaded.filter((x) => !term || (x.name ?? '').toLowerCase().replace(/\s/g, '').includes(term) || (x.uid ?? '').includes(term))
    .sort((a, b) => SORT_BY[sort](b) - SORT_BY[sort](a)), [whole, loaded, term, sort])

  const myTick = myBuild && N ? tickOf(myBuild.score) : -1
  const lit = useMemo(() => filtered || term ? new Set((term ? picked : loaded).map((x) => tickOf(x.score))) : null, [filtered, term, picked, loaded, tickOf])

  const ticks = useMemo<Tick[]>(() => field.map((score, i) => {
    const pos = posOf(i), row = filtered ? null : rowAt(pos)
    const v = (score - lo) / (hi - lo || 1)
    const cls = [i === myTick ? 'me' : '', pos < 3 ? 'top' : '', lit && !lit.has(i) ? 'dim' : ''].filter(Boolean).join(' ')
    return { v, cls, row, rank: row?.rank ?? pos + 1, score }
  }), [field, posOf, lo, hi, myTick, lit, filtered, rowAt])

  const top3 = (whole ? [0, 1, 2].map(rowAt) : picked.slice(0, 3)).filter((x): x is Listed => x != null)
  const tags = top3.map((x, k) => {
    const i = tickOf(x.score), ty = 58 + k * 54
    const [ex, ey] = polarAt(i, N || 1, DIAL.r0 + 8 + (ticks[i]?.v ?? 0) * DIAL.L + 4)
    return { x, ty, d: `M${ex.toFixed(1)},${ey.toFixed(1)} L848,${ty} H888` }
  })
  const marks = (N >= 12 ? [[Math.ceil(N * .01), 'Top 1%'], [Math.ceil(N * .25), 'Top 25%']] as Array<[number, string]> : [])
    .concat(N >= 3 ? [[Math.round(N / 2), 'Median'], [N - 1, 'Lowest']] : [])

  /** the map line and readouts follow the rows in view: drawn straight to the DOM, they move with every scroll. */
  const paint = useCallback(() => {
    // first and last list positions in view; tied builds share a rank, so the readout uses the rows' ranks
    const [a, b] = range.current
    const ra = rowAt(a - 1)?.rank ?? a, rb = rowAt(b - 1)?.rank ?? b
    const say = n ? shareSpan(ra, rb, n) : ''
    if (toolRead.current) toolRead.current.innerHTML = whole && n ? `<span class="shr">${say}</span>#${grp(ra)}–${grp(rb)} of ${grp(n)}` : `${grp(picked.length)} shown`
    // the line is the list as it stands: its first place at the left edge, its last at the right.
    const at = (r: number) => `${(clamp((r - 1) / Math.max(1, n - 1)) * 100).toFixed(3)}%`
    const w = winRef.current
    if (w) {
      w.style.display = whole && n ? '' : 'none'
      w.style.left = at(a)
      w.style.width = `${(clamp((b - a) / Math.max(1, n - 1)) * 100).toFixed(3)}%`
    }
    const mr = myBuild && !filtered ? myBuild.rank : null
    if (meRef.current) { meRef.current.style.display = mr == null ? 'none' : ''; if (mr != null) meRef.current.style.left = at(mr) }
    lineRef.current?.querySelectorAll<HTMLElement>('.bline-pc').forEach((el) => {
      const r = Number(el.dataset.r)
      el.style.left = at(r)
      el.classList.toggle('in', a <= r && a > Number(el.dataset.from))
    })
  }, [n, whole, picked.length, myBuild, filtered, rowAt])
  const onRange = useCallback((a: number, b: number) => { range.current = [a, b]; paint() }, [paint])
  const bindList = useCallback((api: ListApi) => { list.current = api }, [])

  // the dial: made once, fed the ticks.
  useLayoutEffect(() => {
    if (!scRef.current || !tipRef.current) return
    const d = new Dial(scRef.current, tipRef.current)
    dial.current = d
    return () => { cancelAnimationFrame(d.raf); dial.current = null }
  }, [])

  useLayoutEffect(() => {
    const d = dial.current
    if (!d) return
    const grew = d.ticks.length !== ticks.length
    d.ticks = ticks
    if (grew) { d.G = 0; d.grow() } else d.draw()
    paint()
  })

  // the head scrolls away with the page; once the Builds bar sticks under the band it takes the board's name and the map line.
  useEffect(() => {
    const s = scroller(), el = stkRef.current
    if (!s || !el) return
    let frame = 0
    const check = () => {
      frame = 0
      const band = document.querySelector<HTMLElement>('.lbs .chb')?.offsetHeight ?? 0
      el.classList.toggle('in', s.scrollTop > 0 && el.getBoundingClientRect().top - s.getBoundingClientRect().top <= band + .5)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check) }
    s.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    check()
    return () => { cancelAnimationFrame(frame); s.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [])

  useLayoutEffect(() => {
    const d = dial.current
    if (!d) return
    d.hov = hov
    if (hov >= 0) d.placeTip()
  }, [hov])

  /** how deep the band and the stuck Builds bar reach over the list. */
  const cover = useCallback(() => (document.querySelector<HTMLElement>('.lbs .chb')?.offsetHeight ?? 0) + (stkRef.current?.offsetHeight ?? 0), [])

  // a jump asked for while the list showed loaded rows sorted or found by name waits for the whole list to draw.
  const later = useRef<{ rank: number; open?: string } | null>(null)
  const jumpTo = useCallback((rank: number, how: { instant?: boolean; open?: string } = {}) => {
    if (!n) return
    const r = clamp(Math.round(rank), 1, n)
    if (!whole) { later.current = { rank: r, open: how.open }; setSort('score'); setQ(''); return }
    const s = scroller(), api = list.current
    if (!s || !api) return
    const y = api.top() + api.off(r - 1) - cover() - 4
    const far = Math.abs(y - s.scrollTop) > 5000
    s.scrollTo({ top: Math.max(0, y), behavior: how.instant || far || reduced() ? 'auto' : 'smooth' })
    setFlash(r)
    if (how.open) setOpen(how.open)
  }, [n, whole, cover, setOpen])
  useEffect(() => { if (whole && later.current) { const j = later.current; later.current = null; requestAnimationFrame(() => jumpTo(j.rank, { open: j.open })) } }, [whole, jumpTo])
  useEffect(() => { if (flash == null) return; const t = window.setTimeout(() => setFlash(null), 1700); return () => window.clearTimeout(t) }, [flash])

  // arriving at a ?build= link: find its row among the first pages, bring it into the list, and useOpen lays it under the bars.
  const arrival = useRef(open)
  useEffect(() => {
    const id = arrival.current
    if (!id || !n) return
    const at = loaded.find((x) => x.buildId === id)
    if (at) { arrival.current = null; jumpTo(at.rank, { instant: true }); return }
    const next = Math.ceil(loaded.length / PAGE)
    if (next < 10 && next * PAGE < n) need(next * PAGE, next * PAGE); else arrival.current = null
  }, [loaded, n, need, jumpTo])

  // keys: 1-5 pick a team, Q W E R T a weapon; G the top, shift G the bottom, Y the viewer's build, J and K a row down and up
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return
      const t = '12345'.indexOf(event.key), w = 'qwert'.indexOf(event.key.toLowerCase())
      if (t >= 0 && teams[t] && counts['t:' + teams[t].teamKey]) setFilter((f) => ({ ...f, team: f.team === teams[t].teamKey ? null : teams[t].teamKey }))
      if (w >= 0 && weapons[w] && counts['w:' + weapons[w]]) setFilter((f) => ({ ...f, weapon: f.weapon === weapons[w] ? null : weapons[w] }))
      const [a] = range.current
      if (event.key === 'g') jumpTo(1)
      else if (event.key === 'G') jumpTo(n)
      else if (event.key === 'y' && myRank) jumpTo(myRank)
      else if (event.key === 'j') jumpTo(a + 1, { instant: true })
      else if (event.key === 'k') jumpTo(a - 1, { instant: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [teams, weapons, counts, jumpTo, n, myRank])

  // the dial: hover names a build; a click goes to it and opens it.
  const point = (event: MouseEvent<HTMLDivElement>) => {
    const r = event.currentTarget.getBoundingClientRect()
    return dial.current?.hit(event.clientX - r.left, event.clientY - r.top) ?? -1
  }
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const i = point(event), r = i >= 0 && !filtered ? posOf(i) + 1 : null
    if (r) jumpTo(r, { open: ticks[i]?.row?.buildId })
  }

  // the map line under the stuck bar: a press or drag moves the list there; near a share mark it lands on its edge.
  const dragging = useRef(false)
  const lineGo = (event: PointerEvent<HTMLDivElement>) => {
    const el = lineRef.current
    if (!el || !n) return
    const box = el.getBoundingClientRect(), x = clamp((event.clientX - box.left) / Math.max(1, box.width))
    const mark = [...el.querySelectorAll<HTMLElement>('.bline-pc')].find((m) => Math.abs(m.getBoundingClientRect().left - event.clientX) <= 4)
    jumpTo(mark ? Number(mark.dataset.r) : 1 + x * (n - 1), { instant: true })
  }
  const set = (patch: Partial<Filter>) => { setFilter((f) => ({ ...f, ...patch })); setOpen(null) }
  const clear = () => { setFilter(NONE); setQ(''); setOpen(null) }
  const toggle = useCallback((id: string) => setOpen(open === id ? null : id), [open, setOpen])
  const bar = useCallback((score: number) => ((score - lo) / (hi - lo || 1)) * 100, [lo, hi])
  const pinned = boardPinned(pins, rid)
  const attr = resAttr(rid)
  const ht = ticks[hov]
  const team = teams.find((t) => t.teamKey === filter.team) ?? scen.find((s) => s.teamKey === filter.team)
  const wpn = filter.weapon ? wpnOf(filter.weapon) ?? { name: filter.weapon, icon: '' } : null
  const d = data.current
  const empty = d.total === 0

  return (
    <main className="lpage tint" style={{ '--res': resColor(rid) } as CSSProperties}>
      <div className="sc" ref={scRef}>
        <div className="sc-dial" onMouseMove={(event) => setHov(point(event))} onMouseLeave={() => setHov(-1)}
          onClick={click} style={{ cursor: ht && !filtered ? 'pointer' : undefined }}>
          <svg viewBox="0 0 1168 496" aria-hidden>
            <g>
              <circle className="gd" cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r0 - 10} />
              <circle className="gd d" cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r0 + DIAL.L + 12} />
              {marks.map(([i, label]) => {
                const [x1, y1] = polarAt(i, N, DIAL.r0 + DIAL.L + 14), [x2, y2] = polarAt(i, N, DIAL.r0 + DIAL.L + 22), [tx, ty] = polarAt(i, N, DIAL.r0 + DIAL.L + 32)
                return <g key={label}><line className="ld" x1={x1} y1={y1} x2={x2} y2={y2} />
                  <text className="lb" x={tx} y={ty + 3} textAnchor={tx > DIAL.cx + 20 ? 'start' : tx < DIAL.cx - 20 ? 'end' : 'middle'}>{label}</text></g>
              })}
              {tags.map((t) => <path key={t.x.buildId} className={`ld${ownsUid(me, t.x.uid) ? ' me' : ''}`} d={t.d} />)}
            </g>
            {ticks.map((t, i) => <line key={i} className={`t ${t.cls}${i === hov ? ' hov' : ''}`} />)}
          </svg>

          <div className="h-rule" style={{ top: 22 }}><Rule word="Board" /></div>
          <h1 className="m-title m" style={{ top: 46 }}>{resName(rid)}</h1>
          <div className="m-read m" style={{ top: 104 }}>
            <img className="gl" style={{ width: '.85rem', height: '.85rem' }} src={getAttributeIconSrc(attr) ?? ''} alt="" />
            <span className="k-read" style={{ textTransform: 'capitalize' }}>{attr} · {plural(T, 'build')}</span>
          </div>

          {teams.length ? <div className="h-rule" style={{ top: 150, width: `${Math.max(17, wellsRem(teams.length))}rem` }}><Rule word="Team" /></div> : null}
          <div className="wells m" style={{ top: 172 }}>
            {teams.map((t, i) => {
              const c = counts['t:' + t.teamKey] ?? 0
              return (
                <button key={t.teamKey} className={c ? '' : 'none'} disabled={!c} title={c ? teamName(t, rid) : `${teamName(t, rid)}: no builds`} aria-pressed={filter.team === t.teamKey}
                  onClick={(event) => { event.stopPropagation(); set({ team: filter.team === t.teamKey ? null : t.teamKey }) }}>
                  <span className={`k-well pair${filter.team === t.teamKey ? ' on' : ''}`}>
                    {t.members.filter((id) => id !== rid).map((id) => <img key={id} src={resFace(id)} alt="" />)}<span className="k-key">{i + 1}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {weapons.length ? <div className="h-rule" style={{ top: 258, width: `${Math.max(17, wellsRem(weapons.length))}rem` }}><Rule word="Weapon" /></div> : null}
          <div className="wells m" style={{ top: 280 }}>
            {weapons.map((id, i) => {
              const c = counts['w:' + id] ?? 0, w = wpnOf(id)
              return (
                <button key={id} className={c ? '' : 'none'} disabled={!c} title={c ? w?.name ?? id : `${w?.name ?? id}: no builds`} aria-pressed={filter.weapon === id}
                  onClick={(event) => { event.stopPropagation(); set({ weapon: filter.weapon === id ? null : id }) }}>
                  <span className={`k-well${filter.weapon === id ? ' on' : ''}`}>
                    {w?.icon ? <img className="wi" src={w.icon} alt={w.name} /> : null}<span className="k-key">{'QWERT'[i]}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <img className="m-face m cx" src={resFace(rid)} alt="" style={{ left: DIAL.cx, top: 170 }} />
          <div className="core m cx" style={{ left: DIAL.cx, top: 256 }}>
            {myBuild
              ? <><div className="k-fig m-fig">{share(myBuild.rank, Math.max(T, myBuild.total))}<span className="pc">%</span></div><span className="k-sub">your build <em>#{grp(myBuild.rank)}</em></span></>
              : <><div className="k-fig m-fig">{grp(T)}</div><span className="k-sub">builds</span></>}
          </div>

          {tags.map((t) => {
            const you = ownsUid(me, t.x.uid)
            return (
              <button key={t.x.buildId} className={`tag${you ? ' me' : ''}`} style={{ left: 888, top: t.ty - 21.6 }} onClick={(event) => { event.stopPropagation(); jumpTo(t.x.rank, { open: t.x.buildId }) }}>
                <span className="rk">{String(t.x.rank).padStart(2, '0')}</span>
                <span className="nm"><Region region={t.x.region} />{playerName(t.x)}{you ? <span className="k-you" style={{ marginLeft: 0 }}>you</span> : null}</span>
                <span className="k-b">{pct(t.x.score)}</span>
              </button>
            )
          })}
          {N ? <>
            <div className="note" style={{ left: 888, top: 228 }}>Top score<b>{pct(hi)}</b></div>
            <div className="note" style={{ left: 1040, top: 228 }}>Median score<b>{pct(field[Math.max(0, Math.round(N / 2) - 1)])}</b></div>
          </> : null}
          <div className="note" style={{ left: 888, top: 286 }}>{filtered ? 'Builds shown' : 'Builds'}<b>{filtered && d.total != null ? `${grp(d.total)} of ${grp(T)}` : grp(T)}</b></div>
          <div style={{ position: 'absolute', left: 888, top: 352 }}><PinIb on={pinned} what="board" onClick={() => toggleBoardPin(rid)} /></div>
        </div>

        <div className={`tip${ht ? ' on' : ''}`} ref={tipRef}>
          {ht ? <>
            {!filtered && T ? <span className="shr">{share(ht.rank, T)}%</span> : null}
            {ht.row
              ? <><span className="k-n">#{grp(ht.row.rank)}</span><Region region={ht.row.region} />{playerName(ht.row)}<b className="k-b">{pct(ht.row.score)}</b>{ht.row.dpr != null ? <em>{grp(ht.row.dpr)} DPR</em> : null}</>
              : <><span className="k-n">#{grp(ht.rank)}</span><em>build score {pct(ht.score)}</em></>}
          </> : null}
        </div>

        <SavedBoardFilters rid={rid} filter={filter} apply={(f) => { setFilter(f); setOpen(null) }} />
      </div>

      <div className="stk" ref={stkRef}>
        <div className="sc-tools">
          <span className="hand" aria-hidden><img src={resFace(rid)} alt="" /><b>{resName(rid)}</b></span>
          <h2 className="k-ttl">Builds</h2><span className="k-read" ref={toolRead} />
          {whole && !team && !wpn ? <div className="bkeys" aria-hidden><span><kbd>G</kbd>top</span>{myRank ? <span><kbd>Y</kbd>you</span> : null}<span><kbd>J</kbd><kbd>K</kbd>rows</span></div> : null}
          {team ? <span className="chip tm" title={teamName(team, rid)} aria-label={`Team: ${teamName(team, rid)}`}>
            {team.members.filter((id) => id !== rid).map((id) => <img key={id} src={resFace(id)} alt="" />)}<i role="button" aria-label="Any team" onClick={() => set({ team: null })}>×</i></span> : null}
          {wpn ? <span className="chip tm" title={wpn.name} aria-label={`Weapon: ${wpn.name}`}>
            {wpn.icon ? <img src={wpn.icon} alt="" /> : <b>{wpn.name}</b>}<i role="button" aria-label="Any weapon" onClick={() => set({ weapon: null })}>×</i></span> : null}
          <span className="sp" />
          <div className="flt"><span>Server</span>
            <button className={filter.region == null ? 'on' : ''} onClick={() => set({ region: null })}>All</button>
            {Object.entries(SERVERS).map(([k, v]) => <button key={k} className={filter.region === k ? 'on' : ''} title={v.name} onClick={() => set({ region: k })}>{v.code}</button>)}
          </div>
          <div className="flt"><span>Sequence</span>
            {SEQS.map(([k, label]) => <button key={label} className={filter.sequence === k ? 'on' : ''} onClick={() => set({ sequence: k })}>{label}</button>)}
          </div>
          {seek ? <span className="seek">Enter: {seek.label}</span> : null}
          <label className="fld"><Search size={12} strokeWidth={2.4} />
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="player name, #rank or top 10%" autoComplete="off" aria-label="Find a player, go to a rank or a top %"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && seek) { setQ(''); event.currentTarget.blur(); jumpTo(seek.rank) }
                if (event.key === 'Escape') { setQ(''); event.currentTarget.blur() }
              }} /></label>
        </div>
        <BuildHead o={{}} sort={sort} onSort={(k) => setSort((cur) => cur === k ? 'score' : k as Sort)} />
        <div className="bline" ref={lineRef} title="click or drag to jump to a position on the board :P"
          onPointerDown={(event) => { if (event.button) return; event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true; lineGo(event) }}
          onPointerMove={(event) => { if (dragging.current) lineGo(event) }}
          onPointerUp={() => { dragging.current = false }} onPointerCancel={() => { dragging.current = false }}>
          <i className="bline-win" ref={winRef} />
          <i className="bline-me" ref={meRef} title={myBuild ? `Your build, #${grp(myBuild.rank)}` : undefined} />
          {!filtered && n >= 20 ? CUTS.map((c, k) => {
            const edge = (p: number) => Math.max(1, Math.floor(n * p / 100 + 1e-9)), r = edge(c), from = k ? edge(CUTS[k - 1]) : 0
            return <i key={c} className="bline-pc" data-r={r} data-from={from} title={`The edge of the top ${c}%, #${grp(r)}`}><b>{c}%</b></i>
          }) : null}
        </div>
      </div>

      <div id="list">
        {error && d.total == null ? <div className="empty">{noRuleset(error) ? "no board yet... scoring hasn't started for this resonator." : errorText(error)}</div>
          : d.total == null ? <div className="empty">loading builds... :P</div>
          : empty ? <div className="empty">{filtered ? <>hmm... no builds match these filters. <button onClick={clear}>Clear filters</button></> : 'no builds on this board yet... yours could be the first! :P'}</div>
          : whole ? <BoardList n={n} ver={ver} rowAt={rowAt} need={need} open={open} onToggle={toggle} flash={flash} bar={bar} cover={cover} onRange={onRange} bind={bindList} />
          : <>
            {picked.length ? picked.map((x, i) => <BuildRow key={x.buildId} x={x} i={i} open={open === x.buildId} onToggle={() => toggle(x.buildId)} p={bar(x.score)} />)
              : <div className="empty">hmm... none of the loaded builds matches "{q.trim()}". try loading more builds or changing the name. <button onClick={() => setQ('')}>Clear</button></div>}
            <div className="foot">{term ? 'Found among' : 'Sorted from'} the <b>{grp(loaded.length)}</b> loaded builds of <b>{grp(n)}</b>.
              {loaded.length < n ? <> <button onClick={() => { const pg = Math.ceil(loaded.length / PAGE); need(pg * PAGE, pg * PAGE) }}>Load {PAGE} more</button></> : null}
              {' '}<button onClick={() => { setSort('score'); setQ('') }}>Back to the whole board</button></div>
          </>}
      </div>
    </main>
  )
}
