/*
  Author: Runor Ewhro
  Description: Reads OCR'd echo stat lines against the game's own stat names
               and legal rolls. A label is matched by edit distance, and the
               number has to be a roll that stat can have, so each half checks
               the other instead of a table of remembered misreads.
*/

import {
  ECHO_MAIN_STATS,
  SUBSTAT_KEYS,
  getSbstStepP,
  snapToNrstSb,
} from '@/data/gameData/catalog/echoStats'
import { editDistance } from '@/engine/echoParser/editDistance'

// what the card prints for each stat
const STAT_LABELS: Record<string, string> = {
  atk: 'ATK',
  hp: 'HP',
  def: 'DEF',
  critRate: 'Crit. Rate',
  critDmg: 'Crit. DMG',
  energyRegen: 'Energy Regen',
  healingBonus: 'Healing Bonus',
  basicAtk: 'Basic Attack DMG Bonus',
  heavyAtk: 'Heavy Attack DMG Bonus',
  resonanceSkill: 'Resonance Skill DMG Bonus',
  resonanceLiberation: 'Resonance Liberation DMG Bonus',
  aero: 'Aero DMG Bonus',
  glacio: 'Glacio DMG Bonus',
  electro: 'Electro DMG Bonus',
  fusion: 'Fusion DMG Bonus',
  havoc: 'Havoc DMG Bonus',
  spectro: 'Spectro DMG Bonus',
}

// the three stats that come as a flat and a percent share one printed name
function familyOf(key: string): string {
  return key.replace(/(Flat|Percent)$/, '')
}

export function normLetters(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

// a wrapped label can lose its second line, so "Resonance Skill DMG" still counts
function labelForms(label: string): string[] {
  const full = normLetters(label)
  const forms = [full]
  if (full.endsWith('dmgbonus')) forms.push(full.slice(0, -'bonus'.length), full.slice(0, -'dmgbonus'.length))
  return forms
}

// short names leave little room: "AK" is ATK, but "HP" must never become "DEF"
function formTolerance(form: string): number {
  return form.length <= 3 ? 1 : Math.max(1, Math.floor(form.length * 0.25))
}

// the closest form, judged by that form's own length, so "aero" is not held to a
// budget sized for "aerodmgbonus"
function labelDistance(observed: string, label: string): number {
  const fits = labelForms(label)
      .map((form) => ({ distance: editDistance(observed, form), tolerance: formTolerance(form) }))
      .filter((entry) => entry.distance <= entry.tolerance)
  return fits.length > 0 ? Math.min(...fits.map((entry) => entry.distance)) : Infinity
}

interface LabelMatch {
  key: string
  distance: number
}

// every candidate within tolerance, closest first
function matchLabels(observed: string, keys: string[]): LabelMatch[] {
  if (!observed) return []
  return keys
      .map((key) => {
        const label = STAT_LABELS[familyOf(key)]
        return { key, label, distance: label ? labelDistance(observed, label) : Infinity }
      })
      .filter((entry) => Number.isFinite(entry.distance))
      .sort((left, right) => left.distance - right.distance)
      .map(({ key, distance }) => ({ key, distance }))
}

// ------------------------------------------------------------------ main stat

export function resolveMainKey(rawLabel: string, cost: number): string | null {
  const keys = Object.keys(ECHO_MAIN_STATS[cost] ?? {})
  return matchLabels(normLetters(rawLabel), keys)[0]?.key ?? null
}

// the one cost whose main stats hold this label, for a cost digit that did not read
export function costForMain(rawLabel: string): number | null {
  const observed = normLetters(rawLabel)
  const costs = Object.keys(ECHO_MAIN_STATS).map(Number)
  const best = costs
      .map((cost) => ({ cost, match: matchLabels(observed, Object.keys(ECHO_MAIN_STATS[cost]))[0] }))
      .filter((entry) => entry.match)
  if (best.length === 0) return null
  const closest = Math.min(...best.map((entry) => entry.match!.distance))
  const winners = best.filter((entry) => entry.match!.distance === closest)
  return winners.length === 1 ? winners[0].cost : null
}

// ------------------------------------------------------------------ substats

// digits the reader mixes up on this font, each way round
const DIGIT_CONFUSIONS: Record<string, string[]> = {
  '0': ['8'],
  '1': ['7'],
  '3': ['8'],
  '5': ['6'],
  '6': ['8', '5'],
  '7': ['1'],
  '8': ['6', '3', '9', '0'],
  '9': ['8'],
}

function isLegal(key: string, value: number): boolean {
  return getSbstStepP(key).some((step) => Math.abs(step - value) < 1e-6)
}

// every reading one slip away: a confused digit, or a dropped decimal point
function valueVariants(text: string): number[] {
  const variants = new Set<string>([text])
  for (let index = 0; index < text.length; index += 1) {
    for (const swap of DIGIT_CONFUSIONS[text[index]] ?? []) {
      variants.add(text.slice(0, index) + swap + text.slice(index + 1))
    }
  }
  if (!text.includes('.') && text.length >= 2) {
    variants.add(`${text.slice(0, -1)}.${text.slice(-1)}`)
  }
  return [...variants].map(Number).filter((value) => Number.isFinite(value))
}

export type SubstatFix = 'exact' | 'corrected' | 'snapped'

export interface SubstatReading {
  key: string
  value: number
  /** how the number was settled: read as printed, one slip corrected, or snapped */
  fix: SubstatFix
}

// settle a number against one stat's rolls; a value no slip explains is snapped
function settleValue(key: string, text: string): { value: number; fix: SubstatFix } {
  const raw = Number(text)
  if (isLegal(key, raw)) return { value: raw, fix: 'exact' }
  const legal = [...new Set(valueVariants(text).filter((value) => isLegal(key, value)))]
  if (legal.length === 1) return { value: legal[0], fix: 'corrected' }
  return { value: snapToNrstSb(key, raw), fix: 'snapped' }
}

const FIX_COST: Record<SubstatFix, number> = { exact: 0, corrected: 0.5, snapped: 2 }

// the flat and percent keys each printed name can stand for
function keysForFamily(family: string): string[] {
  const split = SUBSTAT_KEYS.filter((key) => key === `${family}Flat` || key === `${family}Percent`)
  return split.length > 0 ? split : SUBSTAT_KEYS.filter((key) => key === family)
}

// a stray digit of noise is short, so the longest number in the text is the value
function longestNumber(text: string): RegExpExecArray | null {
  const numbers = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(%?)/g)]
  return numbers.reduce<RegExpExecArray | null>(
    (best, match) => (!best || match[1].length >= best[1].length ? match : best),
    null,
  )
}

// the label half and, when it was read apart, the number half of one row
export function readSubstat(row: string, value = ''): SubstatReading | null {
  const own = longestNumber(value)
  const number = own ?? longestNumber(row)
  if (!number) return null

  const valueText = number[1].replace(',', '.')
  const hasPercent = number[2] === '%'
  const observed = own
    ? normLetters(row)
    : normLetters(row.slice(0, number.index) + ' ' + row.slice(number.index! + number[0].length))

  const families = [...new Set(SUBSTAT_KEYS.map(familyOf))]
  const labelled = matchLabels(observed, families.flatMap(keysForFamily))

  // an unreadable label is still a stat when only one stat can roll this number
  const candidates = labelled.length > 0
    ? labelled
    : SUBSTAT_KEYS
        .filter((key) => isLegal(key, Number(valueText)))
        .map((key) => ({ key, distance: 0 }))
  if (labelled.length === 0 && candidates.length !== 1) return null

  const scored = candidates.map(({ key, distance }) => {
    const settled = settleValue(key, valueText)
    // the % sign only breaks ties; the roll tables are the stronger witness
    const signCost = key.endsWith('Flat') === hasPercent ? 0.25 : 0
    return { key, ...settled, score: distance + FIX_COST[settled.fix] + signCost }
  })
  scored.sort((left, right) => left.score - right.score)
  const best = scored[0]
  return { key: best.key, value: best.value, fix: best.fix }
}

// one echo never rolls the same stat twice, so a repeat keeps its better reading
export function readSubstats(rows: string[], values: string[] = []): Record<string, number> {
  const rank: Record<SubstatFix, number> = { exact: 0, corrected: 1, snapped: 2 }
  const kept = new Map<string, SubstatReading>()
  for (const [index, row] of rows.entries()) {
    const reading = readSubstat(row, values[index])
    if (!reading) continue
    const held = kept.get(reading.key)
    if (!held || rank[reading.fix] < rank[held.fix]) kept.set(reading.key, reading)
  }
  return Object.fromEntries([...kept].map(([key, reading]) => [key, reading.value]))
}
