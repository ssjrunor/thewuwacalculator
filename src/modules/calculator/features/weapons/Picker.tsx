/*
  Author: Runor Ewhro
  Description: Filters weapons by rarity, type, text query, and recommendation
               state before returning a selected weapon id.
*/

import { useMemo, useState } from 'react'
import type { CSSProperties as CssProps } from 'react'
import { ThumbsUp } from 'lucide-react'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import { useAppStore } from '@/domain/state/store.ts'
import {
  WPNSTATLBLS,
  WPN_STAT_CNS,
  fmtWpnStatDs,
  withDefWpnMg,
} from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { PickerModal as ShrdPckrMdl } from '@/shared/ui/PickerModal.tsx'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { rarityVars } from '@/modules/calculator/model/display.ts'
import {FaStar} from "react-icons/fa";

const WPN_STAT_FILTER_ORDER = [
  'critRate',
  'critDmg',
  'atkPercent',
  'energyRegen',
  'defPercent',
  'hpPercent',
  'tuneBreakBoost',
]

function orderRecommendedWeapons(
  weapons: GenWpn[],
  recommendedWeaponIds: string[],
  enabled: boolean,
): GenWpn[] {
  if (!enabled || recommendedWeaponIds.length === 0) {
    return weapons
  }

  const rankById = new Map(recommendedWeaponIds.map((id, index) => [id, index]))

  return weapons
    .map((entry, index) => ({
      entry,
      index,
      rank: rankById.get(entry.id) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank
      }

      return a.index - b.index
    })
    .map(({ entry }) => entry)
}

// exposes the weapon picker dialog that filters the arsenal by rarity.
interface WpnPckrMdlPr {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  weapons: GenWpn[]
  selWpnId?: string | null
  recommendedWeaponIds?: string[]
  onSelect: (weaponId: string) => void
  onClose: () => void
}

export function WeaponPicker({
                               visible,
                               open,
                               closing = false,
                               portalTarget,
                               weapons,
                               selWpnId: selWpnId = null,
                               recommendedWeaponIds = [],
                               onSelect,
                               onClose,
                             }: WpnPckrMdlPr) {
  const rcmmMenuTms = useAppStore((state) => state.ui.preferences.recommendedMenuItems)
  const [rarityFilter, setSelRrtyFl] = useState<number[]>([3, 4, 5])
  const [statFilter, setStatFilter] = useState<string | null>(null)
  const recommendedSet = useMemo(
    () => new Set(recommendedWeaponIds),
    [recommendedWeaponIds],
  )
  const bisWpnId = rcmmMenuTms ? recommendedWeaponIds[0] : undefined

  const statOptions = useMemo(() => {
    const found = new Set(weapons.map((entry) => entry.statKey))
    return WPN_STAT_FILTER_ORDER.filter((key) => found.has(key))
  }, [weapons])

  const effStatFilter = statFilter && statOptions.includes(statFilter) ? statFilter : null

  const fltrWpns = useMemo(() => {
    return weapons.filter((entry) =>
      rarityFilter.includes(entry.rarity) && (effStatFilter === null || entry.statKey === effStatFilter),
    )
  }, [weapons, rarityFilter, effStatFilter])

  const rdrdWpns = useMemo(
    () => orderRecommendedWeapons(fltrWpns, recommendedWeaponIds, rcmmMenuTms),
    [fltrWpns, recommendedWeaponIds, rcmmMenuTms],
  )

  const actFltrCnt = Number(rarityFilter.length !== 3) + Number(effStatFilter !== null)

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
              className={rarityFilter.includes(rarity) ? 'picker-filter-chip active' : 'picker-filter-chip'}
              style={rarityVars(rarity) as CssProps}
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

      {statOptions.length > 0 ? (
        <>
          <div className="picker-filter-divider" aria-hidden="true" />

          <div className="picker-filter-section">
            <div className="picker-filter-group">
              {statOptions.map((statKey) => {
                const label = WPNSTATLBLS[statKey] ?? statKey
                const icon = WPN_STAT_CNS[statKey]
                const selected = effStatFilter === statKey

                return (
                  <button
                    key={`weapon-stat-${statKey}`}
                    type="button"
                    className={selected
                      ? 'picker-filter-icon picker-filter-icon--theme-contrast active'
                      : 'picker-filter-icon picker-filter-icon--theme-contrast'}
                    title={label}
                    aria-label={label}
                    onClick={() => setStatFilter((prev) => (prev === statKey ? null : statKey))}
                  >
                    {icon ? <img src={icon} alt="" aria-hidden="true" onError={withDefIconM} /> : null}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )

  const items = rdrdWpns.map((entry) => {
    const statLabel = WPNSTATLBLS[entry.statKey] ?? entry.statKey
    const statDisplay = fmtWpnStatDs(entry.statKey, entry.statValue)
    const statIcon = WPN_STAT_CNS[entry.statKey]
    const isSelected = entry.id === selWpnId
    const isRecommended = rcmmMenuTms && recommendedSet.has(entry.id)
    const isBis = entry.id === bisWpnId

    return {
      id: entry.id,
      title: entry.name,
      rarity: entry.rarity as 1 | 2 | 3 | 4 | 5,
      selected: isSelected,
      bis: isBis,
      onSelect: () => onSelect(entry.id),
      leading: (
        <div
          className="picker-modal__media-frame picker-modal__media-frame--inset"
          style={rarityVars(entry.rarity) as CssProps}
        >
          <img
            src={entry.icon}
            alt={entry.name}
            className="picker-modal__media-image"
            onError={withDefWpnMg}
          />
        </div>
      ),
      trailing: isBis ?
          <span className="picker-modal__spec-item" title="Best in slot" aria-label="Best in slot weapon">
            <FaStar size={12} />
          </span>
        : isRecommended ? (
          <span className="picker-modal__spec-item" title="Recommended" aria-label="Recommended weapon">
            <ThumbsUp size={12} />
          </span>
      ) : null,
      cornerNote: isSelected ? 'Equipped' : null,
      specClassName: 'picker-modal__card-spec--weapon',
      meta: (
        <>
          <span className="picker-modal__spec-item" title="ATK" aria-label={`ATK ${formatTruncCompact(entry.baseAtk, 1)}`}>
            <img
              src={WPN_STAT_CNS.atk}
              alt=""
              aria-hidden="true"
              className="picker-modal__meta-icon picker-modal__meta-icon--theme-contrast"
            />
            <span aria-hidden="true">{formatTruncCompact(entry.baseAtk, 1)}</span>
          </span>
          <span className="picker-modal__spec-item" title={statLabel} aria-label={`${statLabel} ${statDisplay}`}>
            {statIcon ? (
              <img
                src={statIcon}
                alt=""
                aria-hidden="true"
                className="picker-modal__meta-icon picker-modal__meta-icon--theme-contrast"
              />
            ) : null}
            <span aria-hidden="true">{statDisplay}</span>
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
      variant="weapon"
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
