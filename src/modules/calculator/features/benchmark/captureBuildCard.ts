/*
  Author: Runor Ewhro
  Description: Renders the overview build card as a PNG for downloads and the
               system clipboard without adding capture code to the main bundle.
*/

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('font read failed'))
    reader.readAsDataURL(blob)
  })
}

function isInlineSafeUrl(url: string): boolean {
  return (
    url.length > 0
    && !url.startsWith('data:')
    && !url.startsWith('blob:')
    && !url.startsWith('#')
  )
}

async function inlineCssAssetUrls(css: string): Promise<string> {
  const matches = Array.from(css.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/g))
  const urls = Array.from(new Set(
    matches
      .map((match) => match[1]?.trim() ?? '')
      .filter(isInlineSafeUrl),
  ))
  if (urls.length === 0) {
    return css
  }

  const inlined = await Promise.all(
    urls.map(async (rawUrl) => {
      try {
        const resolved = new URL(rawUrl, document.baseURI).href
        const blob = await (await fetch(resolved)).blob()
        return [rawUrl, await blobToDataUrl(blob)] as const
      } catch {
        return null
      }
    }),
  )

  let out = css
  for (const entry of inlined) {
    if (entry) out = out.split(entry[0]).join(entry[1])
  }
  return out
}

// Fetches each url() in the CSS and swaps it for a data URI so the font travels
// with the capture. Unreachable urls are left as-is rather than failing the block.
async function inlineFontUrls(css: string, pattern: RegExp): Promise<string> {
  const urls = Array.from(new Set(Array.from(css.matchAll(pattern)).map((match) => match[1])))
  const inlined = await Promise.all(
    urls.map(async (url) => {
      try {
        return [url, await blobToDataUrl(await (await fetch(url)).blob())] as const
      } catch {
        return null
      }
    }),
  )
  let out = css
  for (const entry of inlined) {
    if (entry) out = out.split(entry[0]).join(entry[1])
  }
  return out
}

// Every Google Fonts sheet the app pulls in, whether the user-pasted ones added as
// <link> or the app defaults loaded via @import in base.css. Same-origin @import
// rules expose their href; cross-origin sheets (the Google sheets themselves) throw
// on .cssRules and are skipped, so we fetch them by href instead.
function collectGoogleFontHrefs(): string[] {
  const hrefs = new Set<string>()
  for (const link of Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]'),
  )) {
    hrefs.add(link.href)
  }
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    if (!rules) continue
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule && rule.href.includes('fonts.googleapis.com')) {
        hrefs.add(rule.href)
      }
    }
  }
  return Array.from(hrefs)
}

// Self-hosted @font-face rules (e.g. Stormfaze, the --game-font) live in our own
// bundled CSS with same-origin font files that the Google path never touches.
async function collectLocalFontFaces(): Promise<string> {
  const blocks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    if (!rules) continue
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule && !rule.cssText.includes('fonts.gstatic.com')) {
        blocks.push(await inlineFontUrls(rule.cssText, /url\(["']?([^)"']+)["']?\)/g))
      }
    }
  }
  return blocks.join('\n')
}

// html-to-image rasterizes the card through an isolated SVG, so the document's
// loaded web fonts do not carry over. Its built-in font scan can't read
// cross-origin Google Fonts sheets, so we build the embed CSS ourselves: every
// Google Fonts sheet (gstatic files inlined) plus our self-hosted @font-face rules.
async function buildFontEmbedCss(): Promise<string> {
  if (typeof document === 'undefined') return ''
  const [googleSheets, localFaces] = await Promise.all([
    Promise.all(
      collectGoogleFontHrefs().map(async (href) => {
        try {
          const css = await (await fetch(href)).text()
          return await inlineFontUrls(css, /url\(["']?(https:\/\/fonts\.gstatic\.com\/[^)"']+)["']?\)/g)
        } catch {
          return ''
        }
      }),
    ),
    collectLocalFontFaces(),
  ])

  return [...googleSheets, localFaces].filter(Boolean).join('\n')
}

async function inlineCardStyleAssets(card: HTMLElement): Promise<() => void> {
  const styleNodes = Array.from(card.querySelectorAll<HTMLStyleElement>('style'))
  if (styleNodes.length === 0) {
    return () => {}
  }

  const originals = styleNodes.map((node) => node.textContent ?? '')
  const nextCss = await Promise.all(originals.map((css) => inlineCssAssetUrls(css)))
  for (let index = 0; index < styleNodes.length; index += 1) {
    styleNodes[index].textContent = nextCss[index]
  }

  return () => {
    for (let index = 0; index < styleNodes.length; index += 1) {
      styleNodes[index].textContent = originals[index]
    }
  }
}

export async function renderBuildCardPng(card: HTMLElement): Promise<Blob> {
  await document.fonts?.ready
  const [{ toBlob }, fontEmbedCSS] = await Promise.all([import('html-to-image'), buildFontEmbedCss()])
  // Render at least 2x the card's CSS size (so even 1x displays export sharp) and
  // up to 3x on HiDPI screens, balancing crispness against PNG size / canvas limits.
  const pixelRatio = Math.min(3, Math.max(2, window.devicePixelRatio || 1))

  card.dataset.capturing = 'true'
  try {
    const restoreCardCss = await inlineCardStyleAssets(card)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      const blob = await toBlob(card, {
        // cacheBust appends `?<timestamp>` to every resource URL. The spine
        // portrait/background render from downscaled `blob:` object URLs, and a
        // query string makes those URLs unresolvable, so the capture fails in
        // every 2D mode. All card assets are same-origin, so cacheBust is unneeded.
        cacheBust: false,
        pixelRatio,
        skipAutoScale: true,
        // Supply the embed CSS ourselves (data-URI'd Google Fonts) so custom and
        // app fonts render in the capture; this also skips html-to-image's
        // redundant document-wide CSSOM scan.
        fontEmbedCSS,
        filter: (node) => !node.classList?.contains('spine-animated'),
      })
      if (!blob) throw new Error('Build card renderer returned no image')
      return blob
    } finally {
      restoreCardCss()
    }
  } finally {
    delete card.dataset.capturing
  }
}

export function downloadBuildCard(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'build'}-card.png`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function copyBuildCard(blob: Promise<Blob>): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard is not supported by this browser')
  }
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ])
}
