/*
  Author: Runor Ewhro
  Description: "Query console" for one cohesive Expandable surface over the
               optimizer results. Collapsed it is a single live SQL readout
               row; expanded, the same row holds the Filter|Find mode toggle and
               a compact, full-width predicate builder unfolds beneath it. One
               predicate model drives both subsetting (filter) and jumping (find).
*/

import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Crosshair,
  Filter as FilterIcon,
  Terminal,
  X,
} from 'lucide-react'
import { Expandable } from '@/shared/ui/Expandable'
import { LiquidSelect, type SelectOption } from '@/shared/ui/LiquidSelect'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import {
  OP_SYMBOL,
  VIEW_COLUMNS,
  facetMainEchoes,
  facetPlans,
  facetSets,
  isDefaultViewCriteria,
  type CatCol,
  type CmpOp,
  type NumCol,
  type Predicate,
  type ResultFacet,
  type ResultViewCriteria,
  type ViewSortKey,
} from '@/modules/calculator/features/optimizer/lib/results.ts'

const ALL = '__all__'
const OPS: CmpOp[] = ['gte', 'gt', 'eq', 'lte', 'lt']

const SORT_OPTIONS: SelectOption<string>[] = [
  ...VIEW_COLUMNS.filter((c) => c.kind === 'num').map((c) => ({ value: c.key, label: c.label })),
  { value: 'mainEcho', label: 'Main' },
]

function colLabel(key: string): string {
  return VIEW_COLUMNS.find((c) => c.key === key)?.label ?? key
}

function echoName(id: string): string {
  return getEchoById(id)?.name ?? id
}

function setName(id: number): string {
  return getEchoSetDe(id)?.name ?? `Set ${id}`
}

function planLabelFromKey(planKey: string): string {
  return planKey
    .split('|')
    .map((part) => {
      const [rawId, rawCount] = part.split(':')
      return `${setName(Number(rawId))} ${rawCount}`
    })
    .join(' · ')
}

function formatPred(pred: Predicate): string {
  if (pred.kind === 'num') {
    return `${colLabel(pred.col)} ${OP_SYMBOL[pred.op]} ${pred.value}`
  }
  if (pred.col === 'main') {
    return echoName(pred.value)
  }
  if (pred.col === 'set') {
    return setName(Number(pred.value))
  }
  return planLabelFromKey(pred.value)
}

interface ResultToolbarProps {
  open: boolean
  onToggle: (open: boolean) => void
  mode: 'filter' | 'find'
  onMode: (mode: 'filter' | 'find') => void
  facets: ResultFacet[] | null
  criteria: ResultViewCriteria
  onCriteria: (next: ResultViewCriteria) => void
  matchCount: number
  totalCount: number
  findPreds: Predicate[]
  onFindPreds: (preds: Predicate[]) => void
  findMatchIndex: number
  findMatchCount: number
  onFindStep: (dir: 1 | -1) => void
}

export function ResultToolbar({
  open,
  onToggle,
  mode,
  onMode,
  facets,
  criteria,
  onCriteria,
  matchCount,
  totalCount,
  findPreds,
  onFindPreds,
  findMatchIndex,
  findMatchCount,
  onFindStep,
}: ResultToolbarProps) {
  const [col, setCol] = useState<NumCol | CatCol>('cr')
  const [op, setOp] = useState<CmpOp>('gte')
  const [numValue, setNumValue] = useState('')

  const colMeta = VIEW_COLUMNS.find((c) => c.key === col) ?? VIEW_COLUMNS[0]
  const isNum = colMeta.kind === 'num'
  const isFiltered = !isDefaultViewCriteria(criteria)

  const activePreds = mode === 'filter' ? criteria.filter : findPreds
  const setActivePreds = (preds: Predicate[]) => {
    if (mode === 'filter') {
      onCriteria({ ...criteria, filter: preds })
    } else {
      onFindPreds(preds)
    }
  }

  const addNum = () => {
    const value = Number(numValue)
    if (numValue.trim() === '' || !Number.isFinite(value)) {
      return
    }
    setActivePreds([...activePreds, { kind: 'num', col: col as NumCol, op, value }])
    setNumValue('')
  }

  const addCat = (value: string) => {
    if (value !== ALL) {
      setActivePreds([...activePreds, { kind: 'cat', col: col as CatCol, value }])
    }
  }

  const removePred = (index: number) => {
    setActivePreds(activePreds.filter((_, i) => i !== index))
  }

  const columnOptions = useMemo<SelectOption<string>[]>(
    () => VIEW_COLUMNS.map((c) => ({ value: c.key, label: c.label })),
    [],
  )

  const catOptions = useMemo<SelectOption<string>[]>(() => {
    const base: SelectOption<string>[] = [{ value: ALL, label: `Pick ${colMeta.label.toLowerCase()}…` }]
    if (isNum || !facets) {
      return base
    }
    if (col === 'main') {
      return base.concat(
        facetMainEchoes(facets).map(({ id, count }) => ({
          value: id,
          label: `${echoName(id)}  ·  ${count}`,
          icon: getEchoById(id)?.icon,
        })),
      )
    }
    if (col === 'set') {
      return base.concat(
        facetSets(facets).map(({ id, count }) => ({
          value: String(id),
          label: `${setName(id)}  ·  ${count}`,
          icon: getSntSetIco(id) ?? undefined,
        })),
      )
    }
    return base.concat(
      facetPlans(facets).map((plan) => ({
        value: plan.planKey,
        label: `${planLabelFromKey(plan.planKey)}  ·  ${plan.count}`,
      })),
    )
  }, [facets, isNum, col, colMeta.label])

  const exprParts: string[] = []
  if (criteria.filter.length > 0) {
    exprParts.push(`where ${criteria.filter.map(formatPred).join(' · ')}`)
  }
  if (findPreds.length > 0) {
    exprParts.push(`find ${findPreds.map(formatPred).join(' · ')}`)
  }
  const sortArrow = criteria.sortDir === 'desc' ? '↓' : '↑'

  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

  const header = (
    <div className="opt-qc__bar-inner">
      {open ? (
        <div className="opt-qc__seg" role="group" aria-label="Console mode">
          <button
            type="button"
            className={`opt-qc__seg-opt${mode === 'filter' ? ' is-on' : ''}`}
            onClick={(event) => { stop(event); onMode('filter') }}
          >
            <FilterIcon size={12} /> Filter
          </button>
          <button
            type="button"
            className={`opt-qc__seg-opt${mode === 'find' ? ' is-on' : ''}`}
            onClick={(event) => { stop(event); onMode('find') }}
          >
            <Crosshair size={12} /> Find
          </button>
        </div>
      ) : (
        <span className="opt-qc__glyph">
          <Terminal size={14} />
        </span>
      )}

      <span className="opt-qc__query">
        {exprParts.length > 0 ? (
          exprParts.map((part, index) => {
            const [kw, ...rest] = part.split(' ')
            return (
              <span key={index} className="opt-qc__clause">
                <span className="opt-qc__kw">{kw}</span>
                <span className="opt-qc__expr">{rest.join(' ')}</span>
              </span>
            )
          })
        ) : (
          <span className="opt-qc__kw opt-qc__kw--muted">all builds</span>
        )}
        <span className="opt-qc__clause opt-qc__clause--sort">
          <span className="opt-qc__kw">sort</span>
          <span className="opt-qc__expr">{colLabel(criteria.sortKey)} {sortArrow}</span>
        </span>
      </span>

      <span className="opt-qc__count">
        <span className="opt-qc__count-n">{(isFiltered ? matchCount : totalCount).toLocaleString()}</span>
        <span className="opt-qc__count-d">{isFiltered ? `/ ${totalCount.toLocaleString()}` : 'builds'}</span>
      </span>

      <span className={`opt-qc__chev${open ? ' is-open' : ''}`} aria-hidden="true">
        <ChevronDown size={15} />
      </span>
    </div>
  )

  return (
    <Expandable
      className={`opt-qc${isFiltered ? ' is-filtered' : ''}`}
      open={open}
      onOpenChange={onToggle}
      plainTrigger
      noHeaderWrap
      hideChevron
      triggerClass="opt-qc__bar"
      contentClass="opt-qc__content"
      innerClass="opt-qc__content-inner"
      header={header}
    >
      <div className="opt-qc__body">
        <div className="opt-qc__build">
          <LiquidSelect<string>
            className="opt-qc__sel opt-qc__sel--col"
            value={col}
            options={columnOptions}
            ariaLabel="Column"
            onChange={(value) => { setCol(value as NumCol | CatCol); setNumValue('') }}
          />

          {isNum ? (
            <>
              <div className="opt-qc__ops" role="group" aria-label="Operator">
                {OPS.map((operator) => (
                  <button
                    key={operator}
                    type="button"
                    className={`opt-qc__op${op === operator ? ' is-on' : ''}`}
                    aria-label={operator}
                    onClick={() => setOp(operator)}
                  >
                    {OP_SYMBOL[operator]}
                  </button>
                ))}
              </div>
              <input
                className="opt-qc__num"
                type="number"
                inputMode="decimal"
                placeholder="value"
                value={numValue}
                onChange={(event) => setNumValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addNum()
                  }
                }}
              />
              <button
                type="button"
                className="opt-qc__add"
                aria-label="Add condition"
                disabled={numValue.trim() === ''}
                onClick={addNum}
              >
                <CornerDownLeft size={13} />
              </button>
            </>
          ) : (
            <LiquidSelect<string>
              className="opt-qc__sel opt-qc__sel--cat"
              value={ALL}
              options={catOptions}
              ariaLabel={`Add ${colMeta.label} condition`}
              onChange={addCat}
            />
          )}

          <div className="opt-qc__build-end">
            <div className="opt-qc__sort">
              <LiquidSelect<string>
                className="opt-qc__sel opt-qc__sel--sort"
                value={criteria.sortKey}
                options={SORT_OPTIONS}
                ariaLabel="Sort column"
                onChange={(value) => onCriteria({ ...criteria, sortKey: value as ViewSortKey })}
              />
              <button
                type="button"
                className="opt-qc__icon-btn"
                aria-label={criteria.sortDir === 'desc' ? 'Descending' : 'Ascending'}
                title={criteria.sortDir === 'desc' ? 'Descending' : 'Ascending'}
                onClick={() => onCriteria({ ...criteria, sortDir: criteria.sortDir === 'desc' ? 'asc' : 'desc' })}
              >
                {criteria.sortDir === 'desc' ? '↓' : '↑'}
              </button>
            </div>

            {mode === 'find' ? (
              <div className="opt-qc__step" data-empty={findMatchCount === 0}>
                <button
                  type="button"
                  className="opt-qc__icon-btn"
                  aria-label="Previous match"
                  disabled={findMatchCount === 0}
                  onClick={() => onFindStep(-1)}
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="opt-qc__step-count">
                  {findPreds.length === 0 ? '-' : findMatchCount === 0 ? '0' : `${findMatchIndex || '-'}/${findMatchCount}`}
                </span>
                <button
                  type="button"
                  className="opt-qc__icon-btn"
                  aria-label="Next match"
                  disabled={findMatchCount === 0}
                  onClick={() => onFindStep(1)}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {activePreds.length > 0 ? (
          <div className="opt-qc__chips">
            <span className={`opt-qc__chips-kw${mode === 'find' ? ' is-find' : ''}`}>
              {mode === 'filter' ? 'where' : 'find'}
            </span>
            {activePreds.map((pred, index) => (
              <button
                key={`${pred.kind}-${index}`}
                type="button"
                className="opt-qc__chip"
                title="Remove condition"
                onClick={() => removePred(index)}
              >
                <span className="opt-qc__chip-label">{formatPred(pred)}</span>
                <X size={11} className="opt-qc__chip-x" />
              </button>
            ))}
            <button type="button" className="opt-qc__clear" onClick={() => setActivePreds([])}>
              Clear
            </button>
          </div>
        ) : null}
      </div>
    </Expandable>
  )
}
