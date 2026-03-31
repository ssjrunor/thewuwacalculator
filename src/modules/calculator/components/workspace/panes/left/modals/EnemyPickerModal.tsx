import { useMemo } from 'react'
import type { ChangeEvent } from 'react'
import type { EnemyCatalogEntry, EnemyClassId, EnemyElementId } from '@/domain/entities/enemy'
import {
  ENEMY_CLASS_LABELS,
  ENEMY_ELEMENT_ATTRIBUTE_KEYS,
  ENEMY_ELEMENT_LABELS,
} from '@/domain/entities/enemy'
import { withDefaultIconImage } from '@/shared/lib/imageFallback'
import { PickerModal } from '@/shared/ui/PickerModal'

// surfaces the enemy picker dialog so players can swap between presets and custom builds.
interface EnemyPickerModalProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  enemies: EnemyCatalogEntry[]
  selectedEnemyId: string | null
  search: string
  selectedElement: EnemyElementId | null
  selectedClass: EnemyClassId | null
  loading?: boolean
  error?: string | null
  onSearchChange: (value: string) => void
  onElementChange: (value: EnemyElementId | null) => void
  onClassChange: (value: EnemyClassId | null) => void
  onSelect: (enemyId: string) => void
  onClose: () => void
}

function buildFilterInput(
  search: string,
  onSearchChange: (value: string) => void,
  selectedElement: EnemyElementId | null,
  selectedClass: EnemyClassId | null,
  onElementChange: (value: EnemyElementId | null) => void,
  onClassChange: (value: EnemyClassId | null) => void,
) {
  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value)
  }

  return (
    <div className="picker-modal__filters">
      <label className="enemy-picker__search">
        <span className="picker-modal__summary-label">Search</span>
        <input
          type="search"
          value={search}
          onChange={handleSearchChange}
          placeholder="Search by name or ID"
          className="enemy-picker__search-input"
        />
      </label>

      <div className="picker-filter-layout enemy-picker__filter-layout">
        <div className="picker-filter-section">
          <span className="picker-modal__summary-label">Element</span>
          <div className="picker-filter-group">
            {(Object.keys(ENEMY_ELEMENT_LABELS) as Array<`${EnemyElementId}`>).map((key) => {
              const elementId = Number(key) as EnemyElementId
              const attributeKey = ENEMY_ELEMENT_ATTRIBUTE_KEYS[elementId]
              const selected = selectedElement === elementId

              return (
                <button
                  key={`enemy-element-${elementId}`}
                  type="button"
                  className={selected ? 'picker-filter-icon picker-filter-icon--attribute active' : 'picker-filter-icon picker-filter-icon--attribute'}
                  title={ENEMY_ELEMENT_LABELS[elementId]}
                  aria-label={ENEMY_ELEMENT_LABELS[elementId]}
                  onClick={() => onElementChange(selected ? null : elementId)}
                >
                  <img
                    src={`/assets/attributes/attributes alt/${attributeKey}.webp`}
                    alt=""
                    aria-hidden="true"
                    style={attributeKey === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
                  />
                </button>
              )
            })}
          </div>
        </div>

        <div className="picker-filter-section">
          <span className="picker-modal__summary-label">Class</span>
          <div className="picker-filter-group enemy-picker__class-group">
            {(Object.keys(ENEMY_CLASS_LABELS) as Array<`${EnemyClassId}`>).map((key) => {
              const classId = Number(key) as EnemyClassId
              const selected = selectedClass === classId

              return (
                <button
                  key={`enemy-class-${classId}`}
                  type="button"
                  className={selected ? 'picker-filter-chip active' : 'picker-filter-chip'}
                  onClick={() => onClassChange(selected ? null : classId)}
                >
                  {ENEMY_CLASS_LABELS[classId]}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export function EnemyPickerModal({
  visible,
  open,
  closing = false,
  portalTarget,
  enemies,
  selectedEnemyId,
  search,
  selectedElement,
  selectedClass,
  loading = false,
  error = null,
  onSearchChange,
  onElementChange,
  onClassChange,
  onSelect,
  onClose,
}: EnemyPickerModalProps) {
  const summary = (
    <>
      <div className="picker-modal__summary-pill">
        <span className="picker-modal__summary-label">Catalog</span>
        <span className="picker-modal__summary-value">{enemies.length} enemies</span>
      </div>
      {(search || selectedElement != null || selectedClass != null) ? (
        <div className="picker-modal__summary-pill">
          <span className="picker-modal__summary-label">Filters</span>
          <span className="picker-modal__summary-value">
            {Number(search.length > 0) + Number(selectedElement != null) + Number(selectedClass != null)}
          </span>
        </div>
      ) : null}
    </>
  )

  const items = useMemo(() => {
    return enemies.map((entry) => {
      const attributeKey = entry.element != null ? ENEMY_ELEMENT_ATTRIBUTE_KEYS[entry.element] : null
      const isSelected = entry.id === selectedEnemyId

      return {
        id: entry.id,
        title: entry.name,
        subtitle: ENEMY_CLASS_LABELS[entry.class],
        description: entry.description || undefined,
        selected: isSelected,
        onSelect: () => onSelect(entry.id),
        leading: (
          <div className="picker-modal__media-frame enemy-picker__media-frame">
            <img
              src={entry.icon ?? '/assets/default-icon.webp'}
              alt={entry.name}
              className="picker-modal__media-image"
              onError={withDefaultIconImage}
            />
          </div>
        ),
        trailing: isSelected ? <span className="picker-modal__selection-pill">Selected</span> : null,
        meta: (
          <>
            <span className="picker-modal__meta-pill">{ENEMY_CLASS_LABELS[entry.class]}</span>
            {attributeKey ? (
              <span className="picker-modal__meta-pill">
                <img
                  src={`/assets/attributes/attributes alt/${attributeKey}.webp`}
                  alt=""
                  aria-hidden="true"
                  className="picker-modal__meta-icon"
                  style={attributeKey === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
                />
                {ENEMY_ELEMENT_LABELS[entry.element!]}
              </span>
            ) : null}
          </>
        ),
      }
    })
  }, [enemies, onSelect, selectedEnemyId])

  const emptyState = loading
    ? <p>Loading enemy catalog…</p>
    : error
      ? <p>{error}</p>
      : <p>No enemies match the current filters.</p>

  return (
    <PickerModal
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      eyebrow="Enemy Catalog"
      title="Select Enemy"
      summary={summary}
      filters={buildFilterInput(search, onSearchChange, selectedElement, selectedClass, onElementChange, onClassChange)}
      items={items}
      emptyState={emptyState}
      panelWidth="wide"
      onClose={onClose}
    />
  )
}
