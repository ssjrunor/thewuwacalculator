export const SYSTEM_UI_FONT_NAME = 'System UI'
export const SYSTEM_UI_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'
export const DEFAULT_BODY_FONT_NAME = 'Sen'
export const DEFAULT_BODY_FONT_STACK = `'${DEFAULT_BODY_FONT_NAME}', sans-serif`

export const BODY_FONT_LINKS = {
  Onest: 'https://fonts.googleapis.com/css2?family=Onest:wght@100..900&display=swap',
  Fredoka: 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&display=swap',
  Quicksand: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600&display=swap',
  'Comic Neue': 'https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap',
  Caveat: 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&display=swap',
} as const

export const BODY_FONT_PRESETS = [
  SYSTEM_UI_FONT_NAME,
  ...Object.keys(BODY_FONT_LINKS),
] as const

export interface ResolvedBodyFontSelection {
  fontName: string
  fontStack: string
  validLink: boolean
}

function getRootElement(): HTMLElement {
  return document.documentElement
}

function buildFontStack(fontName: string): string {
  return fontName === SYSTEM_UI_FONT_NAME
    ? SYSTEM_UI_FONT_STACK
    : `'${fontName}', sans-serif`
}

export function getPresetBodyFontLink(fontName: string): string {
  if (fontName === SYSTEM_UI_FONT_NAME) {
    return ''
  }

  return BODY_FONT_LINKS[fontName as keyof typeof BODY_FONT_LINKS] ?? ''
}

export function isValidGoogleFontLink(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) {
    return true
  }

  return /^https:\/\/fonts\.googleapis\.com\/css2\?family=/.test(trimmed)
}

export function extractGoogleFontFamily(url: string): string | null {
  const match = url.match(/family=([^:&]+)/)
  if (!match?.[1]) {
    return null
  }

  return decodeURIComponent(match[1]).replace(/\+/g, ' ').trim() || null
}

async function ensureGoogleFontStylesheet(url: string): Promise<void> {
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

  const family = extractGoogleFontFamily(url)
  if (family && 'fonts' in document) {
    try {
      await document.fonts.load(`1rem "${family}"`)
    } catch {
      // ignore font load timing failures and let css fallback naturally
    }
  }
}

export function resolveBodyFontSelection(fontName: string, fontUrl: string): ResolvedBodyFontSelection {
  const trimmedName = fontName.trim()
  const trimmedUrl = fontUrl.trim()

  if (trimmedName === SYSTEM_UI_FONT_NAME) {
    return {
      fontName: SYSTEM_UI_FONT_NAME,
      fontStack: SYSTEM_UI_FONT_STACK,
      validLink: true,
    }
  }

  if (trimmedUrl) {
    const extractedFamily = (extractGoogleFontFamily(trimmedUrl) ?? trimmedName) || DEFAULT_BODY_FONT_NAME

    return {
      fontName: extractedFamily,
      fontStack: buildFontStack(extractedFamily),
      validLink: isValidGoogleFontLink(trimmedUrl),
    }
  }

  const resolvedName = trimmedName || DEFAULT_BODY_FONT_NAME
  return {
    fontName: resolvedName,
    fontStack: buildFontStack(resolvedName),
    validLink: true,
  }
}

export async function applyPreviewBodyFontSelection(
  fontName: string,
  fontUrl: string,
): Promise<ResolvedBodyFontSelection> {
  const resolved = resolveBodyFontSelection(fontName, fontUrl)
  if (resolved.validLink && fontUrl.trim()) {
    await ensureGoogleFontStylesheet(fontUrl)
  }

  getRootElement().style.setProperty(
    '--preview-font',
    resolved.validLink ? resolved.fontStack : getCurrentBodyFontStack(),
  )

  return resolved
}

export async function applyBodyFontSelection(
  fontName: string,
  fontUrl: string,
): Promise<ResolvedBodyFontSelection> {
  const resolved = resolveBodyFontSelection(fontName, fontUrl)
  if (resolved.validLink && fontUrl.trim()) {
    await ensureGoogleFontStylesheet(fontUrl)
  }

  getRootElement().style.setProperty('--body-font', resolved.fontStack)
  getRootElement().style.setProperty('--preview-font', resolved.fontStack)
  return resolved
}

export function getCurrentBodyFontStack(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_BODY_FONT_STACK
  }

  const raw = getComputedStyle(getRootElement()).getPropertyValue('--body-font').trim()
  return raw || DEFAULT_BODY_FONT_STACK
}
