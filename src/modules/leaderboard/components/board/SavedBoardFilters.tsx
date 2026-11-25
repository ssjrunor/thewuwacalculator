/*
  Author: Runor Ewhro
  description: saved board views: a board's filters (team, weapon, server,
               sequence) saved under a name on the account. a board lists its
               views above its builds, picking one applies its filters, and the
               current filters can be saved as a new view. signed out, the list
               is empty.
*/

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Plus, X } from 'lucide-react'
import type { BoardView, ViewsDoc } from '@/domain/leaderboard/documents'
import { lbApi } from '../../api/client'
import { errorText } from '../../model/cardTrack'
import { useScope } from '../../state/ctx'

export interface ViewFilter { team: string | null; weapon: string | null; region: string | null; sequence: number | null }

const MAX_VIEWS = 30
// the account's views, read once per session and shared by every board.
let views: BoardView[] | null = null
let asked: string | null = null
const listeners = new Set<() => void>()
const put = (next: BoardView[]) => { views = next; listeners.forEach((fn) => fn()) }
const useViews = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn) }, () => views)

const filterOf = (v: BoardView): ViewFilter => ({ team: v.team ?? null, weapon: v.weapon ?? null, region: v.region ?? null, sequence: v.sequence ?? null })
const same = (a: ViewFilter, b: ViewFilter) => a.team === b.team && a.weapon === b.weapon && a.region === b.region && a.sequence === b.sequence

export function SavedBoardFilters({ rid, filter, apply }: { rid: string; filter: ViewFilter; apply: (f: ViewFilter) => void }) {
  const { me, toast } = useScope()
  const account = me?.account?.id ?? null
  const all = useViews()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!account || asked === account) return
    asked = account
    lbApi.views().then((r) => put(r?.body.views ?? []), () => { asked = null })
  }, [account])
  useEffect(() => { if (naming) input.current?.focus() }, [naming])

  if (!account || !all) return null
  const mine = all.filter((v) => v.resonatorId === rid)
  const filtered = Boolean(filter.team || filter.weapon || filter.region || filter.sequence != null)
  const saved = mine.some((v) => same(filterOf(v), filter))

  const write = (next: BoardView[], done: string) => {
    const before = all
    put(next)
    lbApi.putViews({ views: next } satisfies ViewsDoc).then(() => toast(done), (e: unknown) => { put(before); toast(errorText(e), true) })
  }
  const save = () => {
    const n = name.trim()
    if (!n) return
    const v: BoardView = { name: n, resonatorId: rid, ...(filter.team ? { team: filter.team } : {}), ...(filter.weapon ? { weapon: filter.weapon } : {}),
      ...(filter.region ? { region: filter.region } : {}), ...(filter.sequence != null ? { sequence: filter.sequence } : {}) }
    write([...all, v], `Saved "${n}".`)
    setNaming(false)
    setName('')
  }

  return (
    <div className="bvw">
      <span className="bvw-l">Views</span>
      <button type="button" className={`bvw-v${!filtered ? ' on' : ''}`} onClick={() => apply({ team: null, weapon: null, region: null, sequence: null })}>All</button>
      {mine.map((v) => {
        const on = same(filterOf(v), filter)
        return (
          <span key={`${v.name}-${all.indexOf(v)}`} className={`bvw-v${on ? ' on' : ''}`}>
            <button type="button" onClick={() => apply(filterOf(v))}>{v.name}</button>
            <button type="button" className="bvw-x" aria-label={`Delete ${v.name}`} title="Delete view"
              onClick={() => write(all.filter((x) => x !== v), `Deleted "${v.name}".`)}><X aria-hidden="true" /></button>
          </span>
        )
      })}
      {naming ? (
        <form className="bvw-name" onSubmit={(event) => { event.preventDefault(); save() }}>
          <input ref={input} value={name} maxLength={32} placeholder="give this view a name..." aria-label="View name" onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { setNaming(false); setName('') } }} />
          <button type="submit" className="lk" disabled={!name.trim()}>Save</button>
          <button type="button" className="lk" onClick={() => { setNaming(false); setName('') }}>Cancel</button>
        </form>
      ) : filtered && !saved && all.length < MAX_VIEWS ? (
        <button type="button" className="bvw-v add" onClick={() => setNaming(true)}><Plus aria-hidden="true" />Save this view</button>
      ) : !mine.length ? <span className="bvw-hint">pick a team, weapon, server or sequence, then save those filters as a view :P</span> : null}
    </div>
  )
}
