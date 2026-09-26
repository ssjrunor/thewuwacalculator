/*
  Author: Runor Ewhro
  Description: Selects persisted theme variants and their light/dark mode
               through an anchored popup with shared dismissal handling.
*/

import { useCallback, useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SlidersHorizontal as SldrHrzn } from 'lucide-react'
import { useAppStore } from '@/application/state'
import { THEME_BY_MODE, THEME_PREVIEW } from '@/domain/entities/themes'
import { applyDocumentTheme } from '@/application/theme/documentTheme'
import type { BgThemeVar, DarkThemeVar, LightThemeVar, ThemeVariant } from '@/domain/entities/themes'
import type { ThemeMode } from '@/domain/entities/appState'
import { AnchoredAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'
import { Tooltip } from '@/shared/ui/Tooltip'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession'

const MODES: { key: ThemeMode, label: string }[] = [
  { key: 'light', label: 'Dawn' },
  { key: 'dark', label: 'Dusk' },
  { key: 'background', label: 'Wallpaper' },
]

function ContrastGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2z" fill="currentColor" stroke="none" />
    </svg>
  )
}

interface ThemeDropProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
}

export function ThemeDrop({ open, onToggle, onClose }: ThemeDropProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const { ui, commitAppearanceConfig } = useAppStore(
    useShallow((state) => ({
      ui: state.ui,
      commitAppearanceConfig: state.commitAppearanceConfig,
    })),
  )
  const session = useConfigurationSession({
    source: ui,
    active: open,
    commit: commitAppearanceConfig,
  })
  const draftUi = session.draft

  const mode = draftUi.theme
  const standing = mode === 'background'
    ? draftUi.backgroundVariant
    : mode === 'dark' ? draftUi.darkVariant : draftUi.lightVariant

  useAppPopupDismiss({
    open,
    onDismiss: onClose,
    hostRef,
    popupRef,
    returnFocusRef: triggerRef,
    pointerEvent: 'mousedown',
  })

  const setTheme = useCallback((theme: ThemeMode) => {
    session.update((current) => ({
      ...current,
      theme,
      themePreference: theme,
    }))
  }, [session])

  useLayoutEffect(() => {
    if (!open) return
    const textMode = draftUi.theme === 'background'
      ? draftUi.backgroundTextMode
      : draftUi.theme === 'dark' ? 'dark' : 'light'
    const variant = draftUi.theme === 'background'
      ? draftUi.backgroundVariant
      : draftUi.theme === 'dark' ? draftUi.darkVariant : draftUi.lightVariant
    applyDocumentTheme(variant, textMode, draftUi.blurMode, draftUi.entranceAnimations)
  }, [draftUi, open])

  // A variant selection updates its mode as well as that mode's stored theme.
  const pick = (variant: ThemeVariant) => {
    if (mode === 'background') {
      session.update((current) => ({ ...current, backgroundVariant: variant as BgThemeVar }))
    } else if (mode === 'dark') {
      session.update((current) => ({ ...current, darkVariant: variant as DarkThemeVar }))
    } else {
      session.update((current) => ({ ...current, lightVariant: variant as LightThemeVar }))
    }
  }

  return (
    <div className="ax-drop-holder" ref={hostRef}>
      <Tooltip content="Display" placement="bottom">
        <button
          ref={triggerRef}
          type="button"
          className={`ax-g${open ? ' is-open' : ''}`}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Display"
          onClick={open ? onClose : onToggle}
        >
          <ContrastGlyph />
        </button>
      </Tooltip>

      <AnchoredAppPopup
        visible={open}
        anchorRef={triggerRef}
        popupRef={popupRef}
        portalClassName="ax-menu"
        align="end"
        maxHeight={544} className="app-popup--chrome ax-pop--theme"
        open={open}
        role="menu"
      >
          <div className="ax-modes">
            {MODES.map((one) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={mode === one.key}
                className={`ax-mode${mode === one.key ? ' is-at' : ''}`}
                key={one.key}
                onClick={() => setTheme(one.key)}
              >
                {one.label}
              </button>
            ))}
          </div>

          <div className="ax-swatches">
            {THEME_BY_MODE[mode].map((variant) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={standing === variant}
                className={`ax-sw${standing === variant ? ' is-at' : ''}`}
                key={variant}
                title={variant.replace(/-/g, ' ')}
                style={{ background: THEME_PREVIEW[variant] }}
                onClick={() => pick(variant)}
              />
            ))}
          </div>

          {mode === 'background' ? (
            <button
              type="button"
              role="menuitem" className="ax-item"
              onClick={() => session.update((current) => ({ ...current, blurMode: !current.blurMode }))}
            >
              <SldrHrzn size="1rem" aria-hidden="true" />
              <span>Blur</span>
              <span className="ax-item-val">{draftUi.blurMode ? 'On' : 'Off'}</span>
            </button>
          ) : null}
      </AnchoredAppPopup>
    </div>
  )
}
