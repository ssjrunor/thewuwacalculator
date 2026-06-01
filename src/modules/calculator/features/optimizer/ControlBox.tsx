/*
  Author: Runor Ewhro
  Description: Renders the control box surface for the calculator optimizer flow.
*/

import { Info } from 'lucide-react'
import type { OptSearchMode } from '@/domain/entities/optimizer'
import type { OptPrgr } from '@/engine/optimizer/types'

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
  onReset: () => void
  onHalt: () => void
  onEquip: () => void
  onGuide: () => void
  onRules: () => void
  onClear: () => void
}

function formatTime(ms: number): string {
  // optimizer progress reports milliseconds; the panel keeps the display coarse so it does not flicker every frame.
  if (!Number.isFinite(ms)) return 'Calculating...'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min === 0) return `${sec}s`
  return `${min}m ${sec}s`
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
  onReset,
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

  const prmtSctn = (
    // permutation metrics are separated from progress because combinations can still be pending while a run has not
    // started.
    <>
      <div className="perm-row">
        <span className="perm-name">Permutations</span>
        <div className="dash-separator" />
        <span className="perm-value">{cmbnLbl}</span>
      </div>
      <div className="perm-row">
        <span className="perm-name">Processed</span>
        <div className="dash-separator" />
        <span className="perm-value">{progress.processed.toLocaleString()}</span>
      </div>
      <div className="perm-row">
        <span className="perm-name">Batch Size</span>
        <div className="dash-separator" />
        <span className="perm-value">{batchSize ? batchSize.toLocaleString() : '...'}</span>
      </div>
      <div className="perm-row">
        <span className="perm-name">{echoCntLbl}</span>
        <div className="dash-separator" />
        <span className="perm-value">{fltrEchoCnt}</span>
      </div>
      <div className="perm-row">
        <span className="perm-name">Results</span>
        <div className="dash-separator" />
        <span className="perm-value">{resultLength || '...'}</span>
      </div>
    </>
  )

  const isDiscovering = isLoading && progress.phase === 'discovering'
  const prgrSctn = (
    // cancelled and completed runs reuse the same progress bar so the user can still see how far a halted run got.
    <>
      <div className="section-title section-title--progress">
        <span>
          {isLoading
            ? isDiscovering
              ? `Discovering combos${progress.discovered ? ` - ${progress.discovered.toLocaleString()}` : '...'}`
              : Number.isFinite(progress.remainingMs)
                ? ` Time left - ${formatTime(progress.remainingMs)} (${progress.speed.toLocaleString()} / sec)`
                : progress.total && progress.total > 0
                  ? `Processed - ${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}`
                  : 'Estimating...'
            : cancelled
              ? 'Cancelled'
              : 'Progress'}
        </span>
        <span>{success ? 'Done~!' : ''}</span>
      </div>
      <div className={`progress-bar${isDiscovering ? ' progress-bar--indeterminate' : ''}`}>
        <div
          className="progress-bar-inner"
          style={{ width: isDiscovering ? '0%' : `${progress.progress * 100}%` }}
        />
      </div>
      <div className="progress-label">
        {isDiscovering ? '...' : `${Math.floor(progress.progress * 100)}%`}
      </div>
    </>
  )

  const cnfgSctn = (
    // configuration controls stay disabled during a run because they affect worker batching and result pruning.
    <div className="optimizer-configurations">
      <div className="slider-group">
        <div className="slider-item">
          <span>Result Limit</span>
          <div className="dash-separator" />
          <span>{resultsLimit.toLocaleString()}</span>
        </div>
        <div className="slider-row">
          <input
            disabled={isLoading}
            type="range"
            min="0"
            max="100"
            step="1"
            value={lmtToSldrVl(resultsLimit)}
            onChange={(event) => onRsltLmtChn(sldrVlToLmt(Number(event.target.value)))}
          />
        </div>
      </div>
      {searchMode === 'inventory' ? (
        <div className="slider-group">
          <div className="slider-item">
            <span>Filter Strength</span>
            <div className="dash-separator" />
            <span>{(keepPercent * 100).toFixed(0)}%</span>
          </div>
          <div className="slider-row">
            <input
              disabled={isLoading}
              type="range"
              min="0"
              max="0.9"
              step="0.1"
              value={keepPercent}
              onChange={(event) => onKeepPrcnCh(Number(event.target.value))}
            />
          </div>
        </div>
      ) : null}
      <div className="config-toggle-row">
        <span className="config-toggle-label">Low Memory</span>
        <button
          type="button"
          className={`config-toggle-button${lowMmryMode ? ' is-active' : ''}`}
          onClick={() => onLowMmryMod(!lowMmryMode)}
          disabled={isLoading}
          aria-pressed={lowMmryMode}
        >
          {lowMmryMode ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  )

  const modeSctn = (
    <div className="opt-mode-switch" role="group" aria-label="Optimizer mode">
      <button
        type="button"
        className={`opt-mode-btn${searchMode === 'inventory' ? ' is-active' : ''} ui-pill-button`}
        onClick={() => onModeChg('inventory')}
        disabled={isLoading}
        aria-pressed={searchMode === 'inventory'}
      >
        Inventory
      </button>
      <button
        type="button"
        className={`opt-mode-btn${searchMode === 'theory' ? ' is-active' : ''} ui-pill-button`}
        onClick={() => onModeChg('theory')}
        disabled={isLoading}
        aria-pressed={searchMode === 'theory'}
      >
        Theorymax
      </button>
    </div>
  )

  if (isWide) {
    return (
      <div className="sticky-wrapper">
        <div className="sticky-controls">
          <div className="section-title-row">
            <span className="section-title">Permutations</span>
            <span className="icon-help">
              <Info size={16} />
            </span>
          </div>

          {prmtSctn}
          {prgrSctn}

          <div className="section-title">Controls</div>

          <button
            className={`ui-pill-button${isLoading ? ' optimizer-run-btn--loading' : ''}`}
            onClick={onRunPtmz}
            disabled={runDsbl}
          >
            {!isLoading ? 'Run Optimizer' : 'Running...'}
          </button>

          <div className="row-buttons">
            <button className="ui-pill-button" onClick={onReset}>
              Reset
            </button>
            <button className="ui-pill-button" onClick={onHalt}>
              HALT
            </button>
            <button className="ui-pill-button" onClick={onClear}>
              Clear
            </button>
          </div>

          <div className="section-title-row">
            <span className="section-title">Configurations</span>
            <span className="icon-help">
              <Info size={16} />
            </span>
          </div>

          {cnfgSctn}

          <div className="section-title-row">
            <span className="section-title">Results</span>
          </div>

          <div className="row-buttons">
            <button className="ui-pill-button" onClick={onEquip}>
              Equip
            </button>
            <button className="ui-pill-button" onClick={onGuide}>
              Guide
            </button>
            <button className="ui-pill-button" onClick={onRules}>
              Rules
            </button>
          </div>
          {modeSctn}
        </div>
      </div>
    )
  }

  return (
    <div className="sticky-controls bottom landscape">
      <div className="optimizer-landscape-row">
        <div className="optimizer-col metrics">
          <div className="section-title-row">
            <span className="section-title">Permutations</span>
            <span className="icon-help">
              <Info size={16} />
            </span>
          </div>
          <div className="perm-row">
            <span className="perm-name">Permutations</span>
            <div className="dash-separator" />
            <span className="perm-value">{cmbnLbl}</span>
          </div>
          <div className="perm-row">
            <span className="perm-name">Processed</span>
            <div className="dash-separator" />
            <span className="perm-value">{progress.processed.toLocaleString()}</span>
          </div>
          <div className="perm-row">
            <span className="perm-name">Batch Size</span>
            <div className="dash-separator" />
            <span className="perm-value">{batchSize ? batchSize.toLocaleString() : '...'}</span>
          </div>
        </div>

        <div className="optimizer-col metrics">
          <div className="perm-row">
            <span className="perm-name">{echoCntLbl}</span>
            <div className="dash-separator" />
            <span className="perm-value">{fltrEchoCnt}</span>
          </div>
          <div className="perm-row">
            <span className="perm-name">Results</span>
            <div className="dash-separator" />
            <span className="perm-value">{resultLength || '...'}</span>
          </div>
          {prgrSctn}
        </div>

        <div className="optimizer-col config">
          <div className="section-title-row">
            <span className="section-title">Configurations</span>
            <span className="icon-help">
              <Info size={16} />
            </span>
          </div>
          {cnfgSctn}
        </div>

        <div className="optimizer-col controls">
          <div className="section-title">Controls</div>
          <button
            className={`ui-pill-button${isLoading ? ' optimizer-run-btn--loading' : ''}`}
            onClick={onRunPtmz}
            disabled={runDsbl}
          >
            {!isLoading ? 'Run Optimizer' : 'Running...'}
          </button>
          <div className="row-buttons">
            <button className="ui-pill-button" onClick={onReset}>
              Reset
            </button>
            <button className="ui-pill-button" onClick={onHalt}>
              HALT
            </button>
            <button className="ui-pill-button" onClick={onClear}>
              Clear
            </button>
          </div>
        </div>

        <div className="optimizer-col controls">
          <span className="section-title">Results</span>
          <div className="row-buttons">
            <button className="ui-pill-button" onClick={onEquip}>
              Equip
            </button>
            <button className="ui-pill-button" onClick={onGuide}>
              Guide
            </button>
            <button className="ui-pill-button" onClick={onRules}>
              Rules
            </button>
          </div>
          {modeSctn}
        </div>
      </div>
    </div>
  )
}
