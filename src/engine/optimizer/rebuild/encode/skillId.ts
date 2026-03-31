/*
  Author: Runor Ewhro
  Description: encodes skill type, element, and a stable hashed identifier
               into compact integers used by the optimizer/runtime pipeline.
*/

import type { AttributeKey, SkillTypeKey } from '@/domain/entities/stats'

// bit layout for the lower 15 bits of the encoded skill id
const SKILLTYPE_FLAG_MAP: Record<string, number> = {
  basicAtk: 1 << 0,
  heavyAtk: 1 << 1,
  resonanceSkill: 1 << 2,
  resonanceLiberation: 1 << 3,
  outroSkill: 1 << 4,
  introSkill: 1 << 5,
  echoSkill: 1 << 6,
  coord: 1 << 7,
  aeroErosion: 1 << 8,
  spectroFrazzle: 1 << 9,
  tuneRupture: 1 << 10,
  electroFlare: 1 << 11,
  fusionBurst: 1 << 12,
}

// compact 3-bit element id map used inside the encoded skill id
const ELEMENT_ID_MAP: Record<string, number> = {
  aero: 0,
  glacio: 1,
  fusion: 2,
  spectro: 3,
  havoc: 4,
  electro: 5,
  physical: 6,
  none: 7,
}

// normalize text before hashing or map lookup so formatting differences
// like spaces or capitalization do not change the encoded result
function normalizeSkillPart(part: string | null | undefined): string {
  return (part ?? '').toString().trim().toLowerCase()
}

// convert one or more skill types into a packed bitmask
// result is clamped to 15 bits because the upper bits are reserved
export function encodeSkillTypeMask(skillType: SkillTypeKey | SkillTypeKey[]): number {
  const list = Array.isArray(skillType) ? skillType : [skillType]
  let mask = 0

  for (const type of list) {
    const flag = SKILLTYPE_FLAG_MAP[type]
    if (flag) {
      mask |= flag
    }
  }

  return mask & 0x7fff
}

// convert an element string into its compact numeric id
export function encodeElementId(element: AttributeKey | 'physical' | 'none'): number {
  const normalized = normalizeSkillPart(element)
  const id = ELEMENT_ID_MAP[normalized]
  return (id & 0x7)
}

// build the full encoded skill id with this layout:
// bits  0..14  -> skill type mask
// bits 15..17  -> element id
// bits 18..31  -> 14-bit hash of "tab|label"
//
// the hash makes skills with the same mask/element but different names land
// in different ids without needing to store the full strings at runtime.
export function encodeSkillId(options: {
  label: string
  skillType: SkillTypeKey[]
  tab: string
  element: AttributeKey | 'physical'
}): number {
  const mask = encodeSkillTypeMask(options.skillType)
  const elementId = encodeElementId(options.element)

  // normalize the identifying text so the hash is stable
  const key = `${normalizeSkillPart(options.tab)}|${normalizeSkillPart(options.label)}`

  // djb2-style hash
  let hash = 5381
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(index)) >>> 0
  }

  // keep only 14 bits for the hash portion
  const hash14 = hash & 0x3fff

  // combine into one packed unsigned 32-bit integer
  return (((hash14 << 18) >>> 0) | (elementId << 15) | mask) >>> 0
}