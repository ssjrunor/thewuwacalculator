/*
  Author: Runor Ewhro
  Description: Detects whether a dom event target is an editable surface so
               keyboard shortcuts and selection helpers can avoid hijacking
               native text editing interactions.
*/

export function isDtblVntTgt(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]'))
}
