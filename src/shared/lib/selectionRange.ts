/*
  Author: Runor Ewhro
  Description: shared helpers for extending selection across an ordered list
               so shift-click range selection behaves consistently.
*/

export function addSelRng<T extends string | number>(
  previous: ReadonlySet<T>,
  orderedItems: readonly T[],
  anchorItem: T | null,
  targetItem: T,
): Set<T> {
  const nextSel = new Set(previous)
  const rangeItems = collectRange(orderedItems, anchorItem, targetItem)

  for (const item of rangeItems) {
    nextSel.add(item)
  }

  return nextSel
}

export function collectRange<T extends string | number>(
  orderedItems: readonly T[],
  anchorItem: T | null,
  targetItem: T,
): T[] {
  // invalid or missing anchors fall back to a one-item range so first
  // shift-click still produces a stable selection result.
  const targetIndex = orderedItems.indexOf(targetItem)
  const anchorIndex = anchorItem == null ? -1 : orderedItems.indexOf(anchorItem)

  if (targetIndex < 0 || anchorIndex < 0) {
    return [targetItem]
  }

  const startIndex = Math.min(anchorIndex, targetIndex)
  const endIndex = Math.max(anchorIndex, targetIndex)
  const rangeItems: T[] = []

  for (let index = startIndex; index <= endIndex; index += 1) {
    const item = orderedItems[index]
    if (item != null) {
      rangeItems.push(item)
    }
  }

  return rangeItems
}
