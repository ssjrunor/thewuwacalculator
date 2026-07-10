/*
  Author: Runor Ewhro
  Description: renders the substat-priority readout for the suggestions pane: the
               build benchmark table plus the grouped per-substat tables, where
               any row expands into a note explaining how its cells
               relate to one another. Owns the sort and row-expansion view state.
*/

import { Fragment, useCallback, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SubstatEntry } from '@/engine/suggestions/substat-priority/compute.ts'
import type { SubstatBenchmark, SubstatBenchRow } from '@/data/scoring/substatBenchmark.ts'
import { formatCompactNum, formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/statsView.ts'
import { formatTruncCompact, truncTo } from '@/shared/lib/number.ts'

// view row augments the engine result with the relative contribution share
export type SubstatViewRow = SubstatEntry & {
  contributionShare: number
}

type SubstatSortCol =
  | 'addRoll'
  | 'addRollPct'
  | 'addAmount'
  | 'removeRoll'
  | 'removeRollPct'
  | 'removeAmount'
  | 'contribution'
  | 'contributionPct'
  | 'contributionPerRoll'
  | 'contributionShare'
  | 'total'
  | 'quality'

interface SubstatColumn {
  col: SubstatSortCol
  label: string
  title: string
  kind: 'gain' | 'loss' | 'plain'
  format: 'damage' | 'percent' | 'count' | 'statval'
  presentOnly: boolean
}

interface SubstatGroup {
  title: string
  columns: SubstatColumn[]
}

// columns grouped into vertically stacked tables; every table shares one sort
const SUBSTAT_GROUPS: SubstatGroup[] = [
  {
    title: 'Per-step change (gain / loss)',
    columns: [
      { col: 'addRoll', label: '+ dmg', title: 'Damage gained by adding the chosen number of steps of this substat (lands exactly at the five-slot value ceiling once it is full)', kind: 'gain', format: 'damage', presentOnly: false },
      { col: 'addRollPct', label: '+ dmg %', title: 'That damage gain as a percent of current damage', kind: 'gain', format: 'percent', presentOnly: false },
      { col: 'addAmount', label: '+ value', title: 'Stat value added by the chosen number of steps (clamped to the five-slot value ceiling); superscript = steps actually applied', kind: 'gain', format: 'statval', presentOnly: false },
      { col: 'removeRoll', label: '− dmg', title: 'Damage lost by removing the chosen number of steps (capped at the value the build actually has)', kind: 'loss', format: 'damage', presentOnly: true },
      { col: 'removeRollPct', label: '− dmg %', title: 'That damage loss as a percent of current damage', kind: 'loss', format: 'percent', presentOnly: true },
      { col: 'removeAmount', label: '− value', title: 'Stat value removed by the chosen number of steps (capped at the value the build actually has); superscript = steps actually applied', kind: 'loss', format: 'statval', presentOnly: true }
    ],
  },
  {
    title: 'Current build state',
    columns: [
      { col: 'contribution', label: 'Contrib Δ', title: 'Damage from every current slot of this substat (lost if all are removed)', kind: 'plain', format: 'damage', presentOnly: true },
      { col: 'contributionPct', label: 'Contrib %', title: 'Total contribution as a percent of current damage', kind: 'plain', format: 'percent', presentOnly: true },
      { col: 'contributionPerRoll', label: 'Per slot Δ', title: 'Average damage each filled slot of this substat is worth', kind: 'plain', format: 'damage', presentOnly: true },
      { col: 'contributionShare', label: 'Share', title: 'This substat as a percent of all substats combined contribution (relative, substats only)', kind: 'plain', format: 'percent', presentOnly: true },
      { col: 'total', label: 'Total', title: 'Total amount of this substat across the build (superscript = filled slots)', kind: 'plain', format: 'statval', presentOnly: true },
      { col: 'quality', label: 'Quality', title: 'Aggregated value versus the maximum for its number of filled slots in the build', kind: 'plain', format: 'percent', presentOnly: true },
    ],
  },
]

// format one substat cell for its column, handling sign, percent, and absent stats
function fmtSubstatCell(row: SubstatViewRow, column: SubstatColumn): string {
  if (column.presentOnly && !row.present) {
    return '-'
  }

  const value = row[column.col]

  if (column.format === 'statval') {
    const formatted = formatStatKeyValue(row.key, value)
    if (column.kind === 'gain') {
      return `+${formatted}`
    }
    if (column.kind === 'loss') {
      return `−${formatted}`
    }
    return formatted
  }

  if (column.format === 'count') {
    return formatTruncCompact(value, 0)
  }

  if (column.format === 'percent') {
    if (column.kind === 'gain') {
      return `${value >= 0 ? '+' : '−'}${formatTruncCompact(Math.abs(value), 2)}%`
    }
    if (column.kind === 'loss') {
      return `−${formatTruncCompact(Math.abs(value), 2)}%`
    }
    return `${formatTruncCompact(value, 2)}%`
  }

  if (column.kind === 'loss') {
    return `−${formatCompactNum(Math.abs(value))}`
  }
  return formatCompactNum(value)
}

// one annotated line in an expanded row note: the cell(s) it describes and the
// sentence tying their values together.
interface SubstatNoteLine {
  cells: string
  text: string
}

// "1 step" / "3 steps"; shared so labels and the notes that quote them agree.
function stepsLabel(count: number): string {
  return `${count} step${count === 1 ? '' : 's'}`
}

// "1 slot" / "3 slots"; how many of the five echo slots carry this substat.
function slotsLabel(count: number): string {
  return `${count} slot${count === 1 ? '' : 's'}`
}

// steps actually applied = the clamped stat amount divided by one step's value;
// trimmed to one decimal so a partial fit at the ceiling (e.g. 87.5) still reads.
function appliedSteps(amount: number, step: number): string {
  if (step <= 0) {
    return '0'
  }
  const count = truncTo(amount / step, 1)
  return Number.isInteger(count) ? String(count) : count.toFixed(1)
}

// translate a substat row into prose, explaining how each cell in the group
// relates to its neighbours for the reader who does not know the column math.
function buildSubstatNote(row: SubstatViewRow, group: SubstatGroup, steps: number): SubstatNoteLine[] {
  const name = formatStatKeyLabel(row.key)
  const columns = new Map(group.columns.map((column) => [column.col, column]))
  const cell = (col: SubstatSortCol) => fmtSubstatCell(row, columns.get(col)!)
  const amount = (value: number) => formatStatKeyValue(row.key, value)
  const owned = slotsLabel(row.rollCount)
  const n = stepsLabel(steps)
  const lines: SubstatNoteLine[] = []

  if (columns.has('addRoll')) {
    // at the five-slot ceiling the aggregated value equals rollCount * maxRoll,
    // i.e. quality 100 across all five slots, so rollCount * quality reaches 500.
    const maxed = row.present && row.rollCount * row.quality >= 499.5
    lines.push({
      cells: `+ value · + dmg · + dmg %`,
      text: maxed
        ? `${name} already fills all five slots at max value, so there is no room to add ${n}. The "+ value" cell stays at ${amount(row.addAmount)} (0 steps applied) and it contributes nothing (${cell('addRoll')}).`
        : row.present
          ? `Adding ${n} of ${name} puts ${amount(row.addAmount)} onto the build (the "+ value" cell, superscript = ${appliedSteps(row.addAmount, row.rollStep)} steps actually applied) and raises your damage by ${cell('addRoll')}, the "+ dmg" cell. "+ dmg %" restates that gain as ${cell('addRollPct')} of your current damage.`
          : `You run no ${name} yet, so ${n} of it would add ${amount(row.addAmount)} (the "+ value" cell) for ${cell('addRoll')} damage, shown in "+ dmg %" as ${cell('addRollPct')} of your current damage.`,
    })
  }

  if (columns.has('removeRoll')) {
    lines.push({
      cells: `− value · − dmg · − dmg %`,
      text: row.present
        ? `Dropping ${n} from your current ${name} takes off ${amount(row.removeAmount)} (the "− value" cell, capped at the ${owned} you actually have) and costs ${cell('removeRoll')}, the "− dmg" cell. "− dmg %" restates that as ${cell('removeRollPct')} of your damage.`
        : `These stay blank until ${name} is actually on the build; there is nothing to remove yet.`,
    })
  }

  if (columns.has('contribution')) {
    lines.push({
      cells: 'Contrib Δ · Contrib %',
      text: row.present
        ? `Every ${name} slot you own is worth ${cell('contribution')} together. That is what you would lose stripping them all. "Contrib %" is the same figure as ${cell('contributionPct')} of your total damage.`
        : `${name} is not on the build, so it contributes nothing to your current damage.`,
    })
  }

  if (row.present && columns.has('contributionPerRoll')) {
    lines.push({
      cells: 'Per slot Δ',
      text: `Spread that contribution across your ${owned} and each individual ${name} slot averages ${cell('contributionPerRoll')}.`,
    })
  }

  if (row.present && columns.has('contributionShare')) {
    lines.push({
      cells: 'Share',
      text: `Compared against other substats only (main stats excluded), ${name} accounts for ${cell('contributionShare')} of your combined substat damage.`,
    })
  }

  if (row.present && columns.has('total')) {
    lines.push({
      cells: 'Total',
      text: `The raw amount carried on your build is ${cell('total')}, gathered from ${owned}, the small superscript on that cell.`,
    })
  }

  if (row.present && columns.has('quality')) {
    lines.push({
      cells: 'Quality',
      text: `Those slots are landing at ${cell('quality')} of the best value possible for ${owned}.`,
    })
  }

  return lines
}

// translate a benchmark row into prose tying its damage cells together.
function buildBenchNote(bench: SubstatBenchRow): SubstatNoteLine[] {
  const isBase = bench.id === 'base'
  return [
    {
      cells: 'Substat dmg',
      text: `This build's substats add ${formatCompactNum(bench.substatDmg)} on top of a main-stat-only baseline.`,
    },
    {
      cells: 'vs base',
      text: isBase
        ? 'This row is your current build. It is the reference every other row is measured against, so there is nothing to compare it to.'
        : `Its substat damage is ${bench.vsBaseSubPct >= 0 ? '+' : '−'}${formatTruncCompact(Math.abs(bench.vsBaseSubPct), 2)}% ${bench.vsBaseSubPct >= 0 ? 'above' : 'below'} your current build's substats.`,
    },
    {
      cells: 'Substat %',
      text: `Substats make up ${formatTruncCompact(bench.substatPct, 2)}% of this build's total damage.`,
    },
    {
      cells: 'Build dmg',
      text: `Total damage for this build comes to ${formatCompactNum(bench.damage)}.`,
    },
  ]
}

// shared expandable note row rendered under any open table row
function SubxNote({ head, sub, lines, span }: {
  head: string
  sub?: string
  lines: SubstatNoteLine[]
  span: number
}) {
  return (
    <tr className="subx-note-row">
      <td className="subx-note-cell" colSpan={span}>
        <div className="subx-note">
          <span className="subx-note__head">
            {head}
            {sub ? <span className="subx-note__sub">{sub}</span> : null}
          </span>
          <dl className="subx-note__list">
            {lines.map((line) => (
              <div key={line.cells} className="subx-note__line">
                <dt className="subx-note__cells">{line.cells}</dt>
                <dd className="subx-note__text">{line.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </td>
    </tr>
  )
}

interface SubstatPriorityTablesProps {
  rows: SubstatViewRow[]
  benchmark: SubstatBenchmark | null
  // how many tuning steps the add / remove columns simulate at once (drives labels + notes)
  steps: number
}

type SubstatSort = { col: SubstatSortCol; dir: 'asc' | 'desc' }

// each table sorts independently, so its default sorts on its own first column
const defaultGroupSort = (group: SubstatGroup): SubstatSort => ({
  col: group.columns[0].col,
  dir: 'desc',
})

export function SubstatPriorityTables({ rows, benchmark, steps }: SubstatPriorityTablesProps) {
  // sort state is kept per table (keyed by group title) so sorting one table
  // never resets another.
  const [sorts, setSorts] = useState<Record<string, SubstatSort>>({})
  // expanded note rows are tracked by a composite "table::row" id so the same
  // substat can be opened independently in each table it appears in.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const toggleNote = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const onSort = useCallback((group: SubstatGroup, col: SubstatSortCol) => {
    setSorts((prev) => {
      const current = prev[group.title] ?? defaultGroupSort(group)
      const next: SubstatSort = current.col === col
        ? { col, dir: current.dir === 'desc' ? 'asc' : 'desc' }
        : { col, dir: 'desc' }
      return { ...prev, [group.title]: next }
    })
  }, [])

  const colMax = useMemo(() => {
    // per-column peak magnitude used to scale the in-cell level meters
    const max: Partial<Record<SubstatSortCol, number>> = {}
    for (const group of SUBSTAT_GROUPS) {
      for (const column of group.columns) {
        let peak = 0
        for (const row of rows) {
          if (column.presentOnly && !row.present) {
            continue
          }
          const value = Math.abs(row[column.col])
          if (value > peak) {
            peak = value
          }
        }
        max[column.col] = peak
      }
    }
    return max
  }, [rows])

  if (rows.length === 0) {
    return (
      <div className="suggestions-empty-state">
        Select a target above to see substat priority... Make sure you&apos;ve got echoes equipped~!
      </div>
    )
  }

  return (
    <div className="subx-stack">
      {benchmark && (() => {
        const benchMaxDmg = Math.max(...benchmark.rows.map((bench) => bench.damage), 1)
        const benchMaxSub = Math.max(...benchmark.rows.map((bench) => Math.abs(bench.substatDmg)), 1)
        return (
          <section className="subx-block subx-bench">
            <div className="subx-block__cap">
              <span className="subx-block__name">Build benchmark</span>
              <span className="subx-block__rule" aria-hidden="true" />
            </div>
            <div className="subx-block__scroll">
              <table className="subx-table">
                <thead>
                  <tr>
                    <th scope="col" className="subx-th subx-th--name">Build</th>
                    <th scope="col" className="subx-th">Substat dmg</th>
                    <th scope="col" className="subx-th">vs base</th>
                    <th scope="col" className="subx-th">Substat %</th>
                    <th scope="col" className="subx-th">Build dmg</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmark.rows.map((bench) => {
                    const isBase = bench.id === 'base'
                    const vsTone = isBase ? '' : bench.vsBaseSubPct >= 0 ? ' is-gain' : ' is-loss'
                    const noteId = `bench::${bench.id}`
                    const open = expanded.has(noteId)
                    return (
                      <Fragment key={bench.id}>
                        <tr
                          className={`subx-row subx-row--toggle subx-bench-row subx-bench-row--${bench.id}${open ? ' is-open' : ''}`}
                          aria-expanded={open}
                          tabIndex={0}
                          onClick={() => toggleNote(noteId)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              toggleNote(noteId)
                            }
                          }}
                        >
                          <th scope="row" className="subx-cell subx-cell--name">
                            <span className="subx-name">
                              <span className="subx-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                              {bench.label}
                            </span>
                          </th>
                          <td className="subx-cell">
                            <span className="subx-figure" style={{ '--lvl': Math.abs(bench.substatDmg) / benchMaxSub } as CSSProperties}>
                              <span className="subx-figure__val">{formatCompactNum(bench.substatDmg)}</span>
                              <span className="subx-figure__bar" aria-hidden="true" />
                            </span>
                          </td>
                          <td className={`subx-cell${vsTone}`}>
                            {isBase ? (
                              <span className="subx-dash">-</span>
                            ) : (
                              <span className="subx-figure">
                                <span className="subx-figure__val">{`${bench.vsBaseSubPct >= 0 ? '+' : '−'}${formatTruncCompact(Math.abs(bench.vsBaseSubPct), 2)}%`}</span>
                              </span>
                            )}
                          </td>
                          <td className="subx-cell">
                            <span className="subx-figure">
                              <span className="subx-figure__val">{`${formatTruncCompact(bench.substatPct, 2)}%`}</span>
                            </span>
                          </td>
                          <td className="subx-cell subx-cell--ref">
                            <span className="subx-figure" style={{ '--lvl': bench.damage / benchMaxDmg } as CSSProperties}>
                              <span className="subx-figure__val">{formatCompactNum(bench.damage)}</span>
                              <span className="subx-figure__bar" aria-hidden="true" />
                            </span>
                          </td>
                        </tr>
                        {open && (
                          <SubxNote head={bench.label} lines={buildBenchNote(bench)} span={5} />
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {benchmark.ideal.length > 0 && (
              <div className="subx-ideal">
                <span className="subx-ideal__lbl">Ideal · max values</span>
                <div className="subx-ideal__chips">
                  {benchmark.ideal.map((entry) => (
                    <span key={entry.key} className="subx-ideal__chip">
                      {formatStatKeyLabel(entry.key)}<span className="subx-ideal__x">×{entry.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )
      })()}
      {SUBSTAT_GROUPS.map((group) => {
        const sort = sorts[group.title] ?? defaultGroupSort(group)
        const direction = sort.dir === 'asc' ? 1 : -1
        const sortedRows = [...rows].sort((left, right) => (
          (left[sort.col] - right[sort.col]) * direction
        ))
        return (
        <section key={group.title} className="subx-block">
          <div className="subx-block__cap">
            <span className="subx-block__name">{group.title}</span>
            <span className="subx-block__rule" aria-hidden="true" />
          </div>
          <div className="subx-block__scroll">
            <table className="subx-table">
              <thead>
                <tr>
                  <th scope="col" className="subx-th subx-th--name">Substat</th>
                  {group.columns.map((column) => {
                    const active = sort.col === column.col
                    return (
                      <th
                        key={column.col}
                        scope="col"
                        className={`subx-th${active ? ' is-sorted' : ''}`}
                        title={column.title}
                        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button type="button" className="subx-sort" onClick={() => onSort(group, column.col)}>
                          <span className="subx-sort__lbl">{column.label}</span>
                          <span className="subx-sort__caret">{active ? (sort.dir === 'desc' ? '▾' : '▴') : '·'}</span>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, rowIndex) => {
                  const noteId = `${group.title}::${row.key}`
                  const open = expanded.has(noteId)
                  return (
                    <Fragment key={row.key}>
                      <tr
                        className={`subx-row subx-row--toggle${row.present ? '' : ' is-absent'}${open ? ' is-open' : ''}`}
                        style={{ '--row': rowIndex } as CSSProperties}
                        aria-expanded={open}
                        tabIndex={0}
                        onClick={() => toggleNote(noteId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            toggleNote(noteId)
                          }
                        }}
                      >
                        <th scope="row" className="subx-cell subx-cell--name">
                          <span className="subx-name">
                            <span className="subx-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                            {formatStatKeyLabel(row.key)}
                          </span>
                        </th>
                        {group.columns.map((column) => {
                          const empty = column.presentOnly && !row.present
                          const active = sort.col === column.col
                          const value = row[column.col]
                          const isMeter = column.col === 'quality'
                          const isTotal = column.col === 'total'
                          const peak = colMax[column.col] ?? 0
                          const lvl = empty
                            ? 0
                            : isMeter
                              ? Math.max(0, Math.min(1, value / 100))
                              : peak > 0
                                ? Math.abs(value) / peak
                                : 0
                          const tone = column.kind === 'gain'
                            ? ' is-gain'
                            : column.kind === 'loss'
                              ? ' is-loss'
                              : ''
                          // stat-amount and total columns read as exact figures, not magnitudes,
                          // so they skip the level meter
                          const noBar = column.format === 'statval'
                          // the value columns annotate how many steps actually fit after clamping
                          const stepSup = column.col === 'addAmount'
                            ? appliedSteps(row.addAmount, row.rollStep)
                            : column.col === 'removeAmount'
                              ? appliedSteps(row.removeAmount, row.rollStep)
                              : null
                          return (
                            <td
                              key={column.col}
                              className={`subx-cell${tone}${active ? ' is-sorted' : ''}${empty ? ' is-empty' : ''}`}
                              style={{ '--lvl': lvl } as CSSProperties}
                            >
                              {empty ? (
                                <span className="subx-dash">-</span>
                              ) : (
                                <span className="subx-figure">
                                  <span className="subx-figure__val">
                                    {fmtSubstatCell(row, column)}
                                    {isTotal ? (
                                      <sup className="subx-rolls" title={`${slotsLabel(row.rollCount)} filled`}>
                                        {row.rollCount}
                                      </sup>
                                    ) : null}
                                    {stepSup !== null ? (
                                      <sup className="subx-rolls" title={`${stepSup} step${stepSup === '1' ? '' : 's'} applied`}>
                                        {stepSup}
                                      </sup>
                                    ) : null}
                                  </span>
                                  {noBar ? null : <span className="subx-figure__bar" aria-hidden="true" />}
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                      {open && (
                        <SubxNote
                          head={formatStatKeyLabel(row.key)}
                          sub={row.present
                            ? `${slotsLabel(row.rollCount)} on build`
                            : 'not on build'}
                          lines={buildSubstatNote(row, group, steps)}
                          span={group.columns.length + 1}
                        />
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
        )
      })}
    </div>
  )
}
