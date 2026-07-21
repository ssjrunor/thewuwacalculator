/*
  Author: Runor Ewhro
  Description: renders the changelog page.
*/

import React from 'react'
import { Link } from 'react-router-dom'
import { chngSctn, getLatestWhatsNew, getLinkedWhatsNew, ltstCurChngE } from '@/data/content/changelogEntries'
import { HtmlContent } from '@/shared/ui/HtmlContent'
import { History, Radio, ArrowRight } from 'lucide-react'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'

export function ChngPage() {
  const linkedLatestWhatsNew = getLinkedWhatsNew(ltstCurChngE)
  const latestWhatsNewId = getLatestWhatsNew()?.id ?? null

  return (
    <div className="page">
      <CllpPageHeyf
        variant="split"
        eyebrow="History"
        title="Changelog"
        meta="Complete history of updates and patches."
        layoutKey="changelog-hero"
        trailing={
          linkedLatestWhatsNew ? (
            <Link to="/changelog/whatsnew" className="changelog-whatsnew-cta">
              <span className="changelog-whatsnew-cta__icon" aria-hidden="true">
                <Radio size={18} />
              </span>
              <span className="changelog-whatsnew-cta__text">
                <span className="changelog-whatsnew-cta__eyebrow">What's New · on air</span>
                <span className="changelog-whatsnew-cta__title">{linkedLatestWhatsNew.title}</span>
              </span>
              <ArrowRight size={16} className="changelog-whatsnew-cta__arrow" aria-hidden="true" />
            </Link>
          ) : undefined
        }
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
              {rvrsEnts.map((log, index) => {
                const linkedWhatsNew = getLinkedWhatsNew(log)
                const showWhatsNewLink = Boolean(linkedWhatsNew && linkedWhatsNew.id !== latestWhatsNewId)

                return (
                  <section key={`${section.id}-${index}`} className="page-tile page-tile--full changelog-entry">
                    <div className="changelog-header">
                      <div className="tile-icon"><History /></div>
                      <div className="changelog-header-text">
                        <h3 className="changelog-date">{log.date}</h3>
                        {log.patchVersion && (
                          <span className="page-pill">{log.patchVersion}</span>
                        )}
                      </div>
                      {showWhatsNewLink && linkedWhatsNew ? (
                        <Link
                          to={`/changelog/whatsnew#${linkedWhatsNew.id}`}
                          className="changelog-whatsnew-cta changelog-whatsnew-cta--entry"
                        >
                          <span className="changelog-whatsnew-cta__icon" aria-hidden="true">
                            <Radio size={16} />
                          </span>
                          <span className="changelog-whatsnew-cta__text">
                            <span className="changelog-whatsnew-cta__eyebrow">What's New · archive</span>
                            <span className="changelog-whatsnew-cta__title">{linkedWhatsNew.title}</span>
                          </span>
                          <ArrowRight size={16} className="changelog-whatsnew-cta__arrow" aria-hidden="true" />
                        </Link>
                      ) : null}
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
                )
              })}
            </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
