/*
  author: runor ewhro
  description: resolves rotation feature nodes back to catalog skill metadata.
*/

import type { DataSrcRef, FeatDef, RotationNode } from '@/domain/gameData/contracts.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'
import {
  listFeatsFor,
  listResFeats,
  listResSkll,
  listSkillsFor,
  listSources,
} from '@/domain/services/gameDataService.ts'

export interface Features {
  source: DataSrcRef
  resonatorId: string | null
  resName: string | null
  feature: FeatDef
  skill: SkillDef | null
}

function getMbddEchoS(featureId: string): DataSrcRef | null {
  const match = /^echo:([^:]+):/.exec(featureId)
  return match ? { type: 'echo', id: match[1] } : null
}

function makeSourceKey(source: DataSrcRef): string {
  return `${source.type}:${source.id}`
}

function getCandSrcs(node: Extract<RotationNode, { type: 'feature' }>): DataSrcRef[] {
  const sources: DataSrcRef[] = []
  const seen = new Set<string>()

  const push = (source: DataSrcRef | null) => {
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

  push(getMbddEchoS(node.featureId))

  return sources
}

function resFeatFromS(
  node: Extract<RotationNode, { type: 'feature' }>,
  source: DataSrcRef,
): Features | null {
  const features = source.type === 'resonator'
    ? listResFeats(source.id)
    : listFeatsFor(source.type, source.id)
  const feature = features.find((entry) => entry.id === node.featureId)
  if (!feature) {
    return null
  }

  const skills = source.type === 'resonator'
    ? listResSkll(source.id)
    : listSkillsFor(source.type, source.id)
  const ownResId = node.resonatorId ?? (source.type === 'resonator' ? source.id : null)
  const ownerSeed = ownResId ? seedRsntById[ownResId] : null

  return {
    source,
    resonatorId: ownResId,
    resName: ownerSeed?.name ?? null,
    feature,
    skill: skills.find((entry) => entry.id === feature.skillId) ?? null,
  }
}

export function featureMeta(node: RotationNode): Features | null {
  if (node.type !== 'feature') {
    return null
  }

  const drctSrcs = getCandSrcs(node)
  for (const source of drctSrcs) {
    const meta = resFeatFromS(node, source)
    if (meta) {
      return meta
    }
  }

  const seen = new Set(drctSrcs.map(makeSourceKey))
  for (const source of listSources()) {
    if (seen.has(makeSourceKey(source))) {
      continue
    }

    const meta = resFeatFromS(node, source)
    if (meta) {
      return meta
    }
  }

  return null
}

export function previewKind(node: RotationNode): string | null {
  return node.type === 'feature' ? featureMeta(node)?.skill?.tab ?? 'feature' : null
}
