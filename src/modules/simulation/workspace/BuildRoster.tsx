/*
  Author: Runor Ewhro
  Description: The roster: one thread down the column, resonators as beads on
               it, attributes as collapsible knots, and a parked caption that
               reads whichever bead is being pointed at.

               There is one of these in the app and it is mounted by the chrome,
               not by a page, so every surface is looking at the same column in
               the same DOM: moving between them scrolls nothing, rebuilds
               nothing, and holds the subject exactly where it was.

               What the column says is the part that changes with the surface.
               A rotation is only of interest while you are writing one, so on
               that surface alone the column notches everyone who has one and a
               bead with something to say stretches into a capsule.
               That is an attribute on a node that is already standing, which is
               why the column can answer to the page without being rebuilt by it.
*/

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { KeyboardEvent, MouseEvent, RefCallback } from 'react'
import { UsersRound } from 'lucide-react'
import type { AttributeKey } from '@/domain/entities/stats'
import type { CombatScenarioId } from '@/domain/entities/combatScenario'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { toTitle } from '@/shared/lib/format'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { type CssVars } from '@/modules/simulation/workspace/ui.tsx'
import { RosterCapsule, type CapsuleMate, type CapsuleTarget } from './RosterCapsule.tsx'

/*
  A surface can ask the column to say more than who is on it. Only the rotation
  editor does so far, and only because a rotation is a thing a resonator has
  that no build surface has any use for.
*/
export type RosterReads = 'build' | 'rotation'

const FIND_RESET_MS = 1100

export interface BuildAttrGroup {
  attribute: AttributeKey
  accent: string
  items: BuildRosterEntry[]
}

export interface BuildRosterEntry {
  id: string
  scenarioId: CombatScenarioId
  name: string
  profile: string
  attribute: AttributeKey
  accent: string
  level: number
  sequence: number
  /** Size of the authored rotation, and zero when none has been written. */
  rotationNodes: number
}

export interface BuildRosterSelection {
  selectionMode: boolean
  isSelected: (id: string) => boolean
  buildClickCapture: (id: string) => (event: MouseEvent<HTMLElement>) => void
  getItems: (id: string) => MenuEntry[]
  surfaceProps: {
    ref?: RefCallback<HTMLElement>
    tabIndex?: number
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
    'data-selection-focus-scope'?: string
    'data-selection-focus-active'?: string
    'data-selection-mode-active'?: string
  }
}

function seqPips(sequence: number) {
  return Array.from({ length: 6 }, (_, pip) => (
    <i key={pip} data-on={pip < sequence ? 'true' : undefined} />
  ))
}

// The only thing a resonator carries that its portrait cannot show.
function rotationNote(entry: BuildRosterEntry): string {
  if (entry.rotationNodes === 0) return 'No rotation'
  return `${entry.rotationNodes} ${entry.rotationNodes === 1 ? 'node' : 'nodes'}`
}

function reduceMotion(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains('reduce-animation')
}

export function BuildRoster({
  roster,
  groups,
  contextResId,
  reads,
  onContextChange,
  onAddResonator,
  selection,
  mates = [],
  onOpenMember,
}: {
  roster: BuildRosterEntry[]
  groups: BuildAttrGroup[]
  contextResId: string | null
  /** What the surface beside the column wants the column to say. */
  reads: RosterReads
  onContextChange: (id: string) => void
  onAddResonator?: () => void
  selection?: BuildRosterSelection
  /** The context resonator's teammates, shown in its capsule. */
  mates?: CapsuleMate[]
  /** Opens a member's console; the capsule's portraits all lead here. */
  onOpenMember?: (resonatorId: string) => void
}) {
  const columnRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const threadRef = useRef<HTMLElement | null>(null)
  const findTimer = useRef(0)
  const [folded, setFolded] = useState<ReadonlySet<AttributeKey>>(() => new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [geom, setGeom] = useState<{ id: string; x: number; y: number } | null>(null)
  const [find, setFind] = useState('')
  const releaseTimer = useRef(0)

  const contextEntry = useMemo(
    () => roster.find((entry) => entry.id === contextResId) ?? roster[0] ?? null,
    [contextResId, roster],
  )

  const setThreadRef = useCallback((element: HTMLElement | null) => {
    threadRef.current = element
    selection?.surfaceProps.ref?.(element)
  }, [selection])

  const beadOf = useCallback((id: string) => (
    threadRef.current?.querySelector<HTMLElement>(`[data-bead][data-res-id="${CSS.escape(id)}"]`) ?? null
  ), [])

  // A bead inside a folded knot cannot be pointed at, so whenever the surface
  // moves to a new subject its run opens back up. Adjusted during render rather
  // than in an effect so the column never paints the subject as missing.
  const [lastContextId, setLastContextId] = useState(contextResId)
  if (contextResId !== lastContextId) {
    setLastContextId(contextResId)
    if (contextEntry && folded.has(contextEntry.attribute)) {
      const opened = new Set(folded)
      opened.delete(contextEntry.attribute)
      setFolded(opened)
    }
  }

  useEffect(() => {
    if (!contextEntry) return
    const bead = beadOf(contextEntry.id)
    const box = scrollRef.current
    if (!bead || !box) return
    const boxRect = box.getBoundingClientRect()
    const rect = bead.getBoundingClientRect()
    if (rect.top >= boxRect.top && rect.bottom <= boxRect.bottom
      && rect.left >= boxRect.left && rect.right <= boxRect.right) {
      return
    }
    bead.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reduceMotion() ? 'auto' : 'smooth',
    })
  }, [beadOf, contextEntry, folded])

  /*
    Pointing is let go of on a short grace rather than at once, because on the
    rotation surface the capsule grows over the very bead being pointed at: the
    pointer ends up on the capsule without moving, and that must not be read as
    leaving. The beads and the capsule both answer pointer events, so a bead's
    leave and the capsule's enter come from one event in that order; and when
    the grace runs out it asks the capsule itself, so no ordering of events can
    make it let go of a capsule the pointer or focus is resting on. Without that
    it lets go, the bead is under the cursor again, and it grows straight back.
  */
  const holdPreview = useCallback(() => window.clearTimeout(releaseTimer.current), [])
  const releasePreview = useCallback((id?: string) => {
    window.clearTimeout(releaseTimer.current)
    releaseTimer.current = window.setTimeout(() => {
      const capsule = columnRef.current?.querySelector<HTMLElement>('.blm-capsule:not([data-phase="out"])')
      if (capsule && (capsule.matches(':hover') || capsule.contains(document.activeElement))) return
      setPreviewId((current) => (id == null || current === id ? null : current))
    }, 160)
  }, [])

  // A capsule is only worth growing where there is something to say: the lead
  // always has its team, anyone else only once a rotation has been written.
  const capsuleEntry = useMemo(() => {
    if (reads !== 'rotation' || !previewId) return null
    const entry = roster.find((item) => item.id === previewId) ?? null
    if (!entry) return null
    return entry.id === contextEntry?.id || entry.rotationNodes > 0 ? entry : null
  }, [contextEntry, previewId, reads, roster])

  // The capsule stands outside the scroller, which clips on both axes, so it
  // is placed against the bead rather than parented to it. Only the bead's
  // centre is measured; its radius is the column's own size, read by the
  // capsule's stylesheet, so a bead still growing into the lead is never
  // caught mid-growth.
  const measureFor = useCallback((id: string) => {
    const bead = beadOf(id)
    const column = columnRef.current
    const box = scrollRef.current
    if (!bead || !column || !box) return
    const b = bead.getBoundingClientRect()
    const c = column.getBoundingClientRect()
    // The capsule has to stand exactly on its bead to read as the bead
    // stretching, so a bead scrolled out under the column's fade grows nothing
    // rather than a capsule pinned somewhere it is not.
    const view = box.getBoundingClientRect()
    const mid = b.top + b.height / 2
    if (mid < view.top + 8 || mid > view.bottom - 8) {
      setGeom(null)
      return
    }
    const next = { id, x: b.left + b.width / 2 - c.left, y: mid - c.top }
    setGeom((prev) => (
      prev && prev.id === next.id && prev.x === next.x && prev.y === next.y ? prev : next
    ))
  }, [beadOf])

  const measure = useCallback(() => {
    if (capsuleEntry) measureFor(capsuleEntry.id)
  }, [capsuleEntry, measureFor])

  // Measured in the same event that points at the bead, so the bead and where
  // it stands arrive in one render. Measured a render later, the capsule would
  // spend that render with nowhere to be, let go, and grow back from scratch
  // instead of gliding across.
  // A touch has no hover to rest on, so a tap names the bead in the caption
  // without growing a capsule over the thing being tapped.
  const pointAt = useCallback((id: string, grow = true) => {
    window.clearTimeout(releaseTimer.current)
    setPreviewId(id)
    if (grow && reads === 'rotation') measureFor(id)
  }, [measureFor, reads])

  useEffect(() => {
    const box = scrollRef.current
    if (!box || !capsuleEntry) return undefined
    box.addEventListener('scroll', measure, { passive: true })
    return () => box.removeEventListener('scroll', measure)
  }, [capsuleEntry, measure])

  const capsuleTarget = useMemo<CapsuleTarget | null>(() => (
    capsuleEntry && geom && geom.id === capsuleEntry.id
      ? { entry: capsuleEntry, lead: capsuleEntry.id === contextEntry?.id, x: geom.x, y: geom.y }
      : null
  ), [capsuleEntry, contextEntry, geom])

  // The capsule's face stands over the bead, so anything the bead would have
  // done is handed back to it: switching, selecting, and its context menu. The
  // lead's face alone opens a console, since switching to it is a no-op.
  const onCapsuleFace = useCallback((entry: BuildRosterEntry) => {
    if (entry.id !== contextEntry?.id || selection?.selectionMode || !onOpenMember) {
      beadOf(entry.id)?.click()
      return
    }
    onOpenMember(entry.id)
  }, [beadOf, contextEntry, onOpenMember, selection])

  const onCapsuleMenu = useCallback((entry: BuildRosterEntry, event: MouseEvent<HTMLElement>) => {
    const bead = beadOf(entry.id)
    if (!bead) return
    event.preventDefault()
    bead.dispatchEvent(new window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
    }))
  }, [beadOf])

  const onCapsuleMate = useCallback((resonatorId: string) => {
    onOpenMember?.(resonatorId)
  }, [onOpenMember])

  useEffect(() => () => {
    window.clearTimeout(findTimer.current)
    window.clearTimeout(releaseTimer.current)
  }, [])

  const visibleEntries = useMemo(
    () => groups.flatMap((group) => (folded.has(group.attribute) ? [] : group.items)),
    [folded, groups],
  )

  const toggleKnot = useCallback((attribute: AttributeKey) => {
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(attribute)) next.delete(attribute)
      else next.add(attribute)
      return next
    })
  }, [])

  const focusBead = useCallback((entry: BuildRosterEntry | undefined) => {
    if (!entry) return
    const bead = beadOf(entry.id)
    if (!bead) return
    bead.focus()
    bead.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' })
  }, [beadOf])

  const stepFocus = useCallback((delta: number) => {
    if (visibleEntries.length === 0) return
    const focused = document.activeElement as HTMLElement | null
    const here = focused?.dataset.resId
      ? visibleEntries.findIndex((entry) => entry.id === focused.dataset.resId)
      : -1
    const from = here >= 0
      ? here
      : visibleEntries.findIndex((entry) => entry.id === contextEntry?.id)
    const next = Math.min(
      visibleEntries.length - 1,
      Math.max(0, (from < 0 ? 0 : from) + (here >= 0 || from >= 0 ? delta : 0)),
    )
    focusBead(visibleEntries[next])
  }, [contextEntry, focusBead, visibleEntries])

  // Typing a name walks the column to it. Committing stays an explicit Enter so
  // a search never rebuilds the board under you.
  const typeToFind = useCallback((char: string) => {
    window.clearTimeout(findTimer.current)
    findTimer.current = window.setTimeout(() => setFind(''), FIND_RESET_MS)
    setFind((current) => {
      const query = (current + char).slice(0, 14)
      const lower = query.toLowerCase()
      const hit = visibleEntries.find((entry) => entry.name.toLowerCase().startsWith(lower))
        ?? visibleEntries.find((entry) => entry.name.toLowerCase().includes(lower))
      if (hit) focusBead(hit)
      return query
    })
  }, [focusBead, visibleEntries])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const { key } = event
    if (key === 'ArrowDown' || key === 'ArrowRight') {
      event.preventDefault()
      stepFocus(1)
      return
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      event.preventDefault()
      stepFocus(-1)
      return
    }
    if (key === 'Home' || key === 'End') {
      event.preventDefault()
      focusBead(key === 'Home' ? visibleEntries[0] : visibleEntries[visibleEntries.length - 1])
      return
    }
    if (key.length === 1 && key !== ' ' && /\S/.test(key)
      && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      typeToFind(key)
      return
    }
    selection?.surfaceProps.onKeyDown?.(event)
  }, [focusBead, selection, stepFocus, typeToFind, visibleEntries])

  // One tab stop for the whole roster: the column hands focus to the bead the
  // surface is already showing.
  const onFocusColumn = useCallback((event: { target: EventTarget | null; currentTarget: HTMLElement }) => {
    if (event.target !== event.currentTarget) return
    focusBead(contextEntry ?? undefined)
  }, [contextEntry, focusBead])

  return (
    <div className="blm" data-reads={reads} ref={columnRef}>
      <div className="blm-scroll" ref={scrollRef}>
        <nav className="blm-thread"
          aria-label="Context resonators"
          ref={setThreadRef}
          tabIndex={selection?.surfaceProps.tabIndex ?? 0}
          data-selection-focus-scope={selection?.surfaceProps['data-selection-focus-scope']}
          data-selection-focus-active={selection?.surfaceProps['data-selection-focus-active']}
          data-selection-mode-active={selection?.surfaceProps['data-selection-mode-active']}
          onKeyDown={onKeyDown}
          onFocus={onFocusColumn}
        >
          {groups.map((group, groupIndex) => {
            const isFolded = folded.has(group.attribute)
            const label = toTitle(group.attribute)
            const attrIcon = getAttributeIconSrc(group.attribute)
            return (
              <Fragment key={group.attribute}>
                {groups.length > 1 ? (
                  <button
                    type="button" className="blm-knot"
                    style={{ '--knot-ink': group.accent } as CssVars}
                    data-folded={isFolded ? 'true' : undefined}
                    aria-expanded={!isFolded}
                    aria-label={`${label}, ${group.items.length} ${group.items.length === 1 ? 'resonator' : 'resonators'}`}
                    title={`${label} (${group.items.length})`}
                    tabIndex={-1}
                    onClick={() => toggleKnot(group.attribute)}
                  >
                    <span className="blm-knot-mark" aria-hidden="true">
                      {attrIcon ? (
                        <img src={attrIcon} alt="" loading="lazy" decoding="async" onError={withDefIconM} />
                      ) : null}
                    </span>
                    <span className="blm-knot-n" aria-hidden="true">{group.items.length}</span>
                  </button>
                ) : null}
                <div className="blm-group"
                  data-folded={isFolded ? 'true' : undefined}
                  inert={isFolded}
                >
                  <div className="blm-group-body">
                    {group.items.map((entry, index) => {
                      const isContext = entry.id === contextEntry?.id
                      const isPicked = selection?.isSelected(entry.id) ?? false
                      const bead = (
                        <button
                          key={entry.id}
                          type="button"
                          data-bead
                          data-res-id={entry.id}
                          className={[
                            'blm-bead',
                            isPicked ? 'focus-selected' : '',
                            selection?.selectionMode ? 'selection-mode' : '',
                          ].filter(Boolean).join(' ')}
                          style={{
                            '--row-ink': entry.accent,
                            '--bi': groupIndex * 2 + index,
                          } as CssVars}
                          tabIndex={isContext ? 0 : -1}
                          aria-pressed={isContext}
                          aria-label={[
                            entry.name,
                            `level ${entry.level}`,
                            `sequence ${entry.sequence}`,
                            reads === 'rotation' ? rotationNote(entry) : '',
                          ].filter(Boolean).join(', ')}
                          data-active={isContext ? 'true' : undefined}
                          data-marked={entry.rotationNodes > 0 ? 'true' : undefined}
                          data-pointed={previewId === entry.id ? 'true' : undefined}
                          data-selected={isPicked ? 'true' : undefined}
                          data-selection-focus-item="true"
                          onClick={() => onContextChange(entry.id)}
                          onClickCapture={selection?.buildClickCapture(entry.id)}
                          onPointerEnter={(event) => pointAt(entry.id, event.pointerType !== 'touch')}
                          onPointerLeave={() => releasePreview(entry.id)}
                          onFocus={() => pointAt(entry.id)}
                          onBlur={() => releasePreview(entry.id)}
                        >
                          <span className="blm-bead-pic">
                            <img
                              src={entry.profile}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              onError={withDefIconM}
                            />
                          </span>
                        </button>
                      )
                      return selection ? (
                        <ContextTrigger
                          key={entry.id}
                          asChild
                          ariaLabel={`${entry.name} actions`}
                          items={selection.getItems(entry.id)}
                        >
                          {bead}
                        </ContextTrigger>
                      ) : bead
                    })}
                  </div>
                </div>
              </Fragment>
            )
          })}
        </nav>
      </div>

      {reads === 'rotation' ? (
        <RosterCapsule
          target={capsuleTarget}
          mates={mates}
          onFace={onCapsuleFace}
          onFaceMenu={onCapsuleMenu}
          onMate={onCapsuleMate}
          onHold={holdPreview}
          onRelease={() => releasePreview()}
        />
      ) : null}

      <div className="blm-foot">
        {onAddResonator ? (
          <button
            type="button" className="blm-socket"
            onClick={onAddResonator}
            title="See all resonators"
            aria-label="See all resonators"
          >
            <UsersRound size="1em" aria-hidden="true" />
          </button>
        ) : null}

        <div className="blm-cap" aria-live="polite">
          {find ? (
            <span className="blm-cap-find">{find}</span>
          ) : contextEntry ? (
            <Fragment key={contextEntry.id}>
              <strong className="blm-cap-name" style={{ '--row-ink': contextEntry.accent } as CssVars}>
                {contextEntry.name}
              </strong>
              <span className="blm-cap-sub" style={{ '--row-ink': contextEntry.accent } as CssVars}>
                <span className="blm-cap-lv">Lv {contextEntry.level}</span>
                <span className="blm-cap-seq" aria-label={`Sequence ${contextEntry.sequence} of 6`}>
                  {seqPips(contextEntry.sequence)}
                </span>
              </span>
            </Fragment>
          ) : (
            <span className="blm-cap-empty">No resonators yet</span>
          )}
        </div>
      </div>
    </div>
  )
}
