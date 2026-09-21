/*
  Author: Runor Ewhro
  Description: Parses fixed-layout build screenshots with OCR, pixel tests,
               and catalog image matching while preserving the Echo-only API.
*/

import Tesseract from 'tesseract.js'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { listWpnsByTy } from '@/data/catalog/weaponCatalogService'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'
import { getEchoMgMap, getSetNameMg, getSetNameTo } from '@/engine/echoParser/imageMap'
import {
  ATTRIBUTE_REGION,
  BUILD_REGIONS,
  CARD_HEIGHT,
  CARD_WIDTH,
  FILLED_PANEL_MIN_INK,
  HEAD_AREA,
  HEAD_AREA_BASE,
  HEAD_SAMPLE_COUNT,
  LEVEL_BADGE_BAND,
  LEVEL_BADGE_DIGITS,
  LEVEL_BADGE_PLATE,
  MAX_ASPECT_SKEW,
  MAX_DRIFT,
  MIN_CARD_WIDTH,
  NAME_BADGE_GAP,
  QR_PLATE,
  SEQUENCE_CENTERS,
  SEQUENCE_SAMPLE,
  SLOT_AREA_COUNT,
  SLOT_SAMPLE_COUNT,
  getEchoSlotRgns,
} from '@/engine/echoParser/cardRegions'
import {
  thrwIfAbrtd,
  type ReadOptions,
} from '@/engine/echoParser/readProgress'
import {
  resolveBuildScreenshotMetadata,
  type ParsedBuildMetadata,
  type RawBuildScreenshotReadings,
  type RawCoreSkillLevels,
} from '@/engine/echoParser/buildMetadata'
import {
  prldEchoMgs,
  prldSetMgs,
  mtchSetFrst,
  mtchEchoFrom,
  loadImage,
} from '@/engine/echoParser/imageMatching'
import type { ImageRegion } from '@/engine/echoParser/imageMatching'
import { costForMain } from '@/engine/echoParser/echoBuilder'
import type { AttributeKey } from '@/domain/entities/stats'
import type { EchoDef } from '@/domain/entities/catalog'

export interface RawPrsdEcho {
  cost: string
  mainStatLbl: string
  substats: string[]
  /** each substat's number, read on its own with a digits-only whitelist */
  substatValues?: string[]
  echoName: string | null
  setName: string | null
}

export interface ParsedBuildScreenshot extends ParsedBuildMetadata {
  echoes: RawPrsdEcho[]
}

// a short value ("21%") alone in its box sometimes reads as nothing; each pass
// retries only the rows still empty, and the roll tables vet whatever comes back
const VALUE_PASSES = [
  { scale: 2, psm: '7' },
  { scale: 3, psm: '7' },
  { scale: 3, psm: '13' },
] as const

// module-level caches so reference images are only loaded once
const echoCache: Record<string, CanvasRenderingContext2D> = {}
const setCache: Record<string, CanvasRenderingContext2D> = {}

function clrCnvsCch(cache: Record<string, CanvasRenderingContext2D>): void {
  for (const [key, context] of Object.entries(cache)) {
    context.canvas.width = 0
    context.canvas.height = 0
    delete cache[key]
  }
}

// Otsu's threshold: the grey level that best splits a crop into ink and ground
function otsuThreshold(gray: Uint8ClampedArray): number {
  const histogram = new Array<number>(256).fill(0)
  for (const value of gray) histogram[value] += 1
  let sum = 0
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level]
  let sumBelow = 0
  let weightBelow = 0
  let best = 0
  let threshold = 128
  for (let level = 0; level < 256; level += 1) {
    weightBelow += histogram[level]
    if (weightBelow === 0) continue
    const weightAbove = gray.length - weightBelow
    if (weightAbove === 0) break
    sumBelow += level * histogram[level]
    const between = weightBelow * weightAbove
        * (sumBelow / weightBelow - (sum - sumBelow) / weightAbove) ** 2
    if (between > best) {
      best = between
      threshold = level
    }
  }
  return threshold
}

type TextCleanup = 'contrast' | 'threshold'

// extract OCR text from an image region after grayscale cleanup: a contrast
// stretch by default, or a hard ink/ground split framed in white for the few
// dark-on-light marks (the level badge) that a stretch leaves soft
async function extractText(
    canvas: HTMLCanvasElement,
    worker: Tesseract.Worker,
    region: ImageRegion,
    scale = 1,
    cleanup: TextCleanup = 'contrast',
): Promise<string> {
  const tmp = document.createElement('canvas')
  tmp.width = region.width * scale
  tmp.height = region.height * scale
  const ctx = tmp.getContext('2d', { willReadFrequently: true })!
  if (cleanup === 'threshold') ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    canvas,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    tmp.width,
    tmp.height,
  )

  const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height)
  const d = imgData.data
  const gray = new Uint8ClampedArray(d.length / 4)

  for (let i = 0; i < d.length; i += 4) {
    gray[i / 4] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
  }

  const threshold = cleanup === 'threshold' ? otsuThreshold(gray) : 0
  for (let i = 0; i < d.length; i += 4) {
    const value = gray[i / 4]
    const v = cleanup === 'threshold'
      ? (value > threshold ? 255 : 0)
      : Math.max(0, Math.min(255, (value - 128) * 1.5 + 128))
    d[i] = d[i + 1] = d[i + 2] = v
  }

  ctx.putImageData(imgData, 0, 0)

  let image = tmp
  if (cleanup === 'threshold') {
    const margin = 12
    image = document.createElement('canvas')
    image.width = tmp.width + margin * 2
    image.height = tmp.height + margin * 2
    const framed = image.getContext('2d')!
    framed.fillStyle = '#fff'
    framed.fillRect(0, 0, image.width, image.height)
    framed.drawImage(tmp, margin, margin)
  }

  const {
    data: { text },
  } = await worker.recognize(image.toDataURL())

  return text.trim()
}

async function safeExtractText(
    canvas: HTMLCanvasElement,
    worker: Tesseract.Worker,
    region: ImageRegion,
    scale = 2,
): Promise<string> {
  try {
    return await extractText(canvas, worker, region, scale)
  } catch {
    return ''
  }
}

function detectAttribute(canvas: HTMLCanvasElement): AttributeKey | null {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const pixels = context.getImageData(
    ATTRIBUTE_REGION.x,
    ATTRIBUTE_REGION.y,
    ATTRIBUTE_REGION.width,
    ATTRIBUTE_REGION.height,
  ).data
  let red = 0
  let green = 0
  let blue = 0
  let count = 0

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    const brightest = Math.max(r, g, b)
    const darkest = Math.min(r, g, b)
    if (brightest <= 80 || brightest - darkest <= 30) continue
    red += r
    green += g
    blue += b
    count += 1
  }

  if (count < 25) return null
  const average = [red / count, green / count, blue / count]
  const attributes = (Object.keys(ATTR_COLORS) as AttributeKey[])
      .filter((attribute) => attribute !== 'physical')

  return attributes.reduce<{ attribute: AttributeKey | null; distance: number }>(
    (best, attribute) => {
      const hex = ATTR_COLORS[attribute]
      const target = [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
      ]
      const distance = average.reduce(
        (sum, channel, channelIndex) => sum + (channel - target[channelIndex]) ** 2,
        0,
      )
      return distance < best.distance ? { attribute, distance } : best
    },
    { attribute: null, distance: Infinity },
  ).attribute
}

// the level badge is dark type on a gold plate, so it is found by the plate:
// every chase window that straddled the name's bright glyphs read it wrong.
// the box comes back in the band's own coordinates.
export function fndLvlPlate(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
): ImageRegion | null {
  const isGold = (column: number, row: number): boolean => {
    const index = (row * width + column) * 4
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    return r > 130 && g > 105 && r >= g - 10 && g > b + 25
  }

  const columns = new Array<number>(width).fill(0)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (isGold(column, row)) columns[column] += 1
    }
  }

  // the glyphs cut the plate into pieces, so near columns join back up
  let widest: [number, number] | null = null
  let start = -1
  let last = -1
  for (let column = 0; column < width; column += 1) {
    if (columns[column] < LEVEL_BADGE_PLATE.minRows) continue
    if (start < 0) start = column
    else if (column - last > LEVEL_BADGE_PLATE.maxGap) {
      if (!widest || last - start > widest[1] - widest[0]) widest = [start, last]
      start = column
    }
    last = column
  }
  if (start >= 0 && (!widest || last - start > widest[1] - widest[0])) widest = [start, last]
  if (!widest || widest[1] - widest[0] + 1 < LEVEL_BADGE_PLATE.minWidth) return null

  const [left, right] = widest
  const span = right - left + 1
  let top = -1
  let bottom = -1
  for (let row = 0; row < height; row += 1) {
    let hits = 0
    for (let column = left; column <= right; column += 1) {
      if (isGold(column, row)) hits += 1
    }
    if (hits <= span * LEVEL_BADGE_PLATE.rowFill) continue
    if (top < 0) top = row
    bottom = row
  }
  if (top < 0) return null

  return { x: left, y: top, width: span, height: bottom - top + 1 }
}

// the plate's box on the card, with the breathing room the reader wants
function findLvlBdg(canvas: HTMLCanvasElement): ImageRegion | null {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const { x, y, width, height } = LEVEL_BADGE_BAND
  const plate = fndLvlPlate(context.getImageData(x, y, width, height).data, width, height)
  if (!plate) return null

  const pad = LEVEL_BADGE_PLATE.pad
  const badgeX = Math.max(0, x + plate.x - pad.x)
  const badgeY = Math.max(0, y + plate.y - pad.y)
  return {
    x: badgeX,
    y: badgeY,
    width: Math.min(CARD_WIDTH - badgeX, plate.width + pad.x * 2),
    height: Math.min(CARD_HEIGHT - badgeY, plate.height + pad.y * 2),
  }
}

function detectActiveSequences(canvas: HTMLCanvasElement): boolean[] {
  const context = canvas.getContext('2d', { willReadFrequently: true })!

  return SEQUENCE_CENTERS.map((centerX) => {
    const half = Math.floor(SEQUENCE_SAMPLE.size / 2)
    const pixels = context.getImageData(
      centerX - half,
      SEQUENCE_SAMPLE.y,
      SEQUENCE_SAMPLE.size,
      SEQUENCE_SAMPLE.size,
    ).data
    let brightPixels = 0
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2]
      if (luminance > 180) brightPixels += 1
    }
    return brightPixels / (pixels.length / 4) >= 0.2
  })
}

async function matchResonatorSprite(
    canvas: HTMLCanvasElement,
    candidateIds: string[],
): Promise<string | null> {
  if (candidateIds.length === 1) return candidateIds[0]
  if (candidateIds.length < 2) return null

  const source = canvas.getContext('2d', { willReadFrequently: true })!
  const sourcePixels = source.getImageData(0, 0, canvas.width, canvas.height).data
  const candidates = listResSds().filter(
    (resonator) => candidateIds.includes(resonator.id) && resonator.sprite,
  )
  const scored = await Promise.all(candidates.map(async (resonator) => {
    try {
      const image = await loadImage(resonator.sprite!)
      const referenceCanvas = document.createElement('canvas')
      referenceCanvas.width = image.naturalWidth
      referenceCanvas.height = image.naturalHeight
      const reference = referenceCanvas.getContext('2d', { willReadFrequently: true })!
      reference.drawImage(image, 0, 0)
      const pixels = reference.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data
      let difference = 0
      let samples = 0

      // The bot places the catalog sprite at this fixed transform. Sparse opaque
      // samples distinguish same-name Rover variants without scanning every pixel.
      for (let y = 0; y < Math.min(image.naturalHeight, 850); y += 12) {
        for (let x = 0; x < image.naturalWidth; x += 12) {
          const index = (y * image.naturalWidth + x) * 4
          const alpha = pixels[index + 3]
          const brightest = Math.max(pixels[index], pixels[index + 1], pixels[index + 2])
          if (alpha <= 245 || brightest <= 70) continue

          const sourceX = Math.round(140 + x * 0.72)
          const sourceY = Math.round(y * 0.72)
          if (sourceX >= 760 || sourceY >= 640) continue

          const sourceIndex = (sourceY * canvas.width + sourceX) * 4
          difference += Math.abs(sourcePixels[sourceIndex] - pixels[index])
              + Math.abs(sourcePixels[sourceIndex + 1] - pixels[index + 1])
              + Math.abs(sourcePixels[sourceIndex + 2] - pixels[index + 2])
          samples += 1
        }
      }

      referenceCanvas.width = 0
      referenceCanvas.height = 0
      return { id: resonator.id, score: samples >= 100 ? difference / samples : Infinity }
    } catch {
      return { id: resonator.id, score: Infinity }
    }
  }))
  scored.sort((left, right) => left.score - right.score)
  const [best, runnerUp] = scored
  if (!best || !Number.isFinite(best.score)) return null
  if (runnerUp && best.score > runnerUp.score * 0.85) return null
  return best.id
}

async function extractBuildMetadata(
    canvas: HTMLCanvasElement,
    worker: Tesseract.Worker,
    options: ReadOptions = {},
): Promise<ParsedBuildMetadata> {
  const { onProgress, signal } = options
  let done = 0

  // one head sample: the region it looked at, and how far the stage has come
  function readHead(offset: number): void {
    done += 1
    onProgress?.({
      stage: 'head',
      done,
      total: HEAD_SAMPLE_COUNT,
      area: HEAD_AREA_BASE + offset,
    })
  }

  await worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.'_-:/ ",
    tessedit_pageseg_mode: '7' as Tesseract.PSM,
  })
  // the badge sits on the name's line, so finding it also says where the name ends
  const levelBadge = findLvlBdg(canvas)
  const nameRegion = levelBadge
    ? {
      ...BUILD_REGIONS.resonatorName,
      width: Math.max(40, levelBadge.x - NAME_BADGE_GAP - BUILD_REGIONS.resonatorName.x),
    }
    : BUILD_REGIONS.resonatorName

  readHead(HEAD_AREA.resonatorName)
  const resonatorNameText = await safeExtractText(canvas, worker, nameRegion)
  thrwIfAbrtd(signal)
  readHead(HEAD_AREA.playerId)
  const playerIdText = await safeExtractText(canvas, worker, BUILD_REGIONS.playerId)
  thrwIfAbrtd(signal)
  readHead(HEAD_AREA.weaponName)
  const weaponNameText = await safeExtractText(canvas, worker, BUILD_REGIONS.weaponName)
  thrwIfAbrtd(signal)
  // the colon belongs to this pass, so the UID is read before the level whitelist
  readHead(HEAD_AREA.uid)
  const uidText = await safeExtractText(canvas, worker, BUILD_REGIONS.uid)
  thrwIfAbrtd(signal)

  await worker.setParameters({
    tessedit_char_whitelist: 'LVlv.0123456789/ ',
    tessedit_pageseg_mode: '7' as Tesseract.PSM,
  })
  readHead(HEAD_AREA.resonatorLevel)
  // the digits alone, so neither the "LV." nor the hatching can be misread into them;
  // the whole badge, then the name line, stand in when that read fails
  let resonatorLevelText = resonatorNameText
  if (levelBadge) {
    const plateLeft = levelBadge.x + LEVEL_BADGE_PLATE.pad.x
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: '7' as Tesseract.PSM,
    })
    const digits = await extractText(canvas, worker, {
      ...levelBadge,
      x: plateLeft + LEVEL_BADGE_DIGITS.from,
      width: LEVEL_BADGE_DIGITS.width,
    }, 4, 'threshold').catch(() => '')
    await worker.setParameters({
      tessedit_char_whitelist: 'LVlv.0123456789/ ',
      tessedit_pageseg_mode: '7' as Tesseract.PSM,
    })
    resonatorLevelText = /^\d{1,2}$/.test(digits)
      ? `LV.${digits}`
      : await safeExtractText(canvas, worker, levelBadge)
  }
  thrwIfAbrtd(signal)
  readHead(HEAD_AREA.weaponLevel)
  const weaponLevelText = await safeExtractText(canvas, worker, BUILD_REGIONS.weaponLevel)
  thrwIfAbrtd(signal)

  const skillLevelText = {} as RawCoreSkillLevels
  for (const [key, region] of Object.entries(BUILD_REGIONS.skillLevels)) {
    const skill = key as keyof RawCoreSkillLevels
    readHead(HEAD_AREA[skill])
    skillLevelText[skill] = await safeExtractText(canvas, worker, region)
    thrwIfAbrtd(signal)
  }

  readHead(HEAD_AREA.attribute)
  const attribute = detectAttribute(canvas)
  const activeSequences = detectActiveSequences(canvas)
  SEQUENCE_CENTERS.forEach((_, index) => readHead(HEAD_AREA.sequence + index))

  const readings: RawBuildScreenshotReadings = {
    playerIdText,
    uidText,
    resonatorNameText,
    resonatorLevelText,
    weaponNameText,
    weaponLevelText,
    skillLevelText,
    attribute,
    activeSequences,
  }

  const metadata = resolveBuildScreenshotMetadata(readings, {
    resonators: listResSds(),
    weapons: [1, 2, 3, 4, 5].flatMap((weaponType) => listWpnsByTy(weaponType)),
  })
  onProgress?.({ stage: 'match', done: 0, total: 1 })
  const resonatorId = metadata.resonator.id
      ?? await matchResonatorSprite(canvas, metadata.resonator.candidateIds)
  onProgress?.({ stage: 'match', done: 1, total: 1 })

  return resonatorId
    ? { ...metadata, resonator: { ...metadata.resonator, id: resonatorId } }
    : metadata
}

export interface CardDrift {
  dx: number
  dy: number
}

// every coordinate is fixed, so a card that sits a few pixels off (cropped,
// padded, re-framed) is measured against the QR plate and moved back
export function findDrift(canvas: HTMLCanvasElement): CardDrift {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
  const bright = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const index = (y * width + x) * 4
    return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2] > 200
  }
  // a run of white, so one stray light pixel is never taken for the plate
  const RUN = 6
  const runFrom = (x: number, y: number, stepX: number, stepY: number): boolean => {
    for (let step = 0; step < RUN; step += 1) {
      if (!bright(x + step * stepX, y + step * stepY)) return false
    }
    return true
  }
  const median = (values: number[]): number | null => {
    const found = values.filter((value) => value >= 0).sort((left, right) => left - right)
    return found.length >= 2 ? found[Math.floor(found.length / 2)] : null
  }
  const scan = (from: number, to: number, hit: (at: number) => boolean): number => {
    const step = from < to ? 1 : -1
    for (let at = from; at !== to; at += step) if (hit(at)) return at
    return -1
  }

  const left = median(QR_PLATE.rows.map((y) => scan(
    QR_PLATE.left - MAX_DRIFT, QR_PLATE.left + MAX_DRIFT, (x) => runFrom(x, y, 1, 0),
  )))
  const right = median(QR_PLATE.rows.map((y) => scan(
    QR_PLATE.left + QR_PLATE.width + MAX_DRIFT, QR_PLATE.left + QR_PLATE.width - MAX_DRIFT, (x) => runFrom(x, y, -1, 0),
  )))
  const top = median(QR_PLATE.columns.map((x) => scan(
    Math.max(0, QR_PLATE.top - MAX_DRIFT), QR_PLATE.top + MAX_DRIFT, (y) => runFrom(x, y, 0, 1),
  )))
  if (left === null || right === null || top === null) return { dx: 0, dy: 0 }

  // a plate of the wrong width is not the plate, so nothing moves
  if (Math.abs(right - left + 1 - QR_PLATE.width) > 3) return { dx: 0, dy: 0 }
  return { dx: left - QR_PLATE.left, dy: top - QR_PLATE.top }
}

// an empty panel is bare background; reading it anyway makes up an echo from noise
function slotHasEcho(canvas: HTMLCanvasElement, region: ImageRegion): boolean {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const pixels = context.getImageData(region.x, region.y, region.width, region.height).data
  let ink = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2]
    if (luminance > 110) ink += 1
  }
  return ink >= FILLED_PANEL_MIN_INK
}

// the sonata marks say which echoes a card can hold, so only those icons load
function pickSetEchoMgs(
    echoImages: Record<string, string>,
    catalog: EchoDef[],
    slotSets: Array<string | null>,
): Record<string, string> {
  if (slotSets.length === 0 || slotSets.some((setName) => setName === null)) return echoImages

  const nameToId = getSetNameTo()
  const setIds = new Set(slotSets.map((setName) => nameToId[setName!]))
  const wanted: Record<string, string> = {}

  for (const echo of catalog) {
    if (echoImages[echo.name] && echo.sets.some((setId) => setIds.has(setId))) {
      wanted[echo.name] = echoImages[echo.name]
    }
  }

  return Object.keys(wanted).length > 0 ? wanted : echoImages
}

// parse the complete build card while leaving application decisions to callers
export async function prsBldFromMg(
    file: File,
    options: ReadOptions = {},
): Promise<ParsedBuildScreenshot> {
  const { onProgress, signal } = options
  const img = new Image()
  const objectUrl = URL.createObjectURL(file)

  try {
    const loadedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = objectUrl
    })

    // a resized card (a chat preview, a phone save) is scaled back to the bot's own size
    const aspect = loadedImg.naturalWidth / loadedImg.naturalHeight
    if (
      Math.abs(aspect / (CARD_WIDTH / CARD_HEIGHT) - 1) > MAX_ASPECT_SKEW
      || loadedImg.naturalWidth < MIN_CARD_WIDTH
    ) {
      throw new Error('invalid_image_size')
    }

    const canvas = document.createElement('canvas')
    canvas.width = CARD_WIDTH
    canvas.height = CARD_HEIGHT
    const context = canvas.getContext('2d')!
    context.imageSmoothingQuality = 'high'
    context.drawImage(loadedImg, 0, 0, CARD_WIDTH, CARD_HEIGHT)

    const drift = findDrift(canvas)
    if (drift.dx !== 0 || drift.dy !== 0) {
      context.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
      context.drawImage(loadedImg, -drift.dx, -drift.dy, CARD_WIDTH, CARD_HEIGHT)
    }

    const echoImages = getEchoMgMap()
    const setImages = getSetNameMg()
    const echoCatalog = listEchoes()
    const coords = getEchoSlotRgns()

    // the callbacks throw on abort, so a cancel lands mid-catalogue too
    const setCount = Object.keys(setImages).length
    await prldSetMgs(setImages, setCache, (done) => {
      onProgress?.({ stage: 'catalog', done, total: setCount, note: 'Loading the sonata marks' })
      thrwIfAbrtd(signal)
    })

    // match the sonata marks before loading any echo art; empty panels have none
    const filled = coords.map((slot) => slotHasEcho(canvas, slot.sideStat))
    const slotSets = coords.map((slot, index) => (
      filled[index] ? mtchSetFrst(canvas, slot.set, setCache) : null
    ))
    const wantedEchoMgs = pickSetEchoMgs(
      echoImages,
      echoCatalog,
      slotSets.filter((_, index) => filled[index]),
    )
    const catalogTotal = setCount + Object.keys(wantedEchoMgs).length

    await prldEchoMgs(wantedEchoMgs, echoCache, (done) => {
      onProgress?.({
        stage: 'catalog',
        done: setCount + done,
        total: catalogTotal,
        note: 'Loading the echo art',
      })
      thrwIfAbrtd(signal)
    })

    // the reader fetches its own wasm and language data on a first run
    let booting = true
    onProgress?.({ stage: 'worker', done: 0, total: 1 })
    const worker = await Tesseract.createWorker('eng', undefined, {
      logger: ({ status, progress }) => {
        if (!booting) return
        onProgress?.({
          stage: 'worker',
          done: typeof progress === 'number' ? progress : 0,
          total: 1,
          note: status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}` : undefined,
        })
      },
    })
    booting = false
    onProgress?.({ stage: 'worker', done: 1, total: 1 })
    thrwIfAbrtd(signal)
    const whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.%+ '

    await worker.setParameters({
      tessedit_char_whitelist: whitelist,
      tessedit_pageseg_mode: '7' as Tesseract.PSM,
    })

    const results: RawPrsdEcho[] = []

    try {
      let sampled = 0

      // one echo-panel sample: which region, and how far the stage has come
      const readSlot = (slotIndex: number, part: number) => {
        sampled += 1
        onProgress?.({
          stage: 'slots',
          done: sampled,
          total: SLOT_SAMPLE_COUNT,
          area: slotIndex * SLOT_AREA_COUNT + part,
        })
      }

      for (let index = 0; index < coords.length; index += 1) {
        const slot = coords[index]
        thrwIfAbrtd(signal)

        if (!filled[index]) {
          for (let part = 0; part < SLOT_AREA_COUNT; part += 1) readSlot(index, part)
          results.push({ cost: '', mainStatLbl: '', substats: [], substatValues: [], echoName: null, setName: null })
          continue
        }

        // the cost is one small digit, which the reader only sees scaled up and read alone
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: '10' as Tesseract.PSM,
        })

        readSlot(index, 0)
        let cost = (await extractText(canvas, worker, slot.cost, 4)).replace(/[^0-9]/g, '')

        // the main stat is one short line; at card size a lone "DEF" can read as noise
        await worker.setParameters({
          tessedit_char_whitelist: whitelist,
          tessedit_pageseg_mode: '7' as Tesseract.PSM,
        })

        readSlot(index, 1)
        const mainStatLbl = await extractText(canvas, worker, slot.mainStatLabel, 2)

        // a digit that did not read falls back on the main stat, which often names its cost
        if (!['1', '3', '4'].includes(cost)) cost = String(costForMain(mainStatLbl) ?? 4)

        // substat labels wrap onto a second line, so they are read as a block
        await worker.setParameters({
          tessedit_char_whitelist: whitelist,
          tessedit_pageseg_mode: '6' as Tesseract.PSM,
        })

        const substats: string[] = []
        for (const [subIndex, sub] of slot.substats.entries()) {
          readSlot(index, 2 + subIndex)
          const raw = await extractText(canvas, worker, sub, 3)
          substats.push(raw.replace(/\n/g, ' ').replace(/[^\w.%+ ]/g, '').trim())
          thrwIfAbrtd(signal)
        }

        // a blurred number read with letters allowed comes back as a word ("pURLL"),
        // so the numbers are read on their own
        const substatValues: string[] = slot.substatValues.map(() => '')
        for (const pass of VALUE_PASSES) {
          const pending = substatValues.flatMap((value, row) => (/\d/.test(value) ? [] : [row]))
          if (pending.length === 0) break
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789.%',
            tessedit_pageseg_mode: pass.psm as Tesseract.PSM,
          })
          for (const row of pending) {
            const text = await extractText(canvas, worker, slot.substatValues[row], pass.scale)
            substatValues[row] = text.replace(/\s+/g, '')
            thrwIfAbrtd(signal)
          }
        }

        // the sonata mark was matched before the icons loaded
        readSlot(index, 7)
        const setName = slotSets[index]

        // filter echo candidates by set and cost
        let fltrNms: string[] = []
        if (setName !== null) {
          const setId = getSetNameTo()[setName]
          fltrNms = echoCatalog
              .filter((echo) => echo.sets.includes(setId) && String(echo.cost) === cost)
              .map((echo) => echo.name)

          // if cost filtering removes everything, fall back to set-only filtering
          if (fltrNms.length === 0) {
            fltrNms = echoCatalog
                .filter((echo) => echo.sets.includes(setId))
                .map((echo) => echo.name)
          }
        }

        // if set match failed, search across all echoes
        if (fltrNms.length === 0) {
          fltrNms = Object.keys(getEchoMgMap())
        }

        // match echo icon from remaining candidates
        readSlot(index, 8)
        const echoName = mtchEchoFrom(canvas, slot.echoImage, fltrNms, echoCache)

        results.push({
          cost,
          mainStatLbl: mainStatLbl,
          substats,
          substatValues,
          echoName,
          setName,
        })
      }

      const metadata = await extractBuildMetadata(canvas, worker, options)
      return { ...metadata, echoes: results }
    } finally {
      await worker.terminate()
      clrCnvsCch(echoCache)
      clrCnvsCch(setCache)
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// preserve the Echo-only API while still running the complete screenshot extraction
export async function prsChsFromMg(
    file: File,
    options: ReadOptions = {},
): Promise<RawPrsdEcho[]> {
  return (await prsBldFromMg(file, options)).echoes
}
