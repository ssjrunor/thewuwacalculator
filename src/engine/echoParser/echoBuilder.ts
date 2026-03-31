/*
  Author: Runor Ewhro
  Description: Builds echo instances from parsed OCR results and normalizes
               legacy label and number mismatches into valid echo stat data.
*/

import { listEchoes } from '@/domain/services/echoCatalogService'
import {
  ECHO_PRIMARY_STATS,
  ECHO_SECONDARY_STATS,
  ECHO_SUBSTAT_KEYS,
  snapToNearestSubstatValue,
} from '@/data/gameData/catalog/echoStats'
import { createEchoUid } from '@/domain/entities/runtime'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getSetNameToId } from '@/engine/echoParser/imageMap'
import type { RawParsedEcho } from '@/engine/echoParser/ocrParsing'

const labelToKey: Record<string, string> = {
  'Crit. Rate': 'critRate',
  'Crit. DMG': 'critDmg',
  'Crit. MG': 'critDmg',
  'ATK': 'atk',
  'LULS': 'atk',
  'ATK EX': 'atk',
  'HP': 'hp',
  'B ATK': 'atk',
  'HESS': 'hp',
  'AK': 'atk',
  '1': 'hp',
  'def': 'def',
  'Energy Regen': 'energyRegen',
  'Basic Attack DMG Bonus': 'basicAtk',
  'Basic': 'basicAtk',
  'Basic Attack': 'basicAtk',
  'Basic Attack DMG': 'basicAtk',
  'Heavy Attack DMG Bonus': 'heavyAtk',
  'Heavy': 'heavyAtk',
  'Heavy Attack': 'heavyAtk',
  'Heavy Attack DMG': 'heavyAtk',
  'Resonance Skill DMG Bonus': 'resonanceSkill',
  'Resonance Skill': 'resonanceSkill',
  'Resonance Skill DMG': 'resonanceSkill',
  'Resonance Liberation DMG Bonus': 'resonanceLiberation',
  'Resonance Liberation': 'resonanceLiberation',
  'Resonance Liberation DMG': 'resonanceLiberation',
  'Glacio DMG Bonus': 'glacio',
  'Fusion DMG Bonus': 'fusion',
  'Spectro DMG Bonus': 'spectro',
  'Electro DMG Bonus': 'electro',
  'Havoc DMG Bonus': 'havoc',
  'Aero DMG Bonus': 'aero',
  'Healing Bonus': 'healingBonus',
}

// correct common OCR numeric misreads
const correctionMap: Record<string, string> = {
  '1.9': '7.9',
  '1.8': '7.8',
  '1.7': '7.7',
  '1.6': '7.6',
  '1.5': '7.5',
  '1.4': '7.4',
  '1.3': '7.3',
  '1.2': '7.2',
  '1.1': '7.1',
  '1.0': '7.0',
  EX: '9.4',
}

// fix a known OCR number mismatch
function fixOCRNumber(str: string): string {
  return correctionMap[str] ?? str
}

// normalize a stat label for fuzzy matching
function normalizeLabel(label: string): string {
  return label
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/%/g, '')
      .replace(/bonus/g, '')
      .replace(/\s+/g, '')
}

// normalized entries for primary key resolution
const keyEntries = Object.entries(labelToKey).map(([label, key]) => ({
  normalized: normalizeLabel(label),
  key,
}))

// normalized entries for substat parsing
const subKeyEntries = Object.entries(labelToKey).map(([label, key]) => ({
  label: label.toLowerCase().replace(/\./g, '').replace(/\s+/g, ''),
  key,
}))

// parse OCR substat strings into normalized substat values
function parseSubstats(substats: string[]): Record<string, number> {
  const result: Record<string, number> = {}

  for (const raw of substats) {
    // bare number > 100 with no label is treated as flat hp
    const bareNum = parseFloat(raw.trim())
    if (!isNaN(bareNum) && /^\d+(\.\d+)?$/.test(raw.trim()) && bareNum > 100) {
      result.hpFlat = snapToNearestSubstatValue('hpFlat', bareNum)
      continue
    }

    const match = raw.match(/^([\w\s.]+?)\s+([\d.]+)\s*%?/)
    if (!match) continue

    const rawLabel = match[1]
    const rawValue = fixOCRNumber(match[2].trim())
    const value = parseFloat(rawValue)
    const hasPercent = raw.includes('%')
    if (isNaN(value)) continue

    // bare numeric label > 100 is also treated as flat hp
    const labelNum = parseFloat(rawLabel.trim())
    if (!isNaN(labelNum) && /^\d+(\.\d+)?$/.test(rawLabel.trim()) && labelNum > 100) {
      result.hpFlat = labelNum
      continue
    }

    const cleanedLabel = rawLabel
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/bonus/g, '')
        .replace(/\s+/g, '')

    let matchKey: string | null = null
    for (const { label, key } of subKeyEntries) {
      if (cleanedLabel.includes(label)) {
        matchKey = key
        break
      }
    }
    if (!matchKey) continue

    if (['atk', 'hp', 'def'].includes(matchKey)) {
      matchKey = hasPercent ? `${matchKey}Percent` : `${matchKey}Flat`
    } else if (matchKey === 'luls') {
      matchKey = hasPercent ? 'atkPercent' : 'atkFlat'
    } else if (['1', 'hess'].includes(matchKey)) {
      matchKey = hasPercent ? 'hpPercent' : 'hpFlat'
    }

    // element dmg and healing bonus are not valid substats
    if (!(ECHO_SUBSTAT_KEYS as readonly string[]).includes(matchKey)) continue

    result[matchKey] = snapToNearestSubstatValue(matchKey, value)
  }

  return result
}

// resolve the primary main stat key from OCR label text
function resolvePrimaryKey(rawLabel: string, cost: number): string | null {
  const normalized = normalizeLabel(rawLabel)

  let matchKey = keyEntries.find((entry) => normalized === entry.normalized)?.key ?? null
  if (!matchKey) {
    matchKey = keyEntries.find((entry) => normalized.includes(entry.normalized))?.key ?? null
  }
  if (!matchKey) return null

  if (['atk', 'hp', 'def'].includes(matchKey)) {
    matchKey = `${matchKey}Percent`
  }

  const primaryStats = ECHO_PRIMARY_STATS[cost]
  if (!primaryStats || !(matchKey in primaryStats)) return null
  return matchKey
}

// build echo instances from parsed OCR results
export function buildEchoInstancesFromParsed(raw: RawParsedEcho[]): Array<EchoInstance | null> {
  const echoCatalog = listEchoes()

  return raw.map((item, index) => {
    const cost = Number.isFinite(Number(item.cost)) ? Number(item.cost) : 4
    const echoDef = item.echoName ? echoCatalog.find((echo) => echo.name === item.echoName) : null
    if (!echoDef) return null

    const primaryKey = resolvePrimaryKey(item.mainStatLabel ?? '', cost)
    const primaryStats = ECHO_PRIMARY_STATS[cost]
    const secondaryStat = ECHO_SECONDARY_STATS[cost]
    if (!primaryKey || !primaryStats || !secondaryStat) return null

    const primaryValue = primaryStats[primaryKey]
    if (primaryValue === undefined) return null

    const parsedSetId = item.setName ? getSetNameToId()[item.setName] : null
    const validSets = echoDef.sets
    const selectedSet =
        parsedSetId != null && validSets.includes(parsedSetId)
            ? parsedSetId
            : (validSets[0] ?? 0)

    return {
      uid: createEchoUid(),
      id: echoDef.id,
      set: selectedSet,
      mainEcho: index === 0,
      mainStats: {
        primary: { key: primaryKey, value: primaryValue },
        secondary: { key: secondaryStat.key, value: secondaryStat.value },
      },
      substats: parseSubstats(item.substats),
    }
  })
}