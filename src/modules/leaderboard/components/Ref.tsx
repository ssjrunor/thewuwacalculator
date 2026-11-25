/*
  Author: Runor Ewhro
  description: a name linking to its page: a resonator's board or a player's
               profile. a real href opens in a new tab or copies like any link,
               and a plain click navigates in place and scrolls to the top.
               clicks do not toggle the containing row, and hovering shows the
               page's preview (Preview.tsx).
*/

import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { boardPath } from '../model/listed'
import { useScope } from '../state/ctx'
import { pvBoard, pvPlayer } from './Preview'

export function Ref({ to, className, children, pv }: { to: string; className?: string; children: ReactNode; pv?: Record<string, string> }) {
  const { go } = useScope()
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation()
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go(to)
  }
  return <Link to={to} className={`ref${className ? ` ${className}` : ''}`} onClick={click} {...pv}>{children}</Link>
}

/** a resonator's name, linking to its board. */
export const BoardRef = ({ id, children }: { id: string; children: ReactNode }) => <Ref to={boardPath(id)} pv={pvBoard(id)}>{children}</Ref>

/** a player's name, linking to their profile. */
export function PlayerRef({ who, children }: { who: { uid: string | null; buildId: string; name?: string | null; anonymous?: boolean }; children: ReactNode }) {
  const { playerTo } = useScope()
  // an anonymous player has no profile to open or preview.
  if (who.anonymous) return <span className="ref anon">{children}</span>
  return <Ref to={playerTo(who)} pv={pvPlayer(who)}>{children}</Ref>
}
