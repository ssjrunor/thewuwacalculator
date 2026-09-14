/*
  Author: Runor Ewhro
  Description: Implements the programOrder logic for the rotation module.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'

/** Persisted advanced rotations execute their setup Preamble before Main. */
export function orderStoredRotationProgram(items: RotationNode[]): RotationNode[] {
  let sawMain = false
  let needsOrdering = false
  for (const item of items) {
    if (item.editorSection === 'preamble') {
      if (sawMain) needsOrdering = true
    } else {
      sawMain = true
    }
  }
  if (!needsOrdering) return items

  const preamble: RotationNode[] = []
  const main: RotationNode[] = []
  for (const item of items) {
    if (item.editorSection === 'preamble') preamble.push(item)
    else main.push(item)
  }
  return [...preamble, ...main]
}
