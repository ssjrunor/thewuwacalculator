import { useNavigate } from 'react-router-dom'
import { AppDialog } from '@/shared/ui/AppDialog'

const STATUS_DATA = {
  lastUpdated: '30/03/2026',
  overallState: 'wip' as const,
  patchVersion: '2.4',
  patchVersionUrl: 'https://encore.moe/new?lang=en',
  notes: [
      'HIIII~! Welcome if you\'re not from the server and you found this, how nice, if you are, how nice.',
      'If you see something amiss, do not fret. This is still in it\'s testing phase, so things may be broken. If you find a bug or you have a suggestion, please report it on the Discord server (˶˃⤙˂˶).',
      'Beware, data might "mysteriously" disappear as i tweak things. Keep this in mind while you use the app.',
    'This is a full rebuild. The architecture is new, most things should feel faster and more stable.',
  ],
  coverage: [
    { title: 'Characters', status: 'ok' as const,  desc: 'All resonators supported.' },
    { title: 'Weapons',    status: 'ok' as const,  desc: 'All weapons supported.' },
    { title: 'Echoes',     status: 'ok' as const,  desc: 'All echoes and sonata sets included.' },
    { title: 'Enemies',    status: 'ok' as const,  desc: 'All enemies are in.' },
    { title: 'Assets',     status: 'ok' as const, desc: 'All assets are in.' },
  ],
  knownIssues: [
    'Full sonata set condition custom configurations for optimizer related features are not yet implemented.',
    'The guides system not fully implemented yet.',
    'Some v1 features still being ported over.',
  ],
  recentChanges: [
    'Revamped calculator, inventory, rotations, optimizer... etc.',
  ],
}

const STATE_LABELS = {
  stable:   'NOMINAL',
  degraded: 'DEGRADED',
  wip:      'IN PROGRESS',
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
      {/* Header */}
      <div className="app-status-modal__header">
        <span className="app-status-modal__eyebrow">Calculator Status</span>
        <span className="app-status-modal__title">System Report</span>
      </div>

      {/* Bento grid */}
      <div className="app-status-bento">

        {/* Hero cell */}
        <div className="app-status-hero">
          <div className="app-status-hero__notes-label">Dev Notes</div>
          <div className="app-status-hero__notes">
            {STATUS_DATA.notes.map((note, i) => (
              <p key={i} className="app-status-hero__note">{note}</p>
            ))}
          </div>
          <div className="app-status-hero__footer">
            <div className="app-status-hero__stat">
              <span className="app-status-hero__stat-label">Status</span>
              <span className="app-status-hero__stat-value app-status-hero__stat-value--status">
                <span className="app-status-hero__dot" aria-hidden="true" />
                {STATE_LABELS[STATUS_DATA.overallState]}
              </span>
            </div>
            <div className="app-status-hero__stat">
              <span className="app-status-hero__stat-label">Patch</span>
              <a
                className="app-status-hero__stat-value app-status-hero__stat-value--link"
                href={STATUS_DATA.patchVersionUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                v{STATUS_DATA.patchVersion}
                <svg className="app-status-hero__ext-icon" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M1 9 9 1M9 1H4M9 1v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
              </a>
            </div>
            <div className="app-status-hero__stat">
              <span className="app-status-hero__stat-label">Updated</span>
              <span className="app-status-hero__stat-value">{STATUS_DATA.lastUpdated}</span>
            </div>
          </div>
        </div>

        {/* Coverage cards */}
        {STATUS_DATA.coverage.map((item, i) => (
          <div
            key={item.title}
            className={`app-status-card app-status-card--${item.status} app-status-card--${i + 1}`}
          >
            <div className="app-status-card__top">
              <span className="app-status-card__label">{item.title}</span>
              <span
                className={`app-status-card__dot app-status-card__dot--${item.status}`}
                aria-hidden="true"
              />
            </div>
            <p className="app-status-card__desc">{item.desc}</p>
          </div>
        ))}

        {/* Changes panel */}
        <div className="app-status-changes">
          <div className="app-status-panel__eyebrow">Recent Changes</div>
          {STATUS_DATA.recentChanges.map((entry, i) => (
            <div key={i} className={`app-status-item app-status-item--${i + 1}`}>
              <span className="app-status-item__marker" aria-hidden="true">›</span>
              <span className="app-status-item__text">{entry}</span>
            </div>
          ))}
        </div>

        {/* Issues panel */}
        <div className="app-status-issues">
          <div className="app-status-panel__eyebrow">Known Issues</div>
          {STATUS_DATA.knownIssues.map((issue, i) => (
            <div key={i} className={`app-status-item app-status-item--iss${i + 1}`}>
              <span className="app-status-item__marker app-status-item__marker--warn" aria-hidden="true">!</span>
              <span className="app-status-item__text">{issue}</span>
            </div>
          ))}
        </div>

      </div>

      {/* Footer */}
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
          className="confirmation-modal__btn"
          onClick={() => { navigate('/changelog'); onClose() }}
        >
          See Changelog
        </button>
      </div>
    </AppDialog>
  )
}
