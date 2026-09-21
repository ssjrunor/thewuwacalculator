/*
  Author: Runor Ewhro
  Description: Holds reference and legal navigation on every route, alongside
               workspace panes and reset actions for the legacy Calculator.
*/

import { useRef } from 'react'
import type { ComponentType } from 'react'
import { useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  BookOpen,
  FileText,
  History,
  RotateCcw,
  Scale,
  Shield,
  Settings as SttngsGlyph,
} from 'lucide-react'
import { useAppStore } from '@/application/state'
import { selActResId } from '@/application/state'
import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import { AnchoredAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'
import { APP_NAVIGATION, LEGACY_SIMULATION_ROUTES } from '@/shared/lib/appRoutes'
import { AxLink } from '@/shared/navigation/useNavX'
import { READ_PAGES } from '@/application/navigation/appIndex'

const REF_GLYPHS: Record<string, ComponentType<{ size?: string, 'aria-hidden'?: boolean }>> = {
  Docs: FileText,
  Guides: BookOpen,
  Changelog: History,
  Calibration: SttngsGlyph,
}

const LEGAL_PAGES = [
  { ...APP_NAVIGATION.privacy, Glyph: Shield },
  { ...APP_NAVIGATION.terms, Glyph: Scale },
]

interface AppDrawerProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
}

export function AppDrawer({ open, onToggle, onClose }: AppDrawerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const location = useLocation()
  const rtChrmMenu = useRtChrmMen()

  const { ui, openLeftView, actResId } = useAppStore(
    useShallow((state) => ({
      ui: state.ui,
      openLeftView: state.openLeftView,
      actResId: selActResId(state),
    })),
  )

  const isLegacyCalculator = location.pathname === LEGACY_SIMULATION_ROUTES.calculator

  // Glyph assets are selected by the resolved light/dark text mode.
  const iconTheme = (
    ui.theme === 'background' ? ui.backgroundTextMode === 'dark' : ui.theme === 'dark'
  ) ? 'dark' : 'light'

  const openLegacyCalculatorPane = (key: typeof rtChrmMenu.legacyCalculatorViews[number]['key']) => {
    if (!isLegacyCalculator) {
      rtChrmMenu.actions.navigateTo(LEGACY_SIMULATION_ROUTES.calculator)
    }
    openLeftView(key)
    onClose()
  }

  useAppPopupDismiss({
    open,
    onDismiss: onClose,
    hostRef,
    popupRef,
    returnFocusRef: triggerRef,
    pointerEvent: 'mousedown',
  })

  return (
    <div className="ax-drop-holder" ref={hostRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`ax-drop${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open Read"
        onClick={onToggle}
      >
        Read
        <span className="ax-drop__caret" aria-hidden="true" />
      </button>

      <AnchoredAppPopup
        visible={open}
        anchorRef={triggerRef}
        popupRef={popupRef}
        portalClassName="ax-menu"
        align="end"
        maxHeight={560} className="app-popup--chrome ax-pop--menu"
        open={open}
        role="menu"
      >
        <div className="ax-grp">
          <p className="ax-grp-lbl">Read</p>

          {READ_PAGES.map((reference) => {
            const Glyph = REF_GLYPHS[reference.name] ?? FileText

            return (
              <AxLink className="ax-item"
                role="menuitem"
                key={reference.name}
                to={reference.to}
                onClick={onClose}
              >
                <Glyph size="1rem" aria-hidden={true} />
                <span>{reference.name}</span>
              </AxLink>
            )
          })}
        </div>

        {isLegacyCalculator ? (
          <div className="ax-grp">
            <p className="ax-grp-lbl">Workspace</p>

            <div className="ax-panes">
              {rtChrmMenu.legacyCalculatorViews.map((view) => (
                <button
                  type="button"
                  role="menuitem"
                  className={`ax-pane${ui.leftPaneView === view.key ? ' is-at' : ''}`}
                  key={view.key}
                  title={view.label}
                  onClick={() => openLegacyCalculatorPane(view.key)}
                >
                  <img
                    src={`/assets/app/icons/${iconTheme}/${view.icon}.png`}
                    alt=""
                    loading="lazy"
                  />
                  <span>{view.label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              role="menuitem" className="ax-item is-danger"
              disabled={!actResId}
              onClick={() => { rtChrmMenu.actions.rstActRes(); onClose() }}
            >
              <RotateCcw size="1rem" aria-hidden="true" />
              <span>Reset resonator</span>
            </button>
          </div>
        ) : null}

        <div className="ax-grp">
          <p className="ax-grp-lbl">Legal</p>
          {LEGAL_PAGES.map(({ name, to, Glyph }) => (
            <AxLink className="ax-item" role="menuitem" key={to} to={to} onClick={onClose}>
              <Glyph size="1rem" aria-hidden="true" />
              <span>{name}</span>
            </AxLink>
          ))}
        </div>
      </AnchoredAppPopup>
    </div>
  )
}
