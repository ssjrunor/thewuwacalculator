/*
  Author: Runor Ewhro
  Description: shared portal target lookups for calculator overlays and
               dialogs that render into either the page body or main shell.
*/

// resolve the app shell content root used by calculator overlays
export function getMainContentPortalTarget(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return (document.querySelector('.main-content') as HTMLElement | null) ?? document.body
}

// resolve the document body for simple top-level portals
export function getBodyPortalTarget(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return document.body
}
