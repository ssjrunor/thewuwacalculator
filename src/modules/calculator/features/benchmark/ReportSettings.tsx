import type { BenchRptSettings } from '@/domain/entities/preferences'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import type { AppMdlStt } from '@/shared/ui/AppModal.tsx'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton.tsx'

const REPORT_SETTING_ROWS: Array<{
  key: keyof BenchRptSettings
  label: string
  desc: string
}> = [
  { key: 'buildDetails', label: 'Build details', desc: 'The full build breakdown' },
  { key: 'echoStatsTable', label: 'Echo stats table', desc: 'Each echo’s substats in a table' },
  { key: 'rotationFeatures', label: 'Rotation features', desc: 'Rotation action and feature notes' },
  { key: 'upgradePaths', label: 'Upgrade paths', desc: 'Suggested main stat and Sonata upgrades' },
  { key: 'activeStateSources', label: 'Active state sources', desc: 'Where each active buff and state comes from' },
  { key: 'benchmarkTargets', label: 'Benchmark 100% & 200%', desc: 'Compare your build against the 100% and 200% targets' },
]

export function ReportSettingsModal({
  state,
  settings,
  onChange,
  onClose,
}: {
  state: AppMdlStt
  settings: BenchRptSettings
  onChange: (patch: Partial<BenchRptSettings>) => void
  onClose: () => void
}) {
  const total = REPORT_SETTING_ROWS.length
  const shownCount = REPORT_SETTING_ROWS.filter((row) => settings[row.key]).length

  return (
    <AppModal
      state={state}
      variant="confirmation"
      ariaLabel="Benchmark report settings"
      onClose={onClose}
    >
      <div className="confirmation-modal__body bench-report-settings-modal">
        <div className="bench-rs-head">
          <div className="bench-rs-id">
            <h2 className="confirmation-modal__title bench-rs-title">Report Settings</h2>
            <p className="bench-rs-sub">
              <span>Pick which sections to include.</span>
              <span className="bench-rs-count">
                <b>{shownCount}</b> of {total} shown
              </span>
            </p>
          </div>
          <MdlClsBttn onClick={onClose} />
        </div>
        <ul className="bench-rs-list">
          {REPORT_SETTING_ROWS.map((row) => {
            const checked = settings[row.key]
            return (
              <li key={row.key} className="bench-rs-item">
                <label className={`bench-rs-row${checked ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    className="bench-rs-check"
                    checked={checked}
                    onChange={(event) => onChange({ [row.key]: event.currentTarget.checked })}
                  />
                  <span className="bench-rs-text">
                    <span className="bench-rs-name">{row.label}</span>
                    <span className="bench-rs-desc">{row.desc}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>
    </AppModal>
  )
}
