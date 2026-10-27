/*
  Author: Runor Ewhro
  description: renders the overview build card as a png for downloads and the
               system clipboard without adding capture code to the main bundle.
*/

import { rasterizeCard } from './captureRaster'
import { waitForFontStylesheets } from '@/application/theme/typography'
import { resolveImageRef } from '@/application/media/imageUpload'

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('font read failed'))
    reader.readAsDataURL(blob)
  })
}

// embed font assets in the exported image.
export function resolveFontAssetUrl(url: string, stylesheetHref: string | null, documentBase: string): string {
  return new URL(url, stylesheetHref || documentBase).href
}

type FontUsage = Map<string, Set<string>>
function recordFonts(usage: FontUsage, style: CSSStyleDeclaration) {
  for (const raw of (style.fontFamily ?? '').split(',')) {
    const family = raw.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
    let variants = usage.get(family)
    if (!variants) usage.set(family, variants = new Set())
    variants.add(`${style.fontStyle}:${style.fontWeight}`)
  }
}

export function fontFaceUsed(css: string, usage: FontUsage, text: string): boolean {
  const family = /font-family:\s*([^;]+)/i.exec(css)?.[1].trim().replace(/^['"]|['"]$/g, '').toLowerCase()
  if (!family || !usage.has(family)) return false
  const range = /unicode-range:\s*([^;}]+)/i.exec(css)?.[1]
  if (range) {
    const ranges = range.split(',').map((entry) => {
      const token = entry.trim().replace(/^U\+/i, '')
      const [first, last] = token.split('-')
      return [parseInt(first.replace(/\?/g, '0'), 16), parseInt((last ?? first).replace(/\?/g, 'f'), 16)]
    })
    if (![...text].some((char) => ranges.some(([min, max]) => char.codePointAt(0)! >= min && char.codePointAt(0)! <= max))) return false
  }
  // keep all declared weights of a used family: browser font matching may select
  // a nearby weight or synthesize bold/italic when an exact face is absent.
  return true
}

function makeCaptureResources() {
  const pending = new Map<string, Promise<string>>()
  return {
    load(url: string): Promise<string> {
      const absolute = new URL(url, document.baseURI).href
      if (absolute.startsWith('data:')) return Promise.resolve(absolute)
      let value = pending.get(absolute)
      if (!value) {
        value = (async () => {
          const image = await resolveImageRef(url)
          if (!image) throw new Error('Capture artwork is unavailable.')
          try {
            const response = await fetch(image.url)
            if (!response.ok) throw new Error(`Capture asset could not be loaded: ${response.status}`)
            return await blobToDataUrl(await response.blob())
          } finally { image.revoke?.() }
        })()
        pending.set(absolute, value)
      }
      return value
    },
    dispose() { pending.clear() },
  }
}

export async function embedCaptureUrls(css: string, load: (url: string) => Promise<string>, base = document.baseURI): Promise<string> {
  const pattern = /url\(["']?([^)"']+)["']?\)/g
  const replacements = new Map<string, string>()
  for (const match of css.matchAll(pattern)) {
    const url = match[1]
    if (replacements.has(url) || url.startsWith('data:') || url.startsWith('#')) continue
    const absolute = new URL(url, base).href
    const embedded = absolute.split('#')[0] === document.baseURI.split('#')[0] && absolute.includes('#')
      ? '#' + absolute.split('#')[1] : await load(absolute)
    replacements.set(url, `url("${embedded}")`)
  }
  // replace complete url tokens. a relative url may also be a substring of a
  // computed absolute url on the same node; replacing substrings corrupts both.
  return css.replace(pattern, (token, url: string) => replacements.get(url) ?? token)
}

async function buildFontEmbedCss(usage: FontUsage, text: string, load: (url: string) => Promise<string>): Promise<string> {
  const visited = new Set<string>()
  const blocks: string[] = []
  const add = async (css: string, base: string) => {
    for (const match of css.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
      if (fontFaceUsed(match[0], usage, text)) blocks.push(await embedCaptureUrls(match[0], load, base))
    }
  }
  const visit = async (sheet: CSSStyleSheet) => {
    if (sheet.href && visited.has(sheet.href)) return
    if (sheet.href) visited.add(sheet.href)
    const rules = async (entries: CSSRuleList) => {
      for (const rule of Array.from(entries)) {
        if (rule instanceof CSSImportRule && rule.styleSheet) await visit(rule.styleSheet)
        else if (rule instanceof CSSFontFaceRule) await add(rule.cssText, sheet.href || document.baseURI)
        else if ('cssRules' in rule) await rules((rule as CSSGroupingRule).cssRules)
      }
    }
    try {
      await rules(sheet.cssRules)
    } catch {
      if (sheet.href) {
        try { await add(await (await fetch(sheet.href)).text(), sheet.href) } catch { /* match browser font fallback if unavailable. */ }
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets)) await visit(sheet)
  return blocks.join('\n')
}

// split a computed list value on commas outside parentheses.
function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) { parts.push(value.slice(start, index).trim()); start = index + 1 }
  }
  const last = value.slice(start).trim()
  if (last && last !== 'none') parts.push(last)
  return parts
}

const GLASS_BACKGROUND =['image', 'color', 'size', 'position', 'repeat', 'origin', 'clip', 'attachment']
  .map((part) => `background-${part}`)

// chromium svg capture requires a clipped layer for backdrop filters.
function clipCaptureGlass(element: HTMLElement, filter: string) {
  const style = element.style
  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, {
    position: 'absolute', inset: '0', zIndex: '-1', pointerEvents: 'none',
    borderRadius: 'inherit', clipPath: `inset(0 round ${style.borderRadius || '0'})`,
  })
  layer.style.setProperty('backdrop-filter', filter)
  layer.style.setProperty('-webkit-backdrop-filter', filter)
  for (const property of GLASS_BACKGROUND) layer.style.setProperty(property, style.getPropertyValue(property))
  // move inset shadows onto the clipped layer and leave outer shadows on the element.
  const shadows = splitTopLevel(style.getPropertyValue('box-shadow'))
  const inset = shadows.filter((shadow) => /\binset\b/.test(shadow))
  if (inset.length) {
    layer.style.setProperty('box-shadow', inset.join(', '))
    const outer = shadows.filter((shadow) => !inset.includes(shadow))
    style.setProperty('box-shadow', outer.length ? outer.join(', ') : 'none')
  }
  style.setProperty('backdrop-filter', 'none')
  style.setProperty('-webkit-backdrop-filter', 'none')
  style.setProperty('background-image', 'none')
  style.setProperty('background-color', 'transparent')
  style.setProperty('isolation', 'isolate')
  if (style.position === 'static') style.position = 'relative'
  element.insertBefore(layer, element.firstChild)
}

// allow small svg text width differences while preserving live flex lines.
const WRAP_SLACK = 0.25
const LOGICAL_ALIAS: Record<string, string> = {
  'min-width': 'min-inline-size', 'margin-left': 'margin-inline-start', 'margin-right': 'margin-inline-end',
}
function holdWrappedLines(element: Element, computed: CSSStyleDeclaration, holds: [Element, string, string][]) {
  if (!computed.display?.includes('flex') || computed.flexWrap === 'nowrap' || computed.flexDirection?.startsWith('column')) return
  const lines: { bottom: number; widest: [Element, string, number] | null }[] = []
  for (const child of Array.from(element.children)) {
    const style = getComputedStyle(child)
    if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') continue
    holds.push([child, 'min-width', '0px'])
    const rect = child.getBoundingClientRect()
    let line = lines[lines.length - 1]
    if (!line || rect.top >= line.bottom) lines.push(line = { bottom: rect.bottom, widest: null })
    for (const side of ['margin-left', 'margin-right']) {
      const margin = parseFloat(style.getPropertyValue(side))
      if (margin > WRAP_SLACK && margin > (line.widest?.[2] ?? 0)) line.widest = [child, side, margin]
    }
  }
  for (const { widest } of lines) if (widest) holds.push([widest[0], widest[1], `${widest[2] - WRAP_SLACK}px`])
}

// freeze the live composition on a disposable clone. only the host is moved
// offscreen: moving the card itself would put its contents outside the png.
function createCaptureClone(source: HTMLElement): { card: HTMLElement; fonts: FontUsage; text: string; dispose: () => void } {
  const fonts: FontUsage = new Map()
  let text = source.textContent || ''
  const pseudos: string[] = []
  const glass: [HTMLElement, string][] = []
  const holds: [Element, string, string][] = []
  const card = source.cloneNode(true) as HTMLElement
  const originals = [source, ...source.querySelectorAll<HTMLElement | SVGElement>('*')]
  const copies = [card, ...card.querySelectorAll<HTMLElement | SVGElement>('*')]
  for (let index = 0; index < originals.length; index += 1) {
    const original = originals[index]
    const copy = copies[index]
    if (!copy.style) continue
    const computed = getComputedStyle(original)
    recordFonts(fonts, computed)
    // computed declarations already resolve custom properties. do not retain
    // another copy of the original variable payload on every captured element.
    copy.style.cssText = ''
    copy.setAttribute('data-capture-node', String(index))
    for (const pseudo of ['::before', '::after']) {
      const style = getComputedStyle(original, pseudo)
      if (!style.content || style.content === 'none' || style.content === 'normal') continue
      recordFonts(fonts, style)
      text += style.content
      const declarations = Array.from(style).filter((key) => !key.startsWith('--')).map((key) => `${key}:${style.getPropertyValue(key)};`).join('')
      pseudos.push(`[data-capture-node="${index}"]${pseudo}{${declarations}animation:none!important;transition:none!important;}`)
    }
    for (const property of Array.from(computed)) {
      if (property.startsWith('--')) continue
      copy.style.setProperty(property, computed.getPropertyValue(property))
    }
    holdWrappedLines(original, computed, holds)
    // the frozen box hugs its text, which renders a hair wider in the svg and
    // would trip the ellipsis. only text truncated live keeps it.
    if (computed.textOverflow === 'ellipsis' && original.scrollWidth <= original.clientWidth) {
      for (const logical of ['overflow-inline', 'overflow-block']) copy.style.removeProperty(logical)
      copy.style.setProperty('overflow-x', 'visible')
      copy.style.setProperty('overflow-y', 'visible')
      copy.style.setProperty('text-overflow', 'clip')
    }
    copy.style.setProperty('animation', 'none', 'important')
    const backdrop = computed.backdropFilter || computed.getPropertyValue?.('-webkit-backdrop-filter')
    if (backdrop && backdrop !== 'none' && copy instanceof HTMLElement) glass.push([copy, backdrop])
    copy.style.setProperty('transition', 'none', 'important')
    if (original instanceof HTMLImageElement && copy instanceof HTMLImageElement) {
      copy.src = original.currentSrc || original.src
      copy.removeAttribute('srcset')
      copy.removeAttribute('sizes')
      copy.loading = 'eager'
    }
    if (original instanceof HTMLCanvasElement && copy instanceof HTMLCanvasElement
      && !original.classList.contains('spine-animated')) {
      const image = document.createElement('img')
      image.src = original.toDataURL()
      image.style.cssText = copy.style.cssText
      copy.replaceWith(image)
    }
  }
  for (const [original, property, value] of holds) {
    const copy = copies[originals.indexOf(original as HTMLElement)]
    // remove logical longhands that would override copied physical values.
    copy?.style?.removeProperty(LOGICAL_ALIAS[property])
    copy?.style?.setProperty(property, value)
  }
  // the original custom stylesheet remains active. duplicating style elements
  // here would reapply their rules to the live card while preparing the export.
  card.querySelectorAll('style, .spine-animated').forEach((node) => node.remove())
  for (const [element, filter] of glass) clipCaptureGlass(element, filter)
  const pseudoStyle = document.createElement('style')
  pseudoStyle.textContent = pseudos.join('\n')
  card.appendChild(pseudoStyle)
  card.querySelectorAll<HTMLElement>('.wk-portrait-scrim, .wk-portrait-cue')
    .forEach((node) => { node.style.opacity = '0' })
  card.querySelectorAll<HTMLElement>('.spine-setup, .stat-muted')
    .forEach((node) => { node.style.opacity = '1' })

  // use live geometry to align the grade and score in the copy. font embedding
  // must preserve this composition.
  const figure = source.querySelector<HTMLElement>('.sc-verdict-figure')
  const figureCopy = card.querySelector<HTMLElement>('.sc-verdict-figure')
  if (figure && figureCopy) {
    const bounds = figure.getBoundingClientRect()
    if (bounds.width > 0 && bounds.height > 0) {
      Object.assign(figureCopy.style, {
        display: 'block', position: 'relative', flex: 'none',
        width: `${bounds.width}px`, height: `${bounds.height}px`,
      })
      for (const selector of ['.sc-grade-mark', '.sc-grade-score']) {
        const original = figure.querySelector<HTMLElement>(selector)
        const copy = figureCopy.querySelector<HTMLElement>(selector)
        if (!original || !copy) continue
        const rect = original.getBoundingClientRect()
        Object.assign(copy.style, {
          position: 'absolute', inset: 'auto', whiteSpace: 'nowrap',
          left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`,
        })
      }
    }
  }

  card.dataset.capturing = 'true'
  Object.assign(card.style, {
    position: 'relative', inset: 'auto', margin: '0', transform: 'none',
  })
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.inert = true
  Object.assign(host.style, {
    position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none',
    width: `${source.offsetWidth}px`, height: `${source.offsetHeight}px`,
  })
  host.appendChild(card)
  document.body.appendChild(host)
  return { card, fonts, text, dispose: () => host.remove() }
}

export async function loadCaptureArt(card: HTMLElement, loadResource?: (url: string) => Promise<string>): Promise<void> {
  const assets = new Map<string, Promise<string>>()
  const load = (url: string): Promise<string> => {
    if (loadResource) return loadResource(url)
    let asset = assets.get(url)
    if (!asset) {
      asset = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error('The full-quality portrait could not be loaded. Please retry capture.')
        return blobToDataUrl(await response.blob())
      })
      assets.set(url, asset)
    }
    return asset
  }
  await Promise.all([
    ...Array.from(card.querySelectorAll<HTMLImageElement>('img[data-capture-src]'), async (image) => {
      image.removeAttribute('srcset')
      image.removeAttribute('sizes')
      image.src = await load(image.dataset.captureSrc!)
      await image.decode()
    }),
    ...Array.from(card.querySelectorAll<HTMLElement>('[data-capture-background]'), async (layer) => {
      const url = layer.dataset.captureBackground!
      const displayed = /url\(["']?([^)"']+)["']?\)/.exec(layer.dataset.displayBackground ?? '')?.[1]
      const displayUrl = new URL(displayed ?? url.replace('/setup/', '/setup/display/'), document.baseURI).href
      // custom css may override the default background without changing props.
      if (!layer.style.backgroundImage.includes(displayUrl)) return
      layer.style.backgroundImage = layer.style.backgroundImage.replace(displayUrl, await load(url))
    }),
  ])
  await Promise.all(Array.from(card.querySelectorAll('img'), (image) => image.decode()))
}

let captureInProgress = false
export async function renderBuildCardPng(source: HTMLElement): Promise<Blob> {
  if (captureInProgress) throw new Error('A build card capture is already in progress.')
  captureInProgress = true
  let dispose: (() => void) | undefined
  const resources = makeCaptureResources()
  try {
    await waitForFontStylesheets()
    await document.fonts?.ready
    const width = source.offsetWidth
    const height = source.offsetHeight
    if (!width || !height) throw new Error('The build card is not visible.')
    const snapshot = createCaptureClone(source)
    dispose = snapshot.dispose
    const card = snapshot.card
    await loadCaptureArt(card, resources.load)
    const faces = await buildFontEmbedCss(snapshot.fonts, snapshot.text, resources.load)
    // one frozen tree: inline its resources, then serialize it directly.
    for (const node of [card, ...card.querySelectorAll<HTMLElement | SVGElement>('*')]) {
      if (node.style?.cssText?.includes('url(')) node.style.cssText = await embedCaptureUrls(node.style.cssText, resources.load)
      if (node instanceof HTMLImageElement) { node.src = await resources.load(node.src); await node.decode() }
      if (node.tagName === 'STYLE' && node.textContent) node.textContent = await embedCaptureUrls(node.textContent, resources.load)
    }
    const fontStyle = document.createElement('style')
    fontStyle.textContent = faces
    card.insertBefore(fontStyle, card.firstChild)
    return await rasterizeCard(card, { width, height, pixelRatio: 3 })
  } finally {
    dispose?.(); resources.dispose(); captureInProgress = false
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
