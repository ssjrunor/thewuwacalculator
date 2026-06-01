/* eslint-disable react-refresh/only-export-features */

/*
  Author: Runor Ewhro
  Description: Coordinates the app-wide context-menu surface by merging local
               menu items with global route-level items and hosting the shared
               portal-mounted menu instance.
*/

import {createContext as mkCtx, useContext, useEffect, useMemo, useRef, useState} from 'react'
import type {MouseEvent as RctMsVnt, ReactNode} from 'react'
import {useAppStore} from '@/domain/state/store'
import {
  ContextMenu,
  type CtxOpenEvent,
  type MenuEntry,
  useCtxMenu,
} from '@/shared/ui/CtxMenu.tsx'
import {
  dialogPortal,
  mainPortal,
} from '@/shared/lib/portalTarget'

type AppCtxMenuOp = CtxOpenEvent | MouseEvent | RctMsVnt<Element>

interface AppCtxMenuPa {
  ariaLabel: string
  items: MenuEntry[]
  width?: number
  omitGlblTms?: boolean
  force?: boolean
}

interface AppCtxMenuyf {
  ariaLabel?: string
  items: MenuEntry[]
  width?: number
  onClose?: () => void
  omitGlblTms?: boolean
  force?: boolean
}

interface AppCtxMenuAp {
  enabled: boolean
  hasGlblTms: boolean
  open: (event: AppCtxMenuOp, options: AppCtxMenuyf) => boolean
  close: () => void
  setGlblTms: (items: MenuEntry[]) => void
}
const AppCtxMenuCt = mkCtx<AppCtxMenuAp | null>(null)

function normCtxMenuE(entries: MenuEntry[]): MenuEntry[] {
  const seenIds = new Set<string>()
  const normalized: MenuEntry[] = []

  for (const entry of entries) {
    // collapse repeated separators and duplicate ids so merged local/global
    // menus do not render noisy gaps or duplicate actions.
    if (entry.type === 'separator') {
      if (normalized.length > 0 && normalized.at(-1)?.type !== 'separator') {
        normalized.push(entry)
      }
      continue
    }

    if (seenIds.has(entry.id)) {
      continue
    }

    seenIds.add(entry.id)
    normalized.push(entry)
  }

  while (normalized.at(-1)?.type === 'separator') {
    normalized.pop()
  }

  return normalized
}

function cllcCtxMenuE(entries: MenuEntry[], ids = new Set<string>()): Set<string> {
  for (const entry of entries) {
    if (entry.type === 'separator') {
      continue
    }

    ids.add(entry.id)

    if (Array.isArray(entry.submenu)) {
      cllcCtxMenuE(entry.submenu, ids)
    }
  }

  return ids
}

function fltrDplcGlbl(globalItems: MenuEntry[], scopedItems: MenuEntry[]): MenuEntry[] {
  if (scopedItems.length === 0) {
    return globalItems
  }

  // local scoped actions win over fallback global actions when ids match.
  const scopedIds = cllcCtxMenuE(scopedItems)
  return normCtxMenuE(globalItems.filter((entry) => (
    entry.type === 'separator' || !scopedIds.has(entry.id)
  )))
}

function hasMoreMenuE(entries: MenuEntry[]): boolean {
  return entries.some((entry) => entry.type !== 'separator' && entry.label === 'More...')
}

export function AppCtxMenuPr({children}: {children: ReactNode}) {
  const enabled = useAppStore((state) => state.ui.preferences.ctxMenu)
  const controller = useCtxMenu<AppCtxMenuPa>()
  const actPay = controller.data
  const [globalItems, setGlblTms] = useState<MenuEntry[]>([])
  const onCloseRef = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    if (!enabled && !actPay?.force) {
      controller.close()
    }
  }, [actPay?.force, controller, enabled])

  useEffect(() => {
    if (controller.closing) {
      const fn = onCloseRef.current
      onCloseRef.current = undefined
      fn?.()
    }
  }, [controller.closing])
  const items = useMemo(() => {
    const scopedItems = actPay?.items ?? []
    // some scoped menus already expose a "more" bucket, so avoid appending the
    // shared global footer in those cases.
    if (actPay?.omitGlblTms || globalItems.length === 0 || hasMoreMenuE(scopedItems)) {
      return normCtxMenuE(scopedItems)
    }

    const fltrGlblTms = fltrDplcGlbl(globalItems, scopedItems)
    if (fltrGlblTms.length === 0) {
      return normCtxMenuE(scopedItems)
    }

    const mergedItems = scopedItems.length > 0
      ? [...scopedItems, {type: 'separator' as const}, ...fltrGlblTms]
      : fltrGlblTms

    return normCtxMenuE(mergedItems)
  }, [actPay, globalItems])

  const value = useMemo<AppCtxMenuAp>(
    () => ({
      enabled,
      hasGlblTms: globalItems.length > 0,
      close: controller.close,
      setGlblTms: setGlblTms,
      open: (event, options) => {
        if (!enabled && !options.force) {
          return false
        }

        onCloseRef.current = options.onClose
        controller.show(event, {
          ariaLabel: options.ariaLabel ?? 'Context menu',
          items: options.items,
          width: options.width,
          omitGlblTms: options.omitGlblTms,
          force: options.force,
        })
        return true
      },
    }),
    [controller, enabled, globalItems.length, setGlblTms],
  )

  return (
    <AppCtxMenuCt.Provider value={value}>
      {children}
      <ContextMenu
        controller={controller}
        items={items}
        portalTarget={dialogPortal() ?? mainPortal()}
        ariaLabel={actPay?.ariaLabel ?? 'Context menu'}
        width={actPay?.width}
      />
    </AppCtxMenuCt.Provider>
  )
}

export function useAppCtxMen(): AppCtxMenuAp {
  const context = useContext(AppCtxMenuCt)
  if (!context) {
    throw new Error('useAppContextMenu must be used within AppContextMenuProvider')
  }

  return context
}
