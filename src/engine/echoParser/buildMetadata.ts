/*
  Author: Runor Ewhro
  Description: Resolves OCR readings from a build-card screenshot against the
               resonator and weapon catalogs without applying them to runtime.
*/

import type { AttributeKey } from '@/domain/entities/stats'
import type { SkillLevels } from '@/domain/entities/runtime'
import type { ResSeed } from '@/domain/entities/runtime'
import type { GenWpn } from '@/domain/entities/weapon'

export type CoreSkillLevels = Pick<
  SkillLevels,
  'normalAttack' | 'resonanceLiberation' | 'forteCircuit' | 'introSkill' | 'resonanceSkill'
>

export type RawCoreSkillLevels = { [Key in keyof CoreSkillLevels]: string }
export type ParsedCoreSkillLevels = { [Key in keyof CoreSkillLevels]: number | null }

export interface RawBuildScreenshotReadings {
  playerIdText: string
  uidText: string
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

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]
          + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      )
    }
    previous.splice(0, previous.length, ...current)
  }

  return previous[right.length]
}

function parseLabeledValue(value: string, label: RegExp): string | null {
  const withoutLabel = value.replace(label, '').trim()
  return withoutLabel.length > 0 ? withoutLabel : null
}

function parseDigits(value: string): string | null {
  const match = value.match(/\d+/g)?.join('') ?? ''
  return match.length > 0 ? match : null
}

function parseLevel(value: string): number | null {
  const explicitLevel = value.match(/lv\.?\s*(\d{1,2})/i)
  if (explicitLevel) return Number(explicitLevel[1])
  const slashLevel = value.match(/(\d{1,2})\s*[/|]\s*10/i)
  const level = Number(slashLevel?.[1] ?? value.match(/(\d{1,2})/)?.[1])
  return Number.isFinite(level) ? level : null
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
      score: Math.min(nameDistance(normalized, fullName), nameDistance(normalized, baseName)),
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

function matchWeapon(rawName: string, weapons: GenWpn[]): GenWpn | null {
  const normalized = normalizeName(rawName)
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
  const resonatorMatches = matchResonators(
    readings.resonatorNameText,
    readings.attribute,
    catalogs.resonators,
  )
  const weapon = matchWeapon(readings.weaponNameText, catalogs.weapons)
  const skillLevels = Object.fromEntries(
    Object.entries(readings.skillLevelText).map(([key, value]) => [key, parseLevel(value)]),
  ) as ParsedCoreSkillLevels

  return {
    player: {
      id: parseLabeledValue(readings.playerIdText, /^\s*player\s*id\s*[:.]?\s*/i),
      uid: parseDigits(readings.uidText),
    },
    resonator: {
      id: resonatorMatches.length === 1 ? resonatorMatches[0].id : null,
      candidateIds: resonatorMatches.map((resonator) => resonator.id),
      name: resonatorMatches[0]?.name ?? parseLabeledValue(readings.resonatorNameText, /^\s*name\s*[:.]?\s*/i),
      attribute: readings.attribute,
      level: parseLevel(readings.resonatorLevelText),
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
