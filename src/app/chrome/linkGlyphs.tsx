/*
  Author: Runor Ewhro
  Description: The marks the two outbound links wear on the line. They are the
               services' own, because a link that leaves the app is recognised
               by its logo long before it is read, and there is no word beside
               them to correct a guess.
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
