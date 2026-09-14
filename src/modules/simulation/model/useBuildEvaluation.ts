/*
  Author: Runor Ewhro
  Description: Simulation-level hook for default-rotation evaluation reports.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime } from '@/domain/entities/runtime'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import type { EvaluationReportOpts, BuildEvaluationReport, DefRotEvaluationIn } from '@/data/scoring/buildEvaluation.ts'
import {
  runEvaluationReport,
  cancelEvaluationReport,
} from '@/data/scoring/buildEvaluationClient.ts'
import type { SimResult } from '@/engine/pipeline/types'
import {
  applyEvaluationAsm,
  applyEvaluationMapAsm,
  makeEvaluationEnemy,
} from '@/modules/simulation/model/evaluationAssumptions.ts'
import { useEvaluationTarget } from '@/modules/simulation/model/useEvaluationTarget.ts'
import { scheduleAfterSettled } from '@/shared/lib/scheduleAfterSettled.ts'
import { getTuneStrainMaxForTeam } from '@/domain/gameData/tuneStrain.ts'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { useStableEvaluationInputs } from '@/modules/simulation/model/useStableEvaluationInputs.ts'

const EMPTY_RUNTIME_MAP: Record<string, ResRuntime> = Object.freeze({})

export interface UseAsmEvaluationReportIn {
  runtime: ResRuntime | null
  runtimesById: Record<string, ResRuntime>
  targetSelections: Record<string, string | null>
  debounceMs?: number
  enabled?: boolean
  reportOptions?: EvaluationReportOpts
}

export interface EvaluationReportSt {
  report: BuildEvaluationReport | null
  loading: boolean
  error: Error | null
  refresh: () => void
}

interface EvaluationPayloadIn {
  runtime: ResRuntime
  simulation: SimResult | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
}

function compactEvaluationSimulation(simulation: SimResult | null): SimResult | null {
  if (!simulation) return null

  // The report context only reads finalStats and the sequence feature entries.
  // Drop duplicate flattened/program rows before postMessage so structured
  // cloning does not copy several equivalent feature graphs into the worker.
  return {
    ...simulation,
    allFeatures: [],
    allSkills: [],
    perSkill: [],
    rotation: {
      ...simulation.rotation,
      program: {
        ...simulation.rotation.program,
        entries: [],
      },
    },
  }
}

function mkEvaluationPayload({
  runtime,
  simulation,
  enemy,
  runtimesById,
}: EvaluationPayloadIn): DefRotEvaluationIn {
  const scenario = selectedCombatScenario(useAppStore.getState().combat)
  const member = scenario.team.members.find((candidate) => candidate.resonatorId === runtime.id)
  // workers receive one compact payload shape so report cache keys remain stable
  return {
    scenarioId: member ? scenario.id : combatScenarioId('evaluation:detached'),
    memberId: member?.id ?? teamMemberId(runtime.id),
    runtime,
    simulation: compactEvaluationSimulation(simulation),
    enemy,
    runtimesById,
  }
}

interface AsmEvaluationTarget {
  runtime: ResRuntime | null
  runtimesById: Record<string, ResRuntime>
  simulation: SimResult | null
  enemy: EnemyProfile
}

function useAsmEvaluationTarget({
  runtime,
  runtimesById,
  targetSelections,
}: Pick<UseAsmEvaluationReportIn, 'runtime' | 'runtimesById' | 'targetSelections'>): AsmEvaluationTarget {
  // assumed evaluation mode runs on a cloned runtime/team map so evaluation
  // scoring can apply its fixed enemy and assumptions without mutating app state
  const nextInputs = useMemo(() => ({
    runtime: runtime ? applyEvaluationAsm(runtime) : null,
    runtimesById: applyEvaluationMapAsm(runtimesById),
    targetSelections,
  }), [runtime, runtimesById, targetSelections])
  // Scenario persistence rebuilds runtime projections for edits such as live
  // enemy or progression changes. After evaluation normalization those values
  // can be identical; retain that identity so the settled-work gate does not
  // blank and restart an unchanged score.
  const evaluationInputs = useStableEvaluationInputs(nextInputs)
  const evaluationRuntime = evaluationInputs.runtime
  const evaluationRuntimesById = evaluationInputs.runtimesById
  const targetSeed = useMemo(
    () => (evaluationRuntime ? getResSeedBy(evaluationRuntime.id) ?? null : null),
    [evaluationRuntime],
  )
  const evaluationTuneStrain = useMemo(
    () => getTuneStrainMaxForTeam(evaluationRuntime),
    [evaluationRuntime],
  )
  const evaluationEnemy = useMemo(
    () => makeEvaluationEnemy(evaluationTuneStrain),
    [evaluationTuneStrain],
  )
  const evaluationTarget = useEvaluationTarget({
    targetRuntime: evaluationRuntime,
    targetSeed,
    targetSelections: evaluationInputs.targetSelections,
    activeResId: null,
    activeRuntimesById: evaluationRuntimesById,
    initializedRuntimesById: evaluationRuntimesById,
    enemy: evaluationEnemy,
    showAllStates: false,
    deferHeavyWork: true,
  })

  return {
    runtime: evaluationRuntime,
    runtimesById: evaluationTarget.runtimesById,
    simulation: evaluationTarget.simulation,
    enemy: evaluationEnemy,
  }
}

export function useAsmEvaluationReport({
  runtime,
  runtimesById,
  targetSelections,
  debounceMs,
  enabled = true,
  reportOptions,
}: UseAsmEvaluationReportIn): EvaluationReportSt {
  const evaluationTarget = useAsmEvaluationTarget({
    runtime: enabled ? runtime : null,
    runtimesById: enabled ? runtimesById : EMPTY_RUNTIME_MAP,
    targetSelections,
  })

  return useEvaluationReport({
    runtime: evaluationTarget.runtime,
    simulation: evaluationTarget.simulation,
    enemy: evaluationTarget.enemy,
    runtimesById: evaluationTarget.runtimesById,
    debounceMs,
    enabled,
    reportOptions,
  })
}

export function useEvaluationReport({
  runtime,
  simulation,
  enemy,
  runtimesById,
  debounceMs = 120,
  enabled = true,
  reportOptions,
  identityKey,
}: {
  runtime: ResRuntime | null
  simulation: SimResult | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  debounceMs?: number
  enabled?: boolean
  reportOptions?: EvaluationReportOpts
  identityKey?: string | null
}): EvaluationReportSt {
  const resolvedIdentityKey = identityKey ?? runtime?.id ?? null
  const alternativesLimit = reportOptions?.alternativesLimit ?? 12
  const includeRotationFeatures = reportOptions?.sections?.rotationFeatures ?? true
  const includeUpgradePaths = reportOptions?.sections?.upgradePaths ?? true
  const includeEchoStatsTable = reportOptions?.sections?.echoStatsTable ?? true
  const includeEvaluationTargets = reportOptions?.sections?.evaluationTargets ?? true
  const resolvedReportOptions = useMemo<EvaluationReportOpts>(() => ({
    alternativesLimit,
    sections: {
      rotationFeatures: includeRotationFeatures,
      upgradePaths: includeUpgradePaths,
      echoStatsTable: includeEchoStatsTable,
      evaluationTargets: includeEvaluationTargets,
    },
  }), [
    alternativesLimit,
    includeEchoStatsTable,
    includeEvaluationTargets,
    includeRotationFeatures,
    includeUpgradePaths,
  ])
  // A reduced Showcase report and a complete Modulation report can otherwise
  // share the same scenario/runtime identity. Include the requested report
  // shape so switching surfaces invalidates the old result and schedules the
  // missing sections without treating equivalent default options as different.
  const resolvedReportIdentityKey = resolvedIdentityKey == null
    ? null
    : [
        resolvedIdentityKey,
        alternativesLimit,
        Number(includeRotationFeatures),
        Number(includeUpgradePaths),
        Number(includeEchoStatsTable),
        Number(includeEvaluationTargets),
      ].join(':')
  const [report, setReport] = useState<BuildEvaluationReport | null>(null)
  const [reportIdentityKey, setReportIdentityKey] = useState<string | null>(resolvedReportIdentityKey)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const reportRuntimeRef = useRef(resolvedReportIdentityKey)
  const handledRefreshRef = useRef(0)

  /* eslint-disable react-hooks/set-state-in-effect -- report state tracks the async report worker lifecycle. */
  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    if (reportRuntimeRef.current !== resolvedReportIdentityKey) {
      reportRuntimeRef.current = resolvedReportIdentityKey
      setReport(null)
      setReportIdentityKey(resolvedReportIdentityKey)
    }

    if (!enabled || !runtime || !simulation) {
      if (enabled) setReport(null)
      setLoading(false)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    const payload = mkEvaluationPayload({
      runtime,
      simulation,
      enemy,
      runtimesById,
    })
    // refresh forces the worker lane past its report cache while ordinary reruns
    // keep using cached reports for the same payload
    const force = refreshToken !== handledRefreshRef.current
    handledRefreshRef.current = refreshToken

    setLoading(true)
    setError(null)
    const cancelScheduledReport = scheduleAfterSettled(() => {
      void runEvaluationReport(payload, { force, reportOptions: resolvedReportOptions })
        .then((nextReport) => {
          if (!cancelled) {
            setReport(nextReport)
            setReportIdentityKey(resolvedReportIdentityKey)
            setLoading(false)
          }
        })
        .catch((nextError) => {
          if (!cancelled) {
            setReport(null)
            setReportIdentityKey(resolvedReportIdentityKey)
            setLoading(false)
            setError(nextError instanceof Error ? nextError : new Error('Build evaluation report failed'))
          }
        })
    }, { settleDelayMs: Math.max(220, debounceMs) })

    return () => {
      cancelled = true
      cancelScheduledReport()
      cancelEvaluationReport()
    }
  }, [
    debounceMs,
    enabled,
    enemy,
    refreshToken,
    resolvedReportIdentityKey,
    resolvedReportOptions,
    runtimesById,
    runtime,
    simulation,
  ])
  /* eslint-enable react-hooks/set-state-in-effect */

  const reportIsCurrent = reportIdentityKey === resolvedReportIdentityKey
  return {
    report: reportIsCurrent ? report : null,
    loading: loading || Boolean(enabled && runtime && simulation && !reportIsCurrent),
    error,
    refresh,
  }
}
