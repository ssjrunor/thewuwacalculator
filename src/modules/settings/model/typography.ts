/*
  Author: Runor Ewhro
  Description: Provides settings-page typography helpers and derived values.
*/

export const SYSTUIFONTNA = 'System UI'
export const SYSTUIFONTST = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'
export const DEF_BODY_FONT = 'Sen'
export const DEFBODYFONTS = `'${DEF_BODY_FONT}', sans-serif`

export const BODYFONTLNKS = {
  Onest: 'https://fonts.googleapis.com/css2?family=Onest:wght@100..900&display=swap',
  Fredoka: 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&display=swap',
  Quicksand: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600&display=swap',
  'Comic Neue': 'https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap',
  Caveat: 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&display=swap',
} as const

export const BODYFONTPRST = [
  SYSTUIFONTNA,
  ...Object.keys(BODYFONTLNKS),
] as const

export interface RslvBodyFont {
  fontName: string
  fontStack: string
  validLink: boolean
}

function getRootElem(): HTMLElement {
  return document.documentElement
}

function mkFontStck(fontName: string): string {
  return fontName === SYSTUIFONTNA
    ? SYSTUIFONTST
    : `'${fontName}', sans-serif`
}

export function getPrstBodyF(fontName: string): string {
  if (fontName === SYSTUIFONTNA) {
    return ''
  }

  return BODYFONTLNKS[fontName as keyof typeof BODYFONTLNKS] ?? ''
}

export function isVldGglFont(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) {
    return true
  }

  return /^https:\/\/fonts\.googleapis\.com\/css2\?family=/.test(trimmed)
}

export function xtrcGglFontF(url: string): string | null {
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

  const family = xtrcGglFontF(url)
  if (family && 'fonts' in document) {
    try {
      await document.fonts.load(`1rem "${family}"`)
    } catch {
      // ignore font load timing failures and let css fallback naturally
    }
  }
}

export function resBodyFontS(fontName: string, fontUrl: string): RslvBodyFont {
  const trimmedName = fontName.trim()
  const trimmedUrl = fontUrl.trim()

  if (trimmedName === SYSTUIFONTNA) {
    return {
      fontName: SYSTUIFONTNA,
      fontStack: SYSTUIFONTST,
      validLink: true,
    }
  }

  if (trimmedUrl) {
    const xtrcFmly = (xtrcGglFontF(trimmedUrl) ?? trimmedName) || DEF_BODY_FONT

    return {
      fontName: xtrcFmly,
      fontStack: mkFontStck(xtrcFmly),
      validLink: isVldGglFont(trimmedUrl),
    }
  }

  const resolvedName = trimmedName || DEF_BODY_FONT
  return {
    fontName: resolvedName,
    fontStack: mkFontStck(resolvedName),
    validLink: true,
  }
}

export async function applyPrvwBod(
  fontName: string,
  fontUrl: string,
): Promise<RslvBodyFont> {
  const resolved = resBodyFontS(fontName, fontUrl)
  if (resolved.validLink && fontUrl.trim()) {
    await ensGglFontSt(fontUrl)
  }

  getRootElem().style.setProperty(
    '--preview-font',
    resolved.validLink ? resolved.fontStack : getCurBodyFo(),
  )

  return resolved
}

export async function applyBodyFon(
  fontName: string,
  fontUrl: string,
): Promise<RslvBodyFont> {
  const resolved = resBodyFontS(fontName, fontUrl)
  if (resolved.validLink && fontUrl.trim()) {
    await ensGglFontSt(fontUrl)
  }

  getRootElem().style.setProperty('--body-font', resolved.fontStack)
  getRootElem().style.setProperty('--preview-font', resolved.fontStack)
  return resolved
}

export function getCurBodyFo(): string {
  if (typeof window === 'undefined') {
    return DEFBODYFONTS
  }

  const raw = getComputedStyle(getRootElem()).getPropertyValue('--body-font').trim()
  return raw || DEFBODYFONTS
}
