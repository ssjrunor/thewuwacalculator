/*
  Author: Runor Ewhro
  Description: shared portal target lookups for calculator overlays and
               dialogs that render into either the page body or main shell.
*/

// resolve the app shell content root used by calculator overlays
export function mainPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return (document.querySelector('.main-content') as HTMLElement | null) ?? document.body
}

// resolve the top-most open app dialog overlay so floating UI can stay interactive within modals
export function dialogPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  const overlays = Array.from(
    document.querySelectorAll<HTMLElement>('.app-modal-overlay.open:not(.closing)'),
  )

  return overlays.at(-1) ?? null
}

// resolve the document body for simple top-level portals
export function bodyPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return document.body
}
