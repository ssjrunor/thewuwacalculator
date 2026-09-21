/*
  Author: Runor Ewhro
  Description: Filters catalog echoes by name, cost, sonata, and usage recency
               before handing the selected echo id back to the caller.
*/

import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import type { EchoDef } from '@/domain/entities/catalog.ts'
import { getSntSetClr, getSntSetIco, SONATA_SETS } from '@/data/gameData/catalog/sonataSets.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { PickerModal as ShrdPckrMdl } from '@/modules/simulation/ui/PickerModal.tsx'
import { mkSrchTkns, mtchSrchTkns } from '@/modules/simulation/features/echoes/lib/search.ts'

interface EchoPckrMdlP {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  echoes: EchoDef[]
  selEchoId?: string | null
  slotIndex: number
  eyebrow?: string
  maxCost?: number
  onSelect: (echoId: string) => void
  onClear: () => void
  onClose: () => void
}

const COST_OPTIONS = [4, 3, 1] as const

function sonataTone(setId: number | undefined): string | undefined {
  const color = setId == null ? null : getSntSetClr(setId)
  return color ? `color-mix(in srgb, ${color} 68%, var(--text))` : undefined
}

export function EchoPicker({
  visible,
  open,
  closing = false,
  portalTarget,
  echoes,
  selEchoId: selEchoId = null,
  slotIndex,
  eyebrow = `Slot ${slotIndex + 1}`,
  maxCost = 12,
  onSelect,
  onClear,
  onClose,
}: EchoPckrMdlP) {
  const [costFilter, setCostFltr] = useState<number[]>([4, 3, 1])
  const [setFilter, setSetFilter] = useState<number[]>([])
  const [search, setSearch] = useState('')

  const vlblSets = useMemo(() => {
    const setIds = new Set<number>()
    for (const echo of echoes) {
      for (const setId of echo.sets) {
        setIds.add(setId)
      }
    }
    return SONATA_SETS.filter((s) => setIds.has(s.id))
  }, [echoes])

  const fltrChs = useMemo(() => {
    const searchTokens = mkSrchTkns(search)
    return echoes.filter((echo) => {
      if (!costFilter.includes(echo.cost)) return false
      if (setFilter.length > 0 && !echo.sets.some((s) => setFilter.includes(s))) return false
      if (!mtchSrchTkns(searchTokens, [echo.name, echo.id])) return false
      return true
    })
  }, [echoes, costFilter, setFilter, search])

  const actFltrCnt =
    (costFilter.length !== 3 ? 1 : 0) +
    (setFilter.length > 0 ? 1 : 0) +
    (search.trim() ? 1 : 0)

  const summary = (
    <>
      {actFltrCnt > 0 ? (
        <div className="amdl__pill">
          <span className="amdl__pill-label">Filters</span>
          <span className="amdl__pill-value">{actFltrCnt}</span>
        </div>
      ) : null}
    </>
  )

  const filters = (
    <>
      <label className="amdl__find">
        <Search size="0.8rem" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
        />
      </label>

      <div className="pkr-rail__lab">Cost</div>
      <div className="pkr-rail__row">
        {COST_OPTIONS.map((cost) => (
          <button
            key={`cost-${cost}`}
            type="button"
            className={costFilter.includes(cost) ? 'pkr-rail__chip is-on' : 'pkr-rail__chip'}
            aria-pressed={costFilter.includes(cost)}
            onClick={() =>
              setCostFltr((prev) =>
                prev.includes(cost) ? prev.filter((c) => c !== cost) : [...prev, cost],
              )
            }
          >
            {cost}C
          </button>
        ))}
      </div>

      <div className="pkr-rail__lab">Sonata</div>
      <div className="pkr-rail__list">
        {vlblSets.map((set) => {
          const picked = setFilter.includes(set.id)
          const setIcon = getSntSetIco(set.id)
          return (
            <button
              key={set.id}
              type="button"
              className={picked ? 'amdl__tab is-on' : 'amdl__tab'}
              aria-pressed={picked}
              onClick={() =>
                setSetFilter((prev) =>
                  prev.includes(set.id) ? prev.filter((id) => id !== set.id) : [...prev, set.id],
                )
              }
            >
              {setIcon ? <img src={setIcon} alt="" aria-hidden="true" onError={withDefIconM} /> : <span />}
              <span className="amdl__tab-label">{set.name}</span>
              {picked ? <Check size="0.7rem" /> : <span />}
            </button>
          )
        })}
      </div>
    </>
  )

  const items = [
    ...(selEchoId
      ? [
          {
            id: '__clear__',
            title: 'Remove Echo',
            subtitle: 'Clear this slot',
            selected: false,
            onSelect: () => {
              onClear()
              onClose()
            },
          },
        ]
      : []),
    ...fltrChs.map((echo) => {
      const isSelected = echo.id === selEchoId
      const overBudget = echo.cost > maxCost && !isSelected

      return {
        id: echo.id,
        title: echo.name,
        selected: isSelected,
        disabled: overBudget,
        onSelect: () => {
          if (overBudget) return
          onSelect(echo.id)
          onClose()
        },
        leading: (
          <div className="picker-modal__media-frame">
            <img
              src={echo.icon}
              alt={echo.name} className="picker-modal__media-image"
              onError={withDefEchoMg}
            />
          </div>
        ),
        trailing: isSelected
          ? 'Equipped'
          : overBudget
            ? `+${echo.cost - maxCost}C over`
            : null,
        tone: sonataTone(echo.sets[0]),
        meta: (
          <>
            <span className={`picker-modal__spec-item ${overBudget ? 'picker-modal__spec-item--warn' : ''}`}>{echo.cost}C</span>
            <span className="picker-modal__spec-group picker-modal__spec-push">
              {echo.sets.map((setId) => {
                const setIcon = getSntSetIco(setId)
                return setIcon ? (
                  <img key={setId} src={setIcon} alt="" className="picker-modal__meta-icon" onError={withDefIconM} />
                ) : null
              })}
            </span>
          </>
        ),
      }
    }),
  ]

  return (
    <ShrdPckrMdl
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      variant="echo"
      eyebrow={eyebrow}
      title="Select Echo"
      summary={summary}
      filters={filters}
      railFoot={`${fltrChs.length} of ${echoes.length} echoes`}
      items={items}
      emptyState={<p>No echoes match the current filters.</p>}
      closeLabel="Close"
      panelWidth="wide"
      onClose={onClose}
    />
  )
}
