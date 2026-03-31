import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { guideSections } from '@/data/content/guidesContent'
import { processGuideHtml } from '@/modules/content/model/guides'
import { Expandable } from '@/shared/ui/Expandable'
import { HtmlContent } from '@/shared/ui/HtmlContent'

export function GuidesPage() {
  const location = useLocation()
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  const sectionMap = useMemo(
    () => Object.fromEntries(guideSections.map((s) => [s.category, s])),
    [],
  )

  const toggleSection = useCallback((category: string, forceOpen?: boolean) => {
    setOpenSections((prev) => ({
      ...prev,
      [category]: forceOpen ?? !prev[category],
    }))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const category = params.get('category') ?? location.hash?.replace('#', '')
    if (!category || !sectionMap[category]) return

    const tryScroll = (attempts = 0) => {
      const target = document.querySelector(`[data-category="${category}"]`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setTimeout(() => toggleSection(category, true), 400)

        const url = new URL(window.location.href)
        url.searchParams.delete('category')
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
        return
      }
      if (attempts < 10) {
        setTimeout(() => tryScroll(attempts + 1), 100)
      }
    }

    tryScroll()
  }, [location, sectionMap, toggleSection])

  return (
    <div className="page guides-page">
      <header className="page-hero">
        <div className="page-hero-eyebrow">Documentation</div>
        <h1>Guides</h1>
        <p className="page-hero-sub">
          Detailed references for every feature in the calculator.
        </p>
      </header>

      <div className="page-bento">
        {guideSections.map((section) => {
          const isOpen = Boolean(openSections[section.category])

          return (
            <Expandable
              key={section.category}
              as="section"
              className="page-tile page-tile--full"
              open={isOpen}
              onOpenChange={(next) => toggleSection(section.category, next)}
              header={
                <div className="guide-section-header" data-category={section.category}>
                  <h3 className="guide-section-title">{section.category}</h3>
                  <span className="page-count-badge">{section.guides.length}</span>
                </div>
              }
            >
              {section.guides.map((guide, index) => (
                <div key={index} className="guide-entry">
                  <h4 className="guide-entry-title">{guide.title}</h4>
                  <p className="guide-entry-short">{guide.shortDesc}</p>
                  <HtmlContent
                    html={processGuideHtml(guide.content)}
                    className="guide-html-content"
                  />
                </div>
              ))}
            </Expandable>
          )
        })}
      </div>
    </div>
  )
}
