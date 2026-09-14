/*
  Author: Runor Ewhro
  Description: Parses fixed-layout build screenshots with OCR, pixel tests,
               and catalog image matching while preserving the Echo-only API.
*/

import Tesseract from 'tesseract.js'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { listResSds } from '@/domain/services/resonatorSeedService'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'
import { getEchoMgMap, getSetNameMg, getSetNameTo } from '@/engine/echoParser/imageMap'
import {
  ATTRIBUTE_REGION,
  BUILD_REGIONS,
  CARD_HEIGHT,
  CARD_WIDTH,
  HEAD_AREA,
  HEAD_AREA_BASE,
  HEAD_SAMPLE_COUNT,
  RESONATOR_LEVEL_REGIONS,
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
import type { AttributeKey } from '@/domain/entities/stats'
import type { EchoDef } from '@/domain/entities/catalog'

export interface RawPrsdEcho {
  cost: string
  mainStatLbl: string
  substats: string[]
  echoName: string | null
  setName: string | null
}

export interface ParsedBuildScreenshot extends ParsedBuildMetadata {
  echoes: RawPrsdEcho[]
}

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

// extract OCR text from an image region after grayscale and contrast cleanup
async function extractText(
    canvas: HTMLCanvasElement,
    worker: Tesseract.Worker,
    region: ImageRegion,
    scale = 1,
): Promise<string> {
  const tmp = document.createElement('canvas')
  tmp.width = region.width * scale
  tmp.height = region.height * scale
  const ctx = tmp.getContext('2d', { willReadFrequently: true })!
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

  for (let i = 0; i < d.length; i += 4) {
    const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    d[i] = d[i + 1] = d[i + 2] = gray
  }

  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, (d[i] - 128) * 1.5 + 128))
    d[i] = d[i + 1] = d[i + 2] = v
  }

  ctx.putImageData(imgData, 0, 0)

  const {
    data: { text },
  } = await worker.recognize(tmp.toDataURL())

  return text.trim()
}

async function safeExtractText(
    canvas: HTMLCanvasElement,
    worker: Tesseract.Worker,
    region: ImageRegion,
): Promise<string> {
  try {
    return await extractText(canvas, worker, region, 2)
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
  readHead(HEAD_AREA.resonatorName)
  const resonatorNameText = await safeExtractText(canvas, worker, BUILD_REGIONS.resonatorName)
  thrwIfAbrtd(signal)
  readHead(HEAD_AREA.playerId)
  const playerIdText = await safeExtractText(canvas, worker, BUILD_REGIONS.playerId)
  thrwIfAbrtd(signal)
  readHead(HEAD_AREA.weaponName)
  const weaponNameText = await safeExtractText(canvas, worker, BUILD_REGIONS.weaponName)
  thrwIfAbrtd(signal)

  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./ ',
    tessedit_pageseg_mode: '7' as Tesseract.PSM,
  })
  const resonatorLevelReadings: string[] = []
  for (const region of RESONATOR_LEVEL_REGIONS) {
    readHead(HEAD_AREA.resonatorLevel)
    resonatorLevelReadings.push(await safeExtractText(canvas, worker, region))
    thrwIfAbrtd(signal)
  }
  const resonatorLevelText = resonatorLevelReadings.join(' ')
  readHead(HEAD_AREA.uid)
  const uidText = await safeExtractText(canvas, worker, BUILD_REGIONS.uid)
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

// the sonata marks say which echoes a card can hold, so only those icons load
function pickSetEchoMgs(
    echoImages: Record<string, string>,
    catalog: EchoDef[],
    slotSets: Array<string | null>,
): Record<string, string> {
  if (slotSets.some((setName) => setName === null)) return echoImages

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

    if (loadedImg.naturalWidth !== CARD_WIDTH || loadedImg.naturalHeight !== CARD_HEIGHT) {
      throw new Error('invalid_image_size')
    }

    const canvas = document.createElement('canvas')
    canvas.width = CARD_WIDTH
    canvas.height = CARD_HEIGHT
    canvas.getContext('2d')!.drawImage(loadedImg, 0, 0)

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

    // match the sonata marks before loading any echo art
    const slotSets = coords.map((slot) => mtchSetFrst(canvas, slot.set, setCache))
    const wantedEchoMgs = pickSetEchoMgs(echoImages, echoCatalog, slotSets)
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

        // read cost
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: '7' as Tesseract.PSM,
        })

        readSlot(index, 0)
        let cost = await extractText(canvas, worker, slot.cost)
        cost = cost.replace(/[^0-9]/g, '')
        if (!['1', '3', '4'].includes(cost)) cost = '4'

        // read main stat desc and substats
        await worker.setParameters({
          tessedit_char_whitelist: whitelist,
          tessedit_pageseg_mode: '6' as Tesseract.PSM,
        })

        readSlot(index, 1)
        const mainStatLbl = await extractText(canvas, worker, slot.mainStatLabel)

        const substats: string[] = []
        for (const [subIndex, sub] of slot.substats.entries()) {
          readSlot(index, 2 + subIndex)
          const raw = await extractText(canvas, worker, sub)
          substats.push(raw.replace(/\n/g, ' ').replace(/[^\w.%+ ]/g, '').trim())
          thrwIfAbrtd(signal)
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
