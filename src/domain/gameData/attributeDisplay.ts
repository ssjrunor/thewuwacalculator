/*
  Author: Runor Ewhro
  Description: shared display metadata for attribute-facing UI accents.
*/

import type { AttributeKey } from '@/domain/entities/stats'

export const ATTR_COLORS: Record<AttributeKey, string> = {
  aero: '#51ffb3',
  glacio: '#40aefa',
  spectro: '#f8e56c',
  fusion: '#f0734d',
  electro: '#b46aff',
  havoc: '#e649a6',
  physical: '#8c8c8c',
}

export function getAttributeIconSrc(attribute: string | null | undefined): string | null {
  return attribute ? `/assets/attributes/attributes alt/${attribute}.webp` : null
}
