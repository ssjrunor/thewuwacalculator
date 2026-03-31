/*
  Author: Runor Ewhro
  Description: Builds and caches runtime source catalogs for resonator and
               main echo sources, including skills, features, and states.
*/

import type {
  DataSourceRef,
  FeatureDefinition,
  SourceStateDefinition,
} from '@/domain/gameData/contracts'
import type { ResonatorRuntimeState, ResonatorSeed } from '@/domain/entities/runtime'
import type { SkillDefinition } from '@/domain/entities/stats'
import {
  listFeaturesForSource,
  listSkillsForSource,
  listStatesForSource,
} from '@/domain/services/gameDataService'

export interface RuntimeSourceCatalog {
  sources: DataSourceRef[]
  skills: SkillDefinition[]
  features: FeatureDefinition[]
  states: SourceStateDefinition[]
  skillsById: Record<string, SkillDefinition>
  featuresById: Record<string, FeatureDefinition>
}

export type PreparedRuntimeCatalog = RuntimeSourceCatalog

const sourceRefsCache = new Map<string, DataSourceRef[]>()
const runtimeSourceCatalogCache = new Map<string, RuntimeSourceCatalog>()
const MAX_RUNTIME_SOURCE_CACHE_ENTRIES = 64

function touchCacheEntry<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.has(key)) {
    cache.delete(key)
  }

  cache.set(key, value)

  while (cache.size > MAX_RUNTIME_SOURCE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey == null) {
      break
    }

    cache.delete(oldestKey)
  }
}

// build a cache signature for runtime sources
function getRuntimeSourceSignature(runtime: ResonatorRuntimeState): string {
  return `${runtime.id}::${runtime.build.echoes[0]?.id ?? ''}`
}

// resolve the main echo source reference from the runtime
export function getMainEchoSourceRef(runtime: ResonatorRuntimeState): DataSourceRef | null {
  const echoId = runtime.build.echoes[0]?.id
  return echoId ? { type: 'echo', id: echoId } : null
}

// list all source references relevant to the runtime
export function listRuntimeSourceRefs(runtime: ResonatorRuntimeState): DataSourceRef[] {
  const signature = getRuntimeSourceSignature(runtime)
  const cached = sourceRefsCache.get(signature)
  if (cached) {
    return cached
  }

  const refs: DataSourceRef[] = [{ type: 'resonator', id: runtime.id }]
  const mainEchoSource = getMainEchoSourceRef(runtime)

  if (mainEchoSource) {
    refs.push(mainEchoSource)
  }

  touchCacheEntry(sourceRefsCache, signature, refs)
  return refs
}

// build the full runtime source catalog
export function buildRuntimeSourceCatalog(runtime: ResonatorRuntimeState): RuntimeSourceCatalog {
  const signature = getRuntimeSourceSignature(runtime)
  const cached = runtimeSourceCatalogCache.get(signature)
  if (cached) {
    return cached
  }

  const sources = listRuntimeSourceRefs(runtime)
  const skills = sources.flatMap((source) => listSkillsForSource(source.type, source.id))
  const features = sources.flatMap((source) => listFeaturesForSource(source.type, source.id))
  const states = sources.flatMap((source) => listStatesForSource(source.type, source.id))

  const catalog = {
    sources,
    skills,
    features,
    states,
    skillsById: Object.fromEntries(skills.map((skill) => [skill.id, skill])),
    featuresById: Object.fromEntries(features.map((feature) => [feature.id, feature])),
  }

  touchCacheEntry(runtimeSourceCatalogCache, signature, catalog)
  return catalog
}

// merge runtime-derived and seed-local content into one canonical catalog
export function buildPreparedRuntimeCatalog(
    runtime: ResonatorRuntimeState,
    seed?: ResonatorSeed | null,
): PreparedRuntimeCatalog {
  const catalog = buildRuntimeSourceCatalog(runtime)

  if (!seed || (!seed.skills?.length && !seed.features?.length && !seed.states?.length)) {
    return catalog
  }

  const skills = [...catalog.skills]
  const features = [...catalog.features]
  const states = [...catalog.states]
  const skillsById = { ...catalog.skillsById }
  const featuresById = { ...catalog.featuresById }

  for (const skill of seed.skills ?? []) {
    if (skillsById[skill.id]) {
      continue
    }

    skills.push(skill)
    skillsById[skill.id] = skill
  }

  for (const feature of seed.features ?? []) {
    if (featuresById[feature.id]) {
      continue
    }

    features.push(feature)
    featuresById[feature.id] = feature
  }

  for (const state of seed.states ?? []) {
    if (states.some((entry) => entry.controlKey === state.controlKey)) {
      continue
    }

    states.push(state)
  }

  return {
    ...catalog,
    skills,
    features,
    states,
    skillsById,
    featuresById,
  }
}

// list all runtime skills
export function listRuntimeSkills(runtime: ResonatorRuntimeState): SkillDefinition[] {
  return buildRuntimeSourceCatalog(runtime).skills
}
