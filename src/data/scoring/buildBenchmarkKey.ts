/*
  Author: Runor Ewhro
  Description: produces compact deterministic keys for benchmark worker jobs.
*/

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object') return entry
    if (seen.has(entry)) return '[Circular]'
    seen.add(entry)

    if (Array.isArray(entry)) return entry
    if (ArrayBuffer.isView(entry)) {
      if (entry instanceof DataView) {
        return Array.from(new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength))
      }
      return Array.from(entry as unknown as ArrayLike<number>)
    }

    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right)),
    )
  }) ?? ''
}

function hashString(value: string, seed: number): string {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function makeBenchmarkKey(value: unknown): string {
  const stable = stableStringify(value)
  return `${stable.length.toString(36)}:${hashString(stable, 0x811c9dc5)}:${hashString(stable, 0x9e3779b9)}`
}
