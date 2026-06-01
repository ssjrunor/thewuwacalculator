/*
  Author: Runor Ewhro
  Description: Provides helpers and catalog data for negative effects,
               including archetype mapping, team visibility, and per-
               resonator display/max-stack overrides used by the ui.
*/

import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import type {
  ResNegFfctBh,
  ResNegFfcthn,
  ResNegFfctSr,
} from '@/domain/entities/resonator'
import type { CombatState, ResRuntime } from '@/domain/entities/runtime'
import type { AttributeKey, SkillDef } from '@/domain/entities/stats'
import { makeTeamComp } from '@/domain/gameData/teamComposition'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { makeResRuntime } from '@/domain/state/defaults'
import { matTeamMemFr } from '@/domain/state/runtimeMaterialization'
import { evalCond } from '@/engine/effects/evaluator'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'

export type NegEffectKey = keyof CombatState
export type NegFfctCmbtK = keyof Pick<
    CombatState,
    'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'
>

export interface NegEffectCat {
  key: NegEffectKey
  label: string
  defaultMax: number
  accent: string
  linkedTo?: NegEffectKey
}

export interface RslvNegFfctE extends NegEffectCat {
  max: number
  stackMode: 'manual' | 'fixedMax'
  sliderVisible: boolean
}

// canonical element behind each negative-effect archetype. Used by the damage
// pipeline (resistance lookup) and the enemy UI (element icon / accent).
export const NEG_EFFECT_ELEM: Record<NegEffectKey, AttributeKey> = {
  spectroFrazzle: 'spectro',
  aeroErosion: 'aero',
  fusionBurst: 'fusion',
  havocBane: 'havoc',
  glacioChafe: 'glacio',
  electroFlare: 'electro',
  electroRage: 'electro',
}

export const NEG_EFFECT_KEYS: NegEffectKey[] = [
  'spectroFrazzle',
  'aeroErosion',
  'fusionBurst',
  'havocBane',
  'glacioChafe',
  'electroFlare',
  'electroRage',
]

export const NEG_EFFECT_CATS: Record<NegEffectKey, NegEffectCat> = {
  spectroFrazzle: {
    key: 'spectroFrazzle',
    label: 'Spectro Frazzle',
    defaultMax: 10,
    accent: 'rgb(202,179,63)',
  },
  aeroErosion: {
    key: 'aeroErosion',
    label: 'Aero Erosion',
    defaultMax: 3,
    accent: 'rgb(15,205,160)',
  },
  fusionBurst: {
    key: 'fusionBurst',
    label: 'Fusion Burst',
    defaultMax: 10,
    accent: 'rgb(197,52,79)',
  },
  havocBane: {
    key: 'havocBane',
    label: 'Havoc Bane',
    defaultMax: 3,
    accent: 'rgb(172,9,96)',
  },
  glacioChafe: {
    key: 'glacioChafe',
    label: 'Glacio Chafe',
    defaultMax: 10,
    accent: 'rgb(62,189,227)',
  },
  electroFlare: {
    key: 'electroFlare',
    label: 'Electro Flare',
    defaultMax: 10,
    accent: 'rgb(167,13,209)',
  },
  electroRage: {
    key: 'electroRage',
    label: 'Electro Rage',
    defaultMax: 10,
    accent: 'rgb(167,13,209)',
    linkedTo: 'electroFlare',
  },
}

export function getNegEffectDef(key: NegEffectKey): number {
  return NEG_EFFECT_CATS[key].defaultMax
}

export function getNegFfctqf(key: NegEffectKey): string {
  return NEG_EFFECT_CATS[key].label
}

function resEntMax(entry: ResNegFfctSr): number {
  return entry.max ?? NEG_EFFECT_CATS[entry.key].defaultMax
}

function resBhvrEnt(
    current: ResNegFfctBh | undefined,
    next: ResNegFfctBh,
): ResNegFfctBh {
  if (!current) {
    return next
  }

  return {
    ...current,
    ...next,
    stackMode: current.stackMode === 'fixedMax' || next.stackMode === 'fixedMax'
      ? 'fixedMax'
      : next.stackMode ?? current.stackMode,
    label: next.label ?? current.label,
  }
}

function getFfctLctrF(runtime: ResRuntime, lctrFlrMax: number): number {
  return Math.min(
    Math.max(0, Math.floor(runtime.state.combat.electroFlare ?? 0)),
    lctrFlrMax,
  )
}

function getNegFfctSr(resonatorId: string): ResNegFfcthn[] {
  return getResDtlsBy()[resonatorId]?.negativeEffectSources ?? []
}

function mkNegFfctSrc(
    srcRt: ResRuntime,
    actRt: ResRuntime,
) {
  const teamMemIds = Array.from(
      new Set([
        actRt.id,
        ...actRt.build.team.filter((memberId): memberId is string => Boolean(memberId)),
      ]),
  )

  return {
    sourceRuntime: srcRt,
    targetRuntime: actRt,
    activeRuntime: actRt,
    context: {
      team: makeTeamComp(teamMemIds),
      source: {
        type: 'resonator' as const,
        id: srcRt.id,
        negativeEffectSources: getNegFfctSr(srcRt.id),
      },
      target: {
        type: 'resonator' as const,
        id: actRt.id,
        negativeEffectSources: getNegFfctSr(actRt.id),
      },
      sourceRuntime: srcRt,
      targetRuntime: actRt,
      activeRuntime: actRt,
      targetRuntimeId: actRt.id,
      activeResonatorId: actRt.id,
      teamMemberIds: teamMemIds,
      echoSetCounts: countEchoSets(srcRt.build.echoes),
    },
  }
}

function isNegFfctSrc(
    srcRt: ResRuntime,
    actRt: ResRuntime,
    source: ResNegFfcthn,
): boolean {
  return evalCond(source.enabledWhen, mkNegFfctSrc(srcRt, actRt))
}

function resTeamSrcRt(
    actRt: ResRuntime,
    memberId: string,
): ResRuntime | null {
  if (memberId === actRt.id) {
    return actRt
  }

  const cmpcTeamRt = actRt.teamRuntimes.find((runtime) => runtime?.id === memberId)
  const seed = getResSeedBy(memberId)

  if (!seed) {
    return null
  }

  if (cmpcTeamRt) {
    return matTeamMemFr(
        seed,
        cmpcTeamRt,
        actRt.state.controls,
        actRt.state.combat,
        actRt.build.team,
    )
  }

  const fllbRt = makeResRuntime(seed)
  return {
    ...fllbRt,
    build: {
      ...fllbRt.build,
      team: actRt.build.team,
    },
    state: {
      ...fllbRt.state,
      combat: { ...actRt.state.combat },
    },
  }
}

// resolve the visible negative effects for a team by scanning the resonator-
// keyed catalog and merging duplicate entries by highest max override
export function negEffectsFor(runtime: ResRuntime): RslvNegFfctE[] {
  const resolved = new Map<NegEffectKey, RslvNegFfctE>()
  const nqMemIds = Array.from(
      new Set([runtime.id, ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )
  let globalMaxAdd = 0
  const keyedMaxAdds = new Map<NegEffectKey, number>()
  const behaviors = new Map<NegEffectKey, ResNegFfctBh>()

  for (const memberId of nqMemIds) {
    const entries = getNegFfctSr(memberId)
    const srcRt = resTeamSrcRt(runtime, memberId)

    if (!srcRt) {
      continue
    }

    for (const entry of entries) {
      if (!isNegFfctSrc(srcRt, runtime, entry)) {
        continue
      }

      if ('type' in entry && entry.type === 'maxAdd') {
        keyedMaxAdds.set(
          entry.key,
          (keyedMaxAdds.get(entry.key) ?? 0) + Math.max(0, Math.floor(entry.value)),
        )
        continue
      }

      if ('type' in entry && entry.type === 'globalMaxAdd') {
        globalMaxAdd += Math.max(0, Math.floor(entry.value))
        continue
      }

      if ('type' in entry && entry.type === 'behavior') {
        behaviors.set(entry.key, resBhvrEnt(behaviors.get(entry.key), entry))
        continue
      }

      const catalogEntry = NEG_EFFECT_CATS[entry.key]
      const current = resolved.get(entry.key)
      const nextMax = resEntMax(entry)

      resolved.set(entry.key, {
        ...catalogEntry,
        max: current ? Math.max(current.max, nextMax) : nextMax,
        stackMode: current?.stackMode ?? 'manual',
        sliderVisible: current?.sliderVisible ?? true,
      })
    }
  }

  if (keyedMaxAdds.size > 0) {
    for (const [key, value] of keyedMaxAdds.entries()) {
      const entry = resolved.get(key)
      if (!entry) {
        continue
      }

      resolved.set(key, {
        ...entry,
        max: entry.max + value,
      })
    }
  }

  if (globalMaxAdd > 0) {
    for (const [key, entry] of resolved.entries()) {
      resolved.set(key, {
        ...entry,
        max: entry.max + globalMaxAdd,
      })
    }
  }

  const lctrFlrEnt = resolved.get('electroFlare')
  if (lctrFlrEnt) {
    const ffctLctrFlrS = getFfctLctrF(runtime, lctrFlrEnt.max)
    if (ffctLctrFlrS > getNegEffectDef('electroFlare')) {
      const electroRageCat = NEG_EFFECT_CATS.electroRage
      const current = resolved.get('electroRage')
      resolved.set('electroRage', {
        ...electroRageCat,
        max: Math.max(current?.max ?? electroRageCat.defaultMax, lctrFlrEnt.max),
        stackMode: current?.stackMode ?? 'manual',
        sliderVisible: current?.sliderVisible ?? true,
      })
    } else {
      resolved.delete('electroRage')
    }
  }

  for (const [key, behavior] of behaviors.entries()) {
    const entry = resolved.get(key)
    if (!entry) {
      continue
    }

    const stackMode = behavior.stackMode === 'fixedMax' ? 'fixedMax' : entry.stackMode
    resolved.set(key, {
      ...entry,
      label: behavior.label ?? entry.label,
      stackMode,
      sliderVisible: stackMode !== 'fixedMax',
    })
  }

  return NEG_EFFECT_KEYS
    .map((key) => resolved.get(key))
    .filter((entry): entry is RslvNegFfctE => Boolean(entry))
}

export function getNegFfctEn(
    runtime: ResRuntime,
    key: NegEffectKey,
): RslvNegFfctE | null {
  return negEffectsFor(runtime).find((entry) => entry.key === key) ?? null
}

export function getNegFfctFf(
    runtime: ResRuntime,
    key: NegEffectKey,
): number {
  const entry = getNegFfctEn(runtime, key)
  if (!entry) {
    return 0
  }

  if (entry.stackMode === 'fixedMax') {
    return entry.max
  }

  return Math.min(
    Math.max(0, Math.floor(runtime.state.combat[key] ?? 0)),
    entry.max,
  )
}

export function normNegFfctC(
    runtime: ResRuntime,
): CombatState {
  const rslvEnts = negEffectsFor(runtime)
  const entryByKey = new Map(rslvEnts.map((entry) => [entry.key, entry]))
  const nextCmbtStt = { ...runtime.state.combat }

  for (const key of NEG_EFFECT_KEYS) {
    const currentValue = Math.max(0, Math.floor(nextCmbtStt[key] ?? 0))
    const rslvEnt = entryByKey.get(key)

    if (!rslvEnt) {
      nextCmbtStt[key] = 0
      continue
    }

    nextCmbtStt[key] = rslvEnt.stackMode === 'fixedMax'
      ? rslvEnt.max
      : Math.min(currentValue, rslvEnt.max)
  }

  return nextCmbtStt
}

export function isNegFfctVsb(
    runtime: ResRuntime,
    key: NegEffectKey,
): boolean {
  return negEffectsFor(runtime).some((entry) => entry.key === key)
}

// map a negative effect archetype to its combat state key
export function getNegFfctCm(
    archetype?: SkillDef['archetype'],
): NegFfctCmbtK | null {
  switch (archetype) {
    case 'spectroFrazzle':
    case 'aeroErosion':
    case 'fusionBurst':
    case 'glacioChafe':
    case 'electroFlare':
      return archetype
    default:
      return null
  }
}

// map a negative effect archetype to its elemental attribute
export function getNegFfctTt(
    archetype?: SkillDef['archetype'],
): 'spectro' | 'aero' | 'fusion' | 'glacio' | 'electro' | null {
  switch (archetype) {
    case 'spectroFrazzle':
      return 'spectro'
    case 'aeroErosion':
      return 'aero'
    case 'fusionBurst':
      return 'fusion'
    case 'glacioChafe':
      return 'glacio'
    case 'electroFlare':
      return 'electro'
    default:
      return null
  }
}
