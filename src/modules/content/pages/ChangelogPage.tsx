/*
  Author: Runor Ewhro
  Description: Renders the changelog page.
*/

import React from 'react'
import { chngSctn } from '@/data/content/changelogEntries'
import { HtmlContent } from '@/shared/ui/HtmlContent'
import { History } from 'lucide-react'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'

export function ChngPage() {
  return (
    <div className="page">
      <CllpPageHeyf
        eyebrow="History"
        title="Changelog"
        subtitle="Complete history of updates and patches."
        layoutKey="changelog-hero"
      />

      <div className="page-bento">
        {chngSctn.map((section, sectionIndex) => {
          const rvrsEnts = [...section.entries].reverse()

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
              {rvrsEnts.map((log, index) => (
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
