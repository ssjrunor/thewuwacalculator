/*
  Author: Runor Ewhro
  Description: Applies the active application theme to the document and
               resolves the persistent shell class list.
*/

import { useLayoutEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ALL_THEMES } from '@/domain/entities/themes'
import { useAppStore, type AppStore } from '@/application/state'

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

  const textModeClass = shell.theme === 'background'
    ? `${shell.backgroundTextMode}-text`
    : shell.theme === 'dark' ? 'dark-text' : 'light-text'

  const shellClassName = [
    'app-shell',
    'ax',
    activeVariant,
    shell.blurMode ? 'blur-off' : '',
    shell.entranceAnimations ? '' : 'no-entrance-anim reduce-animation',
    textModeClass,
  ].filter(Boolean).join(' ')

  useLayoutEffect(() => {
    const root = document.documentElement
    const themeClasses = [
      ...ALL_THEMES,
      'blur-off',
      'no-entrance-anim',
      'reduce-animation',
      'light-text',
      'dark-text',
    ]

    root.classList.remove(...themeClasses)
    root.classList.add(activeVariant, textModeClass)
    if (shell.blurMode) root.classList.add('blur-off')
    if (!shell.entranceAnimations) root.classList.add('no-entrance-anim', 'reduce-animation')
    root.dataset.themeLocked = 'true'
    root.dataset.themeLoaded = 'true'
  }, [activeVariant, shell.blurMode, shell.entranceAnimations, textModeClass])

  return { updateToast: shell.updateToast, shellClassName }
}
