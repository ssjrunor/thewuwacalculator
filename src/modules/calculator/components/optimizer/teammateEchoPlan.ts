import type { EchoInstance } from '@/domain/entities/runtime'
import type { RandomGeneratorSetPreference } from '@/domain/entities/suggestions'
import { getEchoSetDef } from '@/data/gameData/echoSets/effects'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { makeDefaultEchoInstance } from '@/modules/calculator/model/echoPane'
import {
  getRandomSetCountOptions,
  normalizeRandomSetPreferenceCount,
  trimRandomSetPreferences,
} from '@/modules/calculator/model/suggestions'

export interface TeammateEchoPlan {
  mainEchoMode: 'inherit' | 'selected'
  mainEchoId: string | null
  setMode: 'inherit' | 'selected'
  setPreferences: RandomGeneratorSetPreference[]
}

export interface ResolvedTeammateEchoPlan {
  plan: TeammateEchoPlan
  effectiveEchoes: Array<EchoInstance | null>
  invalidMainEchoId: string | null
}

function normalizeEchoLoadout(
  echoes: ReadonlyArray<EchoInstance | null | undefined>,
): Array<EchoInstance | null> {
  const out: Array<EchoInstance | null> = [null, null, null, null, null]
  for (let index = 0; index < out.length; index += 1) {
    out[index] = echoes[index] ?? null
  }
  return out
}

function makeSyntheticSetEcho(setId: number, slotIndex: number): EchoInstance {
  return {
    uid: `optimizer-set:${setId}:${slotIndex}`,
    id: `optimizer-set:${setId}:${slotIndex}`,
    set: setId,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { key: 'atkPercent', value: 0 },
      secondary: { key: 'atkFlat', value: 0 },
    },
    substats: {},
  }
}

function expandSetPreferenceTargets(
  preferences: RandomGeneratorSetPreference[],
): number[] {
  return preferences.flatMap((entry) => Array.from({ length: entry.count }, () => entry.setId))
}

function deriveSetPreferencesFromEchoes(
  echoes: ReadonlyArray<EchoInstance | null | undefined>,
): RandomGeneratorSetPreference[] {
  const counts = computeEchoSetCounts(normalizeEchoLoadout(echoes))
  const preferences = Object.entries(counts)
    .flatMap(([rawSetId, count]): RandomGeneratorSetPreference[] => {
      const setId = Number(rawSetId)
      const def = getEchoSetDef(setId)
      if (!def) {
        return []
      }

      if (def.setMax === 3) {
        return count >= 3 ? [{ setId, count: 3 }] : []
      }

      if (count >= 5) {
        return [{ setId, count: 5 }]
      }

      if (count >= 2) {
        return [{ setId, count: 2 }]
      }

      return []
    })
    .sort((left, right) => right.count - left.count || left.setId - right.setId)

  return trimRandomSetPreferences(preferences)
}

function normalizePlan(plan: TeammateEchoPlan): TeammateEchoPlan {
  return {
    mainEchoMode: plan.mainEchoMode,
    mainEchoId: plan.mainEchoId,
    setMode: plan.setMode,
    setPreferences: trimRandomSetPreferences(plan.setPreferences),
  }
}

function resolvePlan(
  baseEchoes: ReadonlyArray<EchoInstance | null | undefined>,
  plan: TeammateEchoPlan | null | undefined,
): TeammateEchoPlan {
  if (plan) {
    return normalizePlan(plan)
  }

  const normalizedBaseEchoes = normalizeEchoLoadout(baseEchoes)
  return {
    mainEchoMode: 'inherit',
    mainEchoId: normalizedBaseEchoes[0]?.id ?? null,
    setMode: 'inherit',
    setPreferences: deriveSetPreferencesFromEchoes(normalizedBaseEchoes),
  }
}

function resolveMainEchoId(
  baseEchoes: ReadonlyArray<EchoInstance | null | undefined>,
  plan: TeammateEchoPlan,
): string | null {
  if (plan.mainEchoMode === 'selected') {
    return plan.mainEchoId
  }

  return normalizeEchoLoadout(baseEchoes)[0]?.id ?? null
}

function resolveSetPreferences(
  baseEchoes: ReadonlyArray<EchoInstance | null | undefined>,
  plan: TeammateEchoPlan,
): RandomGeneratorSetPreference[] {
  if (plan.setMode === 'selected') {
    return plan.setPreferences
  }

  return deriveSetPreferencesFromEchoes(baseEchoes)
}

function isMainEchoValidForSetPreferences(
  preferences: RandomGeneratorSetPreference[],
  echoId: string,
): boolean {
  const definition = getEchoById(echoId)
  if (!definition) {
    return false
  }

  const candidateSetIds = new Set(definition.sets)
  if (preferences.length === 0) {
    return true
  }

  const totalPieces = preferences.reduce((sum, entry) => sum + entry.count, 0)
  if (preferences.length === 1 && totalPieces === 5) {
    return candidateSetIds.has(preferences[0].setId)
  }

  return preferences.some((entry) => candidateSetIds.has(entry.setId))
}

function resolveMainEchoSet(
  echoId: string,
  preferences: RandomGeneratorSetPreference[],
  fallbackSet: number,
): number {
  const definition = getEchoById(echoId)
  if (!definition) {
    return fallbackSet
  }

  if (preferences.length === 0) {
    return fallbackSet
  }

  const matchingSet = [...definition.sets]
    .sort((left, right) => {
      const countDelta = (
        preferences.find((entry) => entry.setId === right)?.count ?? 0
      ) - (
        preferences.find((entry) => entry.setId === left)?.count ?? 0
      )
      if (countDelta !== 0) {
        return countDelta
      }
      return left - right
    })[0]

  return matchingSet ?? fallbackSet
}

export function deriveTeammateEchoPlan(
  baseEchoes: ReadonlyArray<EchoInstance | null | undefined>,
): TeammateEchoPlan {
  return resolvePlan(baseEchoes, null)
}

export function resolveTeammateEchoPlan(
  baseEchoes: ReadonlyArray<EchoInstance | null | undefined>,
  plan: TeammateEchoPlan | null | undefined,
): ResolvedTeammateEchoPlan {
  const normalizedBaseEchoes = normalizeEchoLoadout(baseEchoes)
  const resolvedPlan = resolvePlan(normalizedBaseEchoes, plan)
  const resolvedSetPreferences = resolveSetPreferences(normalizedBaseEchoes, resolvedPlan)
  const resolvedMainEchoId = resolveMainEchoId(normalizedBaseEchoes, resolvedPlan)
  const effectiveEchoes = resolvedPlan.setMode === 'selected'
    ? (() => {
        const nextEchoes = normalizeEchoLoadout([])
        const targetSetIds = expandSetPreferenceTargets(resolvedSetPreferences)
        for (let echoIndex = 0; echoIndex < nextEchoes.length; echoIndex += 1) {
          const targetSetId = targetSetIds[echoIndex] ?? null
          nextEchoes[echoIndex] = targetSetId == null
            ? null
            : makeSyntheticSetEcho(targetSetId, echoIndex)
        }
        return nextEchoes
      })()
    : normalizedBaseEchoes

  const fallbackMainEcho = effectiveEchoes[0]

  if (!resolvedMainEchoId) {
    if (resolvedPlan.mainEchoMode === 'selected') {
      effectiveEchoes[0] = fallbackMainEcho?.id.startsWith('optimizer-set:') ? fallbackMainEcho : null
    }

    return {
      plan: {
        ...resolvedPlan,
        setPreferences: resolvedSetPreferences,
      },
      effectiveEchoes,
      invalidMainEchoId: null,
    }
  }

  if (
    resolvedPlan.setMode === 'inherit' &&
    resolvedPlan.mainEchoMode === 'inherit' &&
    normalizedBaseEchoes[0]?.id === resolvedMainEchoId
  ) {
    return {
      plan: {
        ...resolvedPlan,
        setPreferences: resolvedSetPreferences,
      },
      effectiveEchoes,
      invalidMainEchoId: null,
    }
  }

  const nextMainEcho = makeDefaultEchoInstance(
    resolvedMainEchoId,
    0,
    normalizedBaseEchoes[0] ?? null,
  )

  if (!nextMainEcho) {
    effectiveEchoes[0] = fallbackMainEcho?.id.startsWith('optimizer-set:') ? fallbackMainEcho : null
    return {
      plan: {
        ...resolvedPlan,
        setPreferences: resolvedSetPreferences,
      },
      effectiveEchoes,
      invalidMainEchoId: resolvedMainEchoId,
    }
  }

  nextMainEcho.set = resolveMainEchoSet(
    resolvedMainEchoId,
    resolvedSetPreferences,
    nextMainEcho.set,
  )

  if (!isMainEchoValidForSetPreferences(resolvedSetPreferences, resolvedMainEchoId)) {
    effectiveEchoes[0] = fallbackMainEcho?.id.startsWith('optimizer-set:') ? fallbackMainEcho : null
    return {
      plan: {
        ...resolvedPlan,
        setPreferences: resolvedSetPreferences,
      },
      effectiveEchoes,
      invalidMainEchoId: resolvedMainEchoId,
    }
  }

  effectiveEchoes[0] = nextMainEcho
  return {
    plan: {
      ...resolvedPlan,
      setPreferences: resolvedSetPreferences,
    },
    effectiveEchoes,
    invalidMainEchoId: null,
  }
}

export function selectTeammateMainEcho(
  plan: TeammateEchoPlan,
  echoId: string | null,
): TeammateEchoPlan {
  return {
    ...plan,
    mainEchoMode: 'selected',
    mainEchoId: echoId,
  }
}

export function addTeammateSetPreference(
  plan: TeammateEchoPlan,
  setId: number,
): TeammateEchoPlan {
  const defaultCount = getRandomSetCountOptions(setId)[0]
  if (!defaultCount) {
    return plan
  }

  return normalizePlan({
    ...plan,
    setMode: 'selected',
    setPreferences: [
      { setId, count: defaultCount },
      ...plan.setPreferences.filter((entry) => entry.setId !== setId),
    ],
  })
}

export function removeTeammateSetPreference(
  plan: TeammateEchoPlan,
  setId: number,
): TeammateEchoPlan {
  return normalizePlan({
    ...plan,
    setMode: 'selected',
    setPreferences: plan.setPreferences.filter((entry) => entry.setId !== setId),
  })
}

export function setTeammateSetPreferenceCount(
  plan: TeammateEchoPlan,
  setId: number,
  count: number,
): TeammateEchoPlan {
  const current = plan.setPreferences.find((entry) => entry.setId === setId)
  if (!current) {
    return plan
  }

  return normalizePlan({
    ...plan,
    setMode: 'selected',
    setPreferences: [
      {
        setId,
        count: normalizeRandomSetPreferenceCount(setId, count),
      },
      ...plan.setPreferences.filter((entry) => entry.setId !== setId),
    ],
  })
}
