/*
  Author: Runor Ewhro
  Description: Renders the picker surface for the calculator enemies flow.
*/

import { useMemo } from 'react'
import type { ChangeEvent } from 'react'
import { Search } from 'lucide-react'
import type { EnemyCatEnt, EnemyClassId, EnemyElemId } from '@/domain/entities/enemy.ts'
import {
  ENEMY_CLASS_TXT,
  ENEMY_ELEM_ATTR,
  ENEMY_ELEM_TXT,
} from '@/domain/entities/enemy.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { PickerModal } from '@/shared/ui/PickerModal.tsx'

// surfaces the enemy picker dialog so players can swap between presets and custom builds.
interface EnemyPckrPrp {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  enemies: EnemyCatEnt[]
  selEnemyId: string | null
  search: string
  selElem: EnemyElemId | null
  selClss: EnemyClassId | null
  loading?: boolean
  error?: string | null
  onSrchChng: (value: string) => void
  onElemChng: (value: EnemyElemId | null) => void
  onClssChng: (value: EnemyClassId | null) => void
  onSelect: (enemyId: string) => void
  onClose: () => void
}

function mkFltrNpt(
  search: string,
  onSrchChng: (value: string) => void,
  selElem: EnemyElemId | null,
  selClss: EnemyClassId | null,
  onElemChng: (value: EnemyElemId | null) => void,
  onClssChng: (value: EnemyClassId | null) => void,
) {
  const onSrchChngtd = (event: ChangeEvent<HTMLInputElement>) => {
    onSrchChng(event.target.value)
  }

  return (
    <>

      <div className="picker-filter-layout enemy-picker__filter-layout">
        <label className="bp-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={onSrchChngtd}
            placeholder="Search by name or ID"
          />
        </label>

        <div className="picker-filter-section">
          <div className="picker-filter-group">
            {(Object.keys(ENEMY_ELEM_TXT) as Array<`${EnemyElemId}`>).map((key) => {
              const elementId = Number(key) as EnemyElemId
              const attributeKey = ENEMY_ELEM_ATTR[elementId]
              const selected = selElem === elementId

              return (
                <button
                  key={`enemy-element-${elementId}`}
                  type="button"
                  className={selected ? 'picker-filter-icon picker-filter-icon--attribute active' : 'picker-filter-icon picker-filter-icon--attribute'}
                  title={ENEMY_ELEM_TXT[elementId]}
                  aria-label={ENEMY_ELEM_TXT[elementId]}
                  onClick={() => onElemChng(selected ? null : elementId)}
                >
                  <img
                    src={`/assets/attributes/attributes alt/${attributeKey}.webp`}
                    alt=""
                    aria-hidden="true"
                    style={attributeKey === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
                    onError={withDefIconM}
                  />
                </button>
              )
            })}
          </div>
        </div>

        <div className="picker-filter-section">
          <div className="picker-filter-group enemy-picker__class-group">
            {(Object.keys(ENEMY_CLASS_TXT) as Array<`${EnemyClassId}`>).map((key) => {
              const classId = Number(key) as EnemyClassId
              const selected = selClss === classId

              return (
                <button
                  key={`enemy-class-${classId}`}
                  type="button"
                  className={selected ? 'picker-filter-chip active' : 'picker-filter-chip'}
                  onClick={() => onClssChng(selected ? null : classId)}
                >
                  {ENEMY_CLASS_TXT[classId]}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

export function EnemyPicker({
  visible,
  open,
  closing = false,
  portalTarget,
  enemies,
  selEnemyId: selNmyId,
  search,
  selElem: selLmnt,
  selClss: selClss,
  loading = false,
  error = null,
  onSrchChng: onSrchChng,
  onElemChng: onLmntChng,
  onClssChng: onClssChng,
  onSelect,
  onClose,
}: EnemyPckrPrp) {
  const summary = (
    <>
      <div className="picker-modal__summary-pill">
        <span className="picker-modal__summary-label">Catalog</span>
        <span className="picker-modal__summary-value">{enemies.length} enemies</span>
      </div>
      {(search || selLmnt != null || selClss != null) ? (
        <div className="picker-modal__summary-pill">
          <span className="picker-modal__summary-label">Filters</span>
          <span className="picker-modal__summary-value">
            {Number(search.length > 0) + Number(selLmnt != null) + Number(selClss != null)}
          </span>
        </div>
      ) : null}
    </>
  )

  const items = useMemo(() => {
    return enemies.map((entry) => {
      const attributeKey = entry.element != null ? ENEMY_ELEM_ATTR[entry.element] : null
      const isSelected = entry.id === selNmyId

      return {
        id: entry.id,
        title: entry.name,
        subtitle: ENEMY_CLASS_TXT[entry.class],
        description: entry.description || undefined,
        selected: isSelected,
        onSelect: () => onSelect(entry.id),
        leading: (
          <div className="picker-modal__media-frame enemy-picker__media-frame">
            <img
              src={entry.icon ?? '/assets/default.webp'}
              alt={entry.name}
              className="picker-modal__media-image"
              onError={withDefIconM}
            />
          </div>
        ),
        trailing: isSelected ? <span className="picker-modal__selection-pill">Selected</span> : null,
        meta: (
          <>
            <span className="picker-modal__meta-pill">{ENEMY_CLASS_TXT[entry.class]}</span>
            {attributeKey ? (
              <span className="picker-modal__meta-pill">
                <img
                  src={`/assets/attributes/attributes alt/${attributeKey}.webp`}
                  alt=""
                  aria-hidden="true"
                  className="picker-modal__meta-icon"
                  style={attributeKey === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
                  onError={withDefIconM}
                />
                {ENEMY_ELEM_TXT[entry.element!]}
              </span>
            ) : null}
          </>
        ),
      }
    })
  }, [enemies, onSelect, selNmyId])

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
      filters={mkFltrNpt(search, onSrchChng, selLmnt, selClss, onLmntChng, onClssChng)}
      items={items}
      emptyState={emptyState}
      panelWidth="wide"
      onClose={onClose}
    />
  )
}
