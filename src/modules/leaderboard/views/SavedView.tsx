/*
  Author: Runor Ewhro
  description: builds the viewer saved from other players, newest first and
               private to them. a saved build stays listed, marked, after a
               later card replaces it, and each opens on its player's profile.
*/

import { useQueries, useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import type { BookmarksResponse } from '@/domain/leaderboard/api'
import { queryClient } from '@/shared/lib/queryClient'
import { lbApi } from '../api/client'
import { lbKeys, lbq } from '../api/queries'
import { errorText } from '../model/cardTrack'
import { grp, monthDay, resFace, resName, score1, scoreInk, wpnOf } from '../model/format'
import { useScope } from '../state/ctx'
import { boardPath } from '../model/listed'
import { playerName } from '../model/players'

type Saved = BookmarksResponse['builds'][number]
/** scores are read for the first rows only; the rest open to show theirs. */
const SCORED = 40

export function SavedView() {
  const { go, playerTo, toast } = useScope()
  const saved = useQuery(lbq.bookmarks())
  const list = saved.data?.builds ?? null
  const error = saved.error
  // each of the first rows' scores loads separately from the build's own key
  const details = useQueries({ queries: (list ?? []).slice(0, SCORED).map((b) => lbq.build(b.buildId)) })
  const detail = Object.fromEntries((list ?? []).slice(0, SCORED).map((b, index) => [b.buildId, details[index]?.data]))

  // a build opens on its player's profile, or on its board for anonymous players, who have none
  const target = (b: Saved) => b.player.anonymous ? boardPath(b.resonatorId) : `${playerTo({ uid: b.player.uid, buildId: b.buildId })}?build=${b.buildId}`

  // the row goes at once; a refused unsave puts it back.
  const drop = (b: Saved) => {
    const edit = (change: (builds: Saved[]) => Saved[]) =>
      queryClient.setQueryData<BookmarksResponse>(lbKeys.bookmarks(), (r) => r ? { ...r, builds: change(r.builds) } : r)
    edit((builds) => builds.filter((x) => x.buildId !== b.buildId))
    lbApi.unsave(b.buildId).catch((e: unknown) => { toast(errorText(e), true); edit((builds) => [b, ...builds]) })
  }

  if (error && !list) return <div className="empty">{errorText(error)}</div>
  if (!list) return <div className="empty">loading your saved builds... :P</div>
  if (!list.length) return <div className="empty">nothing saved yet! open someone's build and hit Save to keep it here :P</div>

  return (
    <div className="svv">
      <div className="svv-hd"><span>Player</span><span>Resonator</span><span>Weapon</span><span>Saved</span><span>Score</span><span /></div>
      {list.map((b) => {
        const d = detail[b.buildId]
        const w = d ? wpnOf(d.best?.scenario.weaponId ?? d.snapshot.weapon.id) : null
        return (
          <div key={b.buildId} className="svv-r" role="button" tabIndex={0}
            onClick={() => go(target(b))}
            onKeyDown={(event) => { if (event.key === 'Enter') go(target(b)) }}>
            <span className="svv-pl"><span className="mono">{(b.player.anonymous ? '?' : b.player.name ?? '?')[0]?.toUpperCase()}</span>{playerName(b.player)}</span>
            <span className="svv-res"><img src={resFace(b.resonatorId)} alt="" />{resName(b.resonatorId)}
              {d?.best?.rank != null ? <small>#{grp(d.best.rank)}{d.best.total ? `/${grp(d.best.total)}` : ''}</small> : null}</span>
            <span className="svv-w">{w?.icon ? <img src={w.icon} alt="" title={w.name} /> : null}</span>
            <span className="svv-at">{monthDay(b.at)}</span>
            <span className="svv-sc">{d?.best?.score != null ? <b style={scoreInk(d.best.score)}>{score1(d.best.score)}</b> : '-'}</span>
            <button type="button" className="svv-x" aria-label="Remove from saved" title="Remove" onClick={(event) => { event.stopPropagation(); drop(b) }}><X aria-hidden="true" /></button>
          </div>
        )
      })}
    </div>
  )
}
