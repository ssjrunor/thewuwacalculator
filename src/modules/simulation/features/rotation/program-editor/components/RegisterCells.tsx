/*
  Author: Runor Ewhro
  Description: The register's own cells, shared by every list that draws it.
               The tracks, the fences and the folded bands are one layout, so
               the heading and the rows under it are built from one place
               rather than being kept in step by hand.
*/

import type { CSSProperties, ReactNode, RefObject } from 'react'
import { Fragment, useLayoutEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  GROUP_NAMES,
  GROUP_SHORT,
  bandSpan,
  fmtStatHeading,
  type PercentDisplay,
  type RegisterGroup,
  type RegisterLayout,
  type StatKey,
} from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'

const COLUMN_VARS: CSSProperties[] = Array.from(
  { length: 32 },
  (_, index) => ({ '--rte-col': index } as CSSProperties),
)

export const columnVar = (column: number): CSSProperties | undefined => COLUMN_VARS[column]

export function useScrollbarInset(
  listRef: RefObject<HTMLElement | null>,
  scrollerRef: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const list = listRef.current
    const scroller = scrollerRef.current
    if (!list || !scroller) {
      return
    }
    const measure = () => {
      list.style.setProperty('--rte-sbw', `${scroller.offsetWidth - scroller.clientWidth}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [listRef, scrollerRef])
}

/** the grid the register asks its host to hold, ready to spread onto a style */
export function registerVars(register: RegisterLayout): CSSProperties {
  return {
    '--rte-cols': register.template,
    '--rte-tail': register.tail,
    '--rte-minw': register.minWidth,
  } as CSSProperties
}

/**
 * Emit the damage cell and every stat cell in track order, with a gap where a
 * band is fenced off from the one before it and a marker where one is folded.
 */
export function bandCells(
  register: RegisterLayout,
  damage: ReactNode,
  cell: (key: StatKey, column: number) => ReactNode,
): ReactNode[] {
  const out: ReactNode[] = []
  let column = 0

  for (const band of register.bands) {
    if (band.fenced) {
      out.push(<i key={`gap-${band.group}`} className="rte-gap" aria-hidden="true" />)
    }
    if (band.shut) {
      out.push(<i key={`shut-${band.group}`} className="rte-shut" aria-hidden="true" />)
      continue
    }
    if (band.leadsDamage) {
      out.push(<Fragment key="damage">{damage}</Fragment>)
    }
    for (const key of band.keys) {
      out.push(cell(key, column))
      column += 1
    }
  }

  return out
}

/**
 * The heading: the band names over their own tracks, and the column names
 * under them. A band standing over one column keeps its name down and brings
 * only the caret up, because its heading is already as short as its name.
 */
export function RegisterHead({
  register,
  percentDisplay,
  stepLabel = 'Step',
  onToggleGroup,
}: {
  register: RegisterLayout
  percentDisplay: PercentDisplay
  stepLabel?: string
  onToggleGroup: (group: RegisterGroup) => void
}) {
  return (
    <div className="rte-hd">
      <div className="rte-groups rte-hd-inset" aria-hidden={false}>
        <span className="rte-gap" aria-hidden="true" />
        {register.bands.map((band) => {
          const span = bandSpan(band)
          const named = band.shut || span > 1
          return (
            <Fragment key={band.group}>
              {band.fenced ? <i className="rte-gap" aria-hidden="true" /> : null}
              <button
                type="button"
                className={`rte-bnd rte-bnd--${band.group}${band.shut ? ' is-shut' : ''}${named ? '' : ' is-solo'}`}
                style={{ gridColumn: `span ${span}` }}
                aria-expanded={!band.shut}
                aria-label={GROUP_NAMES[band.group]}
                title={`${GROUP_NAMES[band.group]}: click to ${band.shut ? 'show' : 'fold'}`}
                onClick={() => onToggleGroup(band.group)}
              >
                <span className="rte-bnd__nm">
                  <ChevronDown className="rte-bnd__chev" size="0.6rem" aria-hidden="true" />
                  {named
                    ? (band.shut ? GROUP_SHORT[band.group] : GROUP_NAMES[band.group])
                    : null}
                </span>
              </button>
            </Fragment>
          )
        })}
      </div>

      <div className="rte-cols rte-hd-inset">
        <span>{stepLabel}</span>
        {bandCells(
          register,
          <span className="is-num rte-cols__dmg">Avg</span>,
          (key, column) => (
            <span key={key} className="is-num" style={columnVar(column)}>
              {fmtStatHeading(key, percentDisplay)}
            </span>
          ),
        )}
      </div>
    </div>
  )
}
