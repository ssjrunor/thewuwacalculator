/*
  Author: Runor Ewhro
  Description: produces compact deterministic keys for evaluation worker jobs.
*/

interface KeyHasher {
  length: number
  first: number
  second: number
}

function pushText(hasher: KeyHasher, value: string): void {
  hasher.length += value.length
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    hasher.first ^= code
    hasher.first = Math.imul(hasher.first, 0x01000193)
    hasher.second ^= code
    hasher.second = Math.imul(hasher.second, 0x01000193)
  }
}

function pushJsonString(hasher: KeyHasher, value: string): void {
  // JSON quoting preserves the old key semantics for strings without building
  // the complete request JSON in memory.
  pushText(hasher, JSON.stringify(value))
}

function visitValue(value: unknown, hasher: KeyHasher, seen: WeakSet<object>, inArray = false): void {
  if (value === null) {
    pushText(hasher, 'null')
    return
  }

  switch (typeof value) {
    case 'string':
      pushText(hasher, 's')
      pushJsonString(hasher, value)
      return
    case 'number':
      pushText(hasher, Number.isFinite(value) ? `n${String(value)}` : 'nnull')
      return
    case 'boolean':
      pushText(hasher, value ? 'true' : 'false')
      return
    case 'undefined':
    case 'function':
    case 'symbol':
      // Match JSON.stringify: undefined-like object properties disappear while
      // array entries become null so positional identity is retained.
      pushText(hasher, inArray ? 'null' : '')
      return
    case 'bigint':
      // Evaluation payloads never contain bigint values. Stringifying one is
      // still preferable to throwing while constructing a cache key.
      pushText(hasher, `bi${String(value)}`)
      return
    default:
      break
  }

  if (typeof value !== 'object') return
  if (seen.has(value)) {
    pushText(hasher, '[Circular]')
    return
  }
  seen.add(value)

  if (Array.isArray(value)) {
    pushText(hasher, '[')
    for (const entry of value) visitValue(entry, hasher, seen, true)
    pushText(hasher, ']')
    seen.delete(value)
    return
  }

  if (ArrayBuffer.isView(value)) {
    pushText(hasher, `typed:${value.constructor.name}:${value.byteLength}:`)
    if (value instanceof DataView) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      for (const byte of bytes) pushText(hasher, `${byte},`)
    } else {
      const entries = value as unknown as ArrayLike<number>
      for (let index = 0; index < entries.length; index += 1) {
        pushText(hasher, `${entries[index]},`)
      }
    }
    seen.delete(value)
    return
  }

  pushText(hasher, '{')
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  for (const [key, entry] of entries) {
    pushJsonString(hasher, key)
    visitValue(entry, hasher, seen)
  }
  pushText(hasher, '}')
  seen.delete(value)
}

export function makeEvaluationKey(value: unknown): string {
  const hasher: KeyHasher = {
    length: 0,
    first: 0x811c9dc5,
    second: 0x9e3779b9,
  }
  visitValue(value, hasher, new WeakSet<object>())
  return `${hasher.length.toString(36)}:${(hasher.first >>> 0).toString(36)}:${(hasher.second >>> 0).toString(36)}`
}
