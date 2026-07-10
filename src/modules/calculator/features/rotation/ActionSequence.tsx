/*
  Author: Runor Ewhro
  Description: Renders the action sequence surface for the calculator rotation flow.
*/

import type { CSSProperties as CssProps } from 'react'
import { Infinity as InfinityIcon, Play, RotateCcw, Square } from 'lucide-react'
import type {
  DataSrcType,
  RotWhenRule,
  RtChng,
  SourceState,
} from '@/domain/gameData/contracts.ts'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { ATTR_COLORS } from '@/modules/calculator/model/display.ts'
import type {
  RotSqncCtnEn,
  RotSqncEnt,
  RotSqncRule,
  RotSqncSpan,
} from '@/modules/calculator/features/rotation/lib/sequence.ts'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay.ts'
import { fmtRtChng } from '@/shared/lib/formatGameData.ts'
import { truncTo } from '@/shared/lib/number.ts'
import {seedRsntById} from "@/modules/calculator/features/resonator/lib/seedData.ts";
import {withDefResMg} from "@/shared/lib/imageFallback.ts";

export interface RotSqncCondC {
  resonatorId: string
  sourceName: string
  label: string
  state: SourceState
}

function fmtSttVl(
  definition: SourceState,
  value: string | number | boolean | undefined,
): string {
  if (definition.kind === 'toggle') {
    return value === true ? 'True' : 'False'
  }

  if (definition.kind === 'select') {
    return definition.options?.find((option) => option.id === value)?.label ?? String(value ?? '')
  }

  return String(value ?? '')
}

function fmtCondNmbr(value: number): string {
  const truncated = truncTo(value, 2)
  return Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(2).replace(/\.?0+$/, '')
}

function prsSrcRefFro(value: string): { type: DataSrcType; id: string } | null {
  // runtime paths sometimes encode the source as `type:id`; only known game-data source types can be resolved into
  // display labels.
  const [type, id] = value.split(':')
  if ((type === 'resonator' || type === 'weapon' || type === 'echo' || type === 'echoSet') && id) {
    return { type, id }
  }

  return null
}

function findSttForRo(path: string): { state: SourceState; targetPath: boolean } | null {
  // action sequence rows explain both regular controls and selected-target routing paths by resolving them back to the
  // authored source state.
  const targetPrefix = 'runtime.routing.selectedTargetsByOwnerKey.'
  const cntrPrfx = 'runtime.state.controls.'
  const targetPath = path.startsWith(targetPrefix)
  const lookupKey = targetPath
    ? path.slice(targetPrefix.length)
    : path.startsWith(cntrPrfx)
      ? path.slice(cntrPrfx.length)
      : path
  const sourceRef = prsSrcRefFro(lookupKey)
  if (!sourceRef) {
    return null
  }

  try {
    const state = listStatesFor(sourceRef.type, sourceRef.id).find((entry) =>
      targetPath
        ? entry.ownerKey === lookupKey
        : entry.path === path || entry.controlKey === lookupKey,
    )

    return state ? { state, targetPath } : null
  } catch {
    return null
  }
}

function getRotPathLb(path: string): { label: string; state: SourceState; targetPath: boolean } | null {
  const match = findSttForRo(path)
  if (!match) {
    return null
  }

  const display = getStateText(match.state)
  return {
    ...match,
    label: match.targetPath ? `${display.label} Target` : display.label,
  }
}

function fmtRotPathVl(
  path: string,
  state: SourceState,
  value: string | number | boolean | undefined,
): string {
  // selected-target paths store resonator ids, so convert them to names when the seed table knows the member.
  if (path.startsWith('runtime.routing.selectedTargetsByOwnerKey.') && typeof value === 'string') {
    return seedRsntById[value]?.name ?? value
  }

  return fmtSttVl(state, value)
}

function getChcForRtC(
  change: RtChng,
  choices: RotSqncCondC[],
): RotSqncCondC | undefined {
  // prefer a resonator-specific match but allow a path-only fallback for enemy or legacy changes.
  return choices.find(
    (choice) => choice.state.path === change.path && (!change.resonatorId || choice.resonatorId === change.resonatorId),
  ) ?? choices.find((choice) => choice.state.path === change.path)
}

function fmtRotSqncRt(
  change: RtChng,
  choices: RotSqncCondC[],
): string {
  const choice = getChcForRtC(change, choices)
  if (choice) {
    if (change.type === 'set') {
      return `${choice.label} = ${fmtSttVl(choice.state, change.value)}`
    }

    if (change.type === 'add') {
      return `${choice.label} + ${String(change.value)}`
    }

    return `${choice.label} = ${fmtSttVl(choice.state, change.value ?? true)}`
  }

  const display = getRotPathLb(change.path)
  if (!display) {
    return fmtRtChng(change)
  }

  if (change.type === 'set') {
    return `${display.label} = ${fmtRotPathVl(change.path, display.state, change.value)}`
  }

  if (change.type === 'add') {
    return `${display.label} + ${fmtCondNmbr(change.value)}`
  }

  return `${display.label} = ${fmtRotPathVl(change.path, display.state, change.value ?? true)}`
}

function fmtRotSqncRu(
  rule: RotSqncRule,
  choices: RotSqncCondC[],
): string {
  return fmtRotSqncRt(rule.change, choices)
}

function dscrWhenRule(
  when: RotWhenRule | undefined,
  loopLabelById?: ReadonlyMap<string, string>,
): string[] {
  // the sequence strip summarizes when rules as small chips instead of reproducing the full expression tree.
  if (!when) return []
  const chips: string[] = []
  if (when.condition) {
    chips.push('Conditional')
  }
  for (const rule of when.loops ?? []) {
    const label = loopLabelById?.get(rule.loopId) ?? 'Loop'
    const runs = rule.runs.map((run) => `#${run}`).join(', ')
    chips.push(runs ? `${label} · ${runs}` : label)
  }
  return chips
}

export function CtnSqnc({
  actions,
  condChoices: condChoices = [],
  entries,
  loopLabelById: loopLabelById,
  rmnnCnt: rmnnCnt = 0,
  spans = [],
}: {
  actions: RotSqncCtnEn[]
  condChoices?: RotSqncCondC[]
  entries?: RotSqncEnt[]
  loopLabelById?: ReadonlyMap<string, string>
  rmnnCnt?: number
  spans?: RotSqncSpan[]
}) {
  const hasSpans = spans.length > 0
  const maxSpanDepth = Math.max(...spans.map((span) => span.depth), 0)
  // rails render from shallow to deep so nested repeat/uptime spans stack predictably in the gutter.
  const sortedSpans = [...spans].sort((a, b) => a.depth - b.depth || a.startIndex - b.startIndex)
  const sqncEnts = entries ?? actions.map((action): RotSqncEnt => ({ type: 'action', key: action.key, action }))

  const viewSpanGttr = (entryKey: string, index: number, activeSpans: RotSqncSpan[]) => {
    // each active span draws a rail segment for this row; start/end classes let css cap the segment correctly.
    if (!hasSpans) return null
    return (
      <span className="rss-sequence__span-gutter" aria-hidden="true">
        {activeSpans.map((span) => {
          const isStart = span.startIndex === index
          const isEnd = span.endIndex === index
          const spanRules = span.rules.map((rule) => fmtRotSqncRu(rule, condChoices))
          const tooltip = [span.label, ...spanRules].join('\n')
          return (
            <span
              key={`${entryKey}:${span.key}`}
              title={tooltip}
              data-tooltip={tooltip}
              className={[
                'rss-sequence__block-rail',
                `rss-sequence__block-rail--${span.kind}`,
                isStart ? 'rss-sequence__block-rail--start' : '',
                isEnd ? 'rss-sequence__block-rail--end' : '',
                isStart && isEnd ? 'rss-sequence__block-rail--single' : '',
              ].filter(Boolean).join(' ')}
              style={{ '--span-right': `${Math.max(0, span.depth - 1) * 0.7 + 0.32}rem` } as CssProps}
            >
              <span className="rss-sequence__block-rail-line" aria-hidden="true" />
            </span>
          )
        })}
      </span>
    )
  }

  const viewWhenMark = (when: RotWhenRule | undefined, ownerKey: string) => {
    const chips = dscrWhenRule(when, loopLabelById)
    if (chips.length === 0) return null
    const tooltip = chips.join('\n')
    return (
      <span
        key={`${ownerKey}:when`}
        className="rss-sequence__when-mark"
        title={tooltip}
        data-tooltip={tooltip}
        aria-label={`When: ${tooltip}`}
      >
        <InfinityIcon size={11} aria-hidden="true" />
      </span>
    )
  }

  return (
    <ol
      className={`rss-sequence${hasSpans ? ' rss-sequence--with-spans' : ''}`}
      style={hasSpans ? { '--span-gutter-width': `${Math.max(1, maxSpanDepth) * 0.7}rem` } as CssProps : undefined}
    >
      {sqncEnts.map((entry, index, sequence) => {
        const previous = sequence[index - 1]
        const next = sequence[index + 1]
        const activeSpans = sortedSpans.filter((span) => index >= span.startIndex && index <= span.endIndex)

        if (entry.type === 'loopMarker') {
          const className = [
            'rss-sequence__step',
            'rss-sequence__step--loop-marker',
            `rss-sequence__step--loop-${entry.kind}`,
            entry.phase === 'setup' ? 'rss-sequence__step--setup' : '',
            activeSpans.length > 0 ? 'rss-sequence__step--spanned' : '',
            entry.enabled ? '' : 'rss-sequence__step--disabled',
          ].filter(Boolean).join(' ')
          const Glyph = entry.kind === 'end' ? Square : entry.kind === 'self' ? RotateCcw : Play
          const badgeText = entry.kind === 'end' ? 'end' : entry.kind === 'self' ? 'Start / End' : 'start'
          const showRuns = entry.kind !== 'end'
          return (
            <li
              key={entry.key}
              className={className}
              style={{ '--rotation-loop-color': entry.color } as CssProps}
            >
              <span className="rotation-loop-marker__title">
                <span className="rotation-loop-marker__badge">
                  <Glyph fill={entry.kind === 'self' ? 'none' : 'currentColor'} aria-hidden="true" />
                  {badgeText}
                </span>
                <span className="entry-name rotation-loop-marker__name">{entry.label}</span>
              </span>
              {viewWhenMark(entry.when, entry.key)}
              {showRuns ? (
                <span className="rss-sequence__loop-runs" title={`Runs ${entry.runs} ${entry.runs === 1 ? 'time' : 'times'}`}>
                  ×{entry.runs}
                </span>
              ) : null}
              {viewSpanGttr(entry.key, index, activeSpans)}
            </li>
          )
        }

        if (entry.type === 'condition') {
          const rules = entry.rules.map((rule) => fmtRotSqncRu(rule, condChoices))
          const className = [
            'rss-sequence__step',
            'rss-sequence__step--condition',
            entry.phase === 'setup' ? 'rss-sequence__step--setup' : '',
            activeSpans.length > 0 ? 'rss-sequence__step--spanned' : '',
            entry.enabled ? '' : 'rss-sequence__step--disabled',
          ].filter(Boolean).join(' ')

          return (
            <li
              key={entry.key}
              className={className}
              style={{ '--condition-depth': Math.max(0, entry.depth - 1) } as CssProps}
            >
              <div className="rss-sequence__condition-card">
                <div className="rss-sequence__condition-main">
                  {rules.length > 0 ? (
                    <span className="rss-sequence__condition-rules">
                      {rules.map((rule, ruleIndex) => (
                        <span key={`${entry.key}:rule:${ruleIndex}`} className="rss-sequence__condition-kicker">
                          {rule}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="rss-sequence__condition-empty">No changes set</span>
                  )}
                </div>
              </div>
              {viewSpanGttr(entry.key, index, activeSpans)}
            </li>
          )
        }

        const { action } = entry
        const prvsCtn = previous?.type === 'action' ? previous.action : null
        const nextAction = next?.type === 'action' ? next.action : null
        const sameAsPrvs = Boolean(action.resonatorId && prvsCtn?.resonatorId === action.resonatorId)
        const sameAsNext = Boolean(action.resonatorId && nextAction?.resonatorId === action.resonatorId)
        const rules = action.rules.map((rule) => fmtRotSqncRu(rule, condChoices))
        const className = [
          'rss-sequence__step',
          sameAsPrvs ? 'rss-sequence__step--continued' : '',
          sameAsNext ? 'rss-sequence__step--links-next' : '',
          entry.phase === 'setup' ? 'rss-sequence__step--setup' : '',
          activeSpans.length > 0 ? 'rss-sequence__step--spanned' : '',
          rules.length > 0 ? 'rss-sequence__step--feature-conditions' : '',
          action.missing ? 'rss-sequence__step--missing' : '',
        ].filter(Boolean).join(' ')

        return (
          <li
            key={entry.key}
            className={className}
            style={action.attribute ? { '--member-attribute': ATTR_COLORS[action.attribute] } as CssProps : undefined}
          >
            {sameAsPrvs ? (
              <span className="rss-sequence__link" aria-hidden="true" />
            ) : (
              <span className="rss-sequence__avatar-wrap">
                {action.profile ? (
                  <img className="rss-sequence__avatar" src={action.profile} alt="" aria-hidden="true" onError={withDefResMg} />
                ) : (
                  <span className="rss-sequence__avatar rss-sequence__avatar--empty" aria-hidden="true" />
                )}
              </span>
            )}
            {viewWhenMark(entry.when, entry.key)}
            <span className="rss-sequence__label">
              {action.label}
              {typeof action.negEfxStck === 'number' ? (
                <sup
                  className="rss-sequence__stack-count"
                  aria-label={`${action.negEfxStck} stacks`}
                >
                  {action.negEfxStck}
                </sup>
              ) : null}
            </span>
            {rules.length > 0 ? (
              <span className="rss-sequence__feature-conditions">
                <span className="rss-sequence__feature-condition-pills">
                  {rules.map((rule, ruleIndex) => (
                    <span key={`${action.key}:feature-rule:${ruleIndex}`} className="rss-sequence__condition-kicker">
                      {rule}
                    </span>
                  ))}
                </span>
              </span>
            ) : null}
            {action.multiplier > 1 ? (
              <span className="rss-sequence__multiplier">x{action.multiplier}</span>
            ) : null}
            {viewSpanGttr(entry.key, index, activeSpans)}
          </li>
        )
      })}
      {rmnnCnt > 0 ? (
        <li className="rss-sequence__step rss-sequence__step--more">
          +{rmnnCnt} more
        </li>
      ) : null}
    </ol>
  )
}
