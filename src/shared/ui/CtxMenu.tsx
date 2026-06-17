/*
  Author: Runor Ewhro
  Description: Implements the floating context-menu renderer, including portal
               mounting, viewport-aware panel layout, submenu hover intent, and
               optional preview panels.
*/

import type {
  CSSProperties as CssProps,
  MouseEvent as RctMsVnt,
  PointerEvent as RctPntrVnt,
  ReactNode,
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnimVis } from '@/app/hooks/useAnimatedVisibility'
import { bodyPortal } from '@/shared/lib/portalTarget'

const DEFMENUWDTH = 178
const DEFVWPRPDDN = 12
const DEFSBMNFFST = 24
const MENUEXITDURM = 620
const HVRCLSDLYMS = 180

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
  width?: number
  vwprPddn?: number
  className?: string
  ariaLabel?: string
}

type MenuPanelSide = 'right' | 'left'

interface CtxPnlLytStt {
  style: CssProps
  side: MenuPanelSide
  childSide: MenuPanelSide
}

export function useCtxMenu<TData = unknown>(): CtxCtrl<TData> {
  const [state, setState] = useState<CtxState<TData> | null>(null)
  const visibility = useAnimVis(MENUEXITDURM)

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

      // capture pointer location and event target once so the menu and any
      // action handlers can derive context without holding the original event.
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

export function ContextMenu<TData = unknown>({
                                           controller,
                                           items,
                                           portalTarget,
                                           width = DEFMENUWDTH,
                                           vwprPddn: vwprPddn = DEFVWPRPDDN,
                                           className = '',
                                           ariaLabel = 'Context menu',
                                         }: CtxProps<TData>) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const sbmnClsTmrRe = useRef<number | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const submenuRefs = useRef<Array<HTMLDivElement | null>>([])
  const frameRef = useRef<number | null>(null)

  const ntlPntrRef = useRef<{ x: number; y: number } | null>(null)
  const hvrRmdRef = useRef(false)

  const [submenuPath, setSbmnPath] = useState<string[]>([])
  const [sbmnLyts, setSbmnLyts] = useState<CtxPnlLytStt[]>([])
  const [previewState, setPrvwStt] = useState<{
    content: ReactNode
    layout: CtxPnlLytStt
  } | null>(null)

  const [menuLayout, setMenuLyt] = useState<CssProps>({
    left: `${vwprPddn}px`,
    top: `${vwprPddn}px`,
    width: `${width}px`,
  })

  const [menuSide, setMenuSide] = useState<MenuPanelSide>('right')

  const rslvPrtlTgt = portalTarget ?? bodyPortal()

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

  const resolveTimers = useMemo(
    () => (typeof items === 'function' ? items(context) : items),
    [context, items],
  )

  const getItemRefKe = useCallback(
    (level: number, itemId: string) => `${level}:${itemId}`,
    [],
  )

  const getItemIdFro = useCallback(
    (refKey: string) => refKey.slice(refKey.indexOf(':') + 1),
    [],
  )

  const resEnts = useCallback(
    (
      entries:
        | MenuEntry<TData>[]
        | ((context: CtxSelect<TData>) => MenuEntry<TData>[]),
    ) => (typeof entries === 'function' ? entries(context) : entries),
    [context],
  )

  const findItemById = useCallback(
    (
      entries: MenuEntry<TData>[],
      itemId: string,
    ): MenuItem<TData> | null => {
      const item = entries.find(
        (entry): entry is MenuItem<TData> =>
          entry.type !== 'separator' && entry.id === itemId,
      )

      return item ?? null
    },
    [],
  )

  const findSbmnItem = useCallback(
    (
      entries: MenuEntry<TData>[],
      itemId: string,
    ): MenuItem<TData> | null => {
      const item = findItemById(entries, itemId)
      return item?.submenu ? item : null
    },
    [findItemById],
  )

  const resTmsAtPath = useCallback(
    (path: string[]): MenuEntry<TData>[] => {
      let currentItems = resolveTimers

      // each submenu level is resolved by walking the chosen item path from the
      // root menu, stopping early if any submenu stops existing.
      for (const itemId of path) {
        const item = findSbmnItem(currentItems, itemId)

        if (!item?.submenu) {
          return []
        }

        currentItems = resEnts(item.submenu)
      }

      return currentItems
    },
    [findSbmnItem, resEnts, resolveTimers],
  )

  const mkEntGrps = useCallback((entries: MenuEntry<TData>[]) => {
    const groups: MenuItem<TData>[][] = []
    let currentGroup: MenuItem<TData>[] = []

    for (const entry of entries) {
      if (entry.type === 'separator') {
        if (currentGroup.length > 0) {
          groups.push(currentGroup)
          currentGroup = []
        }

        continue
      }

      currentGroup.push(entry)
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup)
    }

    const totalItems = groups.reduce((sum, group) => sum + group.length, 0)
    let runningIndex = 0

    return groups.map((group) => group.map((item) => {
      const globalIndex = runningIndex
      runningIndex += 1

      return {
        item,
        globalIndex,
        reverseIndex: Math.max(0, totalItems - globalIndex - 1),
      }
    }))
  }, [])

  const clrSbmnFtrLv = useCallback((level: number) => {
    setSbmnPath((previous) => previous.slice(0, level))
    setSbmnLyts((previous) => previous.slice(0, level))
  }, [])

  const clearPreview = useCallback(() => {
    setPrvwStt(null)
  }, [])

  const clearSubmenu = useCallback(() => {
    if (sbmnClsTmrRe.current !== null) {
      window.clearTimeout(sbmnClsTmrRe.current)
      sbmnClsTmrRe.current = null
    }
  }, [])

  const schdSbmnCls = useCallback((level: number) => {
    if (controller.closing) return

    clearSubmenu()

    sbmnClsTmrRe.current = window.setTimeout(() => {
      sbmnClsTmrRe.current = null

      if (controller.closing) return

      clrSbmnFtrLv(level)
      clearPreview()
    }, HVRCLSDLYMS)
  }, [
    clearPreview,
    clearSubmenu,
    clrSbmnFtrLv,
    controller.closing,
  ])

  const keepSbmnOpen = useCallback(() => {
    clearSubmenu()
  }, [clearSubmenu])

  const clrMenuTreeS = useCallback(() => {
    clearSubmenu()
    setSbmnPath([])
    setSbmnLyts([])
    setPrvwStt(null)
  }, [clearSubmenu])

  const clsMenuTree = useCallback(() => {
    clearSubmenu()
    controller.close()
  }, [clearSubmenu, controller])

  const clearMeasure = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const getPrfrFltnS = useCallback((
    triggerRect: DOMRect,
    fltnWdth: number,
    prfrSide: MenuPanelSide,
  ): MenuPanelSide => {
    const rghtFitsWith = triggerRect.right <= window.innerWidth
    const leftFitsWith = triggerRect.left >= 0
    const rghtFitsCur =
      triggerRect.right + fltnWdth + vwprPddn <= window.innerWidth
    const leftFitsCur =
      triggerRect.left - fltnWdth - vwprPddn >= 0

    if (prfrSide === 'right') {
      if (rghtFitsCur) return 'right'
      if (leftFitsCur) return 'left'
      if (rghtFitsWith) return 'right'
      if (leftFitsWith) return 'left'
      return rghtFitsCur || !leftFitsCur ? 'right' : 'left'
    }

    if (leftFitsCur) return 'left'
    if (rghtFitsCur) return 'right'
    if (leftFitsWith) return 'left'
    if (rghtFitsWith) return 'right'
    return leftFitsCur || !rghtFitsCur ? 'left' : 'right'
  }, [vwprPddn])

  const mkPnlRect = useCallback((
    left: number,
    widthValue: number,
  ): DOMRect => ({
    x: left,
    y: 0,
    width: widthValue,
    height: 0,
    top: 0,
    right: left + widthValue,
    bottom: 0,
    left,
    toJSON: () => ({}),
  }) as DOMRect, [])

  const measureMenu = useCallback(() => {
    // root placement chooses the side that leaves room for first-level
    // submenus, not just the side that fits the root panel.
    const maxWidth = Math.max(0, window.innerWidth - vwprPddn * 2)
    const maxHeight = Math.max(0, window.innerHeight - vwprPddn * 2)

    const measuredRect = menuRef.current?.getBoundingClientRect()
    const rslvWdth = Math.min(width, maxWidth)
    const submenuWidth = rslvWdth

    const msrdHght =
      measuredRect?.height ?? Math.min(maxHeight, resolveTimers.length * 42 + 16)

    const bnddHght = Math.min(msrdHght, maxHeight)

    const maxLeft = Math.max(
      vwprPddn,
      window.innerWidth - vwprPddn - rslvWdth,
    )

    const maxTop = Math.max(
      vwprPddn,
      window.innerHeight - vwprPddn - bnddHght,
    )

    const resRootLeft = (side: MenuPanelSide) => {
      const desiredLeft = side === 'right'
        ? controller.clientX
        : controller.clientX - rslvWdth

      return Math.min(Math.max(vwprPddn, desiredLeft), maxLeft)
    }

    const rightLeft = resRootLeft('right')
    const leftLeft = resRootLeft('left')
    const rghtFcngSide = getPrfrFltnS(
      mkPnlRect(rightLeft, rslvWdth),
      submenuWidth,
      'right',
    )
    const leftFcngSide = getPrfrFltnS(
      mkPnlRect(leftLeft, rslvWdth),
      submenuWidth,
      'right',
    )

    let side: MenuPanelSide
    if (rghtFcngSide === 'right') {
      side = 'right'
    } else if (leftFcngSide === 'left') {
      side = 'left'
    } else {
      side = rghtFcngSide
    }

    const left = side === 'right' ? rightLeft : leftLeft
    const top = Math.min(Math.max(vwprPddn, controller.clientY), maxTop)

    const originX = controller.clientX - left

    setMenuLyt({
      left: `${left}px`,
      top: `${top}px`,
      width: `${rslvWdth}px`,
      maxHeight: `${maxHeight}px`,
      '--floating-context-menu-origin': `${originX}px ${controller.clientY - top}px`,
    } as CssProps)

    setMenuSide(side)
  }, [
    controller.clientX,
    controller.clientY,
    resolveTimers.length,
    getPrfrFltnS,
    mkPnlRect,
    vwprPddn,
    width,
  ])

  const schdMsrMenu = useCallback(() => {
    clearMeasure()

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measureMenu()
    })
  }, [clearMeasure, measureMenu])

  const getPnlChldSi = useCallback((panelLevel: number): MenuPanelSide => {
    if (panelLevel === 0) {
      return menuSide
    }

    return sbmnLyts[panelLevel - 1]?.childSide ?? 'right'
  }, [menuSide, sbmnLyts])

  const getChldPnlPl = useCallback((
    parentPath: string[],
    itemId: string,
    panelLevel: number,
    pnlChldSide: MenuPanelSide,
    fltnWdth: number,
  ): MenuPanelSide => {
    const childLayout = sbmnLyts[parentPath.length]
    const childPath = [...parentPath, itemId]
    const isOpenPath =
      submenuPath.length >= childPath.length
      && childPath.every((value, index) => submenuPath[index] === value)

    if (isOpenPath && childLayout) {
      // preserve the measured side for already-open paths to avoid submenu
      // jitter while pointer intent moves between parent and child panels.
      return childLayout.side
    }

    const triggerRect =
      itemRefs.current[getItemRefKe(panelLevel, itemId)]?.getBoundingClientRect()

    if (!triggerRect) {
      return pnlChldSide
    }

    return getPrfrFltnS(triggerRect, fltnWdth, pnlChldSide)
  }, [getItemRefKe, getPrfrFltnS, sbmnLyts, submenuPath])

  const openSubmenu = useCallback(
    (parentPath: string[], itemId: string, panelLevel: number) => {
      const currentItems = resTmsAtPath(parentPath)
      const item = findSbmnItem(currentItems, itemId)

      if (!item?.submenu) {
        clrSbmnFtrLv(panelLevel)
        return
      }

      const triggerRect =
        itemRefs.current[getItemRefKe(panelLevel, itemId)]?.getBoundingClientRect()

      if (!triggerRect) {
        return
      }

      const submenuItems = resEnts(item.submenu)

      if (!submenuItems.some((entry) => entry.type !== 'separator')) {
        clrSbmnFtrLv(panelLevel)
        return
      }

      const submenuWidth = Math.min(
        width,
        Math.max(0, window.innerWidth - vwprPddn * 2),
      )

      const stmtHght = Math.min(
        Math.max(0, window.innerHeight - vwprPddn * 2),
        submenuItems.length * 42 + 16,
      )

      const prntChldSide = getPnlChldSi(panelLevel)
      const side = getChldPnlPl(parentPath, itemId, panelLevel, prntChldSide, submenuWidth)

      const left = side === 'left'
        ? Math.max(
          vwprPddn,
          triggerRect.left - submenuWidth - DEFSBMNFFST,
        )
        : Math.min(
          window.innerWidth - vwprPddn - submenuWidth,
          triggerRect.right + DEFSBMNFFST,
        )

      const top = Math.min(
        Math.max(vwprPddn, triggerRect.top - 4),
        Math.max(vwprPddn, window.innerHeight - vwprPddn - stmtHght),
      )
      const childSide = getPrfrFltnS(
        mkPnlRect(left, submenuWidth),
        submenuWidth,
        'right',
      )

      const nextPath = [...parentPath, itemId]
      const previousPath = submenuPath

      const isLrdyOpen =
        previousPath.length === nextPath.length &&
        previousPath.every((value, index) => value === nextPath[index])

      if (isLrdyOpen) {
        return
      }

      setSbmnPath(nextPath)

      setSbmnLyts((previous) => {
        const nextLayouts = previous.slice(0, parentPath.length)

        nextLayouts[parentPath.length] = {
          side,
          childSide,
          style: {
            left: `${left}px`,
            top: `${top}px`,
            width: `${submenuWidth}px`,
            maxHeight: `${Math.max(0, window.innerHeight - vwprPddn * 2)}px`,
            '--floating-context-menu-origin': side === 'left' ? '100% 0' : '0 0',
          } as CssProps,
        }

        return nextLayouts
      })
    },
    [
      mkPnlRect,
      clrSbmnFtrLv,
      getChldPnlPl,
      findSbmnItem,
      getItemRefKe,
      getPnlChldSi,
      getPrfrFltnS,
      resEnts,
      resTmsAtPath,
      submenuPath,
      vwprPddn,
      width,
    ],
  )

  const openPreview = useCallback(
    (parentPath: string[], itemId: string, panelLevel: number) => {
      const currentItems = resTmsAtPath(parentPath)
      const item = findItemById(currentItems, itemId)

      // previews resolve from the same context as actions so they reflect the
      // clicked payload without storing per-item preview state in callers.
      if (!item?.preview) {
        clearPreview()
        return
      }

      const triggerRect =
        itemRefs.current[getItemRefKe(panelLevel, itemId)]?.getBoundingClientRect()

      if (!triggerRect) {
        clearPreview()
        return
      }

      const previewWidth = Math.min(
        336,
        Math.max(240, window.innerWidth - vwprPddn * 2),
      )

      const stmtHght = Math.min(
        Math.max(0, window.innerHeight - vwprPddn * 2),
        288,
      )

      const side = getPnlChldSi(panelLevel)

      const left = side === 'left'
        ? Math.max(
          vwprPddn,
          triggerRect.left - previewWidth - DEFSBMNFFST,
        )
        : Math.min(
          window.innerWidth - vwprPddn - previewWidth,
          triggerRect.right + DEFSBMNFFST,
        )

      const top = Math.min(
        Math.max(vwprPddn, triggerRect.top - 4),
        Math.max(vwprPddn, window.innerHeight - vwprPddn - stmtHght),
      )

      setPrvwStt({
        content: typeof item.preview === 'function' ? item.preview(context) : item.preview,
        layout: {
          side,
          childSide: side,
          style: {
            left: `${left}px`,
            top: `${top}px`,
            width: `${previewWidth}px`,
            maxHeight: `${Math.max(0, window.innerHeight - vwprPddn * 2)}px`,
            '--floating-context-menu-origin': side === 'left' ? '100% 0' : '0 0',
          } as CssProps,
        },
      })
    },
    [
      clearPreview,
      context,
      findItemById,
      getItemRefKe,
      getPnlChldSi,
      resTmsAtPath,
      vwprPddn,
    ],
  )

  const onMenuPntrMo = useCallback((event: RctPntrVnt<HTMLDivElement>) => {
    if (hvrRmdRef.current) return

    const initial = ntlPntrRef.current

    if (!initial) {
      hvrRmdRef.current = true
      return
    }

    const dx = Math.abs(event.clientX - initial.x)
    const dy = Math.abs(event.clientY - initial.y)

    if (dx > 3 || dy > 3) {
      hvrRmdRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!controller.isOpen) {
      hvrRmdRef.current = false
      ntlPntrRef.current = null
      return
    }

    hvrRmdRef.current = false
    ntlPntrRef.current = {
      x: controller.clientX,
      y: controller.clientY,
    }
    const armTimer = window.setTimeout(() => {
      hvrRmdRef.current = true
    }, 90)
    return () => window.clearTimeout(armTimer)
  }, [controller.clientX, controller.clientY, controller.isOpen])

  useEffect(() => {
    if (!controller.isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      clrMenuTreeS()
      return
    }

    if (!resolveTimers.some((item) => item.type !== 'separator')) {
      clsMenuTree()
      return
    }

    schdMsrMenu()

    const onPntrDown = (event: PointerEvent) => {
      const target = event.target as Node

      if (
        menuRef.current?.contains(target) ||
        submenuRefs.current.some((submenuRef) => submenuRef?.contains(target))
      ) {
        return
      }

      clsMenuTree()
    }

    const onWndwChng = () => {
      schdMsrMenu()
      clrMenuTreeS()
    }

    document.addEventListener('pointerdown', onPntrDown)
    window.addEventListener('scroll', onWndwChng, true)
    window.addEventListener('resize', onWndwChng)

    return () => {
      clearMeasure()
      document.removeEventListener('pointerdown', onPntrDown)
      window.removeEventListener('scroll', onWndwChng, true)
      window.removeEventListener('resize', onWndwChng)
    }
  }, [
    clearMeasure,
    clrMenuTreeS,
    clsMenuTree,
    controller.isOpen,
    resolveTimers,
    schdMsrMenu,
  ])

  const fcsSblnItem = useCallback((direction: 1 | -1) => {
    const menu = menuRef.current

    if (!menu) {
      return
    }

    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(
        '.floating-context-menu__item:not(:disabled)',
      ),
    )

    if (items.length === 0) {
      return
    }

    const activeIndex = items.findIndex((item) => item === document.activeElement)

    const nextIndex =
      activeIndex === -1
        ? 0
        : (activeIndex + direction + items.length) % items.length

    items[nextIndex]?.focus()
  }, [])

  const fcsFrstItemI = useCallback((panelLevel: number) => {
    const panel = panelLevel === 0 ? menuRef.current : submenuRefs.current[panelLevel - 1]

    const frstOnItem = panel?.querySelector<HTMLButtonElement>(
      '.floating-context-menu__item:not(:disabled)',
    )

    frstOnItem?.focus()
  }, [])

  useEffect(() => {
    return () => {
      clearSubmenu()
    }
  }, [clearSubmenu])

  const sbmnPnls = useMemo(() => {
    return submenuPath
      .map((itemId, levelIndex) => {
        const parentPath = submenuPath.slice(0, levelIndex)
        const parentItems = resTmsAtPath(parentPath)
        const item = findSbmnItem(parentItems, itemId)
        const tmsForLvl = item?.submenu ? resEnts(item.submenu) : []

        return {
          item,
          items: tmsForLvl,
          layout: sbmnLyts[levelIndex],
          panelLevel: levelIndex + 1,
          parentPath,
        }
      })
      .filter(
        (
          panel,
        ): panel is {
          item: MenuItem<TData>
          items: MenuEntry<TData>[]
          layout: CtxPnlLytStt
          panelLevel: number
          parentPath: string[]
        } => Boolean(panel.item && panel.items.length > 0 && panel.layout),
      )
  }, [
    findSbmnItem,
    resEnts,
    resTmsAtPath,
    sbmnLyts,
    submenuPath,
  ])

  const rootGroups = useMemo(
    () => mkEntGrps(resolveTimers),
    [mkEntGrps, resolveTimers],
  )

  if (!controller.isOpen || !rslvPrtlTgt) {
    return null
  }

  const viewMenuItem = (item: MenuItem<TData>, panelLevel: number) => {
    const hasSubmenu = Boolean(item.submenu)
    const disabled = item.disabled || (!item.onSelect && !hasSubmenu)
    const expanded = submenuPath[panelLevel] === item.id
    const dimmed = submenuPath.length > panelLevel && !expanded
    const parentPath = submenuPath.slice(0, panelLevel)

    return ({ globalIndex, reverseIndex, side }: {
      globalIndex: number
      reverseIndex: number
      side: MenuPanelSide
    }) => {
      const chevron = hasSubmenu ? (
        <span className="floating-context-menu__chevron" aria-hidden="true" />
      ) : null

      const icon = item.icon ? (
        <span className="floating-context-menu__icon">{item.icon}</span>
      ) : null

      return (
        <button
          key={item.id}
          ref={(element) => {
            itemRefs.current[getItemRefKe(panelLevel, item.id)] = element
          }}
          type="button"
          className="floating-context-menu__item"
          role="menuitem"
          disabled={disabled}
          data-danger={item.danger ? 'true' : undefined}
          data-submenu={hasSubmenu ? 'true' : undefined}
          data-side={side}
          data-expanded={expanded ? 'true' : undefined}
          data-dimmed={dimmed ? 'true' : undefined}
          aria-haspopup={hasSubmenu ? 'menu' : undefined}
          aria-expanded={hasSubmenu ? expanded : undefined}
          style={{
            '--bubble-index': globalIndex,
            '--bubble-rev-index': reverseIndex,
          } as CssProps}
          onMouseEnter={() => {
            if (!hvrRmdRef.current) {
              return
            }

            keepSbmnOpen()

            if (hasSubmenu) {
              openSubmenu(parentPath, item.id, panelLevel)
            } else {
              clrSbmnFtrLv(panelLevel)
            }

            if (item.preview) {
              openPreview(parentPath, item.id, panelLevel)
            } else {
              clearPreview()
            }
          }}
          onFocus={() => {
            if (!hvrRmdRef.current) {
              return
            }

            keepSbmnOpen()

            if (item.preview) {
              openPreview(parentPath, item.id, panelLevel)
            } else {
              clearPreview()
            }
          }}
          onBlur={() => {
            clearPreview()
          }}
          onClick={() => {
            if (disabled || hasSubmenu) return

            clsMenuTree()
            item.onSelect?.(context)
          }}
        >
          <span className="floating-context-menu__item-surface" aria-hidden="true" />
          <span className="floating-context-menu__item-bracket floating-context-menu__item-bracket--tl" aria-hidden="true" />
          <span className="floating-context-menu__item-bracket floating-context-menu__item-bracket--br" aria-hidden="true" />

          {side === 'left' ? chevron : null}
          {icon}

          <span className="floating-context-menu__label">{item.label}</span>

          {item.hint ? (
            <span className="floating-context-menu__hint">{item.hint}</span>
          ) : null}

          {side === 'right' ? chevron : null}
        </button>
      )
    }
  }

  const viewMenuGrps = (
    groups: Array<Array<{ item: MenuItem<TData>; globalIndex: number; reverseIndex: number }>>,
    panelLevel: number,
    side: MenuPanelSide,
  ) => groups.map((group, groupIndex) => (
    <div
      key={`group:${panelLevel}:${groupIndex}`}
      className="floating-context-menu__group"
      role="presentation"
    >
      {group.map(({ item, globalIndex, reverseIndex }) => (
        viewMenuItem(item, panelLevel)({ globalIndex, reverseIndex, side })
      ))}
    </div>
  ))

  const rootOpenKey = menuSide === 'left' ? 'ArrowLeft' : 'ArrowRight'

  return createPortal(
    <>
      <div
        ref={menuRef}
        className={`floating-context-menu ${className}`.trim()}
        style={menuLayout}
        role="menu"
        aria-label={ariaLabel}
        tabIndex={-1}
        data-side={menuSide}
        data-backgrounded={submenuPath.length > 1 ? 'true' : undefined}
        data-open={controller.open ? 'true' : undefined}
        data-closing={controller.closing ? 'true' : undefined}
        onPointerMove={onMenuPntrMo}
        onMouseEnter={keepSbmnOpen}
        onMouseLeave={() => {
          clearPreview()
          schdSbmnCls(0)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            clsMenuTree()
            return
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault()
            hvrRmdRef.current = true
            clrSbmnFtrLv(0)
            fcsSblnItem(1)
            return
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault()
            hvrRmdRef.current = true
            clrSbmnFtrLv(0)
            fcsSblnItem(-1)
            return
          }

          if (event.key === rootOpenKey) {
            event.preventDefault()
            hvrRmdRef.current = true

            const actItemRefKe = Object.entries(itemRefs.current).find(
              ([, element]) => element === document.activeElement,
            )?.[0]

            const rslvItemId = actItemRefKe
              ? getItemIdFro(actItemRefKe)
              : null

            if (rslvItemId) {
              openSubmenu([], rslvItemId, 0)

              window.requestAnimationFrame(() => {
                fcsFrstItemI(1)
              })
            }
          }
        }}
      >
        {viewMenuGrps(rootGroups, 0, menuSide)}
      </div>

      {sbmnPnls.map((panel, panelIndex) => {
        const openKey = panel.layout.childSide === 'left' ? 'ArrowLeft' : 'ArrowRight'
        const closeKey = panel.layout.side === 'left' ? 'ArrowRight' : 'ArrowLeft'
        const backgrounded = panel.panelLevel < submenuPath.length - 1

        return (
          <div
            key={`${panel.parentPath.join('>')}:${panel.item.id}`}
            ref={(element) => {
              submenuRefs.current[panelIndex] = element
            }}
            className={`floating-context-menu floating-context-menu--submenu ${className}`.trim()}
            style={panel.layout.style}
            role="menu"
            aria-label={`${String(panel.item.label)} submenu`}
            tabIndex={-1}
            data-side={panel.layout.side}
            data-backgrounded={backgrounded ? 'true' : undefined}
            data-open={controller.open ? 'true' : undefined}
            data-closing={controller.closing ? 'true' : undefined}
            onPointerMove={onMenuPntrMo}
            onMouseEnter={keepSbmnOpen}
            onMouseLeave={() => {
              clearPreview()
              schdSbmnCls(panel.panelLevel - 1)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                clsMenuTree()
                return
              }

              if (event.key === closeKey) {
                event.preventDefault()
                hvrRmdRef.current = true

                clrSbmnFtrLv(panel.panelLevel - 1)

                itemRefs.current[
                  getItemRefKe(panel.panelLevel - 1, panel.item.id)
                  ]?.focus()

                return
              }

              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                hvrRmdRef.current = true

                const items = Array.from(
                  submenuRefs.current[panel.panelLevel - 1]?.querySelectorAll<HTMLButtonElement>(
                    '.floating-context-menu__item:not(:disabled)',
                  ) ?? [],
                )

                if (items.length === 0) {
                  return
                }

                const direction = event.key === 'ArrowDown' ? 1 : -1

                const activeIndex = items.findIndex(
                  (item) => item === document.activeElement,
                )

                const nextIndex =
                  activeIndex === -1
                    ? 0
                    : (activeIndex + direction + items.length) % items.length

                items[nextIndex]?.focus()
                return
              }

              if (event.key === openKey) {
                event.preventDefault()
                hvrRmdRef.current = true

                const actItemRefKe = Object.entries(itemRefs.current).find(
                  ([, element]) => element === document.activeElement,
                )?.[0]

                const rslvItemId = actItemRefKe
                  ? getItemIdFro(actItemRefKe)
                  : null

                if (rslvItemId) {
                  openSubmenu(panel.parentPath, rslvItemId, panel.panelLevel)

                  window.requestAnimationFrame(() => {
                    fcsFrstItemI(panel.panelLevel + 1)
                  })
                }
              }
            }}
          >
            {viewMenuGrps(mkEntGrps(panel.items), panel.panelLevel, panel.layout.childSide)}
          </div>
        )
      })}

      {previewState ? (
        <div
          className={`floating-context-menu floating-context-menu--preview ${className}`.trim()}
          style={previewState.layout.style}
          data-side={previewState.layout.side}
          data-open={controller.open ? 'true' : undefined}
          data-closing={controller.closing ? 'true' : undefined}
          aria-hidden="true"
        >
          <div className="floating-context-menu__preview-shell">
            <span className="floating-context-menu__item-surface" aria-hidden="true" />

            <span className="floating-context-menu__preview-bracket floating-context-menu__preview-bracket--tl" aria-hidden="true" />
            <span className="floating-context-menu__preview-bracket floating-context-menu__preview-bracket--br" aria-hidden="true" />
            {previewState.content}
          </div>
        </div>
      ) : null}
    </>,
    rslvPrtlTgt,
  )
}
