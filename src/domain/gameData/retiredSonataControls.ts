/*
  Author: Runor Ewhro
  description: removes retired sonata setter changes from saved and imported
               rotations. calculated sonata magnitudes have no editable setter.
*/

// the manual Pact of Neonlight Leap Off-Tune bonus input; the value is now calculated
const RETIRED_PACT_INPUT = 'runtime.state.controls.echoSet:24:bonus:neonlightLeapOffTune'

/** removes the retired Pact input from every `changes` list at hydration and import.
 *  activation, routing, other changes, node ids and nested bodies are kept.
 *  a condition node left with no changes is removed; other nodes lose the empty list. */
export function removeRetiredSonataSetters<T>(value: T): T {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit).filter(child => child !== undefined)
    if (!item || typeof item !== 'object') return item
    const original = item as Record<string, unknown>
    const result = Object.fromEntries(Object.entries(original).map(([key, child]) => [key, visit(child)]))
    if (Array.isArray(original.changes)) {
      const removed = original.changes.some(change => change?.path === RETIRED_PACT_INPUT)
      result.changes = (result.changes as Array<{ path?: string }>).filter(change => change.path !== RETIRED_PACT_INPUT)
      if (removed && (result.changes as unknown[]).length === 0) {
        if (result.type === 'condition') return undefined
        delete result.changes
      }
    }
    return result
  }
  return visit(value) as T
}
