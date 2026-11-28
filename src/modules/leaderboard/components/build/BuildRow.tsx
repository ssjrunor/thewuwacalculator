/*
  Author: Runor Ewhro
  description: a build row for boards and other build lists; an open row shows the build detail.
*/

import { lazy, Suspense, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { getBuildEvaluationGrade, getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay'
import { makeEffectiveSetPlan } from '@/engine/gameData/sonataPlan'
import { getCvToneColor } from '@/modules/simulation/features/echoes/lib/metric'
import { lbApi } from '../../api/client'
import { compact, grp, regionCode, resFace, resName, SCALE_LABEL, scaleStat, wpnOf, type ScaleStat } from '../../model/format'
import { playerName } from '../../model/players'
import { SEQ_HUE, SERVER_INK, share, teammates, unrankedWord, type Listed, type Row } from '../../model/listed'
import { useScope } from '../../state/ctx'
import { BoardRef, PlayerRef } from '../Ref'
import { useOwnProfile } from '../Preview'
import { Framed } from '../profile/Framed'
import { khCell, khMate, khSet, khWeapon } from './KitHover'
import { ownsUid } from '../../chrome/chrome'
import { formatTruncCompact } from '@/shared/lib/number'

// an opened build's body imports the engine for the card, scenarios and rotation, so it loads when a row first opens
// (or after the list paints, preloadFigures) and stays out of the list chunk
const loadFigures = () => import('./BuildDetail')
const BuildDetail = lazy(() => loadFigures().then((module) => ({ default: module.BuildDetail })))
// fetches the opened-build code while the page is idle, which opens the first row at once
export function preloadFigures(): void {
  const start = () => { void loadFigures() }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 3_000 })
  else setTimeout(start, 1_500)
}

export interface RowOpts {
  // activity: the time and what happened
  lead?: { kind: 'top' | 'up'; text: string }
  // a resonator cell, for lists that span boards
  res?: boolean
  // one page-specific cell before DPR, with its column width
  extra?: ReactNode
  extraLabel?: string
  xw?: string
}

const LEAD_TAG = { top: '#1', up: 'Upload' }

// every column except the player's is sized to its longest known content: "23:59", "999,999" (or "Unranked"),
// "Yangyang: Xuanling", two teammates + weapon (and the "Team & weapon" label), three set icons, "100.0/400.0",
// "399", an HP "39,999", "250.0%", "1,234,567", an SSS "199.9%"; the player's name takes the remaining width
export const rowColumns = (o: RowOpts) => [o.lead && '3rem', '3.4rem', o.res && '9.2rem', 'minmax(8rem, 1fr)', '3.2rem', '5.1rem',
  '3.8rem', '5.2rem', '1.5rem', '3rem', '3rem', o.extra != null && (o.xw ?? '7rem'), '4.7rem', '4.6rem'].filter(Boolean).join(' ')

// a build's rank, plain and right aligned, with the top three in full ink; `of` adds the board size under it for
// lists spanning boards, and unranked builds show the reason
export function Standing({ x, of }: { x: Pick<Row, 'rank' | 'total' | 'scoring'>; of?: boolean }) {
  const why = unrankedWord(x)
  if (x.rank == null) return <span className="rk ix unr">{why}</span>
  return (
    <span className={`rk ix${x.rank <= 3 ? ' top' : ''}`} title={x.total ? `Top ${share(x.rank, x.total)}%: #${grp(x.rank)} of ${grp(x.total)}` : `#${grp(x.rank)}`}>
      {grp(x.rank)}{of && x.total ? <em>of {compact(x.total)}</em> : null}
    </span>
  )
}

export function Region({ region }: { region: string | null }) {
  const code = regionCode(region)
  return code && region ? <span className="k-rg" style={{ '--rc': SERVER_INK[region] } as CSSProperties}>{code}</span> : null
}

export function Seq({ n, cls = '' }: { n: number; cls?: string }) {
  const hue = SEQ_HUE[n] ?? null
  return <span className={`k-sq${hue == null ? ' std' : ''}${cls ? ` ${cls}` : ''}`} style={hue == null ? undefined : { '--sqh': hue } as CSSProperties}>S{n}</span>
}

export function Grade({ score }: { score: number }) {
  const grade = getBuildEvaluationGrade(score)
  return grade ? <span className="k-g" style={{ '--gc': getBuildEvaluationTone(score).color } as CSSProperties}>{grade}</span> : null
}

// a build with no scenario has no team: just the weapon its card was read with
export function CardWeapon({ weaponId }: { weaponId: string | null | undefined }) {
  const weapon = weaponId ? wpnOf(weaponId) : null
  return <span className="k-kit">{weapon?.icon ? <img className="w" src={weapon.icon} alt={weapon.name} {...khWeapon(weapon.id)} /> : null}</span>
}

// the row's teammates and weapon; with the build id, each opens its kit hover (KitHover.tsx)
export function Kit({ x }: { x: Pick<Listed, 'resonatorId' | 'scenario'> & { buildId?: string } }) {
  const weapon = wpnOf(x.scenario.weaponId)
  const hover = Boolean(x.buildId)
  return (
    <span className="k-kit" {...(x.buildId ? khCell(x.buildId, x.scenario.id, x.resonatorId, x.scenario.members) : {})}>
      {teammates(x).map((id) => <img key={id} src={resFace(id)} alt={resName(id)} {...(hover ? khMate(id) : {})} />)}
      {weapon?.icon ? <img className="w" src={weapon.icon} alt={weapon.name} {...(hover ? khWeapon(weapon.id) : {})} /> : null}
    </span>
  )
}

export function Sets({ x }: { x: Pick<Listed, 'sets'> }) {
  // the sets whose bonus is active; a card of single pieces shows them all
  const on = makeEffectiveSetPlan(x.sets.map(set => [set.id, set.pieces] as const))
    .map(set => ({ id: set.setId, pieces: set.pieces }))
  return (
    <span className="k-sets">
      {(on.length ? on : x.sets).map((set) => {
        const icon = getSntSetIco(set.id)
        const label = `${getSntSetNam(set.id)} ${set.pieces}pc`
        return icon ? <img key={set.id} src={icon} alt={label} {...khSet(set.id, set.pieces)} /> : null
      })}
    </span>
  )
}

// CR / CD, crit value in the app's CV colours, the resonator's scaling stat (ATK, HP or DEF) and ER; a dash for a
// build with no stats yet. `tag` names the stat under its value, for lists spanning boards
export function StatCells({ s, stat, tag }: { s: Listed['stats']; stat: ScaleStat; tag?: boolean }) {
  return (
    <>
      <span className="k-n">{s ? `${formatTruncCompact(s.critRate, 1)}/${formatTruncCompact(s.critDmg, 1)}` : '-'}</span>
      <span className="k-n r cv" style={s?.critGrade != null ? { '--cvt': getCvToneColor(s.critGrade) } as CSSProperties : undefined}>{s ? formatTruncCompact(s.critValue, 0) : '-'}</span>
      <span className={`k-n r${tag ? ' k-st' : ''}`}>{s ? grp(s[stat]) : '-'}{tag && s ? <em>{SCALE_LABEL[stat]}</em> : null}</span>
      <span className="k-n r">{s ? `${formatTruncCompact(s.energyRegen, 1)}%` : '-'}</span>
    </>
  )
}

// `stat` is a board's scaling stat; lists spanning boards head the column "Stat", with no sort across stats
export function BuildHead({ o, stat = 'atk', sort, onSort }: { o: RowOpts; stat?: ScaleStat; sort?: string; onSort?: (key: string) => void }) {
  const cell = (label: string, key?: string, right?: boolean) => onSort && key
    ? <span className={right ? 'r' : ''}><button className={sort === key ? 'on' : ''} onClick={() => onSort(key)}>{label}</button></span>
    : <span className={right ? 'r' : ''}>{label}</span>
  return (
    <div className="colh brow" style={{ gridTemplateColumns: rowColumns(o) }}>
      {o.lead ? <span>When</span> : null}
      <span className="rk-ix">{onSort ? <button className={sort === 'rank' ? 'on' : ''} onClick={() => onSort('rank')} title="Rank">#</button> : '#'}</span>
      {o.res ? cell('Resonator', 'res') : null}
      <span>Player</span><span>Sequence</span><span>Team & weapon</span><span>Set</span>
      {cell('CR / CD')}{cell('CV', 'cv', true)}{o.res ? cell('Stat', undefined, true) : cell(SCALE_LABEL[stat], 'stat', true)}{cell('ER', 'er', true)}
      {o.extra != null ? <span>{o.extraLabel}</span> : null}
      {cell('DPR', 'dmg', true)}{cell('Score', 'score', true)}
    </div>
  )
}

export function BuildRow({ x, o = {}, i = 0, open, onToggle, mine, p, cls, children }: {
  x: Row
  o?: RowOpts
  i?: number
  open: boolean
  onToggle: () => void
  // true when the viewer owns the build (a hidden uid only hides it from the row)
  mine?: boolean
  // the bottom bar's length, 0 to 100; the build's standing by default
  p?: number
  cls?: string
  // under the BuildDetail body: the owner's card list, for one
  children?: ReactNode
}) {
  const { me } = useScope()
  const you = mine ?? ownsUid(me, x.uid)
  const why = unrankedWord(x)
  // an unranked build has no standing to fill the bar with
  const bar = p ?? (x.rank == null ? 0 : x.total ? (1 - (x.rank - 1) / x.total) * 100 : 100)
  const key = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle() }
  }
  const tone = x.score != null ? getBuildEvaluationTone(x.score) : null
  // a customized player's name renders on their namecard, cut from their banner, on rows listed outside their profile
  // (those rows have a look, null when plain); the viewer's own rows read their profile privately, pending images
  // included
  const listed = x.look !== undefined
  const own = useOwnProfile(listed && you)?.profile
  const look = own ? (own.accent || own.banner ? { displayName: own.displayName ?? null, accent: own.accent ?? null, avatar: own.avatar ?? null, banner: own.banner ?? null,
    avatarFrame: own.avatarFrame ?? null, bannerFrame: own.bannerFrame ?? null } : null)
    : x.look ?? null
  // a tuned row and the build it opens use the player's accent
  const tint: Record<string, string> = look?.accent ? { '--res': look.accent, '--accent': look.accent } : {}
  const ink: Record<string, string | number> = tone ? { '--gc': tone.color, '--tb': tone.bg, '--tt': tone.text } : {}
  return (
    <>
      <div role="button" tabIndex={0} aria-expanded={open} data-row={x.buildId}
        className={`row brow${open ? ' open' : ''}${you ? ' me' : ''}${why ? ' unr' : ''}${x.hidden ? ' hid' : ''}${look?.accent ? ' tint' : ''}${cls ? ` ${cls}` : ''}`}
        style={{ gridTemplateColumns: rowColumns(o), '--p': `${bar.toFixed(1)}%`, ...ink, ...tint, '--i': Math.min(i, 24) } as CSSProperties}
        onClick={onToggle} onKeyDown={key}>
        {o.lead ? <span className={`br-ev k-${o.lead.kind}`}><b>{o.lead.text}</b><i>{LEAD_TAG[o.lead.kind]}</i></span> : null}
        <Standing x={x} of={o.res} />
        {o.res ? <span className="nm br-res"><img src={resFace(x.resonatorId)} alt="" /><BoardRef id={x.resonatorId}>{resName(x.resonatorId)}</BoardRef></span> : null}
        <span className={`nm${look ? ' k-nc' : ''}`} style={look?.accent ? { '--me': look.accent } as CSSProperties : undefined}>
          {look ? look.banner ? <Framed className="k-nc-bg" src={lbApi.mediaUrl(look.banner)} frame={look.bannerFrame} /> : <span className="k-nc-bg" /> : null}
          {look ? look.avatar ? <Framed className="k-nc-av" src={lbApi.mediaUrl(look.avatar)} frame={look.avatarFrame} />
            : <span className="k-nc-av mono">{(look.displayName || x.name || '?')[0].toUpperCase()}</span> : null}
          <Region region={x.region} /><PlayerRef who={x}>{playerName(x)}</PlayerRef>{you ? <span className="k-you">you</span> : null}
          {x.hidden ? <span className="k-you k-hid" title="Only you can see this build">hidden</span> : null}</span>
        <Seq n={x.sequence} cls="k-n" />
        {x.scenario ? <Kit x={{ resonatorId: x.resonatorId, scenario: x.scenario, buildId: x.buildId }} /> : <CardWeapon weaponId={x.weaponId} />}
        <Sets x={x} />
        <StatCells s={x.stats} stat={scaleStat(x.resonatorId)} tag={o.res} />
        {o.extra ?? null}
        <span className="k-b r">{x.dpr != null ? grp(x.dpr) : '-'}</span>
        <span className="bsc">{x.score != null
          ? <><Grade score={x.score} /><b className="bs-n">{formatTruncCompact(x.score, 1)}</b><i className="bs-u">%</i><span className="bs-w" /></>
          : <b className="bs-n">-</b>}</span>
      </div>
      {open ? <div className={`k-ex${look?.accent ? ' tint' : ''}`} style={tint as CSSProperties}>
        <Suspense fallback={<AppLdrVrly mode="inline" text="Opening build..." />}><BuildDetail x={x} mine={you}>{children}</BuildDetail></Suspense>
      </div> : null}
    </>
  )
}
