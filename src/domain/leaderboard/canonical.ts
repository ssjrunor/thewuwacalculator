/*
  Author: Runor Ewhro
  description: the one json encoding the leaderboard hashes: object keys sorted,
               array order kept, one trailing newline. rulesets, action plans
               and generated programs are all hashed over this text, so the
               same value always has the same hash. web crypto only, so it runs
               in workers and node alike.
*/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

// sort object keys recursively while preserving array order and the trailing newline used by published hashes.
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, (_key, entry: unknown) => isRecord(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
    : entry)}\n`
}

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}
