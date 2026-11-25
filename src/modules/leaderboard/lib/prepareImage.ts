/*
  Author: Runor Ewhro
  description: prepares a picked image for upload. it is drawn whole (uncropped,
               since every surface crops it differently) at most `fit` on its
               longest side, rotated upright from its camera orientation, and
               saved as webp, which strips all non-pixel data (including a phone
               photo's location). quality steps down only while the result
               exceeds the purpose's byte cap.
*/

import type { MediaPurpose } from '@/domain/leaderboard/api'
import { MEDIA_LIMITS, megabytes } from '@/domain/leaderboard/media'

/** the largest picked file the app will try to read; it is made small before it is sent. */
export const PICK_MAX_BYTES = 40 << 20
/** file picker types: any format the browser can draw, since uploads are always re-encoded. */
export const PICK_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

const QUALITIES = [0.88, 0.8, 0.7, 0.6]

/** why an image could not be readied, said for the person. */
export class PrepareError extends Error {
  override name = 'PrepareError'
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

/** the image, scaled to fit and re-encoded, ready to upload; a PrepareError says why when it cannot be. */
export async function prepareImage(file: File, purpose: MediaPurpose): Promise<Blob> {
  const limit = MEDIA_LIMITS[purpose]
  if (file.size > PICK_MAX_BYTES) throw new PrepareError(`woah... pick an image no larger than ${PICK_MAX_BYTES >> 20} MB :P`)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PrepareError("hmm... this browser can't read that image. try a PNG, JPEG or WebP file :P")
  }
  try {
    const scale = Math.min(1, limit.fit / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new PrepareError("oopsies... this browser couldn't prepare the image. try another browser?")
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of QUALITIES) {
      // browsers without webp encoding return png, and jpeg is the smaller fallback then
      let blob = await encode(canvas, 'image/webp', quality)
      if (blob && blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', quality)
      if (blob && blob.size <= limit.bytes) return blob
    }
    throw new PrepareError(`hmm... even after shrinking it, this image is over ${megabytes(purpose)} MB. try a smaller image or one with less detail :P`)
  } finally {
    bitmap.close()
  }
}
