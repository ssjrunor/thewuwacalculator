/*
  Author: Runor Ewhro
  Description: shared portal target lookups for Simulation overlays and
               dialogs that render into either the page body or main shell.
*/

/*
  Resolve the app shell used by Simulation overlays and dialogs.

  This must be the shell and not the aperture inside it. The aperture carries
  the page transition's view-transition-name, and a named element is a backdrop
  root: a backdrop-filter portalled inside it has nothing behind it to sample,
  so a modal's frosted layer would tint the page without ever blurring it.
*/
export function mainPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return (document.querySelector('.app-shell') as HTMLElement | null)
    ?? (document.querySelector('.main-content') as HTMLElement | null)
    ?? document.body
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
