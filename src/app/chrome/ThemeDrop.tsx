/*
  Author: Runor Ewhro
  Description: The display switch, on the line. The head used to carry a single
               Dawn/Dusk row in the drawer while the thirteen variants lived on
               the settings page, so changing the app's whole look meant leaving
               the page you were on. All of them open from one glyph here.

               The glyph is a contrast mark rather than a sun, because it opens
               a choice rather than flipping one, and because a sun and the
               Settings gear are the same shape at this size and those two sit
               within a few pixels of each other.
*/

import { useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SlidersHorizontal as SldrHrzn } from 'lucide-react'
import { useAppStore } from '@/domain/state/store'
import { THEME_BY_MODE, THEME_PREVIEW } from '@/domain/entities/themes'
import type { BgThemeVar, DarkThemeVar, LightThemeVar, ThemeVariant } from '@/domain/entities/themes'
import type { ThemeMode } from '@/domain/entities/appState'
import { AnchoredAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'
import { Tooltip } from '@/shared/ui/Tooltip'

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
  const { ui, setTheme, setLightVar, setDarkVar, setBgVar, setBlurMode } = useAppStore(
    useShallow((state) => ({
      ui: state.ui,
      setTheme: state.setTheme,
      setLightVar: state.setLightVar,
      setDarkVar: state.setDarkVar,
      setBgVar: state.setBgVar,
      setBlurMode: state.setBlurMode,
    })),
  )

  const mode = ui.theme
  const standing = mode === 'background'
    ? ui.backgroundVariant
    : mode === 'dark' ? ui.darkVariant : ui.lightVariant

  useAppPopupDismiss({
    open,
    onDismiss: onClose,
    hostRef,
    popupRef,
    returnFocusRef: triggerRef,
    pointerEvent: 'mousedown',
  })

  // picking a swatch settles the variant and the mode together, since the point
  // of a swatch is that the app looks like the thing you just pressed
  const pick = (variant: ThemeVariant) => {
    if (mode === 'background') {
      setBgVar(variant as BgThemeVar)
    } else if (mode === 'dark') {
      setDarkVar(variant as DarkThemeVar)
    } else {
      setLightVar(variant as LightThemeVar)
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
          onClick={onToggle}
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
              onClick={() => setBlurMode(!ui.blurMode)}
            >
              <SldrHrzn size="1rem" aria-hidden="true" />
              <span>Blur</span>
              <span className="ax-item-val">{ui.blurMode ? 'On' : 'Off'}</span>
            </button>
          ) : null}
      </AnchoredAppPopup>
    </div>
  )
}
