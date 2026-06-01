/*
  Author: Runor Ewhro
  Description: Wraps cached async suggestion runs so repeated ui refreshes can
               reuse prepared work and avoid overlapping requests.
*/

export interface CchdSuggRunA<TPrepared, TResult> {
  force?: boolean
  canRun: boolean
  enabled: boolean
  cacheKey: string
  logLabel: string
  readCached: (cacheKey: string) => TResult[] | null
  writeCached: (cacheKey: string, results: TResult[]) => void
  nextSequence: () => number
  isCurSqnc: (sequence: number) => boolean
  setRunning: (running: boolean) => void
  resetResults: () => void
  applyResults: (results: TResult[]) => void
  prepare: () => TPrepared | null
  run: (prepared: TPrepared) => Promise<TResult[]>
}

// keep the cache and sequence handling in one place so each suggestion mode only owns its inputs.
export async function runCchdSuggJ<TPrepared, TResult>({
  applyResults,
  cacheKey,
  canRun,
  enabled,
  force = false,
  isCurSqnc: isCrrnSqnc,
  logLabel,
  nextSequence,
  prepare,
  readCached,
  resetResults,
  run,
  setRunning,
  writeCached,
}: CchdSuggRunA<TPrepared, TResult>): Promise<void> {
  if (!canRun) {
    resetResults()
    return
  }

  if (!enabled) {
    return
  }

  if (!force) {
    const cached = readCached(cacheKey)
    if (cached) {
      applyResults(cached)
      setRunning(false)
      return
    }
  }

  const sequence = nextSequence()
  setRunning(true)

  try {
    const prepared = prepare()
    if (!prepared) {
      resetResults()
      return
    }

    const results = await run(prepared)
    if (!isCrrnSqnc(sequence)) {
      return
    }

    writeCached(cacheKey, results)
    applyResults(results)
  } catch (error) {
    if (isCrrnSqnc(sequence)) {
      resetResults()
    }
    console.error(`[CalculatorSuggestionsPane] ${logLabel} suggestions failed`, error)
  } finally {
    if (isCrrnSqnc(sequence)) {
      setRunning(false)
    }
  }
}
