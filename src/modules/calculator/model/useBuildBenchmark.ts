/*
  Author: Runor Ewhro
  Description: calculator-level hook for default-rotation build benchmark
               score and debug logging.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { logBuildBenchmarkResult as logBenchResult } from '@/data/scoring/buildBenchmark.ts'
import type { BenchmarkReportOpts, BuildBenchmarkReport, DefRotBenchIn } from '@/data/scoring/buildBenchmark.ts'
import {
  peekBenchScore,
  runBenchDetail,
  runBenchReport,
  runBenchScore,
  cancelBenchReport,
  prefetchBench,
} from '@/data/scoring/buildBenchmarkClient.ts'
import type { SimResult } from '@/engine/pipeline/types'
import {
  applyBenchAsm,
  applyBenchMapAsm,
  BENCH_ENEMY,
} from '@/modules/calculator/model/benchmarkAssumptions.ts'
import { useBenchTarget } from '@/modules/calculator/model/useBenchTarget.ts'

declare global {
  interface Window {
    logActBench?: () => void
  }
}

export interface UseBenchScoreIn {
  runtime: ResRuntime | null
  simulation: SimResult | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  debounceMs?: number
  exposeLogger?: boolean
  enabled?: boolean
}

export interface UseAsmBenchScoreIn {
  runtime: ResRuntime | null
  runtimesById: Record<string, ResRuntime>
  targetSelections: Record<string, string | null>
  debounceMs?: number
  exposeLogger?: boolean
  enabled?: boolean
}

export interface BenchScoreSt {
  score: number | null
  logBenchmark: () => void
}

export interface BenchReportSt {
  report: BuildBenchmarkReport | null
  loading: boolean
  error: Error | null
  refresh: () => void
}

interface BenchPayloadIn {
  runtime: ResRuntime
  simulation: SimResult | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
}

function mkBenchPayload({
  runtime,
  simulation,
  enemy,
  runtimesById,
}: BenchPayloadIn): DefRotBenchIn {
  // workers receive a compact payload object so score, detail, and report paths
  // share cache keys and cannot accidentally serialize different input shapes
  return {
    runtime,
    simulation,
    enemy,
    runtimesById,
  }
}

interface AsmBenchTarget {
  runtime: ResRuntime | null
  runtimesById: Record<string, ResRuntime>
  simulation: SimResult | null
}

function useAsmBenchTarget({
  runtime,
  runtimesById,
  targetSelections,
}: Pick<UseAsmBenchScoreIn, 'runtime' | 'runtimesById' | 'targetSelections'>): AsmBenchTarget {
  // assumed benchmark mode runs on a cloned runtime/team map so benchmark
  // scoring can apply its fixed enemy and assumptions without mutating app state
  const benchRt = useMemo(
    () => runtime ? applyBenchAsm(runtime) : null,
    [runtime],
  )
  const benchRtsById = useMemo(
    () => applyBenchMapAsm(runtimesById),
    [runtimesById],
  )
  const targetSeed = useMemo(
    () => (benchRt ? getResSeedBy(benchRt.id) ?? null : null),
    [benchRt],
  )
  const benchTgt = useBenchTarget({
    targetRuntime: benchRt,
    targetSeed,
    targetSelections,
    activeResId: null,
    activeRuntimesById: benchRtsById,
    initializedRuntimesById: benchRtsById,
    enemy: BENCH_ENEMY,
    showAllStates: false,
  })

  return {
    runtime: benchRt,
    runtimesById: benchTgt.runtimesById,
    simulation: benchTgt.simulation,
  }
}

export function useBenchScore({
  runtime,
  simulation,
  enemy,
  runtimesById,
  debounceMs = 3000,
  exposeLogger = false,
  enabled = true,
}: UseBenchScoreIn): BenchScoreSt {
  const [score, setScore] = useState<number | null>(null)
  const scoreRuntimeRef = useRef(runtime?.id ?? null)

  useEffect(() => {
    let cancelled = false
    // reset visible score when the resonator changes, but keep same-runtime
    // edits debounced so typing and build tweaks do not flash empty state
    if (scoreRuntimeRef.current !== (runtime?.id ?? null)) {
      scoreRuntimeRef.current = runtime?.id ?? null
      setScore(null)
    }

    if (!enabled || !runtime || !simulation) {
      setScore(null)
      return () => {
        cancelled = true
      }
    }

    const payload = mkBenchPayload({
      runtime,
      simulation,
      enemy,
      runtimesById,
    })
    const cached = peekBenchScore(payload)
    if (cached !== undefined) {
      // undefined means no cache entry; null is a cached "not scoreable" result
      setScore(cached)
      return () => {
        cancelled = true
      }
    }

    const timeoutId = window.setTimeout(() => {
      void runBenchScore(payload)
        .then((nextScore) => {
          if (!cancelled) {
            setScore(nextScore)
          }
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn('[build benchmark] score worker failed', error)
            setScore(null)
          }
        })
    }, debounceMs)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [debounceMs, enabled, enemy, runtimesById, runtime, simulation])

  const logBenchmark = useCallback(() => {
    if (!runtime) {
      console.info('[build benchmark] No benchmark available for active resonator.')
      return
    }

    const payload = mkBenchPayload({
      runtime,
      simulation,
      enemy,
      runtimesById,
    })

    void runBenchDetail(payload)
      .then((benchmark) => {
        logBenchResult(benchmark, runtime.id)
      })
      .catch((error) => {
        console.warn('[build benchmark] detail worker failed', error)
      })
  }, [enemy, runtimesById, runtime, simulation])

  useEffect(() => {
    if (!exposeLogger || typeof window === 'undefined') {
      return
    }

    // debug logger is opt-in and removed only if this hook still owns it, which
    // avoids deleting a newer logger registered by a later render
    window.logActBench = logBenchmark
    return () => {
      if (window.logActBench === logBenchmark) {
        delete window.logActBench
      }
    }
  }, [exposeLogger, logBenchmark])

  return {
    score,
    logBenchmark,
  }
}

export function usePrefetchAsmBench({
  runtime,
  runtimesById,
  targetSelections,
  enabled = true,
}: Pick<UseAsmBenchScoreIn, 'runtime' | 'runtimesById' | 'targetSelections' | 'enabled'>): void {
  const prefetchedRef = useRef<string | null>(null)
  const target = useAsmBenchTarget({
    runtime,
    runtimesById,
    targetSelections,
  })

  useEffect(() => {
    if (!enabled || !target.runtime || !target.simulation) {
      return
    }
    const signature = `${target.runtime.id}|${JSON.stringify(targetSelections)}`
    if (prefetchedRef.current === signature) {
      return
    }
    // prefetch is delayed slightly so fast target changes coalesce into the one
    // benchmark the user is likely to inspect
    const payload = mkBenchPayload({
      runtime: target.runtime,
      simulation: target.simulation,
      enemy: BENCH_ENEMY,
      runtimesById: target.runtimesById,
    })
    const timeoutId = window.setTimeout(() => {
      prefetchedRef.current = signature
      prefetchBench(payload)
    }, 500)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [enabled, target, targetSelections])
}

export function useAsmBenchScore({
  runtime,
  runtimesById,
  targetSelections,
  debounceMs,
  exposeLogger = false,
  enabled = true,
}: UseAsmBenchScoreIn): BenchScoreSt {
  const benchTgt = useAsmBenchTarget({
    runtime,
    runtimesById,
    targetSelections,
  })

  return useBenchScore({
    runtime: benchTgt.runtime,
    simulation: benchTgt.simulation,
    enemy: BENCH_ENEMY,
    runtimesById: benchTgt.runtimesById,
    debounceMs,
    exposeLogger,
    enabled,
  })
}

export interface BenchShowcaseSt {
  score: number | null
  avgDamage: number | null
  runtimeId: string | null
}

// Showcase view needs the build's score and its benchmark-rotation average
// damage, both of which come from the detail payload (the score-only worker
// path discards the damage). Detail and score share a cache, so this stays
// cheap once either has run for a given build.
export function useBenchShowcase({
  runtime,
  simulation,
  enemy,
  runtimesById,
  debounceMs = 120,
  enabled = true,
}: UseBenchScoreIn): BenchShowcaseSt {
  const [state, setState] = useState<BenchShowcaseSt>({ score: null, avgDamage: null, runtimeId: null })
  const showcaseRuntimeRef = useRef(runtime?.id ?? null)

  useEffect(() => {
    let cancelled = false
    const runtimeId = runtime?.id ?? null
    if (showcaseRuntimeRef.current !== runtimeId) {
      showcaseRuntimeRef.current = runtimeId
      setState({ score: null, avgDamage: null, runtimeId })
    }

    if (!enabled) {
      return () => {
        cancelled = true
      }
    }

    if (!runtime || !simulation) {
      setState({ score: null, avgDamage: null, runtimeId })
      return () => {
        cancelled = true
      }
    }

    const payload = mkBenchPayload({
      runtime,
      simulation,
      enemy,
      runtimesById,
    })

    const timeoutId = window.setTimeout(() => {
      void runBenchDetail(payload)
        .then((detail) => {
          if (cancelled) return
          setState(
            detail
              ? { score: detail.percent * 100, avgDamage: detail.userDamage, runtimeId: runtime.id }
              : { score: null, avgDamage: null, runtimeId: runtime.id },
          )
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn('[build benchmark] showcase detail worker failed', error)
            setState({ score: null, avgDamage: null, runtimeId: runtime.id })
          }
        })
    }, debounceMs)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [debounceMs, enabled, enemy, runtimesById, runtime, simulation])

  return state
}

export function useBenchReport({
  runtime,
  simulation,
  enemy,
  runtimesById,
  debounceMs = 120,
  enabled = true,
  reportOptions,
}: Omit<UseBenchScoreIn, 'exposeLogger'> & {
  reportOptions?: BenchmarkReportOpts
}): BenchReportSt {
  const [report, setReport] = useState<BuildBenchmarkReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const reportRuntimeRef = useRef(runtime?.id ?? null)
  const handledRefreshRef = useRef(0)
  const reportOptionsRef = useRef(reportOptions)

  useEffect(() => {
    reportOptionsRef.current = reportOptions
  }, [reportOptions])

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const runtimeId = runtime?.id ?? null

    if (reportRuntimeRef.current !== runtimeId) {
      reportRuntimeRef.current = runtimeId
      setReport(null)
    }

    if (!enabled || !runtime || !simulation) {
      if (enabled) setReport(null)
      setLoading(false)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    const payload = mkBenchPayload({
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
    const timeoutId = window.setTimeout(() => {
      void runBenchReport(payload, { force, reportOptions: reportOptionsRef.current })
        .then((nextReport) => {
          if (!cancelled) {
            setReport(nextReport)
            setLoading(false)
          }
        })
        .catch((nextError) => {
          if (!cancelled) {
            setReport(null)
            setLoading(false)
            setError(nextError instanceof Error ? nextError : new Error('Build benchmark report failed'))
          }
        })
    }, debounceMs)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      cancelBenchReport()
    }
  }, [debounceMs, enabled, enemy, refreshToken, runtimesById, runtime, simulation])

  return {
    report,
    loading,
    error,
    refresh,
  }
}

export function useBenchPreview({
  runtime,
  echoes,
  runtimesById,
  targetSelections,
  debounceMs,
}: Omit<UseAsmBenchScoreIn, 'exposeLogger'> & {
  echoes: Array<EchoInstance | null>
}): BenchScoreSt {
  const benchRt = useMemo(() => {
    if (!runtime) {
      return null
    }
    return {
      ...runtime,
      build: {
        ...runtime.build,
        echoes,
      },
    }
  }, [echoes, runtime])

  return useAsmBenchScore({
    runtime: benchRt,
    runtimesById,
    targetSelections,
    debounceMs,
  })
}
