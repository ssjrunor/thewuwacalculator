/*
  Author: Runor Ewhro
  description: packs a build's stats (BuildStats) into 13 float64s: exact,
               ~104 B against ~220 B of json, and read without a parse. NaN
               marks an omitted stat (critGrade on stats scored before it
               existed). the key order defines the format and is append only.
*/

import type { BuildStats } from '@lb/contract/api'

const KEYS = Object.freeze(['atk', 'hp', 'def', 'energyRegen', 'critRate', 'critDmg', 'attributeBonus', 'basicAttack', 'heavyAttack',
  'resonanceSkill', 'resonanceLiberation', 'critValue', 'critGrade'] as const)
const OPTIONAL = new Set<string>(['critGrade'])

export function packStats(stats: BuildStats): Uint8Array {
  const bytes = new Uint8Array(KEYS.length * 8)
  const view = new DataView(bytes.buffer)
  KEYS.forEach((key, index) => {
    const value = stats[key]
    if (value === undefined && !OPTIONAL.has(key)) throw new Error(`statsPack: ${key} is missing`)
    view.setFloat64(index * 8, value ?? Number.NaN, true)
  })
  return bytes
}

export function unpackStats(bytes: Uint8Array): BuildStats {
  if (bytes.byteLength !== KEYS.length * 8) throw new Error('statsPack: wrong size')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const stats: Record<string, number> = {}
  KEYS.forEach((key, index) => {
    const value = view.getFloat64(index * 8, true)
    if (!Number.isNaN(value)) stats[key] = value
  })
  return stats as unknown as BuildStats
}
