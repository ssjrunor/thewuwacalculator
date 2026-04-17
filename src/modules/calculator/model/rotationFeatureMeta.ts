/*
  author: runor ewhro
  description: resolves rotation feature nodes back to catalog skill metadata.
*/

import type { DataSourceRef, FeatureDefinition, RotationNode } from '@/domain/gameData/contracts'
import type { SkillDefinition } from '@/domain/entities/stats'
import { seedResonatorsById } from '@/modules/calculator/model/seedData'
import {
  listFeaturesForSource,
  listResonatorFeatures,
  listResonatorSkills,
  listSkillsForSource,
  listSources,
} from '@/domain/services/gameDataService'

export interface RotationFeatureMeta {
  source: DataSourceRef
  resonatorId: string | null
  resonatorName: string | null
  feature: FeatureDefinition
  skill: SkillDefinition | null
}

function getEmbeddedEchoSource(featureId: string): DataSourceRef | null {
  const match = /^echo:([^:]+):/.exec(featureId)
  return match ? { type: 'echo', id: match[1] } : null
}

function makeSourceKey(source: DataSourceRef): string {
  return `${source.type}:${source.id}`
}

function getCandidateSources(node: Extract<RotationNode, { type: 'feature' }>): DataSourceRef[] {
  const sources: DataSourceRef[] = []
  const seen = new Set<string>()

  const push = (source: DataSourceRef | null) => {
    if (!source) {
      return
    }

    const key = makeSourceKey(source)
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    sources.push(source)
  }

  if (node.resonatorId) {
    push({ type: 'resonator', id: node.resonatorId })
  }

  push(getEmbeddedEchoSource(node.featureId))

  return sources
}

function resolveFeatureFromSource(
  node: Extract<RotationNode, { type: 'feature' }>,
  source: DataSourceRef,
): RotationFeatureMeta | null {
  const features = source.type === 'resonator'
    ? listResonatorFeatures(source.id)
    : listFeaturesForSource(source.type, source.id)
  const feature = features.find((entry) => entry.id === node.featureId)
  if (!feature) {
    return null
  }

  const skills = source.type === 'resonator'
    ? listResonatorSkills(source.id)
    : listSkillsForSource(source.type, source.id)
  const ownerResonatorId = node.resonatorId ?? (source.type === 'resonator' ? source.id : null)
  const ownerSeed = ownerResonatorId ? seedResonatorsById[ownerResonatorId] : null

  return {
    source,
    resonatorId: ownerResonatorId,
    resonatorName: ownerSeed?.name ?? null,
    feature,
    skill: skills.find((entry) => entry.id === feature.skillId) ?? null,
  }
}

export function resolveRotationFeatureMeta(node: RotationNode): RotationFeatureMeta | null {
  if (node.type !== 'feature') {
    return null
  }

  const directSources = getCandidateSources(node)
  for (const source of directSources) {
    const meta = resolveFeatureFromSource(node, source)
    if (meta) {
      return meta
    }
  }

  const seen = new Set(directSources.map(makeSourceKey))
  for (const source of listSources()) {
    if (seen.has(makeSourceKey(source))) {
      continue
    }

    const meta = resolveFeatureFromSource(node, source)
    if (meta) {
      return meta
    }
  }

  return null
}

export function getRotationFeaturePreviewKind(node: RotationNode): string | null {
  return node.type === 'feature' ? resolveRotationFeatureMeta(node)?.skill?.tab ?? 'feature' : null
}
