/*
  Author: Runor Ewhro
  Description: The other half of the app. The head stands one family on the line
               and this holds the other, so on a surface you work on it is Docs,
               Guides, Changelog and Settings, and on a page you read it is the
               four Simulation tools with their scope. That is why it is
               named for what it is holding rather than called "More": the half
               that is not on the line is never simply missing.

               Under that it keeps what belongs to neither family and has
               nowhere else to stand: the workspace panes and the reset, which
               only exist on the legacy Calculator route, and the two app entries.
*/

import { useMemo, useRef } from 'react'
import type { ComponentType } from 'react'
import { useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  BookOpen,
  FileText,
  History,
  RotateCcw,
  Settings as SttngsGlyph,
} from 'lucide-react'
import { FaInfo } from 'react-icons/fa'
import { RiHeartsFill } from 'react-icons/ri'
import { useAppStore } from '@/domain/state/store'
import { selActResId } from '@/domain/state/selectors'
import { useRtChrmMen } from '@/shared/context-menu/routeMenuContext'
import { AnchoredAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'
import { LEGACY_SIMULATION_ROUTES } from '@/shared/lib/appRoutes'
import { getCuteMsg } from '@/shared/util/cuteMessages'
import { getStrdGglTk } from '@/infra/googleDrive/googleAuth'
import { useTstStr } from '@/shared/util/toastStore'
import { AxLink } from '@/app/nav/useNavX'
import { READ_PAGES, SIMULATION_PAGES } from '@/app/chrome/appIndex'
import { SurfaceGlyph } from '@/app/chrome/surfaceGlyphs'

// a reference is a word on the line, where the word is the whole of the entry.
// standing them here puts them among items read by their glyph first, so each
// one is given the shape of what it opens.
const REF_GLYPHS: Record<string, ComponentType<{ size?: string, 'aria-hidden'?: boolean }>> = {
  Docs: FileText,
  Guides: BookOpen,
  Changelog: History,
  Settings: SttngsGlyph,
}

interface AppDrawerProps {
  // which family the line is carrying, which is the one this is not holding
  onLine: 'simulation' | 'read'
  open: boolean
  onToggle: () => void
  onClose: () => void
}

export function AppDrawer({ onLine, open, onToggle, onClose }: AppDrawerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const location = useLocation()
  const rtChrmMenu = useRtChrmMen()
  const showToast = useTstStr((state) => state.show)

  const { ui, openLeftView, actResId } = useAppStore(
    useShallow((state) => ({
      ui: state.ui,
      openLeftView: state.openLeftView,
      actResId: selActResId(state),
    })),
  )

  const isLegacyCalculator = location.pathname === LEGACY_SIMULATION_ROUTES.calculator

  // the pane icons are drawn for one ink and have to be asked for by the ink
  // the chrome is currently wearing
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

  const sayHi = () => {
    onClose()
    const userName = getStrdGglTk()?.user?.name ?? null
    window.setTimeout(() => {
      showToast({ content: getCuteMsg(userName), duration: 5000 })
    }, 300)
  }

  // the drawer is named for the half it is holding, and that is the half the
  // line is not carrying
  const stowed = useMemo(() => (
    onLine === 'simulation'
      ? { label: 'Read', title: 'Open Read' }
      : { label: 'Simulation', title: 'Open Simulation' }
  ), [onLine])

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
        aria-label={stowed.title}
        onClick={onToggle}
      >
        {stowed.label}
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
            <p className="ax-grp-lbl">{stowed.label}</p>

            {onLine === 'simulation'
              ? READ_PAGES.map((reference) => {
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
                })
              : SIMULATION_PAGES.map((page) => (
                  <AxLink className="ax-item"
                    role="menuitem"
                    key={page.id}
                    to={page.to}
                    onClick={onClose}
                  >
                    <span className="ax-item-glyph" aria-hidden="true">
                      <SurfaceGlyph id={page.id} />
                    </span>
                    <span>{page.name}</span>
                    <span className="ax-item-val">{page.scope}</span>
                  </AxLink>
                ))}
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
            <p className="ax-grp-lbl">App</p>

            <button
              type="button"
              role="menuitem" className="ax-item"
              onClick={() => { rtChrmMenu.actions.navigateTo('/info'); onClose() }}
            >
              <FaInfo size="1rem" aria-hidden="true" />
              <span>Info</span>
            </button>

            <button type="button" role="menuitem" className="ax-item" onClick={sayHi}>
              <RiHeartsFill size="1rem" aria-hidden="true" />
              <span>Say hi</span>
            </button>
          </div>
      </AnchoredAppPopup>
    </div>
  )
}
