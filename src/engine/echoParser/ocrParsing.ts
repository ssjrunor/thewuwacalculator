/*
  Author: Runor Ewhro
  Description: Parses echo screenshots by combining OCR text extraction
               with icon matching for echo and set recognition.
*/

import Tesseract from 'tesseract.js'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { getEchoImageMap, getSetNameImageMap, getSetNameToId } from '@/engine/echoParser/imageMap'
import {
  preloadEchoImages,
  preloadSetImages,
  matchSetFirst,
  matchEchoFromFiltered,
} from '@/engine/echoParser/imageMatching'
import type { ImageRegion } from '@/engine/echoParser/imageMatching'

export interface RawParsedEcho {
  cost: string
  mainStatLabel: string
  substats: string[]
  echoName: string | null
  setName: string | null
}

// module-level caches so reference images are only loaded once
const echoCache: Record<string, CanvasRenderingContext2D> = {}
const setCache: Record<string, CanvasRenderingContext2D> = {}

// screenshot coordinates for the 5 echo slots
const SPACING = 374

function getCoords() {
  return Array.from({ length: 5 }, (_, i) => {
    const o = i * SPACING
    return {
      cost: { x: 336 + o, y: 674, width: 18, height: 24 } as ImageRegion,
      mainStatLabel: { x: 215 + o, y: 720, width: 173, height: 40 } as ImageRegion,
      substats: [
        { x: 64 + o, y: 880, width: 320, height: 38 },
        { x: 64 + o, y: 918, width: 320, height: 38 },
        { x: 64 + o, y: 950, width: 320, height: 38 },
        { x: 64 + o, y: 984, width: 320, height: 38 },
        { x: 64 + o, y: 1019, width: 320, height: 38 },
      ] as ImageRegion[],
      echoImage: { x: 22 + o, y: 650, width: 192, height: 182 } as ImageRegion,
      set: { x: 264 + o, y: 660, width: 56, height: 56 } as ImageRegion,
    }
  })
}

function clearCanvasCache(cache: Record<string, CanvasRenderingContext2D>): void {
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
): Promise<string> {
  const tmp = document.createElement('canvas')
  tmp.width = region.width
  tmp.height = region.height
  const ctx = tmp.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)

  const imgData = ctx.getImageData(0, 0, region.width, region.height)
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

// parse all five echoes from a screenshot
export async function parseEchoesFromImage(file: File): Promise<RawParsedEcho[]> {
  const img = new Image()
  const objectUrl = URL.createObjectURL(file)

  try {
    const loadedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = objectUrl
    })

    if (loadedImg.naturalWidth !== 1920 || loadedImg.naturalHeight !== 1080) {
      throw new Error('invalid_image_size')
    }

    const canvas = document.createElement('canvas')
    canvas.width = 1920
    canvas.height = 1080
    canvas.getContext('2d')!.drawImage(loadedImg, 0, 0)

    await preloadEchoImages(getEchoImageMap(), echoCache)
    await preloadSetImages(getSetNameImageMap(), setCache)

    const echoCatalog = listEchoes()

    const worker = await Tesseract.createWorker('eng')
    const whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.%+ '

    await worker.setParameters({
      tessedit_char_whitelist: whitelist,
      tessedit_pageseg_mode: '7' as Tesseract.PSM,
    })

    const coords = getCoords()
    const results: RawParsedEcho[] = []

    try {
      for (let index = 0; index < coords.length; index += 1) {
        const slot = coords[index]

        // read cost
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: '7' as Tesseract.PSM,
        })

        let cost = await extractText(canvas, worker, slot.cost)
        cost = cost.replace(/[^0-9]/g, '')
        if (!['1', '3', '4'].includes(cost)) cost = '4'

        // read main stat label and substats
        await worker.setParameters({
          tessedit_char_whitelist: whitelist,
          tessedit_pageseg_mode: '6' as Tesseract.PSM,
        })

        const mainStatLabel = await extractText(canvas, worker, slot.mainStatLabel)

        const substats: string[] = []
        for (const sub of slot.substats) {
          const raw = await extractText(canvas, worker, sub)
          substats.push(raw.replace(/\n/g, ' ').replace(/[^\w.%+ ]/g, '').trim())
        }

        // match set first
        const setName = matchSetFirst(canvas, slot.set, setCache)

        // filter echo candidates by set and cost
        let filteredNames: string[] = []
        if (setName !== null) {
          const setId = getSetNameToId()[setName]
          filteredNames = echoCatalog
              .filter((echo) => echo.sets.includes(setId) && String(echo.cost) === cost)
              .map((echo) => echo.name)

          // if cost filtering removes everything, fall back to set-only filtering
          if (filteredNames.length === 0) {
            filteredNames = echoCatalog
                .filter((echo) => echo.sets.includes(setId))
                .map((echo) => echo.name)
          }
        }

        // if set match failed, search across all echoes
        if (filteredNames.length === 0) {
          filteredNames = Object.keys(getEchoImageMap())
        }

        // match echo icon from remaining candidates
        const echoName = matchEchoFromFiltered(canvas, slot.echoImage, filteredNames, echoCache)

        results.push({
          cost,
          mainStatLabel,
          substats,
          echoName,
          setName,
        })
      }

      return results
    } finally {
      await worker.terminate()
      clearCanvasCache(echoCache)
      clearCanvasCache(setCache)
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
