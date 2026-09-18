/*
  Author: Runor Ewhro
  Description: Edits optimizer Sonata-set constraints and summarizes selected
               sets by legal Echo piece-count bucket.
*/

import { ChevronDown, X } from 'lucide-react'
import { useAppStore } from '@/domain/state/store'
import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import type { OptSetChoice } from '@/domain/entities/optimizer'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import {
  optSetPieceCount,
  type OptSetPieceCount as PieceCount,
} from '@/engine/optimizer/config/allowedSets.ts'
import {
  AnchoredAppPopup,
  useAppPopup,
  useAppPopupDismiss,
} from '@/shared/ui/AppPopup.tsx'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'

interface LlwdSetDrpdP {
  selIdsByPc?: OptSetChoice
  onChange?: (nextSelIdsBy: OptSetChoice) => void
  selectedSetIds?: readonly number[]
  onSetIdsChange?: (nextSetIds: number[]) => void
  triggerClass?: string
  availableSetIds?: readonly number[]
  selectionMode?: 'multi' | 'single'
  closeOnSelect?: boolean
  placeholder?: string
  triggerVariant?: 'chip' | 'liquid'
  renderTrigger?: (args: { summaryLabel: string; open: boolean }) => ReactNode
}

const EMPTY_SET_CHOICE: OptSetChoice = { 1: [], 3: [], 5: [] }

function setIdsToChoice(ids: readonly number[]): OptSetChoice {
  const next: OptSetChoice = { 1: [], 3: [], 5: [] }
  for (const id of ids) {
    const pieceCount = optSetPieceCount(id)
    if (!next[pieceCount].includes(id)) {
      next[pieceCount].push(id)
    }
  }

  return {
    1: next[1].sort((left, right) => left - right),
    3: next[3].sort((left, right) => left - right),
    5: next[5].sort((left, right) => left - right),
  }
}

function choiceToSetIds(choice: OptSetChoice): number[] {
  return [...choice[1], ...choice[3], ...choice[5]].sort((left, right) => left - right)
}

export function AllowedSets({
                              selIdsByPc: selIdsByPc,
                              onChange,
                              selectedSetIds,
                              onSetIdsChange,
                              triggerClass: triggerClass,
                              availableSetIds,
                              selectionMode = 'multi',
                              closeOnSelect,
                              placeholder = 'All Sets',
                              triggerVariant = 'chip',
                              renderTrigger: renderTrigger,
                            }: LlwdSetDrpdP) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const popup = useAppPopup()
  const { open, closing, visible: menuVisible } = popup
  const ui = useAppStore((state) => state.ui)

  const actVar = useMemo(() => {
    if (ui.theme === 'background') {
      return ui.backgroundVariant
    }

    return ui.theme === 'dark' ? ui.darkVariant : ui.lightVariant
  }, [ui.backgroundVariant, ui.darkVariant, ui.lightVariant, ui.theme])

  const actTextModeC = useMemo(() => {
    if (ui.theme === 'background') {
      return `${ui.backgroundTextMode}-text`
    }

    return ui.theme === 'dark' ? 'dark-text' : 'light-text'
  }, [ui.backgroundTextMode, ui.theme])

  const availableSetIdSet = useMemo(
    () => availableSetIds ? new Set(availableSetIds) : null,
    [availableSetIds],
  )

  const sourceSelIdsByPc = useMemo(
    () => selIdsByPc ?? (selectedSetIds ? setIdsToChoice(selectedSetIds) : EMPTY_SET_CHOICE),
    [selectedSetIds, selIdsByPc],
  )
  const session = useConfigurationSession({
    source: sourceSelIdsByPc,
    active: menuVisible,
    commit: (reducer) => {
      const nextChoice = reducer(sourceSelIdsByPc)
      onChange?.(nextChoice)
      onSetIdsChange?.(choiceToSetIds(nextChoice))
    },
  })
  const effectiveSelIdsByPc = menuVisible ? session.draft : sourceSelIdsByPc
  const applyChange = session.replace

  const summaryLabel = useMemo(() => {
    if (selectedSetIds) {
      if (selectedSetIds.length === 0) {
        return placeholder
      }
      if (selectedSetIds.length === 1) {
        return getSntSetNam(selectedSetIds[0] ?? 0)
      }
      return `${selectedSetIds.length} Sonata`
    }

    // Multi-bucket selection counts use the same piece-count grouping as constraints.
    const fiveCount = effectiveSelIdsByPc[5].length
    const threeCount = effectiveSelIdsByPc[3].length
    const oneCount = effectiveSelIdsByPc[1].length
    if (oneCount === 0 && fiveCount === 0 && threeCount === 0) {
      return placeholder
    }

    const parts: string[] = []
    if (oneCount > 0) parts.push(`1pc ${oneCount}`)
    if (fiveCount > 0) parts.push(`5pc ${fiveCount}`)
    if (threeCount > 0) parts.push(`3pc ${threeCount}`)
    return parts.join(' • ')
  }, [effectiveSelIdsByPc, placeholder, selectedSetIds])

  const optionGroups = useMemo(
    () => ([
      {
        label: '5pc',
        pieceCount: 5 as PieceCount,
        options: ECHO_SET_DEFS
          .filter((set) => set.setMax === 5 && (!availableSetIdSet || availableSetIdSet.has(set.id)))
          .map((set) => ({
            id: set.id,
            name: set.name,
            icon: getSntSetIco(set.id) ?? '',
          })),
      },
      {
        label: '3pc',
        pieceCount: 3 as PieceCount,
        options: ECHO_SET_DEFS
          .filter((set) => set.setMax === 3 && (!availableSetIdSet || availableSetIdSet.has(set.id)))
          .map((set) => ({
            id: set.id,
            name: set.name,
            icon: getSntSetIco(set.id) ?? '',
          })),
      },
      {
        label: '1pc',
        pieceCount: 1 as PieceCount,
        options: ECHO_SET_DEFS
          .filter((set) => set.setMax === 1 && (!availableSetIdSet || availableSetIdSet.has(set.id)))
          .map((set) => ({
            id: set.id,
            name: set.name,
            icon: getSntSetIco(set.id) ?? '',
          })),
      },
    ]),
    [availableSetIdSet],
  )

  const selectedTotal = useMemo(
    () => effectiveSelIdsByPc[1].length + effectiveSelIdsByPc[3].length + effectiveSelIdsByPc[5].length,
    [effectiveSelIdsByPc],
  )
  const visibleOptionGroups = useMemo(
    () => optionGroups.filter((group) => group.options.length > 0),
    [optionGroups],
  )
  const visibleGroupCount = Math.max(1, visibleOptionGroups.length)

  const isReset = selectedTotal === 0

  const clearPc = useCallback((pieceCount: PieceCount) => {
    applyChange({
      ...effectiveSelIdsByPc,
      [pieceCount]: [],
    })
  }, [applyChange, effectiveSelIdsByPc])

  const setAll = useCallback(() => {
    applyChange({
      1: optionGroups.find((group) => group.pieceCount === 1)?.options.map((set) => set.id) ?? [],
      3: optionGroups.find((group) => group.pieceCount === 3)?.options.map((set) => set.id) ?? [],
      5: optionGroups.find((group) => group.pieceCount === 5)?.options.map((set) => set.id) ?? [],
    })
  }, [applyChange, optionGroups])

  const invPc = useCallback((pieceCount: PieceCount) => {
    const group = optionGroups.find((entry) => entry.pieceCount === pieceCount)
    if (!group) {
      return []
    }

    const selected = new Set(effectiveSelIdsByPc[pieceCount])
    return group.options
      .map((set) => set.id)
      .filter((id) => !selected.has(id))
  }, [effectiveSelIdsByPc, optionGroups])

  const invertAll = useCallback(() => {
    applyChange({
      1: invPc(1),
      3: invPc(3),
      5: invPc(5),
    })
  }, [applyChange, invPc])

  const closeMenu = useCallback(() => {
    popup.hide(session.finish)
  }, [popup, session])

  const openMenu = useCallback(() => {
    popup.show()
  }, [popup])

  const shouldCloseOnSelect = closeOnSelect ?? selectionMode === 'single'
  const showBulkCommands = selectionMode !== 'single'
  const liquidTrigger = triggerVariant === 'liquid'

  useEffect(() => {
    if (!open) {
      return
    }

    menuRef.current?.focus()
  }, [open])

  useAppPopupDismiss({
    open,
    onDismiss: closeMenu,
    hostRef: rootRef,
    popupRef: menuRef,
    returnFocusRef: triggerRef,
  })

  const menu = (
        <AnchoredAppPopup
          visible={menuVisible}
          anchorRef={triggerRef}
          popupRef={menuRef}
          maxHeight={430}
          className={`co-skill-select__menu co-set-dropdown__menu ${actVar} ${actTextModeC}${ui.blurMode ? ' blur-off' : ''}`}
          open={open}
          closing={closing}
          tabIndex={-1}
          role="listbox"
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              closeMenu()
            }
          }}
        >
          <div className={`co-set-dropdown__cmds${showBulkCommands ? '' : ' co-set-dropdown__cmds--single'}`} aria-label="Allowed set commands">
            <button
              type="button"
              className={`co-set-dropdown__cmd${isReset ? ' is-active' : ''}`}
              onClick={() => {
                applyChange({1: [], 3: [], 5: [] })
                if (shouldCloseOnSelect) {
                  closeMenu()
                }
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              Any
            </button>
            {showBulkCommands ? (
              <>
                <button
                  type="button" className="co-set-dropdown__cmd"
                  onClick={setAll}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  All
                </button>
                <button
                  type="button" className="co-set-dropdown__cmd"
                  onClick={invertAll}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  Invert
                </button>
              </>
            ) : null}
          </div>

          <div className="co-set-dropdown__board"
            style={{ '--set-group-count': visibleGroupCount } as CSSProperties}
          >
            {visibleOptionGroups.map((group) => (
              <section key={group.pieceCount} className="co-set-dropdown__col">
                <header className="co-set-dropdown__col-head">
                  <span>{group.label}</span>
                  <span className="co-set-dropdown__group-actions">
                      <span className="co-set-dropdown__group-count">
                        {effectiveSelIdsByPc[group.pieceCount].length}/{group.options.length}
                      </span>
                    {effectiveSelIdsByPc[group.pieceCount].length > 0 ? (
                      <button
                        type="button"
                        aria-label={`Clear ${group.label}`}
                        onClick={() => clearPc(group.pieceCount)}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <X size="0.625rem" />
                      </button>
                    ) : null}
                    </span>
                </header>
                <div className="co-set-dropdown__stack">
                  {group.options.map((set) => {
                    const selected = effectiveSelIdsByPc[group.pieceCount].includes(set.id)
                    return (
                      <button
                        key={`${group.pieceCount}-${set.id}`}
                        type="button"
                        className={`co-set-dropdown__tile${selected ? ' selected is-active' : ''}`}
                        onClick={() => {
                          if (selectionMode === 'single') {
                            applyChange({
                              1: [],
                              3: [],
                              5: [],
                              [group.pieceCount]: selected ? [] : [set.id],
                            })
                          } else {
                            const current = effectiveSelIdsByPc[group.pieceCount]
                            const next = selected
                              ? current.filter((id) => id !== set.id)
                              : [...current, set.id].sort((left, right) => left - right)
                            applyChange({
                              ...effectiveSelIdsByPc,
                              [group.pieceCount]: next,
                            })
                          }
                          if (shouldCloseOnSelect) {
                            closeMenu()
                          }
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                          <span className="co-set-dropdown__tile-icon" aria-hidden="true">
                            <img src={set.icon} alt="" className="co-set-dropdown__icon" onError={withDefIconM} />
                          </span>
                        <span className="co-set-dropdown__tile-name">{set.name}</span>
                        <span className="co-set-dropdown__tile-dot" aria-hidden="true" />
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

        </AnchoredAppPopup>
  )

  return (
    <div ref={rootRef} className={`co-set-dropdown${liquidTrigger ? ' liquid-select' : ''}${open ? ` is-open${liquidTrigger ? ' open' : ''}` : ''}${closing ? ' closing' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`${liquidTrigger ? 'liquid-select__trigger' : 'co-chip'} co-set-dropdown__trigger${triggerClass ? ` ${triggerClass}` : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (open) {
            closeMenu()
          } else {
            openMenu()
          }
        }}
      >
        {renderTrigger ? (
          renderTrigger({ summaryLabel, open })
        ) : liquidTrigger ? (
          <>
            <span className={`liquid-select__value${selectedTotal === 0 ? ' liquid-select__value--placeholder' : ''}`}>{summaryLabel}</span>
            <span className="liquid-select__icon">
              <ChevronDown size="0.875rem" />
            </span>
          </>
        ) : (
          <>
            <span className="co-set-dropdown__trigger-value">{summaryLabel}</span>
            <ChevronDown size="0.75rem" />
          </>
        )}
      </button>
      {menu}
    </div>
  )
}
