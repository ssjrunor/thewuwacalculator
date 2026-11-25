/*
  Author: Runor Ewhro
  description: kit hovers on a build row's teammates, weapon and set. the
               hovered icon grows in place into a medallion whose ring shows the
               figure (a teammate's share of team damage, the weapon's rank, the
               set's pieces) and overlaps the top corner of a card growing out of
               it. a teammate card splits the team's damage and lists each of
               their buffs that reached the scored resonator with the share of
               its damage they covered; a weapon card shows its level 90 stats
               and its passive at the board's rank; a set card shows its tiers,
               ticked when met. icons opt in with data-kh, and one layer per page
               listens for them. moving to a nearby icon slides the open
               medallion and its card to it without closing. the card flips above
               near the screen bottom and hides on scroll, Escape or a click.
*/

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { CellDetailResponse, TeamBuff } from '@/domain/leaderboard/api'
import { canonicalResonatorId } from '@/domain/rotationActions/identities'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects'
import { leaderboardWeaponRank } from '@/engine/leaderboard/weaponRank'
import { fmtWpnStatDs, resPssvPrms, weaponStatsAt, WPNSTATLBLS } from '@/modules/simulation/features/weapons/lib/weapon'
import { getRarityColor } from '@/modules/simulation/model/display'
import { RichDscr } from '@/modules/simulation/ui/RichDescription'
import { cmp, grp, resColor, resFace, resName, wpnOf } from '../../model/format'
import { loadCellDetail } from '../../api/queries'

type Kind = 'mate' | 'wpn' | 'set'
interface Subject {
  kind: Kind
  id: string
  /** the scored resonator, then its teammates in seat order. */
  team: string[]
  build: string
  scenario: string
  pieces: number
  res: string
}

/** hover attributes for a kit icon, spread onto the img. */
export const khMate = (id: string) => ({ 'data-kh': 'mate', 'data-kh-id': id })
export const khWeapon = (id: string) => ({ 'data-kh': 'wpn', 'data-kh-id': id })
export const khSet = (id: number, pieces: number) => ({ 'data-kh': 'set', 'data-kh-id': String(id), 'data-kh-pc': String(pieces) })
/** attributes of the kit's cell: the build and scenario its teammates are read from. */
export const khCell = (buildId: string, scenarioId: string, scored: string, members: string[]) => ({
  'data-kh-build': buildId, 'data-kh-scn': scenarioId,
  'data-kh-team': [scored, ...members.filter((id) => id !== scored)].join(','),
})

function subjectOf(img: HTMLElement): Subject | null {
  const d = img.dataset
  const kind = d.kh as Kind | undefined
  if (!kind || !d.khId) return null
  const cell = img.closest<HTMLElement>('[data-kh-build]')?.dataset
  if (kind === 'mate' && !cell?.khBuild) return null
  const res = getComputedStyle(img).getPropertyValue('--res').trim()
  return { kind, id: d.khId, team: cell?.khTeam?.split(',') ?? [], build: cell?.khBuild ?? '', scenario: cell?.khScn ?? '',
    pieces: Number(d.khPc ?? 0), res: res || resColor(cell?.khTeam?.split(',')[0] ?? '') }
}

// settled cells, which paint previously seen teammates at once
const settled = new Map<string, CellDetailResponse>()
const failed = new Set<string>()
const same = (a: string, b: string) => canonicalResonatorId(a) === canonicalResonatorId(b)

/* the ring: a box 4.6rem wide in tenths of a rem, every arc from twelve o'clock, drawn in when the layer turns on. */
const BOX = 46, R = 20.5, SW = 1.9
const C = 2 * Math.PI * R
const OFF = 'color-mix(in srgb, var(--text) 16%, transparent)'
type Arc = { from: number; f: number; ink: string; delay: number }

function Ring({ arcs, className }: { arcs: Arc[]; className?: string }) {
  return (
    <svg viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" className={className}>
      <circle cx={BOX / 2} cy={BOX / 2} r={R} fill="none" stroke="color-mix(in srgb, var(--text) 9%, transparent)" strokeWidth={SW} />
      {arcs.map((a, at) => (
        <circle key={at} className="kh-arc" cx={BOX / 2} cy={BOX / 2} r={R} stroke={a.ink} strokeWidth={SW}
          transform={`rotate(${(-90 + a.from * 360).toFixed(2)} ${BOX / 2} ${BOX / 2})`}
          style={{ '--l': (Math.max(0, a.f) * C).toFixed(1), animationDelay: `${a.delay}s` } as CSSProperties} />
      ))}
    </svg>
  )
}

/** pips around the ring, lit up to n in the subject's colour (a set's own, a weapon's rarity) and mixed toward the
    text ink like the other figures, which keeps white sets and gold legible on light themes; pips and gaps are
    equal, with a gap centred on twelve o'clock. GAP is the clear space between round caps, which places the caps
    inside each pip's share. */
const GAP = 2.6
// white sets (Moonlit Clouds and similar) would mix to the unlit grey on light themes, so they draw in text ink
const paper = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) && [1, 3, 5].every((at) => parseInt(hex.slice(at, at + 2), 16) > 0xe0)
function pips(count: number, lit: number, colour: string | null | undefined): Arc[] {
  const on = colour && !paper(colour) ? `color-mix(in srgb, ${colour} var(--figmix), var(--text))` : 'var(--text)'
  const g = GAP / C, cap = SW / 2 / C, len = 1 / count - g
  return Array.from({ length: count }, (_, k) => ({
    from: g / 2 + k / count + cap, f: len - 2 * cap,
    ink: k < lit ? on : OFF, delay: .22 + k * .05,
  }))
}

type Split = Array<{ id: string; damage: number; share: number; ink: string }>

/* each member in their attribute colour; a second member of the same attribute gets a lighter shade and a third a
   darker one, which keeps the split readable when two share an attribute. */
const SHADE = ['', 'color-mix(in srgb, {c} 55%, white)', 'color-mix(in srgb, {c} 60%, black)']
function inksOf(team: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return team.map((id) => {
    const c = resColor(id), n = seen.get(c) ?? 0
    seen.set(c, n + 1)
    return n ? SHADE[Math.min(n, 2)].replace('{c}', c) : c
  })
}
function splitOf(s: Subject, cell: CellDetailResponse | null): Split | null {
  const members = cell?.contribution?.team?.members
  if (!members?.length) return null
  const inks = inksOf(s.team)
  const rows = s.team.map((id, at) => ({ id, ink: inks[at], damage: members.find((m) => same(m.resonatorId, id))?.damage ?? 0 }))
  const total = rows.reduce((sum, row) => sum + row.damage, 0)
  return total > 0 ? rows.map((row) => ({ ...row, share: row.damage / total })) : null
}

const pct = (share: number) => `${Math.round(share * 100)}%`
const role = (s: Subject, id: string) => same(id, s.team[0]) ? 'res' : same(id, s.id) ? 'on' : ''

function mateArcs(split: Split | null): Arc[] {
  if (!split) return []
  const g = 3.1 / C
  let at = 0
  return split.map((m) => {
    const arc = { from: at + g / 2, f: m.share - g, ink: m.ink, delay: .22 }
    at += m.share
    return arc
  })
}

const KIND: Record<string, string> = { echoSet: 'Echo set', echo: 'Main echo', weapon: 'Weapon' }
function buffIcon(b: TeamBuff): { src: string | null; face: boolean } {
  if (b.source.type === 'weapon') return { src: wpnOf(b.source.id)?.icon ?? null, face: false }
  if (b.source.type === 'echoSet') return { src: getSntSetIco(Number(b.source.id)), face: false }
  if (b.source.type === 'echo') return { src: getEchoById(b.source.id)?.icon ?? null, face: false }
  return { src: resFace(b.from), face: true }
}
const buffName = (b: TeamBuff) => b.source.type === 'weapon' ? wpnOf(b.source.id)?.name ?? b.name : b.name

function MateBody({ s, cell, failed }: { s: Subject; cell: CellDetailResponse | null; failed: boolean }) {
  if (failed) return <p className="kh-note">This run did not load.</p>
  if (!cell) return <p className="kh-note">Reading the run</p>
  const team = cell.contribution?.team
  const split = splitOf(s, cell)
  if (!team || !split) return <p className="kh-note">to be calculated...</p>
  const buffs = team.buffs.filter((b) => same(b.from, s.id))
  return (
    <>
      <section className="kh-s">
        <h4>Team damage <em>{grp(split.reduce((sum, m) => sum + m.damage, 0))} DPR</em></h4>
        <div className="kh-sp">{split.map((m, at) => (
          <i key={m.id} style={{ width: `${(m.share * 100).toFixed(1)}%`, background: m.ink, animationDelay: `${.12 + at * .06}s` }} />
        ))}</div>
        <div className="kh-sk">{split.map((m) => (
          <span key={m.id} className={role(s, m.id)} style={{ '--c': m.ink } as CSSProperties}><i />{resName(m.id)} <b>{pct(m.share)}</b> {cmp(m.damage)}</span>
        ))}</div>
      </section>
      <section className="kh-s">
        <h4>Buffs on {resName(s.team[0])} <em>applies...</em></h4>
        {buffs.length ? (
          <ul className="kh-bf" style={{ '--ink': split.find((m) => same(m.id, s.id))?.ink } as CSSProperties}>{buffs.map((b) => {
            const icon = buffIcon(b)
            return (
              <li key={`${b.source.type}:${b.source.id}:${b.name}`}>
                {icon.src ? <img className={icon.face ? 'f' : ''} src={icon.src} alt="" /> : <span />}
                <span className="kh-nm">{buffName(b)}<small>{KIND[b.source.type] ?? b.kind}</small></span>
                <span className="kh-fx">
                  {b.effects.map((e, at) => <span key={at}>{e.text} <b>{e.value}</b></span>)}
                  <span className="kh-cov" style={{ '--c': `${b.covers}%` } as CSSProperties}><i />{Math.round(b.covers)}%</span>
                </span>
              </li>
            )
          })}</ul>
        ) : <p className="kh-note">oh, they don't offer anything useful to {resName(s.team[0])}'s damage.</p>}
      </section>
    </>
  )
}

function WeaponBody({ id }: { id: string }) {
  const weapon = wpnOf(id)
  if (!weapon) return null
  const rank = leaderboardWeaponRank(weapon.id, weapon.rarity)
  const stats = weaponStatsAt(weapon, 90)
  return (
    <>
      <section className="kh-s">
        <div className="kh-st">
          <span>Lv.<b>90</b></span>
          <span>ATK<b>{Math.floor(stats.atk)}</b></span>
          {weapon.statKey ? <span>{WPNSTATLBLS[weapon.statKey] ?? weapon.statKey}<b>{fmtWpnStatDs(weapon.statKey, stats.scndStatVl)}</b></span> : null}
        </div>
      </section>
      {weapon.passive?.desc ? (
        <section className="kh-s">
          {weapon.passive.name ? <p className="kh-pn">{weapon.passive.name}</p> : null}
          <RichDscr className="kh-ds" description={weapon.passive.desc} params={resPssvPrms(weapon.passive.params, rank)} />
        </section>
      ) : null}
    </>
  )
}

const TIERS = [['onePiece', 1], ['twoPiece', 2], ['threePiece', 3], ['fivePiece', 5]] as const
function SetBody({ id, pieces }: { id: number; pieces: number }) {
  const def = getEchoSetDe(id)
  const tiers = def ? TIERS.flatMap(([tier, need]) => def.desc[tier] ? [{ need, desc: def.desc[tier]! }] : []) : []
  if (!tiers.length) return null
  const icon = getSntSetIco(id)
  return (
    <section className="kh-s">
      <div className="kh-trs">{tiers.map((t) => (
        <div key={t.need} className={`kh-tr${pieces >= t.need ? ' on' : ''}`}>
          <span className="kh-tr-m" />
          <div>
            <span className="kh-tr-h">{icon ? <img src={icon} alt="" /> : null}{getSntSetNam(id)} <em>({Math.min(pieces, t.need)}/{t.need})</em></span>
            <RichDscr className="kh-ds" description={t.desc} />
          </div>
        </div>
      ))}</div>
    </section>
  )
}

interface Face { src: string | null; sq: boolean; arcs: Arc[]; name: string; seq: number | null; cap: ReactNode; body: ReactNode }
function faceOf(s: Subject): Face {
  const key = `${s.build}|${s.scenario}`
  if (s.kind === 'mate') {
    const cell = settled.get(key) ?? null
    const split = splitOf(s, cell)
    const mine = split?.find((m) => same(m.id, s.id))
    return { src: resFace(s.id), sq: false, name: resName(s.id), arcs: mateArcs(split),
      seq: cell?.input?.members.find((m) => same(m.resonatorId, s.id))?.sequence ?? null,
      cap: mine ? <><b>{pct(mine.share)}</b> of team damage</> : null,
      body: <MateBody s={s} cell={cell} failed={failed.has(key)} /> }
  }
  if (s.kind === 'wpn') {
    const weapon = wpnOf(s.id)
    const rank = weapon ? leaderboardWeaponRank(weapon.id, weapon.rarity) : 1
    return { src: weapon?.icon ?? null, sq: true, name: weapon?.name ?? s.id, arcs: pips(5, rank, getRarityColor(weapon?.rarity)), seq: null,
      cap: <>Rank <b>{rank}</b> of 5</>, body: <WeaponBody id={s.id} /> }
  }
  const id = Number(s.id)
  const max = getEchoSetDe(id)?.setMax ?? 5
  return { src: getSntSetIco(id), sq: true, name: getSntSetNam(id), arcs: pips(max, s.pieces, getSntSetClr(id)), seq: null,
    cap: <><b>{s.pieces}</b> of {max} {max === 1 ? 'piece' : 'pieces'}</>, body: <SetBody id={id} pieces={s.pieces} /> }
}
// two rings that would draw the same figure (two teammates of one row share a split) are one ring.
const ringKey = (arcs: Arc[]) => arcs.map((a) => `${a.from.toFixed(4)}:${a.f.toFixed(4)}:${a.ink}`).join('|')

function CardText({ f }: { f: Face }) {
  return (
    <>
      <header className="kh-h">
        <h3>{f.name}{f.seq != null ? <span className="kh-sq">S{f.seq}</span> : null}</h3>
        {f.cap ? <p className="kh-cap">{f.cap}</p> : null}
      </header>
      {f.body}
    </>
  )
}

type Entry = { s: Subject; n: number }
/** layer state: `open` counts fresh opens (each remounts the medallion), and a slide keeps it while `prev` fades out. */
type View = { open: number; cur: Entry; prev: Entry | null }
type Pt = { x: number; y: number; cl: number }

/* slide thresholds: icons this near (a row's kit, the rows above and below) pass the medallion over without closing.
   a fresh open waits for the pointer to settle, and leaving an icon keeps the medallion briefly for the next one.
   the spring keeps its velocity when the target moves, which curves the path of a second hop. */
const NEAR = 7, SETTLE = 70, GRACE = 200, SWAP = 320
const SPRING = { k: 300, d: 30 }
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

export function KitHoverLayer() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View | null>(null)
  // cells are stored in settled and failed; a finished request bumps this to reread them
  const [, landed] = useState(0)
  const live = useRef({
    /** the icon under the medallion (hidden while covered), and the icon a slide is leaving (shown once cleared). */
    icon: null as HTMLElement | null, left: null as HTMLElement | null, leftAt: { x: 0, y: 0, w: 0 },
    hovered: null as HTMLElement | null,
    x: 0, y: 0, w: 0, n: 0, open: 0, mode: '' as '' | 'open' | 'glide', h0: 0, swapping: false,
    P: { x: 0, y: 0, cl: 0 } as Pt, V: { x: 0, y: 0, cl: 0 } as Pt, T: { x: 0, y: 0, cl: 0 } as Pt,
    raf: 0, shut: 0, back: 0, wait: 0, swap: 0,
  })
  const location = useLocation()

  const still = () => Boolean(ref.current?.closest('.reduce-animation, .no-entrance-anim'))

  const paint = () => {
    const el = ref.current, card = el?.querySelector<HTMLElement>('.kh-c')
    if (!el || !card) return
    const { P } = live.current
    el.style.left = `${P.x}px`; el.style.top = `${P.y}px`
    card.style.left = `${P.cl - P.x}px`
    // the header text starts just past the medallion, wherever it sits on the card edge
    card.style.setProperty('--kh-in', `${P.x - P.cl}px`)
  }

  // place the card with the medallion's centre 2.5rem in from its edge, on screen, and above the icon near the bottom;
  // an open card above the icon stays above while it fits (`keep`), so a slide or a teammate's data loading does not flip it
  const aim = (h?: number, keep = false) => {
    const el = ref.current, card = el?.querySelector<HTMLElement>('.kh-c')
    if (!el || !card) return
    const rem = remPx(), l = live.current
    const height = h ?? card.offsetHeight
    const fitsUp = l.y - height > 76, fitsDown = l.y + height <= innerHeight - 76
    el.classList.toggle('up', keep && el.classList.contains('up') ? fitsUp : !fitsDown && fitsUp)
    l.T = { x: l.x, y: l.y, cl: Math.max(12 + 2.5 * rem, Math.min(l.x, innerWidth - card.offsetWidth + 2.5 * rem - 12)) - 2.5 * rem }
  }

  // show the icon a slide leaves once the medallion clears it, and hide the next icon as the medallion lands on it
  const track = () => {
    const l = live.current
    if (l.left && Math.hypot(l.P.x - l.leftAt.x, l.P.y - l.leftAt.y) > l.leftAt.w / 2) { l.left.style.opacity = ''; l.left = null }
    if (l.icon && Math.hypot(l.P.x - l.x, l.P.y - l.y) < l.w / 2) l.icon.style.opacity = '0'
  }

  // effect events: called only from the effects below and the listeners they attach, reading refs as they are then.
  const glideTo = useEffectEvent(() => {
    const l = live.current
    if (still()) { l.P = { ...l.T }; l.V = { x: 0, y: 0, cl: 0 }; paint(); track(); return }
    if (l.raf) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(.032, (now - last) / 1000); last = now
      let moving = false
      for (const k of ['x', 'y', 'cl'] as const) {
        l.V[k] += (SPRING.k * (l.T[k] - l.P[k]) - SPRING.d * l.V[k]) * dt
        l.P[k] += l.V[k] * dt
        if (Math.abs(l.T[k] - l.P[k]) > .3 || Math.abs(l.V[k]) > 4) moving = true
        else { l.P[k] = l.T[k]; l.V[k] = 0 }
      }
      paint(); track()
      l.raf = moving ? requestAnimationFrame(tick) : 0
    }
    l.raf = requestAnimationFrame(tick)
  })

  const restore = () => {
    const l = live.current
    window.clearTimeout(l.back)
    if (l.icon) { l.icon.style.opacity = ''; l.icon = null }
  }

  // leaving the icon shrinks the medallion back onto it and shows the icon afterwards; other closes (scroll, click,
  // navigation) leave the icon in place and close at once
  const hide = useEffectEvent((back = false) => {
    const l = live.current
    window.clearTimeout(l.shut); window.clearTimeout(l.wait)
    cancelAnimationFrame(l.raf); l.raf = 0
    ref.current?.classList.remove('on')
    if (l.left) { l.left.style.opacity = ''; l.left = null }
    if (!back) { restore(); return }
    window.clearTimeout(l.back)
    l.back = window.setTimeout(restore, 140)
  })

  // a fresh open lays out at the icon's size in its place, then grows out of it, hiding the icon in the medallion's
  // first painted frame once its image is ready; a slide springs the open medallion and card to the new icon while the
  // card height eases to the new text
  useLayoutEffect(() => {
    const el = ref.current
    const l = live.current
    if (!view || !el || !l.mode) return
    const mode = l.mode
    l.mode = ''
    if (mode === 'open') {
      el.classList.remove('on')
      aim()
      l.P = { ...l.T }; l.V = { x: 0, y: 0, cl: 0 }
      paint()
      void el.offsetHeight
      el.classList.add('on')
      const icon = l.icon, img = el.querySelector<HTMLImageElement>('.kh-bl > img')
      const cover = () => { if (icon && live.current.icon === icon && el.classList.contains('on')) icon.style.opacity = '0' }
      if (!img || img.complete) cover()
      else img.addEventListener('load', cover, { once: true })
      return
    }
    const card = el.querySelector<HTMLElement>('.kh-c'), text = card?.querySelector<HTMLElement>('.kh-mv:not(.out)')
    if (!card || !text) return
    const h1 = text.offsetHeight
    aim(h1, true)
    glideTo()
    if (still()) return
    l.swapping = true
    card.style.height = `${l.h0}px`
    void card.offsetHeight
    card.style.height = `${h1}px`
    window.clearTimeout(l.swap)
    l.swap = window.setTimeout(() => {
      l.swapping = false
      card.style.height = ''
      setView((v) => v?.prev ? { ...v, prev: null } : v)
    }, SWAP)
  }, [view])

  // a teammate reads their cell; a card that grows when it lands is placed again.
  const cur = view?.cur.s
  useEffect(() => {
    if (cur?.kind !== 'mate') return
    const key = `${cur.build}|${cur.scenario}`
    if (settled.has(key)) return
    failed.delete(key)
    let on = true
    loadCellDetail(cur.build, cur.scenario).then(
      (value) => { settled.set(key, value); if (on) landed((n) => n + 1) },
      () => { failed.add(key); if (on) landed((n) => n + 1) })
    return () => { on = false }
  }, [cur])

  const opened = view?.open
  useEffect(() => {
    const el = ref.current
    if (!el || opened == null) return
    const resized = new ResizeObserver(() => {
      const l = live.current
      if (!el.classList.contains('on') || l.swapping) return
      aim(undefined, true)
      if (l.raf) return
      l.P = { ...l.T }
      paint()
    })
    resized.observe(el.querySelector('.kh-c') ?? el)
    return () => resized.disconnect()
  }, [opened])

  useEffect(() => {
    const l = live.current
    const iconOf = (e: Event) => (e.target as Element | null)?.closest?.('.lbs [data-kh]') as HTMLElement | null
    const target = (icon: HTMLElement) => {
      const r = icon.getBoundingClientRect()
      l.x = r.left + r.width / 2; l.y = r.top + r.height / 2; l.w = r.width
      // the medallion image is 69% of its 4.6rem box and starts at the icon's width
      ref.current?.style.setProperty('--from', String(r.width / (4.6 * 0.69 * remPx())))
    }
    const open = (icon: HTMLElement, s: Subject) => {
      cancelAnimationFrame(l.raf); l.raf = 0
      window.clearTimeout(l.back); window.clearTimeout(l.swap)
      if (l.left) { l.left.style.opacity = ''; l.left = null }
      if (l.icon && l.icon !== icon) l.icon.style.opacity = ''
      l.icon = icon; l.mode = 'open'; l.swapping = false
      target(icon)
      const n = ++l.n, at = ++l.open
      setView({ open: at, cur: { s, n }, prev: null })
    }
    const glide = (icon: HTMLElement, s: Subject) => {
      const card = ref.current?.querySelector<HTMLElement>('.kh-c')
      l.h0 = card?.offsetHeight ?? 0
      if (l.left && l.left !== icon) l.left.style.opacity = ''
      if (l.icon) { const r = l.icon.getBoundingClientRect(); l.left = l.icon; l.leftAt = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } }
      l.icon = icon; l.mode = 'glide'
      target(icon)
      const n = ++l.n
      setView((v) => v ? { open: v.open, cur: { s, n }, prev: v.cur } : v)
    }
    const show = (icon: HTMLElement) => {
      const s = subjectOf(icon)
      if (!s) return
      window.clearTimeout(l.shut)
      const on = ref.current?.classList.contains('on')
      if (l.icon === icon) { if (!on) open(icon, s); return }
      if (on && l.icon) {
        const r = icon.getBoundingClientRect()
        if (Math.hypot(r.left + r.width / 2 - l.P.x, r.top + r.height / 2 - l.P.y) <= NEAR * remPx()) {
          window.clearTimeout(l.wait)
          glide(icon, s)
          return
        }
      }
      window.clearTimeout(l.wait)
      l.wait = window.setTimeout(() => { if (l.hovered === icon) open(icon, s) }, SETTLE)
    }
    const over = (e: PointerEvent) => {
      const icon = iconOf(e)
      if (!icon || e.pointerType === 'touch') return
      l.hovered = icon
      show(icon)
    }
    const out = (e: PointerEvent) => {
      const icon = iconOf(e)
      if (!icon || icon.contains(e.relatedTarget as Node | null)) return
      l.hovered = null
      window.clearTimeout(l.wait); window.clearTimeout(l.shut)
      l.shut = window.setTimeout(() => hide(true), GRACE)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    const shut = () => hide()
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('pointerdown', shut)
    document.addEventListener('scroll', shut, { capture: true, passive: true })
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('pointerdown', shut)
      document.removeEventListener('scroll', shut, { capture: true })
      document.removeEventListener('keydown', key)
      hide()
    }
  }, [])

  // a move to another page closes it.
  useEffect(() => { hide() }, [location.pathname, location.search])

  const now = view ? faceOf(view.cur.s) : null
  const was = view?.prev ? faceOf(view.prev.s) : null
  const pics = now ? [...(was?.src && was.src !== now.src ? [{ ...was, out: true }] : []), { ...now, out: false }] : []
  const ring = now ? ringKey(now.arcs) : '', ringWas = was ? ringKey(was.arcs) : ring
  // the new picture fades in over the old only when it is a different picture (the same weapon a row down is one img).
  const fresh = Boolean(was), newPic = fresh && was!.src !== now?.src
  return (
    <div ref={ref} className="kh" aria-hidden="true" style={view ? { '--res': view.cur.s.res } as CSSProperties : undefined}>
      {view && now ? (
        <>
          <div className="kh-bl" key={`b${view.open}`}>
            {pics.map((p) => p.src ? <img key={p.src} className={[p.sq ? 'sq' : '', p.out ? 'out' : newPic ? 'nu' : ''].join(' ').trim()} src={p.src} alt="" /> : null)}
            {was && ringWas !== ring ? <Ring key={ringWas} arcs={was.arcs} className="out" /> : null}
            <Ring key={ring} arcs={now.arcs} />
          </div>
          <div className="kh-c" key={`c${view.open}`}>
            {was ? <div className="kh-mv out" key={view.prev!.n}><CardText f={was} /></div> : null}
            <div className={`kh-mv${fresh ? ' nu' : ''}`} key={view.cur.n}><CardText f={now} /></div>
          </div>
        </>
      ) : null}
    </div>
  )
}
