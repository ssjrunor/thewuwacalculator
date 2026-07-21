/*
  Author: Runor Ewhro
  Description: provides route-chrome menu builders and route-level actions
               such as navigation, history, inventory access, and reset flows.
*/

import { createContext as mkCtx, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useCnfr } from '@/app/hooks/useConfirmation'
import { selActResId } from '@/domain/state/selectors'
import { useAppStore } from '@/domain/state/store'
import { AppSttsMdl } from '@/shared/ui/AppStatusModal'
import { CnfrMdl } from '@/shared/ui/ConfirmationModal'
import { useAppModal } from '@/shared/ui/useAppModal'
import { routeCtxBuilder } from '@/shared/context-menu/routeCtxBuilders.tsx'
import {
  rtCalcVws,
  rtNavLnks,
  type RtCalcView,
  type RouteNavLink,
} from '@/shared/ui/routeChromeConfig'
import { useTstStr } from '@/shared/util/toastStore'

interface RtCtxVl {
  pageLinks: RouteNavLink[]
  clclVws: RtCalcView[]
  actions: {
    navigateTo: (to: string) => void
    undo: () => void
    redo: () => void
    openInv: () => void
    tgglOpt: () => void
    tgglBnch: () => void
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
      clclSec: () => ReturnType<typeof routeCtxBuilder.routeChrome.calcSctn>
    }
  }
}

const RouteCtx = mkCtx<RtCtxVl | null>(null)

export function RtMenuProv({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const confirmation = useCnfr()
  const appStatus = useAppModal()
  const showToast = useTstStr((state) => state.show)
  const {
    setInventoryOpen: setInvOpen,
    ensureInventoryHydrated: ensInvHydr,
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
      ensureInventoryHydrated: state.ensInvHydr,
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

  const canUndo = haveHistory && historyPast.length > 0
  const canRedo = haveHistory && hstrFtr.length > 0
  // undo entries are shown newest-first while redo entries stay forward order.
  const undoHistory = useMemo(() => haveHistory ? historyPast.slice().reverse() : [], [haveHistory, historyPast])
  const redoHistory = useMemo(() => haveHistory ? hstrFtr.slice() : [], [haveHistory, hstrFtr])

  const isNvgtLinkAc = useCallback((to: string) => (
    to === location.pathname || (to !== '/' && location.pathname.startsWith(`${to}/`))
  ), [location.pathname])

  const navigateTo = useCallback((to: string) => {
    navigate(to)
  }, [navigate])

  const openInv = useCallback(() => {
    if (location.pathname !== '/calculator' && !location.pathname.startsWith('/calculator/')) {
      navigate('/calculator')
    }
    setInvOpen(true)
  }, [location.pathname, navigate, setInvOpen])

  const tglOpt = useCallback(() => {
    ensInvHydr()
    navigate(location.pathname === '/calculator/optimizer' ? '/calculator' : '/calculator/optimizer')
  }, [ensInvHydr, location.pathname, navigate])

  const tglBnch = useCallback(() => {
    navigate(location.pathname === '/calculator/benchmark' ? '/calculator' : '/calculator/benchmark')
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
        onUndoTo: undoTo,
        onRedoTo: redoTo,
      }),
      pages: () => routeCtxBuilder.routeChrome.pages({
        pages: rtNavLnks,
        isPageCur: isNvgtLinkAc,
        onNavigate: navigateTo,
      }),
      actions: () => routeCtxBuilder.routeChrome.actions({
        optAct: location.pathname === '/calculator/optimizer',
        bnchAct: location.pathname === '/calculator/benchmark',
        onOpenInv: openInv,
        onTgglOpt: tglOpt,
        onTgglBnch: tglBnch,
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
        onUndo: undo,
        onRedo: redo,
        onUndoTo: undoTo,
        onRedoTo: redoTo,
        optAct: location.pathname === '/calculator/optimizer',
        bnchAct: location.pathname === '/calculator/benchmark',
        onOpenInv: openInv,
        onTgglOpt: tglOpt,
        onTgglBnch: tglBnch,
        onOpenStatus: openStatus,
        canReset: Boolean(actResId),
        onReset: rstActRes,
      }),
      clclSec: () => routeCtxBuilder.routeChrome.calcSctn({
        pages: rtNavLnks,
        isPageCur: isNvgtLinkAc,
        onNavigate: navigateTo,
        canUndo,
        canRedo,
        undoHistory,
        redoHistory,
        onUndo: undo,
        onRedo: redo,
        onUndoTo: undoTo,
        onRedoTo: redoTo,
        optAct: location.pathname === '/calculator/optimizer',
        bnchAct: location.pathname === '/calculator/benchmark',
        onOpenInv: openInv,
        onTgglOpt: tglOpt,
        onTgglBnch: tglBnch,
        onOpenStatus: openStatus,
        canReset: Boolean(actResId),
        onReset: rstActRes,
      }),
    },
  }), [
    actResId,
    canRedo,
    canUndo,
    redoHistory,
    redoTo,
    isNvgtLinkAc,
    navigateTo,
    openInv,
    openStatus,
    rstActRes,
    redo,
    tglOpt,
    tglBnch,
    undo,
    undoHistory,
    undoTo,
    location.pathname,
  ])

  const value = useMemo<RtCtxVl>(() => ({
    pageLinks: rtNavLnks,
    clclVws: rtCalcVws,
    actions: {
      navigateTo,
      undo,
      redo,
      openInv: openInv,
      tgglOpt: tglOpt,
      tgglBnch: tglBnch,
      openStatus,
      rstActRes: rstActRes,
    },
    builders,
  }), [
    builders,
    navigateTo,
    redo,
    openInv,
    openStatus,
    rstActRes,
    tglOpt,
    tglBnch,
    undo,
  ])

  return (
    <RouteCtx.Provider value={value}>
      {children}
      <CnfrMdl
        visible={confirmation.visible}
        open={confirmation.open}
        closing={confirmation.closing}
        portalTarget={typeof document !== 'undefined' ? document.body : null}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        cancelLabel={confirmation.cancelLabel}
        variant={confirmation.variant}
        onConfirm={confirmation.onConfirm}
        onCancel={confirmation.onCancel}
      />
      <AppSttsMdl
        visible={appStatus.visible}
        open={appStatus.open}
        closing={appStatus.closing}
        onClose={appStatus.hide}
      />
    </RouteCtx.Provider>
  )
}

export function useRtChrmMen(): RtCtxVl {
  const context = useContext(RouteCtx)
  if (!context) {
    throw new Error('useRouteChromeMenu must be used within RouteMenuProvider')
  }

  return context
}
