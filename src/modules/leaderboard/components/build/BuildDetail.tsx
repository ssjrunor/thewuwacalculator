/*
  Author: Runor Ewhro
  description: an opened build: rank, score and DPR per scenario, teams, weapons, the showcase card and the rotation
               breakdown.
*/

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { teamDamageOf, type BuildDetailResponse, type CellDetailResponse, type ScenarioCell } from '@/domain/leaderboard/api'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import { queryClient } from '@/shared/lib/queryClient'
import { errorText } from '../../model/cardTrack'
import { lbq, loadCellDetail } from '../../api/queries'
import { CardBuildError, loadCardBuild, loadPendingCard, type CardBuild } from '../../model/cardBuild'
import { dayText, grp, resFace, resName, score1, scoreInk, topText, wpnOf } from '../../model/format'
import { LbCard } from './LbCard'
import { BuildTools } from './BuildTools'
import { Region, Seq } from './BuildRow'
import { type Listed } from '../../model/listed'
import { playerName } from '../../model/players'
import { PlayerRef } from '../Ref'
import { AttackFall } from './AttackFall'
import { formatTruncCompact } from '@/shared/lib/number'

// what an opened build needs from its row: a scored board row, or an upload with no rank yet
export type Opened = Pick<Listed, 'buildId' | 'resonatorId' | 'uid' | 'name' | 'region' | 'at' | 'total'> & {
  rank: number | null
  dpr: number | null
  // the owner hid it from everyone else (set on the owner's own rows)
  hidden?: boolean
}

// a build's detail, and a picked scenario's, from the query cache: one read shared by every view of the build
export const loadDetail = (buildId: string): Promise<BuildDetailResponse> => queryClient.fetchQuery(lbq.build(buildId))

const isBest = (d: BuildDetailResponse, cell: ScenarioCell) => cell.scenario.id === d.best?.scenario.id

// one cell's input and damage split; the detail includes the best cell's, and other cells are fetched
function loadCell(d: BuildDetailResponse, cell: ScenarioCell): Promise<{ input: CellDetailResponse['input']; contribution: CellDetailResponse['contribution'] }> {
  if (isBest(d, cell) && d.scoredInput) return Promise.resolve({ input: d.scoredInput, contribution: d.bestContribution ?? null })
  return loadCellDetail(d.buildId, cell.scenario.id)
}

// the card for one cell, or the submitted build alone before any score
export function loadCard(d: BuildDetailResponse, cell: ScenarioCell | null): Promise<CardBuild> {
  if (!cell) return loadPendingCard(d)
  return loadCell(d, cell).then(({ input }) => loadCardBuild(d, cell, input))
}

export function useAsync<T>(key: string | null, load: () => Promise<T>): { value: T | null; error: string | null } {
  const [state, setState] = useState<{ key: string | null; value: T | null; error: string | null }>({ key: null, value: null, error: null })
  useEffect(() => {
    if (!key) return
    let live = true
    load().then((value) => { if (live) setState({ key, value, error: null }) },
      (error: unknown) => { if (live) setState({ key, value: null, error: error instanceof CardBuildError ? error.message : errorText(error) }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the request.
  }, [key])
  return state.key === key ? state : { value: null, error: null }
}

const scored = (cell: ScenarioCell) => cell.status === 'ok' && cell.score != null
const ROLE: Record<string, string> = { signature: 'Signature', standard: 'Standard', alternative: 'Alternative' }

interface Team { key: string; rank: number; mates: string[]; cells: ScenarioCell[]; top: ScenarioCell | null }

// team tabs: scored teams by best score, then the rest in their listed order
function teamsOf(d: BuildDetailResponse): Team[] {
  const byKey = new Map<string, Team>()
  for (const cell of d.cells) {
    const team = byKey.get(cell.scenario.teamKey) ?? { key: cell.scenario.teamKey, rank: cell.scenario.teamRank,
      mates: cell.scenario.members.filter((id) => id !== d.snapshot.resonator.id), cells: [], top: null }
    team.cells.push(cell)
    if (scored(cell) && (!team.top || cell.score! > team.top.score!)) team.top = cell
    byKey.set(team.key, team)
  }
  return [...byKey.values()].sort((a, b) => (b.top?.score ?? -1) - (a.top?.score ?? -1) || a.rank - b.rank)
}

// why a team or weapon has no score, in the reader's words
function unscoredText(d: BuildDetailResponse, cells: ScenarioCell[]): string {
  if (cells.some((cell) => cell.reason === 'not_scored_yet')) return d.scoringStatus === 'scoring' ? 'Scoring' : 'Not scored yet'
  if (cells.every((cell) => cell.status === 'error')) return 'Could not score'
  return "Not supported yet"
}

const DIGITS = [...'0123456789'].map((digit) => <i key={digit}>{digit}</i>)

// a score whose digits roll to a new value; a change of shape (99.8% to 133.1%) restarts the roll
function Rolling({ text }: { text: string }) {
  let k = text.replace(/\D/g, '').length
  return (
    <span key={text.replace(/\d/g, 'd')} className="rc-n">
      <span className="rc-sr">{text}</span>
      {[...text].map((ch, i) => /\d/.test(ch)
        ? <span key={i} className="rc-d" aria-hidden="true"><span style={{ '--k': --k, transform: `translateY(${-Number(ch) * 10}%)` } as CSSProperties}>{DIGITS}</span></span>
        : <span key={i} aria-hidden="true">{ch}</span>)}
    </span>
  )
}

// a recounted pairing's change from the one that is open
function VsOpen({ cell, open }: { cell: ScenarioCell; open: ScenarioCell | null }) {
  if (!open || cell.scenario.id === open.scenario.id) return <i className="rc-dv o" title="The pairing you have open">open</i>
  const v = cell.score! - open.score!
  return <i className={`rc-dv ${v >= 0 ? 'up' : 'dn'}`} title="Change from the pairing you have open">{v >= 0 ? '+' : '\u2212'}{formatTruncCompact(Math.abs(v), 1)}</i>
}

type Peek = { team: string } | { weapon: string } | null

// a pairing's team DPR in full, and its length in characters: the score beside it shrinks to fit (--fit)
const teamLine = (teamDpr: number | null) => {
  const text = teamDpr != null ? grp(teamDpr) : '-'
  return { text, fit: text.length + 5 }
}

// team damage from a cell's breakdown, for a cell the build detail sent without one
const teamDprFrom = (cell: ScenarioCell, detail: CellDetailResponse | undefined): number | null =>
  teamDamageOf(cell.dpr, cell.scenario.resonatorId, detail?.contribution?.team)

export function BuildDetail({ x, mine, children }: { x: Opened; mine: boolean; children?: ReactNode }) {
  const [pick, setPick] = useState<string | null>(null)
  const detail = useAsync(x.buildId, () => loadDetail(x.buildId))
  const d = detail.value

  const best = d?.best ?? null
  const picked = (pick ? d?.cells.find((cell) => cell.scenario.id === pick && scored(cell)) : null) ?? best
  // the selected scenario's card, or the submitted build alone before any score
  const card = useAsync<CardBuild>(d ? `${x.buildId}:${picked?.scenario.id ?? 'pending'}` : null, () => loadCard(d!, picked))
  // while the next card renders, the last one stays up, dimmed
  const [kept, setKept] = useState<{ buildId: string; cell: ScenarioCell | null; card: CardBuild } | null>(null)
  if (card.value && kept?.card !== card.value) setKept({ buildId: x.buildId, cell: picked, card: card.value })
  const shown = card.value ? { buildId: x.buildId, cell: picked, card: card.value } : kept?.buildId === x.buildId ? kept : null
  const drawing = !card.value && !card.error && !!shown

  const teams = d ? teamsOf(d) : []
  const team = picked ? teams.find((t) => t.key === picked.scenario.teamKey) ?? null : null
  const weaponOrder = d ? [...new Set(d.cells.map((cell) => cell.scenario.weaponId))] : []
  const split = useAsync(d && picked ? `${x.buildId}|${picked.scenario.id}` : null, () => loadCell(d!, picked!))
  const contribution = split.value?.contribution ?? null
  const dpr = picked ? picked.dpr : x.dpr

  // recount: a hovered or focused team or weapon; leaving waits briefly, which continues the roll along a row
  const [peek, setPeek] = useState<Peek>(null)
  const leave = useRef(0)
  useEffect(() => () => window.clearTimeout(leave.current), [])
  const peekOn = (next: Peek) => () => { window.clearTimeout(leave.current); setPeek(next) }
  const peekOff = () => { window.clearTimeout(leave.current); leave.current = window.setTimeout(() => setPeek(null), 160) }
  const peekTeam = peek && 'team' in peek ? teams.find((t) => t.key === peek.team) ?? null : null
  const peekWeapon = peek && 'weapon' in peek ? peek.weapon : null
  const withWeapon = (t: Team, weaponId: string) => t.cells.find((c) => c.scenario.weaponId === weaponId && scored(c)) ?? null
  // team DPR comes with the build; a cell scored without its breakdown fetches it once something shows that cell
  const showing = !peek || !d ? [] : [
    ...(peekWeapon ? teams.map((t) => withWeapon(t, peekWeapon)) : peekTeam?.top ? [peekTeam.top] : []),
    ...(peekTeam ? weaponOrder.map((w) => withWeapon(peekTeam, w)) : peekWeapon && team ? [withWeapon(team, peekWeapon)] : []),
  ]
  const missing = [...new Map(showing.filter((c): c is ScenarioCell => !!c && c.teamDpr == null).map((c) => [c.scenario.id, c])).values()]
  const fetched = useQueries({ queries: missing.map((c) => lbq.cell(x.buildId, c.scenario.id)) })
  const teamDpr = (cell: ScenarioCell) => {
    if (cell.teamDpr != null) return cell.teamDpr
    const at = missing.findIndex((c) => c.scenario.id === cell.scenario.id)
    return at < 0 ? null : teamDprFrom(cell, fetched[at]?.data)
  }
  // each recounted score's bar spans the build's own range of pairings, with a tick at the open one
  const scores = d ? d.cells.filter(scored).map((c) => c.score!) : []
  const lo = Math.min(...scores) - 2
  const hi = Math.max(...scores) + .5
  const along = (v: number) => `${(Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo))) * 100).toFixed(1)}%`
  const bar = (score: number) => (
    <span className="rc-bar" aria-hidden="true" style={{ '--sw': along(score), '--op': picked?.score != null ? along(picked.score) : '-10%', ...scoreInk(score) } as CSSProperties}><i /></span>
  )
  const weapon = picked ? wpnOf(picked.scenario.weaponId) : null
  const level = d?.snapshot.resonator.level ?? 90

  return (
    <div className="exin" onClick={(event) => event.stopPropagation()}>
      <div className="exh">
        <span className="who"><img src={resFace(x.resonatorId)} alt="" />
          <span><b>{resName(x.resonatorId)}</b><small>Lv {level}{d ? <Seq n={d.snapshot.resonator.sequence} /> : null}</small></span></span>
        <span className="xfg" title={x.rank != null && x.total ? topText(x.rank, x.total) : undefined}>
          <b>{x.rank != null ? <>#{grp(x.rank)}{x.total ? <small>of {grp(x.total)}</small> : null}</> : '-'}</b>
          <em>{x.rank != null ? 'board rank' : 'unranked'}</em></span>
        <span className="xfg"><b style={picked?.score != null ? scoreInk(picked.score) : undefined}>{picked?.score != null ? score1(picked.score) : '-'}</b>
          <em>{picked ? 'build score' : d?.scoringStatus === 'insufficient_data' ? "not supported yet" : d?.scoringStatus === 'scored' ? 'score unavailable' : 'score pending'}</em></span>
        <span className="xfg"><b>{dpr != null ? grp(dpr) : '-'}</b><em>DPR</em></span>
        <span className="owner">
          <PlayerRef who={x}>{playerName(x)}</PlayerRef>
          <Region region={x.region} />
          <span className="date">uploaded {dayText(d?.drawnAt ?? x.at)}</span>
          <BuildTools buildId={x.buildId} resonatorId={x.resonatorId} uid={x.uid} mine={mine} hidden={Boolean(x.hidden)} />
        </span>
      </div>

      {d && teams.length ? (
        <>
          <div className="xt" role="tablist" aria-label="Teams" style={{ '--n': teams.length } as CSSProperties}>
            {teams.map((t) => {
              const on = t.key === team?.key
              const holdsBest = !!best && t.cells.some((cell) => cell.scenario.id === best.scenario.id)
              const names = t.mates.map(resName).join(' / ')
              const swap = peekWeapon ? withWeapon(t, peekWeapon) : null
              if (!t.top) return (
                <span key={t.key} className="xt-tab dead" title={`${names}: ${unscoredText(d, t.cells)}`}>
                  <span className="xt-who"><span className="k-av">{t.mates.map((id) => <img key={id} src={resFace(id)} alt="" />)}</span><span className="xt-nm">{names}</span></span>
                  <span className="xt-st">{unscoredText(d, t.cells)}</span>
                </span>
              )
              const shownTop = swap ?? t.top
              // a recounted tab, and the hovered one, show team damage; other tabs show DPR
              const teamOn = !!swap || peekTeam === t
              const line = teamLine(teamDpr(shownTop))
              return (
                <button key={t.key} className={`xt-tab${on ? ' on' : ''}${holdsBest ? ' best' : ''}${swap ? ' rc-alt' : ''}${peekTeam === t ? ' rc-src' : ''}${teamOn ? ' rc-team' : ''}`} role="tab" aria-selected={on}
                  style={teamOn ? { '--fit': line.fit } as CSSProperties : undefined}
                  title={`${names}, best with ${wpnOf(t.top.scenario.weaponId)?.name ?? 'its weapon'}`} onClick={() => { if (!on) setPick(t.top!.scenario.id) }}
                  onPointerEnter={peekOn({ team: t.key })} onPointerLeave={peekOff} onFocus={peekOn({ team: t.key })} onBlur={peekOff}>
                  <span className="xt-who"><span className="k-av">{t.mates.map((id) => <img key={id} src={resFace(id)} alt="" />)}</span><span className="xt-nm">{names}</span></span>
                  {swap ? <span className="xt-rk"><VsOpen cell={swap} open={picked} /></span>
                    : t.top.rank != null ? <span className="xt-rk">#{grp(t.top.rank)}</span> : null}
                  <div className="xt-g">
                    <span className="xt-dp">{teamOn ? <>{line.text} <em>team</em></> : <>{t.top.dpr != null ? grp(t.top.dpr) : '-'} <em>dpr</em></>}</span>
                    <span className="xt-sc" style={scoreInk(shownTop.score!)}><Rolling text={score1(shownTop.score!)} /></span>
                  </div>
                  {bar(shownTop.score!)}
                </button>
              )
            })}
          </div>
        </>
      ) : null}

      <div className={`xf${d && teams.length ? '' : ' bare'}`}>
        {team ? (
          <div className="xw" role="tablist" aria-label="Weapons" style={{ '--n': weaponOrder.length } as CSSProperties}>
            {weaponOrder.map((weaponId) => {
              const cell = team.cells.find((c) => c.scenario.weaponId === weaponId)
              if (!cell) return null
              const w = wpnOf(weaponId)
              const on = cell.scenario.id === picked?.scenario.id
              const swap = peekTeam ? withWeapon(peekTeam, weaponId) : null
              const shownCell = swap ?? cell
              const teamOn = !!swap || peekWeapon === weaponId
              const line = teamLine(teamDpr(shownCell))
              if (!scored(cell)) return (
                <span key={weaponId} className="xw-c dead" title={`${w?.name ?? weaponId}: ${unscoredText(d!, [cell])}`}>
                  {w?.icon ? <img src={w.icon} alt="" /> : <i />}<b>{w?.name ?? weaponId}</b><em>{unscoredText(d!, [cell])}</em>
                </span>
              )
              return (
                <button key={weaponId} className={`xw-c${on ? ' on' : ''}${cell.scenario.id === best?.scenario.id ? ' best' : ''}${swap ? ' rc-alt' : ''}${peekWeapon === weaponId ? ' rc-src' : ''}${teamOn ? ' rc-team' : ''}`} role="tab" aria-selected={on}
                  style={teamOn ? { '--fit': line.fit } as CSSProperties : undefined}
                  title={cell.rank != null ? `${w?.name ?? weaponId}: #${grp(cell.rank)}${cell.total ? ` of ${grp(cell.total)}` : ''} with this team and weapon` : undefined}
                  onClick={() => setPick(cell.scenario.id)}
                  onPointerEnter={peekOn({ weapon: weaponId })} onPointerLeave={peekOff} onFocus={peekOn({ weapon: weaponId })} onBlur={peekOff}>
                  {w?.icon ? <img src={w.icon} alt="" /> : <i />}<b>{w?.name ?? weaponId}</b>
                  <span className="xw-sc" style={scoreInk(shownCell.score!)}><Rolling text={score1(shownCell.score!)} />
                    <small>{teamOn ? <VsOpen cell={shownCell} open={picked} /> : cell.dpr != null ? grp(cell.dpr) : '-'}</small></span>
                  <em>{teamOn ? <>{line.text} <span>team</span></>
                    : `${ROLE[cell.scenario.weaponRole] ?? cell.scenario.weaponRole}${cell.rank != null ? `, #${grp(cell.rank)}` : ''}`}</em>
                  {bar(shownCell.score!)}
                </button>
              )
            })}
          </div>
        ) : null}
        <div className={`fcard${shown ? '' : ' none'}${drawing ? ' drawing' : ''}`}>
          {detail.error ? <>{detail.error}</>
            : !d ? <AppLdrVrly mode="inline" text="opening the build... :P" />
            : shown ? <>
                <LbCard build={shown.card} score={shown.cell?.score ?? null} damage={shown.cell?.dpr ?? null} holder={{ name: d.name, uid: d.uid }} look={d.card} />
                {drawing ? <span className="fcard-wait"><AppLdrVrly mode="inline" text="putting the card together... :P" /></span> : null}
              </>
            : card.error ? <>{card.error}</>
            : <AppLdrVrly mode="inline" text="putting the card together... :P" />}
          {card.error && shown ? <span className="fcard-err">{card.error}</span> : null}
        </div>
      </div>

      {d && picked && contribution && team ? (
        <section className="xb">
          <div className="xb-hd"><h3>Damage by attack</h3><span>{team.mates.map(resName).join(' / ')} with {weapon?.name ?? picked.scenario.weaponId}</span>
            <span className="r">{grp(contribution.damage)} DPR</span></div>
          <AttackFall resonatorId={d.snapshot.resonator.id} contribution={contribution} />
        </section>
      ) : null}

      {children}
    </div>
  )
}
