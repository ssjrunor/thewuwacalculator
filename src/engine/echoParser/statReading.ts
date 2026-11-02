/*
  Author: Runor Ewhro
  description: resolves echo stat labels and values using printed names,
               edit distance, and legal roll tables.
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

// flat and percent variants of a stat share one printed label.
function familyOf(key: string): string {
  return key.replace(/(Flat|Percent)$/, '')
}

export function normLetters(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

// match truncated forms of labels that can wrap onto a second line.
function labelForms(label: string): string[] {
  const full = normLetters(label)
  const forms = [full]
  if (full.endsWith('dmgbonus')) forms.push(full.slice(0, -'bonus'.length), full.slice(0, -'dmgbonus'.length))
  return forms
}

// short labels permit one edit; loose matching requires an exact legal value.
function formTolerance(form: string, loose = false): number {
  if (form.length <= 3) return 1
  return Math.max(1, Math.floor(form.length * (loose ? 0.45 : 0.25)))
}

// ocr can merge "ri" into "n" and "rn" into "m"; expand one merge per candidate.
const GLYPH_MERGES: Array<[RegExp, string]> = [[/n/g, 'ri'], [/m/g, 'rn']]

function unmerged(observed: string): string[] {
  const variants: string[] = []
  for (const [glyph, pair] of GLYPH_MERGES) {
    for (const match of observed.matchAll(glyph)) {
      variants.push(observed.slice(0, match.index) + pair + observed.slice(match.index! + match[0].length))
    }
  }
  return variants
}

// size each edit budget to the compared label form.
function labelDistance(observed: string, label: string, loose = false): number {
  const reads = [{ text: observed, slip: 0 }, ...unmerged(observed).map((text) => ({ text, slip: 1 }))]
  const fits = labelForms(label)
      .flatMap((form) => reads.map(({ text, slip }) => ({
        distance: editDistance(text, form) + slip,
        tolerance: formTolerance(form, loose),
      })))
      .filter((entry) => entry.distance <= entry.tolerance)
  return fits.length > 0 ? Math.min(...fits.map((entry) => entry.distance)) : Infinity
}

interface LabelMatch {
  key: string
  distance: number
}

// try contiguous word runs when text from an adjacent row enters the crop.
function wordRuns(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const runs: string[] = []
  for (let from = 0; from < words.length; from += 1) {
    for (let to = words.length; to > from; to -= 1) {
      runs.push(normLetters(words.slice(from, to).join('')))
    }
  }
  return [...new Set(runs)].filter(Boolean)
}

// every candidate within tolerance, closest first
function matchLabels(observed: string, keys: string[], loose = false): LabelMatch[] {
  const runs = wordRuns(observed)
  if (runs.length === 0) return []
  return keys
      .map((key) => {
        const label = STAT_LABELS[familyOf(key)]
        const distance = label
          ? Math.min(...runs.map((run) => labelDistance(run, label, loose)))
          : Infinity
        return { key, distance }
      })
      .filter((entry) => Number.isFinite(entry.distance))
      .sort((left, right) => left.distance - right.distance)
      .map(({ key, distance }) => ({ key, distance }))
}

// a short label (HP, ATK, DEF) read with a slip is too near noise to stand alone: a shredded or
// blank crop leaves fragments like "he" or "DE", one edit from HP and DEF, and their values are
// legal for several stats. a slipped short label falls to the ink-shape reader, or the main's value
function isSureLabel(match: LabelMatch | undefined): match is LabelMatch {
  return !!match && (match.distance === 0 || normLetters(STAT_LABELS[familyOf(match.key)] ?? '').length > 3)
}

// check the label independently of its numeric value.
export function namesSubstat(label: string): boolean {
  const families = [...new Set(SUBSTAT_KEYS.map(familyOf))]
  return matchLabels(label, families.flatMap(keysForFamily)).some(isSureLabel)
}


export function resolveMainKey(rawLabel: string, cost: number): string | null {
  const match = matchLabels(rawLabel, Object.keys(ECHO_MAIN_STATS[cost] ?? {}))[0]
  return isSureLabel(match) ? match.key : null
}

// whether the label surely names a main stat at any cost
export function namesMain(rawLabel: string): boolean {
  return Object.values(ECHO_MAIN_STATS).some((stats) => isSureLabel(matchLabels(rawLabel, Object.keys(stats))[0]))
}

// the printed value settles a main whose label could not be read. a value several mains share
// (30% on a 3-cost) needs a loose label to choose among them, or the echo stays unread
export function resolveMainByValue(rawLabel: string, rawValue: string, cost: number): string | null {
  const number = Number(rawValue.match(/\d+(?:\.\d+)?/)?.[0] ?? Number.NaN)
  if (!Number.isFinite(number)) return null
  const stats = ECHO_MAIN_STATS[cost] ?? {}
  const fits = Object.keys(stats).filter((key) => Math.abs(stats[key] - number) < 0.05)
  if (fits.length === 1) return fits[0]
  const [lead, rival] = matchLabels(rawLabel, fits, true)
  return lead && (!rival || lead.distance < rival.distance) ? lead.key : null
}

// infer cost only when one cost table uniquely matches the main stat label.
export function costForMain(rawLabel: string): number | null {
  const observed = rawLabel
  const costs = Object.keys(ECHO_MAIN_STATS).map(Number)
  const best = costs
      .map((cost) => ({ cost, match: matchLabels(observed, Object.keys(ECHO_MAIN_STATS[cost]))[0] }))
      .filter((entry) => entry.match)
  if (best.length === 0) return null
  const closest = Math.min(...best.map((entry) => entry.match!.distance))
  const winners = best.filter((entry) => entry.match!.distance === closest)
  return winners.length === 1 ? winners[0].cost : null
}

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
  /** whether the value was exact, corrected by one character, or snapped to a roll. */
  fix: SubstatFix
  /** a loose label requires an exact roll for one stat. */
  looseLabel?: true
}

// percent rolls are at least 0.7 apart; snap within 0.15 and never snap flat rolls.
const SNAP_REACH = 0.15

// accept exact rolls, unique single-character corrections, or nearby percent rolls.
function settleValue(key: string, text: string): { value: number; fix: SubstatFix } | null {
  const raw = Number(text)
  if (isLegal(key, raw)) return { value: raw, fix: 'exact' }
  const legal = [...new Set(valueVariants(text).filter((value) => isLegal(key, value)))]
  if (legal.length === 1) return { value: legal[0], fix: 'corrected' }
  if (key.endsWith('Flat')) return null
  const nearest = snapToNrstSb(key, raw)
  return Math.abs(nearest - raw) <= SNAP_REACH ? { value: nearest, fix: 'snapped' } : null
}

const FIX_COST: Record<SubstatFix, number> = { exact: 0, corrected: 0.5, snapped: 2 }

// resolve the flat and percent keys for a shared printed name.
function keysForFamily(family: string): string[] {
  const split = SUBSTAT_KEYS.filter((key) => key === `${family}Flat` || key === `${family}Percent`)
  return split.length > 0 ? split : SUBSTAT_KEYS.filter((key) => key === family)
}

// use the longest number when the crop includes stray digits.
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
    ? row
    : `${row.slice(0, number.index)} ${row.slice(number.index! + number[0].length)}`

  // require a readable label before matching its value against roll tables.
  const families = [...new Set(SUBSTAT_KEYS.map(familyOf))]
  const labelled = matchLabels(observed, families.flatMap(keysForFamily)).filter(isSureLabel)
  if (labelled.length === 0) return readLoose(observed, valueText, families)

  const scored = labelled.flatMap(({ key, distance }) => {
    const settled = settleValue(key, valueText)
    if (!settled) return []
    // use the percent sign only to break ties after matching legal rolls.
    const signCost = key.endsWith('Flat') === hasPercent ? 0.25 : 0
    return [{ key, ...settled, score: distance + FIX_COST[settled.fix] + signCost }]
  })
  scored.sort((left, right) => left.score - right.score)
  const best = scored[0]
  return best ? { key: best.key, value: best.value, fix: best.fix } : null
}

// accept a loose label only with one stat family and one exact legal roll.
function readLoose(observed: string, valueText: string, families: string[]): SubstatReading | null {
  const loose = matchLabels(observed, families.flatMap(keysForFamily), true).filter(isSureLabel)
  if (new Set(loose.map((entry) => familyOf(entry.key))).size !== 1) return null
  const exact = loose.filter((entry) => isLegal(entry.key, Number(valueText)))
  if (exact.length !== 1) return null
  return { key: exact[0].key, value: Number(valueText), fix: 'exact', looseLabel: true }
}

// keep the best reading for each stat; one echo cannot roll the same stat twice.
export function readSbstDtl(rows: string[], values: string[] = []): SubstatReading[] {
  const rank: Record<SubstatFix, number> = { exact: 0, corrected: 1, snapped: 2 }
  const kept = new Map<string, SubstatReading>()
  for (const [index, row] of rows.entries()) {
    const reading = readSubstat(row, values[index])
    if (!reading) continue
    const held = kept.get(reading.key)
    if (!held || rank[reading.fix] < rank[held.fix]) kept.set(reading.key, reading)
  }
  return [...kept.values()]
}

export function readSubstats(rows: string[], values: string[] = []): Record<string, number> {
  return Object.fromEntries(readSbstDtl(rows, values).map((reading) => [reading.key, reading.value]))
}
