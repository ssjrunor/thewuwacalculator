/*
  Author: Runor Ewhro
  Description: Owns sel behavior and state transitions for the lib module.
*/

import { useCallback, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as RctKybrVnt, MouseEvent as RctMsVnt, ReactNode, RefCallback } from 'react'
import { useRdrdSel } from '@/shared/lib/useOrderedSelection.ts'
import { useFltnSelCt } from '@/shared/ui/FloatingSelectionActions'

type SelId = string | number

export interface SelItem<TId extends SelId, TVal> {
  id: TId
  val?: TVal
}

export interface SelCtx<TId extends SelId, TVal> {
  ids: TId[]
  vals: TVal[]
  count: number
  has: boolean
  mode: boolean
}

export interface SelAct<TId extends SelId, TVal> {
  id: string
  label: ReactNode | ((ctx: SelCtx<TId, TVal>) => ReactNode)
  icon?: ReactNode
  title?: string | ((ctx: SelCtx<TId, TVal>) => string | undefined)
  danger?: boolean
  dis?: boolean | ((ctx: SelCtx<TId, TVal>) => boolean)
  key?: 'copy' | 'cut' | 'paste' | 'delete'
  needsSel?: boolean
  float?: boolean
  run: (ctx: SelCtx<TId, TVal>) => void | Promise<void>
}

interface UseSelArgs<TId extends SelId, TVal> {
  active?: boolean
  surfaceId: string
  ariaLabel: string
  /** what the floating rail's readout calls the things being picked */
  noun?: { one: string; many: string }
  items: Array<SelItem<TId, TVal>>
  ord?: readonly TId[]
  av?: readonly TId[]
  allIds?: readonly TId[]
  /** what the surface has open outside selection mode; see `RdrdSelKeyDo` */
  tracked?: readonly TId[]
  pri?: number
  acts?: Array<SelAct<TId, TVal>>
  bar?: boolean
}

let nextSelCtvtI = 0

function pick<TId extends SelId, TVal>(
  act: SelAct<TId, TVal>,
  ctx: SelCtx<TId, TVal>,
) {
  return typeof act.label === 'function' ? act.label(ctx) : act.label
}

function title<TId extends SelId, TVal>(
  act: SelAct<TId, TVal>,
  ctx: SelCtx<TId, TVal>,
) {
  return typeof act.title === 'function' ? act.title(ctx) : act.title
}

function dis<TId extends SelId, TVal>(
  act: SelAct<TId, TVal>,
  ctx: SelCtx<TId, TVal>,
) {

  // buttons and keyboard shortcuts agree on availability.
  if (act.needsSel && !ctx.has) {
    return true
  }

  return typeof act.dis === 'function' ? act.dis(ctx) : Boolean(act.dis)
}

const ANY_NOUN = { one: 'item', many: 'items' }

export function useSel<TId extends SelId, TVal>({
  active = true,
  surfaceId,
  ariaLabel,
  noun = ANY_NOUN,
  items,
  ord,
  av,
  allIds,
  tracked,
  pri = 18,
  acts = [],
  bar = true,
}: UseSelArgs<TId, TVal>) {
  const elRef = useRef<HTMLElement | null>(null)
  const [scopeEl, setScopeEl] = useState<HTMLElement | null>(null)
  const [activationId, setCtvtId] = useState(0)
  const fllbOrdIds = useMemo(
    () => items.map((item) => item.id),
    [items],
  )
  // ordered selection needs a stable visible order; callers can provide one for virtualized or transformed lists, and
  // otherwise the current item array becomes the selection order.
  const ordIds = ord ?? fllbOrdIds
  const sel = useRdrdSel({
    active,
    orderedIds: ordIds,
    availableIds: av,
    selectAllIds: allIds,
  })

  const valsById = useMemo(
    () => new Map(items.map((item) => [item.id, item.val])),
    [items],
  )

  const vals = useMemo(
    () => sel.selectedIdsInOrder
      .map((id) => valsById.get(id))
      .filter((val): val is TVal => val !== undefined),
    [sel.selectedIdsInOrder, valsById],
  )
  const ctx = useMemo<SelCtx<TId, TVal>>(() => ({
    ids: [...sel.selectedIdsInOrder],
    vals,
    count: sel.selectedIdsInOrder.length,
    has: sel.hasSelection,
    mode: sel.selectionMode,
  }), [sel.hasSelection, sel.selectedIdsInOrder, sel.selectionMode, vals])

  // the same context over a caller-named set of ids, for a run that acts on
  // something other than the current selection.
  const ctxFor = useCallback((ids: readonly TId[]): SelCtx<TId, TVal> => ({
    ids: [...ids],
    vals: ids
      .map((id) => valsById.get(id))
      .filter((val): val is TVal => val !== undefined),
    count: ids.length,
    has: ids.length > 0,
    mode: sel.selectionMode,
  }), [sel.selectionMode, valsById])

  const markActive = useCallback(() => {

    nextSelCtvtI += 1
    setCtvtId(nextSelCtvtI)
  }, [])

  const focus = useCallback(() => {
    markActive()
    window.requestAnimationFrame(() => {
      elRef.current?.focus()
    })
  }, [markActive])

  const ntrSelMode = useCallback(() => {
    markActive()
    sel.enterSelectionMode()
  }, [markActive, sel])

  const exitSelMode = useCallback(() => {
    sel.exitSelectionMode()
  }, [sel])

  const addToSel = useCallback((id: TId) => {
    markActive()
    sel.addToSelection(id)
  }, [markActive, sel])

  const tglSel = useCallback((id: TId) => {
    markActive()
    sel.toggleSelection(id)
  }, [markActive, sel])

  const addRngToSel = useCallback((id: TId) => {
    markActive()
    sel.addRangeToSelection(id)
  }, [markActive, sel])

  const selectAll = useCallback(() => {
    markActive()
    sel.selectAll()
  }, [markActive, sel])

  const deselectAll = useCallback(() => {
    markActive()
    sel.deselectAll()
  }, [markActive, sel])

  const exec = useCallback((act: SelAct<TId, TVal>, ids?: readonly TId[]) => {
    const runCtx = ids ? ctxFor(ids) : ctx
    if (dis(act, runCtx)) {
      return
    }

    void act.run(runCtx)
  }, [ctx, ctxFor])

  const keyAct = useCallback((key: SelAct<TId, TVal>['key']) => (
    acts.find((act) => act.key === key) ?? null
  ), [acts])

  const floatActs = useMemo(

    // delete act directly on the current selection.
    () => acts.filter((act) => act.float ?? act.key !== 'paste'),
    [acts],
  )

  const floatSess = useMemo(() => (

    // types or action predicates.
    bar && active && sel.selectionMode
      ? {
          active: true,
          ariaLabel,
          readout: { count: ctx.count, one: noun.one, many: noun.many },
          activationId,
          priority: pri,
          focusScopeId: surfaceId,
          focusScopeEl: scopeEl,
          onRqstExit: exitSelMode,
          groups: [
            floatActs.length > 0
              ? floatActs.map((act) => ({
                  id: act.id,
                  label: pick(act, ctx),
                  icon: act.icon,
                  title: title(act, ctx),
                  disabled: dis(act, ctx),
                  danger: act.danger,
                  onSelect: () => exec(act),
                }))
              : [],
            [
              {
                id: `${surfaceId}:all`,
                label: 'Select all',
                title: 'Select all visible items (Ctrl/Cmd+A)',
                onSelect: selectAll,
              },
              {
                id: `${surfaceId}:none`,
                label: 'Deselect all',
                title: 'Deselect all items (Shift+Ctrl/Cmd+A)',
                onSelect: deselectAll,
              },
              {
                id: `${surfaceId}:exit`,
                label: 'Exit',
                title: 'Exit selection mode (Esc)',
                onSelect: exitSelMode,
              },
            ],
          ],
        }
      : null
  ), [
    active,
    activationId,
    ariaLabel,
    bar,
    ctx,
    deselectAll,
    exec,
    noun,
    exitSelMode,
    floatActs,
    pri,
    scopeEl,
    sel.selectionMode,
    selectAll,
    surfaceId,
  ])

  useFltnSelCt(floatSess)

  const ref: RefCallback<HTMLElement> = useCallback((el) => {
    elRef.current = el
  }, [])

  const scopeRef: RefCallback<HTMLElement> = useCallback((el) => {
    setScopeEl(el)
  }, [])

  const surfaceRef: RefCallback<HTMLElement> = useCallback((el) => {
    elRef.current = el
    setScopeEl(el)
  }, [])

  const onKeyDown = useCallback((event: RctKybrVnt<HTMLElement>) => {
    const copy = keyAct('copy')
    const cut = keyAct('cut')
    const paste = keyAct('paste')
    const del = keyAct('delete')

    // defer shortcut interpretation to the ordered-selection hook, then mark this surface active only when it consumed
    // the event.
    const handled = sel.handleKeyDown(event, {
      active,
      trackedIds: tracked,
      onCopy: copy ? (ids) => exec(copy, ids) : undefined,
      onCut: cut ? (ids) => exec(cut, ids) : undefined,
      onPaste: paste ? (ids) => exec(paste, ids) : undefined,
      onDelete: del ? (ids) => exec(del, ids) : undefined,
    })

    if (handled) {
      markActive()
    }
  }, [active, exec, keyAct, markActive, sel, tracked])

  const makeClickCap = useCallback((
    id: TId,
    opts: {
      active?: boolean
      onCapture?: () => void
      shouldIgnore?: (event: RctMsVnt<HTMLElement>) => boolean
    } = {},
  ) => sel.buildClickCapture(id, {
    // click capture focuses the owning surface before selection changes so keyboard follow-ups target the same pane.
    active: opts.active ?? active,
    shouldIgnore: opts.shouldIgnore,
    onCapture: () => {
      focus()
      opts.onCapture?.()
    },
  }), [active, focus, sel])

  return {
    selectionMode: sel.selectionMode,
    selectedCount: ctx.count,
    hasSelection: ctx.has,
    hasPendingSelection: ctx.has,
    selectedIdsInOrder: ctx.ids,
    selectedIdSet: sel.selectedIdSet,
    selectedVals: ctx.vals,
    isSelected: sel.isSelected,
    focusSurface: focus,
    enterSelectionMode: ntrSelMode,
    exitSelectionMode: exitSelMode,
    addToSelection: addToSel,
    toggleSelection: tglSel,
    addRangeToSelection: addRngToSel,
    selectAll,
    deselectAll,
    buildClickCapture: makeClickCap,
    handleKeyDown: onKeyDown,
    focusProps: {
      ref,
      tabIndex: 0,
      onKeyDown: onKeyDown,
    },
    scopeProps: {
      ref: scopeRef,
      'data-selection-focus-scope': surfaceId,
      'data-selection-focus-active': active && sel.selectionMode ? 'true' : undefined,
      'data-selection-mode-active': active && sel.selectionMode ? 'true' : undefined,
    },
    surfaceProps: {
      ref: surfaceRef,
      tabIndex: 0,
      'data-selection-focus-scope': surfaceId,
      'data-selection-focus-active': active && sel.selectionMode ? 'true' : undefined,
      'data-selection-mode-active': active && sel.selectionMode ? 'true' : undefined,
      onKeyDown: onKeyDown,
    },
  }
}
