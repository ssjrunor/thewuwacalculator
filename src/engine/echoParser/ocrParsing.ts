/*
  Author: Runor Ewhro
  description: parses fixed-layout build screenshots with ocr, pixel tests,
               and catalog image matching while preserving the echo-only api.
*/

import Tesseract from 'tesseract.js'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { listWpnsByTy } from '@/data/catalog/weaponCatalogService'
import {
  getEchoMgKeys,
  getEchoMgMap,
  getSetNameMg,
  getSetNameTo,
} from '@/engine/echoParser/imageMap'
import { artAgrees, pickEchoAndSet } from '@/engine/echoParser/echoPick'
import {
  ATTRIBUTE_REGION,
  BUILD_REGIONS,
  CARD_FRAME,
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
  SHORT_LABEL,
  SLOT_AREA_COUNT,
  SLOT_SAMPLE_COUNT,
  WEAPON_ICON,
  getEchoSlotRgns,
} from '@/engine/echoParser/cardRegions'
import {
  thrwIfAbrtd,
  type ReadOptions,
} from '@/engine/echoParser/readProgress'
import {
  ART_MARGIN,
  resolveBuildScreenshotMetadata,
  settleResonatorArt,
  settleWeapon,
  type ParsedBuildMetadata,
  type RawBuildScreenshotReadings,
  type RawCoreSkillLevels,
} from '@/engine/echoParser/buildMetadata'
import {
  prldEchoMgs,
  prldSetMgs,
  rnkSets,
  cmprEchoArt,
  rnkEchoFrom,
  rnkWeapons,
  loadImage,
} from '@/engine/echoParser/imageMatching'
import type { ImageRegion } from '@/engine/echoParser/imageMatching'
import { costForMain } from '@/engine/echoParser/echoBuilder'
import { namesMain, namesSubstat, readSubstat } from '@/engine/echoParser/statReading'
import type { AttributeKey } from '@/domain/entities/stats'

export interface RawPrsdEcho {
  cost: string
  mainStatLbl: string
  /** the main stat's printed value, read only when its label names no stat */
  mainStatValue?: string
  substats: string[]
  /** each substat's number, read on its own with a digits-only whitelist */
  substatValues?: string[]
  echoName: string | null
  setName: string | null
}

export interface ParsedBuildScreenshot extends ParsedBuildMetadata {
  echoes: RawPrsdEcho[]
  source: {
    /** uploaded image dimensions before normalization to the 1920 x 1080 card. */
    width: number
    height: number
    lowResolution: boolean
    /** mean channel distance between fixed card elements and the reference image. */
    frameScore: number
    /** whether the fixed card elements match the reference image. */
    botFrame: boolean
    /** whether at least half the substat labels were unreadable. */
    unreadText: boolean
  }
}

// retry values without an exact legal roll at several scales and segmentation
// modes; retain exact reads across passes.
const VALUE_PASSES = [
  { scale: 2, psm: '7' },
  { scale: 3, psm: '7' },
  { scale: 3, psm: '13' },
] as const

// cache reference images across parses; the set glyphs total a few hundred kilobytes.
const echoCache: Record<string, CanvasRenderingContext2D> = {}
const setCache: Record<string, Float32Array> = {}

function clrCnvsCch(cache: Record<string, CanvasRenderingContext2D>): void {
  for (const [key, context] of Object.entries(cache)) {
    context.canvas.width = 0
    context.canvas.height = 0
    delete cache[key]
  }
}

// otsu's threshold: the grey level that best splits a crop into ink and ground
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

// the worker, core and language data are served from our own origin
// (staged by tools/data/stageOcrAssets.mjs); the worker runs from a blob, so the paths are absolute
function ocrAssetPaths(): Pick<Tesseract.WorkerOptions, 'workerPath' | 'corePath' | 'langPath'> {
  const base = new URL('/assets/app/ocr/', window.location.origin).href
  return { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.replace(/\/$/, '') }
}

type TextCleanup = 'contrast' | 'threshold' | 'plain'

// read a cropped region using contrast, threshold, or plain grayscale cleanup.
// threshold handles dark text on a light badge; plain grayscale handles dim cards.
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
      : cleanup === 'plain' ? value : Math.max(0, Math.min(255, (value - 128) * 1.5 + 128))
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

function hueOf(r: number, g: number, b: number): number {
  const brightest = Math.max(r, g, b)
  const span = brightest - Math.min(r, g, b)
  if (span === 0) return 0
  const sector = brightest === r
    ? (g - b) / span
    : brightest === g ? (b - r) / span + 2 : (r - g) / span + 4
  return (sector * 60 + 360) % 360
}

// median icon hues measured on native and resized reference cards, within 2 degrees.
const ATTRIBUTE_HUES: Array<[AttributeKey, number]> = [
  ['spectro', 46],
  ['aero', 158],
  ['glacio', 200],
  ['electro', 280],
  ['havoc', 322],
  ['fusion', 349],
]

// reject hues more than 12 degrees from every reference icon.
const ATTRIBUTE_HUE_REACH = 12

function detectAttribute(canvas: HTMLCanvasElement): AttributeKey | null {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const pixels = context.getImageData(
    ATTRIBUTE_REGION.x,
    ATTRIBUTE_REGION.y,
    ATTRIBUTE_REGION.width,
    ATTRIBUTE_REGION.height,
  ).data

  // sample saturated icon pixels; the header and antialiased edges shift the hue.
  const hues: number[] = []
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    const brightest = Math.max(r, g, b)
    if (brightest < 77 || brightest - Math.min(r, g, b) < brightest * 0.3) continue
    hues.push(hueOf(r, g, b))
  }
  if (hues.length < 25) return null

  hues.sort((left, right) => left - right)
  const median = hues[Math.floor(hues.length / 2)]
  let best: { attribute: AttributeKey; distance: number } | null = null
  for (const [attribute, hue] of ATTRIBUTE_HUES) {
    const gap = Math.abs(median - hue)
    const distance = Math.min(gap, 360 - gap)
    if (!best || distance < best.distance) best = { attribute, distance }
  }
  return best && best.distance <= ATTRIBUTE_HUE_REACH ? best.attribute : null
}

// find the dark level text through its gold plate. search windows crossing the
// name's bright glyphs produced false readings.
// the returned box uses the band's own coordinates.
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

// locate the badge plate with crop padding.
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

// compare the upper half of catalog portraits at a nominal width of 500 pixels;
// search nearby offsets because card placement varies by resonator.
const SPRITE_PLACE = { x: 140, y: 2, widths: [492, 497, 502, 507], reach: 6, step: 2 }
const SPRITE_UPPER = 0.5
const SPRITE_BOUNDS = { width: 760, height: 640 }

// every candidate's catalog sprite scored against the card's portrait, closest first
async function rankResonatorSprites(
    canvas: HTMLCanvasElement,
    candidateIds: string[],
): Promise<{ id: string; score: number }[]> {
  const source = canvas.getContext('2d', { willReadFrequently: true })!
  const card = source.getImageData(0, 0, SPRITE_BOUNDS.width, SPRITE_BOUNDS.height).data
  const candidates = listResSds().filter(
    (resonator) => candidateIds.includes(resonator.id) && resonator.sprite,
  )
  const scored = await Promise.all(candidates.map(async (resonator) => {
    let image: HTMLImageElement
    try {
      image = await loadImage(resonator.sprite!)
    } catch {
      return { id: resonator.id, score: Infinity }
    }
    let best = Infinity
    for (const width of SPRITE_PLACE.widths) {
      const scale = width / image.naturalWidth
      const height = Math.round(image.naturalHeight * scale * SPRITE_UPPER)
      const reference = document.createElement('canvas')
      reference.width = width
      reference.height = height
      const context = reference.getContext('2d', { willReadFrequently: true })!
      context.drawImage(image, 0, 0, width, height / SPRITE_UPPER)
      const pixels = context.getImageData(0, 0, width, height).data
      reference.width = 0

      // sparse opaque samples, kept once per scale
      const samples: number[] = []
      for (let y = 0; y < height; y += 6) {
        for (let x = 0; x < width; x += 6) {
          const index = (y * width + x) * 4
          if (pixels[index + 3] > 245 && Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 40) {
            samples.push(x, y, pixels[index], pixels[index + 1], pixels[index + 2])
          }
        }
      }

      for (let dy = -SPRITE_PLACE.reach; dy <= SPRITE_PLACE.reach; dy += SPRITE_PLACE.step) {
        for (let dx = -SPRITE_PLACE.reach; dx <= SPRITE_PLACE.reach; dx += SPRITE_PLACE.step) {
          let difference = 0
          let count = 0
          for (let k = 0; k < samples.length; k += 5) {
            const x = SPRITE_PLACE.x + dx + samples[k]
            const y = SPRITE_PLACE.y + dy + samples[k + 1]
            if (x < 0 || y < 0 || x >= SPRITE_BOUNDS.width || y >= SPRITE_BOUNDS.height) continue
            const index = (y * SPRITE_BOUNDS.width + x) * 4
            difference += Math.abs(card[index] - samples[k + 2])
                + Math.abs(card[index + 1] - samples[k + 3])
                + Math.abs(card[index + 2] - samples[k + 4])
            count += 1
          }
          if (count >= 100) best = Math.min(best, difference / count)
        }
      }
    }
    return { id: resonator.id, score: best }
  }))
  return scored.filter((entry) => Number.isFinite(entry.score)).sort((left, right) => left.score - right.score)
}

const LEVEL_READS = [
  [4, 'threshold'],
  [6, 'threshold'],
  [4, 'plain'],
] as const

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
  // use the badge position to set the name region width.
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
  // the colon belongs to this pass, so the uid is read before the level whitelist
  readHead(HEAD_AREA.uid)
  const uidText = await safeExtractText(canvas, worker, BUILD_REGIONS.uid)
  thrwIfAbrtd(signal)
  // verify the uid with a larger digits-only read before assigning a player.
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '7' as Tesseract.PSM,
  })
  const uidCheckText = await safeExtractText(canvas, worker, BUILD_REGIONS.uid, 2)
  thrwIfAbrtd(signal)

  await worker.setParameters({
    tessedit_char_whitelist: 'LVlv.0123456789/ ',
    tessedit_pageseg_mode: '7' as Tesseract.PSM,
  })
  readHead(HEAD_AREA.resonatorLevel)
  // read badge digits first; fall back to the full badge and then the name line.
  let resonatorLevelText = resonatorNameText
  if (levelBadge) {
    const plateLeft = levelBadge.x + LEVEL_BADGE_PLATE.pad.x
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: '7' as Tesseract.PSM,
    })
    const digitsRegion = {
      ...levelBadge,
      x: plateLeft + LEVEL_BADGE_DIGITS.from,
      width: LEVEL_BADGE_DIGITS.width,
    }
    // accept a level only when at least two cleanup passes agree uniquely.
    const reads: string[] = []
    for (const [scale, cleanup] of LEVEL_READS) {
      const digits = await extractText(canvas, worker, digitsRegion, scale, cleanup).catch(() => '')
      if (/^\d{1,2}$/.test(digits)) reads.push(digits)
    }
    await worker.setParameters({
      tessedit_char_whitelist: 'LVlv.0123456789/ ',
      tessedit_pageseg_mode: '7' as Tesseract.PSM,
    })
    const votes = [...new Set(reads)]
        .map((digits) => ({ digits, count: reads.filter((read) => read === digits).length }))
        .sort((left, right) => right.count - left.count)
    const [lead, rival] = votes
    if (lead && lead.count >= 2 && (!rival || lead.count > rival.count)) resonatorLevelText = `LV.${lead.digits}`
    else if (reads.length === 0) resonatorLevelText = await safeExtractText(canvas, worker, levelBadge)
    else resonatorLevelText = ''
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
    uidCheckText,
    resonatorNameText,
    resonatorLevelText,
    weaponNameText,
    weaponLevelText,
    skillLevelText,
    attribute,
    activeSequences,
  }

  const resonators = listResSds()
  const weapons = [1, 2, 3, 4, 5].flatMap((weaponType) => listWpnsByTy(weaponType))
  const metadata = resolveBuildScreenshotMetadata(readings, { resonators, weapons })
  onProgress?.({ stage: 'match', done: 0, total: 2 })

  // when the name has no catalog match, search every portrait with a wider margin.
  const candidateIds = metadata.resonator.candidateIds
  const resonatorId = metadata.resonator.id ?? settleResonatorArt(
    await rankResonatorSprites(canvas, candidateIds.length > 0 ? candidateIds : resonators.map((entry) => entry.id)),
    candidateIds.length > 0 ? ART_MARGIN.named : ART_MARGIN.catalog,
    (id) => resonators.find((entry) => entry.id === id)?.attribute ?? null,
    attribute,
  )
  const resonator = resonators.find((entry) => entry.id === resonatorId)
  onProgress?.({ stage: 'match', done: 1, total: 2 })
  thrwIfAbrtd(signal)

  // restrict weapon icon matching to the resonator's weapon type.
  const weaponPool = resonator ? weapons.filter((entry) => entry.weaponType === resonator.weaponType) : weapons
  const weapon = settleWeapon(metadata.weapon, await rnkWeapons(canvas, WEAPON_ICON, weaponPool), weaponPool)
  onProgress?.({ stage: 'match', done: 2, total: 2 })

  return {
    ...metadata,
    resonator: resonator
      ? { ...metadata.resonator, id: resonator.id, name: resonator.name }
      : metadata.resonator,
    weapon,
  }
}

export interface CardDrift {
  dx: number
  dy: number
}

// measure image offset against the qr plate to align fixed card regions.
export function findDrift(canvas: HTMLCanvasElement): CardDrift {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
  const bright = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const index = (y * width + x) * 4
    return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2] > 200
  }
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

// classify unreadable HP, ATK, and DEF labels by first-line pixel width.
function readShortLabel(canvas: HTMLCanvasElement, region: ImageRegion): 'HP' | 'ATK' | 'DEF' | null {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const { width } = region
  const height = SHORT_LABEL.band
  const pixels = context.getImageData(region.x, region.y, width, height).data
  const columnInk = Array.from({ length: width }, (_, x) => {
    let ink = 0
    for (let y = 0; y < height; y += 1) {
      const index = (y * width + x) * 4
      if (0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2] > 110) ink += 1
    }
    return ink
  })
  const first = columnInk.findIndex((ink) => ink >= SHORT_LABEL.minInk)
  if (first < 0) return null
  let last = first
  columnInk.forEach((ink, x) => {
    if (ink >= SHORT_LABEL.minInk) last = x
  })
  const inkWidth = last - first
  if (inkWidth <= SHORT_LABEL.hpMaxWidth) return 'HP'
  if (inkWidth < SHORT_LABEL.minWidth || inkWidth > SHORT_LABEL.maxWidth) return null
  const stem = Math.max(...columnInk.slice(first, first + 3))
  return stem >= SHORT_LABEL.defMinStem ? 'DEF' : 'ATK'
}

// the main value leads with a star a digit reader takes for a 4, so the digits start after the
// leftmost ink run when that run is star wide (18-21 px; a digit spans 11-12)
const MAIN_VALUE_STAR_MIN_WIDTH = 15

function findMainValue(canvas: HTMLCanvasElement, band: ImageRegion): ImageRegion | null {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const pixels = context.getImageData(band.x, band.y, band.width, band.height).data
  const runs: Array<{ from: number; to: number }> = []
  for (let x = 0; x < band.width; x += 1) {
    let lit = false
    for (let y = 0; y < band.height && !lit; y += 1) {
      const index = (y * band.width + x) * 4
      lit = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2] > 110
    }
    if (!lit) continue
    const last = runs[runs.length - 1]
    if (last && last.to === x - 1) last.to = x
    else runs.push({ from: x, to: x })
  }
  const digits = runs[0] && runs[0].to - runs[0].from + 1 >= MAIN_VALUE_STAR_MIN_WIDTH ? runs.slice(1) : runs
  if (digits.length === 0) return null
  const from = Math.max(0, digits[0].from - 3)
  const to = Math.min(band.width - 1, digits[digits.length - 1].to + 3)
  return { x: band.x + from, y: band.y, width: to - from + 1, height: band.height }
}

// compare fixed card pixels at quarter size using the template's alpha mask.
async function scoreFrame(canvas: HTMLCanvasElement): Promise<number> {
  const { width, height } = CARD_FRAME
  const draw = (source: CanvasImageSource) => {
    const surface = document.createElement('canvas')
    surface.width = width
    surface.height = height
    const context = surface.getContext('2d', { willReadFrequently: true })!
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height).data
    surface.width = 0
    return pixels
  }
  const template = draw(await loadImage(CARD_FRAME.src))
  const card = draw(canvas)
  let difference = 0
  let count = 0
  for (let index = 0; index < template.length; index += 4) {
    if (template[index + 3] < 128) continue
    difference += Math.abs(card[index] - template[index])
        + Math.abs(card[index + 1] - template[index + 1])
        + Math.abs(card[index + 2] - template[index + 2])
    count += 1
  }
  return count > 0 ? difference / count / 3 : Infinity
}

// mark text unreadable when more than half the substat labels have no match.
const UNREAD_LABEL_SHARE = 0.5

// use sid -stat brightness to distinguish filled panels from empty background.
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

    // progress callbacks check for cancellation during catalog loading.
    const setCount = Object.keys(setImages).length
    await prldSetMgs(setImages, setCache, (done) => {
      onProgress?.({ stage: 'catalog', done, total: setCount, note: 'Loading the sonata marks' })
      thrwIfAbrtd(signal)
    })

    // keep all set scores for filled panels; glyph errors can change the top match.
    const filled = coords.map((slot) => slotHasEcho(canvas, slot.sideStat))
    const slotSets = coords.map((slot, index) => (
      filled[index] ? rnkSets(canvas, slot.set, setCache) : []
    ))
    const catalogTotal = setCount + Object.keys(echoImages).length

    // load all echo images before combining art and set scores.
    await prldEchoMgs(echoImages, echoCache, (done) => {
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
      ...ocrAssetPaths(),
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
        let mainStatLbl = await extractText(canvas, worker, slot.mainStatLabel, 2)
        // retry an unnamed label on plain grayscale, then threshold, as the substat labels do
        for (const cleanup of ['plain', 'threshold'] as const) {
          if (namesMain(mainStatLbl)) break
          const retry = await extractText(canvas, worker, slot.mainStatLabel, 2, cleanup)
          if (namesMain(retry)) mainStatLbl = retry
          thrwIfAbrtd(signal)
        }

        // a label that still names nothing falls back to the printed value, kept only when
        // two scales read the same number, since one confused digit (30 as 38) names another main
        let mainStatValue: string | undefined
        const valueDigits = namesMain(mainStatLbl) ? null : findMainValue(canvas, slot.mainStatValue)
        if (valueDigits) {
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789.%',
            tessedit_pageseg_mode: '7' as Tesseract.PSM,
          })
          const reads = []
          for (const scale of [3, 4]) {
            reads.push((await extractText(canvas, worker, valueDigits, scale)).match(/\d+(?:\.\d+)?/)?.[0] ?? '')
          }
          if (reads[0] && reads[0] === reads[1]) mainStatValue = reads[0]
          thrwIfAbrtd(signal)
        }

        // infer an unreadable cost from the main stat, then from the matched echo.
        if (!['1', '3', '4'].includes(cost)) cost = String(costForMain(mainStatLbl) ?? '')

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

        // retry unresolved labels on plain grayscale without replacing valid labels.
        for (const cleanup of ['plain', 'threshold'] as const) {
          const unnamed = substats.flatMap((label, row) => (namesSubstat(label) ? [] : [row]))
          for (const row of unnamed) {
            const raw = await extractText(canvas, worker, slot.substats[row], 3, cleanup)
            const label = raw.replace(/\n/g, ' ').replace(/[^\w.%+ ]/g, '').trim()
            if (namesSubstat(label)) substats[row] = label
            thrwIfAbrtd(signal)
          }
        }
        for (const [row, label] of substats.entries()) {
          if (!namesSubstat(label)) substats[row] = readShortLabel(canvas, slot.substats[row]) ?? label
        }

        // a blurred number read with letters allowed comes back as a word ("pURLL"),
        // so the numbers are read on their own
        const substatValues: string[] = slot.substatValues.map(() => '')
        const settled = (row: number, value: string) => readSubstat(substats[row], value)
        for (const pass of VALUE_PASSES) {
          const pending = substatValues.flatMap((value, row) => (
            settled(row, value)?.fix === 'exact' ? [] : [row]
          ))
          if (pending.length === 0) break
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789.%',
            tessedit_pageseg_mode: pass.psm as Tesseract.PSM,
          })
          for (const row of pending) {
            const text = (await extractText(canvas, worker, slot.substatValues[row], pass.scale))
                .replace(/\s+/g, '')
            // replace a value with an exact read or when the previous value is invalid.
            const fresh = settled(row, text)
            if (fresh && (fresh.fix === 'exact' || !settled(row, substatValues[row]))) {
              substatValues[row] = text
            } else if (!/\d/.test(substatValues[row])) {
              substatValues[row] = text
            }
            thrwIfAbrtd(signal)
          }
        }

        // score each echo with a compatible sonata set at the read cost.
        readSlot(index, 7)
        readSlot(index, 8)
        const ranked = pickEchoAndSet(
          rnkEchoFrom(canvas, slot.echoImage, Object.keys(echoImages), echoCache),
          slotSets[index],
          echoCatalog,
          getSetNameTo(),
          cost ? Number(cost) : null,
        )
        // an echo the catalog lacks still ranks a nearest neighbour, so the winner has to
        // agree with the art on its own; an unidentified slot is a gap the user sees
        const pick = ranked && artAgrees(getEchoMgKeys(ranked.echoName)
            .filter((key) => echoCache[key])
            .map((key) => cmprEchoArt(canvas, slot.echoImage, echoCache[key]))) ? ranked : null
        const echoName = pick?.echoName ?? null
        const setName = pick?.setName ?? null
        if (!cost && pick) cost = String(pick.cost)

        results.push({
          cost,
          mainStatLbl: mainStatLbl,
          mainStatValue,
          substats,
          substatValues,
          echoName,
          setName,
        })
      }

      const metadata = await extractBuildMetadata(canvas, worker, options)
      const frameScore = await scoreFrame(canvas).catch(() => Infinity)
      const labels = results.flatMap((echo) => echo.substats)
      const unnamed = labels.filter((label) => !namesSubstat(label)).length
      return {
        ...metadata,
        echoes: results,
        source: {
          width: loadedImg.naturalWidth,
          height: loadedImg.naturalHeight,
          lowResolution: loadedImg.naturalWidth < CARD_WIDTH,
          frameScore,
          botFrame: frameScore <= CARD_FRAME.maxScore,
          unreadText: labels.length > 0 && unnamed / labels.length > UNREAD_LABEL_SHARE,
        },
      }
    } finally {
      await worker.terminate()
      clrCnvsCch(echoCache)
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// preserve the echo-only api while still running the complete screenshot extraction
export async function prsChsFromMg(
    file: File,
    options: ReadOptions = {},
): Promise<RawPrsdEcho[]> {
  return (await prsBldFromMg(file, options)).echoes
}
