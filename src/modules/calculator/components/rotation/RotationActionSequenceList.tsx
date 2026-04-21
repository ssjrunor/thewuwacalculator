import type { CSSProperties } from 'react'
import type {
  DataSourceType,
  RuntimeChange,
  SourceStateDefinition,
} from '@/domain/gameData/contracts'
import { listStatesForSource } from '@/domain/services/gameDataService'
import { seedResonatorsById } from '@/modules/calculator/model/seedData'
import { ATTRIBUTE_COLORS } from '@/modules/calculator/model/display'
import type {
  RotationSequenceActionEntry,
  RotationSequenceEntry,
  RotationSequenceRule,
  RotationSequenceSpan,
} from '@/modules/calculator/model/rotationSequence'
import { getSourceStateDisplay } from '@/modules/calculator/model/sourceStateDisplay'
import { formatRuntimeChange } from '@/shared/lib/formatGameData'

export interface RotationSequenceConditionChoice {
  resonatorId: string
  sourceName: string
  label: string
  state: SourceStateDefinition
}

function formatStateValue(
  definition: SourceStateDefinition,
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

function formatConditionNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return value.toFixed(2).replace(/\.?0+$/, '')
}

function parseSourceRefFromRuntimeKey(value: string): { type: DataSourceType; id: string } | null {
  const [type, id] = value.split(':')
  if ((type === 'resonator' || type === 'weapon' || type === 'echo' || type === 'echoSet') && id) {
    return { type, id }
  }

  return null
}

function findStateForRotationPath(path: string): { state: SourceStateDefinition; targetPath: boolean } | null {
  const targetPrefix = 'runtime.routing.selectedTargetsByOwnerKey.'
  const controlsPrefix = 'runtime.state.controls.'
  const targetPath = path.startsWith(targetPrefix)
  const lookupKey = targetPath
    ? path.slice(targetPrefix.length)
    : path.startsWith(controlsPrefix)
      ? path.slice(controlsPrefix.length)
      : path
  const sourceRef = parseSourceRefFromRuntimeKey(lookupKey)
  if (!sourceRef) {
    return null
  }

  try {
    const state = listStatesForSource(sourceRef.type, sourceRef.id).find((entry) =>
      targetPath
        ? entry.ownerKey === lookupKey
        : entry.path === path || entry.controlKey === lookupKey,
    )

    return state ? { state, targetPath } : null
  } catch {
    return null
  }
}

function getRotationPathLabel(path: string): { label: string; state: SourceStateDefinition; targetPath: boolean } | null {
  const match = findStateForRotationPath(path)
  if (!match) {
    return null
  }

  const display = getSourceStateDisplay(match.state)
  return {
    ...match,
    label: match.targetPath ? `${display.label} Target` : display.label,
  }
}

function formatRotationPathValue(
  path: string,
  state: SourceStateDefinition,
  value: string | number | boolean | undefined,
): string {
  if (path.startsWith('runtime.routing.selectedTargetsByOwnerKey.') && typeof value === 'string') {
    return seedResonatorsById[value]?.name ?? value
  }

  return formatStateValue(state, value)
}

function getChoiceForRuntimeChange(
  change: RuntimeChange,
  choices: RotationSequenceConditionChoice[],
): RotationSequenceConditionChoice | undefined {
  return choices.find(
    (choice) => choice.state.path === change.path && (!change.resonatorId || choice.resonatorId === change.resonatorId),
  ) ?? choices.find((choice) => choice.state.path === change.path)
}

function formatRotationSequenceRuntimeChange(
  change: RuntimeChange,
  choices: RotationSequenceConditionChoice[],
): string {
  const choice = getChoiceForRuntimeChange(change, choices)
  if (choice) {
    if (change.type === 'set') {
      return `${choice.label} = ${formatStateValue(choice.state, change.value)}`
    }

    if (change.type === 'add') {
      return `${choice.label} + ${String(change.value)}`
    }

    return `${choice.label} = ${formatStateValue(choice.state, change.value ?? true)}`
  }

  const display = getRotationPathLabel(change.path)
  if (!display) {
    return formatRuntimeChange(change)
  }

  if (change.type === 'set') {
    return `${display.label} = ${formatRotationPathValue(change.path, display.state, change.value)}`
  }

  if (change.type === 'add') {
    return `${display.label} + ${formatConditionNumber(change.value)}`
  }

  return `${display.label} = ${formatRotationPathValue(change.path, display.state, change.value ?? true)}`
}

function formatRotationSequenceRule(
  rule: RotationSequenceRule,
  choices: RotationSequenceConditionChoice[],
): string {
  return formatRotationSequenceRuntimeChange(rule.change, choices)
}

export function RotationActionSequenceList({
  actions,
  conditionChoices = [],
  entries,
  remainingCount = 0,
  spans = [],
}: {
  actions: RotationSequenceActionEntry[]
  conditionChoices?: RotationSequenceConditionChoice[]
  entries?: RotationSequenceEntry[]
  remainingCount?: number
  spans?: RotationSequenceSpan[]
}) {
  const hasSpans = spans.length > 0
  const maxSpanDepth = Math.max(...spans.map((span) => span.depth), 0)
  const sortedSpans = [...spans].sort((a, b) => a.depth - b.depth || a.startIndex - b.startIndex)
  const sequenceEntries = entries ?? actions.map((action): RotationSequenceEntry => ({ type: 'action', key: action.key, action }))

  return (
    <ol
      className={`rss-sequence${hasSpans ? ' rss-sequence--with-spans' : ''}`}
      style={hasSpans ? { '--span-gutter-width': `${Math.max(1, maxSpanDepth) * 0.7}rem` } as CSSProperties : undefined}
    >
      {sequenceEntries.map((entry, index, sequence) => {
        const previous = sequence[index - 1]
        const next = sequence[index + 1]
        const activeSpans = sortedSpans.filter((span) => index >= span.startIndex && index <= span.endIndex)

        if (entry.type === 'condition') {
          const rules = entry.rules.map((rule) => formatRotationSequenceRule(rule, conditionChoices))
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
              style={{ '--condition-depth': Math.max(0, entry.depth - 1) } as CSSProperties}
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
              {hasSpans ? (
                <span className="rss-sequence__span-gutter" aria-hidden="true">
                  {activeSpans.map((span) => {
                    const isStart = span.startIndex === index
                    const isEnd = span.endIndex === index
                    const spanRules = span.rules.map((rule) => formatRotationSequenceRule(rule, conditionChoices))
                    return (
                      <span
                        key={`${entry.key}:${span.key}`}
                        title={[span.label, ...spanRules].join('\n')}
                        data-tooltip={[span.label, ...spanRules].join('\n')}
                        className={[
                          'rss-sequence__block-rail',
                          `rss-sequence__block-rail--${span.kind}`,
                          isStart ? 'rss-sequence__block-rail--start' : '',
                          isEnd ? 'rss-sequence__block-rail--end' : '',
                          isStart && isEnd ? 'rss-sequence__block-rail--single' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ '--span-right': `${Math.max(0, span.depth - 1) * 0.7 + 0.32}rem` } as CSSProperties}
                      >
                        <span className="rss-sequence__block-rail-line" aria-hidden="true" />
                      </span>
                    )
                  })}
                </span>
              ) : null}
            </li>
          )
        }

        const { action } = entry
        const previousAction = previous?.type === 'action' ? previous.action : null
        const nextAction = next?.type === 'action' ? next.action : null
        const sameAsPrevious = Boolean(action.resonatorId && previousAction?.resonatorId === action.resonatorId)
        const sameAsNext = Boolean(action.resonatorId && nextAction?.resonatorId === action.resonatorId)
        const rules = action.rules.map((rule) => formatRotationSequenceRule(rule, conditionChoices))
        const className = [
          'rss-sequence__step',
          sameAsPrevious ? 'rss-sequence__step--continued' : '',
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
            style={action.attribute ? { '--member-attribute': ATTRIBUTE_COLORS[action.attribute] } as CSSProperties : undefined}
          >
            {sameAsPrevious ? (
              <span className="rss-sequence__link" aria-hidden="true" />
            ) : (
              <span className="rss-sequence__avatar-wrap">
                {action.profile ? (
                  <img className="rss-sequence__avatar" src={action.profile} alt="" aria-hidden="true" />
                ) : (
                  <span className="rss-sequence__avatar rss-sequence__avatar--empty" aria-hidden="true" />
                )}
              </span>
            )}
            <span className="rss-sequence__label">
              {action.label}
              {typeof action.negativeEffectStacks === 'number' ? (
                <sup
                  className="rss-sequence__stack-count"
                  aria-label={`${action.negativeEffectStacks} stacks`}
                >
                  {action.negativeEffectStacks}
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
            {hasSpans ? (
              <span className="rss-sequence__span-gutter" aria-hidden="true">
                {activeSpans.map((span) => {
                  const isStart = span.startIndex === index
                  const isEnd = span.endIndex === index
                  const rules = span.rules.map((rule) => formatRotationSequenceRule(rule, conditionChoices))
                  return (
                    <span
                      key={`${action.key}:${span.key}`}
                      title={[span.label, ...rules].join('\n')}
                      data-tooltip={[span.label, ...rules].join('\n')}
                      className={[
                        'rss-sequence__block-rail',
                        `rss-sequence__block-rail--${span.kind}`,
                        isStart ? 'rss-sequence__block-rail--start' : '',
                        isEnd ? 'rss-sequence__block-rail--end' : '',
                        isStart && isEnd ? 'rss-sequence__block-rail--single' : '',
                      ].filter(Boolean).join(' ')}
                      style={{ '--span-right': `${Math.max(0, span.depth - 1) * 0.7 + 0.32}rem` } as CSSProperties}
                    >
                      <span className="rss-sequence__block-rail-line" aria-hidden="true" />
                    </span>
                  )
                })}
              </span>
            ) : null}
          </li>
        )
      })}
      {remainingCount > 0 ? (
        <li className="rss-sequence__step rss-sequence__step--more">
          +{remainingCount} more
        </li>
      ) : null}
    </ol>
  )
}
