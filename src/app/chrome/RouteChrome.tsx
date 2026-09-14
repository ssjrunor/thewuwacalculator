/*
  Author: Runor Ewhro
  Description: The route shell. It wears the same chrome the index does: one
               head across the top, the index furled into the rail down the
               left edge, and the route's own page in the rest. It also owns
               what outlives a route, being the stored theme, the global
               shortcuts, the changelog toast and the context entry points
               shared across Simulation routes.
*/

import { useCallback, useEffect, useLayoutEffect as useLytFfct, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/domain/state/store'
import { ALL_THEMES } from '@/domain/entities/themes'
import { SkllDataProv } from '@/modules/simulation/features/resonator/SkillDataHost.tsx'
import { EnemyConsoleHost } from '@/modules/simulation/features/enemies/ConsoleHost.tsx'
import { AppChrome } from '@/app/chrome/AppChrome'
import { AppTools } from '@/app/chrome/AppTools'
import { useMainScroll } from '@/app/nav/useMainScroll'
import { NavSweep } from '@/app/nav/NavSweep'
import { SIMULATION_PAGES } from '@/app/chrome/appIndex'
import type { SimulationPageId } from '@/app/chrome/appIndex'
import type { ChromeIndexCtx } from '@/app/chrome/chromeIndex'
import { NtfcTstCntn } from '@/shared/ui/NotificationToast'
import { DlyNtc } from '@/app/chrome/DailyNotice'
import { CookieBanner } from '@/shared/ui/CookieBanner'
import { useCkBnnr } from '@/app/hooks/useCookieBanner.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { useAppCtxMen } from '@/shared/ui/AppContextMenu'
import { isSimulationRoute, isSimulationSurfaceRoute, standsRoster } from '@/shared/lib/appRoutes'
import { RosterColumn } from '@/modules/simulation/workspace/RosterColumn'
import {
  getCurChngTs,
  ltstCurChngE,
} from '@/data/content/changelogEntries'
import { RtMenuProv } from '@/shared/context-menu/RouteCtx'
import { useRtChrmMen } from '@/shared/context-menu/routeMenuContext'
import { isDtblVntTgt } from '@/shared/lib/isEditableEventTarget'
import { EchoImportHost } from '@/modules/simulation/features/echoes/EchoImportHost.tsx'

const CHNGTSTSTORE = 'seen-changelog-version'
let chngTstShwn = false

// every page of the work, in the order the line stands them in. a route that is
// not one of them still wears the same line; it simply has no word standing.
const SIMULATION_ROUTE_IDS: SimulationPageId[] = SIMULATION_PAGES.map((page) => page.id)

export function RouteChrome() {
  return (
    <RtMenuProv>
      <RtChrmCntn />
    </RtMenuProv>
  )
}

function RtChrmCntn() {
  const location = useLocation()
  const rtChrmMenu = useRtChrmMen()
  const contextMenu = useAppCtxMen()

  const ui = useAppStore(useShallow((state) => state.ui))

  // the aperture is the only thing a navigation moves, so it is also the only
  // thing that has to remember where it was read from
  const aperture = useRef<HTMLElement | null>(null)
  useMainScroll(aperture)

  /*
    The head's stamp, when the route wants it. It is held here rather than in
    the head because the page that takes it is mounted under the head, and it is
    kept as a record rather than as the function itself so that registering one
    is never mistaken for a state updater.
  */
  const [stamp, holdStamp] = useState<{ run: () => void } | null>(null)
  const setStamp = useCallback(
      (run: (() => void) | null) => holdStamp(run ? { run } : null),
      [],
  )

  const cookieBanner = useCkBnnr()
  const showToast = useTstStr((state) => state.show)

  useEffect(() => {
    if (!ui.preferences.updateToast || chngTstShwn || !ltstCurChngE?.shortDesc) {
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
  }, [rtChrmMenu.actions, showToast, ui.preferences])

  const isSimulation = isSimulationRoute(location.pathname)
  const rosterUp = standsRoster(location.pathname)
  const atSimulation = useMemo<SimulationPageId | null>(() => (
    SIMULATION_ROUTE_IDS.find((page) => isSimulationSurfaceRoute(location.pathname, page)) ?? null
  ), [location.pathname])

  // which family the route belongs to, which is the whole of what the head
  // Simulation routes stand the tool family on the line; Read and Home routes
  // stand the reading family. Temporary legacy tools retain Simulation chrome.
  const simulating = isSimulation

  const actVar = useMemo(() => {
    if (ui.theme === 'background') {
      return ui.backgroundVariant
    }

    return ui.theme === 'dark' ? ui.darkVariant : ui.lightVariant
  }, [ui.backgroundVariant, ui.darkVariant, ui.lightVariant, ui.theme])

  const shllClssName = [
    'app-shell',
    // the chrome's own scope: it carries the tokens the head and the rail are
    // drawn from, and nothing that would reach into the routed page
    'ax',
    actVar,
    ui.blurMode ? 'blur-off' : '',
    ui.entranceAnimations ? '' : 'no-entrance-anim reduce-animation',
    ui.theme === 'background'
      ? `${ui.backgroundTextMode}-text`
      : ui.theme === 'dark'
        ? 'dark-text'
        : 'light-text',
  ]
    .filter(Boolean)
    .join(' ')

  useLytFfct(() => {
    const root = document.documentElement
    const themeClasses = [...ALL_THEMES, 'blur-off', 'no-entrance-anim', 'reduce-animation', 'light-text', 'dark-text']
    const textModeClss = ui.theme === 'background'
      ? `${ui.backgroundTextMode}-text`
      : ui.theme === 'dark'
        ? 'dark-text'
        : 'light-text'

    root.classList.remove(...themeClasses)
    root.classList.add(actVar)
    root.classList.add(textModeClss)

    if (ui.blurMode) root.classList.add('blur-off')
    if (!ui.entranceAnimations) root.classList.add('no-entrance-anim', 'reduce-animation')


    root.dataset.themeLocked = 'true'
    root.dataset.themeLoaded = 'true'
  }, [actVar, ui.backgroundTextMode, ui.blurMode, ui.entranceAnimations, ui.theme])

  const rtCtxMenuTms = useMemo(
    () => rtChrmMenu.builders.routeChrome.bttmSec(),
    [rtChrmMenu.builders.routeChrome],
  )

  useLytFfct(() => {
    // global route actions are registered with the app context menu so blank
    // surface menus still expose navigation, history, and reset actions.
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
    /* the skill-data modal lives above the chrome so the head's team summary
       and every routed Simulation tool open the same one */
    <SkllDataProv>
      <ContextTrigger
        asChild
        ariaLabel="App actions"
        items={[]}
      >
        <div className={shllClssName}>
          {/* the two grounds the chrome stands on, in the order they are lit:
              the theme's wallpaper, then the lattice over it. they are elements
              rather than the shell's two pseudos because those are spent on the
              blooms, which a theme rule on the shell would otherwise outrank. */}
          <div className="app-wallpaper" aria-hidden="true" />
          <div className="ax-field" aria-hidden="true" />

          <AppChrome
            at={atSimulation}
            simulating={simulating}
            stamp={stamp?.run}
            tools={<AppTools simulating={simulating} />}
          >
            {/* the roster stands beside the page rather than inside it, which
                is the whole of why it survives a navigation: the outlet swaps
                and the column is not part of the swap */}
            {rosterUp ? <RosterColumn /> : null}

            <main className="main-content" ref={aperture}>
              <Outlet context={{ setStamp } satisfies ChromeIndexCtx} />
            </main>
          </AppChrome>

          <EchoImportHost />

          {/* the target the whole app calculates against, opened from the head */}
          {simulating ? <EnemyConsoleHost /> : null}

          <NavSweep />

          <DlyNtc />

          <NtfcTstCntn />

          <CookieBanner
            visible={cookieBanner.visible}
            open={cookieBanner.open}
            closing={cookieBanner.closing}
            onAccept={cookieBanner.accept}
          />
        </div>
      </ContextTrigger>
    </SkllDataProv>
  )
}
