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

// what a Traditional Chinese card prints for each stat
const ZH_HANT_LABELS: Record<string, string> = {
  atk: '攻擊',
  hp: '生命',
  def: '防禦',
  critRate: '暴擊',
  critDmg: '暴擊傷害',
  energyRegen: '共鳴效率',
  healingBonus: '治療效果加成',
  basicAtk: '普攻傷害加成',
  heavyAtk: '重擊傷害加成',
  resonanceSkill: '共鳴技能傷害加成',
  resonanceLiberation: '共鳴解放傷害加成',
  aero: '氣動傷害加成',
  glacio: '冷凝傷害加成',
  electro: '導電傷害加成',
  fusion: '熱熔傷害加成',
  havoc: '湮滅傷害加成',
  spectro: '衍射傷害加成',
}

// every character a Traditional Chinese stat label uses, the chinese reader's whitelist
export const ZH_HANT_LABEL_CHARS = [...new Set(Object.values(ZH_HANT_LABELS).join(''))].join('')

// the chi_tra model never returned these on the bench cards ("共效率", "防", "滅傷害加成"), so both sides drop them
const ZH_HANT_UNREAD = /[鳴禦湮]/g

function commonLength(left: string, right: string): number {
  const row = new Array<number>(right.length + 1).fill(0)
  for (const char of left) {
    let diagonal = 0
    for (let index = 1; index <= right.length; index += 1) {
      const above = row[index]
      row[index] = char === right[index - 1] ? diagonal + 1 : Math.max(row[index], row[index - 1])
      diagonal = above
    }
  }
  return row[right.length]
}

// what a Japanese card prints for each stat: HP in latin letters, the rest in kanji and katakana
const JA_LABELS: Record<string, string> = {
  atk: '攻撃力',
  hp: 'HP',
  def: '防御力',
  critRate: 'クリティカル',
  critDmg: 'クリティカルダメージ',
  energyRegen: '共鳴効率',
  healingBonus: 'HP回復効果アップ',
  basicAtk: '通常攻撃ダメージアップ',
  heavyAtk: '重撃ダメージアップ',
  resonanceSkill: '共鳴スキルダメージアップ',
  resonanceLiberation: '共鳴解放ダメージアップ',
  aero: '気動ダメージアップ',
  glacio: '凝縮ダメージアップ',
  electro: '電導ダメージアップ',
  fusion: '焦熱ダメージアップ',
  havoc: '消滅ダメージアップ',
  spectro: '回折ダメージアップ',
}

// every character a Japanese stat label uses, the japanese reader's whitelist
export const JA_LABEL_CHARS = [...new Set(Object.values(JA_LABELS).join(''))].join('')

// the English label a Traditional Chinese read names. a label of four or more characters may lose one and gain one
// ("攻傷害加成", "擊傷害"); a shorter one must be whole, because "生" or "放" alone is as often noise, except the
// dropped "禦" of "防禦". an unread character still counts as lost, so "傷害加成" does not name "湮滅傷害加成". a tie names
// nothing
export function zhHantLabel(observed: string, substat = false): string | null {
  return closestLabel(ZH_HANT_LABELS, observed.replace(/[^一-鿿]/g, ''), ZH_HANT_UNREAD, substat)
}

// the English label a Japanese read names, by the same rule as a chinese one; no character went unread there
export function jaLabel(observed: string, substat = false): string | null {
  return closestLabel(JA_LABELS, observed.replace(/[^一-鿿ぁ-ヿHP]/g, ''), null, substat)
}

// healing and the six attributes print only as main stats, so a substat row weighs only the rest: "重撃ダメージアップ"
// misread toward "電導ダメージアップ" is still heavy attack
const MAIN_ONLY = new Set(['healingBonus', 'aero', 'glacio', 'electro', 'fusion', 'havoc', 'spectro'])

function closestLabel(labels: Record<string, string>, observed: string, unread: RegExp | null,
  substat: boolean): string | null {
  const drop = (text: string) => (unread ? text.replace(unread, '') : text)
  const seen = drop(observed)
  if (!seen) return null
  const fits = Object.entries(labels)
      .filter(([family]) => !substat || !MAIN_ONLY.has(family))
      .map(([family, label]) => {
        const common = commonLength(seen, drop(label))
        const slack = label.length >= 4 || (unread !== null && drop(label) !== label) ? 1 : 0
        const missing = label.length - common
        const extra = seen.length - common
        return { family, cost: missing + extra, fits: missing <= slack && extra <= slack }
      })
      .filter((entry) => entry.fits)
      .sort((left, right) => left.cost - right.cost)
  if (fits.length === 0 || (fits[1] && fits[1].cost === fits[0].cost)) return null
  return STAT_LABELS[fits[0].family]
}

// flat and percent variants of a stat share one printed label
function familyOf(key: string): string {
  return key.replace(/(Flat|Percent)$/, '')
}

export function normLetters(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

// match truncated forms of labels that can wrap onto a second line
function labelForms(label: string): string[] {
  const full = normLetters(label)
  const forms = [full]
  if (full.endsWith('dmgbonus')) forms.push(full.slice(0, -'bonus'.length), full.slice(0, -'dmgbonus'.length))
  return forms
}

// short labels permit one edit; loose matching requires an exact legal value
function formTolerance(form: string, loose = false): number {
  if (form.length <= 3) return 1
  return Math.max(1, Math.floor(form.length * (loose ? 0.45 : 0.25)))
}

// ocr can merge "ri" into "n" and "rn" into "m"; expand one merge per candidate
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

// size each edit budget to the compared label form
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

// try contiguous word runs when text from an adjacent row enters the crop
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

// a short label (HP, ATK, DEF) read with a slip is too near noise to accept alone: a shredded or blank crop leaves
// fragments like "he" or "DE", one edit from HP and DEF, and their values are legal for several stats. a slipped
// short label falls back to the ink-shape reader, or the main's value
function isSureLabel(match: LabelMatch | undefined): match is LabelMatch {
  return !!match && (match.distance === 0 || normLetters(STAT_LABELS[familyOf(match.key)] ?? '').length > 3)
}

// check the label independently of its numeric value
export function namesSubstat(label: string): boolean {
  const families = [...new Set(SUBSTAT_KEYS.map(familyOf))]
  return matchLabels(label, families.flatMap(keysForFamily)).some(isSureLabel)
}


export function resolveMainKey(rawLabel: string, cost: number): string | null {
  const match = matchLabels(rawLabel, Object.keys(ECHO_MAIN_STATS[cost] ?? {}))[0]
  return isSureLabel(match) ? match.key : null
}

// whether the label names a main stat at any cost
export function namesMain(rawLabel: string): boolean {
  return Object.values(ECHO_MAIN_STATS).some((stats) => isSureLabel(matchLabels(rawLabel, Object.keys(stats))[0]))
}

// the printed value resolves a main whose label could not be read. a value several mains share (30% on a 3-cost)
// needs a loose label to choose among them, or the echo stays unread
export function resolveMainByValue(rawLabel: string, rawValue: string, cost: number): string | null {
  const number = Number(rawValue.match(/\d+(?:\.\d+)?/)?.[0] ?? Number.NaN)
  if (!Number.isFinite(number)) return null
  const stats = ECHO_MAIN_STATS[cost] ?? {}
  const fits = Object.keys(stats).filter((key) => Math.abs(stats[key] - number) < 0.05)
  if (fits.length === 1) return fits[0]
  const [lead, rival] = matchLabels(rawLabel, fits, true)
  return lead && (!rival || lead.distance < rival.distance) ? lead.key : null
}

// infer cost only when one cost table uniquely matches the main stat label
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
  // whether the value was exact, corrected by one character, or snapped to a roll
  fix: SubstatFix
  // a loose label requires an exact roll for one stat
  looseLabel?: true
}

// percent rolls are at least 0.7 apart; snap within 0.15 and never snap flat rolls
const SNAP_REACH = 0.15

// accept exact rolls, unique single-character corrections, or nearby percent rolls
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

// resolve the flat and percent keys for a shared printed name
function keysForFamily(family: string): string[] {
  const split = SUBSTAT_KEYS.filter((key) => key === `${family}Flat` || key === `${family}Percent`)
  return split.length > 0 ? split : SUBSTAT_KEYS.filter((key) => key === family)
}

// use the longest number when the crop includes stray digits
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

  // require a readable label before matching its value against roll tables
  const families = [...new Set(SUBSTAT_KEYS.map(familyOf))]
  const labelled = matchLabels(observed, families.flatMap(keysForFamily)).filter(isSureLabel)
  if (labelled.length === 0) return readLoose(observed, valueText, families)

  const scored = labelled.flatMap(({ key, distance }) => {
    const settled = settleValue(key, valueText)
    if (!settled) return []
    // use the percent sign only to break ties after matching legal rolls
    const signCost = key.endsWith('Flat') === hasPercent ? 0.25 : 0
    return [{ key, ...settled, score: distance + FIX_COST[settled.fix] + signCost }]
  })
  scored.sort((left, right) => left.score - right.score)
  const best = scored[0]
  return best ? { key: best.key, value: best.value, fix: best.fix } : null
}

// accept a loose label only with one stat family and one exact legal roll
function readLoose(observed: string, valueText: string, families: string[]): SubstatReading | null {
  const loose = matchLabels(observed, families.flatMap(keysForFamily), true).filter(isSureLabel)
  if (new Set(loose.map((entry) => familyOf(entry.key))).size !== 1) return null
  const exact = loose.filter((entry) => isLegal(entry.key, Number(valueText)))
  if (exact.length !== 1) return null
  return { key: exact[0].key, value: Number(valueText), fix: 'exact', looseLabel: true }
}

// keep the best reading for each stat; one echo cannot roll the same stat twice
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
