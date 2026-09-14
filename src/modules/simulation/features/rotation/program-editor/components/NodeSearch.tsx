/*
  Author: Runor Ewhro
  Description: The readout, which is also the search field. One lit thing on
               the band, turning over between naming the selection and taking
               a query for the rotation.
*/

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type {
  EditorSection,
  LoopRunSelections,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  buildNodeIndex,
  searchNodes,
  SEARCH_KIND_NAMES,
  type SearchNames,
  type SearchHit,
} from '@/modules/simulation/features/rotation/program-editor/interaction/nodeSearch.ts'
import { formatDamage } from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import type { RotationNodeTarget } from '@/modules/simulation/features/rotation/program-editor/interaction/nodeNavigation.ts'
import { AnchoredAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'

export interface NodeSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: EditorSection[]
  names: SearchNames
  runsByLoopId: LoopRunSelections
  onPick: (target: RotationNodeTarget) => void
  /** the readout's own state, which the shell keeps while search is shut */
  readout: { name: string; value: number | null; color?: string } | null
  stale: boolean
  decimals: number
  totalMs: number
  canScrollTo: boolean
  onScrollTo: () => void
}

export function NodeSearch({
  open,
  onOpenChange,
  sections,
  names,
  runsByLoopId,
  onPick,
  readout,
  stale,
  decimals,
  totalMs,
  canScrollTo,
  onScrollTo,
}: NodeSearchProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  /** null follows the query; zero is the loop's current/general view */
  const [loopRun, setLoopRun] = useState<number | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  /*
    the index is the rotation read once. it is rebuilt when the rotation
    changes rather than per keystroke, which is what keeps a 42-step search
    from walking the tree on every letter.
  */
  const index = useMemo(
    () => open ? buildNodeIndex(sections, names) : [],
    [names, open, sections],
  )
  const hits = useMemo(() => searchNodes(index, query), [index, query])
  const asked = query.trim().length > 0
  const at = Math.min(active, Math.max(0, hits.length - 1))

  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) {
      setQuery('')
      setActive(0)
      setLoopRun(null)
    }
  }

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  useAppPopupDismiss({
    open,
    onDismiss: () => onOpenChange(false),
    hostRef,
    popupRef,
    returnFocusRef: toggleRef,
    pointerEvent: 'mousedown',
  })

  const selectedLoopRun = (hit: SearchHit | undefined): number =>
    loopRun ?? hit?.loop?.requestedRun ?? 0

  const targetFor = (hit: SearchHit): RotationNodeTarget => {
    const run = selectedLoopRun(hit)
    if (!hit.loop || run === 0) return { nodeId: hit.id }
    return { nodeId: hit.id, loopRuns: { [hit.loop.id]: run } }
  }

  const cycleLoopRun = (hit: SearchHit, direction: -1 | 1) => {
    if (!hit.loop) return
    const variants = hit.loop.runs + 1
    setLoopRun((selectedLoopRun(hit) + direction + variants) % variants)
  }

  const pick = (hit: SearchHit) => {
    onPick(targetFor(hit))
    onOpenChange(false)
  }

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className={`rte-tool rte-search${open ? ' is-on' : ''}`}
        aria-pressed={open}
        title={open ? 'Stop searching' : 'Find a node by name'}
        aria-label="Find a node"
        onClick={() => onOpenChange(!open)}
      >
        {/*
          one glyph, not two. the lens closes as the handle grows through the
          middle into the first stroke of a cross, and the second stroke draws
          itself in after it. the handle and that stroke are the same line.
        */}
        <svg className="rte-search__mk" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="rte-search__lens" cx="11" cy="11" r="8" />
          {/*
            one path holding both of lucide's strokes, which is possible only
            because they are collinear: the lens handle runs (21,21) to
            (16.66,16.66) and the cross's first stroke runs (6,6) to (18,18),
            both on y=x. the dash decides which stretch of it is showing.
          */}
          <path className="rte-search__bar" d="M21 21 L6 6" pathLength="100" />
          <path className="rte-search__cut" d="M18 6 L6 18" pathLength="100" />
        </svg>
      </button>

      <div
        ref={hostRef}
        className={`rte-read${stale ? ' is-stale' : ''}${open ? ' is-find' : ''}`}
        style={readout?.color
          ? ({ '--avg': readout.color } as CSSProperties)
          : undefined}
      >
      <button
        type="button" className="rte-read__face"
        disabled={!canScrollTo}
        tabIndex={open ? -1 : undefined}
        title={readout ? 'Scroll to the selected node' : 'Select a node to read it here'}
        onClick={onScrollTo}
      >
        <i className="rte-read__dot" aria-hidden="true" />
        <span className="rte-read__name">{readout?.name ?? 'no selection'}</span>
        {readout && readout.value !== null ? (
          <span className="rte-read__val">{formatDamage(readout.value, decimals)}</span>
        ) : null}
        <span className="rte-spacer" />
        <span className="rte-read__ms">{totalMs} ms</span>
      </button>

      <div className="rte-read__find" role="search">
        <input
          ref={inputRef}
          type="text" className="rte-find__input"
          value={query}
          placeholder="find a step, state, block or note"
          autoComplete="off"
          spellCheck={false}
          tabIndex={open ? undefined : -1}
          role="combobox"
          aria-expanded={asked}
          aria-autocomplete="list"
          aria-controls="rte-find-hits"
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setLoopRun(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onOpenChange(false)
              return
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (hits.length === 0) {
                return
              }
              const step = event.key === 'ArrowDown' ? 1 : -1
              setActive((current) => (current + step + hits.length) % hits.length)
              setLoopRun(null)
              return
            }
            if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && hits[at]?.loop) {
              event.preventDefault()
              cycleLoopRun(hits[at], event.key === 'ArrowLeft' ? -1 : 1)
              return
            }
            if (event.key === 'Enter' && hits[at]) {
              event.preventDefault()
              pick(hits[at])
            }
          }}
        />
        {/* the count is the only feedback the field itself needs */}
        {asked && (
          <span className="rte-find__count">
          {`${hits.length || 'no'} ${hits.length === 1 ? 'hit' : 'hits'}`}
        </span>
        )}
      </div>

      <AnchoredAppPopup
        visible={open && asked}
        anchorRef={hostRef}
        popupRef={popupRef}
        anchorWidth="exact"
        maxHeight={304}
        id="rte-find-hits" className="rte-find__hits"
        open={open && asked}
        role="listbox"
      >
          {hits.length === 0 ? (
            <p className="rte-find__none">Nothing in this rotation is called that.</p>
          ) : hits.map((hit, index_) => {
            const isAt = index_ === at
            const run = isAt ? selectedLoopRun(hit) : hit.loop?.requestedRun ?? 0
            const currentRun = hit.loop ? runsByLoopId[hit.loop.id] ?? 1 : 1
            return (
            <div
              key={hit.id}
              className={`rte-find__row${isAt ? ' is-at' : ''}`}
              onMouseEnter={() => {
                setActive(index_)
                setLoopRun(null)
              }}
            >
              <button
                type="button"
                className={`rte-find__hit${isAt ? ' is-at' : ''}`}
                role="option"
                aria-selected={isAt}
                // the field keeps focus so the arrow keys stay live
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(hit)}
              >
                <i className={`rte-find__kind rte-find__kind--${hit.kind}`}>
                  {SEARCH_KIND_NAMES[hit.kind]}
                </i>
                <span className="rte-find__ttl">
                  {hit.title.slice(0, hit.from)}
                  {hit.to > hit.from ? <mark>{hit.title.slice(hit.from, hit.to)}</mark> : null}
                  {hit.title.slice(hit.to)}
                </span>
                {/* found by what it is rather than by what it is called */}
                {hit.via ? <u className="rte-find__via">{hit.via}</u> : null}
                <span className="rte-spacer" />
                {hit.crumb ? <span className="rte-find__crumb">{hit.crumb}</span> : null}
              </button>
              {hit.loop && isAt ? (
                <span className="rte-find__runs" aria-label={`${hit.title} run`}>
                  <button
                    type="button"
                    aria-label={`Previous ${hit.title} run`}
                    title="Previous loop view"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => cycleLoopRun(hit, -1)}
                  >
                    ‹
                  </button>
                  <samp>{run === 0 ? `current ${currentRun}/${hit.loop.runs}` : `${run}/${hit.loop.runs}`}</samp>
                  <button
                    type="button"
                    aria-label={`Next ${hit.title} run`}
                    title="Next loop view"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => cycleLoopRun(hit, 1)}
                  >
                    ›
                  </button>
                </span>
              ) : null}
            </div>
            )
          })}
      </AnchoredAppPopup>
      </div>
    </>
  )
}
