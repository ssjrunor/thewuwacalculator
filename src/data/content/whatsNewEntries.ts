/*
  Author: Runor Ewhro
  Description: exports for the What's New surface.
*/

import {
  getWhatsNewEntries,
  type WnEntry,
  type WnGridSpan,
  type WnLayout,
  type WnSection,
  type WnShot,
} from '@/data/content/changelogEntries'
export type { WnEntry, WnGridSpan, WnLayout, WnSection, WnShot }

export const whatsNewEntries = getWhatsNewEntries()
