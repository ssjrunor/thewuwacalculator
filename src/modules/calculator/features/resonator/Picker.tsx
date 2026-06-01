/*
  Author: Runor Ewhro
  Description: Renders the picker surface for the calculator resonator flow.
*/

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ResMenuEnt } from '@/domain/entities/resonator.ts'
import { useAppStore } from '@/domain/state/store.ts'
import {
  ATTR_FILTERS,
  WEAPON_FILTERS,
  WPNTYPETOKEY,
} from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { toTitle } from '@/shared/lib/format.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { PickerModal as ShrdPckrMdl } from '@/shared/ui/PickerModal.tsx'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import {
  getRecs,
  orderRecs,
} from '@/modules/calculator/features/resonator/lib/recommendations.ts'

// renders the resonator picker dialog used across the main and optimizer.
interface ResPckrPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  eyebrow?: string
  title: string
  description?: string
  closeLabel?: string
  panelWidth?: 'regular' | 'wide'
  resonators: ResMenuEnt[]
  selResId?: string | null
  selLbl?: string
  smmrPrmr?: {
    label: string
    value: string
  }
  countLabel?: string
  emptyState?: ReactNode
  onSelect: (resonatorId: string) => void
  onClose: () => void
}

function fmtRrtyLbl(rarity: 4 | 5): string {
  return `${rarity}-Star`
}

export function ResPckr({
  visible,
  open,
  closing = false,
  portalTarget,
  eyebrow,
  title,
  description = '',
  closeLabel,
  panelWidth = 'regular',
  resonators,
  selResId: selResId = null,
  selLbl: slctLbl = 'Selected',
  smmrPrmr: smmrPrmr,
  countLabel = 'Roster',
  emptyState,
  onSelect,
  onClose,
}: ResPckrPrps) {
  const rcmmMenuTms = useAppStore((state) => state.ui.preferences.recommendedMenuItems)
  const frqnResIds = useAppStore((state) => state.ui.itemFreq.resonator.ids)
  const frqnResCnts = useAppStore((state) => state.ui.itemFreq.resonator.counts)
  const lastUsedResI = useResQStr((state) => state.queueIds)

  const [selWpnFltr, setSelWpnFlt] = useState<string | null>(null)
  const [selTtrbFltr, setSelTtrbFl] = useState<string | null>(null)
  const [rarityFilter, setSelRrtyFl] = useState<number[]>([4, 5])

  const fltrRsnt = useMemo(() => {
    return resonators.filter((entry) => {
      const mtchWpn =
        selWpnFltr === null || WPNTYPETOKEY[entry.weaponType] === selWpnFltr
      const mtchTtrb =
        selTtrbFltr === null || entry.attribute === selTtrbFltr
      const mtchRrty = rarityFilter.includes(entry.rarity)

      return mtchWpn && mtchTtrb && mtchRrty
    })
  }, [resonators, selTtrbFltr, rarityFilter, selWpnFltr])

  const actFltrCnt =
    Number(selWpnFltr !== null) +
    Number(selTtrbFltr !== null) +
    Number(rarityFilter.length !== 2)

  const summary = (
    <>
      {smmrPrmr ? (
        <div className="picker-modal__summary-pill">
          <span className="picker-modal__summary-label">{smmrPrmr.label}</span>
          <span className="picker-modal__summary-value">{smmrPrmr.value}</span>
        </div>
      ) : null}
      <div className="picker-modal__summary-pill">
        <span className="picker-modal__summary-label">{countLabel}</span>
        <span className="picker-modal__summary-value">
          {fltrRsnt.length} of {resonators.length}
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
    <div className="picker-filter-layout">
      <div className="picker-filter-section">
        <div className="picker-filter-group">
          {[5, 4].map((rarity) => (
            <button
              key={`rarity-${rarity}`}
              type="button"
              className={
                rarityFilter.includes(rarity)
                  ? `picker-filter-chip rarity-${rarity} active`
                  : `picker-filter-chip rarity-${rarity}`
              }
              onClick={() =>
                setSelRrtyFl((prev) =>
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
          {WEAPON_FILTERS.map((weapon) => (
            <button
              key={`weapon-${weapon.key}`}
              type="button"
              className={
                selWpnFltr === weapon.key
                  ? 'picker-filter-icon picker-filter-icon--weapon active'
                  : 'picker-filter-icon picker-filter-icon--weapon'
              }
              title={weapon.label}
              aria-label={weapon.label}
              onClick={() => setSelWpnFlt((prev) => (prev === weapon.key ? null : weapon.key))}
            >
              <img src={`/assets/weapons/${weapon.key}.webp`} alt="" aria-hidden="true" onError={withDefIconM} />
            </button>
          ))}
        </div>
      </div>

      <div className="picker-filter-section">
        <div className="picker-filter-group">
          {ATTR_FILTERS.map((attribute) => (
            <button
              key={`attribute-${attribute}`}
              type="button"
              className={
                selTtrbFltr === attribute
                  ? 'picker-filter-icon picker-filter-icon--attribute active'
                  : 'picker-filter-icon picker-filter-icon--attribute'
              }
              title={toTitle(attribute)}
              aria-label={toTitle(attribute)}
              onClick={() => setSelTtrbFl((prev) => (prev === attribute ? null : attribute))}
            >
              <img
                src={`/assets/attributes/attributes alt/${attribute}.webp`}
                alt=""
                aria-hidden="true"
                style={attribute === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
                onError={withDefIconM}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const rdrdRsnt = useMemo(
    () => orderRecs(
      fltrRsnt,
      rcmmMenuTms,
      lastUsedResI,
      frqnResIds,
      frqnResCnts,
    ),
    [
      fltrRsnt,
      frqnResCnts,
      frqnResIds,
      lastUsedResI,
      rcmmMenuTms,
    ],
  )

  const items = rdrdRsnt.map((entry) => {
    const weaponKey = WPNTYPETOKEY[entry.weaponType]
    const ttrbLbl = toTitle(entry.attribute)
    const weaponLabel = toTitle(weaponKey)
    const isSelected = entry.id === selResId
    const rcmm = rcmmMenuTms
      ? getRecs(
          entry.id,
          lastUsedResI,
          frqnResIds,
          frqnResCnts,
        )
      : []
    const rcmmPill = rcmm.length > 0
      ? (
          <>
            {rcmm.map((rcmmfg) => (
              <span
                key={`${entry.id}-${rcmmfg.kind}`}
                className={`picker-modal__footer-pill picker-modal__footer-pill--recommended picker-modal__footer-pill--${rcmmfg.kind}`}
              >
                {rcmmfg.label}
              </span>
            ))}
          </>
        )
      : null

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
            onError={withDefIconM}
          />
        </div>
      ),
      trailing: isSelected && slctLbl ? (
        <span className="picker-modal__selection-pill">{slctLbl}</span>
      ) : null,
      meta: (
        <>
          <span className={`picker-modal__meta-pill picker-modal__meta-pill--rarity rarity-${entry.rarity}`}>
            {fmtRrtyLbl(entry.rarity)}
          </span>
          <span className="picker-modal__meta-pill">
            <img
              src={`/assets/attributes/attributes alt/${entry.attribute}.webp`}
              alt=""
              aria-hidden="true"
              className="picker-modal__meta-icon"
              style={entry.attribute === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
              onError={withDefIconM}
            />
            {ttrbLbl}
          </span>
          <span className="picker-modal__meta-pill">
            <img
              src={`/assets/weapons/${weaponKey}.webp`}
              alt=""
              aria-hidden="true"
              className="picker-modal__meta-icon picker-modal__meta-icon--weapon"
              onError={withDefIconM}
            />
            {weaponLabel}
          </span>
        </>
      ),
      footer: rcmmPill,
    }
  })

  return (
    <ShrdPckrMdl
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
