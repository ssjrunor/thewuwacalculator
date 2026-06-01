/*
  Author: Runor Ewhro
  Description: Renders the picker surface for the calculator weapons flow.
*/

import { useMemo, useState } from 'react'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import {
  WPNSTATLBLS,
  fmtWpnStatDs,
  withDefWpnMg,
} from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { PickerModal as ShrdPckrMdl } from '@/shared/ui/PickerModal.tsx'

// exposes the weapon picker dialog that filters the arsenal by rarity.
interface WpnPckrMdlPr {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  weapons: GenWpn[]
  selWpnId?: string | null
  onSelect: (weaponId: string) => void
  onClose: () => void
}

function fmtRrtyLbl(rarity: number): string {
  return `${rarity}-Star`
}

export function WeaponPicker({
                               visible,
                               open,
                               closing = false,
                               portalTarget,
                               weapons,
                               selWpnId: selWpnId = null,
                               onSelect,
                               onClose,
                             }: WpnPckrMdlPr) {
  const [rarityFilter, setSelRrtyFl] = useState<number[]>([3, 4, 5])

  const fltrWpns = useMemo(() => {
    return weapons.filter((entry) => rarityFilter.includes(entry.rarity))
  }, [weapons, rarityFilter])

  const actFltrCnt = Number(rarityFilter.length !== 3)

  const summary = (
    <>
      <div className="picker-modal__summary-pill">
        <span className="picker-modal__summary-label">Arsenal</span>
        <span className="picker-modal__summary-value">
          {fltrWpns.length} of {weapons.length}
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
          {[5, 4, 3].map((rarity) => (
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
    </div>
  )

  const items = fltrWpns.map((entry) => {
    const statLabel = WPNSTATLBLS[entry.statKey] ?? entry.statKey
    const statDisplay = fmtWpnStatDs(entry.statKey, entry.statValue)
    const isSelected = entry.id === selWpnId

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
            onError={withDefWpnMg}
          />
        </div>
      ),
      trailing: isSelected ? <span className="picker-modal__selection-pill">Equipped</span> : null,
      meta: (
        <>
          <span className={`picker-modal__meta-pill picker-modal__meta-pill--rarity rarity-${entry.rarity}`}>
            {fmtRrtyLbl(entry.rarity)}
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
    <ShrdPckrMdl
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
