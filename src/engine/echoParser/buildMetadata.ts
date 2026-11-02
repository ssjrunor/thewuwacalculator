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
  /** independent digits-only uid read used to verify the first read. */
  uidCheckText?: string
  resonatorNameText: string
  resonatorLevelText: string
  weaponNameText: string
  weaponLevelText: string
  skillLevelText: RawCoreSkillLevels
  attribute: AttributeKey | null
  activeSequences: boolean[]
}

export interface ParsedBuildMetadata {
  player: {
    id: string | null
    uid: string | null
  }
  resonator: {
    id: string | null
    candidateIds: string[]
    name: string | null
    attribute: AttributeKey | null
    level: number | null
    sequence: number
    skillLevels: ParsedCoreSkillLevels
  }
  weapon: {
    id: string | null
    name: string | null
    level: number | null
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

// accept only a contiguous nine-digit uid.
function parseUid(value: string): string | null {
  const runs = value.match(/\d+/g) ?? []
  return runs.find((run) => run.length === UID_LENGTH) ?? null
}

// reject conflicting valid reads; accept the valid read when the other is incomplete.
function settleUid(first: string, check: string | undefined): string | null {
  const read = parseUid(first)
  const second = check === undefined ? null : parseUid(check)
  if (read && second) return read === second ? read : null
  return read ?? second
}

// remove isolated trailing letters produced by adjacent name glyphs.
function trimStray(value: string | null): string | null {
  if (value === null) return null
  const parts = value.split(/\s+/)
  while (parts.length > 1 && parts[parts.length - 1].length === 1) parts.pop()
  const trimmed = parts.join(' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseLevel(value: string): number | null {
  const explicitLevel = value.match(/lv\.?\s*(\d{1,2})/i)
  if (explicitLevel) return Number(explicitLevel[1])
  const slashLevel = value.match(/(\d{1,2})\s*[/|]\s*10/i)
  const level = Number(slashLevel?.[1] ?? value.match(/(\d{1,2})/)?.[1])
  return Number.isFinite(level) ? level : null
}

// split the shared name and level line at its level badge.
export function splitNameLvl(value: string): { name: string; level: number | null } {
  const badge = value.match(/\blv\b\.?\s*(\d{1,2})/i) ?? value.match(/lv\.?\s*(\d{1,2})/i)
  if (!badge) return { name: value.trim(), level: null }
  return {
    name: value.slice(0, badge.index).trim(),
    level: Number(badge[1]),
  }
}

// levels above 90 come from badge hatching or other image noise.
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
      // prefer a named rover variant over the shared base name.
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

// remove ocr variants of the card's encoded ampersand.
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

// rover variants share art, so scores within this ratio count as the same image.
const SAME_ART = 1.05

// a full-catalog art match requires a wider margin than a name-filtered match.
export const ART_MARGIN = { catalog: 1.3, named: 1.15 } as const

// require a clear image lead or a unique attribute among shared-art variants.
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

// a clear match to the catalog weapon icon overrides the ocr name match.
export const WEAPON_ICON_MARGIN = 1.5

export function settleWeapon(
    read: ParsedBuildMetadata['weapon'],
    icons: ArtMatch[],
    weapons: GenWpn[],
): ParsedBuildMetadata['weapon'] {
  const [best, runnerUp] = icons
  if (!best || (runnerUp && runnerUp.score < best.score * WEAPON_ICON_MARGIN)) return read
  const weapon = weapons.find((entry) => entry.id === best.id)
  return weapon ? { ...read, id: weapon.id, name: weapon.name } : read
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
