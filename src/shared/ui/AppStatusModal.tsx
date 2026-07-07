/*
  Author: Runor Ewhro
  Description: Renders the authored app-status panel, including coverage notes,
               recent updates, and quick navigation links.
*/

import { useNavigate } from 'react-router-dom'
import { AppModal } from '@/shared/ui/AppModal'
import { CURRENT_VERSION } from '@/shared/lib/appMetadata'
import { getLinkedWhatsNew, ltstCurChngE } from '@/data/content/changelogEntries'

const STATUS_DATA = {
  lastUpdated: '28/06/2026',
  overallState: 'stable' as const,
  patchVersion: CURRENT_VERSION,
  dataSources: [
    { label: 'Encore', href: 'https://encore.moe/new?lang=en' },
    { label: 'Nanoka', href: 'https://ww.nanoka.cc/' },
  ],
  notes: [
    'HEWO~! (˶˃ ᵕ ˂˶)',
    'I added LOTS of stuff, i\'d love for you to read up on those (Just click the button below).',
    '3.5.6 update for Yangyang: Xuanling, Suisui, Rover: Electro, Azure Oath (weapon) and Firstlight\'s Herald (weapon)',
    'Enemies still don\'t seem to have an description even in the cn localized data so there\'s not much use in adding them yet UwU.',
  ],
  coverage: [
    { title: 'Resonators', status: 'ok' as const,  desc: 'All resonators supported.' },
    { title: 'Weapons',    status: 'ok' as const,  desc: 'All weapons supported.' },
    { title: 'Echoes',     status: 'ok' as const,  desc: 'All echoes and sonata sets supported.' },
    { title: 'Enemies',    status: 'wip' as const,  desc: 'All but 3.5 enemies supported.' },
  ],
  recentChanges: [
    '3.5.6 update.',
    'Sub stat priority suggestions feature.',
    'Scoring system revamp and a new benchmark page.',
    'Showcase card/stuff... yeah.',
    'A docs page for people that like reading.'
  ],
  knownIssues: [
    "asides the missing game assets... nothing crazy right now :P"
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
  const linkedWhatsNew = getLinkedWhatsNew(ltstCurChngE)
  const latestRoute = linkedWhatsNew ? '/changelog/whatsnew' : '/changelog'
  const latestLabel = linkedWhatsNew ? "See What's New" : 'See Changelog'

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
          onClick={() => { navigate(latestRoute); onClose() }}
        >
          {latestLabel}
        </button>
      </div>
    </AppModal>
  )
}
