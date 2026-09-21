/*
  Author: Runor Ewhro
  Description: Loads configured font stylesheets and applies resolved document typography variables.
*/

import {
  DEFAULT_BODY_FONT,
  DEFAULT_FONT_STACK,
  makeFontStack,
  SYSTEM_FONT_NAME,
  SYSTEM_FONT_STACK,
  WUWA_FONT_NAME,
  WUWA_FONT_STACK,
  type ResolvedBodyFont,
} from '@/domain/entities/appearance.ts'

function getRootElem(): HTMLElement {
  return document.documentElement
}

export function isValidGoogleFont(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) {
    return true
  }

  return /^https:\/\/fonts\.googleapis\.com\/css2\?family=/.test(trimmed)
}

export function extractGoogleFamily(url: string): string | null {
  const match = url.match(/family=([^:&]+)/)
  if (!match?.[1]) {
    return null
  }

  return decodeURIComponent(match[1]).replace(/\+/g, ' ').trim() || null
}

async function ensGglFontSt(url: string): Promise<void> {
  if (!url.trim() || typeof document === 'undefined') {
    return
  }

  const existing = document.querySelector(`link[href="${url}"]`)
  if (!existing) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
  }

  const family = extractGoogleFamily(url)
  if (family && 'fonts' in document) {
    try {
      await document.fonts.load(`1rem "${family}"`)
    } catch {
      // ignore font load timing failures and let css fallback naturally
    }
  }
}

export function resolveBodyFont(fontName: string, fontUrl: string): ResolvedBodyFont {
  const trimmedName = fontName.trim()
  const trimmedUrl = fontUrl.trim()

  if (trimmedName === SYSTEM_FONT_NAME) {
    return {
      fontName: SYSTEM_FONT_NAME,
      fontStack: SYSTEM_FONT_STACK,
      validLink: true,
    }
  }

  if (trimmedName === WUWA_FONT_NAME && !trimmedUrl) {
    return {
      fontName: WUWA_FONT_NAME,
      fontStack: WUWA_FONT_STACK,
      validLink: true,
    }
  }

  if (trimmedUrl) {
    const xtrcFmly = (extractGoogleFamily(trimmedUrl) ?? trimmedName) || DEFAULT_BODY_FONT

    return {
      fontName: xtrcFmly,
      fontStack: makeFontStack(xtrcFmly),
      validLink: isValidGoogleFont(trimmedUrl),
    }
  }

  const resolvedName = trimmedName || DEFAULT_BODY_FONT
  return {
    fontName: resolvedName,
    fontStack: makeFontStack(resolvedName),
    validLink: true,
  }
}

export async function applyPrvwBod(
  fontName: string,
  fontUrl: string,
): Promise<ResolvedBodyFont> {
  const resolved = resolveBodyFont(fontName, fontUrl)
  if (resolved.validLink && fontUrl.trim()) {
    await ensGglFontSt(fontUrl)
  }

  getRootElem().style.setProperty(
    '--preview-font',
    resolved.validLink ? resolved.fontStack : getCurrentBodyFont(),
  )

  return resolved
}

export async function applyBodyFon(
  fontName: string,
  fontUrl: string,
): Promise<ResolvedBodyFont> {
  const resolved = resolveBodyFont(fontName, fontUrl)
  if (resolved.validLink && fontUrl.trim()) {
    await ensGglFontSt(fontUrl)
  }

  getRootElem().style.setProperty('--body-font', resolved.fontStack)
  getRootElem().style.setProperty('--preview-font', resolved.fontStack)
  return resolved
}

// for an empty or invalid link. `fallback` sets the generic family.
export async function loadGglFontStack(
  url: string,
  fallback = 'sans-serif',
): Promise<{ family: string; stack: string } | null> {
  const trimmed = url.trim()
  if (!trimmed || !isValidGoogleFont(trimmed)) {
    return null
  }

  await ensGglFontSt(trimmed)
  const family = extractGoogleFamily(trimmed) ?? DEFAULT_BODY_FONT
  return { family, stack: `'${family}', ${fallback}` }
}

// link). Idempotent and dedupes by family. Uses the lenient v1 API so requesting
// weights a family lacks doesn't fail the whole sheet.
export function ensureGoogleFamily(family: string): void {
  if (!family.trim() || typeof document === 'undefined') {
    return
  }
  const slug = family.trim().replace(/\s+/g, '+')
  if (document.querySelector(`link[data-ggl-family="${family}"]`)) {
    return
  }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css?family=${slug}:400,500,600,700,800&display=swap`
  link.dataset.gglFamily = family
  document.head.appendChild(link)
}

export function getCurrentBodyFont(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_FONT_STACK
  }

  const raw = getComputedStyle(getRootElem()).getPropertyValue('--body-font').trim()
  return raw || DEFAULT_FONT_STACK
}
