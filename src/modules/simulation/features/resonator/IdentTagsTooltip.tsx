/*
  Author: Runor Ewhro
  Description: Adapts resonator identity tags to the shared hover-card contract,
               keeping tag lookup and fallback labeling local to resonators.
*/

import type { CSSProperties as CssProps, SyntheticEvent } from 'react'
import { HoverCard } from '@/shared/ui/Tooltip'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

export interface IdentTag {
  id: string
  name: string
  desc: string
  color: string
}

interface IdentTagsTooltipProps {
  tags: IdentTag[]
  label?: string
  className?: string
  onIconError?: (event: SyntheticEvent<HTMLImageElement>) => void
}

function padCount(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

export function IdentTagsTooltip({
  tags,
  label = 'Resonator roles',
  className,
  onIconError,
}: IdentTagsTooltipProps) {
  if (tags.length === 0) return null

  return (
    <HoverCard
      label={label}
      triggerClassName={className ? `res-card__ident-tags ${className}` : 'res-card__ident-tags'}
      rootClassName="res-tag-tooltip"
      cardClassName="res-tag-tooltip__card"
      content={() => (
        <>
          <div className="res-tag-tooltip__head">
            <span className="res-tag-tooltip__label">Roles</span>
            <span className="res-tag-tooltip__count">
              {padCount(tags.length)}
              <span className="res-tag-tooltip__count-unit">
                {tags.length === 1 ? 'role' : 'roles'}
              </span>
            </span>
          </div>

          <ul className="res-tag-tooltip__list">
            {tags.map((tag) => (
              <li
                key={tag.id} className="res-tag-tooltip__row"
                style={{ '--res-tag-color': `#${tag.color}` } as CssProps}
              >
                <span className="res-tag-tooltip__icon">
                  <img
                    src={`/assets/game/resonators/tags/${tag.id}.webp`}
                    alt=""
                    aria-hidden="true"
                    onError={onIconError}
                  />
                </span>
                <span className="res-tag-tooltip__text">
                  <span className="res-tag-tooltip__name">{tag.name}</span>
                  {tag.desc ? (
                    <span className="res-tag-tooltip__desc">{tag.desc}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    >
      {tags.map((tag) => (
        <div
          aria-hidden="true"
          key={tag.id}
          style={{
            '--res-tag-color': `#${tag.color}`,
            WebkitMaskImage: `url(/assets/game/resonators/tags/${tag.id}.webp)`,
            maskImage: `url(/assets/game/resonators/tags/${tag.id}.webp)`,
          } as CssProps} className="res-card__tag-icon"
          onError={withDefIconM}
        />
      ))}
    </HoverCard>
  )
}
