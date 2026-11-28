/*
  Author: Runor Ewhro
  description: hover previews for player and board links.
*/

import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { BoardRow } from '@/domain/leaderboard/api'
import { getBuildEvaluationGrade, getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay'
import { lbApi } from '../api/client'
import { lbq } from '../api/queries'
import { grp, monthDay, resFace, resName, wpnOf } from '../model/format'
import { playerName, rankedOf, type Who } from '../model/players'
import { playerPinned, usePins } from '../model/pins'
import { Region } from './build/BuildRow'
import { Framed } from './profile/Framed'
import { useScope } from '../state/ctx'
import { fmtUid, reduced, runOf, teammates } from '../model/listed'
import { ownsUid } from '../chrome/chrome'
import { formatTruncCompact } from '@/shared/lib/number'

type Target = { kind: 'board'; id: string } | { kind: 'player'; who: Who; name: string | null }

const keyOf = (t: Target) => t.kind === 'board' ? `b:${t.id}` : `p:${t.who.uid ?? ''}:${t.who.buildId}`

function targetOf(el: HTMLElement): Target | null {
  const d = el.dataset
  if (d.pv === 'b' && d.pvId) return { kind: 'board', id: d.pvId }
  if (d.pv === 'p' && (d.pvUid || d.pvBuild)) return { kind: 'player', who: { uid: d.pvUid || null, buildId: d.pvBuild ?? '' }, name: d.pvName || null }
  return null
}

// preview attributes for a link, spread onto the anchor or button
export const pvBoard = (id: string) => ({ 'data-pv': 'b', 'data-pv-id': id })
export const pvPlayer = (who: { uid: string | null; buildId: string; name?: string | null }) =>
  ({ 'data-pv': 'p', 'data-pv-uid': who.uid ?? '', 'data-pv-build': who.buildId, 'data-pv-name': who.name ?? '' })

// the viewer's private profile, including images pending approval; null until requested. cards use the pages'
// query keys, so a card or page read earlier paints at once
export function useOwnProfile(on: boolean) {
  const data = useQuery({ ...lbq.myProfile(), enabled: on }).data ?? null
  // a disabled query still returns cached data, so return it only for the viewer's own rows
  return on ? data : null
}

const ink = (score: number | null) => score != null ? getBuildEvaluationTone(score).color : 'var(--dim)'
const standingBar = (rank: number | null, total: number) => rank != null ? (1 - (rank - 1) / Math.max(1, total)) * 100 : 0

function Kit({ row }: { row: { resonatorId: string; scenario: BoardRow['scenario'] } }) {
  const weapon = wpnOf(row.scenario.weaponId)
  return (
    <span className="pvc-kit">
      {teammates(row).map((id) => <img key={id} src={resFace(id)} alt={resName(id)} />)}
      {weapon?.icon ? <img className="w" src={weapon.icon} alt={weapon.name} /> : null}
    </span>
  )
}

function BoardCard({ id }: { id: string }) {
  const { boards, mine } = useScope()
  const summary = boards?.boards.find((b) => b.resonatorId === id) ?? null
  const rows = useQuery({ ...lbq.board({ resonatorId: id, limit: 3 }), enabled: Boolean(summary), select: (r) => r.rows }).data ?? null
  const top = rows?.[0] ?? summary?.top ?? null
  const yours = mine?.builds.find((b) => b.resonatorId === id && b.rank != null) ?? null
  const you = yours ? (yours.rank === 1 ? 'you hold #1' : `you are #${yours.rank}`) : null
  return (
    <div className="pvc-card">
      <div className="pvc-top">
        <img className="pvc-res" src={resFace(id)} alt="" />
        <div className="pvc-nm">
          <h3>{resName(id)}</h3>
          <div className="pvc-meta">{summary ? <><span><b>{summary.total.toLocaleString('en-US')}</b> {summary.total === 1 ? 'entry' : 'entries'}</span>
            <span>updated {monthDay(summary.updatedAt)}</span></> : <span>no ranked builds yet</span>}{you ? <span>{you}</span> : null}</div>
        </div>
      </div>
      {top ? (
        <div className="pvc-body">
          <div className="pvc-lead" style={{ '--g': ink(top.score) } as CSSProperties}>
            <span className="who"><Region region={top.region} />{playerName(top)}<em>#1</em></span>
            <span className="big">{formatTruncCompact(top.score, 1)}<small>%</small><em>{getBuildEvaluationGrade(top.score)}</em></span>
            <span className="pvc-kr"><Kit row={{ resonatorId: id, scenario: top.scenario }} />{top.dpr != null ? <span className="dp"><b>{grp(top.dpr)}</b> DPR</span> : null}</span>
          </div>
          {rows && rows.length > 1 ? (
            <div className="pvc-rest">{rows.slice(1, 3).map((x, i) => (
              <div key={x.buildId} style={{ '--i': i + 1, '--g': ink(x.score) } as CSSProperties}>
                <span className="r">#{x.rank}</span><Region region={x.region} /><span className="p">{playerName(x)}</span><b>{formatTruncCompact(x.score, 1)}%</b>
              </div>))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PlayerCard({ who, name }: { who: Who; name: string | null }) {
  const { me, mine } = useScope()
  const pins = usePins()
  const own = ownsUid(me, who.uid)
  // read the viewer's own profile privately like the profile page, which includes media pending approval
  const ownRead = useOwnProfile(own)
  const otherRead = useQuery({ ...lbq.player(who), enabled: !own }).data ?? null
  const p = own ? ownRead : otherRead
  const ref = p ? p.uid ?? p.builds[0]?.buildId ?? null : null
  const social = useQuery({ ...lbq.playerSocial(ref ?? ''), enabled: Boolean(ref) }).data ?? null

  if (!p) return (
    <div className="pvc-card wait">
      <div className="pvc-top"><span className="pvc-av mono">{(name ?? '?')[0]?.toUpperCase() ?? '?'}</span>
        <div className="pvc-nm"><h3>{name ?? 'Player'}</h3><div className="pvc-meta"><span>loading the profile... :P</span></div></div></div>
    </div>
  )

  const doc = p.profile
  const accent = doc?.accent ?? null
  const banner = doc?.banner ? lbApi.mediaUrl(doc.banner) : null
  const avatar = doc?.avatar ? lbApi.mediaUrl(doc.avatar) : null
  const shown = doc?.displayName ?? p.name ?? name ?? 'Unnamed'
  const ign = doc?.displayName && p.name && doc.displayName !== p.name ? p.name : null
  const tuned = Boolean(accent || banner)
  // the head of the profile band's run: featured first, then each other board's best
  const { picked, run } = runOf(p.builds, doc?.featured ?? [], (b) => b.drawnAt)
  const plates = run.slice(0, picked.length ? 4 : 3)
  const atTop = p.builds.filter((b) => b.rank === 1).length
  const pinnedBy = social?.followers ?? 0
  const pinned = !own && playerPinned(pins, who)

  return (
    <div className={`pvc-card${tuned ? ' tuned' : ''}`} style={accent ? { '--me': accent } as CSSProperties : undefined}>
      {tuned ? <i className="pvc-ring" /> : null}
      <div className="pvc-top">
        {banner ? <Framed className="pvc-ban" src={banner} frame={doc?.bannerFrame} /> : <span className="pvc-ban wash" />}
        {avatar ? <Framed className="pvc-av" src={avatar} frame={doc?.avatarFrame} /> : <span className="pvc-av mono">{shown[0]?.toUpperCase() ?? '?'}</span>}
        <div className="pvc-nm">
          <h3>{shown}</h3>
          <div className="pvc-meta"><Region region={p.region} />{p.uid ? <span>UID {fmtUid(p.uid)}</span> : null}{ign ? <span>aka {ign}</span> : null}{pinned ? <span className="pvc-pin">PINNED</span> : null}</div>
        </div>
        {doc?.bio ? <p className="pvc-bio">{doc.bio}</p> : null}
      </div>
      <div className="pvc-body">
        <div className="pvc-h">{picked.length ? 'Featured' : 'Best builds'}<span><b>{p.builds.length}</b> builds</span><span><b>{atTop}</b> at #1</span>
          {pinnedBy > 0 ? <span><b>{pinnedBy}</b> pin{pinnedBy > 1 ? 's' : ''}</span> : null}</div>
        {plates.length ? (
          <div className="pvc-feat" style={{ '--n': Math.max(3, plates.length) } as CSSProperties}>{plates.map((b, i) => (
            <div key={b.buildId} style={{ '--i': i, '--g': ink(b.score), '--p': `${standingBar(b.rank, b.total).toFixed(0)}%` } as CSSProperties}>
              <img src={resFace(b.resonatorId)} alt={resName(b.resonatorId)} />
              <b>{b.score != null ? `${formatTruncCompact(b.score, 1)}%` : '-'}</b>
              <em>{b.rank != null ? `#${b.rank}/${b.total}` : 'unranked'}</em><i />
            </div>))}
          </div>
        ) : <div className="pvc-rel"><span>no scored builds here yet... :P</span></div>}
        {own ? <div className="pvc-rel"> <span>your profile</span></div> : null}
      </div>
    </div>
  )
}

// the card's current and target position, updated per frame outside React; one layer mounts at a time, so one
// controller serves it
const c = {
  el: null as HTMLDivElement | null,
  on: false, key: '', mx: 0, my: 0, px: 0, py: 0, raf: 0, shut: 0, snap: false,
  place() {
    c.raf = 0
    const el = c.el
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight, m = 10
    let l = c.mx + 22, t = c.my + 18
    if (l + w > innerWidth - m) l = c.mx - 22 - w
    // keep the bottom clear of the submit dock
    if (t + h > innerHeight - 72) t = c.my - h - 14
    l = Math.max(m, l); t = Math.max(m, t)
    if (c.snap) { c.px = l; c.py = t; c.snap = false }
    const still = reduced()
    const vx = l - c.px, vy = t - c.py
    const k = still ? 1 : .22
    c.px += vx * k; c.py += vy * k
    if (Math.abs(l - c.px) < .3) c.px = l
    if (Math.abs(t - c.py) < .3) c.py = t
    const settled = c.px === l && c.py === t
    const lean = !still && !settled
    const cl = (v: number, n: number) => Math.max(-n, Math.min(n, v)).toFixed(2)
    el.style.translate = `${Math.round(c.px)}px ${Math.round(c.py)}px`
    el.style.transformOrigin = `${l < c.mx ? 'right' : 'left'} ${t < c.my ? 'bottom' : 'top'}`
    el.style.setProperty('--ry', lean ? `${cl(vx * .05, 6)}deg` : '0deg')
    el.style.setProperty('--rx', lean ? `${cl(-vy * .05, 5)}deg` : '0deg')
    el.style.setProperty('--bx', lean ? `${cl(-vx * .1, 9)}px` : '0px')
    el.style.setProperty('--by', lean ? `${cl(-vy * .1, 6)}px` : '0px')
    if (!settled) c.raf = requestAnimationFrame(c.place)
  },
  kick() { if (!c.raf) c.place() },
  hide() {
    window.clearTimeout(c.shut)
    c.on = false; c.key = ''
    c.el?.classList.remove('on', 'warm')
  },
}
const attach = (el: HTMLDivElement | null) => { c.el = el }

// one per page: finds the link under the cursor and positions its preview card
export function PreviewLayer() {
  const [target, setTarget] = useState<Target | null>(null)
  const [stamp, setStamp] = useState(0)
  const location = useLocation()

  // a new subject lays out first, then moves into place
  useLayoutEffect(() => {
    if (!stamp) return
    cancelAnimationFrame(c.raf)
    c.place()
  }, [stamp])

  useEffect(() => {
    const show = (el: HTMLElement, x: number, y: number) => {
      const t = targetOf(el)
      const el2 = c.el
      if (!t || !el2) return
      window.clearTimeout(c.shut)
      c.mx = x; c.my = y
      const warm = c.on
      const key = keyOf(t)
      el2.classList.add('on')
      el2.classList.toggle('warm', warm)
      c.on = true
      if (key !== c.key || !warm) {
        c.key = key
        if (!warm) c.snap = true
        setTarget(t)
        setStamp((n) => n + 1)
      } else c.kick()
    }
    const link = (e: Event) => (e.target as Element | null)?.closest?.('.lbs [data-pv]') as HTMLElement | null
    const over = (e: PointerEvent) => { const el = link(e); if (el && e.pointerType !== 'touch') show(el, e.clientX, e.clientY) }
    const out = (e: PointerEvent) => {
      const el = link(e)
      if (el && !el.contains(e.relatedTarget as Node | null)) { window.clearTimeout(c.shut); c.shut = window.setTimeout(c.hide, 70) }
    }
    const move = (e: PointerEvent) => { if (c.on) { c.mx = e.clientX; c.my = e.clientY; c.kick() } }
    const now = () => { if (c.on) c.hide() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') now() }
    const focus = (e: FocusEvent) => {
      const el = link(e)
      if (el?.matches(':focus-visible')) { const r = el.getBoundingClientRect(); show(el, r.left + 8, r.bottom - 4) }
    }
    const blur = (e: FocusEvent) => { if (link(e)) now() }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerdown', now)
    document.addEventListener('scroll', now, { capture: true, passive: true })
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', blur)
    // a card that loads after it was placed may grow, so it is placed again
    const resized = new ResizeObserver(() => { if (c.on) c.kick() })
    if (c.el) resized.observe(c.el)
    return () => {
      resized.disconnect()
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerdown', now)
      document.removeEventListener('scroll', now, { capture: true })
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', blur)
      window.clearTimeout(c.shut)
      cancelAnimationFrame(c.raf)
    }
  }, [])

  // navigating to another page closes it
  useEffect(() => { c.hide() }, [location.pathname, location.search])

  return (
    <div ref={attach} className="pvc" aria-hidden="true">
      {target ? (
        <div key={stamp} className="pvc-in">
          {target.kind === 'board' ? <BoardCard id={target.id} /> : <PlayerCard who={target.who} name={target.name} />}
        </div>
      ) : null}
    </div>
  )
}
