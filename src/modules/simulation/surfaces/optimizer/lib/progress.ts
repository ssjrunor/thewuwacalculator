/*
  Author: Runor Ewhro
  Description: Formats optimizer timing and accumulates normalized throughput
               samples across the lifetime of a running search.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import type { OptPrgr } from '@/engine/optimizer/types'

const WAVE_SLOTS = 44

export function formatOptimizerTime(ms: number, pending = 'Calculating...'): string {
  if (!Number.isFinite(ms)) return pending
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min === 0 ? `${sec}s` : `${min}m ${sec}s`
}

export function useOptimizerWave(isLoading: boolean, progress: OptPrgr): number[] {
  const [wave, setWave] = useState<number[]>(() => Array(WAVE_SLOTS).fill(0))
  const wasLoading = useRef(false)
  const resetPending = useRef(false)

  useEffect(() => {
    const started = isLoading && !wasLoading.current
    wasLoading.current = isLoading
    resetPending.current ||= started

    if (!isLoading) return

    const frame = window.requestAnimationFrame(() => {
      setWave((current) => {
        const shouldReset = resetPending.current
        resetPending.current = false
        const source = shouldReset ? Array<number>(WAVE_SLOTS).fill(0) : current
        if (progress.phase === 'discovering' || progress.speed <= 0) {
          return shouldReset ? source : current
        }

        const slot = Math.min(
          WAVE_SLOTS - 1,
          Math.floor(progress.progress * WAVE_SLOTS),
        )
        let changed = shouldReset
        const next = source.slice()

        // Large batches can jump several slots per update. Carry the latest
        // rate across skipped positions so the trace has no artificial gaps.
        for (let index = 0; index <= slot; index += 1) {
          const value = index === slot
            ? Math.max(next[index], progress.speed)
            : next[index] || progress.speed
          if (value !== next[index]) {
            next[index] = value
            changed = true
          }
        }

        return changed ? next : current
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isLoading, progress.phase, progress.progress, progress.speed])

  return useMemo(() => {
    const peak = Math.max(...wave, 1)
    return wave.map((value) => value / peak)
  }, [wave])
}
