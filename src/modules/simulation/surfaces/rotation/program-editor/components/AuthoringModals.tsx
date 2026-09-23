/*
  Author: Runor Ewhro
  Description: Hosts note, block, loop, condition, and feature authoring dialogs over editor operations.
*/

import type {
  CondChoice,
  FeatureConditionDraft,
  RotationConditionValue,
} from "@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts";
import type {RtChng} from "@/domain/gameData/contracts.ts";
import {useEffect, useMemo, useState, type ReactNode} from "react";
import {
  makeCondValue,
  conditionChoiceLabel, isNmrcCondSt,
  isFormulaChoice,
  makeFeatCond,
  makeFeatureDraft,
  normFeatCond,
  viewCondVlFl, serFeatCondD
} from "@/modules/simulation/surfaces/rotation/shared/conditions.tsx";
import {makeNodeId} from "@/domain/gameData/rotationNodeId.ts";
import {AppModal} from "@/shared/ui/AppModal.tsx";
import { ModalHeader } from "@/shared/ui/AppModalShell";
import {LiquidSelect, type SelectOption} from "@/application/ui/LiquidSelect.tsx";
import {Check, Crosshair, Plus, Repeat, Search, Sparkles, X} from "lucide-react";
import {getResSeedBy} from "@/data/catalog/resonatorSeedService.ts";
import {RichDscr} from "@/modules/simulation/ui/RichDescription.tsx";
import {withDefIconM} from "@/shared/lib/imageFallback.ts";
import {
  COND_KIND_META,
  COND_KIND_ORDER,
  getBrowserChoiceLabel,
  getCondGroupKey,
  getCondGroupLabel,
  getCondOwnerKey,
  getCondOwnerLabel,
  getCondTarget,
  type CondKind,
  type CondTarget,
} from '@/modules/simulation/surfaces/rotation/program-editor/components/ConditionBrowser.tsx'

export function ModalFrame({
                             visible,
                             open,
                             closing = false,
                             over = 'Rotation',
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
  over?: string
  title: string
  width?: 'regular' | 'wide' | 'x-wide'
  bodyClssName?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  hdrCtns?: ReactNode
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
      <ModalHeader over={over} title={<h2>{title}</h2>} onClose={onClose}>
        {hdrCtns}
      </ModalHeader>
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
                            seedValue,
                          }: {
  visible: boolean
  open: boolean
  closing?: boolean

  portalTarget?: HTMLElement | null
  choices: CondChoice[]
  ntlChng: RtChng[]
  featureLabel: string
  eyebrow?: string
  emptyText?: string
  onClose: () => void
  onSave: (changes: RtChng[]) => void

  seedValue?: (choice: CondChoice) => RotationConditionValue
}) {
  const [rows, setRows] = useState<FeatureConditionDraft[]>([])
  const [activeRowId, setActRowId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<CondKind | 'all'>('all')
  // `all` bypasses owner filtering; every other value is an exact owner key.
  const [ownerFilter, setOwnerFilter] = useState<string>('all')

  useEffect(() => {
    if (!visible) {
      return
    }

    // Rebuild drafts on open so abandoned edits cannot leak into another session.
    const nextRows = initChng.map((change) => makeFeatCond(change, choices, makeNodeId))
    setRows(nextRows)
    setActRowId(null)
    setQuery('')
    setKindFilter('all')
    setOwnerFilter('all')
  }, [choices, initChng, visible])

  const nrmlQry = query.trim().toLowerCase()

  // Restrict kind filters to values present in the current source catalog.
  const availableKinds = useMemo(() => {
    const present = new Set(choices.map((choice) => choice.state.kind as CondKind))
    return COND_KIND_ORDER.filter((kind) => present.has(kind))
  }, [choices])
  const browserChoiceCount = useMemo(() => {
    let formulaSeen = false
    let count = 0

    for (const choice of choices) {
      if (isFormulaChoice(choice)) {
        if (!formulaSeen) {
          formulaSeen = true
          count += 1
        }
        continue
      }
      count += 1
    }

    return count
  }, [choices])

  // Preserve first-seen owner order and count each source once.
  const owners = useMemo(() => {
    type Owner = { key: string; label: string; kind: CondTarget; profile: string; count: number }
    const list: Owner[] = []
    const byKey = new Map<string, Owner>()
    const countedFormulaOwners = new Set<string>()
    for (const choice of choices) {
      const key = getCondOwnerKey(choice)
      let owner = byKey.get(key)
      if (!owner) {
        const kind = getCondTarget(choice)
        owner = {
          key,
          label: getCondOwnerLabel(choice),
          kind,
          profile: kind === 'resonator' ? (getResSeedBy(choice.resonatorId)?.profile ?? '') : '',
          count: 0,
        }
        byKey.set(key, owner)
        list.push(owner)
      }
      if (isFormulaChoice(choice)) {
        if (countedFormulaOwners.has(key)) {
          continue
        }
        countedFormulaOwners.add(key)
      }
      owner.count += 1
    }
    return list
  }, [choices])

  const fltrChcs = useMemo(() => {
    const choiceMatchesFilters = (choice: CondChoice) => {
      if (ownerFilter !== 'all' && getCondOwnerKey(choice) !== ownerFilter) {
        return false
      }
      if (kindFilter !== 'all' && choice.state.kind !== kindFilter) {
        return false
      }
      if (!nrmlQry) {
        return true
      }
      return [
        choice.label,
        choice.sourceName,
        choice.effectName,
        choice.resName,
        conditionChoiceLabel(choice),
        getBrowserChoiceLabel(choice),
      ].some((value) => value?.toLowerCase().includes(nrmlQry) ?? false)
    }

    // Results are the intersection of owner, state-shape, and text filters.
    const filtered: CondChoice[] = []
    let formulaRepresentative: CondChoice | null = null
    let formulaMatches = false

    for (const choice of choices) {
      if (isFormulaChoice(choice)) {
        formulaRepresentative ??= choice
        formulaMatches ||= choiceMatchesFilters(choice)
        continue
      }
      if (choiceMatchesFilters(choice)) {
        filtered.push(choice)
      }
    }

    if (!formulaRepresentative || !formulaMatches) {
      return filtered
    }

    const insertIndex = choices.findIndex(isFormulaChoice)
    const nonFormulaBefore = choices
      .slice(0, Math.max(0, insertIndex))
      .filter((choice) => !isFormulaChoice(choice) && choiceMatchesFilters(choice))
      .length
    return [
      ...filtered.slice(0, nonFormulaBefore),
      formulaRepresentative,
      ...filtered.slice(nonFormulaBefore),
    ]
  }, [choices, kindFilter, nrmlQry, ownerFilter])
  const filtersActive = ownerFilter !== 'all' || kindFilter !== 'all' || nrmlQry.length > 0
  const clearFilters = () => {
    setQuery('')
    setKindFilter('all')
    setOwnerFilter('all')
  }
  const grpdChcs = useMemo(() => {
    const groups: Array<{ key: string; label: string; choices: CondChoice[] }> = []
    const groupByKey = new Map<string, { key: string; label: string; choices: CondChoice[] }>()

    // preserve first-seen order while still collecting states under their resonator/source heading.
    for (const choice of fltrChcs) {
      const key = getCondGroupKey(choice)
      const label = getCondGroupLabel(choice)
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

  const attachedByChoice = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) {
      if (row.choiceId && !map.has(row.choiceId)) {
        map.set(row.choiceId, row.id)
      }
    }
    return map
  }, [rows])
  const formulaOptions = useMemo<SelectOption<string>[]>(
    () => choices
      .filter(isFormulaChoice)
      .map((choice) => ({ value: choice.id, label: choice.label })),
    [choices],
  )

  const updateRow = (rowId: string, updater: (row: FeatureConditionDraft) => FeatureConditionDraft) => {
    setRows((current) => current.map((row) => (row.id === rowId ? updater(row) : row)))
  }

  const removeRow = (rowId: string) => {
    setRows((current) => {
      const nextRows = current.filter((row) => row.id !== rowId)
      if (activeRowId === rowId) {
        setActRowId(null)
      }
      return nextRows
    })
  }

  const toggleChoice = (choice: CondChoice) => {
    // tiles act as a live multi-select: a state already in the directive set toggles back out, otherwise it appends.
    if (!isFormulaChoice(choice)) {
      const existingRowId = attachedByChoice.get(choice.id)
      if (existingRowId) {
        removeRow(existingRowId)
        return
      }
    }

    const nextRow = makeFeatureDraft(choice, 'set', makeNodeId, seedValue?.(choice))
    setRows((current) => [...current, nextRow])
    setActRowId(nextRow.id)
  }

  const viewRowVlFld = (row: FeatureConditionDraft, choice: CondChoice | undefined) => {
    if (!choice) {
      return <span className="cnv-card__missing">Select a state</span>
    }

    if (row.action === 'add') {
      return (
        <input
          type="number"
          step={1}
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

  const visibleCount = grpdChcs.reduce((total, group) => total + group.choices.length, 0)
  const scoped = ownerFilter !== 'all'

  if (!visible) {
    return null
  }

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="condition-browser"
      ariaLabel={featureLabel}
      onClose={onClose}
    >
      <div className="amdl cnv">

        <header className="amdl__head">
          <span className="amdl__title">
            <span className="amdl__over">{eyebrow}</span>
            <b>{featureLabel}</b>
          </span>

          <label className="amdl__find">
            <Search size="0.8rem" aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Find a state"
              aria-label="Find a state"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                type="button" className="cnv__find-clear"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size="0.8rem" />
              </button>
            ) : null}
          </label>

          {availableKinds.length > 1 ? (
            <div className="amdl__gauge" role="group" aria-label="Filter by type">
              <button
                type="button"
                className={`amdl__chip${kindFilter === 'all' ? ' is-on' : ''}`}
                onClick={() => setKindFilter('all')}
              >
                All
              </button>
              {availableKinds.map((kind) => {
                const KindIcon = COND_KIND_META[kind].Icon
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`amdl__chip${kindFilter === kind ? ' is-on' : ''}`}
                    title={COND_KIND_META[kind].label}
                    onClick={() => setKindFilter((current) => (current === kind ? 'all' : kind))}
                  >
                    <KindIcon size="0.75rem" aria-hidden />
                    {COND_KIND_META[kind].label}
                  </button>
                )
              })}
            </div>
          ) : null}

          <button type="button" className="amdl__close" aria-label="Close" onClick={onClose}>
            <X size="0.95rem" />
          </button>
        </header>

        <div className="cnv__body">
        <aside className="cnv__rail" aria-label="Filter by source">
          <button
            type="button"
            className={`cnv-node${ownerFilter === 'all' ? ' is-active' : ''}`}
            onClick={() => setOwnerFilter('all')}
          >
            <span className="cnv-node__badge" aria-hidden>
              <Sparkles size="0.875rem" />
            </span>
            <span className="cnv-node__label">All</span>
            <span className="cnv-node__count">{browserChoiceCount}</span>
          </button>
          {owners.map((owner) => (
            <button
              key={owner.key}
              type="button"
              className={`cnv-node${ownerFilter === owner.key ? ' is-active' : ''}`}
              onClick={() => setOwnerFilter((current) => (current === owner.key ? 'all' : owner.key))}
              title={owner.label}
            >
              <span className="cnv-node__badge" aria-hidden>
                {owner.kind === 'resonator' ? (
                  <img className="cnv-node__avatar"
                    src={owner.profile || '/assets/game/default.webp'}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={withDefIconM}
                  />
                ) : owner.kind === 'enemy' ? (
                  <Crosshair size="0.875rem" />
                ) : (
                  <Repeat size="0.875rem" />
                )}
              </span>
              <span className="cnv-node__label">{owner.label}</span>
              <span className="cnv-node__count">{owner.count}</span>
            </button>
          ))}
        </aside>

        <section className="cnv__browser">
          <div className="cnv__browser-list">
            {choices.length === 0 ? (
              <div className="cnv__empty">
                <span className="cnv__empty-glyph" aria-hidden>∅</span>
                <p>No states are available for this rotation.</p>
              </div>
            ) : grpdChcs.length === 0 ? (
              <div className="cnv__empty">
                <span className="cnv__empty-glyph" aria-hidden>⌕</span>
                <p>No states match your filters.</p>
                {filtersActive ? (
                  <button type="button" className="cnv__empty-reset" onClick={clearFilters}>
                    Reset filters
                  </button>
                ) : null}
              </div>
            ) : (
              grpdChcs.map((group) => (
                <div key={group.key} className="cnv-grp">
                  <div className="cnv-grp__head">
                    <span className="cnv-grp__label">
                      {scoped ? group.choices[0]?.sourceName ?? group.label : group.label}
                    </span>
                    <span className="cnv-grp__rule" aria-hidden />
                    <span className="cnv-grp__count">{group.choices.length}</span>
                  </div>
                  <div className="cnv-grp__tiles">
                    {group.choices.map((choice) => {
                      const kindMeta = COND_KIND_META[choice.state.kind as CondKind]
                      const KindIcon = kindMeta.Icon
                      const isOn = !isFormulaChoice(choice) && attachedByChoice.has(choice.id)
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          className={`cnv-tile${isOn ? ' is-on' : ''}`}
                          aria-pressed={isOn}
                          onClick={() => toggleChoice(choice)}
                        >
                          <span className="cnv-tile__glyph" title={kindMeta.label} aria-hidden>
                            <KindIcon size="0.8125rem" />
                          </span>
                          <span className="cnv-tile__label">{getBrowserChoiceLabel(choice)}</span>
                          <span className="cnv-tile__mark" aria-hidden>
                            {isOn ? <Check size="0.7rem" /> : <Plus size="0.7rem" />}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          <footer className="cnv__browser-foot">
            <span>
              {filtersActive
                ? `${visibleCount} of ${browserChoiceCount} entries`
                : `${browserChoiceCount} entries available`}
            </span>
          </footer>
        </section>

        <aside className="cnv__tray">
          <header className="cnv__tray-head">
            <span className="cnv__tray-heading">
              <span className="cnv__tray-kicker">{eyebrow}</span>
              <span className="cnv__tray-title">Directives</span>
            </span>
            <span className="cnv__tray-count">{rows.length}</span>
          </header>

          <div className="cnv__tray-list">
            {rows.length === 0 ? (
              <div className="cnv__tray-empty">
                <span className="cnv__tray-empty-glyph" aria-hidden>⊹</span>
                <p>{emptyText}</p>
              </div>
            ) : (
              rows.map((row, rowIndex) => {
                const choice = choices.find((entry) => entry.id === row.choiceId)
                const canAdd = choice ? isNmrcCondSt(choice.state) : false
                const action = normFeatCond(row.action, choice)
                // numeric controls (stacks / formula stats / add) get a compact field; toggles & selects fill the row.
                const numericValue = !!choice
                  && (action === 'add' || choice.state.kind === 'number' || choice.state.kind === 'stack')
                const expanded = activeRowId === row.id
                const hasDscr = Boolean(choice?.description)
                const kindMeta = choice ? COND_KIND_META[choice.state.kind as CondKind] : null
                const KindIcon = kindMeta?.Icon ?? null

                return (
                  <article
                    key={row.id}
                    className={`cnv-card${expanded ? ' is-expanded' : ''}`}
                    style={{ animationDelay: `${Math.min(rowIndex, 12) * 32}ms` }}
                  >
                    <div className="cnv-card__head">
                      <span className="cnv-card__index" aria-hidden>{String(rowIndex + 1).padStart(2, '0')}</span>
                      {kindMeta && KindIcon ? (
                        <span className="cnv-card__kind" title={kindMeta.label} aria-hidden>
                          <KindIcon size="0.75rem" />
                        </span>
                      ) : null}
                      <strong className="cnv-card__name">
                        {choice ? getBrowserChoiceLabel(choice) : 'Select a state'}
                      </strong>
                      <button
                        type="button" className="cnv-card__remove"
                        title="Remove directive"
                        aria-label="Remove directive"
                        onClick={() => removeRow(row.id)}
                      >
                        <X size="0.8125rem" />
                      </button>
                    </div>

                    <div className="cnv-card__controls">
                      <div className="cnv-card__verb" aria-label="Condition action">
                        <button
                          type="button"
                          className={action === 'set' ? 'is-active' : ''}
                          onClick={() => updateRow(row.id, (current) => ({
                            ...current,
                            action: 'set',
                            value: choice
                              ? seedValue?.(choice) ?? makeCondValue(choice.state)
                              : true,
                          }))}
                        >
                          Set
                        </button>
                        <button
                          type="button"
                          className={action === 'add' ? 'is-active' : ''}
                          disabled={!canAdd}
                          onClick={() => updateRow(row.id, (current) => ({
                            ...current,
                            action: 'add',
                            value: 1,
                          }))}
                        >
                          Add
                        </button>
                      </div>
                      <div className="cnv-card__row">
                        {isFormulaChoice(choice) && formulaOptions.length > 0 ? (
                          <LiquidSelect
                            value={row.choiceId}
                            options={formulaOptions}
                            onChange={(nextChoiceId) => {
                              updateRow(row.id, (current) => ({
                                ...current,
                                choiceId: nextChoiceId,
                              }))
                            }}
                            ariaLabel="Modifier"
                          />
                        ) : null}
                        <div className={`cnv-card__value${numericValue ? ' cnv-card__value--num' : ''}`}>
                          {viewRowVlFld({ ...row, action }, choice)}
                        </div>
                      </div>
                    </div>

                    {hasDscr ? (
                      <button
                        type="button"
                        className={`cnv-card__info${expanded ? ' is-open' : ''}`}
                        aria-expanded={expanded}
                        onClick={() => setActRowId(expanded ? null : row.id)}
                      >
                        {expanded ? 'Hide details' : 'Details'}
                      </button>
                    ) : null}

                    {expanded && choice?.description ? (
                      <div className="cnv-card__desc">
                        <RichDscr description={choice.description} params={choice.dscrPrms} />
                      </div>
                    ) : null}
                  </article>
                )
              })
            )}
          </div>
        </aside>
        </div>

        <footer className="amdl__foot">
          <button type="button" className="amdl__act" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button" className="amdl__act is-go"
            onClick={() => onSave(serFeatCondD(rows, choices))}
          >
            Save
          </button>
        </footer>
      </div>
    </AppModal>
  )
}
