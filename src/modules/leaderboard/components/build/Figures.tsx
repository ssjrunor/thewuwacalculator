/*
  Author: Runor Ewhro
  description: an opened build. the head shows the board rank and the selected
               scenario's score and DPR. teams are tabs on the card, best score
               first; the selected team's weapons sit on the card frame, and
               selecting one redraws the card for that team and weapon, with the
               rotation waterfall below. the card renders at its natural 992x720,
               and the flag opens a report panel. an upload not yet on a board
               also opens: the submitted build's own card with the score pending
               and the teams it can join.
*/

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Flag, X } from 'lucide-react'
import type { BuildDetailResponse, CellDetailResponse, ScenarioCell } from '@/domain/leaderboard/api'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import { queryClient } from '@/shared/lib/queryClient'
import { errorText } from '../../model/cardTrack'
import { lbq, loadCellDetail } from '../../api/queries'
import { CardBuildError, loadCardBuild, loadPendingCard, type CardBuild } from '../../model/cardBuild'
import { dayText, grp, resFace, resName, score1, scoreInk, topText, wpnOf } from '../../model/format'
import { LbCard } from './LbCard'
import { ReportBuild } from './ReportBuild'
import { Region, Seq } from './BuildRow'
import { type Listed } from '../../model/listed'
import { playerName } from '../../model/players'
import { PlayerRef } from '../Ref'
import { AttackFall } from './AttackFall'

/** what an opened build needs from its row: a scored board row, or an upload with no rank yet. */
export type Opened = Pick<Listed, 'buildId' | 'resonatorId' | 'uid' | 'name' | 'region' | 'at' | 'total'> & {
  rank: number | null
  dpr: number | null
}

// a build's detail, and a picked scenario's, from the query cache: one read shared by every view of the build.
const loadDetail = (buildId: string): Promise<BuildDetailResponse> => queryClient.fetchQuery(lbq.build(buildId))

const isBest = (d: BuildDetailResponse, cell: ScenarioCell) => cell.scenario.id === d.best?.scenario.id

/** one cell's input and damage split; the detail includes the best cell's, and other cells are fetched. */
function loadCell(d: BuildDetailResponse, cell: ScenarioCell): Promise<{ input: CellDetailResponse['input']; contribution: CellDetailResponse['contribution'] }> {
  if (isBest(d, cell) && d.scoredInput) return Promise.resolve({ input: d.scoredInput, contribution: d.bestContribution ?? null })
  return loadCellDetail(d.buildId, cell.scenario.id)
}

/** the card for one cell, or the submitted build alone before any score. */
function loadCard(d: BuildDetailResponse, cell: ScenarioCell | null): Promise<CardBuild> {
  if (!cell) return loadPendingCard(d)
  return loadCell(d, cell).then(({ input }) => loadCardBuild(d, cell, input))
}

function useAsync<T>(key: string | null, load: () => Promise<T>): { value: T | null; error: string | null } {
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

/** team tabs: scored teams by best score, then the rest in their original order. */
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

/** why a team or weapon has no score, in the reader's words. */
function unscoredText(d: BuildDetailResponse, cells: ScenarioCell[]): string {
  if (cells.some((cell) => cell.reason === 'not_scored_yet')) return d.scoringStatus === 'scoring' ? 'Scoring' : 'Not scored yet'
  if (cells.every((cell) => cell.status === 'error')) return 'Could not score'
  return "Not supported yet"
}

export function Figures({ x, mine, children }: { x: Opened; mine: boolean; children?: ReactNode }) {
  const [report, setReport] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const detail = useAsync(x.buildId, () => loadDetail(x.buildId))
  const d = detail.value

  const best = d?.best ?? null
  const picked = (pick ? d?.cells.find((cell) => cell.scenario.id === pick && scored(cell)) : null) ?? best
  // the selected scenario's card, or the submitted build alone before any score
  const card = useAsync<CardBuild>(d ? `${x.buildId}:${picked?.scenario.id ?? 'pending'}` : null, () => loadCard(d!, picked))
  // while the next card draws, the last one stays up, dimmed.
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
          {mine ? null : <button className={`flag${report ? ' on' : ''}`} title="Report this build" aria-label="Report this build" aria-expanded={report}
            onClick={() => setReport((on) => !on)}><Flag size={13} /></button>}
        </span>
      </div>

      {d && teams.length ? (
        <>
          <div className="xt" role="tablist" aria-label="Teams" style={{ '--n': teams.length } as CSSProperties}>
            {teams.map((t) => {
              const on = t.key === team?.key
              const holdsBest = !!best && t.cells.some((cell) => cell.scenario.id === best.scenario.id)
              const names = t.mates.map(resName).join(' / ')
              if (!t.top) return (
                <span key={t.key} className="xt-tab dead" title={`${names}: ${unscoredText(d, t.cells)}`}>
                  <span className="xt-who"><span className="k-av">{t.mates.map((id) => <img key={id} src={resFace(id)} alt="" />)}</span><span className="xt-nm">{names}</span></span>
                  <span className="xt-st">{unscoredText(d, t.cells)}</span>
                </span>
              )
              return (
                <button key={t.key} className={`xt-tab${on ? ' on' : ''}${holdsBest ? ' best' : ''}`} role="tab" aria-selected={on}
                  title={`${names}, best with ${wpnOf(t.top.scenario.weaponId)?.name ?? 'its weapon'}`} onClick={() => { if (!on) setPick(t.top!.scenario.id) }}>
                  <span className="xt-who"><span className="k-av">{t.mates.map((id) => <img key={id} src={resFace(id)} alt="" />)}</span><span className="xt-nm">{names}</span></span>
                  {t.top.rank != null ? <span className="xt-rk">#{grp(t.top.rank)}</span> : null}
                  <span className="xt-sc" style={scoreInk(t.top.score!)}>{score1(t.top.score!)}</span>
                  <span className="xt-dp">{t.top.dpr != null ? grp(t.top.dpr) : '-'}<em>DPR, best weapon</em></span>
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
              if (!scored(cell)) return (
                <span key={weaponId} className="xw-c dead" title={`${w?.name ?? weaponId}: ${unscoredText(d!, [cell])}`}>
                  {w?.icon ? <img src={w.icon} alt="" /> : <i />}<b>{w?.name ?? weaponId}</b><em>{unscoredText(d!, [cell])}</em>
                </span>
              )
              return (
                <button key={weaponId} className={`xw-c${on ? ' on' : ''}${cell.scenario.id === best?.scenario.id ? ' best' : ''}`} role="tab" aria-selected={on}
                  title={cell.rank != null ? `${w?.name ?? weaponId}: #${grp(cell.rank)}${cell.total ? ` of ${grp(cell.total)}` : ''} with this team and weapon` : undefined}
                  onClick={() => setPick(cell.scenario.id)}>
                  {w?.icon ? <img src={w.icon} alt="" /> : <i />}<b>{w?.name ?? weaponId}</b>
                  <span className="xw-sc" style={scoreInk(cell.score!)}>{score1(cell.score!)}<small>{cell.dpr != null ? grp(cell.dpr) : '-'}</small></span>
                  <em>{ROLE[cell.scenario.weaponRole] ?? cell.scenario.weaponRole}{cell.rank != null ? `, #${grp(cell.rank)}` : ''}</em>
                </button>
              )
            })}
          </div>
        ) : null}
        <div className={`fcard${shown ? '' : ' none'}${drawing ? ' drawing' : ''}`}>
          {detail.error ? <>{detail.error}</>
            : !d ? <AppLdrVrly mode="inline" text="opening the build... :P" />
            : shown ? <>
                <LbCard build={shown.card} score={shown.cell?.score ?? null} damage={shown.cell?.dpr ?? null} holder={{ name: d.name, uid: d.uid }} />
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

      {mine ? null : (
        <section className={`pn${report ? ' on' : ''}`} style={{ '--k': 'var(--warn)' } as CSSProperties}>
          <div>
            <div className="pn-h"><span className="big" style={{ fontSize: 15 }}>Report this build</span>
              <button className="x" aria-label="Close" title="Close" onClick={() => setReport(false)}><X size={13} /></button></div>
            {report ? <ReportBuild key={x.buildId} buildId={x.buildId} onClose={() => setReport(false)} /> : null}
          </div>
        </section>
      )}
      {children}
    </div>
  )
}
