/*
  Author: Runor Ewhro
  Description: Converts legacy saved rotations into the current inventory
               rotation format used by the calculator.
*/

import type { RotationNode } from '@/domain/gameData/contracts'
import type { SkillDef } from '@/domain/entities/stats'
import {
  listFeatsFor,
  listResFeats,
  listSkillsFor,
} from '@/domain/services/gameDataService'
import { cnvrLegEchoL } from './echoes'
import {
  coerceNumber,
  isRecord,
  normStrn,
  pushIssue,
  type LegMprtSs,
} from './shared'

interface LegRotEnt {
  id?: unknown
  label?: unknown
  tab?: unknown
  multiplier?: unknown
  type?: unknown
  visible?: unknown
  disabled?: unknown
}

interface RotFeatCand {
  featureId: string
  label: string
  sourceType: 'resonator' | 'echo'
  skill?: SkillDef | undefined
}

function mapLegacyTab(tab: string | null): string | null {
  if (!tab) return null

  const normalized = tab.trim()
  // echo attacks were renamed when echo skills joined the shared feature model.
  if (normalized === 'echoAttacks') return 'echoSkill'
  if (normalized === 'negativeEffect') return normalized
  return normalized
}

function getLegRotLbl(entry: unknown): string | null {
  if (!isRecord(entry) || typeof entry.label !== 'string') {
    return null
  }

  const trimmed = entry.label.trim()
  return trimmed || null
}

function cllcRotFeatC(
  resonatorId: string,
  legQppdChs: unknown[] = [],
): RotFeatCand[] {
  const candidates: RotFeatCand[] = []
  // collect resonator features and equipped-echo features into one candidate
  // list because legacy rotations only stored labels and loose tab hints.
  const resSkllById = Object.fromEntries(
    listSkillsFor('resonator', resonatorId).map((skill) => [skill.id, skill]),
  )

  for (const feature of listResFeats(resonatorId)) {
    candidates.push({
      featureId: feature.id,
      label: feature.label,
      sourceType: 'resonator',
      skill: feature.skillId ? resSkllById[feature.skillId] : undefined,
    })
  }

  const echoes = cnvrLegEchoL(legQppdChs)
  const seenEchoIds = new Set<string>()

  for (const echo of echoes) {
    if (seenEchoIds.has(echo.id)) {
      continue
    }

    seenEchoIds.add(echo.id)
    const skillsById = Object.fromEntries(
      listSkillsFor('echo', echo.id).map((skill) => [skill.id, skill]),
    )

    for (const feature of listFeatsFor('echo', echo.id)) {
      candidates.push({
        featureId: feature.id,
        label: feature.label,
        sourceType: 'echo',
        skill: feature.skillId ? skillsById[feature.skillId] : undefined,
      })
    }
  }

  return candidates
}

function mtchLegRotFe(
  candidates: RotFeatCand[],
  entry: LegRotEnt,
): RotFeatCand | null {
  const label = typeof entry.label === 'string' ? entry.label.trim() : ''
  if (!label) {
    return null
  }

  const exactMatches = candidates.filter((candidate) => normStrn(candidate.label) === normStrn(label))
  if (exactMatches.length === 0) {
    return null
  }

  if (exactMatches.length === 1) {
    return exactMatches[0]
  }

  const legacyTab = mapLegacyTab(typeof entry.tab === 'string' ? entry.tab : null)
  // duplicate labels are common across skill panels, so the legacy tab narrows
  // the match before falling back to resonator-owned features.
  if (legacyTab) {
    const tabMatches = exactMatches.filter((candidate) => candidate.skill?.tab === legacyTab)
    if (tabMatches.length === 1) {
      return tabMatches[0]
    }

    if (tabMatches.length > 1) {
      return tabMatches[0]
    }
  }

  const nonEchoMatch = exactMatches.find((candidate) => candidate.sourceType === 'resonator')
  return nonEchoMatch ?? exactMatches[0]
}

export function findLegTgtFe(
  resonatorId: string,
  legQppdChs: unknown[],
  target: { label?: unknown; Name?: unknown; tab?: unknown },
): string | null {
  const label =
    (typeof target.label === 'string' && target.label.trim())
    || (typeof target.Name === 'string' && target.Name.trim())
    || null

  if (!label) {
    return null
  }

  const matched = mtchLegRotFe(
    cllcRotFeatC(resonatorId, legQppdChs),
    {
      label,
      tab: target.tab,
    },
  )

  return matched?.featureId ?? null
}

export function cnvrLegRotEn(
  resonatorId: string,
  entries: unknown,
  legQppdChs: unknown[] = [],
  issues?: LegMprtSs[],
  subject?: string,
): RotationNode[] {
  if (!Array.isArray(entries)) {
    return []
  }

  // build candidates once per imported rotation so every entry resolves against
  // the same equipped-echo snapshot.
  const candidates = cllcRotFeatC(resonatorId, legQppdChs)
  const nodes: RotationNode[] = []

  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) {
      if (issues) {
        pushIssue(issues, {
          scope: 'rotation',
          subject,
          reason: `Rotation entry ${index + 1} is not an object.`,
        })
      }
      continue
    }

    const type = typeof entry.type === 'string' ? entry.type : 'skill'
    if (type === 'block') {
      // v1 blocks had no executable meaning, so dropping them preserves damage
      // behavior while surfacing the lossy conversion in the import report.
      if (issues) {
        pushIssue(issues, {
          scope: 'rotation',
          subject,
          reason: `Skipped legacy rotation block "${typeof entry.label === 'string' ? entry.label : `#${index + 1}`}" because v1 blocks were UI-only groupings.`,
        })
      }
      continue
    }

    const matched = mtchLegRotFe(candidates, entry)
    if (!matched) {
      const label = getLegRotLbl(entry) ?? `#${index + 1}`
      if (issues) {
        pushIssue(issues, {
          scope: 'rotation',
          subject,
          reason: `Could not match legacy rotation entry "${label}" to a current feature id.`,
        })
      }
      continue
    }

    const multiplier = coerceNumber(entry.multiplier)
    const enabled =
      (typeof entry.visible === 'boolean' ? entry.visible : true)
      && !(typeof entry.disabled === 'boolean' && entry.disabled)

    nodes.push({
      type: 'feature',
      id: `legacy-rotation:${resonatorId}:${typeof entry.id === 'string' ? entry.id : index}`,
      featureId: matched.featureId,
      ...(multiplier != null && multiplier !== 1 ? { multiplier } : {}),
      ...(enabled ? {} : { enabled: false }),
    })
  }

  return nodes
}
