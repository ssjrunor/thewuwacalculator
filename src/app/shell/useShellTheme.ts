/*
  Author: Runor Ewhro
  Description: Applies the active application theme to the document and
               resolves the persistent shell class list.
*/

import { useLayoutEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type AppStore } from '@/application/state'
import { applyDocumentTheme } from '@/application/theme/documentTheme'

export function selectShellTheme(state: AppStore) {
  return {
    theme: state.ui.theme,
    backgroundVariant: state.ui.backgroundVariant,
    backgroundTextMode: state.ui.backgroundTextMode,
    darkVariant: state.ui.darkVariant,
    lightVariant: state.ui.lightVariant,
    blurMode: state.ui.blurMode,
    entranceAnimations: state.ui.entranceAnimations,
    updateToast: state.ui.preferences.updateToast,
  }
}

export function useShellTheme() {
  const shell = useAppStore(useShallow(selectShellTheme))
  const activeVariant = useMemo(() => {
    if (shell.theme === 'background') return shell.backgroundVariant
    return shell.theme === 'dark' ? shell.darkVariant : shell.lightVariant
  }, [shell.backgroundVariant, shell.darkVariant, shell.lightVariant, shell.theme])

  const textMode = shell.theme === 'background'
    ? shell.backgroundTextMode
    : shell.theme === 'dark' ? 'dark' : 'light'
  const textModeClass = `${textMode}-text`

  const shellClassName = [
    'app-shell',
    'ax',
    activeVariant,
    shell.blurMode ? 'blur-off' : '',
    shell.entranceAnimations ? '' : 'no-entrance-anim reduce-animation',
    textModeClass,
  ].filter(Boolean).join(' ')

  useLayoutEffect(() => {
    applyDocumentTheme(activeVariant, textMode, shell.blurMode, shell.entranceAnimations)
    const root = document.documentElement
    root.dataset.themeLocked = 'true'
    root.dataset.themeLoaded = 'true'
  }, [activeVariant, shell.blurMode, shell.entranceAnimations, textMode])

  return { updateToast: shell.updateToast, shellClassName }
}
