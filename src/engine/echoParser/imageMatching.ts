/*
  Author: Runor Ewhro
  Description: Provides image matching helpers for echo and set icon
               recognition using canvas preprocessing, shape checks,
               histograms, and pixel comparison.
*/

// image matching engine ported from parserworker.ts
// uses color histograms and shape comparison for echo icons
// uses color family, shape detection, and pixel comparison for set icons

export interface ImageRegion {
  x: number
  y: number
  width: number
  height: number
}

interface ColorHistograms {
  r: number[]
  g: number[]
  b: number[]
}

interface ShapeResult {
  hasShield: boolean
  hasCross: boolean
  hasPlus: boolean
  hasFire: boolean
  hasWildFire: boolean
  hasArrow: boolean
  hasStar: boolean
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
function extractImageRegion(
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

function normalizeBrightness(ctx: CanvasRenderingContext2D, width: number, height: number): void {
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

function increaseContrast(ctx: CanvasRenderingContext2D, width: number, height: number, factor = 2.5): void {
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

function comparePixels(
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
function compareImages(
    ctxA: CanvasRenderingContext2D,
    ctxB: CanvasRenderingContext2D,
    width: number,
    height: number,
): number {
  const pixelDiff = comparePixels(ctxA, ctxB, width, height) / 10000
  const shapeDiff = compareShape(ctxA, ctxB, width, height)

  if (shapeDiff > 0.3) return 50000 + shapeDiff * 100000

  return pixelDiff * 10000 * 0.3 + shapeDiff * 20000 * 0.7
}

function calculateColorHistograms(ctx: CanvasRenderingContext2D, width: number, height: number): ColorHistograms {
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

function compareColorHistograms(histA: ColorHistograms, histB: ColorHistograms): number {
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

// set comparison

function compareSetIcons(
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
  const histA = { r: new Array(256).fill(0), g: new Array(256).fill(0), b: new Array(256).fill(0) }
  const histB = { r: new Array(256).fill(0), g: new Array(256).fill(0), b: new Array(256).fill(0) }

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
      const weight = 1.0 + 2.0 * (1.0 - dist / maxDist)
      const rD = dA[idx] - dB[idx]
      const gD = dA[idx + 1] - dB[idx + 1]
      const bD = dA[idx + 2] - dB[idx + 2]
      diff += (rD * rD + gD * gD + bD * bD) * weight
      histA.r[dA[idx]] += 1
      histA.g[dA[idx + 1]] += 1
      histA.b[dA[idx + 2]] += 1
      histB.r[dB[idx]] += 1
      histB.g[dB[idx + 1]] += 1
      histB.b[dB[idx + 2]] += 1
    }
  }

  if (validPixels === 0) return Infinity

  const nA = {
    r: histA.r.map((v) => v / validPixels),
    g: histA.g.map((v) => v / validPixels),
    b: histA.b.map((v) => v / validPixels),
  }
  const nB = {
    r: histB.r.map((v) => v / validPixels),
    g: histB.g.map((v) => v / validPixels),
    b: histB.b.map((v) => v / validPixels),
  }

  let histDiff = 0
  for (let i = 0; i < 256; i += 1) {
    for (const ch of ['r', 'g', 'b'] as const) {
      const s = nA[ch][i] + nB[ch][i]
      if (s > 0) {
        const d = nA[ch][i] - nB[ch][i]
        histDiff += (d * d) / s
      }
    }
  }

  return (diff / validPixels) * 0.6 + histDiff * 1000 * 0.4
}

function getDominantColors(ctx: CanvasRenderingContext2D, width: number, height: number, topN = 3) {
  const d = ctx.getImageData(0, 0, width, height).data
  const map = new Map<string, number>()

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const a = d[i + 3]
    if (a < 10 || (r < 30 && g < 30 && b < 30)) continue
    if (r > 200 && g > 200 && b > 200) continue
    if (r < 50 && g < 50 && b < 50) continue

    const key = `${Math.round(r / 15) * 15},${Math.round(g / 15) * 15},${Math.round(b / 15) * 15}`
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  return Array.from(map.entries())
      .map(([k, count]) => {
        const [r, g, b] = k.split(',').map(Number)
        return { r, g, b, count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, topN)
}

function classifyColorFamily(r: number, g: number, b: number): string | null {
  if (g > r + 30 && g > b + 30 && g > 100) return 'green'
  if (r > 150 && g > 150 && b < r - 50 && b < g - 50) return 'yellow'
  if (b > r + 30 && b > g + 30 && b > 100) return 'blue'
  if (r > g + 30 && r > b + 30 && r > 100) return 'red'
  if (r > 120 && b > 120 && Math.abs(r - b) < 50 && g < Math.max(r, b) - 30) return 'purple'
  if (r > 150 && g > 100 && b < r - 50 && b < 100) return 'orange'
  return null
}

function detectShapes(ctx: CanvasRenderingContext2D, width: number, height: number): ShapeResult {
  const d = ctx.getImageData(0, 0, width, height).data
  const cX = width / 2
  const cY = height / 2

  const white: boolean[][] = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        const idx = (y * width + x) * 4
        return d[idx + 3] > 200 && d[idx] > 200 && d[idx + 1] > 200 && d[idx + 2] > 200
      }),
  )

  // shield detection
  let shieldPixels = 0
  let sTop = height
  let sBot = 0
  let sLeft = width
  let sRight = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (white[y][x]) {
        shieldPixels += 1
        sTop = Math.min(sTop, y)
        sBot = Math.max(sBot, y)
        sLeft = Math.min(sLeft, x)
        sRight = Math.max(sRight, x)
      }
    }
  }

  let hasShield = false
  if (shieldPixels > 50) {
    const sW = sRight - sLeft
    const sH = sBot - sTop
    const ar = sW / sH
    let topW = 0
    let midW = 0
    const midY = Math.floor(sTop + sH / 2)

    for (let x = sLeft; x <= sRight; x += 1) {
      if (sTop >= 0 && sTop < height && white[sTop][x]) topW += 1
      if (midY >= 0 && midY < height && white[midY][x]) midW += 1
    }

    hasShield = ar > 0.7 && ar < 1.3 && topW < midW * 0.8
  }

  // plus and cross detection
  let hLine = 0
  let vLine = 0

  for (let y = Math.floor(cY - 3); y <= Math.floor(cY + 3); y += 1) {
    if (y < 0 || y >= height) continue
    let cnt = 0
    for (let x = 0; x < width; x += 1) if (white[y][x]) cnt += 1
    if (cnt > width * 0.3) hLine += 1
  }

  for (let x = Math.floor(cX - 3); x <= Math.floor(cX + 3); x += 1) {
    if (x < 0 || x >= width) continue
    let cnt = 0
    for (let y = 0; y < height; y += 1) if (white[y][x]) cnt += 1
    if (cnt > height * 0.3) vLine += 1
  }

  const hasPlus = hLine > 2 && vLine > 2

  // arrow detection
  let diagUR = 0
  let diagUL = 0
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      if (white[y][x] && white[y + 1][x + 1]) diagUR += 1
      if (white[y][x + 1] && white[y + 1][x]) diagUL += 1
    }
  }
  const hasArrow = diagUR > 20 || diagUL > 20

  // fire detection
  let upward = 0
  for (let y = Math.floor(height / 2); y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (white[y][x] && !white[y + 1][x] && (white[y + 1][x - 1] || white[y + 1][x + 1])) {
        upward += 1
      }
    }
  }

  return {
    hasShield,
    hasCross: hasPlus,
    hasPlus,
    hasFire: upward > 30,
    hasWildFire: upward > 50,
    hasArrow,
    hasStar: false,
  }
}

// preloading

const ECHO_W = 192
const ECHO_H = 182
const SET_W = 32
const SET_H = 32

// preload echo images into processed canvas contexts
export async function preloadEchoImages(
    echoMap: Record<string, string>,
    echoCache: Record<string, CanvasRenderingContext2D>,
): Promise<void> {
  for (const [name, url] of Object.entries(echoMap)) {
    if (echoCache[name]) continue

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
      normalizeBrightness(ctx, ECHO_W, ECHO_H)
      increaseContrast(ctx, ECHO_W, ECHO_H, 2.5)
      echoCache[name] = ctx
    } catch {
      // skip failed image loads
    }
  }
}

// preload set images into canvas contexts
export async function preloadSetImages(
    setMap: Record<string, string>,
    setCache: Record<string, CanvasRenderingContext2D>,
): Promise<void> {
  for (const [name, url] of Object.entries(setMap)) {
    if (setCache[name]) continue

    try {
      const img = await loadImage(url)
      const ctx = makeCanvas(SET_W, SET_H)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, SET_W, SET_H)
      setCache[name] = ctx
    } catch {
      // skip failed image loads
    }
  }
}

// set matching

// match a set icon from the source canvas using the first-pass set matcher
export function matchSetFirst(
    srcCanvas: HTMLCanvasElement,
    setRegion: ImageRegion,
    setCache: Record<string, CanvasRenderingContext2D>,
): string | null {
  // extract the larger source region and scale it down
  const regionCtx = extractImageRegion(srcCanvas, setRegion)
  const resizedCtx = makeCanvas(SET_W, SET_H)
  resizedCtx.clearRect(0, 0, SET_W, SET_H)
  resizedCtx.drawImage(regionCtx.canvas, 0, 0, SET_W, SET_H)

  // aggressively mask black background
  const imgData = resizedCtx.getImageData(0, 0, SET_W, SET_H)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const x = (i / 4) % SET_W
    const y = Math.floor((i / 4) / SET_W)
    const isEdge = x < 3 || x >= 29 || y < 3 || y >= 29
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]

    if (
        (r < 50 && g < 50 && b < 50) ||
        (isEdge && r < 70 && g < 70 && b < 70) ||
        (!isEdge && r < 40 && g < 40 && b < 40)
    ) {
      d[i + 3] = 0
    }
  }
  resizedCtx.putImageData(imgData, 0, 0)

  const srcColors = getDominantColors(resizedCtx, SET_W, SET_H, 2)
  const srcFamilies = new Set(
      srcColors.map((c) => classifyColorFamily(c.r, c.g, c.b)).filter(Boolean) as string[],
  )
  const srcShapes = detectShapes(resizedCtx, SET_W, SET_H)

  let bestMatch: string | null = null
  let lowestDiff = Infinity
  const shapeKeys: (keyof ShapeResult)[] = [
    'hasShield',
    'hasCross',
    'hasPlus',
    'hasFire',
    'hasWildFire',
    'hasArrow',
    'hasStar',
  ]

  for (const [setName, refCtx] of Object.entries(setCache)) {
    const refColors = getDominantColors(refCtx, SET_W, SET_H, 2)
    const refFamilies = new Set(
        refColors.map((c) => classifyColorFamily(c.r, c.g, c.b)).filter(Boolean) as string[],
    )

    const colorMatch =
        srcFamilies.size > 0 &&
        refFamilies.size > 0 &&
        [...srcFamilies].some((family) => refFamilies.has(family))

    const colorPenalty = !colorMatch && srcFamilies.size > 0 && refFamilies.size > 0 ? 100000 : 0

    const refShapes = detectShapes(refCtx, SET_W, SET_H)
    let shapeMatch = 0
    for (const key of shapeKeys) {
      if (srcShapes[key] && refShapes[key]) shapeMatch += 1
      else if (srcShapes[key] !== refShapes[key]) shapeMatch -= 0.5
    }

    const shapeDiff = 1 - Math.max(0, (shapeMatch + 7) / 14)
    const pixelDiff = compareSetIcons(resizedCtx, refCtx, SET_W, SET_H)
    const combined = colorPenalty + shapeDiff * 5000 + pixelDiff * 0.1

    if (combined < lowestDiff) {
      lowestDiff = combined
      bestMatch = setName
    }
  }

  return bestMatch
}

// echo matching

// match an echo icon against a filtered set of candidate names
export function matchEchoFromFiltered(
    srcCanvas: HTMLCanvasElement,
    echoRegion: ImageRegion,
    filteredEchoNames: string[],
    echoCache: Record<string, CanvasRenderingContext2D>,
): string | null {
  // extract, mask, and preprocess the source region
  const srcCtx = extractImageRegion(srcCanvas, echoRegion)
  normalizeBrightness(srcCtx, ECHO_W, ECHO_H)
  increaseContrast(srcCtx, ECHO_W, ECHO_H, 2.5)
  const srcHist = calculateColorHistograms(srcCtx, ECHO_W, ECHO_H)

  let bestMatch: string | null = null
  let lowestDiff = Infinity

  for (const name of filteredEchoNames) {
    const refCtx = echoCache[name]
    if (!refCtx) continue

    const refHist = calculateColorHistograms(refCtx, ECHO_W, ECHO_H)
    const structural = compareImages(srcCtx, refCtx, ECHO_W, ECHO_H)
    const hist = compareColorHistograms(srcHist, refHist)
    const combined = structural * 0.5 + hist * 1000 * 0.5

    if (combined < lowestDiff) {
      lowestDiff = combined
      bestMatch = name
    }
  }

  return bestMatch
}