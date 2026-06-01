/*
  Author: Runor Ewhro
  Description: Builds and caches runtime source catalogs for resonator and
               main echo sources, including skills, features, and states.
*/

import type {
  DataSrcRef,
  FeatDef,
  SourceState,
} from '@/domain/gameData/contracts'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import type { SkillDef } from '@/domain/entities/stats'
import {
  listFeatsFor,
  listSkillsFor,
  listStatesFor,
} from '@/domain/services/gameDataService'
import {
  prmCompFeatE,
  prmCompSkllE,
  prmCompSttEx,
} from '@/engine/effects/evaluator'

export interface RtSrcCat {
  sources: DataSrcRef[]
  skills: SkillDef[]
  features: FeatDef[]
  states: SourceState[]
  skillsById: Record<string, SkillDef>
  featuresById: Record<string, FeatDef>
}

export type PrepRtCat = RtSrcCat

const srcRefsCch = new Map<string, DataSrcRef[]>()
const rtSrcCatCch = new Map<string, RtSrcCat>()
const prepRtCatCch = new WeakMap<ResSeed, Map<string, PrepRtCat>>()
const SRC_CACHE_MAX = 64

function isQppdEcho(
    echo: ResRuntime['build']['echoes'][number],
): echo is NonNullable<ResRuntime['build']['echoes'][number]> {
  return Boolean(echo)
}

function tchCchEnt<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.has(key)) {
    cache.delete(key)
  }

  cache.set(key, value)

  while (cache.size > SRC_CACHE_MAX) {
    const oldestKey = cache.keys().next().value
    if (oldestKey == null) {
      break
    }

    cache.delete(oldestKey)
  }
}

// build a cache signature for runtime sources
function getRtSrcSig(runtime: ResRuntime): string {
  const mainEchoId =
      runtime.build.echoes.find((echo) => echo?.mainEcho)?.id ??
      runtime.build.echoes[0]?.id ??
      runtime.build.echoes.find(isQppdEcho)?.id ??
      ''
  return `${runtime.id}::${mainEchoId}`
}

// resolve the main echo source reference from the runtime
export function getMainEchoS(runtime: ResRuntime): DataSrcRef | null {
  const echoId =
      runtime.build.echoes.find((echo) => echo?.mainEcho)?.id ??
      runtime.build.echoes[0]?.id ??
      runtime.build.echoes.find(isQppdEcho)?.id
  return echoId ? { type: 'echo', id: echoId } : null
}

function getPrepRtCat(
    seed: ResSeed,
): Map<string, PrepRtCat> {
  const cached = prepRtCatCch.get(seed)
  if (cached) {
    return cached
  }

  const created = new Map<string, PrepRtCat>()
  prepRtCatCch.set(seed, created)
  return created
}

// list all source references relevant to the runtime
export function listRtSrcRef(runtime: ResRuntime): DataSrcRef[] {
  const signature = getRtSrcSig(runtime)
  const cached = srcRefsCch.get(signature)
  if (cached) {
    return cached
  }

  const refs: DataSrcRef[] = [{ type: 'resonator', id: runtime.id }]
  const mainEchoSrc = getMainEchoS(runtime)

  if (mainEchoSrc) {
    refs.push(mainEchoSrc)
  }

  tchCchEnt(srcRefsCch, signature, refs)
  return refs
}

// build the full runtime source catalog
export function makeSourceCat(runtime: ResRuntime): RtSrcCat {
  const signature = getRtSrcSig(runtime)
  const cached = rtSrcCatCch.get(signature)
  if (cached) {
    return cached
  }

  const sources = listRtSrcRef(runtime)
  const skills = sources.flatMap((source) => listSkillsFor(source.type, source.id))
  const features = sources.flatMap((source) => listFeatsFor(source.type, source.id))
  const states = sources.flatMap((source) => listStatesFor(source.type, source.id))

  const catalog = {
    sources,
    skills,
    features,
    states,
    skillsById: Object.fromEntries(skills.map((skill) => [skill.id, skill])),
    featuresById: Object.fromEntries(features.map((feature) => [feature.id, feature])),
  }

  tchCchEnt(rtSrcCatCch, signature, catalog)
  return catalog
}

// merge runtime-derived and seed-local content into one canonical catalog
export function makeRuntimeCat(
    runtime: ResRuntime,
    seed?: ResSeed | null,
): PrepRtCat {
  const catalog = makeSourceCat(runtime)

  if (!seed || (!seed.skills?.length && !seed.features?.length && !seed.states?.length)) {
    return catalog
  }

  const signature = getRtSrcSig(runtime)
  const prepCch = getPrepRtCat(seed)
  const cached = prepCch.get(signature)
  if (cached) {
    return cached
  }

  prmCompSkllE(seed.skills ?? [])
  prmCompFeatE(seed.features ?? [])
  prmCompSttEx(seed.states ?? [])

  const skills = [...catalog.skills]
  const features = [...catalog.features]
  const states = [...catalog.states]
  const skillsById = { ...catalog.skillsById }
  const featuresById = { ...catalog.featuresById }
  const sttCntrKeys = new Set(states.map((entry) => entry.controlKey))

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
    if (sttCntrKeys.has(state.controlKey)) {
      continue
    }

    states.push(state)
    sttCntrKeys.add(state.controlKey)
  }

  const prepared = {
    ...catalog,
    skills,
    features,
    states,
    skillsById,
    featuresById,
  }

  tchCchEnt(prepCch, signature, prepared)
  return prepared
}

// list all runtime skills
export function listRtSkills(runtime: ResRuntime): SkillDef[] {
  return makeSourceCat(runtime).skills
}
