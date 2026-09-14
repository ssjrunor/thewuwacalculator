/*
  Author: Runor Ewhro
  Description: Owns game assets behavior and state transitions for the lib module.
*/

import type { CSSProperties } from 'react'

const RES_SKILL_ROOT = '/assets/game/resonators/skills'

/** how many resonance chain nodes the game gives a resonator */
export const SEQ_NODES = 6

/*
  the skill nodes `npm run ingest:node-icons` writes. these are the game's own
  white glyphs, so they are painted as masks rather than drawn: an <img> of one
  disappears against a light theme, and a mask takes the surface's own colour.
*/
export const RES_NODE_KEYS = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'inherent1',
  'inherent2',
  'tuneBreak',
] as const

export type ResNodeKey = (typeof RES_NODE_KEYS)[number]

/** the glyph for one of a resonator's skills */
export function resNodeIcon(resonatorId: string, node: ResNodeKey): string {
  return `${RES_SKILL_ROOT}/${resonatorId}/nodes/${node}.webp`
}

/** the glyph for one resonance chain node, counted from 1 */
export function resSeqIcon(resonatorId: string, node: number): string {
  return `${RES_SKILL_ROOT}/${resonatorId}/sequence/${node}.webp`
}

/** all six chain glyphs in the order the game hangs them */
export function resSeqIcons(resonatorId: string): string[] {
  return Array.from({ length: SEQ_NODES }, (_, index) => resSeqIcon(resonatorId, index + 1))
}

/*
  the inherent skills are stated in unlock order, and the art is named for that
  order rather than for the level, which moves between resonators.
*/
export function resInherentIcon(resonatorId: string, order: number): string | null {
  const node = RES_NODE_KEYS.find((key) => key === `inherent${order + 1}`)
  return node ? resNodeIcon(resonatorId, node) : null
}

/*
  masks take a quoted url or they break on paths the browser reads as a keyword,
  so the custom property is written here rather than at each call site.
*/
export function glyphVars(url: string | null, property = '--glyph'): CSSProperties | undefined {
  return url ? ({ [property]: `url("${url}")` } as CSSProperties) : undefined
}
