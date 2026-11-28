/*
  Author: Runor Ewhro
  description: parses fixed-layout build screenshots with ocr, pixel tests, and catalog image matching, and exposes
               the echo-only api.
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
import { artAgrees, clearSet, pickByAgreement, pickEchoAndSet } from '@/engine/echoParser/echoPick'
import {
  ATTRIBUTE_REGION,
  BUILD_REGIONS,
  CARD_FRAME,
  UID_ART,
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
  PLAYER_NAME,
  SEQUENCE_CENTERS,
  SEQUENCE_SAMPLE,
  SHORT_LABEL,
  SLOT_AREA_COUNT,
  SLOT_SAMPLE_COUNT,
  WEAPON_CARD_ICON,
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
  settleZhName,
  smallKana,
  trustName,
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
import {
  JA_LABEL_CHARS,
  jaLabel,
  namesMain,
  namesSubstat,
  readSubstat,
  ZH_HANT_LABEL_CHARS,
  zhHantLabel,
} from '@/engine/echoParser/statReading'
import type { AttributeKey } from '@/domain/entities/stats'

export interface RawPrsdEcho {
  cost: string
  mainStatLbl: string
  // the main stat's printed value, read only when its label names no stat
  mainStatValue?: string
  substats: string[]
  // each substat's number, read on its own with a digits-only whitelist
  substatValues?: string[]
  echoName: string | null
  setName: string | null
}

export interface ParsedBuildScreenshot extends ParsedBuildMetadata {
  echoes: RawPrsdEcho[]
  source: {
    // uploaded image dimensions before normalization to the 1920 x 1080 card
    width: number
    height: number
    lowResolution: boolean
    // mean channel distance between fixed card elements and the reference image
    frameScore: number
    // whether the fixed card elements match the reference image
    botFrame: boolean
    // whether at least half the substat labels were unreadable
    unreadText: boolean
  }
}

// retry values without an exact legal roll at several scales and segmentation modes; retain exact reads across
// passes
const VALUE_PASSES = [
  { scale: 2, psm: '7' },
  { scale: 3, psm: '7' },
  { scale: 3, psm: '13' },
] as const

// cache reference images across parses; the set glyphs total a few hundred kilobytes
const echoCache: Record<string, CanvasRenderingContext2D> = {}
const setCache: Record<string, Float32Array> = {}

type OcrModel = 'eng' | 'chi_tra' | 'ell' | 'jpn'

// the leaderboard's reader page reads card after card, so the echo art and one worker per model stay loaded between
// parses (keepReaderWarm); the app reads one card at a time and frees both after each parse
let warm = false
const warmWorkers = new Map<string, Promise<Tesseract.Worker>>()
// the most workers a warm reader reads echo panels on at once, one panel each; a card has five
const SLOT_LANES_MAX = 5

// keep caches and ocr workers between parses (the leaderboard reader page), or free them after each (the app)
export function keepReaderWarm(on: boolean): void {
  warm = on
  if (!on) void dropWarmWorkers()
}

async function dropWarmWorkers(): Promise<void> {
  const workers = [...warmWorkers.values()]
  warmWorkers.clear()
  await Promise.all(workers.map((worker) => worker.then((w) => w.terminate()).catch(() => undefined)))
}

// a worker for a model: a warm one, its settings back to defaults, or a new one. `lane` picks one of a warm
// reader's parallel panel workers
async function takeWorker(model: OcrModel, options: Partial<Tesseract.WorkerOptions> = ocrAssetPaths(),
  lane = 0): Promise<Tesseract.Worker> {
  if (!warm) return Tesseract.createWorker(model, undefined, options)
  const key = `${model}:${lane}`
  let held = warmWorkers.get(key)
  if (!held) {
    held = Tesseract.createWorker(model, undefined, options)
    warmWorkers.set(key, held)
    held.catch(() => warmWorkers.delete(key))
  }
  const worker = await held
  // tesseract.js's own defaults, so a warm worker reads as a new one does
  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' as Tesseract.PSM })
  return worker
}

// a worker done for this parse: a warm reader retains it, the app terminates it
async function giveBack(worker: Tesseract.Worker | null | undefined): Promise<void> {
  if (!worker || warm) return
  await worker.terminate()
}

// a card printed in another language, with the model that reads its stat labels and its name
interface CardScript { lang: 'zh' | 'ja'; worker: Tesseract.Worker }

const SCRIPT_MODEL = { zh: 'chi_tra', ja: 'jpn' } as const
const SCRIPT_LABEL_CHARS = { zh: ZH_HANT_LABEL_CHARS, ja: JA_LABEL_CHARS }
const SCRIPT_LABEL = { zh: zhHantLabel, ja: jaLabel }

interface SlotLane { worker: Tesseract.Worker; script: CardScript | null }

// the workers echo panels are read on: the parse's own, plus on a warm reader one more pair per spare core (each
// tesseract worker is its own thread), up to one per filled panel. a panel sets every parameter it reads with, so
// any lane reads it as the first would
async function slotLanes(first: SlotLane, filled: number): Promise<SlotLane[]> {
  const cores = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency || 1
  const count = warm ? Math.min(SLOT_LANES_MAX, filled, Math.max(1, cores - 1)) : 1
  const more = await Promise.all(Array.from({ length: Math.max(0, count - 1) }, async (_, index) => {
    const lane = index + 1
    const lang = first.script?.lang
    const [worker, scriptWorker] = await Promise.all([takeWorker('eng', ocrAssetPaths(), lane),
      lang ? takeWorker(SCRIPT_MODEL[lang], ocrAssetPaths(), lane) : null])
    // a script lane reads labels as openCardScript leaves its worker
    await scriptWorker?.setParameters({
      tessedit_pageseg_mode: '7' as Tesseract.PSM,
      tessedit_char_whitelist: SCRIPT_LABEL_CHARS[lang!],
    })
    return { worker, script: lang && scriptWorker ? { lang, worker: scriptWorker } : null }
  }))
  return [first, ...more]
}

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

// the worker, core and language data are served from the app's own origin
// (staged by tools/data/stageOcrAssets.mjs); the worker runs from a blob, so the paths are absolute
function ocrAssetPaths(): Pick<Tesseract.WorkerOptions, 'workerPath' | 'corePath' | 'langPath'> {
  const base = new URL('/assets/app/ocr/', window.location.origin).href
  return { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.replace(/\/$/, '') }
}

// the head lines (resonator, weapon, uid) print letters, digits and a little punctuation
const HEAD_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.'_-:/ "
// player names also carry decorations, so "~" is allowed (without it, "~Marmalade~" reads as "Marmalade-")
const PLAYER_NAME_CHARS = `${HEAD_CHARS}~`

type TextCleanup = 'contrast' | 'threshold' | 'plain' | 'gold' | 'invert' | 'invertBinary'

// the player lines use one gold; over the bench cards' "UID:" labels its lit pixels fall at hue 11-55 and saturation
// 0.10-0.47, a range portrait art behind the lines (rebecca's gun: cyan, blue, pink, white) almost never reaches
const GOLD_INK = { minHue: 8, maxHue: 75, minSat: 0.08, minValue: 0.45 } as const

function isGoldInk(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b) / 255
  if (max < GOLD_INK.minValue) return false
  const chroma = max - Math.min(r, g, b) / 255
  if (chroma / max < GOLD_INK.minSat) return false
  const hue = hueOf(r, g, b)
  return hue >= GOLD_INK.minHue && hue <= GOLD_INK.maxHue
}

// where the player name's gold ink ends, and whether portrait art is behind its letters; no cleanup separates a
// letter from art of nearly the same colour, so such a name is left unread
function nameSpan(canvas: HTMLCanvasElement, x: number = PLAYER_NAME.x): { right: number; inked: boolean; obscured: boolean } {
  const { maxX, y, height } = PLAYER_NAME
  const width = maxX - x
  const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, width, height).data
  const at = (col: number, row: number) => (row * width + col) * 4
  let end = 0
  let gap = 0
  let inked = false
  for (let col = 0; col < width; col += 1) {
    let ink = 0
    for (let row = 0; row < height; row += 1) {
      const i = at(col, row)
      if (isGoldInk(pixels[i], pixels[i + 1], pixels[i + 2])) ink += 1
    }
    if (ink >= 2) {
      end = col
      gap = 0
      inked = true
    } else if ((gap += 1) >= PLAYER_NAME.endGap) {
      break
    }
  }
  let art = 0
  for (let col = 0; col <= end; col += 1) {
    for (let row = 0; row < height; row += 1) {
      const i = at(col, row)
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      if (Math.max(r, g, b) > PLAYER_NAME.artMinBright && !isGoldInk(r, g, b)) art += 1
    }
  }
  return { right: x + end, inked, obscured: art / ((end + 1) * height) > PLAYER_NAME.maxArtShare }
}

// read a cropped region with contrast, threshold, plain grayscale or gold-ink cleanup: threshold for dark text on a
// light badge, plain grayscale for dim cards, and gold for only the player lines' ink, which reads art behind the
// uid as blank paper
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
  if (cleanup !== 'contrast' && cleanup !== 'plain') ctx.imageSmoothingQuality = 'high'
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
  // invert stretches the crop to full range and turns it dark on light, the way the chinese model reads best
  let low = 255
  let high = 0
  const inverted = cleanup === 'invert' || cleanup === 'invertBinary'
  if (inverted) for (const value of gray) [low, high] = [Math.min(low, value), Math.max(high, value)]
  for (let i = 0; i < d.length; i += 4) {
    const value = gray[i / 4]
    const stretched = inverted ? 255 - Math.round(((value - low) / Math.max(1, high - low)) * 255) : 0
    const v = cleanup === 'invert'
      ? stretched
      : cleanup === 'invertBinary'
      ? (stretched < 128 ? 0 : 255)
      : cleanup === 'gold'
      ? (isGoldInk(d[i], d[i + 1], d[i + 2]) ? 0 : 255)
      : cleanup === 'threshold'
      ? (value > threshold ? 255 : 0)
      : cleanup === 'plain' ? value : Math.max(0, Math.min(255, (value - 128) * 1.5 + 128))
    d[i] = d[i + 1] = d[i + 2] = v
  }

  ctx.putImageData(imgData, 0, 0)

  let image = tmp
  if (cleanup === 'threshold' || cleanup === 'gold' || inverted) {
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

// each full-width character cell's gold ink height along a name, from its first ink; empty when the ink does not
// span that many cells, as a name with latin letters does not
function cellHeights(canvas: HTMLCanvasElement, from: number, end: number, count: number): number[] {
  const { y, height, cellPitch, cellLead } = PLAYER_NAME
  const width = end - from
  if (width <= 0 || count === 0) return []
  const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(from, y, width, height).data
  const top = new Array<number>(width).fill(height)
  const bottom = new Array<number>(width).fill(-1)
  for (let col = 0; col < width; col += 1) {
    for (let row = 0; row < height; row += 1) {
      const i = (row * width + col) * 4
      if (!isGoldInk(pixels[i], pixels[i + 1], pixels[i + 2])) continue
      top[col] = Math.min(top[col], row)
      bottom[col] = row
    }
  }
  const inked = bottom.flatMap((value, col) => (value >= 0 ? [col] : []))
  if (inked.length === 0) return []
  const start = inked[0] - cellLead
  if (Math.round((inked[inked.length - 1] - start + cellLead) / cellPitch) !== count) return []
  return Array.from({ length: count }, (_, cell) => {
    let high: number = height
    let low = -1
    for (let col = Math.max(0, Math.round(start + cell * cellPitch)); col < Math.min(width, Math.round(start + (cell + 1) * cellPitch)); col += 1) {
      high = Math.min(high, top[col])
      low = Math.max(low, bottom[col])
    }
    return low >= high ? low - high + 1 : 0
  })
}

// whether a region contains any text: three columns with bright ink. an unleveled echo prints fewer substats, and a
// blank row read dark on light stretches the panel's grain into digits ("2", "0", ".")
function hasInk(canvas: HTMLCanvasElement, region: ImageRegion): boolean {
  const pixels = canvas.getContext('2d', { willReadFrequently: true })!
      .getImageData(region.x, region.y, region.width, region.height).data
  let columns = 0
  for (let x = 0; x < region.width; x += 1) {
    let ink = 0
    for (let y = 0; y < region.height; y += 1) {
      const i = (y * region.width + x) * 4
      if (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2] > 110) ink += 1
    }
    if (ink >= 2 && (columns += 1) >= 3) return true
  }
  return false
}

// widest gap inside one label at card scale; characters sit 2-4px apart and an english word space is about 8
const LABEL_GAP = 16

function inkColumns(canvas: HTMLCanvasElement, region: ImageRegion): ImageRegion {
  const pixels = canvas.getContext('2d', { willReadFrequently: true })!
      .getImageData(region.x, region.y, region.width, region.height).data
  let first = -1
  let last = -1
  for (let x = 0; x < region.width; x += 1) {
    let ink = 0
    for (let y = 0; y < region.height; y += 1) {
      const i = (y * region.width + x) * 4
      if (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2] > 110) ink += 1
    }
    if (ink < 2) continue
    // past a gap wider than any between a label's characters, the ink is the next row's tops showing through the
    // crop's bottom edge ("共鳴技能" under "暴擊"); left in, those specks stretch a two character label to five times its
    // width and the model reads half of it
    if (last >= 0 && x - last > LABEL_GAP) break
    if (first < 0) first = x
    last = x
  }
  if (first < 0) return region
  const x = Math.max(0, first - 3)
  return { ...region, x: region.x + x, width: Math.min(region.width - x, last - first + 7) }
}

// a traditional chinese card prints "特徵碼" where an english one prints "UID"; a japanese card prints "UID" too, and
// "プレイヤーネーム" where an english one prints "Player ID". each model loads only once its label reads, so an
// english card fetches neither
const ZH_HANT_UID_LABEL = /特徵|徵碼/
const JA_NAME_LABEL = /プレイヤ|ネーム/
const EN_NAME_LABEL = /P\s*[l1I|]\s*a\s*y|y\s*e\s*r|I\s*D\s*$/i
// "Player ID:" ends by x 104 on every english card; "プレイヤーネーム:" runs to x 168
const NAME_LABEL = { x: 18, y: 88, width: 150, height: 25, enWidth: 86 } as const

async function openCardScript(canvas: HTMLCanvasElement, worker: Tesseract.Worker): Promise<CardScript | null> {
  if (/U\s*[I1l|]\s*D/i.test(await safeExtractText(canvas, worker, BUILD_REGIONS.uid))) {
    const label = { x: NAME_LABEL.x, y: NAME_LABEL.y, width: NAME_LABEL.enWidth, height: NAME_LABEL.height }
    if (EN_NAME_LABEL.test(await safeExtractText(canvas, worker, label))) return null
    return openScript(canvas, 'ja', NAME_LABEL, JA_NAME_LABEL)
  }
  return openScript(canvas, 'zh', BUILD_REGIONS.uid, ZH_HANT_UID_LABEL)
}

async function openScript(canvas: HTMLCanvasElement, lang: CardScript['lang'], region: ImageRegion,
  label: RegExp): Promise<CardScript | null> {
  const worker = await takeWorker(SCRIPT_MODEL[lang])
  await worker.setParameters({ tessedit_pageseg_mode: '7' as Tesseract.PSM })
  const read = (await extractText(canvas, worker, region, 3).catch(() => '')).replace(/\s+/g, '')
  if (!label.test(read)) {
    await giveBack(worker)
    return null
  }
  await worker.setParameters({ tessedit_char_whitelist: SCRIPT_LABEL_CHARS[lang] })
  return { lang, worker }
}

// greek letters with no latin twin: a greek read holding none is latin read as greek ("sito" as "οἶῖο")
const GREEK_OWN = /[ΓΔΘΛΞΠΣΦΨΩαβγδεζηθλμξπςσφψω]/

// a name the greek model reads as greek, or ''. the model is fetched only for a name the others disagree on
async function readGreekName(canvas: HTMLCanvasElement, region: ImageRegion): Promise<string> {
  const greek = await takeWorker('ell')
  try {
    await greek.setParameters({ tessedit_pageseg_mode: '7' as Tesseract.PSM })
    const text = (await extractText(canvas, greek, region, 2, 'invert').catch(() => '')).replace(/\s+/g, '')
    return GREEK_OWN.test(text) ? text : ''
  } finally {
    await giveBack(greek)
  }
}

// a name read on one model at each scale, dark on light: on the card's own label worker when it is that model,
// which returns to its label whitelist after. the japanese model alone reads kana ("シャルロット")
async function readNameOn(model: 'chi_tra' | 'jpn', script: CardScript, canvas: HTMLCanvasElement, region: ImageRegion,
  scales: number[]): Promise<string[]> {
  const own = SCRIPT_MODEL[script.lang] === model
  const reader = own ? script.worker : await takeWorker(model)
  try {
    await reader.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' as Tesseract.PSM })
    const reads: string[] = []
    for (const scale of scales) reads.push(await extractText(canvas, reader, region, scale, 'invert').catch(() => ''))
    return reads
  } finally {
    if (own) await reader.setParameters({ tessedit_char_whitelist: SCRIPT_LABEL_CHARS[script.lang] })
    else await giveBack(reader)
  }
}

// the uid on a card whose portrait crosses the digits (UID_ART), read with that art subtracted. it returns a uid
// only when three reads agree, across both cuts and two scales; every bench read that kept the art also lost a
// digit, so a uid that comes back whole three times is accepted. null when none agree
async function readUidOverArt(canvas: HTMLCanvasElement, worker: Tesseract.Worker, resonatorId: string,
  zh: boolean): Promise<string | null> {
  const art = UID_ART.art
  const template = document.createElement('canvas')
  template.width = art.width
  template.height = art.height
  const templateContext = template.getContext('2d', { willReadFrequently: true })!
  templateContext.drawImage(await loadImage(UID_ART.src(resonatorId)), 0, 0)
  const background = templateContext.getImageData(0, 0, art.width, art.height).data

  const left = zh ? UID_ART.digitsFrom.zh : UID_ART.digitsFrom.en
  const width = art.x + art.width - left
  const own = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(left, art.y, width, art.height).data
  // ink as a cut sees it: gold left of the art, and right of it a pixel far enough from the art behind it, with the
  // art's own bright pixels taken as ink where a digit's ink sits on both sides of them
  const inkAt = (cut: number): Uint8Array => {
    const ink = new Uint8Array(width * art.height)
    const bright = new Uint8Array(width * art.height)
    for (let row = 0; row < art.height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const i = row * width + col
        const [r, g, b] = [own[i * 4], own[i * 4 + 1], own[i * 4 + 2]]
        const artCol = left + col - art.x
        if (artCol < 0) {
          ink[i] = isGoldInk(r, g, b) ? 1 : 0
          continue
        }
        const t = (row * art.width + artCol) * 4
        ink[i] = Math.hypot(r - background[t], g - background[t + 1], b - background[t + 2]) > cut ? 1 : 0
        bright[i] = Math.max(background[t], background[t + 1], background[t + 2]) >= UID_ART.brightArt ? 1 : 0
      }
    }
    const bridged = ink.slice()
    for (let i = 0; i < ink.length; i += 1) {
      if (ink[i] || !bright[i]) continue
      const col = i % width
      let before = false
      let after = false
      for (let step = 1; step <= UID_ART.bridge; step += 1) {
        if (col - step >= 0 && ink[i - step]) before = true
        if (col + step < width && ink[i + step]) after = true
      }
      if (before && after) bridged[i] = 1
    }
    return bridged
  }

  const read = async (ink: Uint8Array, scale: number): Promise<string> => {
    const mask = document.createElement('canvas')
    mask.width = width
    mask.height = art.height
    const maskContext = mask.getContext('2d')!
    const image = maskContext.createImageData(width, art.height)
    for (let i = 0; i < ink.length; i += 1) {
      const v = ink[i] ? 0 : 255
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v
      image.data[i * 4 + 3] = 255
    }
    maskContext.putImageData(image, 0, 0)
    const margin = 12
    const framed = document.createElement('canvas')
    framed.width = width * scale + margin * 2
    framed.height = art.height * scale + margin * 2
    const framedContext = framed.getContext('2d')!
    framedContext.fillStyle = '#fff'
    framedContext.fillRect(0, 0, framed.width, framed.height)
    framedContext.imageSmoothingQuality = 'high'
    framedContext.drawImage(mask, margin, margin, width * scale, art.height * scale)
    const { data: { text } } = await worker.recognize(framed.toDataURL())
    return text.replace(/\s+/g, '')
  }

  await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' as Tesseract.PSM })
  const [light, heavy] = UID_ART.cuts.map(inkAt)
  const reads = [await read(light, 4), await read(heavy, 3), await read(heavy, 4)]
  return reads.every((text) => /^\d{9}$/.test(text) && text === reads[0]) ? reads[0] : null
}

// passes for traditional chinese labels; the first read that names a label is kept. on the five chinese bench
// cards a lone word at 4x read every full-size row, and the rest a line at 4x or a word at 5x. the black and white
// passes read a two character label ("攻擊") that the stretched gray read as nothing on three cards, and a smaller last
// row ("暴擊") whole only as a line at 3x
const ZH_HANT_PASSES = [
  { psm: '8', scale: 4, cleanup: 'invert' },
  { psm: '7', scale: 4, cleanup: 'invert' },
  { psm: '8', scale: 5, cleanup: 'invert' },
  { psm: '7', scale: 3, cleanup: 'invert' },
  { psm: '8', scale: 4, cleanup: 'invertBinary' },
  { psm: '7', scale: 3, cleanup: 'invertBinary' },
  { psm: '8', scale: 5, cleanup: 'invertBinary' },
] as const

// the english label a chinese or japanese stat label names, so the rest of the reader runs unchanged; '' when none
// does
async function readScriptLabel(script: CardScript, canvas: HTMLCanvasElement, region: ImageRegion,
  substat = false): Promise<string> {
  const label = inkColumns(canvas, region)
  for (const pass of ZH_HANT_PASSES) {
    await script.worker.setParameters({ tessedit_pageseg_mode: pass.psm as Tesseract.PSM })
    const read = await extractText(canvas, script.worker, label, pass.scale, pass.cleanup).catch(() => '')
    const named = SCRIPT_LABEL[script.lang](read, substat)
    if (named) return named
  }
  return ''
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

// median icon hues measured on native and resized reference cards, within 2 degrees
const ATTRIBUTE_HUES: Array<[AttributeKey, number]> = [
  ['spectro', 46],
  ['aero', 158],
  ['glacio', 200],
  ['electro', 280],
  ['havoc', 322],
  ['fusion', 349],
]

// reject hues more than 12 degrees from every reference icon
const ATTRIBUTE_HUE_REACH = 12

function detectAttribute(canvas: HTMLCanvasElement): AttributeKey | null {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const pixels = context.getImageData(
    ATTRIBUTE_REGION.x,
    ATTRIBUTE_REGION.y,
    ATTRIBUTE_REGION.width,
    ATTRIBUTE_REGION.height,
  ).data

  // sample saturated icon pixels; the header and antialiased edges shift the hue
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

// find the dark level text through its gold plate; the search windows stay clear of the name's bright glyphs,
// which read as false levels. the returned box uses the band's own coordinates
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

  // the glyphs cut the plate into pieces, so near columns are joined
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

// locate the badge plate with crop padding
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

// compare the upper half of catalog portraits at a nominal width of 500 pixels; search nearby offsets because card
// placement varies by resonator
const SPRITE_PLACE = { x: 140, y: 2, widths: [492, 497, 502, 507], reach: 6, step: 2 }
const SPRITE_UPPER = 0.5
const SPRITE_BOUNDS = { width: 760, height: 640 }

// sparse opaque samples of a resonator's portrait at each placement width, cached per sprite across parses (drawing
// about 60 sprites at each width costs a chinese card's match a second)
const spriteSampleCache = new Map<string, Promise<number[][] | null>>()

function spriteSamples(sprite: string): Promise<number[][] | null> {
  let held = spriteSampleCache.get(sprite)
  if (held) return held
  held = loadImage(sprite).then((image) => SPRITE_PLACE.widths.map((width) => {
    const scale = width / image.naturalWidth
    const height = Math.round(image.naturalHeight * scale * SPRITE_UPPER)
    const reference = document.createElement('canvas')
    reference.width = width
    reference.height = height
    const context = reference.getContext('2d', { willReadFrequently: true })!
    context.drawImage(image, 0, 0, width, height / SPRITE_UPPER)
    const pixels = context.getImageData(0, 0, width, height).data
    reference.width = 0
    const samples: number[] = []
    for (let y = 0; y < height; y += 6) {
      for (let x = 0; x < width; x += 6) {
        const index = (y * width + x) * 4
        if (pixels[index + 3] > 245 && Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 40) {
          samples.push(x, y, pixels[index], pixels[index + 1], pixels[index + 2])
        }
      }
    }
    return samples
  }), () => {
    // a sprite that failed to load is retried next parse
    spriteSampleCache.delete(sprite)
    return null
  })
  spriteSampleCache.set(sprite, held)
  return held
}

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
    const scales = await spriteSamples(resonator.sprite!)
    if (!scales) return { id: resonator.id, score: Infinity }
    let best = Infinity
    for (const samples of scales) {
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
    script: CardScript | null = null,
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
    tessedit_char_whitelist: HEAD_CHARS,
    tessedit_pageseg_mode: '7' as Tesseract.PSM,
  })
  // use the badge position to set the name region width
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
  // stop the read just past the name's last letter, which reads a long name whole and excludes the portrait beyond a
  // short one; a name with art behind it reads as empty, and the leaderboard uses its stored name
  const nameFrom = script?.lang === 'ja' ? PLAYER_NAME.jaX : PLAYER_NAME.x
  const name = nameSpan(canvas, nameFrom)
  const idRegion = BUILD_REGIONS.playerId
  await worker.setParameters({ tessedit_char_whitelist: PLAYER_NAME_CHARS })
  const nameEnd = Math.min(PLAYER_NAME.maxX, name.right + PLAYER_NAME.tail)
  let nameConfirmed = true
  let playerIdText = name.obscured || script
    ? ''
    : await safeExtractText(canvas, worker, { ...idRegion, width: Math.max(idRegion.width, nameEnd - idRegion.x) })
  // a chinese or japanese card's name is voted on by three models that err differently (settleZhName): english,
  // chinese and japanese, each dark on light, with the greek model asked when the latin reads share little ("Λæα")
  if (script && !name.obscured && name.inked) {
    const own = { x: nameFrom, y: PLAYER_NAME.y, width: nameEnd - nameFrom, height: PLAYER_NAME.height }
    const english = [
      await safeExtractText(canvas, worker, own),
      await extractText(canvas, worker, own, 2, 'invert').catch(() => ''),
      await extractText(canvas, worker, own, 3, 'invert').catch(() => ''),
    ]
    const [chinese2, chinese3] = await readNameOn('chi_tra', script, canvas, own, [2, 3]).catch(() => ['', ''])
    const [japanese] = await readNameOn('jpn', script, canvas, own, [2]).catch(() => [''])
    const verdict = settleZhName({ english, chinese: [chinese2 ?? '', chinese3 ?? ''], japanese: japanese ?? '' })
    const greek = verdict.askGreek ? await readGreekName(canvas, own).catch(() => '') : ''
    playerIdText = greek || smallKana(verdict.name, cellHeights(canvas, nameFrom, nameEnd, [...verdict.name].length))
    // only a latin name the english model and another read alike is taken as read; staff check the rest on the card
    nameConfirmed = verdict.confirmed
  }
  await worker.setParameters({ tessedit_char_whitelist: HEAD_CHARS })
  thrwIfAbrtd(signal)
  readHead(HEAD_AREA.weaponName)
  const weaponNameText = await safeExtractText(canvas, worker, BUILD_REGIONS.weaponName)
  thrwIfAbrtd(signal)
  // the colon belongs to this pass, so the uid is read before the level whitelist
  readHead(HEAD_AREA.uid)
  const uidText = await safeExtractText(canvas, worker, BUILD_REGIONS.uid)
  thrwIfAbrtd(signal)
  // verify the uid with a larger digits-only read before assigning a player
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '7' as Tesseract.PSM,
  })
  // gold ink only, so a portrait behind the line never reads as digits in both reads
  const uidCheckText = await extractText(canvas, worker, BUILD_REGIONS.uid, 2, 'gold').catch(() => '')
  thrwIfAbrtd(signal)

  await worker.setParameters({
    tessedit_char_whitelist: 'LVlv.0123456789/ ',
    tessedit_pageseg_mode: '7' as Tesseract.PSM,
  })
  readHead(HEAD_AREA.resonatorLevel)
  // read badge digits first; fall back to the full badge and then the name line
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
    // accept a level only when at least two cleanup passes agree uniquely
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
    playerNameInk: !name.inked ? 'none' : name.obscured ? 'obscured' : 'clear',
    ...(nameConfirmed ? {} : { playerNameUnconfirmed: true }),
  }

  const resonators = listResSds()
  const weapons = [1, 2, 3, 4, 5].flatMap((weaponType) => listWpnsByTy(weaponType))
  const metadata = resolveBuildScreenshotMetadata(readings, { resonators, weapons })
  onProgress?.({ stage: 'match', done: 0, total: 2 })

  // when the name has no catalog match, search every portrait with a wider margin
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

  // restrict weapon icon matching to the resonator's weapon type
  const weaponPool = resonator ? weapons.filter((entry) => entry.weaponType === resonator.weaponType) : weapons
  // three standard weapons are matched against the card's own drawing of them (WEAPON_CARD_ICON)
  const drawn = weaponPool.map((entry) => (
    (WEAPON_CARD_ICON.ids as readonly string[]).includes(entry.id) ? { ...entry, icon: WEAPON_CARD_ICON.src(entry.id) } : entry
  ))
  const weapon = settleWeapon(metadata.weapon, await rnkWeapons(canvas, WEAPON_ICON, drawn), weaponPool)
  onProgress?.({ stage: 'match', done: 2, total: 2 })

  // a portrait that crosses the uid's digits (UID_ART) is subtracted for one more read when the two reads disagree
  let player = metadata.player
  if (!player.uidAgreed && resonator && UID_ART.resonators.includes(resonator.id)) {
    const uid = await readUidOverArt(canvas, worker, resonator.id, script?.lang === 'zh').catch(() => null)
    if (uid) player = { ...player, uid, uidAgreed: true }
    thrwIfAbrtd(signal)
  }

  return {
    ...metadata,
    player,
    // art selected among the name line's candidates (rover's variants) or, with none, from the whole catalog
    resonator: resonator
      ? { ...metadata.resonator, id: resonator.id, name: resonator.name,
          ...(!metadata.resonator.id && candidateIds.length === 0 ? { byArt: true } : {}) }
      : metadata.resonator,
    weapon,
  }
}

export interface CardDrift {
  dx: number
  dy: number
}

// measure image offset against the qr plate to align fixed card regions
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

// classify unreadable HP, ATK, and DEF labels by first-line pixel width
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

// compare fixed card pixels at quarter size using the template's alpha mask
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

// mark text unreadable when more than half the substat labels have no match
const UNREAD_LABEL_SHARE = 0.5

// use side-stat brightness to tell filled panels from empty background
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

// parse the complete build card and leave application decisions to callers
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

    // progress callbacks check for cancellation during catalog loading
    const setCount = Object.keys(setImages).length
    await prldSetMgs(setImages, setCache, (done) => {
      onProgress?.({ stage: 'catalog', done, total: setCount, note: 'Loading the sonata marks' })
      thrwIfAbrtd(signal)
    })

    // keep all set scores for filled panels; glyph errors can change the top match
    const filled = coords.map((slot) => slotHasEcho(canvas, slot.sideStat))
    const slotSets = coords.map((slot, index) => (
      filled[index] ? rnkSets(canvas, slot.set, setCache) : []
    ))
    const catalogTotal = setCount + Object.keys(echoImages).length

    // load all echo images before combining art and set scores
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
    const worker = await takeWorker('eng', {
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
    const script = await openCardScript(canvas, worker)
    thrwIfAbrtd(signal)

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

      // one echo panel, read on one lane's workers
      const readEchoSlot = async (index: number, worker: Tesseract.Worker, script: CardScript | null): Promise<RawPrsdEcho> => {
        const slot = coords[index]
        thrwIfAbrtd(signal)

        if (!filled[index]) {
          for (let part = 0; part < SLOT_AREA_COUNT; part += 1) readSlot(index, part)
          return { cost: '', mainStatLbl: '', substats: [], substatValues: [], echoName: null, setName: null }
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
        let mainStatLbl = script
          ? await readScriptLabel(script, canvas, slot.mainStatLabel)
          : await extractText(canvas, worker, slot.mainStatLabel, 2)
        // retry an unnamed label on plain grayscale, then threshold, as the substat labels do
        for (const cleanup of ['plain', 'threshold'] as const) {
          if (script || namesMain(mainStatLbl)) break
          const retry = await extractText(canvas, worker, slot.mainStatLabel, 2, cleanup)
          if (namesMain(retry)) mainStatLbl = retry
          thrwIfAbrtd(signal)
        }

        // a label that still names nothing uses the printed value, kept only when two scales read the same number,
        // because one confused digit (30 as 38) names another main stat
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

        // infer an unreadable cost from the main stat, then from the matched echo
        if (!['1', '3', '4'].includes(cost)) cost = String(costForMain(mainStatLbl) ?? '')

        // substat labels wrap onto a second line, so they are read as a block
        await worker.setParameters({
          tessedit_char_whitelist: whitelist,
          tessedit_pageseg_mode: '6' as Tesseract.PSM,
        })

        // a chinese or japanese row with no ink in its value is not printed (an unleveled echo), and is not read
        const blank = slot.substatValues.map((region) => script !== null && !hasInk(canvas, region))
        const substats: string[] = []
        for (const [subIndex, sub] of slot.substats.entries()) {
          readSlot(index, 2 + subIndex)
          if (script) {
            substats.push(blank[subIndex] ? '' : await readScriptLabel(script, canvas, sub, true))
          } else {
            const raw = await extractText(canvas, worker, sub, 3)
            substats.push(raw.replace(/\n/g, ' ').replace(/[^\w.%+ ]/g, '').trim())
          }
          thrwIfAbrtd(signal)
        }

        // retry unresolved labels on plain grayscale without replacing valid labels; the chinese reader runs its own
        // retries
        for (const cleanup of script ? [] : ['plain', 'threshold'] as const) {
          const unnamed = substats.flatMap((label, row) => (namesSubstat(label) ? [] : [row]))
          for (const row of unnamed) {
            const raw = await extractText(canvas, worker, slot.substats[row], 3, cleanup)
            const label = raw.replace(/\n/g, ' ').replace(/[^\w.%+ ]/g, '').trim()
            if (namesSubstat(label)) substats[row] = label
            thrwIfAbrtd(signal)
          }
        }
        for (const [row, label] of substats.entries()) {
          if (!script && !namesSubstat(label)) substats[row] = readShortLabel(canvas, slot.substats[row]) ?? label
        }

        // a blurred number read with letters allowed comes back as a word ("pURLL"),
        // so the numbers are read on their own
        const substatValues: string[] = slot.substatValues.map(() => '')
        const settled = (row: number, value: string) => readSubstat(substats[row], value)
        for (const pass of VALUE_PASSES) {
          const pending = substatValues.flatMap((value, row) => (
            blank[row] || settled(row, value)?.fix === 'exact' ? [] : [row]
          ))
          if (pending.length === 0) break
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789.%',
            tessedit_pageseg_mode: pass.psm as Tesseract.PSM,
          })
          for (const row of pending) {
            // a chinese card's larger digits read their "%" as "9%" on the contrast cleanup ("7.99%"); dark on light
            // reads them
            const text = (await extractText(canvas, worker, slot.substatValues[row], pass.scale, script ? 'invert' : 'contrast'))
                .replace(/\s+/g, '')
            // replace a value with an exact read or when the previous value is invalid
            const fresh = settled(row, text)
            if (fresh && (fresh.fix === 'exact' || !settled(row, substatValues[row]))) {
              substatValues[row] = text
            } else if (!/\d/.test(substatValues[row])) {
              substatValues[row] = text
            }
            thrwIfAbrtd(signal)
          }
        }

        // score each echo with a compatible sonata set at the read cost
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
        const agreement = (name: string) => getEchoMgKeys(name)
            .filter((key) => echoCache[key])
            .map((key) => cmprEchoArt(canvas, slot.echoImage, echoCache[key]))
        const glyphSet = clearSet(slotSets[index])
        const glyphSetId = glyphSet ? getSetNameTo()[glyphSet] : undefined
        // the ranking caps how much a wrong set costs, so strong art for an echo that cannot
        // wear the glyph's clear set (a held-out fleurdelys reads as leviathan) still wins it
        let pick = ranked && artAgrees(agreement(ranked.echoName)) && (!glyphSet || ranked.setName === glyphSet)
          ? ranked
          : null
        if (!pick && glyphSet && glyphSetId !== undefined) {
          pick = pickByAgreement(
            echoCatalog
                .filter((echo) => echo.sets.includes(glyphSetId) && (!cost || echo.cost === Number(cost)))
                .map((echo) => ({ echo, forms: agreement(echo.name) })),
            glyphSet,
          )
        }
        const echoName = pick?.echoName ?? null
        const setName = pick?.setName ?? null
        if (!cost && pick) cost = String(pick.cost)

        return {
          cost,
          mainStatLbl: mainStatLbl,
          mainStatValue,
          substats,
          substatValues,
          echoName,
          setName,
        }
      }

      // panels go to whichever lane is free; each result is stored at its panel's index
      const lanes = await slotLanes({ worker, script }, filled.filter(Boolean).length)
      const results: RawPrsdEcho[] = new Array(coords.length)
      let next = 0
      await Promise.all(lanes.map(async (lane) => {
        while (next < coords.length) {
          const index = next
          next += 1
          results[index] = await readEchoSlot(index, lane.worker, lane.script)
        }
      }))

      const metadata = await extractBuildMetadata(canvas, worker, options, script)
      const frameScore = await scoreFrame(canvas).catch(() => Infinity)
      const labels = results.flatMap((echo) => echo.substats)
      const unnamed = labels.filter((label) => !namesSubstat(label)).length
      const lowResolution = loadedImg.naturalWidth < CARD_WIDTH
      return {
        ...metadata,
        player: { ...metadata.player, id: trustName(metadata.player.id, lowResolution) },
        echoes: results,
        source: {
          width: loadedImg.naturalWidth,
          height: loadedImg.naturalHeight,
          lowResolution,
          frameScore,
          botFrame: frameScore <= CARD_FRAME.maxScore,
          unreadText: labels.length > 0 && unnamed / labels.length > UNREAD_LABEL_SHARE,
        },
      }
    } catch (error) {
      // a worker left mid-read may be in any state, so a warm reader starts the next card on new workers
      if (warm) await dropWarmWorkers()
      throw error
    } finally {
      await giveBack(worker)
      await giveBack(script?.worker)
      if (!warm) clrCnvsCch(echoCache)
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// the echo-only api, running the complete screenshot extraction
export async function prsChsFromMg(
    file: File,
    options: ReadOptions = {},
): Promise<RawPrsdEcho[]> {
  return (await prsBldFromMg(file, options)).echoes
}
