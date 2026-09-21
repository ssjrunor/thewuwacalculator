/*
  Author: Runor Ewhro
  Description: provides route-chrome menu builders and route-level actions
               such as navigation, history, inventory access, and reset flows.
*/

import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useConfirm } from '@/shared/hooks/useConfirmation'
import { useNavX } from '@/shared/navigation/useNavX'
import { selActResId } from '@/application/state'
import { useAppStore } from '@/application/state'
import {
  EchoConsoleHost,
  TeamConsoleHost,
  WeaponConsoleHost,
} from '@/modules/simulation/api/chrome'
import { AppSttsMdl } from '@/app/shell/AppStatusModal'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal'
import { useAppModal } from '@/shared/ui/useAppModal'
import { routeCtxBuilder } from '@/application/context-menu/routeContextBuilders.tsx'
import {
  legacyCalculatorViews,
  rtNavLnks,
} from '@/application/context-menu/routeChromeConfig'
import {
  RouteMenuContext,
  type RouteHistoryScope,
  type RouteMenuValue,
} from '@/application/context-menu/routeMenuContext'
import {
  SIMULATION_ROUTES,
  isSimulationRoute,
  isSimulationSurfaceRoute,
} from '@/shared/lib/appRoutes'
import { useTstStr } from '@/shared/util/toastStore'
import { RUNTIME_APP_HISTORY_ENABLED } from '@/application/state/history'

export function RtMenuProv({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavX()
  const confirmation = useConfirm()
  const appStatus = useAppModal()
  const showToast = useTstStr((state) => state.show)
  const [historyScope, setHistoryScope] = useState<RouteHistoryScope | null>(null)
  const simulationActive = isSimulationRoute(location.pathname)
  const optimizerActive = isSimulationSurfaceRoute(location.pathname, 'optimizer')
  const modulationActive = isSimulationSurfaceRoute(location.pathname, 'modulation')
  const {
    setInventoryOpen: setInvOpen,
    resetResonator: rstRes,
    undo,
    redo,
    undoTo,
    redoTo,
    activeResonatorId: actResId,
    haveHistory,
    historyPast,
    historyFuture: hstrFtr,
  } = useAppStore(
    useShallow((state) => ({
      setInventoryOpen: state.setInvOpen,
      resetResonator: state.resetRes,
      undo: state.undo,
      redo: state.redo,
      undoTo: state.undoTo,
      redoTo: state.redoTo,
      activeResonatorId: selActResId(state),
      haveHistory: state.ui.haveHistory,
      historyPast: state.history.past,
      historyFuture: state.history.future,
    })),
  )

  const canUndo = historyScope
    ? historyScope.past.length > 0
    : RUNTIME_APP_HISTORY_ENABLED && haveHistory && historyPast.length > 0
  const canRedo = historyScope
    ? historyScope.future.length > 0
    : RUNTIME_APP_HISTORY_ENABLED && haveHistory && hstrFtr.length > 0
  // undo entries are shown newest-first while redo entries stay forward order.
  const undoHistory = useMemo(
    () => historyScope
      ? historyScope.past.slice().reverse()
      : RUNTIME_APP_HISTORY_ENABLED && haveHistory ? historyPast.slice().reverse() : [],
    [haveHistory, historyPast, historyScope],
  )
  const redoHistory = useMemo(
    () => historyScope
      ? historyScope.future.slice()
      : RUNTIME_APP_HISTORY_ENABLED && haveHistory ? hstrFtr.slice() : [],
    [haveHistory, historyScope, hstrFtr],
  )
  const effectiveUndo = historyScope?.undo ?? undo
  const effectiveRedo = historyScope?.redo ?? redo
  const effectiveUndoTo = historyScope?.undoTo ?? undoTo
  const effectiveRedoTo = historyScope?.redoTo ?? redoTo

  const registerHistoryScope = useCallback((scope: RouteHistoryScope) => {
    setHistoryScope(scope)
    return () => {
      setHistoryScope((current) => current === scope ? null : current)
    }
  }, [])

  const isNvgtLinkAc = useCallback((to: string) => (
    to === location.pathname || (to !== '/' && location.pathname.startsWith(`${to}/`))
  ), [location.pathname])

  const navigateTo = useCallback((to: string) => {
    navigate(to)
  }, [navigate])

  const openInv = useCallback(() => {
    if (!simulationActive) {
      navigate(SIMULATION_ROUTES.modulation)
    }
    setInvOpen(true)
  }, [navigate, setInvOpen, simulationActive])

  const tglOpt = useCallback(() => {
    navigate(optimizerActive ? SIMULATION_ROUTES.modulation : SIMULATION_ROUTES.optimizer)
  }, [navigate, optimizerActive])

  const openModulation = useCallback(() => {
    navigate(SIMULATION_ROUTES.modulation)
  }, [navigate])

  const tglRotEd = useCallback(() => {
    navigate(
      isSimulationSurfaceRoute(location.pathname, 'rotation')
        ? SIMULATION_ROUTES.modulation
        : SIMULATION_ROUTES.rotation,
    )
  }, [location.pathname, navigate])

  const openStatus = useCallback(() => {
    appStatus.show()
  }, [appStatus])

  const rstActRes = useCallback(() => {
    if (!actResId) {
      return
    }

    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: 'This will reset the active resonator to default settings (level 1, no echoes, default weapon). Saved inventory items are not affected.',
      confirmLabel: 'Reset',
      variant: 'danger',
      onConfirm: () => {
        rstRes(actResId)
        showToast({
          content: 'Reset~ ദ്ദി ˉ꒳ˉ )✧',
          variant: 'success',
          duration: 3000,
        })
      },
    })
  }, [actResId, confirmation, rstRes, showToast])

  const builders = useMemo(() => ({
    routeChrome: {
      // expose builders instead of concrete arrays so menus can request fresh
      // entries at open time from the latest route and history state.
      undoRedo: () => routeCtxBuilder.routeChrome.undoRedo({
        canUndo,
        canRedo,
        undoHistory,
        redoHistory,
        onUndoTo: effectiveUndoTo,
        onRedoTo: effectiveRedoTo,
      }),
      pages: () => routeCtxBuilder.routeChrome.pages({
        pages: rtNavLnks,
        isPageCur: isNvgtLinkAc,
        onNavigate: navigateTo,
      }),
      actions: () => routeCtxBuilder.routeChrome.actions({
        optAct: optimizerActive,
        modulationActive,
        onOpenInv: openInv,
        onTgglOpt: tglOpt,
        onOpenModulation: openModulation,
        onOpenStatus: openStatus,
      }),
      reset: () => routeCtxBuilder.routeChrome.reset({
        canReset: Boolean(actResId),
        onReset: rstActRes,
      }),
      bttmSec: () => routeCtxBuilder.routeChrome.bttmSctn({
        pages: rtNavLnks,
        isPageCur: isNvgtLinkAc,
        onNavigate: navigateTo,
        canUndo,
        canRedo,
        undoHistory,
        redoHistory,
        onUndo: effectiveUndo,
        onRedo: effectiveRedo,
        onUndoTo: effectiveUndoTo,
        onRedoTo: effectiveRedoTo,
        optAct: optimizerActive,
        modulationActive,
        onOpenInv: openInv,
        onTgglOpt: tglOpt,
        onOpenModulation: openModulation,
        onOpenStatus: openStatus,
        canReset: Boolean(actResId),
        onReset: rstActRes,
      }),
      simulationSection: () => routeCtxBuilder.routeChrome.simulationSection({
        pages: rtNavLnks,
        isPageCur: isNvgtLinkAc,
        onNavigate: navigateTo,
        canUndo,
        canRedo,
        undoHistory,
        redoHistory,
        onUndo: effectiveUndo,
        onRedo: effectiveRedo,
        onUndoTo: effectiveUndoTo,
        onRedoTo: effectiveRedoTo,
        optAct: optimizerActive,
        modulationActive,
        onOpenInv: openInv,
        onTgglOpt: tglOpt,
        onOpenModulation: openModulation,
        onOpenStatus: openStatus,
        canReset: Boolean(actResId),
        onReset: rstActRes,
      }),
    },
  }), [
    actResId,
    modulationActive,
    canRedo,
    canUndo,
    redoHistory,
    effectiveRedo,
    effectiveRedoTo,
    effectiveUndo,
    effectiveUndoTo,
    isNvgtLinkAc,
    navigateTo,
    openInv,
    openStatus,
    rstActRes,
    tglOpt,
    openModulation,
    undoHistory,
    optimizerActive,
  ])

  const value = useMemo<RouteMenuValue>(() => ({
    pageLinks: rtNavLnks,
    legacyCalculatorViews,
    actions: {
      navigateTo,
      undo: effectiveUndo,
      redo: effectiveRedo,
      canUndo: () => canUndo,
      canRedo: () => canRedo,
      registerHistoryScope,
      openInv: openInv,
      tgglOpt: tglOpt,
      openModulation,
      tgglRotEd: tglRotEd,
      openStatus,
      rstActRes: rstActRes,
    },
    builders,
  }), [
    builders,
    navigateTo,
    canRedo,
    canUndo,
    effectiveRedo,
    effectiveUndo,
    openInv,
    openStatus,
    rstActRes,
    tglOpt,
    openModulation,
    tglRotEd,
    registerHistoryScope,
  ])

  return (
    <RouteMenuContext.Provider value={value}>
      {children}
      <ConfirmHost control={confirmation} portalTarget={typeof document !== 'undefined' ? document.body : null} />
      <AppSttsMdl
        visible={appStatus.visible}
        open={appStatus.open}
        closing={appStatus.closing}
        onClose={appStatus.hide}
      />
      <TeamConsoleHost />
      <WeaponConsoleHost />
      <EchoConsoleHost />
    </RouteMenuContext.Provider>
  )
}
