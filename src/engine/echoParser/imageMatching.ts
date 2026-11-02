/*
  Author: Runor Ewhro
  description: provides image matching helpers for echo and set icon
               recognition using canvas preprocessing, histograms, and
               pixel comparison.
*/

// compare echo icons using colour histograms and shape, and set icons using disc pixels.

export interface ImageRegion {
  x: number
  y: number
  width: number
  height: number
}

interface ClrHstg {
  r: number[]
  g: number[]
  b: number[]
}

// canvas utilities

function makeCanvas(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d', { willReadFrequently: true })!
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// extract a region from the source canvas and mask dark background pixels
function xtrcMgRgn(
    srcCanvas: HTMLCanvasElement,
    region: ImageRegion,
): CanvasRenderingContext2D {
  const ctx = makeCanvas(region.width, region.height)
  ctx.drawImage(srcCanvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)

  const imgData = ctx.getImageData(0, 0, region.width, region.height)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) d[i + 3] = 0
  }
  ctx.putImageData(imgData, 0, 0)
  return ctx
}

// preprocessing

function normBrgh(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imgData = ctx.getImageData(0, 0, width, height)
  const d = imgData.data
  let sum = 0
  let count = 0

  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    count += 1
  }

  const adjustment = 128 - sum / count
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    if (lum > 0) {
      const factor = (lum + adjustment) / lum
      d[i] = Math.max(0, Math.min(255, d[i] * factor))
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] * factor))
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] * factor))
    }
  }

  ctx.putImageData(imgData, 0, 0)
}

function ncrsCntr(ctx: CanvasRenderingContext2D, width: number, height: number, factor = 2.5): void {
  const imgData = ctx.getImageData(0, 0, width, height)
  const d = imgData.data

  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, Math.min(255, (d[i] - 128) * factor + 128))
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - 128) * factor + 128))
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - 128) * factor + 128))
  }

  ctx.putImageData(imgData, 0, 0)
}

// echo comparison

function compareShape(
    ctxA: CanvasRenderingContext2D,
    ctxB: CanvasRenderingContext2D,
    width: number,
    height: number,
): number {
  const dA = ctxA.getImageData(0, 0, width, height).data
  const dB = ctxB.getImageData(0, 0, width, height).data

  let minXA = width
  let maxXA = 0
  let minYA = height
  let maxYA = 0
  let minXB = width
  let maxXB = 0
  let minYB = height
  let maxYB = 0
  let countA = 0
  let countB = 0
  let sumXA = 0
  let sumYA = 0
  let sumXB = 0
  let sumYB = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4

      const bgA = dA[idx + 3] < 10 || (dA[idx] < 30 && dA[idx + 1] < 30 && dA[idx + 2] < 30)
      if (!bgA) {
        countA += 1
        if (x < minXA) minXA = x
        if (x > maxXA) maxXA = x
        if (y < minYA) minYA = y
        if (y > maxYA) maxYA = y
        sumXA += x
        sumYA += y
      }

      const bgB = dB[idx + 3] < 10 || (dB[idx] < 30 && dB[idx + 1] < 30 && dB[idx + 2] < 30)
      if (!bgB) {
        countB += 1
        if (x < minXB) minXB = x
        if (x > maxXB) maxXB = x
        if (y < minYB) minYB = y
        if (y > maxYB) maxYB = y
        sumXB += x
        sumYB += y
      }
    }
  }

  if (countA === 0 || countB === 0) return 1.0

  const aspectA = (maxXA - minXA + 1) / (maxYA - minYA + 1)
  const aspectB = (maxXB - minXB + 1) / (maxYB - minYB + 1)
  const centXA = sumXA / countA
  const centYA = sumYA / countA
  const centXB = sumXB / countB
  const centYB = sumYB / countB

  let compA = 0
  let compB = 0
  const maxDist = Math.sqrt(width * width + height * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4

      if (!(dA[idx + 3] < 10 || (dA[idx] < 30 && dA[idx + 1] < 30 && dA[idx + 2] < 30))) {
        compA += Math.sqrt((x - centXA) ** 2 + (y - centYA) ** 2)
      }

      if (!(dB[idx + 3] < 10 || (dB[idx] < 30 && dB[idx + 1] < 30 && dB[idx + 2] < 30))) {
        compB += Math.sqrt((x - centXB) ** 2 + (y - centYB) ** 2)
      }
    }
  }

  const aspectDiff = Math.abs(aspectA - aspectB) / Math.max(aspectA, aspectB, 0.1)
  const compDiff = Math.abs(compA / countA - compB / countB) / maxDist
  const sizeDiff = Math.abs(countA - countB) / Math.max(countA, countB)
  const cxDiff = Math.abs(centXA - centXB) / width
  const cyDiff = Math.abs(centYA - centYB) / height

  const shape =
      aspectDiff * 0.25 +
      compDiff * 0.35 +
      sizeDiff * 0.25 +
      cxDiff * 0.075 +
      cyDiff * 0.075

  return shape * shape
}

function cmprPxls(
    ctxA: CanvasRenderingContext2D,
    ctxB: CanvasRenderingContext2D,
    width: number,
    height: number,
): number {
  const dA = ctxA.getImageData(0, 0, width, height).data
  const dB = ctxB.getImageData(0, 0, width, height).data
  let diff = 0
  let validPixels = 0
  const cX = width / 2
  const cY = height / 2
  const maxDist = Math.sqrt(cX * cX + cY * cY)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4
      const bgA = dA[idx + 3] < 10 || (dA[idx] < 30 && dA[idx + 1] < 30 && dA[idx + 2] < 30)
      const bgB = dB[idx + 3] < 10 || (dB[idx] < 30 && dB[idx + 1] < 30 && dB[idx + 2] < 30)

      if (bgA && bgB) continue

      if (bgA !== bgB) {
        diff += 5000
        validPixels += 1
        continue
      }

      validPixels += 1
      const dist = Math.sqrt((x - cX) ** 2 + (y - cY) ** 2)
      const weight = 1.0 + (1.0 - dist / maxDist)
      const rD = dA[idx] - dB[idx]
      const gD = dA[idx + 1] - dB[idx + 1]
      const bD = dA[idx + 2] - dB[idx + 2]
      const px = rD * rD + gD * gD + bD * bD
      const bright =
          (dA[idx] + dA[idx + 1] + dA[idx + 2]) / 3 > 150 ||
          (dB[idx] + dB[idx + 1] + dB[idx + 2]) / 3 > 150

      diff += px * weight * (bright ? 1.3 : 1.0)
    }
  }

  return validPixels === 0 ? Infinity : diff / validPixels
}

// combine structural comparison using shape and pixel differences
function cmprMgs(
    ctxA: CanvasRenderingContext2D,
    ctxB: CanvasRenderingContext2D,
    width: number,
    height: number,
): number {
  const pixelDiff = cmprPxls(ctxA, ctxB, width, height) / 10000
  const shapeDiff = compareShape(ctxA, ctxB, width, height)

  if (shapeDiff > 0.3) return 50000 + shapeDiff * 100000

  return pixelDiff * 10000 * 0.3 + shapeDiff * 20000 * 0.7
}

function clclClrHstg(ctx: CanvasRenderingContext2D, width: number, height: number): ClrHstg {
  const d = ctx.getImageData(0, 0, width, height).data
  const r = new Array(256).fill(0)
  const g = new Array(256).fill(0)
  const b = new Array(256).fill(0)
  let valid = 0

  for (let i = 0; i < d.length; i += 4) {
    const bg = d[i + 3] < 10 || (d[i] < 30 && d[i + 1] < 30 && d[i + 2] < 30)
    if (bg) continue
    valid += 1
    r[d[i]] += 1
    g[d[i + 1]] += 1
    b[d[i + 2]] += 1
  }

  if (valid === 0) return { r, g, b }

  return {
    r: r.map((v) => v / valid),
    g: g.map((v) => v / valid),
    b: b.map((v) => v / valid),
  }
}

function cmprClrHstg(histA: ClrHstg, histB: ClrHstg): number {
  let diff = 0

  for (let i = 0; i < 256; i += 1) {
    for (const ch of ['r', 'g', 'b'] as const) {
      const sum = histA[ch][i] + histB[ch][i]
      if (sum > 0) {
        const d = histA[ch][i] - histB[ch][i]
        diff += (d * d) / sum
      }
    }
  }

  return diff
}

// preloading

const ECHO_W = 192
const ECHO_H = 182

// run a small batch of tasks to overlap decoding with network work.
async function runPooled<T>(items: T[], task: (item: T) => Promise<void>): Promise<void> {
  const limit = Math.min(8, items.length)
  let cursor = 0

  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await task(items[index])
    }
  }))
}

// preload echo images into processed canvas contexts
export async function prldEchoMgs(
    echoMap: Record<string, string>,
    echoCache: Record<string, CanvasRenderingContext2D>,
    onEach?: (done: number, total: number) => void,
): Promise<void> {
  const entries = Object.entries(echoMap).filter(([name]) => !echoCache[name])
  let done = 0

  await runPooled(entries, async ([name, url]) => {
    try {
      const img = await loadImage(url)
      const ctx = makeCanvas(ECHO_W, ECHO_H)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, ECHO_W, ECHO_H)

      // mask black background
      const imgData = ctx.getImageData(0, 0, ECHO_W, ECHO_H)
      const d = imgData.data
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) d[i + 3] = 0
      }
      ctx.putImageData(imgData, 0, 0)

      // preprocess the same way as source regions during matching
      normBrgh(ctx, ECHO_W, ECHO_H)
      ncrsCntr(ctx, ECHO_W, ECHO_H, 2.5)
      echoCache[name] = ctx
    } catch {
      // skip failed image loads
    }

    done += 1
    onEach?.(done, entries.length)
  })
}

// crop the card and reference to the set icon's disc before comparing pixels.
const GLYPH = 32

// include rows and columns above the disc brightness threshold.
function discBounds(data: Uint8ClampedArray, width: number, height: number, byAlpha: boolean): ImageRegion | null {
  const lit = (index: number) => byAlpha
    ? data[index + 3] > 128
    : Math.max(data[index], data[index + 1], data[index + 2]) > 70
  const rows: number[] = []
  const columns: number[] = []
  for (let y = 0; y < height; y += 1) {
    let count = 0
    for (let x = 0; x < width; x += 1) if (lit((y * width + x) * 4)) count += 1
    if (count >= 3) rows.push(y)
  }
  for (let x = 0; x < width; x += 1) {
    let count = 0
    for (let y = 0; y < height; y += 1) if (lit((y * width + x) * 4)) count += 1
    if (count >= 3) columns.push(x)
  }
  if (rows.length < 8 || columns.length < 8) return null
  const top = rows[0]
  const left = columns[0]
  return { x: left, y: top, width: columns[columns.length - 1] - left + 1, height: rows[rows.length - 1] - top + 1 }
}

function glyphOf(source: CanvasImageSource & { width: number; height: number }, byAlpha: boolean): Float32Array | null {
  const ctx = makeCanvas(source.width, source.height)
  ctx.drawImage(source, 0, 0)
  const bounds = discBounds(ctx.getImageData(0, 0, source.width, source.height).data, source.width, source.height, byAlpha)
  if (!bounds) return null
  const out = makeCanvas(GLYPH, GLYPH)
  out.fillStyle = '#000'
  out.fillRect(0, 0, GLYPH, GLYPH)
  out.imageSmoothingQuality = 'high'
  out.drawImage(ctx.canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, GLYPH, GLYPH)
  const data = out.getImageData(0, 0, GLYPH, GLYPH).data
  const glyph = new Float32Array(GLYPH * GLYPH * 3)
  for (let i = 0; i < GLYPH * GLYPH; i += 1) {
    glyph[i * 3] = data[i * 4]
    glyph[i * 3 + 1] = data[i * 4 + 1]
    glyph[i * 3 + 2] = data[i * 4 + 2]
  }
  return glyph
}

// use the minimum mean squared colour distance across one-pixel offsets.
function cmprGlyphs(a: Float32Array, b: Float32Array): number {
  const r = GLYPH / 2 - 1
  let best = Infinity
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      let sum = 0
      let count = 0
      for (let y = 0; y < GLYPH; y += 1) {
        for (let x = 0; x < GLYPH; x += 1) {
          if ((x + 0.5 - GLYPH / 2) ** 2 + (y + 0.5 - GLYPH / 2) ** 2 > r * r) continue
          const sx = x + dx
          const sy = y + dy
          if (sx < 0 || sy < 0 || sx >= GLYPH || sy >= GLYPH) continue
          const ia = (y * GLYPH + x) * 3
          const ib = (sy * GLYPH + sx) * 3
          sum += (a[ia] - b[ib]) ** 2 + (a[ia + 1] - b[ib + 1]) ** 2 + (a[ia + 2] - b[ib + 2]) ** 2
          count += 1
        }
      }
      if (count > 0) best = Math.min(best, sum / count)
    }
  }
  return best
}

// cache each sonata icon before matching panels.
export async function prldSetMgs(
    setMap: Record<string, string>,
    setCache: Record<string, Float32Array>,
    onEach?: (done: number, total: number) => void,
): Promise<void> {
  const entries = Object.entries(setMap).filter(([name]) => !setCache[name])
  let done = 0

  await runPooled(entries, async ([name, url]) => {
    try {
      const glyph = glyphOf(await loadImage(url), true)
      if (glyph) setCache[name] = glyph
    } catch {
      // skip failed image loads
    }

    done += 1
    onEach?.(done, entries.length)
  })
}

export interface SetMatch {
  name: string
  score: number
}

// rank all sonata icons by distance from the panel icon.
export function rnkSets(
    srcCanvas: HTMLCanvasElement,
    setRegion: ImageRegion,
    setCache: Record<string, Float32Array>,
): SetMatch[] {
  const crop = makeCanvas(setRegion.width, setRegion.height)
  crop.drawImage(srcCanvas, setRegion.x, setRegion.y, setRegion.width, setRegion.height, 0, 0, setRegion.width, setRegion.height)
  const glyph = glyphOf(crop.canvas, false)
  crop.canvas.width = 0
  if (!glyph) return []
  return Object.entries(setCache)
      .map(([name, reference]) => ({ name, score: cmprGlyphs(glyph, reference) }))
      .sort((left, right) => left.score - right.score)
}

// echo matching

// match an echo icon against a filtered set of candidate names
export interface EchoMatch {
  key: string
  score: number
}

// every candidate scored against the panel art, closest first
export function rnkEchoFrom(
    srcCanvas: HTMLCanvasElement,
    echoRegion: ImageRegion,
    fltrEchoNms: string[],
    echoCache: Record<string, CanvasRenderingContext2D>,
): EchoMatch[] {
  const srcCtx = xtrcMgRgn(srcCanvas, echoRegion)
  normBrgh(srcCtx, ECHO_W, ECHO_H)
  ncrsCntr(srcCtx, ECHO_W, ECHO_H, 2.5)
  const srcHist = clclClrHstg(srcCtx, ECHO_W, ECHO_H)

  const scored: EchoMatch[] = []
  for (const key of fltrEchoNms) {
    const refCtx = echoCache[key]
    if (!refCtx) continue
    const refHist = clclClrHstg(refCtx, ECHO_W, ECHO_H)
    const structural = cmprMgs(srcCtx, refCtx, ECHO_W, ECHO_H)
    const hist = cmprClrHstg(srcHist, refHist)
    scored.push({ key, score: structural * 0.5 + hist * 1000 * 0.5 })
  }

  return scored.sort((left, right) => left.score - right.score)
}

// weapon matching

export interface WeaponMatch {
  id: string
  score: number
}

// compare opaque weapon-icon pixels at the reference card position.
export async function rnkWeapons(
    srcCanvas: HTMLCanvasElement,
    place: { x: number; y: number; size: number },
    weapons: { id: string; icon: string }[],
): Promise<WeaponMatch[]> {
  const pad = 2
  const span = place.size + pad * 2
  const source = makeCanvas(span, span)
  source.drawImage(srcCanvas, place.x - pad, place.y - pad, span, span, 0, 0, span, span)
  const card = source.getImageData(0, 0, span, span).data
  source.canvas.width = 0

  const scored: WeaponMatch[] = []
  await runPooled(weapons, async (weapon) => {
    let image: HTMLImageElement
    try {
      image = await loadImage(weapon.icon)
    } catch {
      return
    }
    const ctx = makeCanvas(place.size, place.size)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, place.size, place.size)
    const icon = ctx.getImageData(0, 0, place.size, place.size).data
    ctx.canvas.width = 0

    let best = Infinity
    for (let dy = -pad; dy <= pad; dy += 1) {
      for (let dx = -pad; dx <= pad; dx += 1) {
        let sum = 0
        let count = 0
        for (let y = 0; y < place.size; y += 2) {
          for (let x = 0; x < place.size; x += 2) {
            const i = (y * place.size + x) * 4
            if (icon[i + 3] < 230) continue
            const j = ((y + pad + dy) * span + x + pad + dx) * 4
            sum += (icon[i] - card[j]) ** 2 + (icon[i + 1] - card[j + 1]) ** 2 + (icon[i + 2] - card[j + 2]) ** 2
            count += 1
          }
        }
        if (count >= 50) best = Math.min(best, sum / count)
      }
    }
    if (Number.isFinite(best)) scored.push({ id: weapon.id, score: best })
  })

  return scored.sort((left, right) => left.score - right.score)
}

// how closely the panel art agrees with one reference, on scales that hold across cards
// (the ranking above is relative, so it always names a winner, even for an echo it has never seen).
// lum and edge are masked correlations of brightness and of edges; hue correlates hue histograms,
// which separates same-silhouette recolours that brightness and edges cannot
export interface ArtAgreement {
  lum: number
  edge: number
  hue: number
}

// pixels darker than this, or transparent, are background in both crops
function isArtPixel(d: Uint8ClampedArray, i: number): boolean {
  return !(d[i + 3] < 10 || (d[i] < 30 && d[i + 1] < 30 && d[i + 2] < 30))
}

function luma(d: Uint8ClampedArray, i: number): number {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
}

// pearson correlation; too few shared pixels reads as no agreement
function correlate(a: ArrayLike<number>, b: ArrayLike<number>, minCount = 50): number {
  const n = a.length
  if (n < minCount) return 0
  let sa = 0
  let sb = 0
  for (let k = 0; k < n; k += 1) {
    sa += a[k]
    sb += b[k]
  }
  const ma = sa / n
  const mb = sb / n
  let ab = 0
  let aa = 0
  let bb = 0
  for (let k = 0; k < n; k += 1) {
    ab += (a[k] - ma) * (b[k] - mb)
    aa += (a[k] - ma) ** 2
    bb += (b[k] - mb) ** 2
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}

// 36 hue bins over saturated, lit pixels
function hueBins(d: Uint8ClampedArray): number[] {
  const bins = new Array(36).fill(0)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255
    const max = Math.max(r, g, b)
    const chroma = max - Math.min(r, g, b)
    if (max < 0.235 || chroma / max < 0.31) continue
    let h = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
    if (h < 0) h += 6
    bins[Math.min(35, Math.floor(h * 6))] += 1
  }
  return bins
}

export function cmprEchoArt(
    srcCanvas: HTMLCanvasElement,
    echoRegion: ImageRegion,
    refCtx: CanvasRenderingContext2D,
): ArtAgreement {
  const srcCtx = xtrcMgRgn(srcCanvas, echoRegion)
  normBrgh(srcCtx, ECHO_W, ECHO_H)
  ncrsCntr(srcCtx, ECHO_W, ECHO_H, 2.5)
  const a = srcCtx.getImageData(0, 0, ECHO_W, ECHO_H).data
  const b = refCtx.getImageData(0, 0, ECHO_W, ECHO_H).data
  srcCtx.canvas.width = 0

  const row = ECHO_W * 4
  const lumA: number[] = []
  const lumB: number[] = []
  const edgeA: number[] = []
  const edgeB: number[] = []
  for (let y = 1; y < ECHO_H - 1; y += 1) {
    for (let x = 1; x < ECHO_W - 1; x += 1) {
      const i = (y * ECHO_W + x) * 4
      const inA = isArtPixel(a, i)
      const inB = isArtPixel(b, i)
      if (inA && inB) {
        lumA.push(luma(a, i))
        lumB.push(luma(b, i))
      }
      if (inA || inB) {
        edgeA.push(Math.hypot(luma(a, i + 4) - luma(a, i - 4), luma(a, i + row) - luma(a, i - row)))
        edgeB.push(Math.hypot(luma(b, i + 4) - luma(b, i - 4), luma(b, i + row) - luma(b, i - row)))
      }
    }
  }
  return {
    lum: correlate(lumA, lumB),
    edge: correlate(edgeA, edgeB),
    hue: correlate(hueBins(a), hueBins(b), 2),
  }
}
