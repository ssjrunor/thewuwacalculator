import type { RotationNode } from '@/domain/gameData/contracts'
import type { SkillDefinition } from '@/domain/entities/stats'
import {
  listFeaturesForSource,
  listResonatorFeatures,
  listSkillsForSource,
} from '@/domain/services/gameDataService'
import { convertLegacyEchoList } from './echoes'
import {
  coerceNumber,
  isRecord,
  normalizeString,
  pushIssue,
  type LegacyImportIssue,
} from './shared'

interface LegacyRotationEntry {
  id?: unknown
  label?: unknown
  tab?: unknown
  multiplier?: unknown
  type?: unknown
  visible?: unknown
  disabled?: unknown
}

interface RotationFeatureCandidate {
  featureId: string
  label: string
  sourceType: 'resonator' | 'echo'
  skill?: SkillDefinition | undefined
}

function mapLegacyTab(tab: string | null): string | null {
  if (!tab) return null

  const normalized = tab.trim()
  if (normalized === 'echoAttacks') return 'echoSkill'
  if (normalized === 'negativeEffect') return normalized
  return normalized
}

function getLegacyRotationLabel(entry: unknown): string | null {
  if (!isRecord(entry) || typeof entry.label !== 'string') {
    return null
  }

  const trimmed = entry.label.trim()
  return trimmed || null
}

function collectRotationFeatureCandidates(
  resonatorId: string,
  legacyEquippedEchoes: unknown[] = [],
): RotationFeatureCandidate[] {
  const candidates: RotationFeatureCandidate[] = []
  const resonatorSkillsById = Object.fromEntries(
    listSkillsForSource('resonator', resonatorId).map((skill) => [skill.id, skill]),
  )

  for (const feature of listResonatorFeatures(resonatorId)) {
    candidates.push({
      featureId: feature.id,
      label: feature.label,
      sourceType: 'resonator',
      skill: feature.skillId ? resonatorSkillsById[feature.skillId] : undefined,
    })
  }

  const echoes = convertLegacyEchoList(legacyEquippedEchoes)
  const seenEchoIds = new Set<string>()

  for (const echo of echoes) {
    if (seenEchoIds.has(echo.id)) {
      continue
    }

    seenEchoIds.add(echo.id)
    const skillsById = Object.fromEntries(
      listSkillsForSource('echo', echo.id).map((skill) => [skill.id, skill]),
    )

    for (const feature of listFeaturesForSource('echo', echo.id)) {
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

function matchLegacyRotationFeature(
  candidates: RotationFeatureCandidate[],
  entry: LegacyRotationEntry,
): RotationFeatureCandidate | null {
  const label = typeof entry.label === 'string' ? entry.label.trim() : ''
  if (!label) {
    return null
  }

  const exactMatches = candidates.filter((candidate) => normalizeString(candidate.label) === normalizeString(label))
  if (exactMatches.length === 0) {
    return null
  }

  if (exactMatches.length === 1) {
    return exactMatches[0]
  }

  const legacyTab = mapLegacyTab(typeof entry.tab === 'string' ? entry.tab : null)
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

export function findLegacyTargetFeatureId(
  resonatorId: string,
  legacyEquippedEchoes: unknown[],
  target: { label?: unknown; Name?: unknown; tab?: unknown },
): string | null {
  const label =
    (typeof target.label === 'string' && target.label.trim())
    || (typeof target.Name === 'string' && target.Name.trim())
    || null

  if (!label) {
    return null
  }

  const matched = matchLegacyRotationFeature(
    collectRotationFeatureCandidates(resonatorId, legacyEquippedEchoes),
    {
      label,
      tab: target.tab,
    },
  )

  return matched?.featureId ?? null
}

export function convertLegacyRotationEntries(
  resonatorId: string,
  entries: unknown,
  legacyEquippedEchoes: unknown[] = [],
  issues?: LegacyImportIssue[],
  subject?: string,
): RotationNode[] {
  if (!Array.isArray(entries)) {
    return []
  }

  const candidates = collectRotationFeatureCandidates(resonatorId, legacyEquippedEchoes)
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
      if (issues) {
        pushIssue(issues, {
          scope: 'rotation',
          subject,
          reason: `Skipped legacy rotation block "${typeof entry.label === 'string' ? entry.label : `#${index + 1}`}" because v1 blocks were UI-only groupings.`,
        })
      }
      continue
    }

    const matched = matchLegacyRotationFeature(candidates, entry)
    if (!matched) {
      const label = getLegacyRotationLabel(entry) ?? `#${index + 1}`
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

