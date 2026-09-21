/*
  Author: Runor Ewhro
  Description: Filters enemy presets and returns the selected enemy profile
               template for Simulation target configuration.
*/

import { useMemo } from 'react'
import type { ChangeEvent, CSSProperties as CssProps } from 'react'
import { Search } from 'lucide-react'
import type { EnemyCatEnt, EnemyClassId, EnemyElemId } from '@/domain/entities/enemy.ts'
import {
  ENEMY_CLASS_TXT,
  ENEMY_ELEM_ATTR,
  ENEMY_ELEM_TXT,
} from '@/domain/entities/enemy.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { PickerModal } from '@/modules/simulation/ui/PickerModal.tsx'

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
      <label className="amdl__find">
        <Search size="0.8rem" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={onSrchChngtd}
          placeholder="Search by name or ID"
        />
      </label>

      <div className="pkr-rail__lab">Element</div>
      <div className="pkr-rail__row">
        {(Object.keys(ENEMY_ELEM_TXT) as Array<`${EnemyElemId}`>).map((key) => {
          const elementId = Number(key) as EnemyElemId
          const attributeKey = ENEMY_ELEM_ATTR[elementId]
          const selected = selElem === elementId

          return (
            <button
              key={`enemy-element-${elementId}`}
              type="button"
              className={selected ? 'pkr-rail__ico is-on' : 'pkr-rail__ico'}
              style={{ '--pkr-tone': ATTR_COLORS[attributeKey] } as CssProps}
              title={ENEMY_ELEM_TXT[elementId]}
              aria-label={ENEMY_ELEM_TXT[elementId]}
              aria-pressed={selected}
              onClick={() => onElemChng(selected ? null : elementId)}
            >
              <img
                src={`/assets/game/attributes/icons/${attributeKey}.webp`}
                alt=""
                aria-hidden="true"
                style={attributeKey === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
                onError={withDefIconM}
              />
            </button>
          )
        })}
      </div>

      <div className="pkr-rail__lab">Class</div>
      <div className="pkr-rail__row">
        {(Object.keys(ENEMY_CLASS_TXT) as Array<`${EnemyClassId}`>).map((key) => {
          const classId = Number(key) as EnemyClassId
          const selected = selClss === classId

          return (
            <button
              key={`enemy-class-${classId}`}
              type="button"
              className={selected ? 'pkr-rail__chip is-on' : 'pkr-rail__chip'}
              aria-pressed={selected}
              onClick={() => onClssChng(selected ? null : classId)}
            >
              {ENEMY_CLASS_TXT[classId]}
            </button>
          )
        })}
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
      {(search || selLmnt != null || selClss != null) ? (
        <div className="amdl__pill">
          <span className="amdl__pill-label">Filters</span>
          <span className="amdl__pill-value">
            {Number(search.length > 0) + Number(selLmnt != null) + Number(selClss != null)}
          </span>
        </div>
      ) : null}
    </>
  )

  const items = useMemo(() => {
    return enemies.map((entry) => {
      const element = entry.element ?? entry.elementArray[0] ?? null
      const attributeKey = element != null ? ENEMY_ELEM_ATTR[element] : null
      const isSelected = entry.id === selNmyId

      return {
        id: entry.id,
        title: entry.name,
        description: entry.description || undefined,
        selected: isSelected,
        onSelect: () => onSelect(entry.id),
        leading: (
          <div className="picker-modal__media-frame">
            <img
              src={entry.icon ?? '/assets/game/default.webp'}
              alt={entry.name} className="picker-modal__media-image"
              onError={withDefIconM}
            />
          </div>
        ),
        trailing: isSelected ? 'Selected' : null,
        tone: attributeKey ? ATTR_COLORS[attributeKey] : undefined,
        meta: (
          <>
            <span className="picker-modal__spec-item">{ENEMY_CLASS_TXT[entry.class]}</span>
            {attributeKey ? (
              <img
                src={`/assets/game/attributes/icons/${attributeKey}.webp`}
                alt={ENEMY_ELEM_TXT[element!]}
                title={ENEMY_ELEM_TXT[element!]} className="picker-modal__meta-icon picker-modal__spec-push"
                style={attributeKey === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
                onError={withDefIconM}
              />
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
      variant="enemy"
      eyebrow="Enemy Catalog"
      title="Select Enemy"
      summary={summary}
      filters={mkFltrNpt(search, onSrchChng, selLmnt, selClss, onLmntChng, onClssChng)}
      railFoot={`${enemies.length} enemies`}
      items={items}
      emptyState={emptyState}
      panelWidth="wide"
      onClose={onClose}
    />
  )
}
