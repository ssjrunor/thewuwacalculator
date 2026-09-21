/*
  Author: Runor Ewhro
  Description: Renders controls for the Optimizer tool.
*/

import type { OptSearchMode } from '@/domain/entities/optimizer'
import type { OptPrgr } from '@/engine/optimizer/types'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { RailManual } from './RailManual'
import { formatOptimizerTime, useOptimizerWave } from './lib/progress.ts'

interface OptCntrBoxPr {
  isWide?: boolean
  isLoading: boolean
  pndnCmbn?: boolean
  progress: OptPrgr
  success: boolean
  cancelled: boolean
  resultLength: number
  fltrEchoCnt: number
  cmbnLbl?: string
  batchSize?: number | null
  resultsLimit: number
  keepPercent: number
  lowMmryMode: boolean
  searchMode: OptSearchMode
  onResultLimit: (value: number) => void
  onKeepPrcnfe: (value: number) => void
  onLowMmryMch: (value: boolean) => void
  onModeChg: (value: OptSearchMode) => void
  onRunOpt: () => void
  onHalt: () => void
  onEquip: () => void
  onGuide: () => void
  onRules: () => void
  onClear: () => void
}

export function ControlBox({
  isWide = true,
  isLoading,
  pndnCmbn: pndnCmbn = false,
  progress,
  success,
  cancelled,
  resultLength,
  fltrEchoCnt: fltrEchoCnt,
  cmbnLbl: cmbnLbl = '...',
  batchSize = null,
  resultsLimit,
  keepPercent,
  lowMmryMode: lowMmryMode,
  searchMode,
  onResultLimit: onRsltLmtChn,
  onKeepPrcnfe: onKeepPrcnCh,
  onLowMmryMch: onLowMmryMod,
  onModeChg,
  onRunOpt: onRunPtmz,
  onHalt,
  onEquip,
  onGuide,
  onRules,
  onClear,
}: OptCntrBoxPr) {
  const minLimit = 64
  const maxLimit = 65536
  const maxPow = Math.log2(maxLimit / minLimit)
  const runDsbl = isLoading || pndnCmbn
  const echoCntLbl = searchMode === 'theory' ? 'Build Echoes' : 'Filtered Echoes'

  const lmtToSldrVl = (limit: number) => {
    // result limits scale by powers of two, but the native range input is linear, so convert through log space.
    const clamped = Math.min(maxLimit, Math.max(minLimit, limit))
    const pow = Math.log2(clamped / minLimit)
    return (pow / maxPow) * 100
  }

  const sldrVlToLmt = (sliderValue: number) => {
    // snap back to the nearest power of two so worker payload sizes stay predictable.
    const normalized = Math.min(100, Math.max(0, sliderValue))
    const pow = (normalized / 100) * maxPow
    const nearestPow = Math.round(pow)
    return Math.min(maxLimit, Math.max(minLimit, minLimit * Math.pow(2, nearestPow)))
  }

  // shared run lifecycle: both surfaces are transport strips whose top-edge
  // meterline is the only progress indicator.
  const isDiscovering = isLoading && progress.phase === 'discovering'
  const dockPhase = isLoading
    ? isDiscovering
      ? 'discovering'
      : 'running'
    : cancelled
      ? 'cancelled'
      : success
        ? 'done'
        : 'idle'
  const dockPct = Math.floor(progress.progress * 100)
  const meterWidth = isDiscovering
    ? '0%'
    : dockPhase === 'done'
      ? '100%'
      : `${progress.progress * 100}%`
  const dockStatus = isLoading
    ? isDiscovering
      ? `Discovering combos${progress.discovered ? ` · ${progress.discovered.toLocaleString()}` : '...'}`
      : Number.isFinite(progress.remainingMs)
        ? `${formatOptimizerTime(progress.remainingMs)} left · ${progress.speed.toLocaleString()}/s`
        : progress.total && progress.total > 0
          ? `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}`
          : 'Estimating...'
    : cancelled
      ? 'Cancelled'
      : success
        ? 'Done~!'
        : 'Standby'

  const waveBars = useOptimizerWave(isLoading, progress)

  const waveTrack = (
    <div className="odk-wave" aria-hidden="true">
      {waveBars.map((height, index) => (
        <span
          key={index} className="odk-wave__bar"
          style={height > 0 ? { height: `${Math.max(10, height * 100)}%` } : undefined}
        />
      ))}
    </div>
  )

  const runKey = (
    <button
      type="button" className="odk-key"
      onClick={onRunPtmz}
      disabled={runDsbl}
      aria-label={isLoading ? 'Optimizer running' : 'Run Optimizer'}
    >
      {isLoading ? (
        <>
          <span className="odk-key__pct">{isDiscovering ? '···' : `${dockPct}%`}</span>
          <span className="odk-key__sub">Running</span>
        </>
      ) : (
        <>
          <span className="odk-key__main">Run</span>
          <span className="odk-key__sub">click me..</span>
        </>
      )}
    </button>
  )

  const lmtTune = (
    <div className="odk-tune">
      <span className="odk-tune__label">Limit</span>
      <input
        disabled={isLoading}
        type="range"
        min="0"
        max="100"
        step="1"
        value={lmtToSldrVl(resultsLimit)}
        onChange={(event) => onRsltLmtChn(sldrVlToLmt(Number(event.target.value)))}
      />
      <span className="odk-tune__value">{resultsLimit.toLocaleString()}</span>
    </div>
  )

  const fltrTune = searchMode === 'inventory' ? (
    <div className="odk-tune">
      <span className="odk-tune__label">Filter</span>
      <input
        disabled={isLoading}
        type="range"
        min="0"
        max="0.9"
        step="0.1"
        value={keepPercent}
        onChange={(event) => onKeepPrcnCh(Number(event.target.value))}
      />
      <span className="odk-tune__value">{formatTruncCompact(keepPercent * 100, 0)}%</span>
    </div>
  ) : null

  const memLatch = (
    <button
      type="button"
      className={`odk-btn odk-btn--latch${lowMmryMode ? ' is-active' : ''}`}
      onClick={() => onLowMmryMod(!lowMmryMode)}
      disabled={isLoading}
      aria-pressed={lowMmryMode}
    >
      Low Mem
    </button>
  )

  const runGroup = (
    <div className="odk-group" role="group" aria-label="Run controls">
      <button type="button" className="odk-btn odk-btn--halt" onClick={onHalt}>Halt</button>
      <button type="button" className="odk-btn" onClick={onClear}>Clear</button>
    </div>
  )

  const rsltGroup = (
    <div className="odk-group" role="group" aria-label="Result actions">
      <button type="button" className="odk-btn" onClick={onEquip}>Equip</button>
      <button type="button" className="odk-btn" onClick={onGuide}>Guide</button>
      <button type="button" className="odk-btn" onClick={onRules}>Rules</button>
    </div>
  )

  const modeGroup = (
    <div className="odk-group odk-mode" role="group" aria-label="Optimizer mode">
      <button
        type="button"
        className={`odk-btn${searchMode === 'inventory' ? ' is-active' : ''}`}
        onClick={() => onModeChg('inventory')}
        disabled={isLoading}
        aria-pressed={searchMode === 'inventory'}
      >
        Inventory
      </button>
      <button
        type="button"
        className={`odk-btn${searchMode === 'theory' ? ' is-active' : ''}`}
        onClick={() => onModeChg('theory')}
        disabled={isLoading}
        aria-pressed={searchMode === 'theory'}
      >
        Theorymax
      </button>
    </div>
  )

  if (isWide) {
    // the vertical rail has room for the full metric labels.
    const railRows: Array<[string, string]> = [
      ['Permutations', cmbnLbl],
      ['Processed', progress.processed.toLocaleString()],
      ['Batch Size', batchSize ? batchSize.toLocaleString() : '...'],
      [echoCntLbl, String(fltrEchoCnt)],
      ['Results', resultLength ? String(resultLength) : '...'],
    ]

    return (
      <div className="sticky-wrapper">
        <div className="odk-rail" data-phase={dockPhase}>
          <div className="odk-rail__head">
            <span className="odk-rail__title">Console</span>
            <RailManual />
          </div>
          <div className="odk-rail__body">
            {railRows.map(([label, value]) => (
              <div key={label} className="odk-row">
                <span className="odk-row__label">{label}</span>
                <span className="odk-row__value">{value}</span>
              </div>
            ))}
            {waveTrack}
            <div className="odk-status">{dockStatus}</div>

            <div className="odk-rail__rule" />
            {lmtTune}
            {fltrTune}
            {memLatch}
            <div className="odk-rail__rule" />
            {runGroup}
            {rsltGroup}
            {modeGroup}
          </div>
          {runKey}
        </div>
      </div>
    )
  }

  const tickerCells: Array<[string, string]> = [
    ['Perms', cmbnLbl],
    ['Processed', progress.processed.toLocaleString()],
    ['Batch', batchSize ? batchSize.toLocaleString() : '...'],
    ['Echoes', String(fltrEchoCnt)],
    ['Results', resultLength ? String(resultLength) : '...'],
  ]

  return (
    <div className="odk-dock" data-phase={dockPhase}>
      <div className="odk-charge" aria-hidden="true" style={{ width: meterWidth }} />

      {runKey}

      <div className="odk-body">
        <div className="odk-ticker">
          {tickerCells.map(([label, value]) => (
            <div key={label} className="odk-cell">
              <span className="odk-cell__label">{label}</span>
              <span className="odk-cell__value">{value}</span>
            </div>
          ))}
          <span className="odk-status">{dockStatus}</span>
          {waveTrack}
        </div>

        <div className="odk-actions">
          {lmtTune}
          {fltrTune}
          {memLatch}
          {runGroup}
          {rsltGroup}
          {modeGroup}
        </div>
      </div>
    </div>
  )
}
