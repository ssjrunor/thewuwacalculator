/*
  Author: Runor Ewhro
  Description: Provides helpers and catalog data for negative effects,
               including archetype mapping, team visibility, and per-
               resonator display/max-stack overrides used by the ui.
*/

import { getResonatorDetailsById } from '@/data/gameData/resonators/resonatorDataStore'
import type {
  ResonatorNegativeEffectBehaviorEntry,
  ResonatorNegativeEffectSource,
  ResonatorNegativeEffectSourceEntry,
} from '@/domain/entities/resonator'
import type { CombatState, ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { SkillDefinition } from '@/domain/entities/stats'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { createDefaultResonatorRuntime } from '@/domain/state/defaults'
import { materializeTeamMemberFromCompactRuntime } from '@/domain/state/runtimeMaterialization'
import { evaluateCondition } from '@/engine/effects/evaluator'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'

export type NegativeEffectKey = keyof CombatState
export type NegativeEffectCombatKey = keyof Pick<
    CombatState,
    'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'
>

export interface NegativeEffectCatalogEntry {
  key: NegativeEffectKey
  label: string
  defaultMax: number
  accent: string
  linkedTo?: NegativeEffectKey
}

export interface ResolvedNegativeEffectEntry extends NegativeEffectCatalogEntry {
  max: number
  stackMode: 'manual' | 'fixedMax'
  sliderVisible: boolean
}

export const NEGATIVE_EFFECT_ORDER: NegativeEffectKey[] = [
  'spectroFrazzle',
  'aeroErosion',
  'fusionBurst',
  'havocBane',
  'glacioChafe',
  'electroFlare',
  'electroRage',
]

export const NEGATIVE_EFFECT_CATALOG: Record<NegativeEffectKey, NegativeEffectCatalogEntry> = {
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

export function getNegativeEffectDefaultMax(key: NegativeEffectKey): number {
  return NEGATIVE_EFFECT_CATALOG[key].defaultMax
}

function resolveEntryMax(entry: ResonatorNegativeEffectSourceEntry): number {
  return entry.max ?? NEGATIVE_EFFECT_CATALOG[entry.key].defaultMax
}

function resolveBehaviorEntry(
    current: ResonatorNegativeEffectBehaviorEntry | undefined,
    next: ResonatorNegativeEffectBehaviorEntry,
): ResonatorNegativeEffectBehaviorEntry {
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

function getEffectiveElectroFlareStacks(runtime: ResonatorRuntimeState, electroFlareMax: number): number {
  return Math.min(
    Math.max(0, Math.floor(runtime.state.combat.electroFlare ?? 0)),
    electroFlareMax,
  )
}

function getNegativeEffectSourcesForResonator(resonatorId: string): ResonatorNegativeEffectSource[] {
  return getResonatorDetailsById()[resonatorId]?.negativeEffectSources ?? []
}

function buildNegativeEffectSourceScope(
    sourceRuntime: ResonatorRuntimeState,
    activeRuntime: ResonatorRuntimeState,
) {
  const teamMemberIds = Array.from(
      new Set([
        activeRuntime.id,
        ...activeRuntime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
      ]),
  )

  return {
    sourceRuntime,
    targetRuntime: activeRuntime,
    activeRuntime,
    context: {
      team: buildTeamCompositionInfo(teamMemberIds),
      source: {
        type: 'resonator' as const,
        id: sourceRuntime.id,
        negativeEffectSources: getNegativeEffectSourcesForResonator(sourceRuntime.id),
      },
      target: {
        type: 'resonator' as const,
        id: activeRuntime.id,
        negativeEffectSources: getNegativeEffectSourcesForResonator(activeRuntime.id),
      },
      sourceRuntime,
      targetRuntime: activeRuntime,
      activeRuntime,
      targetRuntimeId: activeRuntime.id,
      activeResonatorId: activeRuntime.id,
      teamMemberIds,
      echoSetCounts: computeEchoSetCounts(sourceRuntime.build.echoes),
    },
  }
}

function isNegativeEffectSourceEnabled(
    sourceRuntime: ResonatorRuntimeState,
    activeRuntime: ResonatorRuntimeState,
    source: ResonatorNegativeEffectSource,
): boolean {
  return evaluateCondition(source.enabledWhen, buildNegativeEffectSourceScope(sourceRuntime, activeRuntime))
}

function resolveTeamSourceRuntime(
    activeRuntime: ResonatorRuntimeState,
    memberId: string,
): ResonatorRuntimeState | null {
  if (memberId === activeRuntime.id) {
    return activeRuntime
  }

  const compactTeamRuntime = activeRuntime.teamRuntimes.find((runtime) => runtime?.id === memberId)
  const seed = getResonatorSeedById(memberId)

  if (!seed) {
    return null
  }

  if (compactTeamRuntime) {
    return materializeTeamMemberFromCompactRuntime(
        seed,
        compactTeamRuntime,
        activeRuntime.state.controls,
        activeRuntime.state.combat,
        activeRuntime.build.team,
    )
  }

  const fallbackRuntime = createDefaultResonatorRuntime(seed)
  return {
    ...fallbackRuntime,
    build: {
      ...fallbackRuntime.build,
      team: activeRuntime.build.team,
    },
    state: {
      ...fallbackRuntime.state,
      combat: { ...activeRuntime.state.combat },
    },
  }
}

// resolve the visible negative effects for a team by scanning the resonator-
// keyed catalog and merging duplicate entries by highest max override
export function resolveNegativeEffectsForRuntime(runtime: ResonatorRuntimeState): ResolvedNegativeEffectEntry[] {
  const resolved = new Map<NegativeEffectKey, ResolvedNegativeEffectEntry>()
  const uniqueMemberIds = Array.from(
      new Set([runtime.id, ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )
  let globalMaxAdd = 0
  const keyedMaxAdds = new Map<NegativeEffectKey, number>()
  const behaviors = new Map<NegativeEffectKey, ResonatorNegativeEffectBehaviorEntry>()

  for (const memberId of uniqueMemberIds) {
    const entries = getNegativeEffectSourcesForResonator(memberId)
    const sourceRuntime = resolveTeamSourceRuntime(runtime, memberId)

    if (!sourceRuntime) {
      continue
    }

    for (const entry of entries) {
      if (!isNegativeEffectSourceEnabled(sourceRuntime, runtime, entry)) {
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
        behaviors.set(entry.key, resolveBehaviorEntry(behaviors.get(entry.key), entry))
        continue
      }

      const catalogEntry = NEGATIVE_EFFECT_CATALOG[entry.key]
      const current = resolved.get(entry.key)
      const nextMax = resolveEntryMax(entry)

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

  const electroFlareEntry = resolved.get('electroFlare')
  if (electroFlareEntry) {
    const effectiveElectroFlareStacks = getEffectiveElectroFlareStacks(runtime, electroFlareEntry.max)
    if (effectiveElectroFlareStacks > getNegativeEffectDefaultMax('electroFlare')) {
      const electroRageCatalogEntry = NEGATIVE_EFFECT_CATALOG.electroRage
      const current = resolved.get('electroRage')
      resolved.set('electroRage', {
        ...electroRageCatalogEntry,
        max: Math.max(current?.max ?? electroRageCatalogEntry.defaultMax, electroFlareEntry.max),
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

  return NEGATIVE_EFFECT_ORDER
    .map((key) => resolved.get(key))
    .filter((entry): entry is ResolvedNegativeEffectEntry => Boolean(entry))
}

export function getNegativeEffectEntryForRuntime(
    runtime: ResonatorRuntimeState,
    key: NegativeEffectKey,
): ResolvedNegativeEffectEntry | null {
  return resolveNegativeEffectsForRuntime(runtime).find((entry) => entry.key === key) ?? null
}

export function getNegativeEffectEffectiveStacks(
    runtime: ResonatorRuntimeState,
    key: NegativeEffectKey,
): number {
  const entry = getNegativeEffectEntryForRuntime(runtime, key)
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

export function normalizeNegativeEffectCombatState(
    runtime: ResonatorRuntimeState,
): CombatState {
  const resolvedEntries = resolveNegativeEffectsForRuntime(runtime)
  const entryByKey = new Map(resolvedEntries.map((entry) => [entry.key, entry]))
  const nextCombatState = { ...runtime.state.combat }

  for (const key of NEGATIVE_EFFECT_ORDER) {
    const currentValue = Math.max(0, Math.floor(nextCombatState[key] ?? 0))
    const resolvedEntry = entryByKey.get(key)

    if (!resolvedEntry) {
      nextCombatState[key] = 0
      continue
    }

    nextCombatState[key] = resolvedEntry.stackMode === 'fixedMax'
      ? resolvedEntry.max
      : Math.min(currentValue, resolvedEntry.max)
  }

  return nextCombatState
}

export function isNegativeEffectVisibleForRuntime(
    runtime: ResonatorRuntimeState,
    key: NegativeEffectKey,
): boolean {
  return resolveNegativeEffectsForRuntime(runtime).some((entry) => entry.key === key)
}

// map a negative effect archetype to its combat state key
export function getNegativeEffectCombatKey(
    archetype?: SkillDefinition['archetype'],
): NegativeEffectCombatKey | null {
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
export function getNegativeEffectAttribute(
    archetype?: SkillDefinition['archetype'],
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
