/*
  Author: Runor Ewhro
  Description: Renders the set conditional surface for the calculator controls flow.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Search } from 'lucide-react'
import { withDefIconM } from '@/shared/lib/imageFallback'
import { AppModal } from '@/shared/ui/AppModal'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import type { SelectOption } from '@/shared/ui/LiquidSelect.tsx'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import {
  getSntSetOn,
  type SntSetConds,
  withSntSet,
} from '@/domain/entities/sonataSetConditionals.ts'

const PIECE_FILTERS = {
  all: 'All',
  one: '1PC',
  two: '2PC',
  three: '3PC',
  five: '5PC',
} as const

type PieceFilter = keyof typeof PIECE_FILTERS

type SortOption = 'idAsc' | 'idDesc' | 'nameAsc' | 'nameDesc' | 'partsDesc'

const SORTPTNSLIST: SelectOption<SortOption>[] = [
  { value: 'idAsc',    label: 'Set ID ↑' },
  { value: 'idDesc',   label: 'Set ID ↓' },
  { value: 'nameAsc',  label: 'Name A–Z' },
  { value: 'nameDesc', label: 'Name Z–A' },
  { value: 'partsDesc', label: 'Most Conditions' },
]

function partType(
    setMeta: (typeof ECHO_SET_DEFS)[number],
    partKey = '',
): PieceFilter | 'other' {
  // generated set parts do not always carry an explicit piece desc, so infer from the part key first and then from
  // available description fields.
  if (partKey === 'onePiece') return 'one'
  if (partKey === 'twoPiece') return 'two'
  if (partKey === 'threePiece') return 'three'
  if (partKey === 'fivePiece') return 'five'
  if (setMeta.desc.fivePiece) return 'five'
  if (setMeta.desc.threePiece) return 'three'
  if (setMeta.desc.twoPiece) return 'two'
  if (setMeta.desc.onePiece) return 'one'
  return 'other'
}

function partDesc(
    setMeta: (typeof ECHO_SET_DEFS)[number],
    part: (typeof ECHO_SET_DEFS)[number]['parts'][number],
): string {
  if (part.key === 'onePiece') return part.description ?? setMeta.desc.onePiece ?? part.label ?? '1pc effect'
  if (part.key === 'twoPiece') return part.description ?? setMeta.desc.twoPiece ?? part.label ?? '2pc effect'
  if (part.key === 'threePiece') return part.description ?? setMeta.desc.threePiece ?? part.label ?? '3pc effect'
  if (part.key === 'fivePiece') return part.description ?? setMeta.desc.fivePiece ?? part.label ?? '5pc effect'
  return part.description ?? part.label ?? part.key
}

function partEntries(
    setMeta: (typeof ECHO_SET_DEFS)[number],
    partKey: string,
) {
  if (partKey === 'onePiece') {
    return Array.isArray(setMeta.onePiece) ? setMeta.onePiece : []
  }

  if (partKey === 'twoPiece') {
    return Array.isArray(setMeta.twoPiece) ? setMeta.twoPiece : []
  }

  if (partKey === 'fivePiece' || partKey === 'threePiece') {
    return Array.isArray(setMeta.fivePiece) ? setMeta.fivePiece : []
  }

  const state = setMeta.states?.[partKey as keyof typeof setMeta.states]
  if (!state) {
    return []
  }

  if (Array.isArray(state.max) && state.max.length > 0) {
    return state.max
  }

  if (Array.isArray(state.perStep) && state.perStep.length > 0) {
    return state.perStep
  }

  if (Array.isArray(state.perStack) && state.perStack.length > 0) {
    return state.perStack
  }

  return []
}

function includePart(
    setMeta: (typeof ECHO_SET_DEFS)[number],
    partKey: string,
): boolean {
  // character-local conditionals hide teammate-only parts because those are controlled from team/optimizer surfaces.
  const entries = partEntries(setMeta, partKey)
  if (entries.length === 0) {
    return true
  }

  return entries.some((entry) => entry.targetScope !== 'activeOther' && entry.targetScope !== 'otherTeammates')
}

export function SetCond(props: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  onClose: () => void
  setConds: SntSetConds
  onSetCondsrx: (updater: (current: SntSetConds) => SntSetConds) => void
  title?: string
  onFtrChng?: () => void
}) {
  const {
    visible,
    open,
    closing = false,
    onClose,
    setConds: setConds,
    onSetCondsrx: onSetCondsCh,
    title = 'Set Effect Parts',
    onFtrChng: onFtrChng,
  } = props

  const [query, setQuery] = useState('')
  const [pieceFilter, setPcFltr] = useState<PieceFilter>('all')
  const [sortBy, setSortBy] = useState<SortOption>('idAsc')
  const glblTglRef = useRef<HTMLInputElement | null>(null)
  const rrnTmrRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (rrnTmrRef.current !== null) {
        window.clearTimeout(rrnTmrRef.current)
      }
    }
  }, [])

  const schdChng = useCallback(() => {
    if (!onFtrChng) {
      return
    }

    // condition toggles can fire in bursts; debounce reruns so suggestions/optimizer consumers receive one refresh.
    if (rrnTmrRef.current !== null) {
      window.clearTimeout(rrnTmrRef.current)
    }

    rrnTmrRef.current = window.setTimeout(() => {
      rrnTmrRef.current = null
      onFtrChng()
    }, 500)
  }, [onFtrChng])

  const sets = useMemo(() => {
    return ECHO_SET_DEFS.map((setMeta) => ({
      ...setMeta,
      icon: getSntSetIco(setMeta.id),
      parts: (setMeta.parts ?? [])
        .filter((part) => includePart(setMeta, part.key))
        .map((part) => ({
          ...part,
          desc: partDesc(setMeta, part),
          trigger: part.trigger ?? 'Triggered by set effect conditions.',
          partType: partType(setMeta, part.key),
        })),
    }))
  }, [])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()

    // filtering happens at the part level; sets stay visible only when at least one part survives the active filters.
    const searched = sets
      .map((setMeta) => ({
        ...setMeta,
        visibleParts: setMeta.parts.filter((part) => {
          if (pieceFilter !== 'all' && part.partType !== pieceFilter) {
            return false
          }

          if (!term) {
            return true
          }

          return (
            setMeta.name.toLowerCase().includes(term) ||
            String(setMeta.id).includes(term) ||
            part.key.toLowerCase().includes(term) ||
            part.desc.toLowerCase().includes(term)
          )
        }),
      }))
      .filter((setMeta) => setMeta.visibleParts.length > 0)

    return [...searched].sort((left, right) => {
      if (sortBy === 'idAsc') return left.id - right.id
      if (sortBy === 'idDesc') return right.id - left.id
      if (sortBy === 'nameAsc') return left.name.localeCompare(right.name)
      if (sortBy === 'nameDesc') return right.name.localeCompare(left.name)
      if (sortBy === 'partsDesc') return right.visibleParts.length - left.visibleParts.length
      return 0
    })
  }, [sets, pieceFilter, query, sortBy])

  const getChecked = useCallback((setId: number, partKey: string) => {
    return getSntSetOn(setConds, setId, partKey)
  }, [setConds])

  const stats = useMemo(() => {
    // visible stats drive the global checkbox state for the currently filtered result set, not the entire catalog.
    let total = 0
    let checked = 0

    for (const setMeta of filtered) {
      for (const part of setMeta.visibleParts) {
        total += 1
        if (getChecked(setMeta.id, part.key)) {
          checked += 1
        }
      }
    }

    return {
      total,
      checked,
      allChecked: total > 0 && checked === total,
      someChecked: checked > 0 && checked < total,
    }
  }, [filtered, getChecked])

  useEffect(() => {
    if (!glblTglRef.current) {
      return
    }

    glblTglRef.current.indeterminate = stats.someChecked
  }, [stats.someChecked])

  const applyUpdates = useCallback((
      updates: Array<{ setId: number; partKey: string; checked: boolean }>,
  ) => {
    // override updates persist only explicit disabled parts while defaults stay catalog-driven.
    onSetCondsCh((current) => withSntSet(current, updates))
    schdChng()
  }, [onSetCondsCh, schdChng])

  const togglePart = useCallback((setId: number, partKey: string, checked: boolean) => {
    applyUpdates([{ setId, partKey, checked }])
  }, [applyUpdates])

  const applyVisible = useCallback((checked: boolean) => {
    const updates = filtered.flatMap((setMeta) => (
      setMeta.visibleParts.map((part) => ({
        setId: setMeta.id,
        partKey: part.key,
        checked,
      }))
    ))

    applyUpdates(updates)
  }, [applyUpdates, filtered])

  const onTextChng = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
  }, [])

  const progressPct = stats.total > 0
    ? `${(stats.checked / stats.total) * 100}%`
    : '0%'

  return (
    <AppModal
      state={{ visible, open, closing: closing ?? false }}
      variant="set-conditionals"
      ariaLabel={title}
      onClose={onClose}
    >
      <div className="ssc-root">
        <div className="ssc-header">
          <div className="ssc-heading">
            <p className="ssc-eyebrow">Simulation</p>
            <h3 className="ssc-title">{title}</h3>
            <p className="ssc-subtitle">
              Toggle each set effect part to consider during optimization.
            </p>
          </div>

          <div className="ssc-header-actions">
            <span className="ssc-count-badge">{filtered.length} sets</span>
            <button
              type="button"
              className="ssc-close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Close
            </button>
          </div>
        </div>

        <div className="ssc-toolbar">
          <div className="rotation-saved-filters__search">
            <Search size={13} className="rotation-saved-filters__search-icon" />
            <input
                type="text"
                className="rotation-saved-filters__search-input"
                placeholder="Search..."
                value={query}
                onChange={onTextChng}
            />
          </div>

          <div className="ssc-tabs">
            {(Object.entries(PIECE_FILTERS) as [PieceFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`ssc-tab${pieceFilter === value ? ' active' : ''}`}
                onClick={() => setPcFltr(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="ssc-sort">
            <LiquidSelect<SortOption>
              value={sortBy}
              options={SORTPTNSLIST}
              onChange={(value) => setSortBy(value)}
              ariaLabel="Sort order"
              prfrPlcm="down"
            />
          </div>
        </div>

        <div className="ssc-body">
          <label className="ssc-global-row">
            <input
              ref={glblTglRef}
              type="checkbox"
              className="ssc-native-checkbox"
              checked={stats.allChecked}
              disabled={stats.total === 0}
              onChange={(event) => applyVisible(event.target.checked)}
            />
            <span className="ssc-checkmark">
              <svg className="ssc-checkmark-icon" width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <svg className="ssc-dash-icon" width="10" height="2" viewBox="0 0 10 2" fill="none" aria-hidden="true">
                <path d="M1 1H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </span>
            <span className="ssc-toggle-label">Toggle all visible</span>
            <span className="ssc-global-spacer" />
            <span className="ssc-count-display">
              {stats.checked} / {stats.total}
            </span>
            <span
              className="ssc-progress-track"
              aria-hidden="true"
            >
              <span className="ssc-progress-fill" style={{ width: progressPct }} />
            </span>
          </label>

          {filtered.length === 0 ? (
            <div className="ssc-empty">No sets match the current filters.</div>
          ) : null}

          {filtered.map((setMeta) => {
            const setChckCnt = setMeta.visibleParts.filter(
              (p) => getChecked(setMeta.id, p.key),
            ).length
            const counterClass = setChckCnt === 0
              ? 'ssc-set-counter'
              : setChckCnt === setMeta.visibleParts.length
                ? 'ssc-set-counter full'
                : 'ssc-set-counter partial'

            return (
              <div key={setMeta.id} className="ssc-card">
                <div className="ssc-card-head">
                  <span className="ssc-set-icon">
                    {setMeta.icon ? (
                      <img src={setMeta.icon} alt="" loading="lazy" onError={withDefIconM} />
                    ) : (
                      <span className="ssc-set-icon-fallback">{setMeta.id}</span>
                    )}
                  </span>

                  <div className="ssc-set-meta">
                    <div className="ssc-set-name">{setMeta.name}</div>
                    <div className="ssc-set-id">Set #{setMeta.id}</div>
                  </div>

                  <span className={counterClass}>
                    {setChckCnt}/{setMeta.visibleParts.length}
                  </span>
                </div>

                {setMeta.visibleParts.length > 0 ? (
                  <div className="ssc-parts">
                    {setMeta.visibleParts.map((part) => {
                      const pieceNum = part.partType === 'one' ? 1 : part.partType === 'two' ? 2 : part.partType === 'three' ? 3 : part.partType === 'five' ? 5 : null
                      const badgeClass = `ssc-piece-badge${part.partType === 'one' ? ' one' : part.partType === 'three' ? ' three' : part.partType === 'five' ? ' five' : ''}`

                      return (
                        <label key={`${setMeta.id}-${part.key}`} className="ssc-part-row">
                          <input
                            type="checkbox"
                            className="ssc-native-checkbox"
                            checked={getChecked(setMeta.id, part.key)}
                            onChange={(event) => togglePart(setMeta.id, part.key, event.target.checked)}
                          />
                          <span className="ssc-checkmark">
                            <svg className="ssc-checkmark-icon" width="9" height="7" viewBox="0 0 9 7" fill="none" aria-hidden="true">
                              <path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </span>
                          {pieceNum !== null ? (
                            <span className={badgeClass}>{pieceNum}</span>
                          ) : null}
                          <div className="ssc-part-text">
                            <div className="ssc-part-desc">{part.desc}</div>
                            <div className="ssc-part-trigger">{part.trigger}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </AppModal>
  )
}
