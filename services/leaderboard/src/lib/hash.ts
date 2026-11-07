/*
  Author: Runor Ewhro
  description: hashes image content and computes keyed hashes for normalized card links.
*/

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)))
}

/** hash of the normalized kuro address (parseCardInput output), keyed by LINK_HASH_KEY.
    a link, a proxy link and a file name for the same card hash the same. */
export function linkHash(key: string, normalizedUrl: string): Promise<string> {
  return hmacSha256Hex(key, normalizedUrl)
}
