/*
  Author: Runor Ewhro
  Description: Holds the stable route-menu context identity and its consumer
               contract outside React Fast Refresh component boundaries.
*/

import { createContext, useContext } from 'react'
import type { routeCtxBuilder } from '@/application/context-menu/routeContextBuilders'
import type {
  LegacyCalculatorView,
  RouteNavLink,
} from '@/application/context-menu/routeChromeConfig'

export interface RouteHistoryScope {
  past: Array<{ label: string }>
  future: Array<{ label: string }>
  undo: () => void
  redo: () => void
  undoTo: (index: number) => void
  redoTo: (index: number) => void
}

export interface RouteMenuValue {
  pageLinks: RouteNavLink[]
  legacyCalculatorViews: LegacyCalculatorView[]
  actions: {
    navigateTo: (to: string) => void
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    registerHistoryScope: (scope: RouteHistoryScope) => () => void
    openInv: () => void
    tgglOpt: () => void
    openModulation: () => void
    tgglRotEd: () => void
    openStatus: () => void
    rstActRes: () => void
  }
  builders: {
    routeChrome: {
      undoRedo: () => ReturnType<typeof routeCtxBuilder.routeChrome.undoRedo>
      pages: () => ReturnType<typeof routeCtxBuilder.routeChrome.pages>
      actions: () => ReturnType<typeof routeCtxBuilder.routeChrome.actions>
      reset: () => ReturnType<typeof routeCtxBuilder.routeChrome.reset>
      bttmSec: () => ReturnType<typeof routeCtxBuilder.routeChrome.bttmSctn>
      simulationSection: () => ReturnType<typeof routeCtxBuilder.routeChrome.simulationSection>
    }
  }
}

export const RouteMenuContext = createContext<RouteMenuValue | null>(null)

export function useRtChrmMen(): RouteMenuValue {
  const context = useContext(RouteMenuContext)
  if (!context) {
    throw new Error('useRouteChromeMenu must be used within RouteMenuProvider')
  }

  return context
}
