/*
  Author: Runor Ewhro
  Description: Projects executed rotation rows into the shared register with structural ownership metadata.
*/

import type { CSSProperties, MouseEvent } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import type {
  EditorMember,
  EditorStep,
  LoopRunSelections,
  NodeOwner,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import type {
  FlatRow,
  FlatScope,
  FlatRowTarget,
  FlatWrite,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/flatRows.ts'
import {
  decorateFlatRows,
  flatPeak,
  flatTargetMatchesRuns,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/flatRows.ts'
import type { RotationNodeRevealRequest } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/nodeNavigation.ts'
import {
  buildRegister,
  factorAt,
  formatDamage,
  fmtStat,
  isTextStatKey,
  type OffTuneAuthoringState,
  shortStat,
  stepDamageAt,
  type DamageDecimals,
  type PercentDisplay,
  type RegisterGroup,
  type StatKey,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'
import {
  OffTuneCell,
  RegisterHead,
  bandCells,
  registerVars,
  useScrollbarInset,
} from '@/modules/simulation/surfaces/rotation/program-editor/components/RegisterCells.tsx'
import {
  makeRoster,
  type TeamLookup,
} from '@/modules/simulation/surfaces/rotation/program-editor/components/NodeList.tsx'
import { RES_NODE_KEYS, glyphVars, resNodeIcon, type ResNodeKey } from '@/shared/lib/gameAssets.ts'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { formatEffectConditionName } from '@/modules/simulation/model/sourceStateDisplay.ts'

/*
  the glyph says both what kind of skill this is and whose it is, so the two
  word columns the register spends on saying that are dropped here rather than
  repeated as text beside their own art.
*/
const NODE_KEYS = new Set<string>(RES_NODE_KEYS)

interface FlatListProps {
  rows: readonly FlatRow[]
  members: EditorMember[]
  statKeys: readonly StatKey[]
  groupOrder: readonly RegisterGroup[]
  shutGroups: ReadonlySet<RegisterGroup>
  onToggleGroup: (group: RegisterGroup) => void
  decimals: DamageDecimals
  percentDisplay: PercentDisplay
  selectedId: string | null
  runsByLoopId: LoopRunSelections
  selectionMode: boolean
  selectedIds: ReadonlySet<string>
  compareMode: boolean
  compareMark: (id: string) => 'on' | 'off' | null
  onCompareToggle: (id: string) => void
  onSelect: (target: FlatRowTarget) => void
  onAddSelection: (id: string) => void
  onRangeSelection: (id: string) => void
  onToggleSelection: (id: string) => void
  /** move where Off-Tune starts counting again after a Tune Break */
  onOffTuneResume: (id: string, on: boolean) => void
  offTuneAuthoring: ReadonlyMap<string, OffTuneAuthoringState>
  revealRequest: RotationNodeRevealRequest | null
}

/** the talent node glyph, or the element it afflicts when the skill has no node */
function StepGlyph({ step, roster }: { step: EditorStep; roster: TeamLookup }) {
  const tab = step.kindLabel
  if (step.owner.kind === 'member' && NODE_KEYS.has(tab)) {
    return (
      <i className="rtf-node"
        style={glyphVars(resNodeIcon(step.owner.memberId, tab as ResNodeKey))}
        aria-hidden="true"
      />
    )
  }
  const attribute = getAttributeIconSrc(step.element)
  if (attribute) {
    return <img className="rtf-mark" src={attribute} alt="" loading="lazy" />
  }
  const art = roster.art(step.owner)
  return <img className="rtf-mark" src={art.src} alt="" onError={art.onError} loading="lazy" />
}

function ConditionLine({
  write,
  roster,
  className,
  selected,
  focusSelected,
  selectionMode,
  nodeId,
  onClick,
}: {
  write: FlatWrite
  roster: TeamLookup
  className: string
  selected: boolean
  focusSelected: boolean
  selectionMode: boolean
  nodeId: string
  onClick: (event: MouseEvent<HTMLElement>) => void
}) {
  const owner: NodeOwner | undefined = write.memberId
    ? { kind: 'member', memberId: write.memberId }
    : write.owner
  const art = owner ? roster.art(owner) : null
  const src = write.sourceIcon ?? art?.src ?? ''
  const held = write.memberId ? roster.member(write.memberId)?.name ?? art?.alt ?? '' : ''
  const became = write.memberId ? held : write.value
  const hasPrior = !write.memberId && write.from !== undefined && write.from !== ''

  return (
    <button
      type="button"
      className={`rtf-cond${write.rising ? ' is-up' : ' is-down'} rte-cond${className}`}
      style={roster.accent(owner)}
      title={`${formatEffectConditionName(write.effectName, write.label)} . ${became}`}
      data-rte-node-id={nodeId}
      data-rte-flat-selected={selected ? 'true' : undefined}
      data-selection-focus-item="true"
      aria-pressed={selectionMode ? undefined : selected}
      aria-selected={selectionMode ? focusSelected : undefined}
      onClick={onClick}
    >
      {/* the same count gutter the hits hold, so every mark lands on one edge */}
      <i className="rtf-ord" aria-hidden="true" />
      <i className="rte-cond__tick" aria-hidden="true">
        {src ? <img className="rte-cond__art" src={src} alt="" onError={art?.onError} loading="lazy" /> : null}
      </i>
      <em className="rte-cond__name">
        {formatEffectConditionName(write.effectName, write.label)}
      </em>
      <span className="rte-cond__fill" />
      <span className="rte-cond__delta">
        {hasPrior ? (
          <>
            <s className="rte-cond__was">{write.from}</s>
            <i className="rte-cond__arrow" aria-hidden="true">&rarr;</i>
          </>
        ) : null}
        <b className="rte-cond__now">{became}</b>
      </span>
    </button>
  )
}

function scopeText(scope: FlatScope): string {
  if (scope.kind === 'uptime') {
    return `${scope.label} · ${Math.round((scope.ratio ?? 1) * 100)}%`
  }
  if (scope.kind === 'repeat') return `${scope.label} · ×${scope.runs}`
  return `${scope.label} · ${scope.run}/${scope.runs}`
}

export function FlatList({
  rows,
  members,
  statKeys,
  groupOrder,
  shutGroups,
  onToggleGroup,
  decimals,
  percentDisplay,
  selectedId,
  runsByLoopId,
  selectionMode,
  selectedIds,
  compareMode,
  compareMark,
  onCompareToggle,
  onSelect,
  onAddSelection,
  onRangeSelection,
  onToggleSelection,
  onOffTuneResume,
  offTuneAuthoring,
  revealRequest,
}: FlatListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const consumedRevealTokenRef = useRef<number | null>(null)
  useScrollbarInset(listRef, scrollerRef)

  const roster = useMemo(() => makeRoster(members), [members])
  const drawn = useMemo(() => decorateFlatRows(rows), [rows])
  const peakDamage = useMemo(() => flatPeak(rows), [rows])

  /*
    the same register the authoring list is showing. the two are one reading of
    one rotation, so toggling between them must not move a column.
  */
  const register = useMemo(
    () => buildRegister(statKeys, shutGroups, groupOrder),
    [statKeys, shutGroups, groupOrder],
  )

  const showGlyph = !statKeys.includes('talentNode')

  const rowState = (
    row: FlatRow,
    joinsBefore = false,
    joinsAfter = false,
  ) => {
    const exact = flatTargetMatchesRuns(row.target, runsByLoopId)
    const selected = !selectionMode && selectedId === row.target.nodeId && exact
    const focusSelected = selectionMode && selectedIds.has(row.target.nodeId)
    const mark = compareMark(row.target.nodeId)
    const className = `${mark ? ` is-cmp-${mark}` : ''}${selected ? ' is-selected' : ''}${
      selectionMode ? ' selection-mode' : ''
    }${focusSelected ? ' focus-selected' : ''}${
      joinsBefore ? ' selection-joins-before' : ''
    }${joinsAfter ? ' selection-joins-after' : ''}`
    return { selected, focusSelected, className }
  }

  const selectRow = (event: MouseEvent<HTMLElement>, target: FlatRowTarget) => {
    if (event.defaultPrevented) return
    const id = target.nodeId

    if (compareMode) {
      event.preventDefault()
      event.stopPropagation()
      if (compareMark(id) !== 'off') onCompareToggle(id)
      return
    }
    if (event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      onRangeSelection(id)
      return
    }
    if (selectionMode) {
      event.preventDefault()
      event.stopPropagation()
      onToggleSelection(id)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      event.stopPropagation()
      onAddSelection(id)
      return
    }
    onSelect(target)
  }

  useEffect(() => {
    const scroller = scrollerRef.current
    const token = revealRequest?.token
    const revealNodeId = revealRequest?.nodeId
    if (
      !scroller
      || token == null
      || !revealNodeId
      || consumedRevealTokenRef.current === token
      || selectionMode
    ) return
    consumedRevealTokenRef.current = token
    const reduceMotion = Boolean(scroller.closest('.reduce-animation'))
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frame = window.requestAnimationFrame(() => {
      const target = [...scroller.querySelectorAll<HTMLElement>('[data-rte-flat-selected="true"]')]
        .find((element) => element.dataset.rteNodeId === revealNodeId)
      if (!target) return
      target.focus({ preventScroll: true })
      target.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [revealRequest?.nodeId, revealRequest?.token, rows, runsByLoopId, selectedId, selectionMode])

  if (drawn.length === 0) {
    return (
      <div className="rte-list is-flat">
        <p className="rte-empty">Run the rotation to see what it did.</p>
      </div>
    )
  }

  return (
    <div className="rte-list is-flat" ref={listRef} style={registerVars(register)}>
      <RegisterHead
        register={register}
        percentDisplay={percentDisplay}
        onToggleGroup={onToggleGroup}
      />

      <div className="rte-rows rte-scroll" ref={scrollerRef}>
        {drawn.map((entry, index) => {
          const { row, band, face, ghost, ordinal } = entry
          const previous = drawn[index - 1]
          const next = drawn[index + 1]
          const focusSelected = selectionMode && selectedIds.has(row.target.nodeId)
          const joinsBefore = focusSelected
            && !band
            && Boolean(previous && selectedIds.has(previous.row.target.nodeId))
          const joinsAfter = focusSelected
            && Boolean(next && !next.band && selectedIds.has(next.row.target.nodeId))
          /*
            the tree brackets what was written; this brackets who was holding
            the field. same device, and the only grouping an execution order
            can honestly offer.
          */
          /*
            a container opens with a rule across the run and its name set at
            the end of it. the body is not indented: an execution order is one
            sequence, and stepping it in would say the hits inside a loop are a
            different kind of thing from the hits outside it.
          */
          const bandLine = band ? (
            <div className="rtf-band">
              <span className="rtf-band__rule" aria-hidden="true" />
              {band.map((scope, index) => (
                <span
                  key={`${scope.id}#${scope.run}`}
                  className={`rtf-band__tag${scope.transient ? ' is-transient' : ''}`}
                >
                  {index > 0 ? <i aria-hidden="true">{'\u203A'}</i> : null}
                  {scopeText(scope)}
                </span>
              ))}
            </div>
          ) : null

          if (row.kind === 'state') {
            const state = rowState(row, joinsBefore, joinsAfter)
            return (
              <div key={row.key} className="rtf-seg">
                {bandLine}
                {row.writes.map((write) => (
                  <ConditionLine
                    key={write.id}
                    write={write}
                    roster={roster}
                    className={state.className}
                    selected={state.selected}
                    focusSelected={state.focusSelected}
                    selectionMode={selectionMode}
                    nodeId={row.target.nodeId}
                    onClick={(event) => selectRow(event, row.target)}
                  />
                ))}
              </div>
            )
          }

          const step = row.step
          const damage = stepDamageAt(step, row.run)
          const multiplier = step.multiplierByRun?.[row.run] ?? step.multiplier

          const holderArt = roster.art({ kind: 'member', memberId: step.memberId })
          const state = rowState(row, joinsBefore, joinsAfter)

          return (
            <div key={row.key} className="rtf-seg">
              {bandLine}
              <button
                type="button"
                className={`rtf-row${face ? ' is-open' : ''} rte-row${state.className}`}
                style={roster.accent(step.owner, {
                  color: step.color,
                  element: step.element,
                  aggregationType: step.aggregationType,
                })}
                data-rte-node-id={row.target.nodeId}
                data-rte-flat-selected={state.selected ? 'true' : undefined}
                data-selection-focus-item="true"
                aria-pressed={selectionMode ? undefined : state.selected}
                aria-selected={selectionMode ? state.focusSelected : undefined}
                onClick={(event) => selectRow(event, row.target)}
              >
                <span className="rte-step">
                  {/*
                    the count sits inside the name column rather than taking a
                    track, so every register column stays exactly where the
                    authoring list puts it.
                  */}
                  <i className="rtf-ord">{ordinal}</i>
                  {/* the holder is named where the wash starts and nowhere else */}
                  <span className="rte-step__owner rtf-rail is-held">
                    {face ? (
                      <img className="rte-step__art"
                        src={holderArt.src}
                        alt={holderArt.alt}
                        onError={holderArt.onError}
                        loading="lazy"
                      />
                    ) : null}
                  </span>
                  {showGlyph ? <StepGlyph step={step} roster={roster} /> : null}
                  <em className="rte-step__name">{step.label}</em>
                  {multiplier > 1 ? <i className="rte-step__mult">x{multiplier}</i> : null}
                  <span className="rte-step__fill" />
                </span>
                {bandCells(
                  register,
                  <span className="rte-dmg">
                    <i
                      style={{
                        '--w': `${(damage / Math.max(1, peakDamage)) * 100}%`,
                      } as CSSProperties}
                    />
                    <b>{formatDamage(damage, decimals)}</b>
                  </span>,
                  (key) => {
                    const value = fmtStat(factorAt(step, row.run, key), key, decimals, percentDisplay)
                    const text = isTextStatKey(key) ? shortStat(key, value) : value
                    if (key === 'offTune') {
                      return (
                        <OffTuneCell key={key}
                          step={step}
                          run={row.run}
                          text={text}
                          ghost={ghost.has(key)}
                          accent={roster.accent(step.owner)}
                          onResume={onOffTuneResume}
                          authoringState={offTuneAuthoring.get(step.id)}
                        />
                      )
                    }
                    return (
                      <span
                        key={key}
                        className={`rte-stat${isTextStatKey(key) ? ' is-text' : ''}`
                          + `${ghost.has(key) ? ' is-ghost' : ''}`}
                        title={isTextStatKey(key) ? value : undefined}
                      >
                        {text}
                      </span>
                    )
                  },
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
