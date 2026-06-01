/*
  Author: Runor Ewhro
  Description: Guides page rendered as an editorial codex. The index view is
               a two-column grid of numbered chapter cards with dotted-leader
               article tables of contents. Selecting a chapter swaps the
               canvas for a full-width reader with a sticky in-chapter TOC,
               numbered articles, and block treatments tuned per type.
*/

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties as CssProps,
  type KeyboardEvent as RctKybrVnt,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence as NmtPrsn, LayoutGroup, motion } from 'motion/react'
import { ChevronLeft, Search, X } from 'lucide-react'
import {
  gdCtgr,
  type GuideArticle,
  type GuideBlock,
  type GuideCategory,
} from '@/data/content/guidesContent'
import { resGdCtgr } from '@/modules/content/model/guides'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'

type ActiveTarget = {
  categoryId: string
  articleId: string | null
  secNchr?: string | null
} | null

const pad2 = (n: number) => String(n).padStart(2, '0')

function countBlocks(category: GuideCategory) {
  let sections = 0
  let blocks = 0
  for (const article of category.articles) {
    sections += article.sections.length
    for (const section of article.sections) {
      blocks += section.blocks.length
    }
  }
  return { articles: category.articles.length, sections, blocks }
}

function sctnNchrId(articleId: string, sectionIndex: number) {
  return `guide-s-${articleId}-${sectionIndex}`
}

function rtclNchrId(articleId: string) {
  return `guide-a-${articleId}`
}

type GuideHitKind = 'chapter' | 'article' | 'section' | 'block'

type GdSrchHit = {
  kind: GuideHitKind
  categoryId: string
  chapterIndex: number
  articleId: string | null
  secNchr: string | null
  display: string
  matchStart: number
  matchEnd: number
  breadcrumb: string
  score: number
}

type GdNdxEnt = {
  kind: GuideHitKind
  categoryId: string
  chapterIndex: number
  articleId: string | null
  articleIndex: number | null
  sectionIndex: number | null
  secNchr: string | null
  title: string
  text: string
  baseScore: number
  breadcrumb: string
}

function blckSrchText(block: GuideBlock): string {
  switch (block.type) {
    case 'paragraph':
      return block.text.join(' ')
    case 'bullets':
      return block.items.join(' ')
    case 'definitions':
      return block.items.map((entry) => `${entry.term}: ${entry.description}`).join(' ')
    case 'note':
      return block.text
    case 'formula':
      return [block.lines.join(' '), block.note ?? ''].join(' ').trim()
    default:
      return ''
  }
}

function mkGdSrchNdx(): GdNdxEnt[] {
  const out: GdNdxEnt[] = []
  gdCtgr.forEach((category, chapterIndex) => {
    const chapterNum = pad2(chapterIndex + 1)
    out.push({
      kind: 'chapter',
      categoryId: category.id,
      chapterIndex,
      articleId: null,
      articleIndex: null,
      sectionIndex: null,
      secNchr: null,
      title: category.title,
      text: `${category.title} ${category.summary}`,
      baseScore: 100,
      breadcrumb: `§ ${chapterNum}`,
    })
    category.articles.forEach((article, articleIndex) => {
      const articleNum = `${chapterIndex + 1}.${articleIndex + 1}`
      out.push({
        kind: 'article',
        categoryId: category.id,
        chapterIndex,
        articleId: article.id,
        articleIndex,
        sectionIndex: null,
        secNchr: null,
        title: article.title,
        text: `${article.title} ${article.summary}`,
        baseScore: 80,
        breadcrumb: `§ ${chapterNum} · ${articleNum}`,
      })
      article.sections.forEach((section, sectionIndex) => {
        const anchor = sctnNchrId(article.id, sectionIndex)
        const sectionNum = `${articleNum}.${sectionIndex + 1}`
        out.push({
          kind: 'section',
          categoryId: category.id,
          chapterIndex,
          articleId: article.id,
          articleIndex,
          sectionIndex,
          secNchr: anchor,
          title: section.title,
          text: section.title,
          baseScore: 60,
          breadcrumb: `§ ${chapterNum} · ${sectionNum}`,
        })
        section.blocks.forEach((block) => {
          const text = blckSrchText(block)
          if (!text) return
          out.push({
            kind: 'block',
            categoryId: category.id,
            chapterIndex,
            articleId: article.id,
            articleIndex,
            sectionIndex,
            secNchr: anchor,
            title: section.title,
            text,
            baseScore: 30,
            breadcrumb: `§ ${chapterNum} · ${sectionNum} · ${block.type}`,
          })
        })
      })
    })
  })
  return out
}

function makeSnippet(text: string, matchIdx: number, matchLen: number, window = 60) {
  const start = Math.max(0, matchIdx - window)
  const end = Math.min(text.length, matchIdx + matchLen + window)
  const prefix = start > 0 ? '... ' : ''
  const suffix = end < text.length ? ' ...' : ''
  const display = prefix + text.slice(start, end) + suffix
  const newMtchStart = prefix.length + (matchIdx - start)
  return {
    display,
    matchStart: newMtchStart,
    matchEnd: newMtchStart + matchLen,
  }
}

function searchGuides(index: GdNdxEnt[], query: string, limit = 8): GdSrchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  type Scored = { entry: GdNdxEnt, score: number, matchIdx: number }
  const scored: Scored[] = []
  for (const entry of index) {
    const haystack = entry.text.toLowerCase()
    const idx = haystack.indexOf(q)
    if (idx === -1) continue
    let score = entry.baseScore
    if (idx === 0) score += 20
    score -= Math.min(idx, 100) * 0.1
    scored.push({ entry, score, matchIdx: idx })
  }

  scored.sort((a, b) =>
    b.score - a.score
    || a.entry.chapterIndex - b.entry.chapterIndex
    || (a.entry.articleIndex ?? 0) - (b.entry.articleIndex ?? 0)
    || (a.entry.sectionIndex ?? 0) - (b.entry.sectionIndex ?? 0),
  )

  return scored.slice(0, limit).map(({ entry, score, matchIdx }) => {
    if (entry.kind === 'block') {
      const snippet = makeSnippet(entry.text, matchIdx, q.length)
      return {
        kind: entry.kind,
        categoryId: entry.categoryId,
        chapterIndex: entry.chapterIndex,
        articleId: entry.articleId,
        secNchr: entry.secNchr,
        display: snippet.display,
        matchStart: snippet.matchStart,
        matchEnd: snippet.matchEnd,
        breadcrumb: entry.breadcrumb,
        score,
      }
    }

    // title-bearing hit: match position may be in the summary half of `text`,
    // but we only display the title. recompute against the title.
    const titleIdx = entry.title.toLowerCase().indexOf(q)
    const start = titleIdx === -1 ? 0 : titleIdx
    const end = titleIdx === -1 ? 0 : titleIdx + q.length
    return {
      kind: entry.kind,
      categoryId: entry.categoryId,
      chapterIndex: entry.chapterIndex,
      articleId: entry.articleId,
      secNchr: entry.secNchr,
      display: entry.title,
      matchStart: start,
      matchEnd: end,
      breadcrumb: entry.breadcrumb,
      score,
    }
  })
}

const CONTENT_EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]
const CNTNFADEFAST = { duration: 0.24, ease: CONTENT_EASE }
const CONTENT_FADE = { duration: 0.5, ease: CONTENT_EASE }
const CNTNFADEOUT = { duration: 0.48, ease: CONTENT_EASE }
const CELL_TRNS = {
  layout: { type: 'spring' as const, duration: 0.6, bounce: 0 },
}
const CNTN_NTR = { duration: 0.42, delay: 0.46, ease: CONTENT_EASE }
const LAYOUT_LAYER: { willChange: string } = { willChange: 'transform' }

function ChptCardBody({
                           category,
                           chapterIndex,
                           onOpen,
                         }: {
  category: GuideCategory
  chapterIndex: number
  onOpen: (categoryId: string, articleId?: string) => void
}) {
  const counts = useMemo(() => countBlocks(category), [category])
  const number = pad2(chapterIndex + 1)

  return (
    <>
      <button
        type="button"
        className="guide-chapter-card__head"
        onClick={() => onOpen(category.id)}
        aria-label={`Open chapter ${number}: ${category.title}`}
      >
        <span className="guide-chapter-card__number" aria-hidden="true">§ {number}</span>
        <h2 className="guide-chapter-card__title">{category.title}</h2>
        <p className="guide-chapter-card__summary">{category.summary}</p>
      </button>

      <ol className="guide-chapter-card__contents" aria-label={`Articles in ${category.title}`}>
        {category.articles.map((article, articleIndex) => (
          <li key={article.id} className="guide-chapter-card__entry">
            <button
              type="button"
              className="guide-chapter-card__entry-btn"
              onClick={() => onOpen(category.id, article.id)}
            >
              <span className="guide-chapter-card__entry-num" aria-hidden="true">
                {chapterIndex + 1}.{articleIndex + 1}
              </span>
              <span className="guide-chapter-card__entry-title">{article.title}</span>
              <span className="guide-chapter-card__entry-leader" aria-hidden="true" />
              <span className="guide-chapter-card__entry-meta" aria-hidden="true">
                {article.sections.length} §
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="guide-chapter-card__meta" aria-hidden="true">
        <span>{counts.articles} ARTICLES</span>
        <span className="guide-chapter-card__dot">·</span>
        <span>{counts.sections} SECTIONS</span>
        <span className="guide-chapter-card__dot">·</span>
        <span>{counts.blocks} BLOCKS</span>
      </div>
    </>
  )
}

function ChptChipBody({
                           category,
                           chapterIndex,
                           onOpen,
                         }: {
  category: GuideCategory
  chapterIndex: number
  onOpen: (categoryId: string, articleId?: string) => void
}) {
  const number = pad2(chapterIndex + 1)
  return (
    <button
      type="button"
      className="guide-chip__btn"
      onClick={() => onOpen(category.id)}
      aria-label={`Open chapter ${number}: ${category.title}`}
    >
      <span className="guide-chip__num" aria-hidden="true">§ {number}</span>
      <span className="guide-chip__title">{category.title}</span>
    </button>
  )
}

function ChptCardCell({
                           category,
                           chapterIndex,
                           onOpen,
                         }: {
  category: GuideCategory
  chapterIndex: number
  onOpen: (categoryId: string, articleId?: string) => void
}) {
  return (
    <article
      className="guide-chapter-card"
      style={{ '--card-index': chapterIndex } as CssProps}
    >
      <div className="guide-cell-inner guide-cell-inner--card">
        <ChptCardBody category={category} chapterIndex={chapterIndex} onOpen={onOpen} />
      </div>
    </article>
  )
}

function ChptChipCell({
                           category,
                           chapterIndex,
                           onOpen,
                         }: {
  category: GuideCategory
  chapterIndex: number
  onOpen: (categoryId: string, articleId?: string) => void
}) {
  return (
    <motion.article
      layout
      layoutId={`guide-chapter-${category.id}`}
      className="guide-chip"
      transition={CELL_TRNS}
      style={LAYOUT_LAYER}
    >
      <div className="guide-cell-inner guide-cell-inner--chip">
        <ChptChipBody category={category} chapterIndex={chapterIndex} onOpen={onOpen} />
      </div>
    </motion.article>
  )
}

function NoteBlock({ block }: { block: Extract<GuideBlock, { type: 'note' }> }) {
  const tone = block.tone ?? 'info'
  const label = tone === 'warning' ? 'WARNING' : 'NOTE'
  return (
    <aside className={`guide-note guide-note--${tone}`}>
      <span className="guide-note__label" aria-hidden="true">{label}</span>
      <p className="guide-note__text">{block.text}</p>
    </aside>
  )
}

function FormulaBlock({
                        block,
                        label,
                      }: {
  block: Extract<GuideBlock, { type: 'formula' }>
  label: string
}) {
  return (
    <figure className="guide-formula">
      <figcaption className="guide-formula__label" aria-hidden="true">{label}</figcaption>
      <pre className="guide-formula__pre">
        <code>{block.lines.join('\n')}</code>
      </pre>
      {block.note ? <figcaption className="guide-formula__note">{block.note}</figcaption> : null}
    </figure>
  )
}

function ExampleBlock({ block }: { block: Extract<GuideBlock, { type: 'example' }> }) {
  return (
    <article className="guide-example">
      <header className="guide-example__head">
        <span className="guide-example__label" aria-hidden="true">Example</span>
        <h5 className="guide-example__title">{block.title}</h5>
      </header>
      <div className="guide-example__body">
        {block.setup.length > 0 ? (
          <section className="guide-example__section">
            <h6 className="guide-example__section-title">Setup</h6>
            <ul className="guide-example__list">
              {block.setup.map((item, index) => (
                <li key={index} className="guide-example__item">{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {block.observation.length > 0 ? (
          <section className="guide-example__section">
            <h6 className="guide-example__section-title">What Happens</h6>
            <ul className="guide-example__list">
              {block.observation.map((item, index) => (
                <li key={index} className="guide-example__item">{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {block.takeaway.length > 0 ? (
          <section className="guide-example__section">
            <h6 className="guide-example__section-title">Takeaway</h6>
            <ul className="guide-example__list">
              {block.takeaway.map((item, index) => (
                <li key={index} className="guide-example__item">{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  )
}

function StepsBlock({ block }: { block: Extract<GuideBlock, { type: 'steps' }> }) {
  return (
    <ol className="guide-steps">
      {block.items.map((item, index) => (
        <li key={`${item.title}-${index}`} className="guide-steps__item">
          <span className="guide-steps__number" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="guide-steps__copy">
            <h5 className="guide-steps__title">{item.title}</h5>
            <p className="guide-steps__text">{item.description}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function CmprBlck({ block }: { block: Extract<GuideBlock, { type: 'comparison' }> }) {
  return (
    <div className="guide-compare" role="table" aria-label={`${block.leftLabel} compared with ${block.rightLabel}`}>
      <div className="guide-compare__head" role="rowgroup">
        <div className="guide-compare__row guide-compare__row--head" role="row">
          <span className="guide-compare__cell guide-compare__cell--label" role="columnheader" />
          <span className="guide-compare__cell guide-compare__cell--heading" role="columnheader">{block.leftLabel}</span>
          <span className="guide-compare__cell guide-compare__cell--heading" role="columnheader">{block.rightLabel}</span>
        </div>
      </div>
      <div className="guide-compare__body" role="rowgroup">
        {block.rows.map((row) => (
          <div key={row.label} className="guide-compare__row" role="row">
            <span className="guide-compare__cell guide-compare__cell--label" role="rowheader">{row.label}</span>
            <span className="guide-compare__cell" role="cell">{row.left}</span>
            <span className="guide-compare__cell" role="cell">{row.right}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatTblBlck({ block }: { block: Extract<GuideBlock, { type: 'statTable' }> }) {
  return (
    <div className="guide-stats-table" role="table" aria-label="Stat reference table">
      <div className="guide-stats-table__row guide-stats-table__row--head" role="row">
        <span className="guide-stats-table__cell guide-stats-table__cell--heading" role="columnheader">Stat</span>
        <span className="guide-stats-table__cell guide-stats-table__cell--heading" role="columnheader">Structure</span>
        <span className="guide-stats-table__cell guide-stats-table__cell--heading" role="columnheader">Meaning</span>
        <span className="guide-stats-table__cell guide-stats-table__cell--heading" role="columnheader">Seen In</span>
      </div>
      {block.rows.map((row) => (
        <div key={row.stat} className="guide-stats-table__row" role="row">
          <span className="guide-stats-table__cell guide-stats-table__cell--stat" role="rowheader">{row.stat}</span>
          <span className="guide-stats-table__cell" role="cell">{row.structure}</span>
          <span className="guide-stats-table__cell" role="cell">{row.meaning}</span>
          <span className="guide-stats-table__cell" role="cell">{row.surfaces}</span>
        </div>
      ))}
    </div>
  )
}

function WrnnListBlck({ block }: { block: Extract<GuideBlock, { type: 'warningList' }> }) {
  return (
    <aside className="guide-warning-list">
      <span className="guide-warning-list__label" aria-hidden="true">Watch For</span>
      <ul className="guide-warning-list__items">
        {block.items.map((item, index) => (
          <li key={index} className="guide-warning-list__item">{item}</li>
        ))}
      </ul>
    </aside>
  )
}

function ImageBlock({ block }: { block: Extract<GuideBlock, { type: 'image' }> }) {
  return (
    <figure className="guide-image">
      <img
        className="guide-image__img"
        src={block.src}
        alt={block.alt}
        loading="lazy"
      />
      <figcaption className="guide-image__caption">{block.caption}</figcaption>
    </figure>
  )
}

function MgPlchBlck({ block }: { block: Extract<GuideBlock, { type: 'imagePlaceholder' }> }) {
  return (
    <aside className="guide-todo-image" aria-label={`Planned image: ${block.title}`}>
      <span className="guide-todo-image__label" aria-hidden="true">Planned image</span>
      <h5 className="guide-todo-image__title">{block.title}</h5>
      <p className="guide-todo-image__caption">{block.caption}</p>
    </aside>
  )
}

function assertNever(value: never): never {
  throw new Error(`Unsupported guide block: ${JSON.stringify(value)}`)
}

function renderBlocks(
  blocks: GuideBlock[],
  ctx: { sectionIndex: number, dropCapState: { used: boolean }, formulaState: { count: number }, artNmbr: string },
): ReactNode[] {
  const out: ReactNode[] = []
  blocks.forEach((block, index) => {
    const key = `${block.type}-${index}`
    switch (block.type) {
      case 'paragraph': {
        block.text.forEach((entry, i) => {
          const withDropCap =
            ctx.sectionIndex === 0 && !ctx.dropCapState.used && i === 0
          if (withDropCap) ctx.dropCapState.used = true
          out.push(
            <p
              key={`${key}-${i}`}
              className={withDropCap ? 'guide-p guide-p--lede' : 'guide-p'}
            >
              {entry}
            </p>,
          )
        })
        break
      }
      case 'bullets': {
        out.push(
          <ol key={key} className="guide-bullets">
            {block.items.map((item, i) => (
              <li key={i} className="guide-bullets__item">{item}</li>
            ))}
          </ol>,
        )
        break
      }
      case 'definitions': {
        out.push(
          <dl key={key} className="guide-dict">
            {block.items.map((item) => (
              <Fragment key={item.term}>
                <dt className="guide-dict__term">{item.term}</dt>
                <dd className="guide-dict__desc">{item.description}</dd>
              </Fragment>
            ))}
          </dl>,
        )
        break
      }
      case 'note': {
        out.push(<NoteBlock key={key} block={block} />)
        break
      }
      case 'formula': {
        ctx.formulaState.count += 1
        const label = `Formula F.${ctx.artNmbr}.${ctx.formulaState.count}`
        out.push(<FormulaBlock key={key} block={block} label={label} />)
        break
      }
      case 'example': {
        out.push(<ExampleBlock key={key} block={block} />)
        break
      }
      case 'steps': {
        out.push(<StepsBlock key={key} block={block} />)
        break
      }
      case 'comparison': {
        out.push(<CmprBlck key={key} block={block} />)
        break
      }
      case 'statTable': {
        out.push(<StatTblBlck key={key} block={block} />)
        break
      }
      case 'warningList': {
        out.push(<WrnnListBlck key={key} block={block} />)
        break
      }
      case 'image': {
        out.push(<ImageBlock key={key} block={block} />)
        break
      }
      case 'imagePlaceholder': {
        out.push(<MgPlchBlck key={key} block={block} />)
        break
      }
      default: {
        assertNever(block)
      }
    }
  })
  return out
}

function ArticleView({
                       article,
                       chapterIndex,
                       articleIndex,
                     }: {
  article: GuideArticle
  chapterIndex: number
  articleIndex: number
}) {
  const rtclNmbr = `${chapterIndex + 1}.${articleIndex + 1}`
  const dropCapState = { used: false }
  const formulaState = { count: 0 }

  return (
    <article id={rtclNchrId(article.id)} className="guide-article">
      <header className="guide-article__head">
        <span className="guide-article__number" aria-hidden="true">{rtclNmbr}</span>
        <div className="guide-article__head-text">
          <h3 className="guide-article__title">{article.title}</h3>
          <p className="guide-article__summary">{article.summary}</p>
        </div>
      </header>

      <div className="guide-article__body">
        {article.sections.map((section, sectionIndex) => (
          <section
            key={`${section.title}-${sectionIndex}`}
            id={sctnNchrId(article.id, sectionIndex)}
            className="guide-section"
            data-section-anchor={sctnNchrId(article.id, sectionIndex)}
          >
            <header className="guide-section__head">
              <span className="guide-section__number" aria-hidden="true">
                {rtclNmbr}.{sectionIndex + 1}
              </span>
              <h4 className="guide-section__title">{section.title}</h4>
            </header>
            <div className="guide-section__body">
              {renderBlocks(section.blocks, {
                sectionIndex,
                dropCapState,
                formulaState,
                artNmbr: rtclNmbr,
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  )
}

function ChptRdr({
                         category,
                         chapterIndex,
                         ntlArtId: initRtclId,
                         ntlSecNchr: initSctnNchr,
                         onClose,
                         isSwtcChpt: isSwtcChpt,
                       }: {
  category: GuideCategory
  chapterIndex: number
  ntlArtId: string | null
  ntlSecNchr: string | null
  onClose: () => void
  isSwtcChpt: boolean
}) {
  const number = pad2(chapterIndex + 1)
  const containerRef = useRef<HTMLElement | null>(null)
  const [actSctnNchr, setActSctnNc] = useState<string | null>(() => {
    const first = category.articles[0]
    return first ? sctnNchrId(first.id, 0) : null
  })

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // defer scroll during chapter switches so the scroll request does not race
  // against motion's pending layout measurements.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scroller = container.closest<HTMLElement>('.page')
    if (!scroller) return

    // section anchor wins over article anchor when both are provided. block
    // hits and section hits from the search popover both land here.
    const sctnTgt = initSctnNchr
      ? container.querySelector<HTMLElement>(`#${CSS.escape(initSctnNchr)}`)
      : null
    const rtclTgt = initRtclId
      ? container.querySelector<HTMLElement>(`#${CSS.escape(rtclNchrId(initRtclId))}`)
      : null
    const target = sctnTgt ?? rtclTgt ?? container
    const delay = isSwtcChpt ? 720 : 0
    const timer = window.setTimeout(() => {
      if (!target) return
      const targetTop = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      const remInPx = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      const offset = 8 * remInPx + 2
      scroller.scrollTo({
        top: scroller.scrollTop + targetTop - offset,
        behavior: 'smooth',
      })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [category.id, initRtclId, initSctnNchr, isSwtcChpt])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scroller = container.closest<HTMLElement>('.page')
    const observerRoot = scroller ?? null

    const anchors = Array.from(
      container.querySelectorAll<HTMLElement>('[data-section-anchor]'),
    )
    if (anchors.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // pick the topmost intersecting entry
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) {
          setActSctnNc(visible[0].target.getAttribute('data-section-anchor'))
        }
      },
      {
        root: observerRoot,
        rootMargin: '-20% 0px -65% 0px',
        threshold: 0,
      },
    )

    for (const anchor of anchors) observer.observe(anchor)

    return () => observer.disconnect()
  }, [category.id])

  const jumpTo = useCallback((anchorId: string) => {
    const container = containerRef.current
    if (!container) return
    const scroller = container.closest<HTMLElement>('.page')
    const target = container.querySelector<HTMLElement>(`#${CSS.escape(anchorId)}`)
    if (!scroller || !target) return
    const targetTop = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTo({ top: scroller.scrollTop + targetTop - 24, behavior: 'smooth' })
  }, [])

  return (
    <motion.article
      ref={containerRef}
      layout
      layoutId={`guide-chapter-${category.id}`}
      className="guide-reader"
      transition={CELL_TRNS}
      style={LAYOUT_LAYER}
    >
      <motion.div
        className="guide-cell-inner guide-cell-inner--reader"
        initial={isSwtcChpt ? { opacity: 0 } : false}
        animate={{
          opacity: 1,
          transition: isSwtcChpt ? CNTN_NTR : CNTNFADEFAST,
        }}
      >
        <header className="guide-reader__masthead">
          <span className="guide-reader__number" aria-hidden="true">§ {number}</span>
          <div className="guide-reader__heading">
            <span className="guide-reader__eyebrow">Chapter {number}</span>
            <h2 className="guide-reader__title">{category.title}</h2>
            <p className="guide-reader__summary">{category.summary}</p>
          </div>
          <button
            type="button"
            className="guide-reader__close"
            onClick={onClose}
            aria-label="Close chapter"
          >
            <span>Close</span>
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="guide-reader__layout">
          <aside className="guide-reader__rail" aria-label="On this page">
            <div className="guide-reader__rail-sticky">
              <span className="guide-reader__rail-label">On this page</span>
              <ol className="guide-reader__rail-list">
                {category.articles.map((article, articleIndex) => {
                  const rtclNchrAct = article.sections.some(
                    (_, idx) => sctnNchrId(article.id, idx) === actSctnNchr,
                  )
                  return (
                    <li key={article.id} className="guide-reader__rail-article">
                      <button
                        type="button"
                        className="guide-reader__rail-article-btn"
                        data-active={rtclNchrAct || undefined}
                        onClick={() => jumpTo(rtclNchrId(article.id))}
                      >
                        <span className="guide-reader__rail-num" aria-hidden="true">
                          {chapterIndex + 1}.{articleIndex + 1}
                        </span>
                        <span>{article.title}</span>
                      </button>
                      <ol className="guide-reader__rail-sections">
                        {article.sections.map((section, sectionIndex) => {
                          const anchor = sctnNchrId(article.id, sectionIndex)
                          const isActive = anchor === actSctnNchr
                          return (
                            <li key={anchor}>
                              <button
                                type="button"
                                className="guide-reader__rail-section-btn"
                                data-active={isActive || undefined}
                                aria-current={isActive ? 'location' : undefined}
                                onClick={() => jumpTo(anchor)}
                              >
                                {section.title}
                              </button>
                            </li>
                          )
                        })}
                      </ol>
                    </li>
                  )
                })}
              </ol>
            </div>
          </aside>

          <details className="guide-reader__rail-mobile">
            <summary>Contents</summary>
            <ol className="guide-reader__rail-mobile-list">
              {category.articles.map((article, articleIndex) => (
                <li key={article.id}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      jumpTo(rtclNchrId(article.id))
                    }}
                  >
                    <span className="guide-reader__rail-num">
                      {chapterIndex + 1}.{articleIndex + 1}
                    </span>
                    {article.title}
                  </button>
                </li>
              ))}
            </ol>
          </details>

          <div className="guide-reader__content">
            {category.articles.map((article, articleIndex) => (
              <ArticleView
                key={article.id}
                article={article}
                chapterIndex={chapterIndex}
                articleIndex={articleIndex}
              />
            ))}

            <footer className="guide-reader__footer">
              <button type="button" className="guide-reader__close guide-reader__close--bottom" onClick={onClose}>
                <X size={14} aria-hidden="true" />
                <span>Close · § {number}</span>
              </button>
            </footer>
          </div>
        </div>
      </motion.div>
    </motion.article>
  )
}

function GuideSearch({ onSelectHit }: { onSelectHit: (hit: GdSrchHit) => void }) {
  const index = useMemo(() => mkGdSrchNdx(), [])
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selNdx, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const hits = useMemo(() => searchGuides(index, query), [index, query])
  const trimmed = query.trim()
  const safeSelNdx = hits.length === 0 ? 0 : Math.min(selNdx, hits.length - 1)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = document.activeElement as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      event.preventDefault()
      const input = inputRef.current
      if (!input) return
      // focus without the browser's default snap-into-view, then smooth-scroll
      // the field into view ourselves.
      input.focus({ preventScroll: true })
      input.select()
      const field = rootRef.current ?? input
      field.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handler = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root || root.contains(event.target as Node)) return
      setIsOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [isOpen])

  const selectHit = useCallback((hit: GdSrchHit) => {
    onSelectHit(hit)
    setIsOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }, [onSelectHit])

  const onKeyDown = (event: RctKybrVnt<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (trimmed.length > 0 || isOpen) {
        event.preventDefault()
        setQuery('')
        setIsOpen(false)
      }
      return
    }
    if (!isOpen || hits.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((idx) => {
        const base = Math.min(idx, hits.length - 1)
        return (base + 1) % hits.length
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((idx) => {
        const base = Math.min(idx, hits.length - 1)
        return (base - 1 + hits.length) % hits.length
      })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[safeSelNdx]
      if (hit) selectHit(hit)
    }
  }

  const popoverOpen = isOpen && trimmed.length > 0

  return (
    <div ref={rootRef} className="guide-search" role="search">
      <div className="guide-search__field" data-open={popoverOpen || undefined}>
        <Search size={16} className="guide-search__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIsOpen(true)
            setActiveIndex(0)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="search the guides"
          autoComplete="off"
          spellCheck={false}
          className="guide-search__input"
          aria-controls="guide-search-popover"
          aria-expanded={popoverOpen}
          aria-autocomplete="list"
        />
        <span className="guide-search__shortcut" aria-hidden="true">/</span>
      </div>
      {popoverOpen ? (
        <div id="guide-search-popover" className="guide-search__popover" role="listbox">
          {hits.length === 0 ? (
            <div className="guide-search__empty">no matches for &quot;{trimmed}&quot;</div>
          ) : (
            hits.map((hit, i) => {
              const isActive = i === safeSelNdx
              const before = hit.display.slice(0, hit.matchStart)
              const match = hit.display.slice(hit.matchStart, hit.matchEnd)
              const after = hit.display.slice(hit.matchEnd)
              return (
                <button
                  key={`${hit.kind}-${hit.categoryId}-${hit.articleId ?? ''}-${hit.secNchr ?? ''}-${i}`}
                  type="button"
                  className="guide-search__hit"
                  data-active={isActive || undefined}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectHit(hit)}
                >
                  <span className="guide-search__badge">{hit.kind}</span>
                  <span className="guide-search__title">
                    {before}
                    {match ? <mark className="guide-search__mark">{match}</mark> : null}
                    {after}
                  </span>
                  <span className="guide-search__crumb">{hit.breadcrumb}</span>
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}

function RdrChipStrp({
                           activeCategory: activeCategory,
                           openChapter,
                           closeChapter,
                           openChptAt: openChptAt,
                         }: {
  activeCategory: GuideCategory
  openChapter: (categoryId: string, articleId?: string) => void
  closeChapter: () => void
  openChptAt: (target: {
    categoryId: string
    articleId?: string | null
    secNchr?: string | null
  }) => void
}) {
  const [searchOpen, setSrchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selNdx, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const index = useMemo(() => mkGdSrchNdx(), [])
  const hits = useMemo(() => searchGuides(index, query), [index, query])
  const trimmed = query.trim()
  const safeSelNdx = hits.length === 0 ? 0 : Math.min(selNdx, hits.length - 1)
  const popoverOpen = searchOpen && trimmed.length > 0

  const openSearch = useCallback(() => {
    setSrchOpen(true)
    requestAnimationFrame(() => {
      const input = inputRef.current
      const wrap = wrapRef.current
      if (!input) return
      input.focus({ preventScroll: true })
      input.select()
      wrap?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const closeSearch = useCallback(() => {
    setSrchOpen(false)
    inputRef.current?.blur()
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = document.activeElement as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      event.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openSearch])

  useEffect(() => {
    if (!searchOpen) return
    const onPointer = (event: PointerEvent) => {
      const wrap = wrapRef.current
      if (!wrap) return
      if (wrap.contains(event.target as Node)) return
      closeSearch()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [searchOpen, closeSearch])

  const selectHit = useCallback((hit: GdSrchHit) => {
    openChptAt({
      categoryId: hit.categoryId,
      articleId: hit.articleId,
      secNchr: hit.secNchr,
    })
    setSrchOpen(false)
    inputRef.current?.blur()
  }, [openChptAt])

  const onKeyDown = (event: RctKybrVnt<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearch()
      return
    }
    if (!popoverOpen || hits.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((idx) => {
        const base = Math.min(idx, hits.length - 1)
        return (base + 1) % hits.length
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((idx) => {
        const base = Math.min(idx, hits.length - 1)
        return (base - 1 + hits.length) % hits.length
      })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[safeSelNdx]
      if (hit) selectHit(hit)
    }
  }

  return (
    <div ref={wrapRef} className="guide-chip-strip-wrap" data-search-open={searchOpen || undefined}>
      <motion.div className="guide-chip-strip" layout transition={CELL_TRNS}>
        <NmtPrsn mode="wait" initial={false}>
          {searchOpen ? (
            <motion.div
              key="search-mode"
              className="guide-chip-strip__search"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={CNTNFADEFAST}
            >
              <Search size={16} className="guide-search__icon" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="search the guides"
                autoComplete="off"
                spellCheck={false}
                className="guide-search__input"
                aria-controls="guide-search-popover"
                aria-expanded={popoverOpen}
                aria-autocomplete="list"
              />
              <button
                type="button"
                className="guide-chip-strip__esc"
                onClick={closeSearch}
                aria-label="close search"
              >
                esc
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="chip-mode"
              className="guide-chip-strip__chips"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={CNTNFADEFAST}
            >
              <motion.button
                type="button"
                layout
                className="guide-chip-back"
                onClick={closeChapter}
                transition={CELL_TRNS}
                aria-label="Back to all chapters"
              >
                <ChevronLeft size={14} aria-hidden="true" />
                <span>All chapters</span>
              </motion.button>
              <button
                type="button"
                className="guide-chip-search"
                data-has-query={trimmed.length > 0 || undefined}
                onClick={openSearch}
                aria-label={trimmed ? `open search, current query ${trimmed}` : 'open search'}
              >
                <Search size={14} aria-hidden="true" />
                {trimmed ? (
                  <span className="guide-chip-search__query">{trimmed}</span>
                ) : (
                  <span className="guide-chip-search__placeholder">search</span>
                )}
              </button>
              {gdCtgr.map((category, index) =>
                category.id === activeCategory.id ? null : (
                  <ChptChipCell
                    key={category.id}
                    category={category}
                    chapterIndex={index}
                    onOpen={openChapter}
                  />
                ),
              )}
            </motion.div>
          )}
        </NmtPrsn>
      </motion.div>
      {popoverOpen ? (
        <div id="guide-search-popover" className="guide-search__popover" role="listbox">
          {hits.length === 0 ? (
            <div className="guide-search__empty">no matches for &quot;{trimmed}&quot;</div>
          ) : (
            hits.map((hit, i) => {
              const isActive = i === safeSelNdx
              const before = hit.display.slice(0, hit.matchStart)
              const match = hit.display.slice(hit.matchStart, hit.matchEnd)
              const after = hit.display.slice(hit.matchEnd)
              return (
                <button
                  key={`${hit.kind}-${hit.categoryId}-${hit.articleId ?? ''}-${hit.secNchr ?? ''}-${i}`}
                  type="button"
                  className="guide-search__hit"
                  data-active={isActive || undefined}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectHit(hit)}
                >
                  <span className="guide-search__badge">{hit.kind}</span>
                  <span className="guide-search__title">
                    {before}
                    {match ? <mark className="guide-search__mark">{match}</mark> : null}
                    {after}
                  </span>
                  <span className="guide-search__crumb">{hit.breadcrumb}</span>
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}

function readTgtFromL(search: string, hash: string): ActiveTarget {
  const params = new URLSearchParams(search)
  const rqstCtgr = params.get('category') ?? hash?.replace('#', '')
  const rqstRtcl = params.get('article')
  const rqstSctn = params.get('section')
  const category = resGdCtgr(gdCtgr, rqstCtgr)
  if (!category) return null
  return {
    categoryId: category.id,
    articleId: rqstRtcl ?? null,
    secNchr: rqstSctn ?? null,
  }
}

export function GuidesPage() {
  const location = useLocation()
  const [active, setActive] = useState<ActiveTarget>(() =>
    typeof window === 'undefined'
      ? null
      : readTgtFromL(window.location.search, window.location.hash),
  )

  const [isSwtcChpt, setIsSwtcChp] = useState(false)
  const lastLctnKeyR = useRef<string | null>(null)
  const rstrScrlRef = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const chptNdxById = useMemo(
    () => Object.fromEntries(gdCtgr.map((category, index) => [category.id, index])),
    [],
  )

  const openChptAt = useCallback((target: {
    categoryId: string
    articleId?: string | null
    secNchr?: string | null
  }) => {
    const articleId = target.articleId ?? null
    const sctnNchr = target.secNchr ?? null
    if (
      active?.categoryId === target.categoryId
      && articleId === (active?.articleId ?? null)
      && sctnNchr === (active?.secNchr ?? null)
    ) {
      return
    }
    const page = rootRef.current?.querySelector<HTMLElement>('.page') ?? null
    rstrScrlRef.current = page?.scrollTop ?? null
    setIsSwtcChp(Boolean(active?.categoryId && active.categoryId !== target.categoryId))
    setActive({ categoryId: target.categoryId, articleId, secNchr: sctnNchr })
  }, [active])

  const openChapter = useCallback((categoryId: string, articleId?: string) => {
    openChptAt({ categoryId, articleId: articleId ?? null, secNchr: null })
  }, [openChptAt])

  const closeChapter = useCallback(() => {
    setIsSwtcChp(false)
    setActive(null)
    requestAnimationFrame(() => {
      const page = rootRef.current?.querySelector<HTMLElement>('.page') ?? null
      if (!page) return
      if (rstrScrlRef.current != null) {
        page.scrollTop = rstrScrlRef.current
      }
    })
  }, [])

  // deep linking: react to ?category=, ?article=, ?section= or #hash
  // navigations that arrive after mount. the initial url is already
  // consumed by the lazy state initializer above, so this only runs for
  // later navigations.
  useEffect(() => {
    const key = `${location.search}::${location.hash}`
    const isFirstRun = lastLctnKeyR.current === null
    if (!isFirstRun && key === lastLctnKeyR.current) return
    lastLctnKeyR.current = key

    if (!isFirstRun) {
      const target = readTgtFromL(location.search, location.hash)
      if (target) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing react state with the url is a legitimate external-source sync; the alternative is a stale deep link.
        setActive(target)
      }
    }

    if (
      location.search.includes('category=')
      || location.search.includes('article=')
      || location.search.includes('section=')
    ) {
      const url = new URL(window.location.href)
      url.searchParams.delete('category')
      url.searchParams.delete('article')
      url.searchParams.delete('section')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [location])

  const activeCategory = active
    ? gdCtgr.find((category) => category.id === active.categoryId) ?? null
    : null

  return (
    <div ref={rootRef} className="page guides-page" data-codex-state={active ? 'reader' : 'index'}>
      <CllpPageHeyf
        eyebrow="Documentation"
        title="Guides"
        subtitle="Reference notes for the calculator systems, result surfaces, and app behavior."
        layoutKey="guides-hero"
        onFltnCtvt={closeChapter}
        floatingTop={active ? 'calc(env(safe-area-inset-top, 0px) + 3rem)' : undefined}
      />

      <div className="guide-codex">
        <NmtPrsn initial={false}>
          {!activeCategory ? (
            <motion.div
              key="guide-index-search"
              layout
              className="guide-index-search-motion"
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{
                opacity: 1,
                height: 'auto',
                marginBottom: 20,
                transition: {
                  opacity: CONTENT_FADE,
                  height: { duration: 0.5, ease: CONTENT_EASE },
                  marginBottom: { duration: 0.5, ease: CONTENT_EASE },
                },
              }}
              exit={{
                opacity: 0,
                height: 0,
                marginBottom: 0,
                transition: {
                  opacity: { duration: 0.22, ease: CONTENT_EASE },
                  height: { duration: 0.5, ease: CONTENT_EASE },
                  marginBottom: { duration: 0.5, ease: CONTENT_EASE },
                },
              }}
            >
              <GuideSearch
                onSelectHit={(hit) => {
                  openChptAt({
                    categoryId: hit.categoryId,
                    articleId: hit.articleId,
                    secNchr: hit.secNchr,
                  })
                }}
              />
            </motion.div>
          ) : null}
        </NmtPrsn>
        <LayoutGroup id="guide-codex">
          <NmtPrsn mode="wait" initial={false}>
            {activeCategory ? (
              <motion.div
                key="reader-mode"
                className="guide-codex-reader-mode"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: { duration: 0.52, delay: 0.1, ease: CONTENT_EASE },
                }}
                exit={{ opacity: 0, transition: CNTNFADEOUT }}
              >
                <RdrChipStrp
                  activeCategory={activeCategory}
                  openChapter={openChapter}
                  closeChapter={closeChapter}
                  openChptAt={openChptAt}
                />

                <ChptRdr
                  key={`reader-${activeCategory.id}`}
                  category={activeCategory}
                  chapterIndex={chptNdxById[activeCategory.id] ?? 0}
                  ntlArtId={active?.articleId ?? null}
                  ntlSecNchr={active?.secNchr ?? null}
                  onClose={closeChapter}
                  isSwtcChpt={isSwtcChpt}
                />
              </motion.div>
            ) : (
              <motion.div
                key="grid-mode"
                className="guide-codex-index"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: CONTENT_FADE }}
                exit={{ opacity: 0, transition: CNTNFADEOUT }}
              >
                {gdCtgr.map((category, index) => (
                  <ChptCardCell
                    key={category.id}
                    category={category}
                    chapterIndex={index}
                    onOpen={openChapter}
                  />
                ))}
              </motion.div>
            )}
          </NmtPrsn>
        </LayoutGroup>
      </div>
    </div>
  )
}
