import { useMemo, useState } from 'react'
import type { EchoDefinition } from '@/domain/entities/catalog'
import { SONATA_SETS, getSonataSetIcon } from '@/data/gameData/catalog/sonataSets'
import { hideBrokenImage } from '@/shared/lib/imageFallback'
import { PickerModal } from '@/shared/ui/PickerModal'

// filters and renders the echo picker modal used by the left pane and optimizer.
interface EchoPickerModalProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  echoes: EchoDefinition[]
  selectedEchoId?: string | null
  slotIndex: number
  maxCost?: number
  onSelect: (echoId: string) => void
  onClear: () => void
  onClose: () => void
}

// filters and renders the echo picker modal used by the left pane and optimizer.
const COST_OPTIONS = [4, 3, 1] as const

export function EchoPickerModal({
  visible,
  open,
  closing = false,
  portalTarget,
  echoes,
  selectedEchoId = null,
  slotIndex,
  maxCost = 12,
  onSelect,
  onClear,
  onClose,
}: EchoPickerModalProps) {
  const [costFilter, setCostFilter] = useState<number[]>([4, 3, 1])
  const [setFilter, setSetFilter] = useState<number[]>([])
  const [search, setSearch] = useState('')

  const availableSets = useMemo(() => {
    const setIds = new Set<number>()
    for (const echo of echoes) {
      for (const setId of echo.sets) {
        setIds.add(setId)
      }
    }
    return SONATA_SETS.filter((s) => setIds.has(s.id))
  }, [echoes])

  const filteredEchoes = useMemo(() => {
    const searchLower = search.toLowerCase().trim()
    return echoes.filter((echo) => {
      if (!costFilter.includes(echo.cost)) return false
      if (setFilter.length > 0 && !echo.sets.some((s) => setFilter.includes(s))) return false
      if (searchLower && !echo.name.toLowerCase().includes(searchLower)) return false
      return true
    })
  }, [echoes, costFilter, setFilter, search])

  const activeFilterCount =
    (costFilter.length !== 3 ? 1 : 0) +
    (setFilter.length > 0 ? 1 : 0) +
    (search.trim() ? 1 : 0)

  const summary = (
    <>
      <div className="picker-modal__summary-pill">
        <span className="picker-modal__summary-label">Echoes</span>
        <span className="picker-modal__summary-value">
          {filteredEchoes.length} of {echoes.length}
        </span>
      </div>
      {activeFilterCount > 0 ? (
        <div className="picker-modal__summary-pill">
          <span className="picker-modal__summary-label">Filters</span>
          <span className="picker-modal__summary-value">{activeFilterCount}</span>
        </div>
      ) : null}
    </>
  )

  const filters = (
    <div className="picker-filter-layout echo-picker-filters">
      <div className="picker-filter-section">
        <div className="picker-filter-group">
          {COST_OPTIONS.map((cost) => (
            <button
              key={`cost-${cost}`}
              type="button"
              className={costFilter.includes(cost) ? 'picker-filter-chip active' : 'picker-filter-chip'}
              onClick={() =>
                setCostFilter((prev) =>
                  prev.includes(cost) ? prev.filter((c) => c !== cost) : [...prev, cost],
                )
              }
            >
              {cost}C
            </button>
          ))}
        </div>
      </div>
      <div className="picker-filter-section echo-picker-set-filters">
        <div className="picker-filter-group echo-picker-set-group">
          {availableSets.map((set) => (
            <button
              key={`set-${set.id}`}
              type="button"
              className={setFilter.includes(set.id) ? 'picker-filter-chip active' : 'picker-filter-chip'}
              onClick={() =>
                setSetFilter((prev) =>
                  prev.includes(set.id) ? prev.filter((s) => s !== set.id) : [...prev, set.id],
                )
              }
              title={set.name}
            >
              <img
                src={set.icon}
                alt={set.name}
                className="echo-picker-set-icon"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </div>
      <div className="picker-filter-section">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name..."
          className="echo-picker-search"
        />
      </div>
    </div>
  )

  const items = [
    ...(selectedEchoId
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
            meta: (
              <span className="picker-modal__meta-pill">Empty Slot</span>
            ),
          },
        ]
      : []),
    ...filteredEchoes.map((echo) => {
      const isSelected = echo.id === selectedEchoId
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
          <div className={`picker-modal__media-frame echo-picker-icon-frame ${overBudget ? 'echo-picker--over' : ''}`}>
            <img
              src={echo.icon}
              alt={echo.name}
              className="picker-modal__media-image"
              style={{ objectFit: 'contain' }}
              onError={hideBrokenImage}
            />
          </div>
        ),
        trailing: isSelected
          ? <span className="picker-modal__selection-pill">Equipped</span>
          : overBudget
            ? <span className="picker-modal__over-budget-pill">Cost {12 - maxCost + echo.cost} &gt; 12</span>
            : null,
        meta: (
          <>
            <span className={`picker-modal__meta-pill ${overBudget ? 'picker-modal__meta-pill--disabled' : ''}`}>{echo.cost}C</span>
            {echo.sets.map((setId) => {
              const setIcon = getSonataSetIcon(setId)
              return setIcon ? (
                <span key={setId} className="picker-modal__meta-pill picker-modal__meta-pill--icon">
                  <img src={setIcon} alt="" className="echo-picker-meta-set-icon" />
                </span>
              ) : null
            })}
          </>
        ),
      }
    }),
  ]

  return (
    <PickerModal
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
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
