/*
  Author: Runor Ewhro
  description: the profile band: one identity row (avatar, name, server and
               uid, signature, links, pinned-by count and actions) over the
               player's banner, then the player's featured builds in order as one
               line of ribbons with face, top % and score, and a standing line
               along the bottom. the hovered ribbon, or the one open in the list,
               widens in place to show name, rank, team, weapon and DPR. the
               player's accent rings the avatar, draws the standing lines and
               outlines the active ribbon. with nothing featured, the best build
               of each of the top three boards is shown.
*/

import type { CSSProperties, ReactNode } from 'react'
import { PenLine } from 'lucide-react'
import { getBuildEvaluationGrade, getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay'
import { grp, resFace, resName, wpnOf } from '../../model/format'
import { share, teammates, unrankedWord, type Row } from '../../model/listed'
import { Ib } from '../IconButtons'
import { Framed } from './Framed'
import type { ImageFrame } from '@/domain/leaderboard/documents'

/** one featured build as a ribbon that opens its row below. */
function Ribbon({ x, on, onOpen }: { x: Row; on: boolean; onOpen: () => void }) {
  const weapon = wpnOf(x.scenario?.weaponId ?? x.weaponId ?? '')
  const mates = x.scenario ? teammates({ resonatorId: x.resonatorId, scenario: x.scenario }) : []
  const grade = x.score != null ? getBuildEvaluationGrade(x.score) : null
  const bar = x.rank != null ? (1 - (x.rank - 1) / Math.max(1, x.total)) * 100 : 0
  const title = [grade, x.rank != null ? `#${grp(x.rank)} of ${grp(x.total)}` : unrankedWord(x)].filter(Boolean).join(', ')
  return (
    <button type="button" className={`pfb-rb${x.rank === 1 ? ' one' : ''}${on ? ' on' : ''}`} onClick={onOpen} title={title}
      style={{ '--p': `${bar.toFixed(1)}%`, '--g': x.score != null ? getBuildEvaluationTone(x.score).color : 'var(--dim)' } as CSSProperties}
      aria-label={`Open ${resName(x.resonatorId)} in the list`}>
      <img className="f" src={resFace(x.resonatorId)} alt="" />
      <span className="pfb-rb-rk">{x.rank != null ? x.total ? <>{share(x.rank, x.total)}<small>%</small></> : `#${grp(x.rank)}` : unrankedWord(x)}</span>
      <span className="pfb-rb-sc">{x.score != null ? <>{x.score.toFixed(1)}<small>%</small></> : '-'}</span>
      <span className="pfb-rb-more"><span>
        <span className="nm">{resName(x.resonatorId)}</span>
        {x.rank != null && x.total ? <span className="t">#{grp(x.rank)} of {grp(x.total)}</span> : null}
        {mates.map((id) => <img key={id} src={resFace(id)} alt={resName(id)} />)}
        {weapon?.icon ? <img className="w" src={weapon.icon} alt={weapon.name} /> : null}
        {x.dpr != null ? <span className="d"><b>{grp(x.dpr)}</b> DPR</span> : null}
      </span></span>
      <i className="pfb-rb-bar" />
    </button>
  )
}

/** each board's best scored build (a player may have several on one), best first, shown when nothing is featured. */
function bestPerBoard(rows: Row[]): Row[] {
  const best = new Map<string, Row>()
  for (const x of rows) {
    const held = best.get(x.resonatorId)
    if (x.score != null && (!held || x.score > held.score! || (x.score === held.score && x.at > held.at))) best.set(x.resonatorId, x)
  }
  return [...best.values()].sort((a, b) => b.score! - a.score!)
}

export function ProfileBand({ accent, avatar, banner, avatarFrame, bannerFrame, name, ign, meta, bio, links, pinnedBy, tools, rows, featured, open, onOpen, onEditFeatured }: {
  /** the player's accent, or the theme's when unset. */
  accent: string | null
  avatar: string | null
  banner: string | null
  /** where each image sits in its frame. */
  avatarFrame?: ImageFrame | null
  bannerFrame?: ImageFrame | null
  name: string
  /** the in-game name, when the display name differs from it. */
  ign: string | null
  /** server, uid and copy. */
  meta: ReactNode
  bio: string | null
  links: ReactNode
  /** null when the count is private. */
  pinnedBy: number | null
  tools: ReactNode
  rows: Row[]
  featured: string[]
  open: string | null
  onOpen: (buildId: string) => void
  onEditFeatured: (() => void) | null
}) {
  const byId = new Map(rows.map((x) => [x.buildId, x]))
  const picked = featured.map((id) => byId.get(id)).filter((x): x is Row => Boolean(x))
  const shown = picked.length ? picked : bestPerBoard(rows).slice(0, 3)
  return (
    <section className="pfb" style={accent ? { '--me': accent } as CSSProperties : undefined}>
      <div className="pfb-id">
        {banner ? <Framed className="pfb-ban" src={banner} frame={bannerFrame} /> : <span className="pfb-ban wash" />}
        {avatar ? <Framed className="pfb-av" src={avatar} frame={avatarFrame} /> : <span className="pfb-av mono">{name[0]?.toUpperCase() ?? '?'}</span>}
        <div className="pfb-name">
          {/* the links sit on the name's line, after it; a long name pushes them under. */}
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
        <div className="pfb-run" role="group" aria-label={picked.length ? 'Featured' : 'Best builds'}>
          {shown.map((x) => <Ribbon key={x.buildId} x={x} on={open === x.buildId} onOpen={() => onOpen(x.buildId)} />)}
          {onEditFeatured ? <Ib icon={PenLine} label="Edit featured" className="pfb-edit" onClick={onEditFeatured} /> : null}
        </div>
      ) : null}
    </section>
  )
}
