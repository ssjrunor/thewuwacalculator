/*
  Author: Runor Ewhro
  Description: Compact share-token codec for clipboard payloads and share
               links. Tokens compress json behind a recognizable prefix so
               large clips survive chat message limits; decoding falls back to
               plain json so older copies keep working.
*/

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

export const SHR_TOKEN_PREFIX = 'wwcalc:'
export const SHR_LINK_FRAG = '#r='
export const SHR_REMOTE_PARAM = 's'

// rotation clips shipped with their own prefix before the codec was shared.
const LEGACY_PREFIXES = ['wwcalc-rot:']

export function encShareText(payload: unknown): string {
  return SHR_TOKEN_PREFIX + compressToEncodedURIComponent(JSON.stringify(payload))
}

export function encShareLink(payload: unknown, path = '/modulation'): string {
  const token = compressToEncodedURIComponent(JSON.stringify(payload))
  return `${window.location.origin}${path}${SHR_LINK_FRAG}${token}`
}

// a stored remote share token: the server mints a dashless uuid, so a bare one
// pasted on its own (no surrounding link) is recognizable by this shape.
const REMOTE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,96}$/

function getUrlBase(): string {
  return typeof window === 'undefined' ? 'https://thewuwacalculator.com' : window.location.origin
}

function getRemoteShareToken(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    const param = new URL(trimmed, getUrlBase()).searchParams.get(SHR_REMOTE_PARAM)
    if (param) return param
  } catch {
    // not a url; fall through to the bare-token check below.
  }

  // a token pasted by itself resolves against the remote store directly.
  return REMOTE_TOKEN_PATTERN.test(trimmed) ? trimmed : null
}

export interface RemoteShare {
  token: string
  url: string
}

export async function createRemoteShare(payload: unknown, path = '/modulation'): Promise<RemoteShare | null> {
  try {
    const response = await fetch('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) return null
    const parsed = await response.json() as { url?: unknown; token?: unknown }
    if (typeof parsed.token !== 'string') return null

    const url = typeof parsed.url === 'string'
      ? parsed.url
      : `${getUrlBase()}${path}?${SHR_REMOTE_PARAM}=${encodeURIComponent(parsed.token)}`
    return { token: parsed.token, url }
  } catch {
    return null
  }
}


// All import surfaces normalize to json text first; failed token decoding uses
// the empty string sentinel so callers can show one "not recognized" path.
export function decShareText(raw: string): string {
  const trimmed = raw.trim()

  const fragNdx = trimmed.indexOf(SHR_LINK_FRAG)
  if (fragNdx !== -1) {
    return decompressFromEncodedURIComponent(trimmed.slice(fragNdx + SHR_LINK_FRAG.length)) ?? ''
  }

  for (const prefix of [SHR_TOKEN_PREFIX, ...LEGACY_PREFIXES]) {
    if (trimmed.startsWith(prefix)) {
      return decompressFromEncodedURIComponent(trimmed.slice(prefix.length)) ?? ''
    }
  }

  if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    // a bare token pasted without its prefix still decodes when the result
    // looks like json.
    const guessed = decompressFromEncodedURIComponent(trimmed)
    if (guessed && (guessed.startsWith('{') || guessed.startsWith('['))) {
      return guessed
    }
  }

  return trimmed
}

export async function resolveShareText(raw: string): Promise<string> {
  const token = getRemoteShareToken(raw)
  if (!token) {
    return decShareText(raw)
  }

  try {
    const response = await fetch(`/api/shares/${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
    })
    return response.ok ? response.text() : ''
  } catch {
    return ''
  }
}
