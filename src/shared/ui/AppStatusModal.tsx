import { useNavigate } from 'react-router-dom'
import { AppDialog } from '@/shared/ui/AppDialog'

const STATUS_DATA = {
  lastUpdated: '30/03/2026',
  overallState: 'stable' as const,
  patchVersion: '2.4',
  calculatorState: 'Full rebuild for v2. Actively maintained.',
  coverage: [
    { title: 'Character Coverage', status: 'ok' as const, desc: 'All characters carried over from v1.' },
    { title: 'Weapon Coverage',    status: 'ok' as const, desc: 'All weapons supported.' },
    { title: 'Echoes Coverage',    status: 'ok' as const, desc: 'All echoes and sonata sets included.' },
    { title: 'Enemies Coverage',   status: 'ok' as const, desc: 'All enemies are in.' },
    { title: 'Icons & Assets',     status: 'wip' as const, desc: 'Some assets may still be missing.' },
  ],
  knownIssues: [
    'Google Drive sync being wired back in properly.',
    'Some v1 features still being ported over.',
  ],
  recentChanges: [
    'Full rebuild — new architecture, way less suffering.',
    'Revamped calculator, inventory, rotations, optimizer, suggestions.',
  ],
}

const STATE_LABELS = {
  stable:   'All systems nominal',
  degraded: 'Partially updated',
  wip:      'Work in progress',
} as const

const STATUS_COLORS = {
  ok:  'var(--ok)',
  wip: '#f59e0b',
  err: 'var(--danger)',
} as const

interface AppStatusModalProps {
  visible: boolean
  open: boolean
  closing?: boolean
  onClose: () => void
}

export function AppStatusModal({ visible, open, closing = false, onClose }: AppStatusModalProps) {
  const navigate = useNavigate()

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={typeof document !== 'undefined' ? document.body : null}
      contentClassName="app-modal-panel app-status-modal"
      ariaLabel="Calculator Status"
      onClose={onClose}
    >
      <div className="app-status-modal__header">
        <div className="app-status-modal__title-block">
          <span className="app-status-modal__eyebrow">Calculator Status</span>
          <h2 className="app-status-modal__title">Current State</h2>
        </div>
        <div className="app-status-modal__meta">
          <span className={`app-status-modal__badge app-status-modal__badge--${STATUS_DATA.overallState}`}>
            <span className="app-status-modal__dot" />
            {STATE_LABELS[STATUS_DATA.overallState]}
          </span>
          <span className="app-status-modal__updated">Updated: {STATUS_DATA.lastUpdated}</span>
        </div>
      </div>

      <div className="app-status-modal__body">
        <div className="app-status-modal__grid">
          <div className="app-status-card">
            <div className="app-status-card__header">
              <span className="app-status-card__label">Game Patch</span>
              <span className="app-status-card__version">v{STATUS_DATA.patchVersion}</span>
            </div>
            <p className="app-status-card__note">{STATUS_DATA.calculatorState}</p>
          </div>

          {STATUS_DATA.coverage.map((item) => (
            <div key={item.title} className="app-status-card">
              <div className="app-status-card__header">
                <span className="app-status-card__label">{item.title}</span>
                <span
                  className="app-status-card__indicator"
                  style={{ background: STATUS_COLORS[item.status] }}
                />
              </div>
              <p className="app-status-card__note">{item.desc}</p>
            </div>
          ))}
        </div>

        <div className="app-status-modal__panels">
          <div className="app-status-panel">
            <span className="app-status-panel__label">Recent Changes</span>
            {STATUS_DATA.recentChanges.length === 0 ? (
              <p className="app-status-panel__empty">See full changelog for history.</p>
            ) : (
              <ul className="app-status-panel__list">
                {STATUS_DATA.recentChanges.map((entry, i) => <li key={i}>{entry}</li>)}
              </ul>
            )}
          </div>
          <div className="app-status-panel">
            <span className="app-status-panel__label">Known Issues</span>
            {STATUS_DATA.knownIssues.length === 0 ? (
              <p className="app-status-panel__empty">None currently listed.</p>
            ) : (
              <ul className="app-status-panel__list">
                {STATUS_DATA.knownIssues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="app-status-modal__footer">
        <button
          type="button"
          className="confirmation-modal__btn"
          onClick={onClose}
        >
          Close
        </button>
        <button
          type="button"
          className="confirmation-modal__btn app-modal-close picker-modal__close"
          onClick={() => { navigate('/changelog'); onClose() }}
        >
          See Changelog
        </button>
      </div>
    </AppDialog>
  )
}
