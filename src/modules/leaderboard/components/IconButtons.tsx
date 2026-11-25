/*
  Author: Runor Ewhro
  description: icon buttons: an action word rendered as a lucide icon with the
               word as a hover label, and a copy button that swaps to a check
               after copying.
*/

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Check, Pin } from 'lucide-react'

type Icon = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>

export function Ib({ icon: Glyph, label, onClick, on, go, small, className, children }: {
  icon: Icon
  label: string
  onClick: () => void
  /** a held state, e.g. pinned. */
  on?: boolean
  /** the page's main action. */
  go?: boolean
  /** the small tool size, inside a line of text. */
  small?: boolean
  /** a class of the caller's, e.g. for a button that also shows its word. */
  className?: string
  children?: ReactNode
}) {
  const cls = `${small ? 'k-tool ibs' : `act ib${on ? ' on' : ''}${go ? ' go' : ''}`}${className ? ` ${className}` : ''}`
  return (
    <button type="button" className={cls} aria-label={label} aria-pressed={on} data-l={label} onClick={(event) => { event.stopPropagation(); onClick() }}>
      <Glyph className="lu" />{children}
    </button>
  )
}

export const PinIb = ({ on, what, onClick }: { on: boolean; what: string; onClick: () => void }) =>
  <Ib icon={Pin} label={on ? `Unpin ${what}` : `Pin ${what}`} on={on} onClick={onClick} />

/** copies text and shows a check in place of the icon briefly. */
export function CopyIb({ icon: Glyph, label, text, small }: { icon: Icon; label: string; text: () => string; small?: boolean }) {
  const [done, setDone] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = () => {
    navigator.clipboard?.writeText(text()).then(() => {
      setDone(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setDone(false), 1400)
    }, () => undefined)
  }
  const cls = small ? 'k-tool ibs' : 'act ib'
  return (
    <button type="button" className={`${cls}${done ? ' done' : ''}`} aria-label={label} data-l={done ? 'Copied' : label} onClick={(event) => { event.stopPropagation(); copy() }}>
      <Glyph className="lu" /><Check className="lu ok" />
    </button>
  )
}
