/*
  Author: Runor Ewhro
  Description: Renders the shared application shell, including the toolbar,
               sidebar navigation, route outlet, and global overlay UI.
*/

import { useEffect, useLayoutEffect as useLytFfct, useMemo, useState, type CSSProperties as CssProps } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  SlidersHorizontal as SldrHrzn,
  RotateCcw,
} from 'lucide-react'
import { useAppStore } from '@/domain/state/store'
import { selActResId } from '@/domain/state/selectors'
import { ALL_THEMES } from '@/domain/entities/themes'
import { useRspnSdbr } from '@/app/hooks/useResponsiveSidebar.ts'
import { RiHeartsFill, RiMoonClearFill as RiMoonClrFil } from 'react-icons/ri'
import { FaSun } from 'react-icons/fa'
import { FaMicrochip } from 'react-icons/fa6'
import { BsPersonVcard as BsPrsnVcrd } from 'react-icons/bs'
import { RxActivityLog as RxCtvtLog } from 'react-icons/rx'
import { GiSchoolBag } from 'react-icons/gi'
import { NtfcTstCntn } from '@/shared/ui/NotificationToast'
import { CookieBanner } from '@/shared/ui/CookieBanner'
import { useCkBnnr } from '@/app/hooks/useCookieBanner.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { useAppCtxMen } from '@/shared/ui/AppContextMenu'
import { getCuteMsg } from '@/shared/util/cuteMessages.ts'
import { getStrdGglTk } from '@/infra/googleDrive/googleAuth.ts'
import {
  getCurChngTs,
  ltstCurChngE,
} from '@/data/content/changelogEntries'
import { RtMenuProv, useRtChrmMen } from '@/shared/context-menu/RouteCtx.tsx'
import { isDtblVntTgt } from '@/shared/lib/isEditableEventTarget'
import Thewuwacalculator from '@/assets/thewuwacalculator.svg?react'

const CHNGTSTSTORE = 'seen-changelog-version'
let chngTstShwn = false

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

  const {
    ui,
    setTheme,
    setBlurMode,
    openLeftPaneView: openLeftPane,
    activeResonatorId: actResId,
  } = useAppStore(
    useShallow((state) => ({
      ui: state.ui,
      setTheme: state.setTheme,
      setBlurMode: state.setBlurMode,
      openLeftPaneView: state.openLeftView,
      activeResonatorId: selActResId(state),
    })),
  )

  const cookieBanner = useCkBnnr()
  const showToast = useTstStr((state) => state.show)

  const [showDropdown, setShowDrpd] = useState(false)
  const [moveTlbrToSd, setMoveTlbrT] = useState(false)
  const {
    hamburgerOpen: hambOpen,
    setHamburgerOpen: setHambOpen,
    isMobile,
    isOverlayVisible: isOvrVis,
    isOverlayClosing: isOvrCls,
  } = useRspnSdbr()

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
      position: 'top-center',
      onClick: () => {
        localStorage.setItem(CHNGTSTSTORE, ltstVrsn)
        rtChrmMenu.actions.openStatus()
      },
    })
  }, [rtChrmMenu.actions, showToast, ui.preferences])

  useEffect(() => {
    const onResize = () => {
      // narrow screens keep navigation in the header while desktop has room for
      // sidebar-owned toolbar actions.
      setMoveTlbrT(window.innerWidth < 900)
    }

    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isCalcRt = location.pathname === '/'

  const isNvgtLinkAc = (to: string) => (
    to === location.pathname || (to !== '/' && location.pathname.startsWith(`${to}/`))
  )

  const navigateTo = (to: string) => {
    rtChrmMenu.actions.navigateTo(to)
    setShowDrpd(false)
    if (isMobile) {
      setHambOpen(false)
    }
  }

  const actVar = useMemo(() => {
    if (ui.theme === 'background') {
      return ui.backgroundVariant
    }

    return ui.theme === 'dark' ? ui.darkVariant : ui.lightVariant
  }, [ui.backgroundVariant, ui.darkVariant, ui.lightVariant, ui.theme])

  const shllClssName = [
    'app-shell',
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

  const themeTglLbl = ui.theme === 'dark' ? 'Dawn' : 'Dusk'
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

      if (!event.shiftKey && event.key.toLowerCase() === 'z') {
        if (!useAppStore.getState().canUndo()) {
          return
        }

        event.preventDefault()
        rtChrmMenu.actions.undo()
        return
      }

      if (!event.shiftKey && event.key.toLowerCase() === 'y') {
        if (!useAppStore.getState().canRedo()) {
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
    <ContextTrigger
      asChild
      ariaLabel="App actions"
      items={[]}
    >
      <div className={shllClssName}>
      <header className="toolbar">
        <button
          type="button"
          className={hambOpen ? 'hamburger-button open' : 'hamburger-button'}
          onClick={() => setHambOpen((prev) => !prev)}
          aria-label="Toggle sidebar"
        >
          <span />
          <span />
          <span />
        </button>

        {isCalcRt && !moveTlbrToSd ? (
          <div className="toolbar-group">
            {rtChrmMenu.clclVws.map((view, index) => {
              const isActive = ui.mainMode === 'default' && ui.leftPaneView === view.key

              return (
                <button
                  key={view.key}
                  type="button"
                  className={isActive ? 'toolbar-icon-button active' : 'toolbar-icon-button'}
                  aria-label={view.label}
                  aria-pressed={isActive}
                  title={view.label}
                  style={{ '--toolbar-index': index } as CssProps}
                  onClick={() => {
                    openLeftPane(view.key)
                  }}
                >
                  <span className="toolbar-icon-shell" aria-hidden="true">
                    <span className="toolbar-icon-liquid toolbar-icon-liquid--primary" />
                    <span className="toolbar-icon-liquid toolbar-icon-liquid--secondary" />
                    <img
                      src={`/assets/icons/${ui.theme === 'dark' ? 'dark' : 'light'}/${view.icon}.png`}
                      alt=""
                      className="toolbar-icon-image"
                      loading="lazy"
                    />
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <h4 className="toolbar-title">Wuthering Waves Damage Calculator &amp; Optimizer</h4>
        )}
      </header>

      <div className="horizontal-layout">
        <aside
          className={`sidebar ${
            isMobile ? (hambOpen ? 'open' : '') : hambOpen ? 'expanded' : 'collapsed'
          }`}
        >
          <div className="sidebar-content">
            <button
              type="button"
              className={showDropdown ? 'sidebar-button active' : 'sidebar-button'}
              onClick={() => setShowDrpd((prev) => !prev)}
              aria-expanded={showDropdown}
              aria-controls="route-navigation-dropdown"
            >
              <div className="icon-slot">
                <Thewuwacalculator width={24} height={24} aria-hidden="true" />
              </div>
              <div className="label-slot">
                <span className="label-text">Pages</span>
              </div>
            </button>

            <div
              id="route-navigation-dropdown"
              className={showDropdown ? 'sidebar-dropdown open' : 'sidebar-dropdown'}
            >
              {rtChrmMenu.pageLinks.map(({ to, label, Icon, iconClssName: iconClssName }) => (
                <button
                  key={to}
                  type="button"
                  className={isNvgtLinkAc(to) ? 'sidebar-sub-button selected' : 'sidebar-sub-button'}
                  onClick={() => navigateTo(to)}
                >
                  <div className="icon-slot">
                    <Icon size={24} className={iconClssName} />
                  </div>
                  <div className="label-slot">
                    <span className="label-text">{label}</span>
                  </div>
                </button>
              ))}
            </div>

            {isCalcRt ? (
              <>
                {moveTlbrToSd ? (
                  <div className="sidebar-toolbar">
                    {rtChrmMenu.clclVws.map((view) => (
                      <button
                        key={view.key}
                        type="button"
                        className={ui.leftPaneView === view.key ? 'sidebar-button active' : 'sidebar-button'}
                        onClick={() => {
                          openLeftPane(view.key)
                          if (isMobile) {
                            setHambOpen(false)
                          }
                        }}
                      >
                        <div className="icon-slot">
                          <img
                            src={`/assets/icons/${ui.theme === 'dark' ? 'dark' : 'light'}/${view.icon}.png`}
                            alt={view.label}
                            style={{ maxWidth: '24px', maxHeight: '24px', minWidth: '24px', minHeight: '24px' }}
                            loading="lazy"
                          />
                        </div>
                        <div className="label-slot">
                          <span className="label-text">{view.label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                <button
                  type="button"
                  className="sidebar-button"
                  onClick={() => {
                    rtChrmMenu.actions.openInv()
                    if (isMobile) {
                      setHambOpen(false)
                    }
                  }}
                >
                  <div className="icon-slot">
                    <GiSchoolBag size={24} />
                  </div>
                  <div className="label-slot">
                    <span className="label-text">Inventory</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={ui.mainMode === 'optimizer' ? 'sidebar-button selected' : 'sidebar-button'}
                  onClick={() => rtChrmMenu.actions.tgglOpt()}
                >
                  <div className="icon-slot">
                    <FaMicrochip size={24} />
                  </div>
                  <div className="label-slot">
                    <span className="label-text">Optimizer</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={ui.mainMode === 'overview' ? 'sidebar-button selected' : 'sidebar-button'}
                  onClick={() => rtChrmMenu.actions.tgglVrvw()}
                >
                  <div className="icon-slot">
                    <BsPrsnVcrd size={24} />
                  </div>
                  <div className="label-slot">
                    <span className="label-text">Overview</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="sidebar-button"
                  onClick={() => {
                    rtChrmMenu.actions.openStatus()
                    if (isMobile) {
                      setHambOpen(false)
                    }
                  }}
                >
                  <div className="icon-slot">
                    <RxCtvtLog size={24} />
                  </div>
                  <div className="label-slot">
                    <span className="label-text">Status</span>
                  </div>
                </button>
              </>
            ) : null}

            {ui.theme !== 'background' ? (
              <button
                type="button"
                className="sidebar-button"
                onClick={() => setTheme(ui.theme === 'dark' ? 'light' : 'dark')}
              >
                <div className="icon-slot theme-toggle-icon">
                  <FaSun className="icon-sun" size={24} />
                  <RiMoonClrFil className="icon-moon" size={24} />
                </div>
                <div className="label-slot">
                  <span className="label-text">{themeTglLbl}</span>
                </div>
              </button>
            ) : (
              <button
                type="button"
                className="sidebar-button"
                onClick={() => setBlurMode(!ui.blurMode)}
              >
                <div className="icon-slot">
                  <SldrHrzn size={24} />
                </div>
                <div className="label-slot">
                  <span className="label-text">Blur {ui.blurMode ? 'On' : 'Off'}</span>
                </div>
              </button>
            )}
          </div>

          <div className="sidebar-footer">
            <button
              type="button"
              className="sidebar-button"
              onClick={() => {
                const userName = getStrdGglTk()?.user?.name ?? null

                window.setTimeout(() => {
                  showToast({
                    content: getCuteMsg(userName),
                    duration: 5000,
                  })
                }, 300)
              }}
            >
              <div className="icon-slot">
                <RiHeartsFill size={24} />
              </div>
              <div className="label-slot">
                <span className="label-text">Say Hi~!</span>
              </div>
            </button>

            <a
              href="https://discord.gg/wNaauhE4uH"
              target="_blank"
              rel="noopener noreferrer"
              className="sidebar-button discord"
            >
              <div className="icon-slot">
                <img
                  src="/assets/icons/discord.svg"
                  alt="Discord"
                  className="discord-icon"
                  style={{ maxWidth: '24px', maxHeight: '24px' }}
                />
              </div>
              <div className="label-slot">
                <span className="label-text">Discord</span>
              </div>
            </a>

            {isCalcRt && (
              <button
                type="button"
                className="sidebar-button reset"
                disabled={!actResId}
                onClick={rtChrmMenu.actions.rstActRes}
              >
                <div className="icon-slot">
                  <RotateCcw size={24} className="reset-icon" />
                </div>
                <div className="label-slot">
                  <span className="label-text">Reset</span>
                </div>
              </button>
            )}
          </div>
        </aside>

        {isOvrVis && isMobile ? (
          <div
            className={`mobile-overlay ${hambOpen ? 'visible' : ''} ${isOvrCls ? 'closing' : ''}`}
            onClick={() => setHambOpen(false)}
          />
        ) : null}

        <main className="main-content">
          <Outlet />
        </main>

        <NtfcTstCntn />

        <CookieBanner
          visible={cookieBanner.visible}
          open={cookieBanner.open}
          closing={cookieBanner.closing}
          onAccept={cookieBanner.accept}
        />
      </div>
      </div>
    </ContextTrigger>
  )
}
