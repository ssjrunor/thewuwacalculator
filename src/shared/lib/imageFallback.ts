/*
  Author: Runor Ewhro
  Description: shared image fallback handlers for calculator and content ui
               so repeated onerror helpers do not live inside features.
*/

import type { SyntheticEvent as SyntVnt } from 'react'

export const DEF_ICON_SRC = '/assets/default.webp'
export const DEF_ENEMY_SRC = '/assets/enemies/default.webp'

// swap a broken image to a stable fallback asset
export function swapMgToFllb(
  event: SyntVnt<HTMLImageElement>,
  fallbackSrc: string,
) {
  const image = event.currentTarget
  if (image.src.endsWith(fallbackSrc)) {
    return
  }

  image.src = fallbackSrc
}

// use the shared default icon for generic entity images
export function withDefIconM(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ICON_SRC)
}

// img onerror handler that swaps broken weapon icons to the shared default image
export function withDefWpnMg(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ICON_SRC)
}

// img onerror handler for echo icons
export function withDefEchoMg(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ICON_SRC)
}

// img onerror handler for resonator profiles
export function withDefResMg(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ICON_SRC)
}

// img onerror handler for enemy icons
export function withDefEnmyMg(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ENEMY_SRC)
}

// hide images entirely when the ui should collapse to text-only fallback
export function hideBrknMg(event: SyntVnt<HTMLImageElement>) {
  event.currentTarget.style.display = 'none'
}
