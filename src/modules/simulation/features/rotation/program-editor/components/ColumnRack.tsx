/*
  Author: Runor Ewhro
  Description: Owns column rack behavior and state transitions for the components module.
*/

import { useMemo, useState } from 'react'
import { GripVertical } from 'lucide-react'
import {
  buildRegister,
  GROUP_NAMES,
  groupRem,
  REGISTER_GROUPS,
  STAT_HEADS,
  STAT_KEYS,
  STAT_NAMES,
  statGroup,
  type RegisterGroup,
  type StatKey,
} from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'

const WIDEST_BAND = 20

/*
  the band being dragged rides on the drag itself rather than in state. a
  dragover fires before react has re-rendered from the dragstart, so a handler
  reading state would be reading what was true a gesture ago.
*/
const BAND_MIME = 'application/x-rte-band'

interface ColumnRackProps {
  statKeys: readonly StatKey[]
  onStatKeys: (value: readonly StatKey[]) => void
  /** the order the bands read in, left to right */
  groupOrder: readonly RegisterGroup[]
  onGroupOrder: (value: readonly RegisterGroup[]) => void

  ceiling: number
}

/** the band rows, in the order they will read */
export function ColumnRack({
  statKeys,
  onStatKeys,
  groupOrder,
  onGroupOrder,
  ceiling,
}: ColumnRackProps) {
  const [dragging, setDragging] = useState<RegisterGroup | null>(null)
  const [over, setOver] = useState<RegisterGroup | null>(null)
  const full = statKeys.length >= ceiling

  const byGroup = useMemo(() => {
    const out = new Map<RegisterGroup, StatKey[]>()
    for (const group of REGISTER_GROUPS) {
      out.set(group, [])
    }
    for (const key of STAT_KEYS) {
      out.get(statGroup(key))?.push(key)
    }
    return out
  }, [])

  const toggle = (key: StatKey) => {
    if (statKeys.includes(key)) {
      onStatKeys(statKeys.filter((entry) => entry !== key))
      return
    }
    if (full) {
      return
    }
    onStatKeys([...statKeys, key])
  }

  const moveTo = (group: RegisterGroup, target: RegisterGroup) => {
    if (group === target) {
      return
    }
    const downward = groupOrder.indexOf(group) < groupOrder.indexOf(target)
    const rest = groupOrder.filter((entry) => entry !== group)
    rest.splice(rest.indexOf(target) + (downward ? 1 : 0), 0, group)
    onGroupOrder(rest)
  }

  const nudge = (group: RegisterGroup, delta: number) => {
    const at = groupOrder.indexOf(group)
    const to = at + delta
    if (at < 0 || to < 0 || to >= groupOrder.length) {
      return
    }
    const next = [...groupOrder]
    next.splice(at, 1)
    next.splice(to, 0, group)
    onGroupOrder(next)
  }

  return (
    <div className="rte-rk">

      <p className="rte-rk__key">
        <span>First</span>
        <i aria-hidden="true" />
        <span>Last</span>
      </p>

      <div className="rte-rk__rows">
        {groupOrder.map((group) => {
          const keys = byGroup.get(group) ?? []
          const live = keys.filter((key) => statKeys.includes(key))
          const rem = groupRem(group, live)
          return (
            <div
              key={group}
              className={[
                'rte-rk__row',
                `rte-rk__row--${group}`,
                dragging === group ? 'is-drag' : '',
                over === group && dragging !== group ? 'is-over' : '',
              ].filter(Boolean).join(' ')}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData(BAND_MIME, group)
                event.dataTransfer.setData('text/plain', GROUP_NAMES[group])
                setDragging(group)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
              onDragOver={(event) => {
                // the payload is unreadable until drop, but its type is not
                if (!event.dataTransfer.types.includes(BAND_MIME)) {
                  return
                }
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setOver(group)
              }}
              onDragLeave={() => setOver((current) => (current === group ? null : current))}
              onDrop={(event) => {
                const from = event.dataTransfer.getData(BAND_MIME)
                if (!from) {
                  return
                }
                event.preventDefault()
                moveTo(from as RegisterGroup, group)
                setDragging(null)
                setOver(null)
              }}
            >
              <button
                type="button" className="rte-rk__grip"
                aria-label={`Move ${GROUP_NAMES[group]}`}
                title={`Move ${GROUP_NAMES[group]}: drag, or use the arrow keys`}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                    return
                  }
                  event.preventDefault()
                  nudge(group, event.key === 'ArrowUp' ? -1 : 1)
                }}
              >
                <GripVertical size="0.7rem" aria-hidden="true" />
              </button>

              <b className="rte-rk__nm">{GROUP_NAMES[group]}</b>

              <span className="rte-rk__chips">
                {/*
                  the average is the one column the page cannot turn off, so it
                  stands in the output band as a fact rather than a choice.
                */}
                {group === 'output' ? (
                  <i className="rte-rk__chip is-fixed" title="The average is always shown">Avg</i>
                ) : null}
                {keys.map((key) => {
                  const on = statKeys.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`rte-rk__chip${on ? '' : ' is-off'}`}
                      aria-pressed={on}
                      disabled={!on && full}
                      title={!on && full
                        ? `${STAT_NAMES[key]}: drop a column to make room`
                        : STAT_NAMES[key]}
                      onClick={() => toggle(key)}
                    >
                      {STAT_HEADS[key]}
                    </button>
                  )
                })}
              </span>

              {/* what the band is spending, which is what a column actually costs */}
              <span className="rte-rk__w">
                {rem > 0 ? `${rem.toFixed(1)}rem` : 'none'}
                <i style={{ width: `${Math.min(100, (rem / WIDEST_BAND) * 100)}%` }} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** what the rack's header states: how full the register is, and how wide */
export function useColumnBudget(
  statKeys: readonly StatKey[],
  groupOrder: readonly RegisterGroup[],
  ceiling: number,
) {
  return useMemo(() => {
    const { widthRem } = buildRegister(statKeys, new Set(), groupOrder)
    return {
      taken: statKeys.length,
      ceiling,
      full: statKeys.length >= ceiling,
      widthRem,
    }
  }, [ceiling, groupOrder, statKeys])
}
