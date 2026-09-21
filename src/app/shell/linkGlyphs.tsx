/*
  Author: Runor Ewhro
  Description: Defines the external-service glyphs used by application navigation links.
*/

import { SiDiscord, SiKofi } from 'react-icons/si'
import type { ComponentType } from 'react'

const GLYPHS: Record<string, ComponentType<{ 'aria-hidden'?: boolean }>> = {
  Discord: SiDiscord,
  'Ko-fi': SiKofi,
}

export function LinkGlyph({ name }: { name: string }) {
  const Glyph = GLYPHS[name]
  return Glyph ? <Glyph aria-hidden={true} /> : null
}
