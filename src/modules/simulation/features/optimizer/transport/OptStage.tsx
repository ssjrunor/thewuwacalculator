/*
  Author: Runor Ewhro
  Description: The optimizer's run board. One shape in every phase: the headline
               number, what the run is doing, the seismograph, and the counters.
               Nothing appears or disappears between standby and running, so the
               board fills in rather than rebuilding.
*/

import type { CSSProperties } from 'react'
import type { OptPrgr } from '@/engine/optimizer/types'
import { formatOptimizerTime, useOptimizerWave } from '../lib/progress.ts'

export function OptStage({
  isLoading,
  progress,
  cancelled,
  success,
  // theory mode has no permutation count of its own until the worker reports
  // one, so the headline slot stays empty rather than inventing a number.
  permutations,
  batchSize,
  isTheory,
  resultCount,
}: {
  isLoading: boolean
  progress: OptPrgr
  cancelled: boolean
  success: boolean
  permutations: string | null
  batchSize: number | null
  isTheory: boolean
  resultCount: number
}) {
  const isDiscovering = isLoading && progress.phase === 'discovering'
  const pct = Math.floor(progress.progress * 100)

  const waveBars = useOptimizerWave(isLoading, progress)

  const headline = isLoading
    ? isDiscovering ? '···' : `${pct}%`
    : permutations ?? '—'

  const caption = isLoading
    ? isDiscovering
      ? 'Discovering combos'
      : Number.isFinite(progress.remainingMs)
        ? `${formatOptimizerTime(progress.remainingMs)} left`
        : 'Estimating'
    : cancelled
      ? 'Cancelled'
      : 'Permutations'

  const dash = '—'
  const cells: Array<{ key: string; value: string; live?: boolean }> = [
    ...(isTheory
      ? [{
        key: 'Discovered',
        value: progress.discovered ? progress.discovered.toLocaleString() : dash,
        live: isDiscovering,
      }]
      : []),
    {
      key: 'Processed',
      value: progress.processed ? progress.processed.toLocaleString() : dash,
      live: isLoading && !isDiscovering,
    },
    { key: 'Batch', value: batchSize ? batchSize.toLocaleString() : dash },
    { key: 'Rate', value: progress.speed ? `${progress.speed.toLocaleString()}/s` : dash },
    { key: 'Results', value: resultCount ? resultCount.toLocaleString() : dash },
  ]

  return (
    <div className="opb-stage" data-phase={isLoading ? (isDiscovering ? 'discovering' : 'running') : cancelled ? 'cancelled' : success ? 'done' : 'idle'}>
      <span className="opb-stage__sweep"
        aria-hidden="true"
        style={{ '--pct': isLoading && !isDiscovering ? `${progress.progress * 100}%` : '0%' } as CSSProperties}
      />
      <div className="opb-stage__in">
        <span className="opb-stage__big" data-none={!isLoading && permutations == null ? '' : undefined}>
          {headline}
        </span>
        <span className="opb-stage__sub">{caption}</span>

        <div className="opb-wave" data-live={isLoading ? '' : undefined} aria-hidden="true">
          {waveBars.map((height, index) => (
            <span
              key={index} className="opb-wave__bar"
              style={height > 0 ? { height: `${Math.max(10, height * 100)}%` } : undefined}
            />
          ))}
        </div>

        <div className="opb-board">
          {cells.map((cell) => (
            <span key={cell.key} className="opb-board__cell" data-live={cell.live ? '' : undefined}>
              <em>{cell.key}</em>
              <b>{cell.value}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
