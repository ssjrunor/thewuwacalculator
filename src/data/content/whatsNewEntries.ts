/*
  Author: Runor Ewhro
  Description: exports for the What's New surface.
*/

import {
  getWhatsNewEntries,
  type WnEntry,
  type WnLayout,
  type WnSection,
  type WnShot,
} from '@/data/content/changelogEntries'
export type { WnEntry, WnLayout, WnSection, WnShot }

export const whatsNewEntries = getWhatsNewEntries()
