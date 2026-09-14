/*
  Author: Runor Ewhro
  Description: What grows out of a bead on the rotation surface. The bead itself
               stretches into a capsule carrying the resonator's name and the
               size of its rotation, and on the lead, the two teammates beside
               it. Every portrait in it opens that member's console.

               The capsule carries its own copy of the bead's portrait, so it
               can stand over the bead and read as the bead stretching rather
               than as a card appearing beside it. Its radius is the column's
               own bead size, so only the bead's centre comes from here; its
               contents are measured and sprung, which is what lets it re-size
               as it moves between beads.
*/

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { type CssVars } from '@/modules/simulation/workspace/ui.tsx'
import type { BuildRosterEntry } from './BuildRoster.tsx'

export interface CapsuleMate {
  id: string
  name: string
  profile: string
  accent: string
}

export interface CapsuleTarget {
  entry: BuildRosterEntry
  /** The context resonator: its face and its teammates open the console. */
  lead: boolean
  /** Bead centre, in px against the column. */
  x: number
  y: number
}

// Long enough for the width to spring home before the capsule lets go of it.
const LEAVE_MS = 420
// How long an outgoing body stays under the incoming one while they cross.
const SWAP_MS = 180

function reduced(): boolean {
  const root = typeof document === 'undefined' ? null : document.documentElement
  return Boolean(root && (root.classList.contains('reduce-animation') || root.classList.contains('no-entrance-anim')))
}

function nodesNote(entry: BuildRosterEntry): string | null {
  if (entry.rotationNodes === 0) return null
  return `${entry.rotationNodes} ${entry.rotationNodes === 1 ? 'node' : 'nodes'}`
}

function CapsuleBody({
  target,
  mates,
  enter,
  leaving,
  onMate,
}: {
  target: CapsuleTarget
  mates: CapsuleMate[]
  enter?: 'mount' | 'swap'
  leaving?: boolean
  onMate: (resonatorId: string) => void
}) {
  const note = nodesNote(target.entry)
  const withTeam = target.lead && mates.length > 0
  return (
    <div className="blm-capsule-body"
      data-enter={leaving ? undefined : enter}
      data-leaving={leaving ? 'true' : undefined}
      aria-hidden={leaving || undefined}
    >
      <span className="blm-capsule-text" style={{ '--i': 0 } as CssVars}>
        <b className="blm-capsule-name">{target.entry.name}</b>
        {note ? <span className="blm-capsule-note">{note}</span> : null}
      </span>
      {withTeam ? (
        <>
          <i className="blm-capsule-div" style={{ '--i': 1 } as CssVars} aria-hidden="true" />
          <span className="blm-capsule-mates" style={{ '--i': 2 } as CssVars}>
            {mates.map((mate, index) => (
              <button
                key={mate.id}
                type="button" className="blm-mate"
                style={{ '--mate': mate.accent, '--i': index } as CssVars}
                aria-label={`Edit ${mate.name}`}
                title={`Edit ${mate.name}`}
                tabIndex={leaving ? -1 : 0}
                onClick={() => onMate(mate.id)}
              >
                <img src={mate.profile} alt="" decoding="async" onError={withDefIconM} />
              </button>
            ))}
          </span>
        </>
      ) : null}
    </div>
  )
}

export function RosterCapsule({
  target,
  mates,
  onFace,
  onFaceMenu,
  onMate,
  onHold,
  onRelease,
}: {
  target: CapsuleTarget | null
  mates: CapsuleMate[]
  onFace: (entry: BuildRosterEntry) => void
  onFaceMenu: (entry: BuildRosterEntry, event: ReactMouseEvent<HTMLElement>) => void
  onMate: (resonatorId: string) => void
  onHold: () => void
  onRelease: () => void
}) {
  const [shown, setShown] = useState<CapsuleTarget | null>(target)
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  const [mount, setMount] = useState(0)
  const [mountKey, setMountKey] = useState(target ? `${target.entry.id}:${target.lead}` : '')
  const [leaving, setLeaving] = useState<CapsuleTarget | null>(null)
  const capRef = useRef<HTMLDivElement | null>(null)
  const bodiesRef = useRef<HTMLDivElement | null>(null)
  const measuredMount = useRef(-1)

  /*
    Presence is adjusted during render so the capsule never paints a frame of
    the wrong resonator. A new target over a capsule that is still standing is
    a glide; a target after it has let go, or while it is letting go, is a new
    capsule with its own entrance.
  */
  if (target && target !== shown) {
    const key = `${target.entry.id}:${target.lead}`
    if (!shown || phase === 'out') {
      setShown(target)
      setPhase('in')
      setMount((value) => value + 1)
      setMountKey(key)
      setLeaving(null)
    } else {
      if (key !== `${shown.entry.id}:${shown.lead}`) setLeaving(shown)
      setShown(target)
    }
  } else if (!target && shown && phase === 'in') {
    setPhase('out')
  }

  useEffect(() => {
    if (phase !== 'out') return undefined
    const timer = window.setTimeout(() => setShown(null), reduced() ? 0 : LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (!leaving) return undefined
    const timer = window.setTimeout(() => setLeaving(null), SWAP_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])

  // How far the capsule reaches past the bead is written straight onto the
  // node rather than through React, so a re-render can never snap it back mid
  // spring. A new capsule is committed at the bead's own size first, which is
  // the point the spring leaves from and the point it returns to.
  useLayoutEffect(() => {
    const cap = capRef.current
    const bodies = bodiesRef.current
    if (!cap || !bodies || !shown) return
    if (phase === 'out') {
      cap.style.setProperty('--bw', '0px')
      return
    }
    if (measuredMount.current !== mount) {
      measuredMount.current = mount
      cap.style.setProperty('--bw', '0px')
      void cap.offsetWidth
    }
    cap.style.setProperty('--bw', `${bodies.offsetWidth}px`)
  })

  if (!shown) return null

  const { entry, lead } = shown
  const bodyKey = `${entry.id}:${lead}`

  return (
    <div
      key={mount}
      ref={capRef} className="blm-capsule"
      data-phase={phase}
      data-lead={lead ? 'true' : undefined}
      style={{
        '--row-ink': entry.accent,
        '--cx': `${shown.x}px`,
        '--cy': `${shown.y}px`,
      } as CssVars}
      onPointerEnter={onHold}
      onPointerLeave={onRelease}
      onFocus={onHold}
      onBlur={onRelease}
    >
      <button
        type="button" className="blm-capsule-face"
        aria-label={lead ? `Edit ${entry.name}` : `Switch to ${entry.name}`}
        title={lead ? `Edit ${entry.name}` : undefined}
        tabIndex={phase === 'out' ? -1 : 0}
        onClick={() => onFace(entry)}
        onContextMenu={(event) => onFaceMenu(entry, event)}
      >
        <img key={entry.id} src={entry.profile} alt="" decoding="async" onError={withDefIconM} />
      </button>
      <div className="blm-capsule-bodies" ref={bodiesRef}>
        {leaving ? (
          <CapsuleBody
            key={`out:${leaving.entry.id}:${leaving.lead}`}
            target={leaving}
            mates={mates}
            leaving
            onMate={onMate}
          />
        ) : null}
        <CapsuleBody
          key={bodyKey}
          target={shown}
          mates={mates}
          enter={bodyKey === mountKey ? 'mount' : 'swap'}
          onMate={onMate}
        />
      </div>
    </div>
  )
}
