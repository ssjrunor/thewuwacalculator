/*
  Author: Runor Ewhro
  Description: Renders the authored app-status panel, including coverage notes,
               recent updates, and quick navigation links.
*/

import { useNavigate } from 'react-router-dom'
import { AppModal } from '@/shared/ui/AppModal'
import { CURRENT_VERSION } from '@/shared/lib/appMetadata'

const STATUS_DATA = {
  lastUpdated: '09/06/2026',
  overallState: 'stable' as const,
  patchVersion: CURRENT_VERSION,
  dataSources: [
    { label: 'Encore', href: 'https://encore.moe/new?lang=en' },
    { label: 'Nanoka', href: 'https://ww.nanoka.cc/' },
  ],
  notes: [
    'HEWO~! (˶˃ ᵕ ˂˶)',
    'I tried my best, added 3.5 beta stuff and even preset rotations to the best of my understanding. Electro rover hasn\'t been added yet',
    'I have some stuff in the works *wink* *wink* *nudge* *nudge* ◕⩊◕.',
    'Lucy / Rebecca have their Prydwen rotations now too so no more of my nonsense haha...',
    'okay i lied... more of my nonsense... i added preset rotations for Suisui and Yangyang: Xuanling crafted from my intuition ofc.'
  ],
  coverage: [
    { title: 'Resonators', status: 'wip' as const,  desc: 'No electro rover :(.' },
    { title: 'Weapons',    status: 'ok' as const,  desc: 'All weapons supported.' },
    { title: 'Echoes',     status: 'wip' as const,  desc: 'All but 3.5 echoes and sonata sets included.' },
    { title: 'Enemies',    status: 'wip' as const,  desc: 'All but 3.5 enemies supported.' },
  ],
  recentChanges: [
    'You can setup echoes faster now with the quick-setup/forge thingy.',
    'More conditions in the rotation conditions editor!',
    'YANGYANG ... SUISUI.',
  ],
  knownIssues: [
    "asides from the missing beta stuff i pointed out... nothing crazy right now :)"
  ]
}

const STATE_LABELS = {
  stable:   'NOMINAL',
  degraded: 'DEGRADED',
  wip:      'IN PROGRESS',
} as const

interface AppSttsMdlPr {
  visible: boolean
  open: boolean
  closing?: boolean
  onClose: () => void
}

export function AppSttsMdl({ visible, open, closing = false, onClose }: AppSttsMdlPr) {
  const navigate = useNavigate()

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="app-status"
      ariaLabel="Calculator Status"
      onClose={onClose}
    >
      <div className="app-status-modal__header">
        <span className="app-status-modal__eyebrow">Calculator Status</span>
        <span className="app-status-modal__title">System Report</span>
      </div>

      <div className="app-status-bento">

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
              <span className="app-status-hero__stat-value">v{STATUS_DATA.patchVersion}</span>
            </div>
            <div className="app-status-hero__stat">
              <span className="app-status-hero__stat-label">Sources</span>
              <div className="app-status-hero__source-links">
                {STATUS_DATA.dataSources.map((source) => (
                  <a
                    key={source.label}
                    className="app-status-hero__stat-value app-status-hero__stat-value--link"
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.label}
                    <svg className="app-status-hero__ext-icon" viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M1 9 9 1M9 1H4M9 1v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    </svg>
                  </a>
                ))}
              </div>
            </div>
            <div className="app-status-hero__stat">
              <span className="app-status-hero__stat-label">Updated</span>
              <span className="app-status-hero__stat-value">{STATUS_DATA.lastUpdated}</span>
            </div>
          </div>
        </div>

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

        <div className="app-status-changes">
          <div className="app-status-panel__eyebrow">Recent Changes / Updates</div>
          {STATUS_DATA.recentChanges.map((entry, i) => (
            <div key={i} className={`app-status-item app-status-item--${i + 1}`}>
              <span className="app-status-item__marker" aria-hidden="true">›</span>
              <span className="app-status-item__text">{entry}</span>
            </div>
          ))}
        </div>

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
    </AppModal>
  )
}
