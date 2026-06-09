/*
  Author: Runor Ewhro
  Description: Builds and queries the game data registry used to organize
               sources, owners, states, effects, skills, features, and rotations.
*/

import type {
  CondDef,
  DataSrcRef,
  EffectDef,
  EffectBuckets,
  FeatDef,
  GameDataReg,
  RotDef,
  SrcOwnDef,
  SrcPkg,
  SourceState,
} from '@/domain/gameData/contracts'
import type { SkillDef } from '@/domain/entities/stats'
import { prmCompSrcPk, prmCompSttEx } from '@/engine/effects/evaluator'

const NO_OWNERS: SrcOwnDef[] = []
const NO_EFFECTS: EffectDef[] = []
const NO_EFFECT_SETS: EffectBuckets = {
  all: NO_EFFECTS,
  runtime: NO_EFFECTS,
  runtimePreStats: NO_EFFECTS,
  runtimePostStats: NO_EFFECTS,
  skill: NO_EFFECTS,
}
const NO_STATES: SourceState[] = []
const NO_CONDS: CondDef[] = []
const NO_FEATS: FeatDef[] = []
const NO_ROTS: RotDef[] = []
const NO_SKILLS: SkillDef[] = []

// create a stable registry key for a source
export function makeSourceKey(source: DataSrcRef): string {
  return `${source.type}:${source.id}`
}

// build the full game data registry from source packages
export function mkGameDataRe(
  sources: SrcPkg[],
  options: { resonatorStatesById?: Record<string, SourceState[]> } = {},
): GameDataReg {
  const resonatorStatesById = options.resonatorStatesById ?? {}
  const sourcesByKey: Record<string, SrcPkg> = {}
  const wnrsBySrcKey: Record<string, SrcOwnDef[]> = {}
  const ownersByKey: Record<string, SrcOwnDef> = {}
  const ffctBySrcKey: Record<string, EffectDef[]> = {}
  const ffctBktsBySr: Record<string, EffectBuckets> = {}
  const ffctByOwnKey: Record<string, EffectDef[]> = {}
  const sttsBySrcKey: Record<string, SourceState[]> = {}
  const sttsByOwnKey: Record<string, SourceState[]> = {}
  const sttsByCntrKe: Record<string, SourceState> = {}
  const condsBySrcKe: Record<string, CondDef[]> = {}
  const condsByOwnKe: Record<string, CondDef[]> = {}
  const featsBySrcKe: Record<string, FeatDef[]> = {}
  const rttnBySrcKey: Record<string, RotDef[]> = {}
  const skllBySrcKey: Record<string, SkillDef[]> = {}
  const resSkllById: Record<string, SkillDef[]> = {}
  const resFeatsById: Record<string, FeatDef[]> = {}
  const resRttnById: Record<string, RotDef[]> = {}

  for (const source of sources) {
    prmCompSrcPk(source)

    const key = makeSourceKey(source.source)

    if (sourcesByKey[key]) {
      throw new Error(`duplicate game-data source: ${key}`)
    }

    sourcesByKey[key] = source
    wnrsBySrcKey[key] = source.owners ?? NO_OWNERS
    const effects = source.effects ?? NO_EFFECTS
    const rtPreStts: EffectDef[] = []
    const rtPostStts: EffectDef[] = []
    const runtime: EffectDef[] = []
    const skill: EffectDef[] = []

    for (const effect of effects) {
      const hasSkillOp = effect.operations.some((op) =>
          op.type === 'add_skill_mod' ||
          op.type === 'add_skill_multiplier' ||
          op.type === 'add_skill_hit_multiplier' ||
          op.type === 'add_skill_scalar' ||
          op.type === 'scale_skill_multiplier',
      )

      if (effect.trigger === 'skill' || hasSkillOp) {
        skill.push(effect)
      }

      if (effect.trigger === 'runtime') {
        runtime.push(effect)

        if ((effect.stage ?? 'preStats') === 'postStats') {
          rtPostStts.push(effect)
        } else {
          rtPreStts.push(effect)
        }
      }
    }

    ffctBySrcKey[key] = effects
    ffctBktsBySr[key] = {
      all: effects,
      runtime,
      runtimePreStats: rtPreStts,
      runtimePostStats: rtPostStts,
      skill,
    }
    const states = source.states?.length
      ? source.states
      : source.source.type === 'resonator'
        ? resonatorStatesById[source.source.id] ?? NO_STATES
        : NO_STATES

    prmCompSttEx(states)
    sttsBySrcKey[key] = states
    condsBySrcKe[key] = source.conditions ?? NO_CONDS
    featsBySrcKe[key] = source.features ?? NO_FEATS
    rttnBySrcKey[key] = source.rotations ?? NO_ROTS
    skllBySrcKey[key] = source.skills ?? NO_SKILLS

    if (source.source.type === 'resonator') {
      resSkllById[source.source.id] = source.skills ?? NO_SKILLS
      resFeatsById[source.source.id] = source.features ?? NO_FEATS
      resRttnById[source.source.id] = source.rotations ?? NO_ROTS
    }
  }

  for (const source of sources) {
    for (const owner of source.owners ?? []) {
      if (ownersByKey[owner.ownerKey]) {
        throw new Error(`duplicate source owner key: ${owner.ownerKey}`)
      }

      ownersByKey[owner.ownerKey] = owner
    }
  }

  for (const source of sources) {
    const states = source.states?.length
      ? source.states
      : source.source.type === 'resonator'
        ? resonatorStatesById[source.source.id] ?? NO_STATES
        : NO_STATES

    for (const state of states) {
      if (!ownersByKey[state.ownerKey]) {
        throw new Error(`unknown state owner key: ${state.ownerKey}`)
      }

      if (sttsByCntrKe[state.controlKey]) {
        throw new Error(`duplicate state control key: ${state.controlKey}`)
      }

      sttsByCntrKe[state.controlKey] = state
      ;(sttsByOwnKey[state.ownerKey] ??= []).push(state)
    }

    for (const condition of source.conditions ?? []) {
      if (!condition.ownerKey) {
        continue
      }

      if (!ownersByKey[condition.ownerKey]) {
        throw new Error(`unknown condition owner key: ${condition.ownerKey}`)
      }

      ;(condsByOwnKe[condition.ownerKey] ??= []).push(condition)
    }

    for (const effect of source.effects ?? []) {
      if (!effect.ownerKey) {
        continue
      }

      if (!ownersByKey[effect.ownerKey]) {
        throw new Error(`unknown effect owner key: ${effect.ownerKey}`)
      }

      ;(ffctByOwnKey[effect.ownerKey] ??= []).push(effect)
    }
  }

  return {
    sourcesByKey,
    ownersBySourceKey: wnrsBySrcKey,
    ownersByKey,
    effectsBySourceKey: ffctBySrcKey,
    effectBucketsBySourceKey: ffctBktsBySr,
    effectsByOwnerKey: ffctByOwnKey,
    statesBySourceKey: sttsBySrcKey,
    statesByOwnerKey: sttsByOwnKey,
    statesByControlKey: sttsByCntrKe,
    conditionsBySourceKey: condsBySrcKe,
    conditionsByOwnerKey: condsByOwnKe,
    featuresBySourceKey: featsBySrcKe,
    rotationsBySourceKey: rttnBySrcKey,
    skillsBySourceKey: skllBySrcKey,
    resonatorSkillsById: resSkllById,
    resonatorFeaturesById: resFeatsById,
    resonatorRotationsById: resRttnById,
  }
}

// list effects for a source, optionally filtered by trigger
export function listEffects(
    registry: GameDataReg,
    source: DataSrcRef,
    trigger?: EffectDef['trigger'],
): EffectDef[] {
  const effects = registry.effectsBySourceKey[makeSourceKey(source)] ?? NO_EFFECTS

  if (!trigger) {
    return effects
  }

  const buckets = registry.effectBucketsBySourceKey[makeSourceKey(source)] ?? NO_EFFECT_SETS
  return trigger === 'skill' ? buckets.skill : buckets.runtime
}

// list staged runtime effects for a source
export function listSrcRtFfc(
    registry: GameDataReg,
    source: DataSrcRef,
    stage: 'preStats' | 'postStats',
): EffectDef[] {
  const buckets = registry.effectBucketsBySourceKey[makeSourceKey(source)] ?? NO_EFFECT_SETS
  return stage === 'postStats' ? buckets.runtimePostStats : buckets.runtimePreStats
}

// list states for a source
export function listSrcStts(
    registry: GameDataReg,
    source: DataSrcRef,
): SourceState[] {
  return registry.statesBySourceKey[makeSourceKey(source)] ?? NO_STATES
}

// list owners for a source
export function listSrcWnrs(
    registry: GameDataReg,
    source: DataSrcRef,
): SrcOwnDef[] {
  return registry.ownersBySourceKey[makeSourceKey(source)] ?? NO_OWNERS
}

// list conditions for a source
export function listSrcConds(
    registry: GameDataReg,
    source: DataSrcRef,
): CondDef[] {
  return registry.conditionsBySourceKey[makeSourceKey(source)] ?? NO_CONDS
}

// get a source owner by owner key
export function getSrcOwnByK(
    registry: GameDataReg,
    ownerKey: string,
): SrcOwnDef | null {
  return registry.ownersByKey[ownerKey] ?? null
}

// list effects attached to an owner key
export function listFfctByOw(
    registry: GameDataReg,
    ownerKey: string,
): EffectDef[] {
  return registry.effectsByOwnerKey[ownerKey] ?? NO_EFFECTS
}

// list states attached to an owner key
export function listSttsByOw(
    registry: GameDataReg,
    ownerKey: string,
): SourceState[] {
  return registry.statesByOwnerKey[ownerKey] ?? NO_STATES
}

// get a state definition by its control key
export function getSttByCntr(
    registry: GameDataReg,
    controlKey: string,
): SourceState | null {
  return registry.statesByControlKey[controlKey] ?? null
}

// list conditions attached to an owner key
export function listCondsByO(
    registry: GameDataReg,
    ownerKey: string,
): CondDef[] {
  return registry.conditionsByOwnerKey[ownerKey] ?? NO_CONDS
}

// get all resonator skills by resonator id
export function getResSkll(
    registry: GameDataReg,
    resonatorId: string,
): SkillDef[] {
  return registry.resonatorSkillsById[resonatorId] ?? NO_SKILLS
}

// list all skills for a source
export function listSrcSkll(
    registry: GameDataReg,
    source: DataSrcRef,
): SkillDef[] {
  return registry.skillsBySourceKey[makeSourceKey(source)] ?? NO_SKILLS
}

// list all features for a source
export function listSrcFeats(
    registry: GameDataReg,
    source: DataSrcRef,
): FeatDef[] {
  return registry.featuresBySourceKey[makeSourceKey(source)] ?? NO_FEATS
}

// list all rotations for a source
export function listSrcRttn(
    registry: GameDataReg,
    source: DataSrcRef,
): RotDef[] {
  return registry.rotationsBySourceKey[makeSourceKey(source)] ?? NO_ROTS
}

// get all resonator features by resonator id
export function getResFeats(
    registry: GameDataReg,
    resonatorId: string,
): FeatDef[] {
  return registry.resonatorFeaturesById[resonatorId] ?? NO_FEATS
}

// get all resonator rotations by resonator id
export function getResRttn(
    registry: GameDataReg,
    resonatorId: string,
): RotDef[] {
  return registry.resonatorRotationsById[resonatorId] ?? NO_ROTS
}
