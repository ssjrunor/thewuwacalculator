import { Info } from 'lucide-react'
import type { OptimizerProgress } from '@/engine/optimizer/types'

interface OptimizerControlBoxProps {
  isWide?: boolean
  isLoading: boolean
  pendingCombinations?: boolean
  progress: OptimizerProgress
  success: boolean
  cancelled: boolean
  resultLength: number
  filteredEchoCount: number
  combinationsLabel?: string
  batchSize?: number | null
  resultsLimit: number
  keepPercent: number
  lowMemoryMode: boolean
  onResultsLimitChange: (value: number) => void
  onKeepPercentChange: (value: number) => void
  onLowMemoryModeChange: (value: boolean) => void
  onRunOptimizer: () => void
  onReset: () => void
  onHalt: () => void
  onEquip: () => void
  onGuide: () => void
  onRules: () => void
  onClear: () => void
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return 'Calculating...'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min === 0) return `${sec}s`
  return `${min}m ${sec}s`
}

export function OptimizerControlBox({
  isWide = true,
  isLoading,
  pendingCombinations = false,
  progress,
  success,
  cancelled,
  resultLength,
  filteredEchoCount,
  combinationsLabel = '...',
  batchSize = null,
  resultsLimit,
  keepPercent,
  lowMemoryMode,
  onResultsLimitChange,
  onKeepPercentChange,
  onLowMemoryModeChange,
  onRunOptimizer,
  onReset,
  onHalt,
  onEquip,
  onGuide,
  onRules,
  onClear,
}: OptimizerControlBoxProps) {
  const minLimit = 64
  const maxLimit = 65536
  const maxPow = Math.log2(maxLimit / minLimit)

  const limitToSliderValue = (limit: number) => {
    const clamped = Math.min(maxLimit, Math.max(minLimit, limit))
    const pow = Math.log2(clamped / minLimit)
    return (pow / maxPow) * 100
  }

  const sliderValueToLimit = (sliderValue: number) => {
    const normalized = Math.min(100, Math.max(0, sliderValue))
    const pow = (normalized / 100) * maxPow
    const nearestPow = Math.round(pow)
    return Math.min(maxLimit, Math.max(minLimit, minLimit * Math.pow(2, nearestPow)))
  }

  const permutationsSection = (
    <>
      <div className="perm-row">
        <span className="perm-name">Permutations</span>
        <div className="dash-separator" />
        <span className="perm-value">{combinationsLabel}</span>
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
        <span className="perm-name">Filtered Echoes</span>
        <div className="dash-separator" />
        <span className="perm-value">{filteredEchoCount}</span>
      </div>
      <div className="perm-row">
        <span className="perm-name">Results</span>
        <div className="dash-separator" />
        <span className="perm-value">{resultLength || '...'}</span>
      </div>
    </>
  )

  const progressSection = (
    <>
      <div className="section-title section-title--progress">
        <span>
          {isLoading
            ? Number.isFinite(progress.remainingMs)
              ? ` Time left - ${formatTime(progress.remainingMs)} (${progress.speed.toLocaleString()} / sec)`
              : 'Estimating...'
            : cancelled
              ? 'Cancelled'
              : 'Progress'}
        </span>
        <span>{success ? 'Done~!' : ''}</span>
      </div>
      <div className="progress-bar">
        <div className="progress-bar-inner" style={{ width: `${progress.progress * 100}%` }} />
      </div>
      <div className="progress-label">{Math.floor(progress.progress * 100)}%</div>
    </>
  )

  const configurationsSection = (
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
            value={limitToSliderValue(resultsLimit)}
            onChange={(event) => onResultsLimitChange(sliderValueToLimit(Number(event.target.value)))}
          />
        </div>
      </div>
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
            onChange={(event) => onKeepPercentChange(Number(event.target.value))}
          />
        </div>
      </div>
      <div className="config-toggle-row">
        <span className="config-toggle-label">Low Memory</span>
        <button
          type="button"
          className={`config-toggle-button${lowMemoryMode ? ' is-active' : ''}`}
          onClick={() => onLowMemoryModeChange(!lowMemoryMode)}
          disabled={isLoading}
          aria-pressed={lowMemoryMode}
        >
          {lowMemoryMode ? 'On' : 'Off'}
        </button>
      </div>
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

          {permutationsSection}
          {progressSection}

          <div className="section-title">Controls</div>

          <button
            className={`ui-pill-button${isLoading ? ' optimizer-run-btn--loading' : ''}`}
            onClick={onRunOptimizer}
            disabled={isLoading || pendingCombinations}
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
          </div>

          <div className="section-title-row">
            <span className="section-title">Configurations</span>
            <span className="icon-help">
              <Info size={16} />
            </span>
          </div>

          {configurationsSection}

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
          <div className="row-buttons">
            <button className="ui-pill-button" onClick={onClear}>
              Clear
            </button>
          </div>
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
            <span className="perm-value">{combinationsLabel}</span>
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
            <span className="perm-name">Filtered Echoes</span>
            <div className="dash-separator" />
            <span className="perm-value">{filteredEchoCount}</span>
          </div>
          <div className="perm-row">
            <span className="perm-name">Results</span>
            <div className="dash-separator" />
            <span className="perm-value">{resultLength || '...'}</span>
          </div>
          {progressSection}
        </div>

        <div className="optimizer-col config">
          <div className="section-title-row">
            <span className="section-title">Configurations</span>
            <span className="icon-help">
              <Info size={16} />
            </span>
          </div>
          {configurationsSection}
        </div>

        <div className="optimizer-col controls">
          <div className="section-title">Controls</div>
          <button
            className={`ui-pill-button${isLoading ? ' optimizer-run-btn--loading' : ''}`}
            onClick={onRunOptimizer}
            disabled={isLoading || pendingCombinations}
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
          </div>
        </div>

        <div className="optimizer-col controls">
          <span className="section-title">Results</span>
          <div className="row-buttons">
            <button className="ui-pill-button" onClick={onEquip}>
              Equip
            </button>
            <button className="ui-pill-button" onClick={onClear}>
              Clear
            </button>
          </div>
          <div className="row-buttons">
            <button className="ui-pill-button" onClick={onGuide}>
              Guide
            </button>
            <button className="ui-pill-button" onClick={onRules}>
              Rules
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
