/*
  Author: Runor Ewhro
  description: a player's build history: every card they submitted per
               resonator, newest first, each ranked as itself with its current
               standing. the best one, which leads their profile, is marked, and
               each card lists its changes from the previous one. players can
               make it private, and owners always see their own.
*/

import { useQuery } from '@tanstack/react-query'
import type { HistoryEntry } from '@/domain/leaderboard/api'
import type { BuildChange } from '@/domain/leaderboard/buildDiff'
import { LbError } from '../api/client'
import { lbq } from '../api/queries'
import { errorText } from '../model/cardTrack'
import { grp, monthDay, resFace, resName, score1, scoreInk, wpnOf } from '../model/format'
import { useScope } from '../state/ctx'
import { boardPath, plural } from '../model/listed'

const STAT: Record<string, string> = {
  critRate: 'Crit Rate', critDmg: 'Crit DMG', atkPercent: 'ATK%', atkFlat: 'ATK', hpPercent: 'HP%', hpFlat: 'HP', defPercent: 'DEF%',
  defFlat: 'DEF', energyRegen: 'Energy Regen', basicAtk: 'Basic ATK DMG', heavyAtk: 'Heavy ATK DMG', resonanceSkill: 'Skill DMG',
  resonanceLiberation: 'Liberation DMG', healingBonus: 'Healing',
}
const statName = (key: string) => STAT[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
const signed = (n: number) => `${n > 0 ? '+' : ''}${Number.isInteger(n) ? n : n.toFixed(1)}`

/** one change, as a short phrase: what moved, and by how much where a number says it. */
function change(c: BuildChange): { k: string; v: string; d?: string } {
  switch (c.kind) {
    case 'sequence': return { k: 'Sequence', v: `S${c.from} to S${c.to}` }
    case 'level': return { k: 'Level', v: `${c.from ?? '?'} to ${c.to ?? '?'}` }
    case 'weapon': return c.from.id === c.to.id
      ? { k: 'Weapon', v: `level ${c.from.level ?? '?'} to ${c.to.level ?? '?'}` }
      : { k: 'Weapon', v: `${wpnOf(c.from.id)?.name ?? c.from.id} to ${wpnOf(c.to.id)?.name ?? c.to.id}` }
    case 'skill': return { k: 'Skill', v: `${statName(c.key)} ${c.from ?? '?'} to ${c.to ?? '?'}` }
    case 'echo_swapped': return { k: `Echo ${c.slot + 1}`, v: 'swapped' }
    case 'echo_added': return { k: `Echo ${c.slot + 1}`, v: 'added' }
    case 'echo_removed': return { k: `Echo ${c.slot + 1}`, v: 'removed' }
    case 'echo_tuned': {
      const moved = [...c.main, ...c.substats]
      const big = moved.find((s) => s.from != null && s.to != null) ?? moved[0]
      if (!big) return { k: `Echo ${c.slot + 1}`, v: c.mainEcho ? 'made main echo' : 'tuned' }
      const d = big.from != null && big.to != null ? signed(big.to - big.from) : undefined
      return { k: `Echo ${c.slot + 1}`, v: `${statName(big.key)}${moved.length > 1 ? ` and ${moved.length - 1} more` : ''}`, d }
    }
  }
}

/** folds echo changes into one count each, which keeps a card's changes on one line. */
function changes(list: BuildChange[]) {
  const swapped = list.filter((c) => c.kind === 'echo_swapped' || c.kind === 'echo_added' || c.kind === 'echo_removed').length
  const rest = list.filter((c) => c.kind !== 'echo_swapped' && c.kind !== 'echo_added' && c.kind !== 'echo_removed').map(change)
  return swapped > 1 ? [...rest, { k: 'Echoes', v: `${swapped} swapped` }] : [...rest, ...list.filter((c) => c.kind === 'echo_swapped' || c.kind === 'echo_added' || c.kind === 'echo_removed').map(change)]
}

function Entry({ e, best, live, onOpen }: { e: HistoryEntry; best: boolean; live: string | null; onOpen: () => void }) {
  const w = wpnOf(e.snapshot.weapon.id)
  const now = best
  const lines = changes(e.changes)
  return (
    <button type="button" className={`hse${now ? ' now' : ''}`} onClick={onOpen}>
      <span className="hse-when"><b>{monthDay(e.drawnAt)}</b>
        <small>sent {monthDay(e.submittedAt)}</small></span>
      <span className="hse-w">{w?.icon ? <img src={w.icon} alt="" /> : null}</span>
      <span className="hse-st">{now ? <i className="on">Best</i> : null}{e.hidden ? <i>Hidden</i> : null}
        <small>S{e.snapshot.resonator.sequence}, Lv {e.snapshot.resonator.level ?? '?'}</small></span>
      <span className="hse-rk">{e.rank != null ? <><b>#{grp(e.rank)}</b>{e.total ? ` of ${grp(e.total)}` : ''}</> : <span>-</span>}</span>
      <span className="hse-sc">{e.score != null ? <b style={scoreInk(e.score)}>{score1(e.score)}</b> : <span>-</span>}
        {e.rulesetId && live && e.rulesetId !== live ? <small>previous score</small> : null}</span>
      <span className="hse-chg">{lines.length
        ? lines.map((c, i) => <span key={i}><i>{c.k}</i>{c.v}{c.d ? <em>{c.d}</em> : null}</span>)
        : <span><i>First card</i>on the boards</span>}</span>
    </button>
  )
}

/** a resonator's best card: the highest score, then the newest (entries run newest first). */
const bestOf = (entries: HistoryEntry[]): string | null =>
  entries.reduce<HistoryEntry | null>((top, e) => e.score != null && (top?.score == null || e.score > top.score) ? e : top, null)?.buildId ?? null

export function HistoryView({ refId, name, onOpen }: { refId: string; name: string; onOpen: (buildId: string) => void }) {
  const { live, go } = useScope()
  const history = useQuery({ ...lbq.history(refId), enabled: Boolean(refId) })
  const data = history.data ?? null
  const error = history.error

  if (error && !data) return <div className="empty">{error instanceof LbError && error.code === 'forbidden'
    ? `${name} keeps their build history private.` : errorText(error)}</div>
  if (!data) return <div className="empty">loading the build history... :P</div>
  if (!data.resonators.length) return <div className="empty">no cards in this history yet... check back after a submission :P</div>

  return (
    <div className="hsv">
      {data.resonators.map((r) => (
        <section key={r.resonatorId} className="hsg">
          <div className="hsg-h">
            <img src={resFace(r.resonatorId)} alt="" />
            <button type="button" className="hsg-n" onClick={() => go(boardPath(r.resonatorId))}>{resName(r.resonatorId)}</button>
            <span>{plural(r.entries.length, 'card')}</span>
          </div>
          {r.entries.map((e) => <Entry key={e.buildId} e={e} best={e.buildId === bestOf(r.entries)} live={live?.rulesetId ?? null}
            onOpen={() => onOpen(e.buildId)} />)}
        </section>
      ))}
    </div>
  )
}
