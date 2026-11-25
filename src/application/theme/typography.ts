/*
  Author: Runor Ewhro
  description: loads configured font stylesheets and applies resolved document typography variables.
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

// families used by shared chrome stay together; customization-only families
// are requested when showcase actually needs its typography controls.
const APP_FONT_URL = 'https://fonts.googleapis.com/css2?family=Sen:wght@400..800&family=Montserrat:ital,wght@0,100..900;1,100..900&family=DM+Mono:wght@400;500&family=Oxygen+Mono&family=Rubik+Glitch&family=Indie+Flower&display=swap'
const SHOWCASE_FONT_URL = 'https://fonts.googleapis.com/css2?family=Keania+One&display=swap'
const GAME_FONT_URL = 'https://hw-media-cdn-mingchao.kurogame.com/font/LaguSansBold.otf'

const pendingStylesheets = new Map<string, Promise<void>>()

function ensureLink(href: string, rel: string, configure?: (link: HTMLLinkElement) => void) {
  if (typeof document === 'undefined') return
  const exists = Array.from(document.querySelectorAll<HTMLLinkElement>('link')).some((link) => link.href === href && link.rel === rel)
  if (exists) return
  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  configure?.(link)
  if (rel === 'stylesheet') {
    pendingStylesheets.set(href, new Promise<void>((resolve) => {
      const finish = () => {
        window.clearTimeout(timeout)
        link.removeEventListener('load', finish)
        link.removeEventListener('error', finish)
        pendingStylesheets.delete(href)
        resolve()
      }
      const timeout = window.setTimeout(finish, 8000)
      link.addEventListener('load', finish, { once: true })
      link.addEventListener('error', finish, { once: true })
    }))
  }
  document.head.appendChild(link)
}

// capture must wait for stylesheet discovery before document.fonts.ready:
// a newly inserted sheet may not have registered any font faces yet.
export async function waitForFontStylesheets(): Promise<void> {
  await Promise.all(pendingStylesheets.values())
}

export function ensureAppFonts() {
  ensureLink('https://fonts.googleapis.com/', 'preconnect')
  ensureLink('https://fonts.gstatic.com/', 'preconnect', (link) => { link.crossOrigin = 'anonymous' })
  ensureLink(APP_FONT_URL, 'stylesheet')
}

export function ensureShowcaseFonts() {
  ensureLink(SHOWCASE_FONT_URL, 'stylesheet')
}

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

  ensureLink(url, 'stylesheet')
  await pendingStylesheets.get(url)

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

let bodyFontRevision = 0

export async function applyBodyFon(
  fontName: string,
  fontUrl: string,
): Promise<ResolvedBodyFont> {
  const revision = ++bodyFontRevision
  const resolved = resolveBodyFont(fontName, fontUrl)
  ensureAppFonts()
  if (resolved.fontName === WUWA_FONT_NAME && !fontUrl.trim()) {
    ensureLink('https://hw-media-cdn-mingchao.kurogame.com/', 'preconnect', (link) => { link.crossOrigin = 'anonymous' })
    ensureLink(GAME_FONT_URL, 'preload', (link) => {
      link.as = 'font'
      link.type = 'font/otf'
      link.crossOrigin = 'anonymous'
    })
  }

  if (resolved.validLink && fontUrl.trim()) {
    await ensGglFontSt(fontUrl)
  }

  if (revision !== bodyFontRevision) return resolved
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

// link). idempotent and dedupes by family. uses the lenient v1 api so requesting
// weights a family lacks doesn't fail the whole sheet.
export function ensureGoogleFamily(family: string): void {
  if (!family.trim() || typeof document === 'undefined') {
    return
  }
  if (['Sen', 'Chakra Petch', 'DM Mono', 'Rubik Glitch', 'Roboto Mono', 'Indie Flower'].includes(family.trim())) {
    ensureAppFonts()
    return
  }
  if (['Keania One', 'Righteous', 'Montserrat Alternates'].includes(family.trim())) {
    ensureShowcaseFonts()
    return
  }
  const slug = encodeURIComponent(family.trim()).replace(/%20/g, '+')
  ensureLink(`https://fonts.googleapis.com/css?family=${slug}:400,500,600,700,800&display=swap`, 'stylesheet', (link) => {
    link.dataset.gglFamily = family
  })
}

export function getCurrentBodyFont(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_FONT_STACK
  }

  const raw = getComputedStyle(getRootElem()).getPropertyValue('--body-font').trim()
  return raw || DEFAULT_FONT_STACK
}
