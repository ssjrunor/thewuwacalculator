/*
  Author: Runor Ewhro
  description: every board at once, each board's #1 build as a build row that
               opens its board. attribute wells (keys 1-6) filter, sort chips
               order, and a resonator or player name search finds one.
*/

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Search } from 'lucide-react'
import { ATTR_COLORS, getAttributeIconSrc } from '@/domain/gameData/attributeDisplay'
import { resAttr, resName } from '../model/format'
import { rankedOf } from '../model/players'
import { BuildHead, BuildRow } from '../components/build/BuildRow'
import { useScope } from '../state/ctx'
import { boardPath, fromBoard, plural, type Listed } from '../model/listed'
import { Rule } from './ActivityView'
import { seeRows } from '../model/seen'

const ATTRS = ['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc'] as const
type Sort = 'total' | 'dmg' | 'score' | 'at' | 'mine'
const SORTS: Array<[Sort, string]> = [['score', 'Build score'], ['total', 'Most builds'], ['dmg', 'Best DPR'], ['at', 'Latest upload'], ['mine', 'Your rank']]

export function BoardsView() {
  const { boards, mine, go } = useScope()
  const [attr, setAttr] = useState<string>('')
  const [sort, setSort] = useState<Sort>('score')
  const [q, setQ] = useState('')

  const list = useMemo(() => (boards?.boards ?? []).flatMap((b) => b.top ? [{ board: b, x: fromBoard(b.resonatorId, b.total, b.top) }] : []), [boards])
  useEffect(() => seeRows(list.map((entry) => entry.x)), [list])
  const myRank = useMemo(() => new Map(rankedOf(mine).map((b) => [b.resonatorId, b.rank / Math.max(1, b.total)])), [mine])

  // keys 1-6 pick an attribute.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select')) return
      const i = '123456'.indexOf(event.key)
      if (i >= 0) setAttr((a) => a === ATTRS[i] ? '' : ATTRS[i])
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const by: Record<Sort, (e: { board: { total: number; topScore: number; updatedAt: number }; x: Listed }) => number> = {
    total: (e) => e.board.total, dmg: (e) => e.x.dpr ?? -1, score: (e) => e.board.topScore, at: (e) => e.board.updatedAt,
    mine: (e) => -(myRank.get(e.x.resonatorId) ?? 9),
  }
  const term = q.trim().toLowerCase()
  const visible = list.filter((e) => (!attr || resAttr(e.x.resonatorId) === attr)
    && (!term || resName(e.x.resonatorId).toLowerCase().includes(term) || (e.x.name ?? '').toLowerCase().includes(term)))
    .sort((a, b) => by[sort](b) - by[sort](a))
  const sum = (boards?.boards ?? []).reduce((n, b) => n + b.total, 0)

  return (
    <main className="lpage tp">
      <section className="tp-top">
        <div><Rule word="Leaderboards" /><h1 className="pg-h1">Top build per resonator</h1>
          <span className="k-read">{boards ? `${plural(boards.boards.length, 'board')} · ${plural(sum, 'build')}` : ' '}</span></div>
        <div className="wells six">
          {ATTRS.map((a, i) => (
            <button key={a} title={a} onClick={() => setAttr((cur) => cur === a ? '' : a)} aria-pressed={attr === a}>
              <span className={`k-well${attr === a ? ' on' : ''}`} style={{ '--res': ATTR_COLORS[a] } as CSSProperties}>
                <img className="ai" src={getAttributeIconSrc(a) ?? ''} alt={a} /><span className="k-key">{i + 1}</span>
              </span>
              <small>{a}</small>
            </button>
          ))}
        </div>
      </section>
      <div className="av-bar">
        <div className="flt"><span>Sort</span>{SORTS.filter(([key]) => key !== 'mine' || myRank.size).map(([key, label]) => (
          <button key={key} className={sort === key ? 'on' : ''} onClick={() => setSort(key)}>{label}</button>))}</div>
        {attr ? <span className="chip" style={{ textTransform: 'capitalize' }}>{attr}<i role="button" aria-label="Every attribute" onClick={() => setAttr('')}>×</i></span> : null}
        <span className="k-read">{visible.length} shown</span><span className="sp" />
        <label className="fld"><Search size={12} strokeWidth={2.4} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="filter by resonator or leading player" autoComplete="off" aria-label="filter by resonator or leading player" /></label>
      </div>
      <BuildHead o={{ res: true }} />
      <div id="list">
        {!boards ? <div className="empty">loading the boards... :P</div>
          : visible.length ? visible.map((e, i) => <BuildRow key={e.x.buildId} x={e.x} i={i} o={{ res: true }} open={false} onToggle={() => go(boardPath(e.x.resonatorId))} />)
          : <div className="empty">{list.length ? <>hmm... no boards match these filters. <button onClick={() => { setAttr(''); setQ('') }}>Clear filters</button></> : 'no ranked boards yet... check back later :P'}</div>}
      </div>
    </main>
  )
}
