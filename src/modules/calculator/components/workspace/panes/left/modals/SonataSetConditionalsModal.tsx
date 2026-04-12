import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Search } from 'lucide-react'
import { AppDialog } from '@/shared/ui/AppDialog'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import type { LiquidSelectOption } from '@/shared/ui/LiquidSelect'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { getSonataSetIcon } from '@/data/gameData/catalog/sonataSets'
import {
  getCompactSonataSetPart,
  type SonataSetConditionals,
  withCompactSonataSetUpdates,
} from '@/domain/entities/sonataSetConditionals'

const PIECE_FILTERS = {
  all: 'All',
  two: '2PC',
  three: '3PC',
  five: '5PC',
} as const

type PieceFilter = keyof typeof PIECE_FILTERS

type SortOption = 'idAsc' | 'idDesc' | 'nameAsc' | 'nameDesc' | 'partsDesc'

const SORT_OPTIONS_LIST: LiquidSelectOption<SortOption>[] = [
  { value: 'idAsc',    label: 'Set ID ↑' },
  { value: 'idDesc',   label: 'Set ID ↓' },
  { value: 'nameAsc',  label: 'Name A–Z' },
  { value: 'nameDesc', label: 'Name Z–A' },
  { value: 'partsDesc', label: 'Most Conditions' },
]

function inferPartType(
    setMeta: (typeof ECHO_SET_DEFS)[number],
    partKey = '',
): PieceFilter | 'other' {
  if (partKey === 'twoPiece') return 'two'
  if (partKey === 'threePiece') return 'three'
  if (partKey === 'fivePiece') return 'five'
  if (setMeta.desc.fivePiece) return 'five'
  if (setMeta.desc.threePiece) return 'three'
  if (setMeta.desc.twoPiece) return 'two'
  return 'other'
}

function resolvePartDesc(
    setMeta: (typeof ECHO_SET_DEFS)[number],
    part: (typeof ECHO_SET_DEFS)[number]['parts'][number],
): string {
  if (part.key === 'twoPiece') return setMeta.desc.twoPiece ?? part.label ?? '2pc effect'
  if (part.key === 'threePiece') return setMeta.desc.threePiece ?? part.label ?? '3pc effect'
  if (part.key === 'fivePiece') return setMeta.desc.fivePiece ?? part.label ?? '5pc effect'
  return part.label ?? part.key
}

function getPartEntries(
    setMeta: (typeof ECHO_SET_DEFS)[number],
    partKey: string,
) {
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

function shouldIncludePartForCharacter(
    setMeta: (typeof ECHO_SET_DEFS)[number],
    partKey: string,
): boolean {
  const entries = getPartEntries(setMeta, partKey)
  if (entries.length === 0) {
    return true
  }

  return entries.some((entry) => entry.targetScope !== 'activeOther' && entry.targetScope !== 'otherTeammates')
}

export function SonataSetConditionalsModal(props: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  onClose: () => void
  setConditionals: SonataSetConditionals
  onSetConditionalsChange: (updater: (current: SonataSetConditionals) => SonataSetConditionals) => void
  title?: string
  onAfterChange?: () => void
}) {
  const {
    visible,
    open,
    closing = false,
    portalTarget,
    onClose,
    setConditionals,
    onSetConditionalsChange,
    title = 'Set Effect Parts',
    onAfterChange,
  } = props

  const [query, setQuery] = useState('')
  const [pieceFilter, setPieceFilter] = useState<PieceFilter>('all')
  const [sortBy, setSortBy] = useState<SortOption>('idAsc')
  const globalToggleRef = useRef<HTMLInputElement | null>(null)
  const rerunTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (rerunTimerRef.current !== null) {
        window.clearTimeout(rerunTimerRef.current)
      }
    }
  }, [])

  const scheduleAfterChange = useCallback(() => {
    if (!onAfterChange) {
      return
    }

    if (rerunTimerRef.current !== null) {
      window.clearTimeout(rerunTimerRef.current)
    }

    rerunTimerRef.current = window.setTimeout(() => {
      rerunTimerRef.current = null
      onAfterChange()
    }, 500)
  }, [onAfterChange])

  const normalizedSets = useMemo(() => {
    return ECHO_SET_DEFS.map((setMeta) => ({
      ...setMeta,
      icon: getSonataSetIcon(setMeta.id),
      parts: (setMeta.parts ?? [])
        .filter((part) => shouldIncludePartForCharacter(setMeta, part.key))
        .map((part) => ({
          ...part,
          desc: resolvePartDesc(setMeta, part),
          trigger: part.trigger ?? 'Triggered by set effect conditions.',
          partType: inferPartType(setMeta, part.key),
        })),
    }))
  }, [])

  const filteredSets = useMemo(() => {
    const term = query.trim().toLowerCase()

    const searched = normalizedSets
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
  }, [normalizedSets, pieceFilter, query, sortBy])

  const getChecked = useCallback((setId: number, partKey: string) => {
    return getCompactSonataSetPart(setConditionals, setId, partKey, false)
  }, [setConditionals])

  const visibleStats = useMemo(() => {
    let total = 0
    let checked = 0

    for (const setMeta of filteredSets) {
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
  }, [filteredSets, getChecked])

  useEffect(() => {
    if (!globalToggleRef.current) {
      return
    }

    globalToggleRef.current.indeterminate = visibleStats.someChecked
  }, [visibleStats.someChecked])

  const applyUpdates = useCallback((
      updates: Array<{ setId: number; partKey: string; checked: boolean }>,
  ) => {
    onSetConditionalsChange((current) => withCompactSonataSetUpdates(current, updates))
    scheduleAfterChange()
  }, [onSetConditionalsChange, scheduleAfterChange])

  const togglePart = useCallback((setId: number, partKey: string, checked: boolean) => {
    applyUpdates([{ setId, partKey, checked }])
  }, [applyUpdates])

  const applyVisible = useCallback((checked: boolean) => {
    const updates = filteredSets.flatMap((setMeta) => (
      setMeta.visibleParts.map((part) => ({
        setId: setMeta.id,
        partKey: part.key,
        checked,
      }))
    ))

    applyUpdates(updates)
  }, [applyUpdates, filteredSets])

  const handleTextChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
  }, [])

  const progressPct = visibleStats.total > 0
    ? `${(visibleStats.checked / visibleStats.total) * 100}%`
    : '0%'

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      contentClassName="app-modal-panel ssc-modal"
      ariaLabel={title}
      onClose={onClose}
    >
      <div className="ssc-root">

        {/* ── Header ── */}
        <div className="ssc-header">
          <div className="ssc-heading">
            <p className="ssc-eyebrow">Simulation</p>
            <h3 className="ssc-title">{title}</h3>
            <p className="ssc-subtitle">
              Toggle each set effect part to consider during optimization.
            </p>
          </div>

          <div className="ssc-header-actions">
            <span className="ssc-count-badge">{filteredSets.length} sets</span>
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

        {/* ── Toolbar ── */}
        <div className="ssc-toolbar">
          <div className="rotation-saved-filters__search">
            <Search size={13} className="rotation-saved-filters__search-icon" />
            <input
                type="text"
                className="rotation-saved-filters__search-input"
                placeholder="Search..."
                value={query}
                onChange={handleTextChange}
            />
          </div>

          <div className="ssc-tabs">
            {(Object.entries(PIECE_FILTERS) as [PieceFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`ssc-tab${pieceFilter === value ? ' active' : ''}`}
                onClick={() => setPieceFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="ssc-sort">
            <LiquidSelect<SortOption>
              value={sortBy}
              options={SORT_OPTIONS_LIST}
              onChange={(value) => setSortBy(value)}
              ariaLabel="Sort order"
              preferredPlacement="down"
            />
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="ssc-body">

          {/* Global toggle */}
          <label className="ssc-global-row">
            <input
              ref={globalToggleRef}
              type="checkbox"
              className="ssc-native-checkbox"
              checked={visibleStats.allChecked}
              disabled={visibleStats.total === 0}
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
              {visibleStats.checked} / {visibleStats.total}
            </span>
            <span
              className="ssc-progress-track"
              aria-hidden="true"
            >
              <span className="ssc-progress-fill" style={{ width: progressPct }} />
            </span>
          </label>

          {/* Empty state */}
          {filteredSets.length === 0 ? (
            <div className="ssc-empty">No sets match the current filters.</div>
          ) : null}

          {/* Set cards */}
          {filteredSets.map((setMeta) => {
            const setCheckedCount = setMeta.visibleParts.filter(
              (p) => getChecked(setMeta.id, p.key),
            ).length
            const counterClass = setCheckedCount === 0
              ? 'ssc-set-counter'
              : setCheckedCount === setMeta.visibleParts.length
                ? 'ssc-set-counter full'
                : 'ssc-set-counter partial'

            return (
              <div key={setMeta.id} className="ssc-card">
                <div className="ssc-card-head">
                  <span className="ssc-set-icon">
                    {setMeta.icon ? (
                      <img src={setMeta.icon} alt="" loading="lazy" />
                    ) : (
                      <span className="ssc-set-icon-fallback">{setMeta.id}</span>
                    )}
                  </span>

                  <div className="ssc-set-meta">
                    <div className="ssc-set-name">{setMeta.name}</div>
                    <div className="ssc-set-id">Set #{setMeta.id}</div>
                  </div>

                  <span className={counterClass}>
                    {setCheckedCount}/{setMeta.visibleParts.length}
                  </span>
                </div>

                {setMeta.visibleParts.length > 0 ? (
                  <div className="ssc-parts">
                    {setMeta.visibleParts.map((part) => {
                      const pieceNum = part.partType === 'two' ? 2 : part.partType === 'three' ? 3 : part.partType === 'five' ? 5 : null
                      const badgeClass = `ssc-piece-badge${part.partType === 'three' ? ' three' : part.partType === 'five' ? ' five' : ''}`

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
    </AppDialog>
  )
}
