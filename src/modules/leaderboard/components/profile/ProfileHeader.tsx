/*
  Author: Runor Ewhro
  description: a player's profile header with the player's builds across boards.
*/

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, PenLine } from 'lucide-react'
import { getBuildEvaluationGrade, getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay'
import { grp, resFace, resName, wpnOf } from '../../model/format'
import { reduced, runOf, share, teammates, unrankedWord, type Row } from '../../model/listed'
import { Ib } from '../IconButtons'
import { BoardRef } from '../Ref'
import { khCell, khMate, khWeapon } from '../build/KitHover'
import { Framed } from './Framed'
import type { ImageFrame } from '@/domain/leaderboard/documents'
import { formatTruncCompact } from '@/shared/lib/number'

// one build as a ribbon: the ribbon opens its row below, its name links to the board and its kit opens kit hovers
function Ribbon({ x, on, onOpen }: { x: Row; on: boolean; onOpen: () => void }) {
  const weapon = wpnOf(x.scenario?.weaponId ?? x.weaponId ?? '')
  const mates = x.scenario ? teammates({ resonatorId: x.resonatorId, scenario: x.scenario }) : []
  const grade = x.score != null ? getBuildEvaluationGrade(x.score) : null
  const bar = x.rank != null ? (1 - (x.rank - 1) / Math.max(1, x.total)) * 100 : 0
  const title = [grade, x.rank != null ? `#${grp(x.rank)} of ${grp(x.total)}` : unrankedWord(x)].filter(Boolean).join(', ')
  // kit hovers read the build and scenario from the cell; a build with no scenario shows its weapon plain
  const cell = x.scenario ? khCell(x.buildId, x.scenario.id, x.resonatorId, x.scenario.members) : {}
  const hover = Boolean(x.scenario)
  return (
    <div className={`pfb-rb${x.rank === 1 ? ' one' : ''}${on ? ' on' : ''}`} data-b={x.buildId}
      style={{ '--p': `${bar.toFixed(1)}%`, '--g': x.score != null ? getBuildEvaluationTone(x.score).color : 'var(--dim)' } as CSSProperties}>
      <button type="button" className="pfb-rb-go" onClick={onOpen} title={title} aria-label={`Open ${resName(x.resonatorId)} in the list`} />
      <img className="f" src={resFace(x.resonatorId)} alt="" />
      <span className="pfb-rb-rk">{x.rank != null ? x.total ? <>{share(x.rank, x.total)}<small>%</small></> : `#${grp(x.rank)}` : unrankedWord(x)}</span>
      <span className="pfb-rb-sc">{x.score != null ? <>{formatTruncCompact(x.score, 1)}<small>%</small></> : '-'}</span>
      <span className="pfb-rb-more"><span>
        <span className="nm"><BoardRef id={x.resonatorId}>{resName(x.resonatorId)}</BoardRef></span>
        {x.rank != null && x.total ? <span className="t">#{grp(x.rank)} of {grp(x.total)}</span> : null}
        <span className="kit" {...cell}>
          {mates.map((id) => <img key={id} src={resFace(id)} alt={resName(id)} {...(hover ? khMate(id) : {})} />)}
          {weapon?.icon ? <img className="w" src={weapon.icon} alt={weapon.name} {...(hover ? khWeapon(weapon.id) : {})} /> : null}
        </span>
        {x.dpr != null ? <span className="d"><b>{grp(x.dpr)}</b> DPR</span> : null}
      </span></span>
      <i className="pfb-rb-bar" />
    </div>
  )
}

export function ProfileHeader({ accent, avatar, banner, avatarFrame, bannerFrame, name, ign, meta, bio, links, pinnedBy, tools, rows, featured, open, onOpen, onEditFeatured }: {
  // the player's accent, or the theme's when unset
  accent: string | null
  avatar: string | null
  banner: string | null
  // where each image sits in its frame
  avatarFrame?: ImageFrame | null
  bannerFrame?: ImageFrame | null
  name: string
  // the in-game name, when the display name differs from it
  ign: string | null
  // server, uid and copy
  meta: ReactNode
  bio: string | null
  links: ReactNode
  // null when the count is private
  pinnedBy: number | null
  tools: ReactNode
  rows: Row[]
  featured: string[]
  open: string | null
  onOpen: (buildId: string) => void
  onEditFeatured: (() => void) | null
}) {
  // featured lead; every board without a featured build follows with its best (runOf, shared with the hover card)
  const { picked, run: shown } = runOf(rows, featured, (x) => x.at)
  const boards = new Set(shown.map((x) => x.resonatorId)).size
  const shownKey = shown.map((x) => x.buildId).join()
  const reel = useRef<HTMLDivElement>(null)
  // whether the reel overflows, and whether it sits at either end
  const [edge, setEdge] = useState({ over: false, start: true, end: true })
  const measure = () => {
    const el = reel.current
    if (!el) return
    const next = { over: el.scrollWidth > el.clientWidth + 1, start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 4 }
    setEdge((was) => was.over === next.over && was.start === next.start && was.end === next.end ? was : next)
  }
  const measured = useRef(measure)
  useEffect(() => { measured.current = measure })
  useEffect(() => {
    const el = reel.current
    if (!el) return
    const ro = new ResizeObserver(() => measured.current())
    ro.observe(el)
    for (const child of el.children) ro.observe(child)
    return () => ro.disconnect()
  }, [shownKey])
  // a row opened from the list brings its ribbon into the reel's view
  useEffect(() => {
    const el = reel.current
    const rb = open && el ? el.querySelector<HTMLElement>(`[data-b="${CSS.escape(open)}"]`) : null
    if (!el || !rb) return
    const left = rb.offsetLeft - el.offsetLeft, right = left + rb.offsetWidth
    if (left >= el.scrollLeft && right <= el.scrollLeft + el.clientWidth) return
    el.scrollTo({ left: left - el.clientWidth / 2 + rb.offsetWidth / 2, behavior: reduced() ? 'auto' : 'smooth' })
  }, [open])
  const step = (d: number) => {
    const el = reel.current
    if (el) el.scrollBy({ left: d * el.clientWidth * .7, behavior: reduced() ? 'auto' : 'smooth' })
  }
  return (
    <section className="pfb" style={accent ? { '--me': accent } as CSSProperties : undefined}>
      <div className="pfb-id">
        {banner ? <Framed className="pfb-ban" src={banner} frame={bannerFrame} /> : <span className="pfb-ban wash" />}
        {avatar ? <Framed className="pfb-av" src={avatar} frame={avatarFrame} /> : <span className="pfb-av mono">{name[0]?.toUpperCase() ?? '?'}</span>}
        <div className="pfb-name">
          <div className="pfb-hl"><h1>{name}</h1>{links}</div>
          <div className="pfb-meta">{meta}{ign ? <span className="ign">aka {ign}</span> : null}</div>
          {bio ? <p className="pfb-bio">{bio}</p> : null}
        </div>
        <div className="pfb-act">
          {pinnedBy != null ? <span className="pfb-pins"><b>{grp(pinnedBy)}</b> pin{pinnedBy > 1 ? 's' : ''} </span> : null}
          <div className="pfb-tools">{tools}</div>
        </div>
      </div>
      {shown.length || onEditFeatured ? (
        <div className={`pfb-reel${edge.over ? ' over' : ''}${edge.start ? ' at-start' : ''}${edge.end ? ' at-end' : ''}`}>
          {edge.over ? <Ib icon={ChevronLeft} label="Earlier builds" className="pfb-step" onClick={() => step(-1)} /> : null}
          <div className="pfb-run" ref={reel} onScroll={measure} role="group" aria-label={picked.length ? 'Featured and best builds' : 'Best builds'}>
            {shown.map((x) => <Ribbon key={x.buildId} x={x} on={open === x.buildId} onOpen={() => onOpen(x.buildId)} />)}
          </div>
          {edge.over ? <Ib icon={ChevronRight} label="More builds" className="pfb-step" onClick={() => step(1)} /> : null}
          {edge.over ? <span className="pfb-count">{boards} boards</span> : null}
          {onEditFeatured ? <Ib icon={PenLine} label="Edit featured" className="pfb-edit" onClick={onEditFeatured} /> : null}
        </div>
      ) : null}
    </section>
  )
}
