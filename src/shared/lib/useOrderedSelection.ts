/*
  Author: Runor Ewhro
  Description: Manages ordered multi-selection with command-click, shift-range,
               select-all, and keyboard action helpers for Simulation surfaces.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as RctKybrVnt,
  MouseEvent as RctMsVnt,
} from 'react'
import { isDtblVntTgt } from '@/shared/lib/isEditableEventTarget.ts'
import { collectRange } from '@/shared/lib/selectionRange.ts'

type RdrdSelId = string | number

interface RdrdSelStt<TId extends RdrdSelId> {
  orderedIds: TId[]
}

interface RdrdSelClckP {
  active?: boolean
  onCapture?: () => void
  shouldIgnore?: (event: RctMsVnt<HTMLElement>) => boolean
}

interface RdrdSelKeyDo<TId extends RdrdSelId> {
  active?: boolean
  /**
   * What the surface tracks outside selection mode, usually the one entry it
   * has open. The clipboard shortcuts fall back to it so a row that is simply
   * picked answers the same keys a selected one does. Ids the surface does not
   * offer for selection are dropped, which is what keeps an uneditable entry
   * out of reach of them.
   */
  trackedIds?: readonly TId[]
  onCopy?: (ids: readonly TId[]) => void
  onCut?: (ids: readonly TId[]) => void
  onPaste?: (ids: readonly TId[]) => void
  onDelete?: (ids: readonly TId[]) => void
}

interface UseRdrdSelAr<TId extends RdrdSelId> {
  active?: boolean
  orderedIds: readonly TId[]
  availableIds?: readonly TId[]
  selectAllIds?: readonly TId[]
}

/**
 * The ids a clipboard shortcut acts on.
 *
 * Selection mode acts on what was picked. Outside it the surface's own tracked
 * entry stands in, narrowed to ids the surface offers for selection: that is
 * what keeps a row it will not let you pick out of reach of the keys.
 */
export function shortcutTargetIds<TId extends RdrdSelId>(
  selectMode: boolean,
  selectedIds: readonly TId[],
  trackedIds: readonly TId[] | undefined,
  validIds: ReadonlySet<TId>,
): readonly TId[] {
  if (selectMode) {
    return selectedIds
  }

  return (trackedIds ?? []).filter((id) => validIds.has(id))
}

function areIdRrysQl<TId extends RdrdSelId>(left: readonly TId[], right: readonly TId[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function ppndNewIdsIn<TId extends RdrdSelId>(
  previousIds: readonly TId[],
  nextIds: readonly TId[],
): TId[] {
  // range-add should preserve existing selection order while appending only
  // ids that were not already selected.
  if (nextIds.length === 0) {
    return [...previousIds]
  }

  const seen = new Set(previousIds)
  const merged = [...previousIds]

  for (const id of nextIds) {
    if (seen.has(id)) {
      continue
    }

    seen.add(id)
    merged.push(id)
  }

  return merged
}

export function useRdrdSel<TId extends RdrdSelId>({
  active = true,
  orderedIds,
  availableIds,
  selectAllIds,
}: UseRdrdSelAr<TId>) {
  const anchorIdRef = useRef<TId | null>(null)
  const [selectMode, setSlctMode] = useState(false)
  const [state, setState] = useState<RdrdSelStt<TId>>({
    orderedIds: [],
  })

  const vlblSelIds = availableIds ?? orderedIds
  const validIdSet = useMemo(
    () => new Set<TId>(vlblSelIds),
    [vlblSelIds],
  )
  const selectedIds = state.orderedIds
  const selIdSet = useMemo(
    () => new Set<TId>(selectedIds),
    [selectedIds],
  )
  const selCnt = selectedIds.length
  const hasSelection = selCnt > 0

  const clrSel = useCallback(() => {
    anchorIdRef.current = null
    setState((previous) => (
      previous.orderedIds.length === 0
        ? previous
        : { orderedIds: [] }
    ))
  }, [])

  const exitSelMode = useCallback(() => {
    setSlctMode(false)
    clrSel()
  }, [clrSel])

  const ntrSelMode = useCallback(() => {
    setSlctMode(true)
  }, [])

  const setSelIdsInR = useCallback((updater: (previousIds: TId[]) => TId[]) => {
    setState((previous) => {
      const nextIds = updater(previous.orderedIds)
      return areIdRrysQl(previous.orderedIds, nextIds)
        ? previous
        : { orderedIds: nextIds }
    })
  }, [])

  const addToSel = useCallback((id: TId) => {
    if (!validIdSet.has(id)) {
      return
    }

    setSlctMode(true)
    anchorIdRef.current = id
    setSelIdsInR((previousIds) => (
      previousIds.includes(id) ? previousIds : [...previousIds, id]
    ))
  }, [validIdSet, setSelIdsInR])

  const tglSel = useCallback((id: TId) => {
    if (!validIdSet.has(id)) {
      return
    }

    setSlctMode(true)
    anchorIdRef.current = id
    setSelIdsInR((previousIds) => (
      previousIds.includes(id)
        ? previousIds.filter((selectedId) => selectedId !== id)
        : [...previousIds, id]
    ))
  }, [validIdSet, setSelIdsInR])

  const addRngToSel = useCallback((targetId: TId) => {
    if (!validIdSet.has(targetId)) {
      return
    }

    setSlctMode(true)
    // build ranges against the canonical ordered ids, then filter against the
    // currently selectable subset so hidden or disabled entries are skipped.
    const rangeIds = collectRange(orderedIds, anchorIdRef.current, targetId)
      .filter((id) => validIdSet.has(id))
    anchorIdRef.current = targetId
    setSelIdsInR((previousIds) => ppndNewIdsIn(previousIds, rangeIds))
  }, [validIdSet, orderedIds, setSelIdsInR])

  const selectAll = useCallback(() => {
    setSlctMode(true)
    const bulkIds = selectAllIds ?? orderedIds
    anchorIdRef.current = bulkIds.at(-1) ?? null
    setState((previous) => {
      const nextIds = bulkIds.filter((id) => validIdSet.has(id))
      return areIdRrysQl(previous.orderedIds, nextIds)
        ? previous
        : { orderedIds: nextIds }
    })
  }, [orderedIds, selectAllIds, validIdSet])

  const deselectAll = useCallback(() => {
    setSlctMode(true)
    clrSel()
  }, [clrSel])

  useEffect(() => {
    // whenever the available set shrinks, trim dead selections and anchors so
    // follow-up copy/delete actions cannot target stale ids.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ordered selection must synchronously prune ids removed by the caller.
    setSelIdsInR((previousIds) => previousIds.filter((id) => validIdSet.has(id)))

    if (anchorIdRef.current != null && !validIdSet.has(anchorIdRef.current)) {
      anchorIdRef.current = null
    }
  }, [validIdSet, setSelIdsInR])

  const makeClickCap = useCallback((id: TId, {
    active: clickActive = active,
    onCapture,
    shouldIgnore,
  }: RdrdSelClckP = {}) => (
    (event: RctMsVnt<HTMLElement>) => {
      if (!clickActive || event.defaultPrevented || shouldIgnore?.(event)) {
        return
      }

      const commandKey = event.metaKey || event.ctrlKey

      if (event.shiftKey) {
        // shift-click always extends from the current anchor, even before
        // selection mode has otherwise been entered.
        event.preventDefault()
        event.stopPropagation()
        onCapture?.()
        addRngToSel(id)
        return
      }

      if (selectMode) {
        // once selection mode is active, plain clicks toggle items instead of
        // triggering the surface's normal primary action.
        event.preventDefault()
        event.stopPropagation()
        onCapture?.()
        tglSel(id)
        return
      }

      if (!commandKey) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onCapture?.()
      addToSel(id)
    }
  ), [active, addRngToSel, addToSel, selectMode, tglSel])

  const onKeyDown = useCallback((
    event: RctKybrVnt<HTMLElement>,
    {
      active: kybrAct = active,
      trackedIds,
      onCopy,
      onCut,
      onPaste,
      onDelete,
    }: RdrdSelKeyDo<TId> = {},
  ): boolean => {
    if (!kybrAct || isDtblVntTgt(event.target)) {
      return false
    }

    if (selectMode && event.key === 'Escape') {
      event.preventDefault()
      exitSelMode()
      return true
    }

    const commandKey = event.metaKey || event.ctrlKey
    const lowerKey = event.key.toLowerCase()
    const targetIds = shortcutTargetIds(selectMode, selectedIds, trackedIds, validIdSet)
    const hasTarget = targetIds.length > 0
    // a real text selection keeps its native copy: only a bare caret hands
    // the clipboard keys to the tracked row.
    const takesClipboard = hasTarget
      && (selectMode || (globalThis.getSelection?.()?.isCollapsed ?? true))

    if (commandKey && lowerKey === 'a') {
      event.preventDefault()
      if (event.shiftKey) {
        deselectAll()
        return true
      }

      selectAll()
      return true
    }

    if (commandKey && lowerKey === 'c' && takesClipboard && onCopy) {
      event.preventDefault()
      onCopy(targetIds)
      return true
    }

    if (commandKey && lowerKey === 'x' && takesClipboard && onCut) {
      event.preventDefault()
      onCut(targetIds)
      return true
    }

    if (commandKey && lowerKey === 'v' && onPaste) {
      event.preventDefault()
      onPaste(targetIds)
      return true
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && hasTarget && onDelete) {
      event.preventDefault()
      onDelete(targetIds)
      return true
    }

    return false
  }, [active, deselectAll, exitSelMode, selectAll, selectMode, selectedIds, validIdSet])

  const isSelected = useCallback((id: TId) => selIdSet.has(id), [selIdSet])

  return {
    selectionMode: selectMode,
    selectedCount: selCnt,
    hasSelection,
    selectedIdSet: selIdSet,
    selectedIdsInOrder: selectedIds,
    isSelected,
    enterSelectionMode: ntrSelMode,
    exitSelectionMode: exitSelMode,
    addToSelection: addToSel,
    toggleSelection: tglSel,
    addRangeToSelection: addRngToSel,
    selectAll,
    deselectAll,
    buildClickCapture: makeClickCap,
    handleKeyDown: onKeyDown,
  }
}
