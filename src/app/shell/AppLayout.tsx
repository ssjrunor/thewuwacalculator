/*
  Author: Runor Ewhro
  Description: Owns the persistent application layout, route-level behavior,
               global hosts, and the routed content aperture.
*/

import { useCallback, useEffect, useLayoutEffect as useLytFfct, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { RosterColumn, SkllDataProv } from '@/modules/simulation/api/chrome'
import { useSimulationSurface } from '@/modules/simulation/api/route'
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
import { useAppCtxMen } from '@/application/context-menu/AppContextMenu'
import { SIMULATION_SURFACES, isSimulationRoute, isSimulationSurfaceRoute } from '@/shared/lib/appRoutes'
import {
  getCurChngTs,
  ltstCurChngE,
} from '@/data/content/changelogEntries'
import { RtMenuProv } from '@/app/shell/context-menu/RouteMenuProvider'
import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import { isDtblVntTgt } from '@/shared/lib/isEditableEventTarget'
import { useCkBoot } from '@/app/hooks/useCookieBootstrap'
import { usePageTrck } from '@/app/hooks/usePageTracking'
import { useSeoMeta } from '@/app/hooks/useSeoMeta'
import { useShellTheme } from '@/app/shell/useShellTheme'
import { GlobalHosts } from '@/app/shell/GlobalHosts'

const CHNGTSTSTORE = 'seen-changelog-version'
let chngTstShwn = false

// Preserve the canonical simulation-route ordering used by chrome navigation.
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
  const contextMenu = useAppCtxMen()

  const { updateToast, shellClassName } = useShellTheme()

  // Scroll restoration belongs to the routed aperture rather than the persistent shell.
  const aperture = useRef<HTMLElement | null>(null)
  useMainScroll(aperture)

  /* Pages mount below the header but can replace its stamp action. Wrap the
     callback so React never interprets registration as a functional update. */
  const [stamp, holdStamp] = useState<{ run: () => void } | null>(null)
  const [toolsPort, setToolsPort] = useState<HTMLElement | null>(null)
  const setStamp = useCallback(
      (run: (() => void) | null) => holdStamp(run ? { run } : null),
      [],
  )

  const showToast = useTstStr((state) => state.show)

  useLytFfct(() => setFrontDoor(location.pathname), [location.pathname])

  useEffect(() => {
    if (!updateToast || chngTstShwn || !ltstCurChngE?.shortDesc) {
      return
    }

    const ltstVrsn = getCurChngTs(ltstCurChngE)
    if (localStorage.getItem(CHNGTSTSTORE) === ltstVrsn) {
      return
    }

    chngTstShwn = true
    showToast({
      content: (
        <span dangerouslySetInnerHTML={{ __html: ltstCurChngE.shortDesc }} />
      ),
      variant: 'success',
      duration: 60000,
      onClick: () => {
        localStorage.setItem(CHNGTSTSTORE, ltstVrsn)
        rtChrmMenu.actions.openStatus()
      },
    })
  }, [rtChrmMenu.actions, showToast, updateToast])

  const isSimulation = isSimulationRoute(location.pathname)
  const surface = useSimulationSurface()
  const rosterUp = surface !== null && SIMULATION_SURFACES[surface].roster
  const atSimulation = useMemo<SimulationPageId | null>(() => (
    SIMULATION_ROUTE_IDS.find((page) => isSimulationSurfaceRoute(location.pathname, page)) ?? null
  ), [location.pathname])

  // Temporary legacy tools still belong to the Simulation route family.
  const simulating = isSimulation

  const rtCtxMenuTms = useMemo(
    () => rtChrmMenu.builders.routeChrome.bttmSec(),
    [rtChrmMenu.builders.routeChrome],
  )

  useLytFfct(() => {
    // Register route actions at the global context-menu boundary for blank surfaces.
    contextMenu.setGlblTms(rtCtxMenuTms)

    return () => {
      contextMenu.setGlblTms([])
    }
  }, [contextMenu, rtCtxMenuTms])

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

  return (
    /* One provider keeps skill-data modal state shared across chrome and routed
       Simulation tools. */
    <SkllDataProv>
      <ContextTrigger
        asChild
        ariaLabel="App actions"
        items={[]}
      >
        <div className={shellClassName}>
          <div className="app-wallpaper" aria-hidden="true" />
          <div className="ax-field" aria-hidden="true" />

          <ChromeToolsProv port={toolsPort}>
            <div className="ax-chrome">
              <ChromeHeader
                at={atSimulation}
                stamp={stamp?.run}
                tools={<AppTools simulating={simulating} />}
                onPort={setToolsPort}
              />

              {/* Keep the roster outside Outlet so route changes do not remount it. */}
              {rosterUp ? <RosterColumn /> : null}

              <main className="main-content" ref={aperture}>
                <Outlet context={{ setStamp } satisfies ChromeIndexCtx} />
              </main>
            </div>
          </ChromeToolsProv>

          <GlobalHosts simulating={simulating} />
        </div>
      </ContextTrigger>
    </SkllDataProv>
  )
}
