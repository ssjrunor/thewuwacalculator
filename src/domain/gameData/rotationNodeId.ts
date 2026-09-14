/*
  Author: Runor Ewhro
  Description: Implements rotation node id data-flow and calculation invariants.
*/

export function makeNodeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }

  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}
