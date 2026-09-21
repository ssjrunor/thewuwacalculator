/*
  Author: Runor Ewhro
  Description: Expands register layout metadata into grouped headers, stat
               cells, and Off-Tune trace readouts.
*/

import type { CSSProperties, ReactNode, RefObject } from 'react'
import { Fragment, useLayoutEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { EditorStep } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import type { OffTuneTrace } from '@/domain/entities/stats'
import {
  GROUP_NAMES,
  GROUP_SHORT,
  bandSpan,
  fmtExact,
  fmtStatHeading,
  offTuneState,
  offTuneTraceAt,
  type OffTuneAuthoringState,
  type PercentDisplay,
  type RegisterGroup,
  type RegisterLayout,
  type StatKey,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'

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

/** Maps register layout values to the custom properties consumed by grid hosts. */
export function registerVars(register: RegisterLayout): CSSProperties {
  return {
    '--rte-cols': register.template,
    '--rte-tail': register.tail,
    '--rte-minw': register.minWidth,
  } as CSSProperties
}

/**
 * Expands bands in track order while preserving separators and collapsed-group
 * markers in the resulting grid children.
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

export function OffTuneCell({
  step,
  run,
  text,
  ghost,
  accent,
  onResume,
  authoringState,
}: {
  step: EditorStep
  run: number
  /** Value preformatted with the register's active precision. */
  text: string
  ghost?: boolean
  /** Row color properties copied across the Tooltip portal boundary. */
  accent?: CSSProperties
  /** Updates the step where Off-Tune accumulation resumes after Tune Break. */
  onResume?: (id: string, on: boolean) => void
  /** Draft cooldown state, which may differ from the last executed trace. */
  authoringState?: OffTuneAuthoringState
}) {
  const trace = offTuneTraceAt(step, run)
  const tracedState = offTuneState(trace)
  const state = authoringState
    ? (authoringState.sealed ? 'sealed' : tracedState === 'sealed' ? null : tracedState)
    : tracedState
  const cell = `rte-stat rte-ot${ghost ? ' is-ghost' : ''}`
  const readoutTrace = trace && authoringState
    ? {
      ...trace,
      sealed: authoringState.sealed,
      afterBreak: authoringState.canResume,
      resume: authoringState.resume,
      ...(authoringState.sealed
        ? { after: trace.before, gain: 0, crest: false, held: false }
        : {}),
    }
    : trace

  const figure = readoutTrace ? (
    <Tooltip
      placement="left"
      className={`rte-otw${state ? ` is-${state}` : ''}`}
      triggerStyle={{ display: 'block', minWidth: 0 }}
      content={<OffTuneReadout trace={readoutTrace} label={step.label} accent={accent} />}
    >
      <span className={cell} data-quiets-note="true">{text}</span>
    </Tooltip>
  ) : (
    <span className={`rte-otw${state ? ` is-${state}` : ''}`}>
      <span className={cell}>{text}</span>
    </span>
  )

  const canResume = authoringState?.canResume ?? trace?.afterBreak ?? false
  if (!onResume || !canResume) {
    return figure
  }

  return (
    <span className="rte-otc">
      <ResumeMark
        step={step}
        resume={authoringState?.resume ?? trace?.resume ?? null}
        onResume={onResume}
      />
      {figure}
    </span>
  )
}

function ResumeMark({
  step,
  resume,
  onResume,
}: {
  step: EditorStep
  resume: 'mark' | 'default' | null
  onResume: (id: string, on: boolean) => void
}) {
  const marked = resume === 'mark'
  const landing = resume === 'default'
  const toggle = () => onResume(step.id, !marked)

  return (
    <span
      role="button"
      tabIndex={0}
      className={`rte-rsm${marked ? ' is-on' : ''}${landing ? ' is-landing' : ''}`}
      aria-pressed={marked}
      title="Off-Tune cooldown ends here"
      aria-label={`Off-Tune resumes on ${step.label}`}
      onClick={(event) => {
        event.stopPropagation()
        toggle()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        toggle()
      }}
    />
  )
}

function Term({ name, value }: { name: string; value: string }) {
  return (
    <span className="rte-otg__term">
      <em className="rte-otg__tnm">{name}</em>
      <b className="rte-otg__tvl">{value}</b>
    </span>
  )
}

function pct(value: number): string {
  return `${fmtExact(value * 100)}%`
}

/** Separates pre-rate buildup, rate modifiers, and post-rate additions. */
function OffTuneReadout({
  trace,
  label,
  accent,
}: {
  trace: OffTuneTrace
  label: string
  accent?: CSSProperties
}) {
  const built = [
    ...trace.hits.map((hit) => ({ name: hit.label, value: fmtExact(hit.total) })),
    ...trace.pre.map((source) => ({ name: source.label, value: fmtExact(source.value) })),
  ]

  return (
    <span className="rte-otg" style={accent}>
      <em className="rte-otg__src">{label}</em>

      <span className="rte-otg__mul">
        <span className="rte-otg__cap">Off Tune</span>
        {built.length > 0
          ? built.map((row, index) => <Term key={`b${index}`} name={row.name} value={row.value} />)
          : <Term name={label} value="0" />}

        <span className="rte-otg__cap is-rate">Buildup rate</span>
        {trace.rateSources.map((source, index) => (
          <Term key={`r${index}`} name={source.label} value={pct(source.value)} />
        ))}
      </span>

      {trace.post.length > 0 ? (
        <span className="rte-otg__after">
          <span className="rte-otg__cap">Off Tune Level</span>
          {trace.post.map((source, index) => (
            <Term key={`p${index}`} name={source.label} value={fmtExact(source.value)} />
          ))}
        </span>
      ) : null}

      {trace.repeats !== 1 ? (
        <span className="rte-otg__rpt">
          <Term name="Repeats" value={`${fmtExact(trace.repeats)}x`} />
        </span>
      ) : null}

      <span className={`rte-otg__total${trace.after >= trace.max ? ' is-full' : ''}`}>
        <span className="rte-otg__term">
          <em className="rte-otg__tnm">Total</em>
          <b className="rte-otg__tvl">
            {trace.reset
              ? 'Reset by Tune Break'
              : trace.sealed
                ? 'Cooldown'
                : fmtExact(trace.gain)}
          </b>
        </span>
        <span className="rte-otg__gauge">
          <s className="rte-otg__was">{fmtExact(trace.before)}</s>
          <i className="rte-otg__arw" aria-hidden="true">&rarr;</i>
          <b className="rte-otg__now">{fmtExact(trace.after)}</b>
          <em className="rte-otg__max">of {fmtExact(trace.max)}</em>
        </span>
      </span>
    </span>
  )
}
