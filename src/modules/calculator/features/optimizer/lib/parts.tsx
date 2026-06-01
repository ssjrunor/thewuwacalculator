/*
  Author: Runor Ewhro
  Description: Exposes small optimizer ui fragments so the larger optimizer
               surface can stay split into reusable presentational pieces.
*/

import type { HTMLAttributes as HtmlAttrs } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { fmtStatKeyLb, fmtStatKeyVl } from '@/modules/calculator/features/overview/lib/stats.ts'
import { toTitle } from '@/shared/lib/format.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'

export function OptPrvwEchoT(props: {
  echo: EchoInstance | null
  index: number
  selected?: boolean
  selMode?: boolean
} & HtmlAttrs<HTMLElement>) {
  const {
    echo,
    index,
    selected = false,
    selMode: selectMode = false,
    ...domProps
  } = props
  const definition = echo ? getEchoById(echo.id) : null
  const slotLabel = index === 0 ? 'Main Echo' : `Echo ${index + 1}`
  const isMainSlot = index === 0

  if (!echo || !definition) {
    return (
      <article className={`opt-echo-preview__slot opt-echo-preview__slot--empty${selectMode ? ' selection-mode' : ''}`}>
        <div className="opt-echo-preview__slot-top">
          <span className="opt-echo-preview__slot-tag">{slotLabel}</span>
        </div>
        <div className="opt-echo-preview__empty-shell">
          <span className="opt-echo-preview__empty-mark">+</span>
          <span className="opt-echo-preview__empty">Empty Slot</span>
        </div>
      </article>
    )
  }

  const setIcon = getSntSetIco(echo.set)
  const cost = definition.cost ?? 0
  const sbstEnts = Object.entries(echo.substats)

  return (
    <article
      className={`opt-echo-preview__slot${isMainSlot ? ' opt-echo-preview__slot--main' : ''}${selectMode ? ' selection-mode' : ''}${selected ? ' focus-selected' : ''}`}
      {...domProps}
    >
      <div className="opt-echo-preview__slot-top">
        <span className="opt-echo-preview__slot-tag">{slotLabel}</span>
        <span className="opt-echo-preview__cost-pill">{cost}C</span>
      </div>

      <div className="opt-echo-preview__slot-body">
        <div className="opt-echo-preview__glyph-frame">
          {definition.icon ? (
            <img
              src={definition.icon}
              alt={definition.name}
              className="opt-echo-preview__glyph"
              loading="lazy"
              decoding="async"
              onError={withDefEchoMg}
            />
          ) : (
            <div className="opt-echo-preview__glyph opt-echo-preview__glyph--empty" />
          )}
        </div>

        <div className="opt-echo-preview__summary">
          <strong className="opt-echo-preview__name">{definition.name ?? toTitle(echo.id)}</strong>
          <div className="opt-echo-preview__set-line">
            {setIcon ? (
              <img
                src={setIcon}
                alt={getSntSetNam(echo.set)}
                className="opt-echo-preview__set-icon"
                loading="lazy"
                onError={withDefIconM}
              />
            ) : null}
            <span className="opt-echo-preview__set-name">{getSntSetNam(echo.set)}</span>
          </div>
        </div>
      </div>

      <div className="opt-echo-preview__stats-table">
        <div className="opt-echo-preview__stats-row opt-echo-preview__stats-row--main">
          <span className="opt-echo-preview__stats-label">{fmtStatKeyLb(echo.mainStats.primary.key)}</span>
          <span className="opt-echo-preview__stats-value">
            {fmtStatKeyVl(echo.mainStats.primary.key, echo.mainStats.primary.value)}
          </span>
        </div>
        <div className="opt-echo-preview__stats-row opt-echo-preview__stats-row--main">
          <span className="opt-echo-preview__stats-label">{fmtStatKeyLb(echo.mainStats.secondary.key)}</span>
          <span className="opt-echo-preview__stats-value">
            {fmtStatKeyVl(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}
          </span>
        </div>
        {sbstEnts.map(([key, value], subIndex) => (
          <div
            key={key}
            className={`opt-echo-preview__stats-row${subIndex === 0 ? ' opt-echo-preview__stats-row--substart' : ''}`}
          >
            <span className="opt-echo-preview__stats-label">{fmtStatKeyLb(key)}</span>
            <span className="opt-echo-preview__stats-value">{fmtStatKeyVl(key, value)}</span>
          </div>
        ))}
      </div>
    </article>
  )
}
