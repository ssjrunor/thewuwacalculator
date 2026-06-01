/*
  Author: Runor Ewhro
  Description: Provides shared teammate echo plan helpers for the optimizer surface.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import type { RandGnrtSetP } from '@/domain/entities/suggestions.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { mkDefEchoNst } from '@/modules/calculator/features/echoes/lib/echoPane.ts'
import {
  getRandSetCn,
  normSetCount,
  trimRandSetP,
} from '@/modules/calculator/features/suggesstions/lib/suggestions.ts'

export interface EchoPlan {
  mainEchoMode: 'inherit' | 'selected'
  mainEchoId: string | null
  setMode: 'inherit' | 'selected'
  setPrefs: RandGnrtSetP[]
}

export interface ResolvedPlan {
  plan: EchoPlan
  effectEchoes: Array<EchoInstance | null>
  invalidMainId: string | null
}

function normEchoLdt(
  echoes: ReadonlyArray<EchoInstance | null | undefined>,
): Array<EchoInstance | null> {
  // optimizer teammates always evaluate against a five-slot echo array, even when the source runtime is sparse.
  const out: Array<EchoInstance | null> = [null, null, null, null, null]
  for (let index = 0; index < out.length; index += 1) {
    out[index] = echoes[index] ?? null
  }
  return out
}

function mkSyntSetEch(setId: number, slotIndex: number): EchoInstance {
  // set-only teammate plans do not need real echo stats; synthetic echoes carry just enough set identity for context
  // building and set-state visibility.
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

function xpndSetPrefT(
  preferences: RandGnrtSetP[],
): number[] {
  return preferences.flatMap((entry) => Array.from({ length: entry.count }, () => entry.setId))
}

function derSetPrefsF(
  echoes: ReadonlyArray<EchoInstance | null | undefined>,
): RandGnrtSetP[] {
  const counts = countEchoSets(normEchoLdt(echoes))
  // inherited plans summarize only active set thresholds; partial one-piece leftovers are ignored because they have no
  // set effect to preserve.
  const preferences = Object.entries(counts)
    .flatMap(([rawSetId, count]): RandGnrtSetP[] => {
      const setId = Number(rawSetId)
      const def = getEchoSetDe(setId)
      if (!def) {
        return []
      }

      if (def.setMax === 1) {
        return count >= 1 ? [{ setId, count: 1 }] : []
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

  return trimRandSetP(preferences)
}

function normPlan(plan: EchoPlan): EchoPlan {
  return {
    mainEchoMode: plan.mainEchoMode,
    mainEchoId: plan.mainEchoId,
    setMode: plan.setMode,
    setPrefs: trimRandSetP(plan.setPrefs),
  }
}

function resolvePlan(
  sourceEchoes: ReadonlyArray<EchoInstance | null | undefined>,
  plan: EchoPlan | null | undefined,
): EchoPlan {
  if (plan) {
    // optimizer payloads use the trimmed plan shape regardless of where the
    // plan came from.
    return normPlan(plan)
  }

  const baseEchoes = normEchoLdt(sourceEchoes)
  return {
    mainEchoMode: 'inherit',
    mainEchoId: baseEchoes[0]?.id ?? null,
    setMode: 'inherit',
    setPrefs: derSetPrefsF(baseEchoes),
  }
}

function resMainEchoI(
  baseEchoes: ReadonlyArray<EchoInstance | null | undefined>,
  plan: EchoPlan,
): string | null {
  if (plan.mainEchoMode === 'selected') {
    return plan.mainEchoId
  }

  return normEchoLdt(baseEchoes)[0]?.id ?? null
}

function resSetPrefs(
  baseEchoes: ReadonlyArray<EchoInstance | null | undefined>,
  plan: EchoPlan,
): RandGnrtSetP[] {
  if (plan.setMode === 'selected') {
    return plan.setPrefs
  }

  return derSetPrefsF(baseEchoes)
}

function isMainEchoVl(
  preferences: RandGnrtSetP[],
  echoId: string,
): boolean {
  // the selected main echo must be able to belong to at least one requested set, or the teammate card should surface it
  // as invalid rather than silently changing the set plan.
  const definition = getEchoById(echoId)
  if (!definition) {
    return false
  }

  const candSetIds = new Set(definition.sets)
  if (preferences.length === 0) {
    return true
  }

  const totalPieces = preferences.reduce((sum, entry) => sum + entry.count, 0)
  if (preferences.length === 1 && totalPieces === 5) {
    // a pure five-piece request requires the main echo to match that exact set because all five slots are committed.
    return candSetIds.has(preferences[0].setId)
  }

  return preferences.some((entry) => candSetIds.has(entry.setId))
}

function resMainEchoS(
  echoId: string,
  preferences: RandGnrtSetP[],
  fallbackSet: number,
): number {
  const definition = getEchoById(echoId)
  if (!definition) {
    return fallbackSet
  }

  if (preferences.length === 0) {
    return fallbackSet
  }

  // when an echo can roll multiple sets, prefer the requested set with the largest piece count so the synthetic loadout
  // satisfies the most constrained part of the plan.
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

export function derEchoPlan(
  baseEchoes: ReadonlyArray<EchoInstance | null | undefined>,
): EchoPlan {
  return resolvePlan(baseEchoes, null)
}

export function resEchoPlan(
  sourceEchoes: ReadonlyArray<EchoInstance | null | undefined>,
  plan: EchoPlan | null | undefined,
): ResolvedPlan {
  const baseEchoes = normEchoLdt(sourceEchoes)
  const resolvedPlan = resolvePlan(baseEchoes, plan)
  const resolvedSets = resSetPrefs(baseEchoes, resolvedPlan)
  const rslvMainEcho = resMainEchoI(baseEchoes, resolvedPlan)
  const effectEchoes = resolvedPlan.setMode === 'selected'
    ? (() => {
        // selected set mode rebuilds non-main slots from the requested set counts; main echo is resolved separately so
        // invalid main selections can be reported clearly.
        const nextEchoes = normEchoLdt([])
        const targetSetIds = xpndSetPrefT(resolvedSets)
        for (let echoIndex = 0; echoIndex < nextEchoes.length; echoIndex += 1) {
          const targetSetId = targetSetIds[echoIndex] ?? null
          nextEchoes[echoIndex] = targetSetId == null
            ? null
            : mkSyntSetEch(targetSetId, echoIndex)
        }
        return nextEchoes
      })()
    : baseEchoes

  const fllbMainEcho = effectEchoes[0]

  if (!rslvMainEcho) {
    if (resolvedPlan.mainEchoMode === 'selected') {
      effectEchoes[0] = fllbMainEcho?.id.startsWith('optimizer-set:') ? fllbMainEcho : null
    }

    return {
      plan: {
        ...resolvedPlan,
        setPrefs: resolvedSets,
      },
      effectEchoes: effectEchoes,
      invalidMainId: null,
    }
  }

  if (
    resolvedPlan.setMode === 'inherit' &&
    resolvedPlan.mainEchoMode === 'inherit' &&
    baseEchoes[0]?.id === rslvMainEcho
  ) {
    return {
      plan: {
        ...resolvedPlan,
        setPrefs: resolvedSets,
      },
      effectEchoes: effectEchoes,
      invalidMainId: null,
    }
  }

  const nextMainEcho = mkDefEchoNst(
    rslvMainEcho,
    0,
    baseEchoes[0] ?? null,
  )

  if (!nextMainEcho) {
    // missing echo catalog data is reported as an invalid main echo while keeping any synthetic set placeholders.
    effectEchoes[0] = fllbMainEcho?.id.startsWith('optimizer-set:') ? fllbMainEcho : null
    return {
      plan: {
        ...resolvedPlan,
        setPrefs: resolvedSets,
      },
      effectEchoes: effectEchoes,
      invalidMainId: rslvMainEcho,
    }
  }

  nextMainEcho.set = resMainEchoS(
    rslvMainEcho,
    resolvedSets,
    nextMainEcho.set,
  )

  if (!isMainEchoVl(resolvedSets, rslvMainEcho)) {
    // keep the plan intact and mark the echo invalid rather than auto-replacing it, because the user chose that main
    // echo explicitly.
    effectEchoes[0] = fllbMainEcho?.id.startsWith('optimizer-set:') ? fllbMainEcho : null
    return {
      plan: {
        ...resolvedPlan,
        setPrefs: resolvedSets,
      },
      effectEchoes: effectEchoes,
      invalidMainId: rslvMainEcho,
    }
  }

  effectEchoes[0] = nextMainEcho
  return {
    plan: {
      ...resolvedPlan,
      setPrefs: resolvedSets,
    },
    effectEchoes: effectEchoes,
    invalidMainId: null,
  }
}

export function selMainEcho(
  plan: EchoPlan,
  echoId: string | null,
): EchoPlan {
  return {
    ...plan,
    mainEchoMode: 'selected',
    mainEchoId: echoId,
  }
}

export function addSetPref(
  plan: EchoPlan,
  setId: number,
): EchoPlan {
  const defaultCount = getRandSetCn(setId)[0]
  if (!defaultCount) {
    return plan
  }

  return normPlan({
    ...plan,
    setMode: 'selected',
    setPrefs: [
      { setId, count: defaultCount },
      ...plan.setPrefs.filter((entry) => entry.setId !== setId),
    ],
  })
}

export function rmSetPref(
  plan: EchoPlan,
  setId: number,
): EchoPlan {
  return normPlan({
    ...plan,
    setMode: 'selected',
    setPrefs: plan.setPrefs.filter((entry) => entry.setId !== setId),
  })
}

export function setSetCount(
  plan: EchoPlan,
  setId: number,
  count: number,
): EchoPlan {
  const current = plan.setPrefs.find((entry) => entry.setId === setId)
  if (!current) {
    return plan
  }

  return normPlan({
    ...plan,
    setMode: 'selected',
    setPrefs: [
      {
        setId,
        count: normSetCount(setId, count),
      },
      ...plan.setPrefs.filter((entry) => entry.setId !== setId),
    ],
  })
}
