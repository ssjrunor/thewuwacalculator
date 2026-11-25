/*
  Author: Runor Ewhro
  description: upload image size limits by purpose. the app scales an image to
               `fit` (its longest side, whole and uncropped, since every surface
               crops with object-fit) and saves it as webp before upload, and
               the service enforces `side` and `bytes` on every stored image.
*/

import type { MediaPurpose } from './api'

export interface MediaLimit {
  /** the longest side the app scales an image down to before upload. */
  fit: number
  /** the longest side the service stores. */
  side: number
  /** the most bytes the service stores. */
  bytes: number
}

export const MEDIA_LIMITS: Readonly<Record<MediaPurpose, MediaLimit>> = {
  // shown at most 72 css px square, so 1024 leaves room for any crop at 3x.
  avatar: { fit: 1024, side: 2048, bytes: 2 << 20 },
  // behind the whole profile band (73rem wide, as tall as its content), the hover card and the row namecards.
  banner: { fit: 3200, side: 4096, bytes: 6 << 20 },
  // a showcase card's portrait or backdrop, on a 992x720 card.
  card: { fit: 2400, side: 4096, bytes: 4 << 20 },
}

/** the most bytes, in whole megabytes, for messages. */
export const megabytes = (purpose: MediaPurpose): number => MEDIA_LIMITS[purpose].bytes >> 20
