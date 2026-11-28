/*
  Author: Runor Ewhro
  description: resolves ocr readings from a build-card screenshot against the
               resonator and weapon catalogs without applying them to runtime.
*/

import type { AttributeKey } from '@/domain/entities/stats'
import type { SkillLevels } from '@/domain/entities/runtime'
import type { ResSeed } from '@/domain/entities/runtime'
import type { GenWpn } from '@/domain/entities/weapon'
import { editDistance } from '@/engine/echoParser/editDistance'

export type CoreSkillLevels = Pick<
  SkillLevels,
  'normalAttack' | 'resonanceLiberation' | 'forteCircuit' | 'introSkill' | 'resonanceSkill'
>

export type RawCoreSkillLevels = { [Key in keyof CoreSkillLevels]: string }
export type ParsedCoreSkillLevels = { [Key in keyof CoreSkillLevels]: number | null }

export interface RawBuildScreenshotReadings {
  playerIdText: string
  uidText: string
  // independent digits-only uid read used to verify the first read
  uidCheckText?: string
  resonatorNameText: string
  resonatorLevelText: string
  weaponNameText: string
  weaponLevelText: string
  skillLevelText: RawCoreSkillLevels
  attribute: AttributeKey | null
  activeSequences: boolean[]
  // what the name span held: no gold ink (a blank name), art behind the letters, or a clean name
  playerNameInk?: PlayerNameInk
  // the name is one model's guess that no second read agreed with (a chinese card's non-latin name)
  playerNameUnconfirmed?: boolean
}

export type PlayerNameInk = 'none' | 'obscured' | 'clear'

export interface ParsedBuildMetadata {
  player: {
    id: string | null
    uid: string | null
    // both uid reads were complete and identical; the leaderboard requires this
    uidAgreed?: boolean
    // what the name span held, when the parser looked
    nameInk?: PlayerNameInk
    // the name is one model's guess that no second read agreed with
    nameUnconfirmed?: boolean
  }
  resonator: {
    id: string | null
    candidateIds: string[]
    name: string | null
    attribute: AttributeKey | null
    level: number | null
    sequence: number
    skillLevels: ParsedCoreSkillLevels
    // set when the name line matched no resonator and the portrait alone selected it
    byArt?: boolean
  }
  weapon: {
    id: string | null
    name: string | null
    level: number | null
    // set when the icon replaced a different weapon the name line had matched
    iconOverrode?: boolean
  }
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseLabeledValue(value: string, label: RegExp): string | null {
  const withoutLabel = value.replace(label, '').trim()
  return withoutLabel.length > 0 ? withoutLabel : null
}

const UID_LENGTH = 9

// accept only a contiguous nine-digit uid
function parseUid(value: string): string | null {
  const runs = value.match(/\d+/g) ?? []
  return runs.find((run) => run.length === UID_LENGTH) ?? null
}

// the check read is digits-only, so the "UID:" label's I or colon comes back
// as a leading digit ("1500395087"). the label always precedes the number,
// so the check's last nine digits are its uid. this cannot invent a uid:
// agreement still needs the first read to be exactly the same nine digits
function parseCheckUid(value: string): string | null {
  const runs = value.match(/\d+/g) ?? []
  const longest = runs.reduce((best, run) => (run.length > best.length ? run : best), '')
  return longest.length >= UID_LENGTH ? longest.slice(-UID_LENGTH) : null
}

// true only when the independent check read exists and matches the first read
function uidReadsAgree(first: string, check: string | undefined): boolean {
  const read = parseUid(first)
  return read !== null && check !== undefined && parseCheckUid(check) === read
}

// reject conflicting valid reads; accept the valid read when the other is incomplete
function settleUid(first: string, check: string | undefined): string | null {
  const read = parseUid(first)
  const second = check === undefined ? null : parseUid(check)
  if (read && second) return read === second ? read : null
  return read ?? second
}

// remove isolated trailing letters produced by adjacent name glyphs
function trimStray(value: string | null): string | null {
  if (value === null) return null
  const parts = value.split(/\s+/)
  while (parts.length > 1 && parts[parts.length - 1].length === 1) parts.pop()
  const trimmed = parts.join(' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

// a shrunk card blurs the small marks at a name's ends: "~Marmalade~" read as "~Marmalade-" at 1120 wide, and the
// colon before "TETHYS-C3FM" bled into a leading "-", each at higher confidence than true reads. such a name is left
// for the user; a full-size card reads its marks
const NAME_EDGE_MARK = /^[~\-'._:/]|[~\-'._:/]$/

export function trustName(name: string | null, lowResolution: boolean): string | null {
  return name !== null && lowResolution && NAME_EDGE_MARK.test(name) ? null : name
}

// a name as the models print it, with a space kept only between two latin letters or digits ("Dan Heng"): they space
// out cjk characters ("本 源 之 心") that the card prints together
export function tidyName(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/(?<![A-Za-z0-9]) | (?![A-Za-z0-9])/g, '')
}

// kana whose small form is the same shape, which the models tell apart only by size ("ひぃちゃ" read "ひいちゃ")
const SMALL_KANA: Record<string, string> = {
  あ: 'ぁ', い: 'ぃ', う: 'ぅ', え: 'ぇ', お: 'ぉ', つ: 'っ', や: 'ゃ', ゆ: 'ゅ', よ: 'ょ', わ: 'ゎ',
  ア: 'ァ', イ: 'ィ', ウ: 'ゥ', エ: 'ェ', オ: 'ォ', ツ: 'ッ', ヤ: 'ャ', ユ: 'ュ', ヨ: 'ョ', ワ: 'ヮ',
}
const FULL_WIDTH = /^[　-鿿＀-￯]+$/
// on the japanese cards a small kana's ink stood 9 px of a line's 13 to 15 (the "ぃ" of "ひぃちゃ"), a full one 13 or
// more (the "い" of "あいにゃす")
const SMALL_KANA_SHARE = 0.75

// a name in full-width characters with each read kana that stands well short of the line set to its small form.
// heights are each character cell's ink height, one per character, or the name is left as read
export function smallKana(name: string, heights: number[]): string {
  const chars = [...name]
  if (chars.length !== heights.length || !FULL_WIDTH.test(name)) return name
  // the long vowel mark and punctuation are short by nature
  const sizes = heights.filter((_, index) => /[぀-ヺ一-鿿]/.test(chars[index])).sort((a, b) => a - b)
  if (sizes.length < 2) return name
  const line = sizes[sizes.length >> 1]
  return chars.map((char, index) => (
    SMALL_KANA[char] && heights[index] > 0 && heights[index] <= line * SMALL_KANA_SHARE ? SMALL_KANA[char] : char
  )).join('')
}

// what each model read off a chinese card's name, dark on light
export interface ZhNameReads {
  // the english model, limited to name characters: contrast at 2x, then inverted at 2x and 3x
  english: string[]
  // the chinese model at 2x and 3x
  chinese: [string, string]
  // the japanese model at 2x, which alone reads kana
  japanese: string
}

export interface ZhNameVerdict {
  name: string
  // the english model agreed with another model: a latin name read the same by two models with different mistakes
  confirmed: boolean
  // two latin reads that share little: letters neither model reads, which the greek model may read ("Λæα")
  askGreek: boolean
}

const KANA = /[぀-ヿ]/g
const LATIN = /^[\x20-\x7e]+$/

// a chinese card's name from three models that err differently. on the local leaderboard's 96 chinese cards, the
// english model alone read "Kazusa01" as "Kazusa0l", the chinese "Tielle" as "Tiellte", the japanese "灰" as "リツ", and
// no two shared a mistake on a latin name, so two agreeing reads name the player (19 of 19 right). on rare characters
// the chinese and japanese models share look-alikes ("暝紋" as "暖紋" in both), so their agreement names the player
// unconfirmed. with no agreement: the chinese read when its two scales agree, kana from the japanese model (which the
// chinese model turns into characters: "シャルロット" as "鎊銜兒口導上"), and a latin name the english read
export function settleZhName(reads: ZhNameReads): ZhNameVerdict {
  const key = (text: string) => text.toLowerCase()
  const english = reads.english.map(tidyName)
  const counts = new Map<string, number>()
  for (const read of english) if (read) counts.set(key(read), (counts.get(key(read)) ?? 0) + 1)
  const majority = english.find((read) => read && (counts.get(key(read)) ?? 0) >= 2)
  const latin = majority ?? english[0] ?? ''
  const [chinese, chineseLarge] = reads.chinese.map(tidyName)
  const japanese = tidyName(reads.japanese)
  const verdict = (name: string, confirmed = false, askGreek = false): ZhNameVerdict => ({ name, confirmed, askGreek })

  // the english model's letters keep their case ("sito", where the chinese model gives "Sito")
  if (latin && (key(latin) === key(chinese) || key(latin) === key(japanese))) return verdict(latin, true)
  if (chinese && key(chinese) === key(japanese)) return verdict(chinese)
  if (chinese && key(chinese) === key(chineseLarge) && !LATIN.test(chinese)) return verdict(chinese)
  // two kana alone are a guess at strokes ("熒" as "テッ")
  if ((japanese.match(KANA) ?? []).length >= 2 && japanese.length >= 3) return verdict(japanese)
  // the chinese model reads latin names well, so a latin read is kept only when it also read latin
  if (latin && LATIN.test(latin) && LATIN.test(chinese) && chinese.length >= 2) {
    return verdict(latin, false, editDistance(latin, chinese) / Math.max(latin.length, chinese.length) > 0.5)
  }
  // otherwise any read in characters, or none: a lone english read here is noise ("雲歌" as "ER")
  return verdict([chinese, chineseLarge, japanese].find((read) => read && !LATIN.test(read)) ?? '')
}

function parseLevel(value: string): number | null {
  const explicitLevel = value.match(/lv\.?\s*(\d{1,2})/i)
  if (explicitLevel) return Number(explicitLevel[1])
  const slashLevel = value.match(/(\d{1,2})\s*[/|]\s*10/i)
  const level = Number(slashLevel?.[1] ?? value.match(/(\d{1,2})/)?.[1])
  return Number.isFinite(level) ? level : null
}

// split the shared name and level line at its level badge
export function splitNameLvl(value: string): { name: string; level: number | null } {
  const badge = value.match(/\blv\b\.?\s*(\d{1,2})/i) ?? value.match(/lv\.?\s*(\d{1,2})/i)
  if (!badge) return { name: value.trim(), level: null }
  return {
    name: value.slice(0, badge.index).trim(),
    level: Number(badge[1]),
  }
}

// levels above 90 come from badge hatching or other image noise
function resonatorLevel(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return value >= 1 && value <= 90 ? value : null
}

function nameDistance(observed: string, catalogName: string): number {
  if (
    Math.min(observed.length, catalogName.length) >= 4
    && (observed.includes(catalogName) || catalogName.includes(observed))
  ) {
    return 0
  }
  return editDistance(observed, catalogName)
}

function matchResonators(
    rawName: string,
    attribute: AttributeKey | null,
    resonators: ResSeed[],
): ResSeed[] {
  const normalized = normalizeName(rawName)
  if (!normalized) return []

  const scored = resonators.map((resonator) => {
    const fullName = normalizeName(resonator.name)
    const baseName = normalizeName(resonator.name.split(':')[0])
    return {
      resonator,
      // prefer a named rover variant over the shared base name
      score: Math.min(nameDistance(normalized, fullName), nameDistance(normalized, baseName) + 0.5),
    }
  })
  const bestScore = Math.min(...scored.map((entry) => entry.score))
  const tolerance = Math.max(1, Math.floor(normalized.length * 0.2))
  if (!Number.isFinite(bestScore) || bestScore > tolerance) return []

  const nameMatches = scored
      .filter((entry) => entry.score === bestScore)
      .map((entry) => entry.resonator)
  const attributeMatches = attribute
    ? nameMatches.filter((resonator) => resonator.attribute === attribute)
    : []

  return attributeMatches.length > 0 ? attributeMatches : nameMatches
}

// remove ocr variants of the card's encoded ampersand
function dropEscapedAmp(value: string): string {
  return value.replace(/&?\bamp[;:j]?(?=\s|$)/gi, ' ')
}

function matchWeapon(rawName: string, weapons: GenWpn[]): GenWpn | null {
  const normalized = normalizeName(dropEscapedAmp(rawName))
  if (!normalized) return null

  const scored = weapons.map((weapon) => ({
    weapon,
    score: editDistance(normalized, normalizeName(weapon.name)),
  }))
  const bestScore = Math.min(...scored.map((entry) => entry.score))
  const tolerance = Math.max(1, Math.floor(normalized.length * 0.2))
  if (!Number.isFinite(bestScore) || bestScore > tolerance) return null

  const matches = scored.filter((entry) => entry.score === bestScore)
  return matches.length === 1 ? matches[0].weapon : null
}

export interface ArtMatch {
  id: string
  score: number
}

// rover variants share art, so scores within this ratio count as the same image
const SAME_ART = 1.05

// a full-catalog art match requires a wider margin than a name-filtered match
export const ART_MARGIN = { catalog: 1.3, named: 1.15 } as const

// require a clear image lead or a unique attribute among shared-art variants
export function settleResonatorArt(
    ranks: ArtMatch[],
    margin: number,
    attributeOf: (id: string) => AttributeKey | null,
    attribute: AttributeKey | null,
): string | null {
  const [best] = ranks
  if (!best) return null
  const alike = ranks.filter((entry) => entry.score <= best.score * SAME_ART)
  const next = ranks[alike.length]
  if (next && next.score < best.score * margin) return null
  if (alike.length === 1) return best.id
  const matching = attribute ? alike.filter((entry) => attributeOf(entry.id) === attribute) : []
  return matching.length === 1 ? matching[0].id : null
}

// a clear match to the catalog weapon icon overrides the ocr name match
export const WEAPON_ICON_MARGIN = 1.5

export function settleWeapon(
    read: ParsedBuildMetadata['weapon'],
    icons: ArtMatch[],
    weapons: GenWpn[],
): ParsedBuildMetadata['weapon'] {
  const [best, runnerUp] = icons
  if (!best || (runnerUp && runnerUp.score < best.score * WEAPON_ICON_MARGIN)) return read
  const weapon = weapons.find((entry) => entry.id === best.id)
  if (!weapon) return read
  return { ...read, id: weapon.id, name: weapon.name, ...(read.id && read.id !== weapon.id ? { iconOverrode: true } : {}) }
}

function countSequence(activeSequences: boolean[]): number {
  let count = 0
  for (const active of activeSequences.slice(0, 6)) {
    if (!active) break
    count += 1
  }
  return count
}

export function resolveBuildScreenshotMetadata(
    readings: RawBuildScreenshotReadings,
    catalogs: { resonators: ResSeed[]; weapons: GenWpn[] },
): ParsedBuildMetadata {
  const nameLine = splitNameLvl(readings.resonatorNameText)
  const resonatorMatches = matchResonators(
    nameLine.name,
    readings.attribute,
    catalogs.resonators,
  )
  const weapon = matchWeapon(readings.weaponNameText, catalogs.weapons)
  const skillLevels = Object.fromEntries(
    Object.entries(readings.skillLevelText).map(([key, value]) => [key, parseLevel(value)]),
  ) as ParsedCoreSkillLevels

  return {
    player: {
      // a soft read turns "ID" into "1D" or "I1D"
      id: trimStray(parseLabeledValue(readings.playerIdText, /^\s*player\s*[il1|]{0,2}[dp0]\s*[:.;]?\s*/i)),
      uid: settleUid(readings.uidText, readings.uidCheckText),
      uidAgreed: uidReadsAgree(readings.uidText, readings.uidCheckText),
      ...(readings.playerNameInk ? { nameInk: readings.playerNameInk } : {}),
      ...(readings.playerNameUnconfirmed ? { nameUnconfirmed: true } : {}),
    },
    resonator: {
      id: resonatorMatches.length === 1 ? resonatorMatches[0].id : null,
      candidateIds: resonatorMatches.map((resonator) => resonator.id),
      name: resonatorMatches[0]?.name ?? parseLabeledValue(nameLine.name, /^\s*name\s*[:.]?\s*/i),
      attribute: readings.attribute,
      level: resonatorLevel(parseLevel(readings.resonatorLevelText) ?? nameLine.level),
      sequence: countSequence(readings.activeSequences),
      skillLevels,
    },
    weapon: {
      id: weapon?.id ?? null,
      name: weapon?.name ?? parseLabeledValue(readings.weaponNameText, /^\s*weapon\s*[:.]?\s*/i),
      level: parseLevel(readings.weaponLevelText),
    },
  }
}
