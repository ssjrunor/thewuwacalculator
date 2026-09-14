/*
  Author: Runor Ewhro
  Description: The target's seven resistances, as one display both the pane and
               the console stand.

               A cell says the resistance and, under it, what that resistance
               does to damage; hovering trades their places, because the two are
               the same fact read at two magnifications. A build that shreds an
               element marks the cell rather than restating the arithmetic: the
               title carries the base value for anyone who wants it.

               The console reads one element at a time, so a cell there is also
               how that element is picked. Handing it `onSelect` turns the cell
               into a button; without it, the display is read-only the way the
               pane has it.
*/

import type { CSSProperties as CssProps } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { EnemyElemId } from '@/domain/entities/enemy.ts'
import { getEnemyReys, setEnemyResi } from '@/domain/services/enemyProfileService.ts'
import { NumberInput } from '@/modules/simulation/features/controls/NumberInput.tsx'
import { ATTR_ID_COLORS } from '@/modules/simulation/model/display.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'

/*
  mirrors resistMult() in src/engine/formulas/damage.ts. converts an effective
  res% after shred into the decimal multiplier that scales damage.
*/
export function resistMultiplier(enemyResPct: number): number {
  if (enemyResPct < 0) return 1 - enemyResPct / 200
  if (enemyResPct < 75) return 1 - enemyResPct / 100
  return 1 / (1 + 5 * (enemyResPct / 100))
}

interface ResistanceGridProps {
  profile: EnemyProfile
  /** the elements, in the order the surface reads them */
  elements: EnemyElemId[]
  /** a custom target owns its own resistances, so its cells are typed into */
  editable: boolean
  /** the build's own shred for an attribute, which the cell subtracts */
  shredFor: (attributeKey: string) => number
  onChange: (profile: EnemyProfile) => void
  selected?: EnemyElemId | null
  onSelect?: (elementId: EnemyElemId) => void
}

export function ResistanceGrid({
  profile,
  elements,
  editable,
  shredFor,
  onChange,
  selected = null,
  onSelect,
}: ResistanceGridProps) {
  return (
    <div className="enemy-res-grid">
      {getEnemyReys(profile, elements).map(({ elementId, label, attributeKey, value }) => {
        const effRes = value - shredFor(attributeKey)
        const resMult = resistMultiplier(effRes)
        const shifted = Math.abs(effRes - value) >= 0.05
        const sign = effRes < 0 ? 'vuln' : effRes > 0 ? 'resist' : 'zero'
        const fmt = (n: number) => `${n > 0 ? '+' : ''}${n}%`
        const isPhys = attributeKey === 'physical'
        const iconSrc = `/assets/game/attributes/icons/${attributeKey}.webp`
        const picked = onSelect ? selected === elementId : false

        const body = (
          <>
            <img
              src={iconSrc}
              alt=""
              aria-hidden="true"
              className={isPhys ? 'enemy-res-cell__ghost is-phys' : 'enemy-res-cell__ghost'}
              onError={withDefIconM}
            />
            <div className="enemy-res-cell__head">
              <img
                src={iconSrc}
                alt={label}
                className={isPhys ? 'enemy-res-cell__icon is-phys' : 'enemy-res-cell__icon'}
                onError={withDefIconM}
              />
              <span className="enemy-res-cell__label">{label}</span>
            </div>

            {editable ? (
              <div className="enemy-res-cell__res">
                <NumberInput
                  value={value}
                  min={-100}
                  max={200}
                  onChange={(nextValue) => onChange(setEnemyResi(profile, elementId, nextValue))}
                />
              </div>
            ) : (
              <div className="enemy-res-cell__res" data-shifted={shifted}>{fmt(effRes)}</div>
            )}

            <div className="enemy-res-cell__mult">
              <span className="enemy-res-cell__mult-x">×</span>
              {formatTruncCompact(resMult, 2)}
            </div>
          </>
        )

        const className = [
          'enemy-res-cell',
          effRes < value ? 'good' : effRes > value ? 'bad' : '',
          picked ? 'is-picked' : '',
        ].filter(Boolean).join(' ')

        const title = `${label} · RES ${fmt(value)}`
          + `${shifted ? ` (effective ${fmt(effRes)})` : ''}`
          + ` · damage x${formatTruncCompact(resMult, 3)}`

        if (!onSelect) {
          return (
            <div
              key={elementId}
              className={className}
              data-sign={sign}
              style={{ '--el': ATTR_ID_COLORS[elementId] } as CssProps}
              title={title}
            >
              {body}
            </div>
          )
        }

        return (
          <button
            key={elementId}
            type="button"
            className={className}
            data-sign={sign}
            style={{ '--el': ATTR_ID_COLORS[elementId] } as CssProps}
            title={title}
            aria-pressed={picked}
            onClick={() => onSelect(elementId)}
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}
