import React from 'react'
import { changelogSections } from '@/data/content/changelogEntries'
import { HtmlContent } from '@/shared/ui/HtmlContent'
import { History } from 'lucide-react'

export function ChangelogPage() {
  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-eyebrow">History</div>
        <h1>Changelog</h1>
        <p className="page-hero-sub">
          Complete history of updates and patches.
        </p>
      </header>

      <div className="page-bento">
        {changelogSections.map((section, sectionIndex) => {
          const reversedEntries = [...section.entries].reverse()

          return (
            <React.Fragment key={section.id}>
              {sectionIndex > 0 ? (
                <div className="changelog-section-divider" aria-label={`${section.label} changelog`}>
                  <span className="changelog-section-divider__line" />
                  <div className="changelog-section-divider__content">
                    <span className="changelog-section-divider__label">{section.label}</span>
                    <span className="changelog-section-divider__sub">old stuff below...</span>
                  </div>
                  <span className="changelog-section-divider__line" />
                </div>
              ) : null}

            <div className="changelog-section">
              {reversedEntries.map((log, index) => (
                <section key={`${section.id}-${index}`} className="page-tile page-tile--full changelog-entry">
                  <div className="changelog-header">
                    <div className="tile-icon"><History /></div>
                    <div className="changelog-header-text">
                      <h3 className="changelog-date">{log.date}</h3>
                      {log.patchVersion && (
                        <span className="page-pill">{log.patchVersion}</span>
                      )}
                    </div>
                  </div>
                  {log.shortDesc && (
                    <HtmlContent html={log.shortDesc} className="changelog-short" as="span" />
                  )}
                  <ul className="changelog-detail-list">
                    {log.entries.map((entry, entryIndex) =>
                      entry.type === 'paragraph' ? (
                        <HtmlContent key={entryIndex} html={entry.content} as="li" />
                      ) : null,
                    )}
                  </ul>
                </section>
              ))}
            </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
