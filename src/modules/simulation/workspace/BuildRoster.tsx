/*
  Author: Runor Ewhro
  Description: Projects canonical profiles into ordered attribute groups and surface-specific roster metadata.
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
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
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

  const measureFor = useCallback((id: string) => {
    const bead = beadOf(id)
    const column = columnRef.current
    const box = scrollRef.current
    if (!bead || !column || !box) return
    const b = bead.getBoundingClientRect()
    const c = column.getBoundingClientRect()
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
