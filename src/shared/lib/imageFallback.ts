/*
  Author: Runor Ewhro
  Description: shared image fallback handlers for calculator and content ui
               so repeated onerror helpers do not live inside components.
*/

import type { SyntheticEvent } from 'react'

const DEFAULT_ICON_SRC = '/assets/default-icon.webp'

// swap a broken image to a stable fallback asset
export function swapImageToFallback(
  event: SyntheticEvent<HTMLImageElement>,
  fallbackSrc: string,
) {
  const image = event.currentTarget
  if (image.src.endsWith(fallbackSrc)) {
    return
  }

  image.src = fallbackSrc
}

// use the shared default icon for generic entity images
export function withDefaultIconImage(event: SyntheticEvent<HTMLImageElement>) {
  swapImageToFallback(event, DEFAULT_ICON_SRC)
}

// hide images entirely when the ui should collapse to text-only fallback
export function hideBrokenImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none'
}
