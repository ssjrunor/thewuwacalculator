/*
  Author: Runor Ewhro
  Description: Filters resonator menu entries by name, weapon, attribute, and
               picker frequency before returning the selected resonator id.
*/

import {type CSSProperties as CssProps, useMemo, useState} from 'react'
import type { ReactNode } from 'react'
import { Flame, History } from 'lucide-react'
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
import { LiquidSelect, type SelectOption } from '@/shared/ui/LiquidSelect.tsx'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import {
  getRecs,
  orderRecs,
} from '@/modules/calculator/features/resonator/lib/recommendations.ts'
import { ATTR_COLORS, rarityVars } from '@/modules/calculator/model/display.ts'

const ALL_ROLE_ID = '__all_roles__'

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
    value: string | number
  }
  countLabel?: string
  emptyState?: ReactNode
  onSelect: (resonatorId: string) => void
  onClose: () => void
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
  const [selRoleFltr, setSelRoleFl] = useState<string>(ALL_ROLE_ID)
  const [rarityFilter, setSelRrtyFl] = useState<number[]>([4, 5])

  const roleOptions = useMemo<SelectOption<string>[]>(() => {
    const roleMap = new Map<string, SelectOption<string>>()

    for (const entry of resonators) {
      for (const tag of entry.tags ?? []) {
        if (!roleMap.has(tag.id)) {
          roleMap.set(tag.id, {
            value: tag.id,
            label: tag.name,
            icon: `/assets/resonators/tag-icons/${tag.id}.webp`,
          })
        }
      }
    }

    return [
      { value: ALL_ROLE_ID, label: 'All Roles' },
      ...Array.from(roleMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }, [resonators])

  const fltrRsnt = useMemo(() => {
    return resonators.filter((entry) => {
      const mtchWpn =
        selWpnFltr === null || WPNTYPETOKEY[entry.weaponType] === selWpnFltr
      const mtchTtrb =
        selTtrbFltr === null || entry.attribute === selTtrbFltr
      const mtchRole =
        selRoleFltr === ALL_ROLE_ID || Boolean(entry.tags?.some((tag) => tag.id === selRoleFltr))
      const mtchRrty = rarityFilter.includes(entry.rarity)

      return mtchWpn && mtchTtrb && mtchRole && mtchRrty
    })
  }, [resonators, selRoleFltr, selTtrbFltr, rarityFilter, selWpnFltr])

  const actFltrCnt =
    Number(selWpnFltr !== null) +
    Number(selTtrbFltr !== null) +
    Number(selRoleFltr !== ALL_ROLE_ID) +
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

      <div className="picker-filter-divider" aria-hidden="true" />

      <div className="picker-filter-section">
        <div className="picker-filter-group">
          {WEAPON_FILTERS.map((weapon) => (
            <button
              key={`weapon-${weapon.key}`}
              type="button"
              className={
                selWpnFltr === weapon.key
                  ? 'picker-filter-icon picker-filter-icon--theme-contrast active'
                  : 'picker-filter-icon picker-filter-icon--theme-contrast'
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

      <div className="picker-filter-divider" aria-hidden="true" />

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
              style={{ '--picker-modal-accent': ATTR_COLORS[attribute] } as CssProps}
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

      <div className="picker-filter-divider" aria-hidden="true" />

      <div className="picker-filter-section picker-filter-section--role">
        <LiquidSelect
          value={selRoleFltr}
          options={roleOptions}
          onChange={setSelRoleFl}
          className="picker-role-select"
          triggerClass="picker-role-select__trigger"
          ariaLabel="Filter by role"
        />
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
    const isSelected = entry.id === selResId
    const tags = entry.tags ?? []
    const rcmm = rcmmMenuTms
      ? getRecs(
          entry.id,
          lastUsedResI,
          frqnResIds,
          frqnResCnts,
        )
      : []
    const rcmmFrqn = rcmm.find((rcmmfg) => rcmmfg.kind === 'frequent')
    const rcmmLast = rcmm.find((rcmmfg) => rcmmfg.kind === 'last-active')
    const rcmmBadge = rcmm.length > 0
      ? (
          <>
            {rcmmFrqn ? (
              <span className="picker-modal__spec-item" title={rcmmFrqn.label}>
                <Flame size={12} />
                {frqnResCnts[entry.id] ?? 0}
              </span>
            ) : null}
            {rcmmLast ? (
              <span title={rcmmLast.label}>
                <History size={12} />
              </span>
            ) : null}
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
        <div
          className="picker-modal__media-frame picker-modal__media-frame--sprite"
          style={rarityVars(entry.rarity) as CssProps}
        >
          <img
            src={entry.sprite}
            alt={entry.displayName}
            className="picker-modal__media-image"
            onError={withDefIconM}
          />
        </div>
      ),
      trailing: isSelected && slctLbl ? slctLbl : rcmmBadge,
      specClassName: 'picker-modal__card-spec--resonator',
      meta: tags.length > 0 ? (
        <>
          {tags.slice(0, 4).map((tag) => (
            <span
              key={tag.id}
              className="picker-modal__spec-item"
              title={tag.desc ? `${tag.name}: ${tag.desc}` : tag.name}
            >
              <div
                style={{
                  WebkitMaskImage: `url(/assets/resonators/tag-icons/${tag.id}.webp)`,
                  maskImage: `url(/assets/resonators/tag-icons/${tag.id}.webp)`,
                } as CssProps}
                className="picker-modal__tag-icon"
                onError={withDefIconM}
              />
            </span>
          ))}
          {tags.length > 4 ?
            <span
              className="picker-modal__spec-item"
            >
              <span
              >{`+${tags.length - 4}`}</span>
            </span> : null}
        </>
      ) : null,
    }
  })

  return (
    <ShrdPckrMdl
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      variant="resonator"
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
