/*
  Author: Runor Ewhro
  description: renders the application layout, global hosts, header, and routed content and handles route-level effects.
*/

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect as useLytFfct, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useSimulationSurface } from '@/modules/simulation/api/route'
import { RosterLoadingPlaceholder } from '@/modules/simulation/api/rosterPlaceholder'
import { ChromeHeader } from '@/app/shell/ChromeHeader'
import { AppTools } from '@/app/shell/AppTools'
import { ChromeToolsProv } from '@/application/ui/toolsPort'
import { useMainScroll } from '@/app/nav/useMainScroll'
import { setFrontDoor } from '@/shared/navigation/navMotion'
import { SIMULATION_PAGES } from '@/application/navigation/appIndex'
import type { SimulationPageId } from '@/application/navigation/appIndex'
import type { ChromeIndexCtx } from '@/application/navigation/chromeIndex'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import { useMenuContributions } from '@/application/context-menu/AppContextMenu'
import { APP_ROUTES, SIMULATION_SURFACES, isSimulationRoute, isSimulationSurfaceRoute } from '@/shared/lib/appRoutes'
import { CURRENT_CHANGE_NOTICE, CURRENT_CHANGE_NOTICE_KEY } from '@/data/content/currentChangelogNotice'
import { RtMenuProv } from '@/app/shell/context-menu/RouteMenuProvider'
import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import { isDtblVntTgt } from '@/shared/lib/isEditableEventTarget'
import { useCkBoot } from '@/app/hooks/useCookieBootstrap'
import { usePageTrck } from '@/app/hooks/usePageTracking'
import { useSeoMeta } from '@/app/hooks/useSeoMeta'
import { useShellTheme } from '@/app/shell/useShellTheme'
import { GlobalHosts } from '@/app/shell/GlobalHosts'
import { hasMobileRoute, useMobileUi } from '@/shared/responsive/mobileUi'

const CHNGTSTSTORE = 'seen-changelog-version'
const RosterColumn = lazy(async () => ({ default: (await import('@/modules/simulation/api/roster')).RosterColumn }))
let chngTstShwn = false

// preserve the canonical simulation-route ordering used by chrome navigation.
const SIMULATION_ROUTE_IDS: SimulationPageId[] = SIMULATION_PAGES.map((page) => page.id)

export function AppLayout() {
  useCkBoot()
  useSeoMeta()
  usePageTrck()

  return (
    <RtMenuProv>
      <AppLayoutContent />
    </RtMenuProv>
  )
}

function AppLayoutContent() {
  const location = useLocation()
  const rtChrmMenu = useRtChrmMen()

  const { updateToast, shellClassName } = useShellTheme()

  // the routed content area handles scroll restoration.
  const scrollContainer = useRef<HTMLElement | null>(null)
  useMainScroll(scrollContainer)

  /* pages mount below the header but can replace its stamp action. wrap the
     callback so react never interprets registration as a functional update. */
  const [stamp, holdStamp] = useState<{ run: () => void } | null>(null)
  // toast clicks can happen after navigation, so resolve the route action at click time.
  const stampAction = useRef<(() => void) | null>(null)
  const [toolsPort, setToolsPort] = useState<HTMLElement | null>(null)
  const setStamp = useCallback(
      (run: (() => void) | null) => {
        stampAction.current = run
        holdStamp(run ? { run } : null)
      },
      [],
  )

  const showToast = useTstStr((state) => state.show)

  const mobileUi = useMobileUi()
  const phone = mobileUi && hasMobileRoute(location.pathname)
  useLytFfct(() => {
    document.documentElement.classList.toggle('mshell-on', phone)
    document.documentElement.classList.toggle('mui', mobileUi)
  }, [mobileUi, phone])

  useLytFfct(() => setFrontDoor(location.pathname), [location.pathname])

  useEffect(() => {
    if (!updateToast || chngTstShwn) {
      return
    }

    const ltstVrsn = CURRENT_CHANGE_NOTICE_KEY
    if (localStorage.getItem(CHNGTSTSTORE) === ltstVrsn) {
      return
    }

    chngTstShwn = true
    showToast({
      content: (
        <span dangerouslySetInnerHTML={{ __html: CURRENT_CHANGE_NOTICE.shortDesc }} />
      ),
      variant: 'success',
      duration: 60000,
      onClick: () => {
        localStorage.setItem(CHNGTSTSTORE, ltstVrsn)
        if (stampAction.current) stampAction.current()
        else rtChrmMenu.actions.openStatus()
      },
    })
  }, [rtChrmMenu.actions, showToast, updateToast])

  const isSimulation = isSimulationRoute(location.pathname)
  const surface = useSimulationSurface()
  const rosterUp = surface !== null && SIMULATION_SURFACES[surface].roster
  const atSimulation = useMemo<SimulationPageId | null>(() => (
    SIMULATION_ROUTE_IDS.find((page) => isSimulationSurfaceRoute(location.pathname, page)) ?? null
  ), [location.pathname])

  // temporary legacy tools still belong to the simulation route family.
  const simulating = isSimulation

  const rtCtxMenuTms = useMemo(
    () => rtChrmMenu.builders.routeChrome.bttmSec(),
    [rtChrmMenu.builders.routeChrome],
  )

  const backgroundContributions = useMemo(() => [{
    id: 'route-actions',
    group: 'app',
    build: () => rtCtxMenuTms,
  }], [rtCtxMenuTms])
  useMenuContributions('app.background', backgroundContributions)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isDtblVntTgt(event.target)) {
        return
      }

      const commandKey = event.metaKey || event.ctrlKey
      if (!commandKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() === 'z') {
        const redoShortcut = event.shiftKey
        if (redoShortcut
          ? !rtChrmMenu.actions.canRedo()
          : !rtChrmMenu.actions.canUndo()) {
          return
        }

        event.preventDefault()
        if (redoShortcut) {
          rtChrmMenu.actions.redo()
        } else {
          rtChrmMenu.actions.undo()
        }
        return
      }

      if (!event.shiftKey && event.key.toLowerCase() === 'y') {
        if (!rtChrmMenu.actions.canRedo()) {
          return
        }

        event.preventDefault()
        rtChrmMenu.actions.redo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rtChrmMenu.actions])

  if (phone) {
    return (
      <ContextTrigger asChild ariaLabel="App actions" location="app.background" touchLongPress={false}>
      <div className={`${shellClassName} mshell`}>
        <main className="mshell-main" ref={scrollContainer}>
          <Outlet context={{ setStamp } satisfies ChromeIndexCtx} />
        </main>
        <GlobalHosts simulating={false} />
      </div>
      </ContextTrigger>
    )
  }

  return (
      <ContextTrigger
        asChild
        ariaLabel="App actions"
        location="app.background"
        touchLongPress={false}
      >
        <div className={shellClassName}>
          <div className="app-wallpaper" aria-hidden="true" />
          <div className="ax-field" aria-hidden="true" />

          <ChromeToolsProv port={toolsPort}>
            <div className="ax-chrome">
              <ChromeHeader
                at={atSimulation ?? (location.pathname.startsWith(APP_ROUTES.leaderboard) ? 'leaderboard' : null)}
                stamp={stamp?.run}
                tools={<AppTools simulating={simulating} />}
                onPort={setToolsPort}
              />

              {/* the roster stays mounted outside outlet across route changes. */}
              {rosterUp ? <Suspense fallback={<RosterLoadingPlaceholder />}><RosterColumn /></Suspense> : null}

              <main className="main-content" ref={scrollContainer}>
                <Outlet context={{ setStamp } satisfies ChromeIndexCtx} />
              </main>
            </div>
          </ChromeToolsProv>

          <GlobalHosts simulating={simulating} />
        </div>
      </ContextTrigger>
  )
}
