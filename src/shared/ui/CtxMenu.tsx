/*
  Author: Runor Ewhro
  Description: Owns ctx menu behavior and state transitions for the ui module.
               Every level is a rail: a row of wells with a readout at its end,
               or a stacked column when the entries are too long to sweep.
*/

import type {
  CSSProperties as CssProps,
  KeyboardEvent as RctKbdVnt,
  MouseEvent as RctMsVnt,
  ReactNode,
} from 'react'
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility'
import { bodyPortal } from '@/shared/lib/portalTarget'
import { AppPopupSurface, syncAppPopupTokens } from '@/shared/ui/AppPopup'

const DEFVWPRPDDN = 12
const RAILGAP = 9
const MENUEXITDURM = 190
const HVRCLSDLYMS = 180
const COLBDGTPX = 432
const HVRARMMS = 90
const RAILSTEPPX = 46

export interface CtxOpenEvent {
  clientX: number
  clientY: number
  target: EventTarget | null
  preventDefault: () => void
  stopPropagation: () => void
}

type CtxOpenInput = CtxOpenEvent | MouseEvent | RctMsVnt<Element>

export interface CtxOptions {
  preventDefault?: boolean
  stopPropagation?: boolean
}

interface CtxState<TData> {
  clientX: number
  clientY: number
  data: TData | null
  eventTarget: EventTarget | null
}

export interface CtxCtrl<TData = unknown> {
  isOpen: boolean
  open: boolean
  closing: boolean
  data: TData | null
  eventTarget: EventTarget | null
  clientX: number
  clientY: number
  show: (event: CtxOpenInput, data?: TData, options?: CtxOptions) => void
  close: () => void
}

export interface CtxSelect<TData = unknown> {
  data: TData | null
  eventTarget: EventTarget | null
  clientX: number
  clientY: number
  close: () => void
}

export interface MenuItem<TData = unknown> {
  type?: 'item'
  id: string
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  /* a full-bleed image for the well, used where the entry has art of its own:
     resonator portraits, echo icons, sonata glyphs. */
  art?: string
  preview?: ReactNode | ((context: CtxSelect<TData>) => ReactNode)
  disabled?: boolean
  danger?: boolean
  submenu?:
    | MenuEntry<TData>[]
    | ((context: CtxSelect<TData>) => MenuEntry<TData>[])
  onSelect?: (context: CtxSelect<TData>) => void
}

export interface CtxSeparator {
  type: 'separator'
  id?: string
}

export type MenuEntry<TData = unknown> =
  | MenuItem<TData>
  | CtxSeparator

export interface CtxProps<TData = unknown> {
  controller: CtxCtrl<TData>
  items:
    | MenuEntry<TData>[]
    | ((context: CtxSelect<TData>) => MenuEntry<TData>[])
  portalTarget?: HTMLElement | null
  /* kept for call-site compatibility; a rail sizes to its own content and only
     uses this as the minimum width of a stacked one. */
  width?: number
  vwprPddn?: number
  className?: string
  ariaLabel?: string
}

type RailKind = 'art' | 'icon' | 'text'
type GrowDir = 'up' | 'down'
type AnyItem = MenuItem<unknown>
type AnyEntry = MenuEntry<unknown>

interface RailPlace {
  left: number
  top: number
  stem: StemPlace | null
}

interface StemPlace {
  axis: 'x' | 'y'
  dir: 'start' | 'end'
  left: number
  top: number
  length: number
}

interface CtxLevel {
  entries: AnyEntry[]
  label: string
  preview: ReactNode | null
}

export function useCtxMenu<TData = unknown>(): CtxCtrl<TData> {
  const [state, setState] = useState<CtxState<TData> | null>(null)
  const visibility = useAnimatedVisibility(MENUEXITDURM)

  const close = useCallback(() => {
    visibility.hide(() => {
      setState(null)
    })
  }, [visibility])

  const show = useCallback(
    (
      event: CtxOpenInput,
      data?: TData,
      { preventDefault = true, stopPropagation = true }: CtxOptions = {},
    ) => {
      if (preventDefault) {
        event.preventDefault()
      }

      if (stopPropagation) {
        event.stopPropagation()
      }

      // Snapshot coordinates and target so handlers never retain SyntheticEvent.
      setState({
        clientX: event.clientX,
        clientY: event.clientY,
        data: data ?? null,
        eventTarget: event.target,
      })

      visibility.show()
    },
    [visibility],
  )

  return {
    isOpen: visibility.visible,
    open: visibility.open,
    closing: visibility.closing,
    data: state?.data ?? null,
    eventTarget: state?.eventTarget ?? null,
    clientX: state?.clientX ?? 0,
    clientY: state?.clientY ?? 0,
    show,
    close,
  }
}

function isItem(entry: AnyEntry): entry is AnyItem {
  return entry.type !== 'separator'
}

function onlyItems(entries: AnyEntry[]): AnyItem[] {
  return entries.filter(isItem)
}

function mkEntGrps(entries: AnyEntry[]): AnyItem[][] {
  const groups: AnyItem[][] = []
  let current: AnyItem[] = []

  for (const entry of entries) {
    if (!isItem(entry)) {
      if (current.length > 0) {
        groups.push(current)
        current = []
      }
      continue
    }

    current.push(entry)
  }

  if (current.length > 0) {
    groups.push(current)
  }

  return groups
}

/* A rail sweeps as bare wells only when every entry can be told apart without a
   word. Anything short of that shows labels, and stacks if it then runs long. */
function getRailKind(items: AnyItem[]): RailKind {
  if (items.length === 0) return 'text'
  if (items.every((item) => Boolean(item.art))) return 'art'
  if (items.every((item) => Boolean(item.icon))) return 'icon'
  return 'text'
}

/* Roughly how wide this rail would be lying across, in px. Deciding from the
   content rather than a measured pass means a rail is born in the right
   orientation instead of being laid out twice. */
function estRailWidth(items: AnyItem[], readPx: number): number {
  return items.reduce((total, item) => {
    const text = labelText(item.label) ?? ''
    const cell = clampTo(text.length * 6.6 + 20, 54, 152)
    return total + cell
  }, 0) + readPx
}

function isItemDsbld(item: AnyItem): boolean {
  return Boolean(item.disabled) || (!item.onSelect && !item.submenu && !item.preview)
}

function isItemBrnch(item: AnyItem): boolean {
  return Boolean(item.submenu || item.preview)
}

function maxTreeDepth(entries: AnyEntry[], guard = 0): number {
  if (guard > 6) return guard

  let deepest = 1

  for (const entry of entries) {
    if (!isItem(entry) || !Array.isArray(entry.submenu)) continue
    deepest = Math.max(deepest, 1 + maxTreeDepth(entry.submenu, guard + 1))
  }

  return deepest
}

function clampTo(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function labelText(label: ReactNode): string | undefined {
  return typeof label === 'string' ? label : undefined
}

function readTail(item: AnyItem): ReactNode {
  if (item.hint) return item.hint
  if (Array.isArray(item.submenu)) return `${onlyItems(item.submenu).length} options`
  if (item.submenu) return 'more'
  if (item.preview) return 'preview'
  if (item.danger) return 'destructive'
  return 'select'
}

interface CtxRailProps {
  entries: AnyEntry[]
  preview: ReactNode | null
  label: string
  level: number
  openId: string | null
  minWidth: number
  className: string
  ariaLabel: string
  stateAttrs: Record<string, string | undefined>
  place: (level: number, element: HTMLDivElement, col: boolean) => RailPlace
  onRegister: (level: number, element: HTMLDivElement | null) => void
  onHoverItem: (level: number, item: AnyItem, element: HTMLButtonElement) => void
  onLeaveRail: (level: number) => void
  onSelectItem: (item: AnyItem) => void
  onKeyDown: (level: number, col: boolean, event: RctKbdVnt<HTMLDivElement>) => void
}

function CtxRail({
  entries,
  preview,
  label,
  level,
  openId,
  minWidth,
  className,
  ariaLabel,
  stateAttrs,
  place,
  onRegister,
  onHoverItem,
  onLeaveRail,
  onSelectItem,
  onKeyDown,
}: CtxRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const stemRef = useRef<HTMLSpanElement | null>(null)
  const [hotId, setHotId] = useState<string | null>(null)

  const groups = useMemo(() => mkEntGrps(entries), [entries])
  const items = useMemo(() => onlyItems(entries), [entries])
  const kind = useMemo(() => getRailKind(items), [items])

  /* Only a rail of bare words can outrun a sweep: art and icon wells stay
     compact however many there are, so they never stand up. */
  const col = useMemo(() => {
    if (preview || kind !== 'text') return false

    const budget = Math.min(window.innerWidth - DEFVWPRPDDN * 2, COLBDGTPX)
    return estRailWidth(items, 138) > budget
  }, [items, kind, preview])

  /* Position is geometry, not render state: the rail is measured and moved in
     the same layout pass, before the browser paints it. */
  useLayoutEffect(() => {
    const element = railRef.current
    if (!element) return

    const spot = place(level, element, col)

    element.style.left = `${spot.left}px`
    element.style.top = `${spot.top}px`
    element.dataset.placed = 'true'

    const stemEl = stemRef.current
    if (!stemEl) return

    if (!spot.stem) {
      stemEl.hidden = true
      return
    }

    stemEl.hidden = false
    stemEl.dataset.axis = spot.stem.axis
    stemEl.dataset.dir = spot.stem.dir
    stemEl.style.left = `${spot.stem.left}px`
    stemEl.style.top = `${spot.stem.top}px`
    stemEl.style.height = spot.stem.axis === 'y' ? `${spot.stem.length}px` : ''
    stemEl.style.width = spot.stem.axis === 'x' ? `${spot.stem.length}px` : ''
  }, [col, level, place, entries])

  useEffect(() => {
    onRegister(level, railRef.current)
    return () => onRegister(level, null)
  }, [level, onRegister])

  const readItem = items.find((item) => item.id === (hotId ?? openId)) ?? null

  const style: CssProps = col ? { minWidth: `${minWidth}px` } : {}

  return (
    <>
      {level > 0 ? (
        <span
          ref={stemRef} className="floating-context-menu__stem"
          {...stateAttrs}
          hidden
          aria-hidden="true"
        />
      ) : null}

    <AppPopupSurface
      ref={railRef}
      className={`floating-context-menu ${preview ? 'floating-context-menu--preview' : ''} ${className}`.trim()}
      open={stateAttrs['data-open'] === 'true'}
      closing={stateAttrs['data-closing'] === 'true'}
      style={style}
      role={preview ? 'presentation' : 'menu'}
      aria-label={preview ? undefined : ariaLabel}
      aria-hidden={preview ? 'true' : undefined}
      tabIndex={preview ? undefined : -1}
      data-level={level}
      data-col={col ? 'true' : undefined}
      data-kind={kind}
      {...stateAttrs}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onMouseLeave={() => {
        setHotId(null)
        onLeaveRail(level)
      }}
      onKeyDown={(event) => {
        if (!preview) onKeyDown(level, col, event)
      }}
    >
      {preview ? (
        <div className="floating-context-menu__preview">{preview}</div>
      ) : (
        <>
          <div className="floating-context-menu__cells">
            {groups.map((group, groupIndex) => (
              <Fragment key={`grp:${level}:${groupIndex}`}>
                {groupIndex > 0 && !col ? (
                  <span className="floating-context-menu__gap" aria-hidden="true" />
                ) : null}
                {group.map((item, itemIndex) => {
                  const disabled = isItemDsbld(item)
                  const branching = isItemBrnch(item)

                  return (
                    <button
                      key={item.id}
                      type="button" className="floating-context-menu__item"
                      role="menuitem"
                      data-id={item.id}
                      disabled={disabled}
                      data-danger={item.danger ? 'true' : undefined}
                      data-hot={hotId === item.id ? 'true' : undefined}
                      data-open={openId === item.id ? 'true' : undefined}
                      data-branch={branching ? 'true' : undefined}
                      aria-haspopup={item.submenu ? 'menu' : undefined}
                      aria-expanded={item.submenu ? openId === item.id : undefined}
                      aria-label={col || kind === 'text' ? undefined : labelText(item.label)}
                      style={{ '--well-index': itemIndex } as CssProps}
                      onMouseEnter={(event) => {
                        setHotId(item.id)
                        onHoverItem(level, item, event.currentTarget)
                      }}
                      onFocus={(event) => {
                        setHotId(item.id)
                        onHoverItem(level, item, event.currentTarget)
                      }}
                      onClick={() => onSelectItem(item)}
                    >
                      {item.art ? (
                        <span className="floating-context-menu__art" aria-hidden="true">
                          <img src={item.art} alt="" loading="lazy" />
                        </span>
                      ) : null}

                      {item.icon && !item.art ? (
                        <span className="floating-context-menu__icon">{item.icon}</span>
                      ) : null}

                      {col || kind === 'text' ? (
                        <span className="floating-context-menu__label">{item.label}</span>
                      ) : null}

                      {col && item.hint ? (
                        <span className="floating-context-menu__hint">{item.hint}</span>
                      ) : null}

                      {col && item.submenu ? (
                        <i className="floating-context-menu__chevron" aria-hidden="true" />
                      ) : null}

                      {!col && branching ? (
                        <span className="floating-context-menu__dot" aria-hidden="true" />
                      ) : null}
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </div>

          <div className="floating-context-menu__read"
            data-idle={col || !readItem ? 'true' : undefined}
            data-danger={!col && readItem?.danger ? 'true' : undefined}
            aria-hidden="true"
          >
            {col ? (
              <>
                <b>{label}</b>
                <em>{items.length}</em>
              </>
            ) : readItem ? (
              <>
                <b>{readItem.label}</b>
                <em>{readTail(readItem)}</em>
              </>
            ) : (
              <b>{label}</b>
            )}
          </div>
        </>
      )}
    </AppPopupSurface>
    </>
  )
}

function CtxTree<TData>({
  controller,
  items,
  width = 178,
  vwprPddn = DEFVWPRPDDN,
  className = '',
  ariaLabel = 'Context menu',
  portalTarget: rslvPrtlTgt,
}: Omit<CtxProps<TData>, 'portalTarget'> & { portalTarget: HTMLElement }) {
  const [path, setPath] = useState<string[]>([])

  const growRef = useRef<GrowDir>('down')
  const railsRef = useRef<Record<number, HTMLDivElement | null>>({})
  const colsRef = useRef<Record<number, boolean>>({})
  const anchorRef = useRef<Record<number, DOMRect>>({})
  const closeTmrRef = useRef<number | null>(null)
  const hvrRmdRef = useRef(false)
  const scopeRef = useRef<HTMLDivElement | null>(null)

  const context = useMemo<CtxSelect<TData>>(
    () => ({
      data: controller.data,
      eventTarget: controller.eventTarget,
      clientX: controller.clientX,
      clientY: controller.clientY,
      close: controller.close,
    }),
    [
      controller.clientX,
      controller.clientY,
      controller.close,
      controller.data,
      controller.eventTarget,
    ],
  )

  const rootEntries = useMemo(
    () => (typeof items === 'function' ? items(context) : items) as AnyEntry[],
    [context, items],
  )

  // Each open id resolves the next rail by walking the chosen path from the root.
  const levels = useMemo<CtxLevel[]>(() => {
    const chain: CtxLevel[] = [
      { entries: rootEntries, label: ariaLabel, preview: null },
    ]

    let current = rootEntries

    for (const itemId of path) {
      const item = onlyItems(current).find((entry) => entry.id === itemId)
      if (!item) break

      const ownLabel = labelText(item.label) ?? ''

      if (item.submenu) {
        const next = (
          typeof item.submenu === 'function'
            ? item.submenu(context as CtxSelect<unknown>)
            : item.submenu
        ) as AnyEntry[]

        if (onlyItems(next).length === 0) break

        chain.push({ entries: next, label: ownLabel, preview: null })
        current = next
        continue
      }

      if (item.preview) {
        const node = typeof item.preview === 'function'
          ? item.preview(context as CtxSelect<unknown>)
          : item.preview

        chain.push({ entries: [], label: ownLabel, preview: node })
      }

      break
    }

    return chain
  }, [ariaLabel, context, path, rootEntries])

  const clearCloseTmr = useCallback(() => {
    if (closeTmrRef.current !== null) {
      window.clearTimeout(closeTmrRef.current)
      closeTmrRef.current = null
    }
  }, [])

  const clsMenuTree = useCallback(() => {
    clearCloseTmr()
    controller.close()
  }, [clearCloseTmr, controller])

  const trimTo = useCallback((level: number) => {
    setPath((previous) => (previous.length <= level ? previous : previous.slice(0, level)))
  }, [])

  const onRegister = useCallback((level: number, element: HTMLDivElement | null) => {
    railsRef.current[level] = element
  }, [])

  /* Placement is the geometry of the whole design: a rail sits under the well
     that opened it, the staircase commits to one direction at the root, and a
     stacked rail sends its child out sideways instead of below. */
  const place = useCallback((
    level: number,
    element: HTMLDivElement,
    col: boolean,
  ): RailPlace => {
    colsRef.current[level] = col

    const pad = vwprPddn
    const w = element.offsetWidth
    const h = element.offsetHeight
    const maxLeft = window.innerWidth - pad - w
    const maxTop = window.innerHeight - pad - h

    const atCursor = (): RailPlace => ({
      left: clampTo(controller.clientX, pad, maxLeft),
      top: clampTo(controller.clientY, pad, maxTop),
      stem: null,
    })

    if (level === 0) return atCursor()

    const anchor = anchorRef.current[level - 1]
    const parent = railsRef.current[level - 1]
    if (!anchor || !parent) return atCursor()

    const parentRect = parent.getBoundingClientRect()

    if (colsRef.current[level - 1] === true) {
      let left = parentRect.right + RAILGAP
      let dir: StemPlace['dir'] = 'end'

      if (left + w + pad > window.innerWidth) {
        left = parentRect.left - w - RAILGAP
        dir = 'start'
      }

      left = clampTo(left, pad, maxLeft)

      return {
        left,
        top: clampTo(anchor.top - 10, pad, maxTop),
        stem: {
          axis: 'x',
          dir,
          top: anchor.top + anchor.height / 2 - 1,
          left: dir === 'end' ? parentRect.right : left + w,
          length: dir === 'end'
            ? Math.max(0, left - parentRect.right)
            : Math.max(0, parentRect.left - (left + w)),
        },
      }
    }

    const grow = growRef.current
    const left = clampTo(anchor.left, pad, maxLeft)
    const top = clampTo(
      grow === 'up' ? anchor.top - RAILGAP - h : anchor.bottom + RAILGAP,
      pad,
      maxTop,
    )

    return {
      left,
      top,
      stem: {
        axis: 'y',
        dir: grow === 'up' ? 'start' : 'end',
        left: anchor.left + anchor.width / 2 - 1,
        top: grow === 'up' ? top + h : anchor.bottom,
        length: grow === 'up'
          ? Math.max(0, anchor.top - (top + h))
          : Math.max(0, top - anchor.bottom),
      },
    }
  }, [controller.clientX, controller.clientY, vwprPddn])

  const openBranch = useCallback((level: number, item: AnyItem) => {
    setPath((previous) => {
      if (previous.length === level + 1 && previous[level] === item.id) {
        return previous
      }

      return [...previous.slice(0, level), item.id]
    })
  }, [])

  const onHoverItem = useCallback((
    level: number,
    item: AnyItem,
    element: HTMLButtonElement,
  ) => {
    if (!hvrRmdRef.current) return

    clearCloseTmr()
    anchorRef.current[level] = element.getBoundingClientRect()

    if (isItemDsbld(item) || !isItemBrnch(item)) {
      trimTo(level)
      return
    }

    openBranch(level, item)
  }, [clearCloseTmr, openBranch, trimTo])

  const onLeaveRail = useCallback((level: number) => {
    if (controller.closing) return

    clearCloseTmr()

    closeTmrRef.current = window.setTimeout(() => {
      closeTmrRef.current = null
      if (controller.closing) return
      trimTo(level)
    }, HVRCLSDLYMS)
  }, [clearCloseTmr, controller.closing, trimTo])

  const onSelectItem = useCallback((item: AnyItem) => {
    if (isItemDsbld(item)) return

    // Touch has no hover, so tapping a branch opens it instead of committing.
    if (isItemBrnch(item)) {
      hvrRmdRef.current = true
      return
    }

    clsMenuTree()
    item.onSelect?.(context as CtxSelect<unknown>)
  }, [clsMenuTree, context])

  const wellsAt = useCallback((level: number) => {
    const rail = railsRef.current[level]
    if (!rail) return [] as HTMLButtonElement[]

    return Array.from(
      rail.querySelectorAll<HTMLButtonElement>('.floating-context-menu__item:not(:disabled)'),
    )
  }, [])

  const focusIn = useCallback((level: number, direction: 1 | -1) => {
    const wells = wellsAt(level)
    if (wells.length === 0) return

    const activeIndex = wells.findIndex((well) => well === document.activeElement)
    const nextIndex = activeIndex === -1
      ? (direction === 1 ? 0 : wells.length - 1)
      : (activeIndex + direction + wells.length) % wells.length

    wells[nextIndex]?.focus()
  }, [wellsAt])

  const onKeyDown = useCallback((
    level: number,
    col: boolean,
    event: RctKbdVnt<HTMLDivElement>,
  ) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      clsMenuTree()
      return
    }

    hvrRmdRef.current = true

    // Along the rail steps between wells; across it enters or leaves a level.
    const alongNext = col ? 'ArrowDown' : 'ArrowRight'
    const alongPrev = col ? 'ArrowUp' : 'ArrowLeft'
    const intoKey = col ? 'ArrowRight' : (growRef.current === 'up' ? 'ArrowUp' : 'ArrowDown')
    const backKey = col ? 'ArrowLeft' : (growRef.current === 'up' ? 'ArrowDown' : 'ArrowUp')

    if (event.key === alongNext) {
      event.preventDefault()
      focusIn(level, 1)
      return
    }

    if (event.key === alongPrev) {
      event.preventDefault()
      focusIn(level, -1)
      return
    }

    if (event.key === intoKey) {
      event.preventDefault()

      const activeId = (document.activeElement as HTMLElement | null)?.dataset?.id
      const item = activeId
        ? onlyItems(levels[level]?.entries ?? []).find((entry) => entry.id === activeId)
        : null

      if (item && item.submenu && !isItemDsbld(item)) {
        openBranch(level, item)
      }

      window.requestAnimationFrame(() => focusIn(level + 1, 1))
      return
    }

    if (event.key === backKey) {
      event.preventDefault()
      const parent = Math.max(0, level - 1)
      trimTo(parent)
      window.requestAnimationFrame(() => focusIn(parent, 1))
    }
  }, [clsMenuTree, focusIn, levels, openBranch, trimTo])

  // Hover must not fire on whatever already sits under the cursor at open time.
  useEffect(() => {
    if (!controller.isOpen) {
      hvrRmdRef.current = false
      return
    }

    hvrRmdRef.current = false
    const armTimer = window.setTimeout(() => {
      hvrRmdRef.current = true
    }, HVRARMMS)

    return () => window.clearTimeout(armTimer)
  }, [controller.clientX, controller.clientY, controller.isOpen])

  useEffect(() => {
    if (!controller.isOpen) {
      anchorRef.current = {}
      colsRef.current = {}
      return
    }

    if (onlyItems(rootEntries).length === 0) {
      clsMenuTree()
      return
    }

    // A deep menu opened low on the screen climbs instead of running off it.
    const need = Math.max(0, maxTreeDepth(rootEntries) - 1) * RAILSTEPPX
    growRef.current =
      controller.clientY + RAILSTEPPX + need + vwprPddn > window.innerHeight ? 'up' : 'down'

    const onPntrDown = (event: PointerEvent) => {
      const target = event.target as Node
      const inside = Object.values(railsRef.current).some((rail) => rail?.contains(target))

      if (!inside) clsMenuTree()
    }

    const onWndwChng = () => clsMenuTree()

    document.addEventListener('pointerdown', onPntrDown)
    window.addEventListener('scroll', onWndwChng, true)
    window.addEventListener('resize', onWndwChng)

    return () => {
      document.removeEventListener('pointerdown', onPntrDown)
      window.removeEventListener('scroll', onWndwChng, true)
      window.removeEventListener('resize', onWndwChng)
    }
  }, [
    clsMenuTree,
    controller.clientY,
    controller.isOpen,
    rootEntries,
    vwprPddn,
  ])

  useEffect(() => clearCloseTmr, [clearCloseTmr])

  useLayoutEffect(() => {
    if (controller.eventTarget instanceof HTMLElement && scopeRef.current) {
      syncAppPopupTokens(controller.eventTarget, scopeRef.current)
    }
  })

  const stateAttrs = useMemo(() => ({
    'data-open': controller.open ? 'true' : undefined,
    'data-closing': controller.closing ? 'true' : undefined,
  }), [controller.closing, controller.open])

  return createPortal(
    <div ref={scopeRef} className="app-popup-portal-scope">
      {levels.map((level, index) => (
        <CtxRail
          key={`rail:${index}:${path.slice(0, index).join('>')}`}
          entries={level.entries}
          preview={level.preview}
          label={level.label}
          level={index}
          openId={path[index] ?? null}
          minWidth={width}
          className={className}
          ariaLabel={index === 0 ? ariaLabel : `${level.label} submenu`}
          stateAttrs={stateAttrs}
          place={place}
          onRegister={onRegister}
          onHoverItem={onHoverItem}
          onLeaveRail={onLeaveRail}
          onSelectItem={onSelectItem}
          onKeyDown={onKeyDown}
        />
      ))}

    </div>,
    rslvPrtlTgt,
  )
}

export function ContextMenu<TData = unknown>(props: CtxProps<TData>) {
  const { controller, portalTarget } = props
  const target = portalTarget ?? bodyPortal()

  if (!controller.isOpen || !target) {
    return null
  }

  // Keying by the open position remounts the tree for every fresh open, so a
  // reopen never inherits the previous trail or its measurements.
  return (
    <CtxTree
      {...props}
      key={`${controller.clientX}:${controller.clientY}`}
      portalTarget={target}
    />
  )
}
