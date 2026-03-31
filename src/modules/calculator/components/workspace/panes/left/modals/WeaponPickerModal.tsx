import { useMemo, useState } from 'react'
import type { GeneratedWeapon } from '@/domain/entities/weapon'
import {
  WEAPON_STAT_LABELS,
  formatWeaponStatDisplay,
  withDefaultWeaponImage,
} from '@/modules/calculator/model/weapon'
import { PickerModal } from '@/shared/ui/PickerModal'

// exposes the weapon picker dialog that filters the arsenal by rarity.
interface WeaponPickerModalProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  weapons: GeneratedWeapon[]
  selectedWeaponId?: string | null
  onSelect: (weaponId: string) => void
  onClose: () => void
}

function formatRarityLabel(rarity: number): string {
  return `${rarity}-Star`
}

export function WeaponPickerModal({
  visible,
  open,
  closing = false,
  portalTarget,
  weapons,
  selectedWeaponId = null,
  onSelect,
  onClose,
}: WeaponPickerModalProps) {
  const [selectedRarityFilter, setSelectedRarityFilter] = useState<number[]>([3, 4, 5])

  const filteredWeapons = useMemo(() => {
    return weapons.filter((entry) => selectedRarityFilter.includes(entry.rarity))
  }, [weapons, selectedRarityFilter])

  const activeFilterCount = Number(selectedRarityFilter.length !== 3)

  const summary = (
    <>
      <div className="picker-modal__summary-pill">
        <span className="picker-modal__summary-label">Arsenal</span>
        <span className="picker-modal__summary-value">
          {filteredWeapons.length} of {weapons.length}
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
    <div className="picker-filter-layout">
      <div className="picker-filter-section">
        <div className="picker-filter-group">
          {[5, 4, 3].map((rarity) => (
            <button
              key={`rarity-${rarity}`}
              type="button"
              className={
                selectedRarityFilter.includes(rarity)
                  ? `picker-filter-chip rarity-${rarity} active`
                  : `picker-filter-chip rarity-${rarity}`
              }
              onClick={() =>
                setSelectedRarityFilter((prev) =>
                  prev.includes(rarity) ? prev.filter((value) => value !== rarity) : [...prev, rarity],
                )
              }
            >
              {rarity}★
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const items = filteredWeapons.map((entry) => {
    const statLabel = WEAPON_STAT_LABELS[entry.statKey] ?? entry.statKey
    const statDisplay = formatWeaponStatDisplay(entry.statKey, entry.statValue)
    const isSelected = entry.id === selectedWeaponId

    return {
      id: entry.id,
      title: entry.name,
      rarity: entry.rarity as 1 | 2 | 3 | 4 | 5,
      selected: isSelected,
      onSelect: () => onSelect(entry.id),
      leading: (
        <div className={`picker-modal__media-frame rarity-${entry.rarity}`}>
          <img
            src={entry.icon}
            alt={entry.name}
            className="picker-modal__media-image"
            style={{ objectFit: 'contain' }}
            onError={withDefaultWeaponImage}
          />
        </div>
      ),
      trailing: isSelected ? <span className="picker-modal__selection-pill">Equipped</span> : null,
      meta: (
        <>
          <span className={`picker-modal__meta-pill picker-modal__meta-pill--rarity rarity-${entry.rarity}`}>
            {formatRarityLabel(entry.rarity)}
          </span>
          <span className="picker-modal__meta-pill">
            ATK: {(entry.baseAtk).toFixed(1)}
          </span>
          <span className="picker-modal__meta-pill">
            {statLabel}: {statDisplay}
          </span>
        </>
      ),
    }
  })

  return (
    <PickerModal
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      eyebrow="Arsenal"
      title="Select Weapon"
      summary={summary}
      filters={filters}
      items={items}
      emptyState={<p>No weapons match the current filters.</p>}
      closeLabel="Close"
      panelWidth="regular"
      onClose={onClose}
    />
  )
}
