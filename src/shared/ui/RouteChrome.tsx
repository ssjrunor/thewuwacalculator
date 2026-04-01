/*
  Author: Runor Ewhro
  Description: Renders the shared application shell, including the toolbar,
               sidebar navigation, route outlet, and global overlay UI.
*/

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react'
import { useAppStore } from '@/domain/state/store'
import { selectActiveResonatorId } from '@/domain/state/selectors'
import type { LeftPaneView } from '@/domain/entities/appState'
import { ALL_THEME_VARIANTS } from '@/domain/entities/themes'
import { useResponsiveSidebar } from '@/app/hooks/useResponsiveSidebar.ts'
import { RiHeartsFill, RiMoonClearFill } from 'react-icons/ri'
import { FaMicrochip } from 'react-icons/fa6'
import { BsPersonVcard } from 'react-icons/bs'
import { FaInfo, FaQuestion, FaSun } from 'react-icons/fa'
import { RxActivityLog } from 'react-icons/rx'
import { GiPokecog, GiSchoolBag } from 'react-icons/gi'
import { IoSparkles } from 'react-icons/io5'
import { ImHistory } from 'react-icons/im'
import { NotificationToastContainer } from '@/shared/ui/NotificationToast'
import { ConfirmationModal } from '@/shared/ui/ConfirmationModal'
import { AppStatusModal } from '@/shared/ui/AppStatusModal'
import { CookieBanner } from '@/shared/ui/CookieBanner'
import { useConfirmation } from '@/app/hooks/useConfirmation.ts'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility.ts'
import { useCookieBanner } from '@/app/hooks/useCookieBanner.ts'
import { useToastStore } from '@/shared/util/toastStore.ts'
import { getCuteMessage } from '@/shared/util/cuteMessages.ts'
import { getStoredGoogleTokens } from '@/infra/googleDrive/googleAuth.ts'

const ALERT_TOAST_KEY = 'alert-toast-dismissed'
let alertToastShown = false

interface NavigationLink {
  to: string
  label: string
  Icon: typeof IoSparkles
  iconClassName?: string
}

// primary sidebar navigation links
const navigationLinks: NavigationLink[] = [
  { to: '/', label: 'Home', Icon: IoSparkles },
  { to: '/settings', label: 'Settings', Icon: GiPokecog, iconClassName: 'settings-icon' },
  { to: '/info', label: 'Info', Icon: FaInfo },
  { to: '/guides', label: 'Guides', Icon: FaQuestion, iconClassName: 'help-icon' },
  { to: '/changelog', label: 'Changelog', Icon: ImHistory, iconClassName: 'changelog-icon' },
]

// calculator toolbar view buttons
const calculatorToolbarViews: Array<{ key: LeftPaneView; label: string; icon: string }> = [
  { key: 'resonators', label: 'Resonators', icon: 'resonator' },
  { key: 'weapon', label: 'Weapon', icon: 'weapon' },
  { key: 'echoes', label: 'Echoes', icon: 'echoes' },
  { key: 'suggestions', label: 'Suggestions', icon: 'suggestions' },
  { key: 'teams', label: 'Team Buffs', icon: 'teams' },
  { key: 'enemy', label: 'Enemy', icon: 'enemy' },
  { key: 'buffs', label: 'Custom Bonuses', icon: 'buffs' },
  { key: 'rotations', label: 'Rotation', icon: 'rotations' },
]

export function RouteChrome() {
  const location = useLocation()
  const navigate = useNavigate()

  const {
    ui,
    setTheme,
    setMainMode,
    setBlurMode,
    setLeftPaneView,
    setInventoryOpen,
    resetResonator,
    activeResonatorId,
  } = useAppStore(
      useShallow((state) => ({
        ui: state.ui,
        setTheme: state.setTheme,
        setMainMode: state.setMainMode,
        setBlurMode: state.setBlurMode,
        setLeftPaneView: state.setLeftPaneView,
        setInventoryOpen: state.setInventoryOpen,
        resetResonator: state.resetResonator,
        activeResonatorId: selectActiveResonatorId(state),
      })),
  )

  const confirmation = useConfirmation()
  const appStatus = useAnimatedVisibility()
  const cookieBanner = useCookieBanner()
  const showToast = useToastStore((state) => state.show)

  const [showDropdown, setShowDropdown] = useState(false)
  const [moveToolbarToSidebar, setMoveToolbarToSidebar] = useState(false)
  const {
    hamburgerOpen,
    setHamburgerOpen,
    isMobile,
    isOverlayVisible,
    isOverlayClosing,
  } = useResponsiveSidebar()

  // show a persistent alert toast on mount that opens the app status modal
  useEffect(() => {
    if (alertToastShown || localStorage.getItem(ALERT_TOAST_KEY)) return
    alertToastShown = true
    showToast({
      content: 'ALERT: CLICK ME!',
      variant: 'warning',
      duration: 0,
      position: 'top-center',
      onClick: () => {
        localStorage.setItem(ALERT_TOAST_KEY, '1')
        appStatus.show()
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // move calculator toolbar into the sidebar on smaller screens
  useEffect(() => {
    const onResize = () => {
      setMoveToolbarToSidebar(window.innerWidth < 900)
    }

    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isCalculatorRoute = location.pathname === '/'

  // resolve the current active navigation item from the route
  const activeNavigationLink = useMemo(() => {
    const exactMatch = navigationLinks.find(({ to }) => to === location.pathname)
    if (exactMatch) {
      return exactMatch
    }

    const fallbackMatch = navigationLinks.find(({ to }) => to !== '/' && location.pathname.startsWith(`${to}/`))
    return fallbackMatch ?? navigationLinks[0]
  }, [location.pathname])

  // show all links except the currently active one in the dropdown
  const dropdownNavigationLinks = useMemo(
      () => navigationLinks.filter(({ to }) => to !== activeNavigationLink.to),
      [activeNavigationLink.to],
  )

  const navigateTo = (to: string) => {
    navigate(to)
    setShowDropdown(false)
    if (isMobile) {
      setHamburgerOpen(false)
    }
  }

  // resolve the currently applied visual theme variant
  const activeVariant = useMemo(() => {
    if (ui.theme === 'background') {
      return ui.backgroundVariant
    }

    return ui.theme === 'dark' ? ui.darkVariant : ui.lightVariant
  }, [ui.backgroundVariant, ui.darkVariant, ui.lightVariant, ui.theme])

  const shellClassName = [
    'app-shell',
    activeVariant,
    ui.blurMode === 'off' ? 'blur-off' : '',
    ui.entranceAnimations === 'off' ? 'no-entrance-anim' : '',
    ui.theme === 'background'
      ? `${ui.backgroundTextMode}-text`
      : ui.theme === 'dark'
        ? 'dark-text'
        : 'light-text',
  ]
      .filter(Boolean)
      .join(' ')

  // sync body classes with the selected ui theme settings
  useEffect(() => {
    const body = document.body
    const themeClasses = [...ALL_THEME_VARIANTS, 'blur-off', 'no-entrance-anim', 'dark-text', 'light-text']
    const textModeClass =
      ui.theme === 'background'
        ? `${ui.backgroundTextMode}-text`
        : ui.theme === 'dark'
          ? 'dark-text'
          : 'light-text'

    body.classList.remove(...themeClasses)
    body.classList.add(activeVariant, textModeClass)

    if (ui.blurMode === 'off') {
      body.classList.add('blur-off')
    }
    if (ui.entranceAnimations === 'off') {
      body.classList.add('no-entrance-anim')
    }
  }, [activeVariant, ui.backgroundTextMode, ui.blurMode, ui.entranceAnimations, ui.theme])

  const themeToggleLabel = ui.theme === 'dark' ? 'Dawn' : 'Dusk'

  return (
      <div className={shellClassName}>
        <header className="toolbar">
          <button
              type="button"
              className={hamburgerOpen ? 'hamburger-button open' : 'hamburger-button'}
              onClick={() => setHamburgerOpen((prev) => !prev)}
              aria-label="Toggle sidebar"
          >
            <span />
            <span />
            <span />
          </button>

          {isCalculatorRoute && !moveToolbarToSidebar ? (
              <div className="toolbar-group">
                {calculatorToolbarViews.map((view, index) => {
                  const isActive = ui.mainMode === 'default' && ui.leftPaneView === view.key

                  return (
                      <button
                          key={view.key}
                          type="button"
                          className={isActive ? 'toolbar-icon-button active' : 'toolbar-icon-button'}
                          aria-label={view.label}
                          aria-pressed={isActive}
                          title={view.label}
                          style={{ '--toolbar-index': index } as CSSProperties}
                          onClick={() => {
                            setMainMode('default')
                            setLeftPaneView(view.key)
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
                  isMobile ? (hamburgerOpen ? 'open' : '') : hamburgerOpen ? 'expanded' : 'collapsed'
              }`}
          >
            <div className="sidebar-content">
              <button
                  type="button"
                  className={showDropdown ? 'sidebar-button active' : 'sidebar-button'}
                  onClick={() => setShowDropdown((prev) => !prev)}
              >
                <div className="icon-slot">
                  <activeNavigationLink.Icon size={24} className={activeNavigationLink.iconClassName} />
                </div>
                <div className="label-slot">
                  <span className="label-text">{activeNavigationLink.label}</span>
                </div>
              </button>

              <div className={showDropdown ? 'sidebar-dropdown open' : 'sidebar-dropdown'}>
                {dropdownNavigationLinks.map(({ to, label, Icon, iconClassName }) => (
                    <button
                        key={to}
                        type="button"
                        className="sidebar-sub-button"
                        onClick={() => navigateTo(to)}
                    >
                      <div className="icon-slot">
                        <Icon size={24} className={iconClassName} />
                      </div>
                      <div className="label-slot">
                        <span className="label-text">{label}</span>
                      </div>
                    </button>
                ))}
              </div>

              {isCalculatorRoute && (
                  <>
                    {moveToolbarToSidebar && (
                        <div className="sidebar-toolbar">
                          {calculatorToolbarViews.map((view) => (
                              <button
                                  key={view.key}
                                  type="button"
                                  className={ui.leftPaneView === view.key ? 'sidebar-button active' : 'sidebar-button'}
                                  onClick={() => {
                                    setMainMode('default')
                                    setLeftPaneView(view.key)
                                    if (isMobile) {
                                      setHamburgerOpen(false)
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
                    )}

                    <button
                        type="button"
                        className="sidebar-button"
                        onClick={() => {
                          setInventoryOpen(true)
                          if (isMobile) {
                            setHamburgerOpen(false)
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
                        onClick={() => setMainMode(ui.mainMode === 'optimizer' ? 'default' : 'optimizer')}
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
                        onClick={() => setMainMode(ui.mainMode === 'overview' ? 'default' : 'overview')}
                    >
                      <div className="icon-slot">
                        <BsPersonVcard size={24} />
                      </div>
                      <div className="label-slot">
                        <span className="label-text">Overview</span>
                      </div>
                    </button>

                    <button
                        type="button"
                        className="sidebar-button"
                        onClick={() => {
                          appStatus.show()
                          if (isMobile) setHamburgerOpen(false)
                        }}
                    >
                      <div className="icon-slot">
                        <RxActivityLog size={24} />
                      </div>
                      <div className="label-slot">
                        <span className="label-text">Status</span>
                      </div>
                    </button>
                  </>
              )}

              {ui.theme !== 'background' && (
                  <button
                      type="button"
                      className="sidebar-button"
                      onClick={() => setTheme(ui.theme === 'dark' ? 'light' : 'dark')}
                  >
                    <div className="icon-slot theme-toggle-icon">
                      <FaSun className="icon-sun" size={24} />
                      <RiMoonClearFill className="icon-moon" size={24} />
                    </div>
                    <div className="label-slot">
                      <span className="label-text">{themeToggleLabel}</span>
                    </div>
                  </button>
              )}

              <button
                  type="button"
                  className="sidebar-button"
                  onClick={() => setBlurMode(ui.blurMode === 'on' ? 'off' : 'on')}
              >
                <div className="icon-slot">
                  <SlidersHorizontal size={24} />
                </div>
                <div className="label-slot">
                  <span className="label-text">Blur {ui.blurMode === 'on' ? 'On' : 'Off'}</span>
                </div>
              </button>
            </div>

            <div className="sidebar-footer">
              <button
                  type="button"
                  className="sidebar-button"
                  onClick={() => {
                    // mirror the old delayed greeting behavior and reuse the signed-in name when available.
                    const userName = getStoredGoogleTokens()?.user?.name ?? null

                    window.setTimeout(() => {
                      showToast({
                        content: getCuteMessage(userName),
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

              <button
                  type="button"
                  className="sidebar-button reset"
                  disabled={!activeResonatorId}
                  onClick={() => confirmation.confirm({
                    title: 'You sure about that? ( · ❛ ֊ ❛)',
                    message: 'This will reset the active resonator to default settings (level 1, no echoes, default weapon). Saved inventory items are not affected.',
                    confirmLabel: 'Reset',
                    variant: 'danger',
                    onConfirm: () => {
                      if (activeResonatorId) {
                        resetResonator(activeResonatorId)
                        useToastStore.getState().show({
                          content: `Reset~ ദ്ദി ˉ꒳ˉ )✧`,
                          variant: 'success',
                          duration: 3000,
                        })
                      }
                    },
                  })}
              >
                <div className="icon-slot">
                  <RotateCcw size={24} className="reset-icon" />
                </div>
                <div className="label-slot">
                  <span className="label-text">Reset</span>
                </div>
              </button>
            </div>
          </aside>

          {/* mobile sidebar overlay */}
          {isOverlayVisible && isMobile && (
              <div
                  className={`mobile-overlay ${hamburgerOpen ? 'visible' : ''} ${isOverlayClosing ? 'closing' : ''}`}
                  onClick={() => setHamburgerOpen(false)}
              />
          )}

          <main className="main-content">
            <Outlet />
          </main>

          <NotificationToastContainer />

          <ConfirmationModal
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

          <AppStatusModal
              visible={appStatus.visible}
              open={appStatus.open}
              closing={appStatus.closing}
              onClose={appStatus.hide}
          />

          <CookieBanner
              visible={cookieBanner.visible}
              open={cookieBanner.open}
              closing={cookieBanner.closing}
              onAccept={cookieBanner.accept}
          />
        </div>
      </div>
  )
}
