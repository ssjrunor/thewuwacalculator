import { ArrowRightLeft, Eye, Gauge, RefreshCw, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react'
import type { BenchmarkViewMode } from '@/domain/entities/preferences'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

interface BenchmarkToolbarProps {
  name: string
  attributeIcon: string | null
  animatedPortraits: boolean
  viewMode: BenchmarkViewMode
  canSwitch: boolean
  canDelete: boolean
  onAnimatedPortraitsChange: (enabled: boolean) => void
  onViewModeChange: (mode: BenchmarkViewMode) => void
  onSwitch: () => void
  onRefresh: () => void
  onOpenReportSettings: () => void
  onDelete: () => void
  onClose: () => void
}

export function BenchmarkToolbar({
  name,
  attributeIcon,
  animatedPortraits,
  viewMode,
  canSwitch,
  canDelete,
  onAnimatedPortraitsChange,
  onViewModeChange,
  onSwitch,
  onRefresh,
  onOpenReportSettings,
  onDelete,
  onClose,
}: BenchmarkToolbarProps) {
  const isShowcase = viewMode === 'showcase'
  const copy = isShowcase ? 'Showcase' : 'Benchmark'

  return (
    <header className="bench-topbar">
      <div className="bench-topbar-id">
        <span className="bench-eyebrow">Build {copy}</span>
        <h2 className="bench-title">
          {attributeIcon ? (
            <img src={attributeIcon} alt="" className="bench-title-attr" loading="lazy" onError={withDefIconM} />
          ) : null}
          {name}
        </h2>
      </div>
      <div className="bench-topbar-actions">
        <button
          type="button"
          className="bench-btn bench-btn--toggle"
          aria-pressed={animatedPortraits}
          aria-label={`Turn animated 2D portraits ${animatedPortraits ? 'off' : 'on'}`}
          onClick={() => onAnimatedPortraitsChange(!animatedPortraits)}
        >
          <Sparkles aria-hidden="true" size={14} />
          2D {animatedPortraits ? 'On' : 'Off'}
        </button>
        <div className="bench-mode-switch" role="group" aria-label="Build view">
          <button
            type="button"
            className={`bench-btn${viewMode === 'benchmark' ? ' is-active' : ''}`}
            aria-pressed={viewMode === 'benchmark'}
            onClick={() => onViewModeChange('benchmark')}
          >
            {viewMode === 'benchmark' && (<Gauge aria-hidden="true" size={14} />)}
            Benchmark
          </button>
          <button
            type="button"
            className={`bench-btn${isShowcase ? ' is-active' : ''}`}
            aria-pressed={isShowcase}
            onClick={() => onViewModeChange('showcase')}
          >
            {isShowcase && (<Eye aria-hidden="true" size={14} />)}
            Showcase
          </button>
        </div>
        {canSwitch ? (
          <button type="button" className="bench-btn bench-btn--switch" onClick={onSwitch}>
            <ArrowRightLeft aria-hidden="true" size={14} />
            Switch
          </button>
        ) : null}
        {!isShowcase ? (
          <>
            <button type="button" className="bench-btn bench-btn--settings" onClick={onOpenReportSettings}>
              <SlidersHorizontal aria-hidden="true" size={14} />
              Report
            </button>
            <button type="button" className="bench-btn bench-btn--refresh" onClick={onRefresh}>
              <RefreshCw aria-hidden="true" size={14} />
              Refresh
            </button>
          </>
        ) : null}
        <button type="button" className="bench-btn bench-btn--delete" disabled={!canDelete} onClick={onDelete}>
          <Trash2 aria-hidden="true" size={14} />
          Delete
        </button>
        <button type="button" className="bench-btn bench-btn--ghost" onClick={onClose}>
          <X aria-hidden="true" size={14} />
          Close
        </button>
      </div>
    </header>
  )
}
