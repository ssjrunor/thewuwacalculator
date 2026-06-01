/*
  Author: Runor Ewhro
  Description: Provides convenient game data service helpers for listing
               skills, effects, states, owners, features, rotations, and sources.
*/

import { getGameData } from '@/data/gameData'
import {
  getSrcOwnByK,
  getSttByCntr,
  getResFeats,
  getResRttn,
  getResSkll,
  listCondsByO,
  listSrcConds,
  listEffects,
  listSrcFeats,
  listSrcWnrs,
  listSrcRttn,
  listSrcSkll,
  listSrcStts,
  listFfctByOw,
  listSttsByOw,
} from '@/domain/gameData/registry'
import type {
  CondDef,
  DataSrcRef,
  DataSrcType,
  EffectDef,
  FeatDef,
  RotDef,
  SrcOwnDef,
  SourceState,
} from '@/domain/gameData/contracts'
import type { SkillDef } from '@/domain/entities/stats'

// list all skills for a given source
export function listSkillsFor(
    sourceType: DataSrcType,
    sourceId: string,
): SkillDef[] {
  return listSrcSkll(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list effects for a given source, optionally filtered by trigger
export function listEffectsFor(
    sourceType: DataSrcType,
    sourceId: string,
    trigger?: EffectDef['trigger'],
): EffectDef[] {
  return listEffects(
      getGameData(),
      {
        type: sourceType,
        id: sourceId,
      },
      trigger,
  )
}

// list conditions for a given source
export function listCondsFor(
    sourceType: DataSrcType,
    sourceId: string,
): CondDef[] {
  return listSrcConds(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list states for a given source
export function listStatesFor(
    sourceType: DataSrcType,
    sourceId: string,
): SourceState[] {
  return listSrcStts(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list owners for a given source
export function listOwnersFor(
    sourceType: DataSrcType,
    sourceId: string,
): SrcOwnDef[] {
  return listSrcWnrs(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list features for a given source
export function listFeatsFor(
    sourceType: DataSrcType,
    sourceId: string,
): FeatDef[] {
  return listSrcFeats(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list rotations for a given source
export function listRttnForS(
    sourceType: DataSrcType,
    sourceId: string,
): RotDef[] {
  return listSrcRttn(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list all features for a resonator
export function listResFeats(resonatorId: string): FeatDef[] {
  return getResFeats(getGameData(), resonatorId)
}

// list all skills for a resonator
export function listResSkll(resonatorId: string): SkillDef[] {
  return getResSkll(getGameData(), resonatorId)
}

// list all rotations for a resonator
export function listResRttn(resonatorId: string): RotDef[] {
  return getResRttn(getGameData(), resonatorId)
}

// get an owner definition by owner key
export function getOwnForKey(ownerKey: string): SrcOwnDef | null {
  return getSrcOwnByK(getGameData(), ownerKey)
}

// list effects for an owner key
export function listFfctForO(ownerKey: string): EffectDef[] {
  return listFfctByOw(getGameData(), ownerKey)
}

// list states for an owner key
export function listSttsForO(ownerKey: string): SourceState[] {
  return listSttsByOw(getGameData(), ownerKey)
}

// get a state definition by control key
export function getSttForCnt(controlKey: string): SourceState | null {
  return getSttByCntr(getGameData(), controlKey)
}

// list conditions for an owner key
export function listCondsFvd(ownerKey: string): CondDef[] {
  return listCondsByO(getGameData(), ownerKey)
}

// list all registered sources, optionally filtered by type
export function listSources(sourceType?: DataSrcType): DataSrcRef[] {
  const gameData = getGameData()

  return Object.values(gameData.sourcesByKey)
      .filter((source) => !sourceType || source.source.type === sourceType)
      .map((source) => source.source)
}