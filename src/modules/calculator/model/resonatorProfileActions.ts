/*
  Author: Runor Ewhro
  Description: chooses the next active resonator id after one or more profiles
               are removed, preferring the current selection when it survives
               and otherwise walking nearby entries before falling back.
*/

export function nextResonatorSelection(
  entries: ReadonlyArray<{ id: string }>,
  currentId: string | null,
  removedIds: readonly string[],
): string | null {
  // deleted ids are filtered separately from the remaining entry list because
  // callers may compute the next selection before committing the removal
  const removed = new Set(removedIds)
  if (currentId && !removed.has(currentId) && entries.some((entry) => entry.id === currentId)) {
    return currentId
  }

  const currentIndex = currentId
    ? entries.findIndex((entry) => entry.id === currentId)
    : -1
  if (currentIndex >= 0) {
    // scan forward first so deleting the active profile behaves like common
    // list selection, then scan backward to keep the nearest surviving neighbor
    for (let index = currentIndex + 1; index < entries.length; index += 1) {
      const entry = entries[index]
      if (entry && !removed.has(entry.id)) return entry.id
    }
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry && !removed.has(entry.id)) return entry.id
    }
  }

  return entries.find((entry) => !removed.has(entry.id))?.id ?? null
}
