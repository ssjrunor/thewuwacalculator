/*
  Author: Runor Ewhro
  Description: Shared portal target lookups for Simulation overlays and
               dialogs that render into either the page body or main shell.
*/

// Mount overlays outside the named transition aperture, which is a backdrop root.
export function mainPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return (document.querySelector('.app-shell') as HTMLElement | null)
    ?? (document.querySelector('.main-content') as HTMLElement | null)
    ?? document.body
}

// Resolve the persistent chrome host for controls that must outlive routed content.
export function chromePortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return (document.querySelector('.ax-chrome') as HTMLElement | null) ?? mainPortal()
}

// Use the topmost open dialog as the portal boundary for nested floating controls.
export function dialogPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  const overlays = Array.from(
    document.querySelectorAll<HTMLElement>('.app-modal-overlay.open:not(.closing)'),
  )

  return overlays.at(-1) ?? null
}

export function bodyPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return document.body
}
