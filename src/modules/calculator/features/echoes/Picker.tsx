/*
  Author: Runor Ewhro
  Description: Filters catalog echoes by name, cost, sonata, and usage recency
               before handing the selected echo id back to the caller.
*/

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { EchoDef } from '@/domain/entities/catalog.ts'
import { getSntSetIco, SONATA_SETS } from '@/data/gameData/catalog/sonataSets.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { PickerModal as ShrdPckrMdl } from '@/shared/ui/PickerModal.tsx'
import { AllowedSets } from '@/modules/calculator/features/optimizer/AllowedSets.tsx'
import { mkSrchTkns, mtchSrchTkns } from '@/modules/calculator/features/echoes/lib/search.ts'

// filters and renders the echo picker modal used by the left pane and optimizer.
interface EchoPckrMdlP {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  echoes: EchoDef[]
  selEchoId?: string | null
  slotIndex: number
  maxCost?: number
  onSelect: (echoId: string) => void
  onClear: () => void
  onClose: () => void
}

// filters and renders the echo picker modal used by the left pane and optimizer.
const COST_OPTIONS = [4, 3, 1] as const

export function EchoPicker({
  visible,
  open,
  closing = false,
  portalTarget,
  echoes,
  selEchoId: selEchoId = null,
  slotIndex,
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
  const vlblSetIds = useMemo(() => vlblSets.map((set) => set.id), [vlblSets])

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
      <div className="picker-modal__summary-pill">
        <span className="picker-modal__summary-label">Echoes</span>
        <span className="picker-modal__summary-value">
          {fltrChs.length} of {echoes.length}
        </span>
      </div>
      {actFltrCnt > 0 ? (
        <div className="picker-modal__summary-pill">
          <span className="picker-modal__summary-label">Filters</span>
          <span className="picker-modal__summary-value">{actFltrCnt}</span>
        </div>
      ) : null}
    </>
  )

  const filters = (
    <>
      <div className="picker-filter-layout echo-filter-row">
        <label className="bp-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
          />
        </label>
        <div className="picker-filter-divider" aria-hidden="true" />
        <div className="picker-filter-section">
          <div className="picker-filter-group">
            {COST_OPTIONS.map((cost) => (
              <button
                key={`cost-${cost}`}
                type="button"
                className={costFilter.includes(cost) ? 'picker-filter-chip active' : 'picker-filter-chip'}
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
        </div>
        <div className="picker-filter-divider" aria-hidden="true" />
        <div className="picker-filter-section echo-picker-set-filters">
          <AllowedSets
            selectedSetIds={setFilter}
            availableSetIds={vlblSetIds}
            placeholder="All Sonata"
            triggerClass="picker-sonata-select"
            triggerVariant="liquid"
            menuMinWidth={500}
            onSetIdsChange={setSetFilter}
          />
        </div>
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
          <div className={`picker-modal__media-frame picker-modal__media-frame--inset echo-picker-icon-frame ${overBudget ? 'echo-picker--over' : ''}`}>
            <img
              src={echo.icon}
              alt={echo.name}
              className="picker-modal__media-image"
              onError={withDefEchoMg}
            />
          </div>
        ),
        trailing: isSelected
          ? 'Equipped'
          : overBudget
            ? `+${echo.cost - maxCost}C over`
            : null,
        specClassName: 'picker-modal__card-spec--echo',
        meta: (
          <>
            <span className={`picker-modal__spec-item ${overBudget ? 'picker-modal__spec-item--warn' : ''}`}>{echo.cost}C</span>
            <span className="picker-modal__spec-group">
              {echo.sets.map((setId) => {
                const setIcon = getSntSetIco(setId)
                return setIcon ? (
                  <img key={setId} src={setIcon} alt="" className="echo-picker-meta-set-icon" onError={withDefIconM} />
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
      eyebrow={`Slot ${slotIndex + 1}`}
      title="Select Echo"
      summary={summary}
      filters={filters}
      items={items}
      emptyState={<p>No echoes match the current filters.</p>}
      closeLabel="Close"
      panelWidth="wide"
      onClose={onClose}
    />
  )
}
