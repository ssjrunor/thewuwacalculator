import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ResonatorMenuEntry } from '@/domain/entities/resonator'
import {
  RESONATOR_FILTER_ATTRIBUTES,
  RESONATOR_FILTER_WEAPONS,
  WEAPON_TYPE_TO_KEY,
} from '@/modules/calculator/model/resonator'
import { toTitle } from '@/modules/calculator/model/overviewStats'
import { withDefaultIconImage } from '@/shared/lib/imageFallback'
import { PickerModal } from '@/shared/ui/PickerModal'

// renders the resonator picker dialog used across the workspace and optimizer.
interface ResonatorPickerModalProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  eyebrow?: string
  title: string
  description?: string
  closeLabel?: string
  panelWidth?: 'regular' | 'wide'
  resonators: ResonatorMenuEntry[]
  selectedResonatorId?: string | null
  selectionLabel?: string
  summaryPrimary?: {
    label: string
    value: string
  }
  countLabel?: string
  emptyState?: ReactNode
  onSelect: (resonatorId: string) => void
  onClose: () => void
}

function formatRarityLabel(rarity: 4 | 5): string {
  return `${rarity}-Star Resonator`
}

export function ResonatorPickerModal({
  visible,
  open,
  closing = false,
  portalTarget,
  eyebrow,
  title,
  description,
  closeLabel,
  panelWidth = 'regular',
  resonators,
  selectedResonatorId = null,
  selectionLabel = 'Selected',
  summaryPrimary,
  countLabel = 'Roster',
  emptyState,
  onSelect,
  onClose,
}: ResonatorPickerModalProps) {
  const [selectedWeaponFilter, setSelectedWeaponFilter] = useState<string | null>(null)
  const [selectedAttributeFilter, setSelectedAttributeFilter] = useState<string | null>(null)
  const [selectedRarityFilter, setSelectedRarityFilter] = useState<number[]>([4, 5])

  const filteredResonators = useMemo(() => {
    return resonators.filter((entry) => {
      const matchesWeapon =
        selectedWeaponFilter === null || WEAPON_TYPE_TO_KEY[entry.weaponType] === selectedWeaponFilter
      const matchesAttribute =
        selectedAttributeFilter === null || entry.attribute === selectedAttributeFilter
      const matchesRarity = selectedRarityFilter.includes(entry.rarity)

      return matchesWeapon && matchesAttribute && matchesRarity
    })
  }, [resonators, selectedAttributeFilter, selectedRarityFilter, selectedWeaponFilter])

  const activeFilterCount =
    Number(selectedWeaponFilter !== null) +
    Number(selectedAttributeFilter !== null) +
    Number(selectedRarityFilter.length !== 2)

  const summary = (
    <>
      {summaryPrimary ? (
        <div className="picker-modal__summary-pill">
          <span className="picker-modal__summary-label">{summaryPrimary.label}</span>
          <span className="picker-modal__summary-value">{summaryPrimary.value}</span>
        </div>
      ) : null}
      <div className="picker-modal__summary-pill">
        <span className="picker-modal__summary-label">{countLabel}</span>
        <span className="picker-modal__summary-value">
          {filteredResonators.length} of {resonators.length}
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
          {[5, 4].map((rarity) => (
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

      <div className="picker-filter-section">
        <div className="picker-filter-group">
          {RESONATOR_FILTER_WEAPONS.map((weapon) => (
            <button
              key={`weapon-${weapon.key}`}
              type="button"
              className={
                selectedWeaponFilter === weapon.key
                  ? 'picker-filter-icon picker-filter-icon--weapon active'
                  : 'picker-filter-icon picker-filter-icon--weapon'
              }
              title={weapon.label}
              aria-label={weapon.label}
              onClick={() => setSelectedWeaponFilter((prev) => (prev === weapon.key ? null : weapon.key))}
            >
              <img src={`/assets/weapons/${weapon.key}.webp`} alt="" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div className="picker-filter-section">
        <div className="picker-filter-group">
          {RESONATOR_FILTER_ATTRIBUTES.map((attribute) => (
            <button
              key={`attribute-${attribute}`}
              type="button"
              className={
                selectedAttributeFilter === attribute
                  ? 'picker-filter-icon picker-filter-icon--attribute active'
                  : 'picker-filter-icon picker-filter-icon--attribute'
              }
              title={toTitle(attribute)}
              aria-label={toTitle(attribute)}
              onClick={() => setSelectedAttributeFilter((prev) => (prev === attribute ? null : attribute))}
            >
              <img
                src={`/assets/attributes/attributes alt/${attribute}.webp`}
                alt=""
                aria-hidden="true"
                style={attribute === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const items = filteredResonators.map((entry) => {
    const weaponKey = WEAPON_TYPE_TO_KEY[entry.weaponType]
    const attributeLabel = toTitle(entry.attribute)
    const weaponLabel = toTitle(weaponKey)
    const isSelected = entry.id === selectedResonatorId

    return {
      id: entry.id,
      title: entry.displayName,
      rarity: entry.rarity,
      selected: isSelected,
      onSelect: () => onSelect(entry.id),
      leading: (
        <div className={`picker-modal__media-frame rarity-${entry.rarity}`}>
          <img
            src={entry.profile}
            alt={entry.displayName}
            className="picker-modal__media-image"
            onError={withDefaultIconImage}
          />
        </div>
      ),
      trailing: isSelected && selectionLabel ? <span className="picker-modal__selection-pill">{selectionLabel}</span> : null,
      meta: (
        <>
          <span className={`picker-modal__meta-pill picker-modal__meta-pill--rarity rarity-${entry.rarity}`}>
            {formatRarityLabel(entry.rarity)}
          </span>
          <span className="picker-modal__meta-pill">
            <img
              src={`/assets/attributes/attributes alt/${entry.attribute}.webp`}
              alt=""
              aria-hidden="true"
              className="picker-modal__meta-icon"
              style={entry.attribute === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
            />
            {attributeLabel}
          </span>
          <span className="picker-modal__meta-pill">
            <img
              src={`/assets/weapons/${weaponKey}.webp`}
              alt=""
              aria-hidden="true"
              className="picker-modal__meta-icon picker-modal__meta-icon--weapon"
            />
            {weaponLabel}
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
      eyebrow={eyebrow}
      title={title}
      description={description}
      summary={summary}
      filters={filters}
      items={items}
      emptyState={emptyState}
      closeLabel={closeLabel}
      panelWidth={panelWidth}
      onClose={onClose}
    />
  )
}
