/*
  Author: Runor Ewhro
  Description: Renders the modals surface for the calculator rotation flow.
*/

import type {
  CondChoice,
  FeatCondDrft,
  FeatureMeta,
  NodeTotals,
} from "@/modules/calculator/features/rotation/lib/types.ts";
import type {CondExpr, RotationNode, RotWhenRule, RtChng} from "@/domain/gameData/contracts.ts";
import {useEffect, useMemo, useState} from "react";
import {
  makeCondValue,
  fmtCondChcLb, isNmrcCondSt,
  makeFeatCond,
  mkFeatCondDr,
  normFeatCond, prsPtnlNtgrN,
  viewCondVlFl, serFeatCondD
} from "@/modules/calculator/features/rotation/lib/conditions.tsx";
import {makeNodeId} from "@/modules/calculator/features/rotation/lib/utils.ts";
import {AppModal} from "@/shared/ui/AppModal.tsx";
import {MdlClsBttn} from "@/shared/ui/ModalCloseButton.tsx";
import {LiquidSelect, type SelectOption, type SelectGroup} from "@/shared/ui/LiquidSelect.tsx";
import {Expandable} from "@/shared/ui/Expandable.tsx";
import {Minus, Play, Plus, RotateCcw, Search, Square, Trash2, X} from "lucide-react";
import {RichDscr} from "@/shared/ui/RichDescription.tsx";
import {
  makeNegDraft,
  saveNegDraft
} from "@/modules/calculator/model/negativeEffectConfig.ts";
import {getNegFfctTt} from "@/domain/gameData/negativeEffects.ts";
import * as React from "react";
import {HexColorInput as HexClrNpt, HexColorPicker as HexClrPckr} from "react-colorful";
import {
  mkRotLoopLbl,
  fmtLoopTtls,
  mkLoopDrftRo,
  normLoopRuns,
  ROT_LOOP_COLORS,
  type RotLoopDrftR,
  type RotLoopInfo,
} from "@/modules/calculator/features/rotation/lib/loops.ts";
import type { RotWhenRow } from '@/modules/calculator/features/rotation/lib/inspection.ts'
import { RotVls } from '@/modules/calculator/features/rotation/NodeDeets.tsx'
import type { StateGroup } from '@/modules/calculator/model/stateSummary.ts'
import {withDefIconM} from "@/shared/lib/imageFallback.ts";

type WhenView = 'edit' | 'loop' | 'states'

export function ModalFrame({
                             visible,
                             open,
                             closing = false,
                             title,
                             width = 'regular',
                             bodyClssName: bodyClssName,
                             onClose,
                             children,
                             footer,
                             hdrCtns: hdrCtns,
                           }: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  title: string
  width?: 'regular' | 'wide'
  bodyClssName?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  hdrCtns?: React.ReactNode
}) {
  if (!visible) {
    return null
  }

  return (
    <AppModal
      state={{visible, open, closing}}
      variant="rotation-editor"
      size={width}
      ariaLabel={title}
      onClose={onClose}
    >
      <div className="app-modal-header">
        <div className="app-modal-header-top">
          <div>
            <div className="panel-overline">Rotation</div>
            <h3 className="panel-heading-title">{title}</h3>
          </div>
          <div className="rotation-modal-header-actions">
            {hdrCtns}
            <MdlClsBttn onClick={onClose} />
          </div>
        </div>
      </div>
      <div
        className={['skills-modal-content-area', 'rotation-editor-modal-body', bodyClssName]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>
      {footer ? <div className="rotation-modal-footer">{footer}</div> : null}
    </AppModal>
  )
}

export function Condition({
                            visible,
                            open,
                            closing = false,
                            choices,
                            ntlChng: initChng,
                            featureLabel,
                            eyebrow = 'Feature Conditions',
                            emptyText = 'Select a state from the picker to attach a condition.',
                            onClose,
                            onSave,
                          }: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  choices: CondChoice[]
  ntlChng: RtChng[]
  featureLabel: string
  eyebrow?: string
  emptyText?: string
  onClose: () => void
  onSave: (changes: RtChng[]) => void
}) {
  const [rows, setRows] = useState<FeatCondDrft[]>([])
  const [activeRowId, setActRowId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!visible) {
      return
    }

    // reopen from serialized runtime changes every time the modal becomes visible so abandoned draft edits never leak
    // into the next condition edit session.
    const nextRows = initChng.map((change) => makeFeatCond(change, choices, makeNodeId))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(nextRows)
    setActRowId(nextRows[0]?.id ?? null)
    setQuery('')
  }, [choices, initChng, visible])

  const activeRow = rows.find((row) => row.id === activeRowId) ?? null
  const nrmlQry = query.trim().toLowerCase()
  const fltrChcs = useMemo(() => {
    // search across display labels and source names because feature conditions are usually remembered by buff source
    // rather than by their raw state path.
    if (!nrmlQry) {
      return choices
    }

    return choices.filter((choice) =>
      [
        choice.label,
        choice.sourceName,
        choice.resName,
        fmtCondChcLb(choice),
      ].some((value) => value.toLowerCase().includes(nrmlQry)),
    )
  }, [choices, nrmlQry])
  const grpdChcs = useMemo(() => {
    const groups: Array<{ key: string; label: string; choices: CondChoice[] }> = []
    const groupByKey = new Map<string, { key: string; label: string; choices: CondChoice[] }>()

    // preserve first-seen order while still collecting states under their resonator/source heading.
    for (const choice of fltrChcs) {
      const key = `${choice.resonatorId}:${choice.sourceName}`
      const label = choice.sourceName === choice.resName
        ? choice.resName
        : `${choice.resName} · ${choice.sourceName}`
      let group = groupByKey.get(key)
      if (!group) {
        group = { key, label, choices: [] }
        groupByKey.set(key, group)
        groups.push(group)
      }
      group.choices.push(choice)
    }

    return groups
  }, [fltrChcs])

  const updateRow = (rowId: string, updater: (row: FeatCondDrft) => FeatCondDrft) => {
    setRows((current) => current.map((row) => (row.id === rowId ? updater(row) : row)))
  }

  const addRow = () => {
    const nextRow = mkFeatCondDr(choices[0], 'set', makeNodeId)
    setRows((current) => [...current, nextRow])
    setActRowId(nextRow.id)
  }

  const removeRow = (rowId: string) => {
    setRows((current) => {
      const nextRows = current.filter((row) => row.id !== rowId)
      if (activeRowId === rowId) {
        setActRowId(nextRows[0]?.id ?? null)
      }
      return nextRows
    })
  }

  const selChcForAct = (choice: CondChoice) => {
    if (!activeRow) {
      // choosing from the picker with no selected row creates a row immediately; this keeps the picker usable as an
      // add flow instead of forcing the plus button first.
      const nextRow = mkFeatCondDr(choice, 'set', makeNodeId)
      setRows((current) => [...current, nextRow])
      setActRowId(nextRow.id)
      return
    }

    updateRow(activeRow.id, (row) => {
      const action = normFeatCond(row.action, choice)
      return {
        ...row,
        action,
        choiceId: choice.id,
        value: action === 'add' ? 1 : makeCondValue(choice.state),
      }
    })
  }

  const viewRowVlFld = (row: FeatCondDrft, choice: CondChoice | undefined) => {
    if (!choice) {
      return <span className="feature-conditions-row__missing">Select a state</span>
    }

    if (row.action === 'add') {
      return (
        <input
          type="number"
          className="resonator-level-input feature-conditions-row__value"
          step={choice.state.kind === 'stack' ? 1 : 0.1}
          value={typeof row.value === 'number' ? row.value : Number(row.value) || 0}
          onChange={(event) => {
            const raw = Number(event.target.value)
            updateRow(row.id, (current) => ({
              ...current,
              value: choice.state.kind === 'stack' ? Math.floor(raw || 0) : raw || 0,
            }))
          }}
        />
      )
    }

    return viewCondVlFl(choice.state, row.value, (value) => {
      updateRow(row.id, (current) => ({
        ...current,
        value,
      }))
    })
  }

  if (!visible) {
    return null
  }

  return (
    <AppModal
      state={{visible, open, closing}}
      variant="feature-conditions"
      ariaLabel="Set feature conditions"
      onClose={onClose}
    >
      <div className="feature-conditions-root">
        <div className="feature-conditions-header">
          <div>
            <span className="feature-conditions-eyebrow">{eyebrow}</span>
            <h2 className="feature-conditions-title">{featureLabel}</h2>
          </div>
          <MdlClsBttn onClick={onClose} />
        </div>

        <div className="feature-conditions-body">
          <section className="feature-conditions-panel feature-conditions-panel--rows">
            <div className="feature-conditions-panel-head">
              <span>Attached Conditions</span>
              <button
                type="button"
                className="block-icon-button"
                title="Add condition"
                onClick={addRow}
                disabled={choices.length === 0}
              >
                <Plus size={15} />
              </button>
            </div>

            <div className="feature-conditions-row-list">
              {rows.length === 0 ? (
                <div className="soft-empty feature-conditions-empty">
                  {emptyText}
                </div>
              ) : (
                rows.map((row, rowIndex) => {
                  const choice = choices.find((entry) => entry.id === row.choiceId)
                  const canAdd = choice ? isNmrcCondSt(choice.state) : false
                  const action = normFeatCond(row.action, choice)
                  const isActive = activeRowId === row.id
                  const hasDscr = Boolean(choice?.description)

                  return (
                    <article
                      key={row.id}
                      className={`feature-conditions-row${isActive ? ' active' : ''}${isActive && hasDscr ? ' expanded' : ''}`}
                      onClick={() => setActRowId(row.id)}
                    >
                      <div className="feature-conditions-row__top">
                        <button
                          type="button"
                          className="feature-conditions-row__state"
                          onClick={() => setActRowId(row.id)}
                        >
                          <span className="feature-conditions-row__index">#{rowIndex + 1}</span>
                          <strong>{choice ? fmtCondChcLb(choice) : 'Select a state'}</strong>
                        </button>
                        <button
                          type="button"
                          className="block-icon-button delete"
                          title="Remove condition"
                          onClick={(event) => {
                            event.stopPropagation()
                            removeRow(row.id)
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="feature-conditions-row__controls">
                        <div className="feature-conditions-action-toggle" aria-label="Condition action">
                          <button
                            type="button"
                            className={action === 'set' ? 'active' : ''}
                            onClick={(event) => {
                              event.stopPropagation()
                              updateRow(row.id, (current) => ({
                                ...current,
                                action: 'set',
                                value: choice ? makeCondValue(choice.state) : true,
                              }))
                            }}
                          >
                            Set
                          </button>
                          <button
                            type="button"
                            className={action === 'add' ? 'active' : ''}
                            disabled={!canAdd}
                            onClick={(event) => {
                              event.stopPropagation()
                              updateRow(row.id, (current) => ({
                                ...current,
                                action: 'add',
                                value: 1,
                              }))
                            }}
                          >
                            Add
                          </button>
                        </div>
                        {viewRowVlFld({ ...row, action }, choice)}
                      </div>

                      {isActive && choice?.description ? (
                        <div
                          className="feature-conditions-row__description"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <RichDscr description={choice.description} params={choice.dscrPrms} />
                        </div>
                      ) : null}
                    </article>
                  )
                })
              )}
            </div>
          </section>

          <section className="feature-conditions-panel feature-conditions-panel--picker">
            <div className="feature-conditions-panel-head">
              <div className="feature-conditions-panel-head__head">
                <span>State Picker</span>
                <small>{activeRow ? 'Editing selected row' : 'Choose a state to add'}</small>
              </div>
              <div className="feature-conditions-search">
                <Search size={14} />
                <input
                  type="search"
                  value={query}
                  placeholder="Search states"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="feature-conditions-picker-list">
              {choices.length === 0 ? (
                <div className="soft-empty feature-conditions-empty">
                  No states are available for this rotation.
                </div>
              ) : grpdChcs.length === 0 ? (
                <div className="soft-empty feature-conditions-empty">
                  No states match that search.
                </div>
              ) : (
                grpdChcs.map((group) => (
                  <div key={group.key} className="feature-conditions-choice-group">
                    <span className="feature-conditions-choice-group__label">{group.label}</span>
                    <div className="feature-conditions-choice-grid">
                      {group.choices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          className={activeRow?.choiceId === choice.id ? 'feature-conditions-choice active' : 'feature-conditions-choice'}
                          onClick={() => selChcForAct(choice)}
                        >
                          <strong>{fmtCondChcLb(choice)}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="feature-conditions-footer">
          <button type="button" className="rotation-button clear" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rotation-button"
            onClick={() => onSave(serFeatCondD(rows, choices))}
          >
            Save
          </button>
        </div>
      </div>
    </AppModal>
  )
}

export function Block({
                        visible,
                        open,
                        closing = false,
                        portalTarget,
                        onClose,
                        onSelect,
                      }: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  onClose: () => void
  onSelect: (type: 'repeat' | 'uptime') => void
}) {
  return (
    <ModalFrame
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      title="Add Block"
      onClose={onClose}
    >
      <div className="rotation-block-picker">
        <button type="button" className="rotation-block-choice" onClick={() => onSelect('repeat')}>
          <strong>Repeat</strong>
          <span>Repeat a nested list a fixed number of times.</span>
        </button>
        <button type="button" className="rotation-block-choice" onClick={() => onSelect('uptime')}>
          <strong>Uptime</strong>
          <span>Run a weighted branch with optional setup nodes.</span>
        </button>
      </div>
    </ModalFrame>
  )
}

type WhenCondPrtr = Extract<CondExpr['type'], 'truthy' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'>

interface WhenCondDrft {
  id: string
  choiceId: string
  operator: WhenCondPrtr
  value: string | number | boolean
}

function isCmprCond(condition: CondExpr): condition is Extract<CondExpr, { type: WhenCondPrtr }> {
  return ['truthy', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(condition.type)
}

function flttDtblWhen(condition?: CondExpr): CondExpr[] {
  if (!condition || condition.type === 'always') {
    return []
  }

  // only flat `and` comparisons are editable here; nested expressions stay out
  // of the draft rather than being rewritten into a different boolean shape.
  return condition.type === 'and' ? condition.values.flatMap(flttDtblWhen) : [condition]
}

function getNodeWhen(node: RotationNode | null | undefined): RotWhenRule | undefined {
  if (!node) {
    return undefined
  }

  if ('when' in node && node.when) {
    return node.when
  }

  return 'condition' in node && node.condition ? { condition: node.condition } : undefined
}

function mkWhenCondDr(
  node: RotationNode | null | undefined,
  choices: CondChoice[],
): WhenCondDrft[] {
  const when = getNodeWhen(node)
  // legacy condition nodes and modern `when` rules share the same editor shape, so both are normalized into the same
  // row model before the modal renders controls.
  return flttDtblWhen(when?.condition).flatMap((condition): WhenCondDrft[] => {
    if (!isCmprCond(condition)) {
      return []
    }

    const choice = choices.find((entry) => entry.state.path === condition.path)
    if (!choice) {
      return []
    }

    return [{
      id: makeNodeId('rotation:when-condition'),
      choiceId: choice.id,
      operator: normWhenPrtr(condition.type, choice),
      value: condition.type === 'truthy'
        ? makeCondValue(choice.state)
        : normWhenVlFo(choice, condition.value),
    }]
  })
}

function serWhenCondR(rows: WhenCondDrft[], choices: CondChoice[]): CondExpr | undefined {
  // rows with missing choices are ignored because catalog data can change between saving a rotation and editing it
  // later; the rest serialize back into the smallest expression shape the simulator accepts.
  const conditions = rows.flatMap((row): CondExpr[] => {
    const choice = choices.find((entry) => entry.id === row.choiceId)
    if (!choice) {
      return []
    }

    const operator = normWhenPrtr(row.operator, choice)
    if (operator === 'truthy') {
      return [{ type: 'truthy', path: choice.state.path }]
    }

    const nmrcPrtr = ['gt', 'gte', 'lt', 'lte'].includes(operator)
    const rawValue = nmrcPrtr ? Number(row.value) : row.value
    const value = nmrcPrtr
      ? (Number.isFinite(rawValue) ? rawValue : 0)
      : rawValue

    return [{
      type: operator,
      path: choice.state.path,
      value,
    } as CondExpr]
  })

  if (conditions.length === 0) {
    return undefined
  }

  return conditions.length === 1 ? conditions[0] : { type: 'and', values: conditions }
}

const WHENPRTRPTNS: SelectOption<WhenCondPrtr>[] = [
  { value: 'truthy', label: 'is set' },
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'is not' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'at least' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'at most' },
]

function getWhenPrtrP(choice: CondChoice | null | undefined): SelectOption<WhenCondPrtr>[] {
  if (!choice) {
    return WHENPRTRPTNS
  }

  if (choice.state.kind === 'toggle') {
    return WHENPRTRPTNS.filter((option) => ['truthy', 'eq', 'neq'].includes(option.value))
  }

  if (choice.state.kind === 'select') {
    return WHENPRTRPTNS.filter((option) => ['eq', 'neq'].includes(option.value))
  }

  return WHENPRTRPTNS
}

function normWhenPrtr(
  operator: WhenCondPrtr,
  choice: CondChoice | null | undefined,
): WhenCondPrtr {
  // keep the selected operator legal for the state kind so toggles do not expose
  // numeric comparisons and selects stay on equality checks.
  const options = getWhenPrtrP(choice)
  return options.some((option) => option.value === operator)
    ? operator
    : options[0]?.value ?? 'truthy'
}

function normWhenVlFo(
  choice: CondChoice | null | undefined,
  value: string | number | boolean,
): string | number | boolean {
  if (!choice) {
    return value
  }

  if (choice.state.kind === 'toggle') {
    return typeof value === 'boolean' ? value : Boolean(makeCondValue(choice.state))
  }

  if (choice.state.kind === 'select') {
    const stringValue = String(value)
    return choice.state.options?.some((option) => option.id === stringValue)
      ? stringValue
      : makeCondValue(choice.state)
  }

  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return makeCondValue(choice.state)
  }

  return choice.state.kind === 'stack' ? Math.floor(numericValue) : numericValue
}

function shldShowWhen(operator: WhenCondPrtr): boolean {
  return operator !== 'truthy'
}

function prsLoopRunsN(value: string): number[] {
  // loop run inputs are user-authored as comma or space separated values; dedupe and sort them so serialized `when`
  // rules are deterministic.
  return Array.from(new Set(
    value
      .split(/[,\s]+/)
      .map((part) => Math.floor(Number(part.trim())))
      .filter((run) => Number.isFinite(run) && run > 0),
  )).sort((left, right) => left - right)
}

function mkLoopRunNpt(runs: number[]): string {
  return runs.join(', ')
}

function mkDefLoopRun(totalRuns: number): number[] {
  if (totalRuns <= 0) {
    return []
  }

  return Array.from({ length: totalRuns }).map((_, index) => index + 1)
}

export function Loop({
                       visible,
                       open,
                       closing = false,
                       portalTarget,
                       items,
                       loops,
                       onClose,
                       onSave,
                     }: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  items: RotationNode[]
  loops: RotLoopInfo[]
  onClose: () => void
  onSave: (rows: RotLoopDrftR[]) => void
}) {
  const [rows, setRows] = useState<RotLoopDrftR[]>([])
  const [actClrRowId, setActClrRow] = useState<string | null>(null)
  const [cstmClrOpen, setCstmClrOp] = useState(false)

  useEffect(() => {
    if (!visible) {
      return
    }

    // existing markers are rebuilt from the tree so linked start/end rows stay in sync with the current rotation
    // structure, including unsaved edits made before opening the loop modal.
    const existingRows = mkLoopDrftRo(items)
    const nextRows = existingRows.length > 0
      ? existingRows
      : [{
        id: makeNodeId('rotation:loop-start'),
        kind: 'start' as const,
        loopId: makeNodeId('rotation:loop'),
        label: mkRotLoopLbl([])(),
        color: ROT_LOOP_COLORS[0],
        runs: 1,
        isNew: true,
      }]
    setRows(nextRows)
    setActClrRow(nextRows[0]?.id ?? null)
    setCstmClrOp(false)
  }, [items, visible])

  const startRows = rows.filter((row) => row.kind === 'start')
  const endLoopIds = new Set(rows.filter((row) => row.kind === 'end').map((row) => row.loopId))
  const startRowsWth = startRows.filter((start) => !endLoopIds.has(start.loopId))
  const getVlblStart = (endRow: RotLoopDrftR): RotLoopDrftR[] => {
    // each loop can have at most one explicit end marker, but the row being edited must remain selectable so it does
    // not appear to unlink itself while browsing alternatives.
    const loopIdsUsedB = new Set(rows
      .filter((row) => row.kind === 'end' && row.id !== endRow.id)
      .map((row) => row.loopId))
    return startRows.filter((start) => !loopIdsUsedB.has(start.loopId))
  }
  const activeColorRow = rows.find((row) => row.id === actClrRowId) ?? startRows[0] ?? rows[0] ?? null
  const getLnkdStart = (row: RotLoopDrftR | null | undefined) =>
    row?.kind === 'end'
      ? startRows.find((start) => start.loopId === row.loopId) ?? null
      : null
  const getRslvLoopR = (row: RotLoopDrftR): RotLoopDrftR => {
    const linkedStart = getLnkdStart(row)
    // end markers borrow desc, color, and run count from their linked start so the editor presents a single loop
    // identity even though the tree stores two marker nodes.
    return linkedStart
      ? {
        ...row,
        loopId: linkedStart.loopId,
        label: linkedStart.label,
        color: linkedStart.color,
        runs: linkedStart.runs,
      }
      : row
  }
  const actRslvRow = activeColorRow ? getRslvLoopR(activeColorRow) : null

  const updateRow = (rowId: string, updater: (row: RotLoopDrftR) => RotLoopDrftR) => {
    setRows((current) => current.map((row) => (row.id === rowId ? updater(row) : row)))
  }

  const addRow = (kind: 'start' | 'end') => {
    const firstStart = startRowsWth[0]
    if (kind === 'end' && !firstStart) {
      return
    }

    const color = ROT_LOOP_COLORS[rows.length % ROT_LOOP_COLORS.length]
    const nextLoopLbl = mkRotLoopLbl(startRows.map((row) => row.label))()
    const nextRow: RotLoopDrftR = {
      id: makeNodeId(kind === 'start' ? 'rotation:loop-start' : 'rotation:loop-end'),
      kind,
      loopId: kind === 'start' ? makeNodeId('rotation:loop') : firstStart?.loopId ?? makeNodeId('rotation:loop'),
      label: kind === 'start' ? nextLoopLbl : '',
      color: kind === 'start' ? color : firstStart?.color ?? color,
      runs: 1,
      isNew: true,
    }
    setRows((current) => [...current, nextRow])
    setActClrRow(nextRow.id)
  }

  const removeRow = (rowId: string) => {
    setRows((current) => {
      const removed = current.find((row) => row.id === rowId)
      const next = current.filter((row) => row.id !== rowId)
      // removing a start also removes its end marker because dangling ends cannot be interpreted by the simulator.
      if (removed?.kind === 'start') {
        return next.filter((row) => row.loopId !== removed.loopId)
      }
      return next
    })
  }

  const clearRows = () => {
    setRows([])
    setActClrRow(null)
    setCstmClrOp(false)
  }

  const actLoopInfo = activeColorRow
    ? loops.find((loop) => loop.loopId === getRslvLoopR(activeColorRow).loopId) ?? null
    : null
  const lnkdStartFor = getLnkdStart(activeColorRow)
  const actTrtnRow = activeColorRow?.kind === 'start'
    ? activeColorRow
    : lnkdStartFor
  const actRunsCnt = actTrtnRow ? normLoopRuns(actTrtnRow.runs) : 0
  const vsblRunBars = Math.min(actRunsCnt, 10)
  const overflowRuns = actRunsCnt - vsblRunBars

  const setRowColor = (rowId: string, color: string) => {
    setRows((current) => {
      const target = current.find((row) => row.id === rowId)
      const rslvLoopId = target?.loopId
      // color lives on the start marker; edits made while an end marker is selected still need to update that shared
      // loop identity.
      return current.map((row) => (
        row.kind === 'start' && row.loopId === rslvLoopId ? { ...row, color } : row
      ))
    })
  }

  const actRslvClr = actRslvRow?.color ?? ROT_LOOP_COLORS[0]
  const isPrstClr = ROT_LOOP_COLORS.includes(actRslvClr)

  return (
    <ModalFrame
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      title="Loops"
      width="wide"
      bodyClssName="rotation-editor-modal-body--loops"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="rotation-button clear" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rotation-button" onClick={() => onSave(rows)}>
            Save
          </button>
        </>
      )}
    >
      <div className="rotation-loop-editor">
        <section className="rotation-loop-editor__stage">
          <header className="rotation-loop-editor__stage-head">
            <div className="rotation-loop-editor__stage-title">
              <span className="panel-overline">Loop Markers</span>
              <span className="rotation-loop-editor__stage-count">{rows.length}</span>
            </div>
            <div className="rotation-loop-editor__add-toolbar">
              <button
                type="button"
                className="rotation-loop-editor__add-btn"
                onClick={() => addRow('start')}
              >
                <Plus size={13} aria-hidden />
                Start
              </button>
              <button
                type="button"
                className="rotation-loop-editor__add-btn"
                disabled={startRowsWth.length === 0}
                onClick={() => addRow('end')}
              >
                <Plus size={13} aria-hidden />
                End
              </button>
              <button
                type="button"
                className="rotation-loop-editor__add-btn danger"
                disabled={rows.length === 0}
                onClick={clearRows}
              >
                <Trash2 size={13} aria-hidden />
                Clear
              </button>
            </div>
          </header>
          <div className="rotation-loop-editor__cards">
            {rows.length === 0 ? (
              <div className="rotation-loop-editor__empty">
                <span className="rotation-loop-editor__empty-glyph" aria-hidden>↻</span>
                <p>No loop markers yet.</p>
                <span className="rotation-loop-editor__empty-hint">Add a Start, then optionally link an End.</span>
              </div>
            ) : rows.map((row) => {
              const resolvedRow = getRslvLoopR(row)
              const linkedStart = getLnkdStart(row)
              const vlblStartRow = row.kind === 'end' ? getVlblStart(row) : []
              const isActive = row.id === actClrRowId
              const runs = normLoopRuns(resolvedRow.runs)
              return (
                <article
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className={`rotation-loop-card${isActive ? ' is-active' : ''} rotation-loop-card--${row.kind}`}
                  style={{ '--rotation-loop-color': resolvedRow.color ?? ROT_LOOP_COLORS[0] } as React.CSSProperties}
                  onClick={() => setActClrRow(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setActClrRow(row.id)
                    }
                  }}
                >
                  <div className="rotation-loop-card__head">
                    <span className="rotation-loop-marker__badge">
                      {row.kind === 'start' ? <Play fill="currentColor"/> : linkedStart ? <Square fill="currentColor"/> : <X />}
                      {row.kind}
                    </span>
                    {row.kind === 'start' ? (
                      <input
                        type="text"
                        className="rotation-loop-card__label"
                        value={row.label}
                        placeholder="Loop desc"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updateRow(row.id, (current) => ({ ...current, label: event.target.value }))}
                      />
                    ) : (
                      <span className="rotation-loop-marker__name">
                        {linkedStart?.label || 'Unlinked end'}
                      </span>
                    )}
                  </div>
                  <div className="rotation-loop-card__controls">
                    {row.kind === 'start' ? (
                      <div className="rotation-loop-card__stepper" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="rotation-loop-card__stepper-btn"
                          aria-label="Decrease runs"
                          onClick={() => updateRow(row.id, (current) => ({ ...current, runs: Math.max(1, normLoopRuns(current.runs) - 1) }))}
                        >−</button>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="rotation-loop-card__stepper-input"
                          value={runs}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, runs: normLoopRuns(event.target.value) }))}
                        />
                        <button
                          type="button"
                          className="rotation-loop-card__stepper-btn"
                          aria-label="Increase runs"
                          onClick={() => updateRow(row.id, (current) => ({ ...current, runs: normLoopRuns(current.runs) + 1 }))}
                        >+</button>
                        <span className="rotation-loop-card__stepper-label">{runs === 1 ? 'run' : 'runs'}</span>
                      </div>
                    ) : (
                      <div className="rotation-loop-card__linked" onClick={(event) => event.stopPropagation()}>
                        <span className="rotation-loop-card__linked-label">Ends...</span>
                        {vlblStartRow.length === 0 ? (
                          <span className="rotation-loop-card__linked-empty">
                            {startRows.length === 0 ? 'No starts yet' : 'All starts already have an end'}
                          </span>
                        ) : (
                          <div className="rotation-loop-card__segmented" role="radiogroup" aria-label="Linked start">
                            {vlblStartRow.map((start) => {
                              const segActive = row.loopId === start.loopId
                              return (
                                <button
                                  key={start.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={segActive}
                                  className={`rotation-loop-card__segment${segActive ? ' is-active' : ''}`}
                                  style={{ '--rotation-loop-color': start.color } as React.CSSProperties}
                                  onClick={() => {
                                    updateRow(row.id, (current) => ({
                                      ...current,
                                      loopId: start.loopId,
                                    }))
                                  }}
                                >
                                  {start.label || 'Loop'}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="rotation-loop-card__delete"
                      title="Remove loop marker"
                      aria-label="Remove loop marker"
                      onClick={(event) => {
                        event.stopPropagation()
                        removeRow(row.id)
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
        <aside
          className={`rotation-loop-editor__inspector${activeColorRow ? '' : ' is-empty'}`}
          style={actRslvRow ? ({ '--rotation-loop-color': actRslvClr } as React.CSSProperties) : undefined}
        >
          {activeColorRow && actRslvRow ? (
            <>
              <div className="rotation-loop-inspector__zone rotation-loop-inspector__zone--color">
                <span className="rotation-loop-inspector__zone-label">Color</span>
                <div className="rotation-loop-inspector__palette" role="radiogroup" aria-label="Loop color">
                  {ROT_LOOP_COLORS.map((preset) => {
                    const isCurrent = preset === actRslvClr
                    return (
                      <button
                        key={preset}
                        type="button"
                        role="radio"
                        aria-checked={isCurrent}
                        aria-label={`Color ${preset}`}
                        className={`rotation-loop-inspector__swatch${isCurrent ? ' is-active' : ''}`}
                        style={{ backgroundColor: preset }}
                        onClick={() => setRowColor(activeColorRow.id, preset)}
                      />
                    )
                  })}
                  <button
                    type="button"
                    className={`rotation-loop-inspector__swatch rotation-loop-inspector__swatch--custom${cstmClrOpen ? ' is-open' : ''}${!isPrstClr ? ' is-active' : ''}`}
                    title="Custom color"
                    aria-label="Custom color"
                    aria-expanded={cstmClrOpen}
                    style={!isPrstClr ? { backgroundColor: actRslvClr } : undefined}
                    onClick={() => setCstmClrOp((open) => !open)}
                  >
                    {cstmClrOpen ? <Plus size={14}/> : <Minus size={14}/>}
                  </button>
                </div>
                <div
                  className={`rotation-loop-inspector__custom${cstmClrOpen ? ' is-open' : ''}`}
                  aria-hidden={!cstmClrOpen}
                >
                  <div className="rotation-loop-inspector__custom-inner">
                    <HexClrPckr
                      color={actRslvClr}
                      onChange={(color) => setRowColor(activeColorRow.id, color)}
                    />
                    <div className="rotation-loop-inspector__hex">
                      <span aria-hidden>#</span>
                      <HexClrNpt
                        color={actRslvClr}
                        onChange={(color) => setRowColor(activeColorRow.id, `#${color.replace(/^#/, '')}`)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rotation-loop-inspector__zone rotation-loop-inspector__zone--iterations">
                <span className="rotation-loop-inspector__zone-label">Iterations</span>
                {actTrtnRow ? (
                  <div className="rotation-loop-inspector__runs">
                    <span className="rotation-loop-inspector__runs-figure">×{actRunsCnt}</span>
                    <div className="rotation-loop-inspector__runs-bars" aria-hidden>
                      {Array.from({ length: vsblRunBars }).map((_, index) => (
                        <span key={index} className="rotation-loop-inspector__run-bar" />
                      ))}
                      {overflowRuns > 0 ? (
                        <span className="rotation-loop-inspector__run-overflow">+{overflowRuns}</span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="rotation-loop-inspector__linked-readout">
                    <span aria-hidden>↩</span>
                    <span>{lnkdStartFor ? (lnkdStartFor.label || 'Loop') : 'Not linked yet'}</span>
                  </div>
                )}
              </div>

              <div className="rotation-loop-inspector__zone rotation-loop-inspector__zone--totals">
                <span className="rotation-loop-inspector__zone-label">Totals</span>
                {actLoopInfo ? (
                  <div className="rotation-loop-inspector__totals">
                    <div className="rotation-loop-inspector__totals-head">
                      <span className="rotation-loop-inspector__dot" aria-hidden />
                      <strong>{actLoopInfo.label}</strong>
                      <span className="rotation-loop-inspector__totals-sub">
                        {actLoopInfo.runs} {actLoopInfo.runs === 1 ? 'run' : 'runs'} · {
                          actLoopInfo.mode === 'forward'
                            ? 'linked end'
                            : actLoopInfo.mode === 'wrap-end'
                              ? 'wraps to linked end'
                              : 'wraps to start'
                        }
                      </span>
                    </div>
                    <code className="rotation-loop-inspector__totals-code">{fmtLoopTtls(actLoopInfo.totals)}</code>
                  </div>
                ) : (
                  <p className="rotation-loop-inspector__totals-empty">Save to compute totals.</p>
                )}
              </div>
            </>
          ) : (
            <div className="rotation-loop-inspector__empty">
              <span className="rotation-loop-inspector__empty-glyph" aria-hidden>↻</span>
              <p>Select a marker to inspect.</p>
              <span className="rotation-loop-inspector__empty-hint">Color, iterations, and totals appear here.</span>
            </div>
          )}
        </aside>
      </div>
    </ModalFrame>
  )
}

function WhenRungTcm({
  row,
  hasCondition,
}: {
  row: RotWhenRow
  hasCondition: boolean
}) {
  if (row.totals) {
    return (
      <div className="rotation-when-rung__damage">
        <span className="rotation-when-rung__glyph" aria-hidden>▶</span>
        <RotVls totals={row.totals as NodeTotals} ggrgType={row.ggrgType} />
      </div>
    )
  }

  if (row.disabled && !row.valueText) {
    return (
      <div className="rotation-when-rung__skipped">
        <span className="rotation-when-rung__glyph rotation-when-rung__glyph--muted" aria-hidden>⌖</span>
        <span className="rotation-when-rung__skipped-text">
          {hasCondition ? 'Skipped — condition false' : 'Not executed'}
        </span>
      </div>
    )
  }

  if (!row.valueText) {
    return (
      <div className="rotation-when-rung__value">
        <span className="rotation-when-rung__glyph rotation-when-rung__glyph--muted" aria-hidden>·</span>
        <span className="rotation-when-rung__value-empty">No value</span>
      </div>
    )
  }

  return (
    <div className="rotation-when-rung__value">
      <span className="rotation-when-rung__glyph" aria-hidden>▸</span>
      {row.valueLabel ? <span className="rotation-when-rung__value-label">{row.valueLabel}</span> : null}
      <span className="rotation-when-rung__value-text">{row.valueText}</span>
    </div>
  )
}

export function When({
                       visible,
                       open,
                       closing = false,
                       portalTarget,
                       node,
                       choices,
                       loops,
                       nspcRows: nspcRows,
                       stateGroups,
                       view,
                       stateLoopId,
                       stateRun,
                       onViewChange,
                       onStateLoopChange,
                       onStateRunChange,
                       onClose,
                       onSave,
                     }: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  node: RotationNode | null
  choices: CondChoice[]
  loops: RotLoopInfo[]
  nspcRows: RotWhenRow[]
  stateGroups: StateGroup[]
  view: WhenView
  stateLoopId: string | null
  stateRun: number
  onViewChange: (view: WhenView) => void
  onStateLoopChange: (loopId: string | null) => void
  onStateRunChange: (run: number) => void
  onClose: () => void
  onSave: (when: RotWhenRule | undefined) => void
}) {
  const [cndtRows, setCndtRows] = useState<WhenCondDrft[]>([])
  const [loopRuns, setLoopRuns] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!visible) {
      return
    }

    // reset the draft from the selected node whenever the modal opens so edit and inspect always describe the same
    // node snapshot.
    const when = getNodeWhen(node)
    setCndtRows(mkWhenCondDr(node, choices))
    setLoopRuns(Object.fromEntries((when?.loops ?? []).map((rule) => [rule.loopId, rule.runs.join(', ')])))
    onViewChange('edit')
  }, [choices, node, onViewChange, visible])

  const addCondRow = () => {
    const choice = choices[0]
    if (!choice) {
      return
    }

    setCndtRows((current) => [
      ...current,
      {
        id: makeNodeId('rotation:when-condition'),
        choiceId: choice.id,
        operator: 'truthy',
        value: makeCondValue(choice.state),
      },
    ])
  }

  const updCondRow = (rowId: string, updater: (row: WhenCondDrft) => WhenCondDrft) => {
    setCndtRows((current) => current.map((row) => (row.id === rowId ? updater(row) : row)))
  }

  const rstCondRows = () => {
    setCndtRows([])
    setLoopRuns({})
  }
  const hasWhenDraft = cndtRows.length > 0 || Object.keys(loopRuns).length > 0

  const save = () => {
    const condition = serWhenCondR(cndtRows, choices)
    // ignore loop rules for loops that no longer exist; this can happen after deleting markers while the when modal
    // is open from another node.
    const loopRules = Object.entries(loopRuns)
      .map(([loopId, input]) => ({ loopId, runs: prsLoopRunsN(input) }))
      .filter((rule) => loops.some((loop) => loop.loopId === rule.loopId))
    const when = {
      ...(condition ? { condition } : {}),
      ...(loopRules.length ? { loops: loopRules } : {}),
    }
    onSave(condition || loopRules.length ? when : undefined)
  }

  const sttPtnGrps = useMemo<SelectGroup<string>[]>(() => {
    const groupByKey = new Map<string, { key: string; label: string; options: SelectOption<string>[] }>()
    const ordered: { key: string; label: string; options: SelectOption<string>[] }[] = []
    for (const choice of choices) {
      const key = `${choice.resonatorId}:${choice.sourceName}`
      const groupLabel = choice.sourceName === choice.resName
        ? choice.resName
        : `${choice.resName} · ${choice.sourceName}`
      let group = groupByKey.get(key)
      if (!group) {
        group = { key, label: groupLabel, options: [] }
        groupByKey.set(key, group)
        ordered.push(group)
      }
      group.options.push({ value: choice.id, label: fmtCondChcLb(choice) })
    }
    return ordered.map(({ label, options }) => ({ label, options }))
  }, [choices])
  const stateLoopOptions = useMemo<SelectOption<string>[]>(
    () => loops.map((loop) => ({ value: loop.loopId, label: loop.label })),
    [loops],
  )
  const selectedStateLoop = loops.find((loop) => loop.loopId === stateLoopId) ?? loops[0] ?? null
  const selectedStateLoopId = selectedStateLoop?.loopId ?? ''
  const selectedStateLoopRuns = selectedStateLoop ? Math.max(1, Math.floor(selectedStateLoop.runs ?? 1)) : 0
  const stateRunOptions = useMemo<SelectOption<number>[]>(
    () => Array.from({ length: selectedStateLoopRuns }, (_, index) => {
      const run = index + 1
      return { value: run, label: `Run ${run}` }
    }),
    [selectedStateLoopRuns],
  )
  const selectedStateRun = selectedStateLoop ? Math.min(Math.max(1, stateRun), selectedStateLoopRuns) : 1

  return (
    <ModalFrame
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      title="The Node..."
      width="wide"
      bodyClssName="rotation-editor-modal-body--when"
      onClose={onClose}
      hdrCtns={(
        <div className="rotation-modal-view-toggle" role="tablist" aria-label="When modal view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'edit'}
            className={`rotation-modal-view-toggle__btn${view === 'edit' ? ' is-active' : ''}`}
            onClick={() => onViewChange('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'loop'}
            className={`rotation-modal-view-toggle__btn${view === 'loop' ? ' is-active' : ''}`}
            onClick={() => onViewChange('loop')}
          >
            Loops
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'states'}
            className={`rotation-modal-view-toggle__btn${view === 'states' ? ' is-active' : ''}`}
            onClick={() => onViewChange('states')}
          >
            States
          </button>
        </div>
      )}
      footer={view === 'edit'
        ? (
            <>
              <button type="button" className="rotation-button clear" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="rotation-button" onClick={save}>
                Save
              </button>
            </>
          )
        : undefined}
    >
      {view === 'loop' ? (
        <div className="rotation-when-inspect">
          <header className="rotation-when-inspect__head">
            <span className="panel-overline">Loop snapshots</span>
            {nspcRows.length > 0 ? (
              <span className="rotation-when-inspect__count">{nspcRows.length}</span>
            ) : null}
          </header>
          {nspcRows.length === 0 ? (
            <div className="rotation-when-editor__empty">
              <span className="rotation-when-editor__empty-orbit" aria-hidden>
                <span className="rotation-when-editor__empty-orbit-ring" />
                <span className="rotation-when-editor__empty-orbit-ring rotation-when-editor__empty-orbit-ring--alt" />
                <span className="rotation-when-editor__empty-glyph">∞</span>
              </span>
              <p>No loop snapshots.</p>
              <span className="rotation-when-editor__empty-hint">This node has no loop contexts to inspect.</span>
            </div>
          ) : (
            <ol className="rotation-when-inspect__ladder">
              {nspcRows.map((row, index) => (
                <li
                  key={row.key}
                  className={`rotation-when-rung${row.disabled ? ' is-disabled' : ''}`}
                  style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
                  aria-label={row.label}
                >
                  <div className="rotation-when-rung__node" aria-hidden>
                    <span className="rotation-when-rung__node-dot" />
                    <span className="rotation-when-rung__node-index">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="rotation-when-rung__body">
                    {row.contexts.length > 0 ? (
                      <ul className="rotation-when-rung__ribbons">
                        {row.contexts.map((ctx) => (
                          <li
                            key={ctx.loopId}
                            className="rotation-when-ribbon"
                            style={{ ['--rotation-loop-color' as 'color']: ctx.color }}
                          >
                            <span className="rotation-when-ribbon__track" aria-hidden>
                              {Array.from({ length: Math.max(1, ctx.totalRuns) }).map((_, pipIndex) => (
                                <span
                                  key={pipIndex}
                                  className={`rotation-when-ribbon__pip${pipIndex + 1 === ctx.run ? ' is-active' : ''}`}
                                />
                              ))}
                            </span>
                            <span className="rotation-when-ribbon__label">{ctx.label}</span>
                            <span className="rotation-when-ribbon__run">
                              {ctx.run}<span aria-hidden>/</span>{ctx.totalRuns}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="rotation-when-rung__no-context">Current context</span>
                    )}
                    <WhenRungTcm row={row} hasCondition={Boolean(getNodeWhen(node)?.condition)} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : view === 'states' ? (
        <div className="rotation-when-states">
          <header className="rotation-when-inspect__head">
            <span className="panel-overline">Active states and effects</span>
            {stateGroups.length > 0 ? (
              <span className="rotation-when-inspect__count">{stateGroups.length}</span>
            ) : null}
          </header>
          {loops.length > 0 ? (
            <div className="rotation-when-state-context">
              <label className="ui-inline-field rotation-when-state-context__field">
                <span>Loop</span>
                <LiquidSelect
                  value={selectedStateLoopId}
                  options={stateLoopOptions}
                  ariaLabel="Loop"
                  onChange={(value) => {
                    onStateLoopChange(value)
                    onStateRunChange(1)
                  }}
                />
              </label>
              <label className="ui-inline-field rotation-when-state-context__field">
                <span>Run</span>
                <LiquidSelect
                  value={selectedStateRun}
                  options={stateRunOptions}
                  ariaLabel="Loop run"
                  disabled={!selectedStateLoop}
                  onChange={onStateRunChange}
                />
              </label>
            </div>
          ) : null}
          {stateGroups.length === 0 ? (
            <div className="rotation-when-editor__empty">
              <span className="rotation-when-editor__empty-orbit" aria-hidden>
                <span className="rotation-when-editor__empty-orbit-ring" />
                <span className="rotation-when-editor__empty-orbit-ring rotation-when-editor__empty-orbit-ring--alt" />
                <span className="rotation-when-editor__empty-glyph">◇</span>
              </span>
              <p>No active states or effects.</p>
              <span className="rotation-when-editor__empty-hint">Nothing active currently targets this skill.</span>
            </div>
          ) : (
            <div className="rotation-when-state-groups">
              {stateGroups.map((group) => (
                <Expandable
                  key={group.id}
                  as="article"
                  className="calculator-hero-state-card rotation-when-state-card"
                  triggerClass="calculator-hero-state-expandable-trigger"
                  contentClass="calculator-hero-state-expandable"
                  innerClass="calculator-hero-state-scopes"
                  chevronClass="calculator-hero-state-chevron"
                  chevronSize={14}
                  defaultOpen
                  header={
                    <div className="calculator-hero-state-card-head">
                      <div className="calculator-hero-state-source">
                        <span className="calculator-hero-state-source-frame">
                          <img
                            src={group.srcProf || '/assets/default.webp'}
                            alt={group.sourceName}
                            className="calculator-hero-state-source-image"
                            loading="lazy"
                            decoding="async"
                            onError={withDefIconM}
                          />
                        </span>
                        <div className="calculator-hero-state-source-copy">
                          <span>Resonator Source</span>
                          <strong>{group.sourceName}</strong>
                        </div>
                      </div>
                      <span className="calculator-hero-state-badge">
                        {group.scopes.length} {group.scopes.length === 1 ? 'branch' : 'branches'}
                      </span>
                    </div>
                  }
                >
                  {group.scopes.map((scope) => (
                    <section key={scope.id} className="calculator-hero-state-scope">
                      <div className="calculator-hero-state-scope-head">
                        <span className="calculator-hero-state-scope-label">{scope.label}</span>
                        <span className="calculator-hero-state-badge">
                          {scope.nodes.length} {scope.nodes.length === 1 ? 'node' : 'nodes'}
                        </span>
                      </div>

                      <div className="calculator-hero-state-nodes">
                        {scope.nodes.map((stateNode) => (
                          <section key={stateNode.id} className="calculator-hero-state-node">
                            <div className="calculator-hero-state-node-head">
                              <div>
                                <strong>{stateNode.ownerLabel}</strong>
                              </div>
                            </div>

                            <ul className="calculator-hero-state-effects">
                              {stateNode.effectLabels.length > 0 ? (
                                stateNode.effectLabels.map((label, index) => (
                                  <li
                                    key={`${stateNode.id}-${index}`}
                                    dangerouslySetInnerHTML={{ __html: label }}
                                  />
                                ))
                              ) : (
                                <li>Active.</li>
                              )}
                            </ul>
                          </section>
                        ))}
                      </div>
                    </section>
                  ))}
                </Expandable>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rotation-when-editor">
          <section className="rotation-when-editor__rules">
            <header className="rotation-when-editor__head">
              <div>
                <div className="panel-overline">When should this node be… active?</div>
              </div>
              <div className="rotation-loop-editor__add-toolbar">
                <button
                  type="button"
                  className="rotation-when-editor__add-btn"
                  disabled={choices.length === 0}
                  onClick={addCondRow}
                >
                  <Plus size={13} aria-hidden />
                  <span>Add condition</span>
                </button>
                <button
                  type="button"
                  className="rotation-when-editor__add-btn danger"
                  disabled={!hasWhenDraft}
                  onClick={rstCondRows}
                >
                  <RotateCcw size={13} aria-hidden />
                  <span>Reset</span>
                </button>
              </div>
            </header>

            <div className="rotation-when-editor__list">
              {cndtRows.length === 0 ? (
                <div className="rotation-when-editor__empty">
                  <span className="rotation-when-editor__empty-orbit" aria-hidden>
                    <span className="rotation-when-editor__empty-orbit-ring" />
                    <span className="rotation-when-editor__empty-orbit-ring rotation-when-editor__empty-orbit-ring--alt" />
                    <span className="rotation-when-editor__empty-glyph">∞</span>
                  </span>
                  <p>No restrictions...</p>
                  <span className="rotation-when-editor__empty-hint">Add a condition to gate this node.</span>
                </div>
              ) : (
                <>
                  {cndtRows.flatMap((row, idx) => {
                    const choice = choices.find((entry) => entry.id === row.choiceId)
                    const operator = normWhenPrtr(row.operator, choice)
                    const prtrPtns = getWhenPrtrP(choice)
                    const value = normWhenVlFo(choice, row.value)
                    const showsValue = !!choice && shldShowWhen(operator)
                    const plate = (
                      <article key={row.id} className="rotation-when-plate">
                        <div className="rotation-when-plate__node" aria-hidden>
                          <span className="rotation-when-plate__node-dot" />
                          <span className="rotation-when-plate__node-index">{String(idx + 1).padStart(2, '0')}</span>
                        </div>
                        <div className="rotation-when-plate__body">
                          <div className="rotation-when-plate__state-row">
                            <span className="rotation-when-plate__eyebrow">If</span>
                            <LiquidSelect
                              value={row.choiceId}
                              options={[]}
                              groups={sttPtnGrps}
                              ariaLabel="State"
                              className="rotation-when-plate-state"
                              placeholder="Select a state"
                              onChange={(value) => {
                                const nextChoice = choices.find((entry) => entry.id === value)
                                updCondRow(row.id, (current) => ({
                                  ...current,
                                  choiceId: value,
                                  operator: normWhenPrtr(current.operator, nextChoice),
                                  value: normWhenVlFo(nextChoice, current.value),
                                }))
                              }}
                            />
                          </div>
                          <div className="rotation-when-plate__relation">
                            <span className="rotation-when-plate__chevron" aria-hidden>▸</span>
                            <LiquidSelect
                              value={operator}
                              options={prtrPtns}
                              ariaLabel="Match operator"
                              className="rotation-when-plate-op"
                              onChange={(value) => updCondRow(row.id, (current) => ({
                                ...current,
                                operator: value as WhenCondPrtr,
                                value: normWhenVlFo(choice, current.value),
                              }))}
                            />
                            {showsValue ? (
                              <span className="rotation-when-plate__value">
                                {viewCondVlFl(choice!.state, value, (value) => {
                                  updCondRow(row.id, (current) => ({ ...current, value }))
                                })}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rotation-when-plate__remove"
                          title="Remove condition"
                          aria-label="Remove condition"
                          onClick={() => setCndtRows((current) => current.filter((entry) => entry.id !== row.id))}
                        >
                          <X size={14} />
                        </button>
                      </article>
                    )
                    return [plate]
                  })}
                  <button
                    type="button"
                    className="rotation-when-plate rotation-when-plate--add"
                    disabled={choices.length === 0}
                    onClick={addCondRow}
                  >
                    <span className="rotation-when-plate__node" aria-hidden>
                      <span className="rotation-when-plate__node-dot rotation-when-plate__node-dot--ghost" />
                      <span className="rotation-when-plate__node-index">+</span>
                    </span>
                    <span className="rotation-when-plate__add-label">Add condition</span>
                  </button>
                </>
              )}
            </div>
          </section>

          {loops.length > 0 ? (
            <section className="rotation-when-editor__loops">
              <header className="rotation-when-editor__head">
                <div>
                  <div className="panel-overline">And on which iterations of which loops...?</div>
                </div>
              </header>
              <div className="rotation-when-loops__list">
                {loops.map((loop) => {
                  const totalRuns = Math.max(0, Math.floor(loop.runs ?? 0))
                  const hasXplcLoopR = Object.prototype.hasOwnProperty.call(loopRuns, loop.loopId)
                  const selectedRuns = hasXplcLoopR
                    ? prsLoopRunsN(loopRuns[loop.loopId] ?? '')
                    : mkDefLoopRun(totalRuns)
                  const vsblSttn = Math.min(totalRuns, 12)
                  const tglSttn = (run: number) => {
                    const next = selectedRuns.includes(run)
                      ? selectedRuns.filter((entry) => entry !== run)
                      : [...selectedRuns, run].sort((a, b) => a - b)
                    setLoopRuns((current) => {
                      if (next.length === totalRuns) {
                        const { [loop.loopId]: removedLoop, ...rest } = current
                        void removedLoop
                        return rest
                      }

                      return { ...current, [loop.loopId]: mkLoopRunNpt(next) }
                    })
                  }
                  const activeCount = selectedRuns.filter((run) => run >= 1 && (totalRuns === 0 || run <= totalRuns)).length

                  return (
                    <div key={loop.loopId} className="rotation-when-loop" style={{ '--rotation-loop-color': loop.color } as React.CSSProperties}>
                      <div className="rotation-when-loop__head">
                        <span className="rotation-when-loop__badge" aria-hidden>↻</span>
                        <span className="rotation-when-loop__title">{loop.label}</span>
                        <span className="rotation-when-loop__count">
                          {activeCount > 0 ? `${activeCount} of ${totalRuns || '?'}` : `×${totalRuns || '?'}`}
                        </span>
                      </div>
                      {vsblSttn > 0 ? (
                        <div className="rotation-when-loop__timeline">
                          <span className="rotation-when-loop__rail" aria-hidden />
                          <div className="rotation-when-loop__stations" role="group" aria-label={`Runs for ${loop.label}`}>
                            {Array.from({ length: vsblSttn }).map((_, index) => {
                              const run = index + 1
                              const active = selectedRuns.includes(run)
                              return (
                                <button
                                  key={run}
                                  type="button"
                                  role="checkbox"
                                  aria-checked={active}
                                  aria-label={`Run ${run}`}
                                  className={`rotation-when-loop__station${active ? ' is-active' : ''}`}
                                  onClick={() => tglSttn(run)}
                                >
                                  <span className="rotation-when-loop__station-pip" aria-hidden />
                                  <span className="rotation-when-loop__station-num">{run}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="rotation-when-loop__timeline rotation-when-loop__timeline--empty">
                          <span>Unbounded — type the runs below.</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </ModalFrame>
  )
}

export function NegFfct({
                                 visible,
                                 open,
                                 closing = false,
                                 portalTarget,
                                 initialNode,
                                 featureMeta,
                                 onClose,
                                 onSave,
                               }: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  initialNode: Extract<RotationNode, { type: 'feature' }> | null
  featureMeta?: FeatureMeta
  onClose: () => void
  onSave: (config: {
    negEfxNstn?: number
    negEfxStblo2?: number
  }) => void
}) {
  const [draft, setDraft] = useState(() => makeNegDraft(initialNode))

  const attribute = getNegFfctTt(featureMeta?.archetype)
  const nstnPrvw = prsPtnlNtgrN(draft.instanceInput, 1)
    ?? initialNode?.negativeEffectInstances
    ?? 1
  const stblWdthPrvw = prsPtnlNtgrN(draft.stableInput, 1)
    ?? initialNode?.negativeEffectStableWidth
    ?? 1

  return (
    <ModalFrame
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      title="Negative Effect Series"
      bodyClssName="rotation-editor-modal-body--condition"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="rotation-button clear" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rotation-button"
            onClick={() => {
              onSave(saveNegDraft(draft))
            }}
          >
            Save
          </button>
        </>
      )}
    >
      <div className="rotation-condition-modal">
        <div className="rotation-condition-panel">
          <div className="rotation-condition-grid rotation-negative-effect-grid">
            <div className="rotation-inline-field rotation-inline-field--wide ui-inline-field ui-inline-field--wide">
              <span>Instances</span>
              <input
                type="number"
                min={1}
                step={1}
                className="resonator-level-input"
                value={draft.instanceInput}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    instanceInput: event.target.value,
                    instanceTouched: true,
                  }))
                }
              />
            </div>
            <div className="rotation-inline-field rotation-inline-field--wide ui-inline-field ui-inline-field--wide">
              <span>Stable Width</span>
              <input
                type="number"
                min={1}
                step={1}
                className="resonator-level-input"
                value={draft.stableInput}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    stableInput: event.target.value,
                    stableTouched: true,
                  }))
                }
              />
            </div>
          </div>
        </div>

        <div className="rotation-condition-panel rotation-condition-panel--description">
          <div className="rotation-negative-effect-summary">
            {attribute ? (
              <span className="rotation-negative-effect-summary__icon">
                <img src={`/assets/attributes/attributes alt/${attribute}.webp`} alt="" aria-hidden="true" onError={withDefIconM} />
              </span>
            ) : null}
            <div className="rotation-negative-effect-summary__copy">
              <strong>{featureMeta?.label ?? 'Negative Effect'}</strong>
              <span>
                Count {nstnPrvw} instance{nstnPrvw === 1 ? '' : 's'} and keep each stack value for {stblWdthPrvw} instance{stblWdthPrvw === 1 ? '' : 's'} before lowering it.
              </span>
            </div>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}
