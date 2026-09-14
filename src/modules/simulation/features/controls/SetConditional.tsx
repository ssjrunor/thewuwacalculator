/*
  Author: Runor Ewhro
  Description: Owns set conditional behavior and state transitions for the controls module.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties as CssProps } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { withDefIconM } from '@/shared/lib/imageFallback'
import { AppModal } from '@/shared/ui/AppModal'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import type { SelectOption } from '@/shared/ui/LiquidSelect.tsx'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import { getSntSetClr, getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
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
  const [openSet, setOpenSet] = useState<number | null>(null)
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
      color: getSntSetClr(setMeta.id),
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

  const applySet = useCallback((
      setId: number,
      parts: Array<{ key: string }>,
      checked: boolean,
  ) => {
    applyUpdates(parts.map((part) => ({ setId, partKey: part.key, checked })))
  }, [applyUpdates])

  const onTextChng = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
  }, [])

  // the rail entries carry live counts, so they answer the piece filter against the search alone.
  const pieceCounts = useMemo(() => {
    const term = query.trim().toLowerCase()
    const counts: Record<PieceFilter, number> = { all: 0, one: 0, two: 0, three: 0, five: 0 }

    for (const setMeta of sets) {
      for (const part of setMeta.parts) {
        const matches = !term
          || setMeta.name.toLowerCase().includes(term)
          || String(setMeta.id).includes(term)
          || part.key.toLowerCase().includes(term)
          || part.desc.toLowerCase().includes(term)

        if (!matches) {
          continue
        }

        counts.all += 1
        if (part.partType !== 'other') {
          counts[part.partType] += 1
        }
      }
    }

    return counts
  }, [sets, query])

  return (
    <AppModal
      state={{ visible, open, closing: closing ?? false }}
      variant="set-conditionals"
      ariaLabel={title}
      onClose={onClose}
    >
      <div className="amdl ssc-root">
        <ModalHeader over="Simulation" title={<h2>{title}</h2>} onClose={onClose}>
          <div className="amdl__gauge">
            <div className="amdl__pill">
              <span className="amdl__pill-label">Sets</span>
              <span className="amdl__pill-value">{filtered.length}</span>
            </div>
            <div className={`amdl__pill${stats.checked < stats.total ? ' is-accent' : ''}`}>
              <span className="amdl__pill-label">Parts on</span>
              <span className="amdl__pill-value">{stats.checked}/{stats.total}</span>
            </div>
          </div>
        </ModalHeader>

        <div className="amdl__body sscr-body">
          <div className="amdl__rail sscr-rail">
            <label className="amdl__find">
              <Search size="0.8125rem" />
              <input
                  type="text"
                  placeholder="Search..."
                  value={query}
                  onChange={onTextChng}
                  aria-label="Search set effect parts"
              />
            </label>

            <div className="sscr-sec">Pieces</div>
            {(Object.entries(PIECE_FILTERS) as [PieceFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`amdl__tab${pieceFilter === value ? ' is-on' : ''}`}
                onClick={() => setPcFltr(value)}
              >
                <span className="amdl__tab-label">{label}</span>
                <span className="amdl__tab-n">{pieceCounts[value]}</span>
              </button>
            ))}

            <div className="amdl__rail-foot sscr-foot">
              <label className="sscr-foot-row">
                <input
                  ref={glblTglRef}
                  type="checkbox" className="ssc-native-checkbox"
                  checked={stats.allChecked}
                  disabled={stats.total === 0}
                  onChange={(event) => applyVisible(event.target.checked)}
                />
                <span className="sscr-foot-label">Toggle all</span>
                <span className="sscr-sw" aria-hidden="true" />
              </label>
              <div className={`sscr-foot-count${stats.checked < stats.total ? ' is-part' : ''}`}>
                {stats.checked} / {stats.total}
              </div>
            </div>
          </div>

          <div className="amdl__pane">
            {filtered.length === 0 ? (
              <div className="sscr-empty">No sets match the current filters.</div>
            ) : (
              <section className="amdl__grp sscr-grp">
                <div className="amdl__grp-name">
                  Sets
                  <span className="amdl__grp-n">{filtered.length}</span>
                  <LiquidSelect<SortOption>
                    value={sortBy}
                    options={SORTPTNSLIST}
                    onChange={(value) => setSortBy(value)}
                    ariaLabel="Sort order"
                    placement="down" className="sscr-sort"
                  />
                </div>

                {filtered.map((setMeta) => {
                  const parts = setMeta.visibleParts
                  const setChckCnt = parts.filter((part) => getChecked(setMeta.id, part.key)).length
                  const isOpen = openSet === setMeta.id
                  const allOn = setChckCnt === parts.length
                  const someOn = setChckCnt > 0 && !allOn

                  return (
                    <section
                      key={setMeta.id}
                      className={`sscr-blk${isOpen ? ' is-open' : ''}`}
                      style={setMeta.color ? { '--sscr-c': setMeta.color } as CssProps : undefined}
                    >
                      <div className="amdl__row sscr-head">
                        <button
                          type="button" className="sscr-open"
                          aria-expanded={isOpen}
                          onClick={() => setOpenSet(isOpen ? null : setMeta.id)}
                        >
                          <span className="sscr-well">
                            {setMeta.icon ? (
                              <img src={setMeta.icon} alt="" loading="lazy" onError={withDefIconM} />
                            ) : (
                              <span className="sscr-well-fallback">{setMeta.id}</span>
                            )}
                          </span>
                          <span className="sscr-title">
                            <span className="sscr-name">{setMeta.name}</span>
                            <small>Set #{setMeta.id}</small>
                          </span>
                          <ChevronRight size="0.75rem" className="sscr-chev" aria-hidden="true" />
                        </button>

                        <span className={`sscr-count${allOn ? '' : ' is-part'}`}>
                          {setChckCnt}/{parts.length}
                        </span>

                        <label className="sscr-toggle" title={setMeta.name}>
                          <input
                            type="checkbox" className="ssc-native-checkbox"
                            checked={allOn}
                            ref={(node) => { if (node) node.indeterminate = someOn }}
                            onChange={(event) => applySet(setMeta.id, parts, event.target.checked)}
                          />
                          <span className="sscr-sw" aria-hidden="true" />
                        </label>
                      </div>

                      <div className="sscr-fold">
                        <div className="sscr-fold-inner">
                          <div className="sscr-parts">
                            {parts.map((part) => {
                              const pieceNum = part.partType === 'one' ? 1
                                : part.partType === 'two' ? 2
                                  : part.partType === 'three' ? 3
                                    : part.partType === 'five' ? 5 : null

                              return (
                                <label key={`${setMeta.id}-${part.key}`} className="amdl__row sscr-part">
                                  <input
                                    type="checkbox" className="ssc-native-checkbox"
                                    checked={getChecked(setMeta.id, part.key)}
                                    onChange={(event) => togglePart(setMeta.id, part.key, event.target.checked)}
                                  />
                                  <span className="sscr-part-text">
                                    {pieceNum !== null ? <span className="sscr-pc">{pieceNum}</span> : null}
                                    <span className="sscr-desc">{part.desc}</span>
                                    <span className="sscr-trigger">{part.trigger}</span>
                                  </span>
                                  <span className="sscr-sw" aria-hidden="true" />
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    </section>
                  )
                })}
              </section>
            )}

            <p className="amdl__prose sscr-hint">Toggle each set effect part to consider during optimization.</p>
          </div>
        </div>
      </div>
    </AppModal>
  )
}
