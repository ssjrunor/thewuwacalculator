/*
  Author: Runor Ewhro
  Description: Manages saved echo and build inventory browsing, filtering,
               selection actions, equip targets, and persistence commands.
*/

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { AnimationEvent as RctAnmVnt, CSSProperties as CssProps, HTMLAttributes as HtmlAttrs, KeyboardEvent as KybrVnt, MouseEvent as RctMsVnt, ReactNode } from 'react'
import {ArrowBigDownDash as ArrowDownIcon, Clipboard, Copy, Maximize2, Minimize2, Pencil, Scissors, Search, Trash2, X} from 'lucide-react'
import type { InvEchoEnt, InventoryEntry } from '@/domain/entities/inventoryStorage'
import type { EchoInstance, WeaponState } from '@/domain/entities/runtime'
import { areMkSnpsQvl } from '@/domain/entities/inventoryStorage'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { getWpnById } from '@/domain/services/weaponCatalogService'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { getEchoScrPr, getMaxEchoSc } from '@/data/scoring/echoScoring'
import { cmptEchoCrit, getCvBdgClss, getCvToneColor, getScrBdgCls, getScrTone } from '@/modules/calculator/features/echoes/lib/metric.ts'
import { EchoStatGlyph } from '@/modules/calculator/features/echoes/lib/statGlyph.tsx'
import { cmptTtlEchoC } from '@/modules/calculator/features/echoes/lib/echoes.ts'
import {
  getInvSlotFi,
  sortEntsByNa,
  type InvSlotFitSt,
} from '@/modules/calculator/features/inventory/lib/inventory.ts'
import type { InvBldUsr, InvEchoSg } from '@/domain/state/inventoryUsage.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/statsView.ts'
import { toTitle } from '@/shared/lib/format'
import { hideBrknMg, withDefIconM, withDefResMg, withDefWpnMg } from '@/shared/lib/imageFallback'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { mergeRefs } from '@/shared/lib/mergeRefs.ts'
import { useGridColumns } from '@/shared/lib/useGridColumns.ts'
import { AppModal } from '@/shared/ui/AppModal'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton'
import { CnfrMdl } from '@/shared/ui/ConfirmationModal'
import { useCnfr } from '@/app/hooks/useConfirmation.ts'
import { useMediaQuery } from '@/app/hooks/useMediaQuery.ts'
import { useCtxBuilder } from '@/shared/context-menu/useCtxBuilder.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import {
  mkEchoClpbPa,
  readEchoClpb,
  resInvEchoPs,
  writeEchoClp,
} from '@/modules/calculator/features/echoes/lib/clipboard.ts'
import { EchoQpCmprdn } from '@/modules/calculator/features/echoes/lib/EchoEquipComparePreview.tsx'
import { mkSrchTkns, mtchSrchTkns } from '@/modules/calculator/features/echoes/lib/search.ts'
import { AllowedSets } from '@/modules/calculator/features/optimizer/AllowedSets.tsx'
import { useSel } from '@/modules/calculator/lib/sel.tsx'
import { getInvEchoCt } from '@/modules/calculator/features/inventory/lib/ctx.tsx'
import {useAppStore} from "@/domain/state/store.ts";
import { useAppCtxMen } from '@/shared/ui/AppContextMenu'
import { EchoStatPreview } from '@/shared/ui/EchoStatPreview'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { rarityVars } from '@/modules/calculator/model/display.ts'

type InventoryTab = 'echoes' | 'builds'

// presents the saved echo and build inventory overlay for the current resonator.
interface InvMdlPrps {
  visible: boolean
  open: boolean
  closing: boolean
  portalTarget: HTMLElement | null
  resonatorId: string
  currentBuild: {
    weapon: WeaponState
    echoes: Array<EchoInstance | null>
  }
  invChs: InvEchoEnt[]
  invBlds: InventoryEntry[]
  ntlEchoSrch?: string
  bldUsrsById: Record<string, InvBldUsr[]>
  echoSgByUid: Record<string, InvEchoSg[]>
  onClose: () => void
  onQpInvEcho: (entry: InvEchoEnt, slotIndex: number) => void
  onEditEcho: (entry: InvEchoEnt) => void
  onAddInvChs: (echoes: EchoInstance[]) => number
  onSaveInitEchoes: () => void
  onRmvInvEcho: (entryId: string) => void
  onRmvInvChs: (entryIds: string[]) => void
  onClrInvChs: () => void
  onQpInvBld: (entry: InventoryEntry) => void
  onPdtInvBlgk: (entryId: string, name: string) => void
  onRmvInvBld: (entryId: string) => void
  onClrInvBlds: () => void
}

const COST_FILTERS = [1, 3, 4]
const MPTYSLOTFITS: InvSlotFitSt[] = []

function getInvEchoDs(entry: InvEchoEnt) {
  // saved echoes only store ids, so sort/search labels must tolerate catalog entries that no longer exist.
  return getEchoById(entry.echo.id)?.name ?? toTitle(entry.echo.id)
}

function InvEchoEntCa({
  entry,
  resonatorId,
  usage,
  showScore,
  compact,
  index,
  columns,
  slotFitStates: slotFitStates,
  onEquip,
  onEdit,
  onRemove,
  onActivate,
  isRbtlFcsd: isRbtlFcsd = false,
  selected = false,
  isPreview,
  selMode: selectMode = false,
  ...articleProps
}: {
  entry: InvEchoEnt
  compact: boolean
  index: number
  columns: number
  resonatorId: string
  usage: InvEchoSg[]
  showScore: boolean
  slotFitStates: InvSlotFitSt[]
  onEquip: (slotIndex: number) => void
  onEdit: () => void
  onRemove: () => void
  onActivate?: (event: RctMsVnt<HTMLElement> | KybrVnt<HTMLElement>) => void
  isRbtlFcsd?: boolean
  selected?: boolean
  selMode?: boolean
  isPreview?: boolean
} & HtmlAttrs<HTMLElement>) {
  const tileRow = Math.min(Math.floor(index / columns), 6)
  const tileStyle = { '--tile-index': tileRow } as CssProps
  const definition = getEchoById(entry.echo.id)
  const setIcon = getSntSetIco(entry.echo.set)
  const sbstEnts = Object.entries(entry.echo.substats).filter(([, value]) => value > 0)
  const echoScore = showScore ? getEchoScrPr(resonatorId, entry.echo) : null
  const cv = cmptEchoCrit(entry.echo.substats)
  const visibleUsage = usage.filter((equipped) => equipped.icon)
  const [entered, setEntered] = useState(false)

  const cmpcClckHnd = (event: RctMsVnt<HTMLElement>) => {
    if (compact && onActivate) {
      onActivate(event)
    } else {
      onEdit()
    }
  }

  const onTileEntranceEnd = (event: RctAnmVnt<HTMLElement>) => {
    if (event.animationName === 'echoes-section-in') {
      setEntered(true)
    }
  }

  const onTileKeyDow = (event: KybrVnt<HTMLDivElement>) => {
    // keyboard activation only belongs to the tile shell; child buttons handle their own enter/space events.
    if (selectMode || event.currentTarget !== event.target) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (compact && onActivate) {
        onActivate(event)
      } else {
        onEdit()
      }
    }
  }

  if (!definition) {
    return null
  }

  if (compact) return (
      <article
          {...articleProps}
          className={`overview-echo-tile echo-bag-card__compact${selected ? ' focus-selected' : ''}${selectMode ? ' selection-mode' : ''}${isRbtlFcsd ? ' is-orbital-focused' : ''}${entered ? ' echo-tile-entered' : ''}`}
          style={tileStyle}
          data-preview={isPreview}
          data-selection-focus-item="true"
          role="button"
          tabIndex={0}
          onClick={cmpcClckHnd}
          onKeyDown={onTileKeyDow}
          onAnimationEnd={onTileEntranceEnd}
          aria-label={isRbtlFcsd ? `Quick actions for ${definition.name}` : `Open actions for ${definition.name}`}
      >
        <span className="echo-tile-bracket echo-tile-bracket--tl" aria-hidden="true" />
        <span className="echo-tile-bracket echo-tile-bracket--br" aria-hidden="true" />

        <div className="compact__echo-portrait">
          <img
              src={definition.icon}
              alt={definition.name}
              className="overview-echo-glyph"
              loading="lazy"
              decoding="async"
              onError={hideBrknMg}
          />
        </div>

        <div className="echo-card__compact-bottom">
          <div className="echo-card__compact-bottom__section echo-card__compact-bottom__section--set">
            {setIcon ? (
                <img
                    src={setIcon}
                    alt={getSntSetNam(entry.echo.set)}
                    className="overview-echo-set-icon"
                    loading="lazy"
                    decoding="async"
                    onError={withDefIconM}
                />
            ) : null}
          </div>

          <span aria-hidden="true" />

          <div className="echo-card__compact-bottom__section echo-card__compact-bottom__section--cost cost-chip">
            <span className="cost-bar" aria-hidden="true" />
            <span className="cost-num">0{definition.cost}</span>
          </div>
        </div>
      </article>
  );

  return (
    <article
      {...articleProps}
      className={`overview-echo-tile echo-bag-card__tile${selected ? ' focus-selected' : ''}${selectMode ? ' selection-mode' : ''}${entered ? ' echo-tile-entered' : ''}`}
      style={tileStyle}
      data-selection-focus-item="true"
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={onTileKeyDow}
      onAnimationEnd={onTileEntranceEnd}
      aria-label={`Edit ${definition.name}`}
    >
        <span className="echo-tile-bracket echo-tile-bracket--tl" aria-hidden="true" />
        <span className="echo-tile-bracket echo-tile-bracket--br" aria-hidden="true" />
        <div className="echo-tile-head">
          <span className="echo-tile-frame">
            <img
              src={definition.icon}
              alt={definition.name}
              className="overview-echo-glyph"
              loading="lazy"
              decoding="async"
              onError={hideBrknMg}
            />
            {setIcon ? (
              <img
                src={setIcon}
                alt={getSntSetNam(entry.echo.set)}
                className="overview-echo-set-icon"
                loading="lazy"
                onError={withDefIconM}
              />
            ) : null}
          </span>

          <div className="echo-tile-titles">
            <strong className="echo-tile-name">{definition.name ?? toTitle(entry.echo.id)}</strong>
            <div className="echo-tile-tags">
              <div className="cost-chip echo-tile-cost">
                <span className="cost-num">{definition.cost}c</span>
              </div>
              {cv > 0 ? (
                <span className="echo-tile-cv" style={{ '--cv-tone': getCvToneColor(cv) } as CssProps}>
                  CV {formatTruncCompact(cv, 1)}
                </span>
              ) : null}
              {echoScore !== null ? (
                <span className="echo-tile-score" data-tone={getScrTone(echoScore)}>
                  {formatTruncCompact(echoScore, 0)}%
                </span>
              ) : null}

            </div>
          </div>

          <button
            type="button"
            className="echo-slot-remove echo-bag-card__remove"
            title="Remove echo"
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
          >
            <X size={14} />
          </button>
        </div>

        <ul className="echo-tile-stats">
          <li className="echo-tile-row echo-tile-row--primary">
            <EchoStatGlyph statKey={entry.echo.mainStats.primary.key} size={0.66} />
            <span className="echo-tile-row-k">{formatStatKeyLabel(entry.echo.mainStats.primary.key)}</span>
            <span className="echo-tile-row-v">{formatStatKeyValue(entry.echo.mainStats.primary.key, entry.echo.mainStats.primary.value)}</span>
          </li>
          <li className="echo-tile-row echo-tile-row--secondary">
            <EchoStatGlyph statKey={entry.echo.mainStats.secondary.key} size={0.6} />
            <span className="echo-tile-row-k">{formatStatKeyLabel(entry.echo.mainStats.secondary.key)}</span>
            <span className="echo-tile-row-v">{formatStatKeyValue(entry.echo.mainStats.secondary.key, entry.echo.mainStats.secondary.value)}</span>
          </li>
          {sbstEnts.map(([key, value]) => (
            <li key={key} className="echo-tile-row echo-tile-row--sub">
              <EchoStatGlyph statKey={key} size={0.6} />
              <span className="echo-tile-row-k">{formatStatKeyLabel(key)}</span>
              <span className="echo-tile-row-v">{formatStatKeyValue(key, value)}</span>
            </li>
          ))}
          {sbstEnts.length === 0 ? (
            <li className="echo-tile-row echo-tile-row--empty">No tuned substats</li>
          ) : null}
        </ul>

        <div className="overview-echo-tile-foot echo-bag-card__equip-row">
          <div className="echo-bag-card__slot-actions">
            {slotFitStates.map((fitState, index) => (
              <button
                key={`${entry.id}-${index}`}
                type="button"
                className={`echo-bag-card__slot-button${fitState.selected ? ' is-selected' : ''}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onEquip(index)
                }}
                disabled={!fitState.fits}
                title={fitState.fits ? `Equip into slot ${index + 1}` : 'Does not fit within the 12 cost cap'}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>
        {visibleUsage.length > 0 ? (
          <div className="preset-equipped echo-bag-card__equipped">
            {visibleUsage.map((equipped) => (
              <img
                key={`${entry.id}-${equipped.resonatorId}-${equipped.slotIndex}`}
                src={equipped.icon}
                alt={`${equipped.resName} equipped`}
                title={`${equipped.resName} slot ${equipped.slotIndex + 1}`}
                className={`header-icon overview preset ${equipped.rarity === 5 ? 'five' : 'four'} echo-bag-card__equipped-icon`}
                loading="lazy"
                onError={withDefResMg}
              />
            ))}
          </div>
        ) : null}
    </article>
  )
}

// renders the wide-screen "currently selected echo" readout beside the compact bag grid.
function EchoBagRdt({
  entry,
  resonatorId,
  showScore,
  usage,
  slotFitStates,
  onEquip,
  onEdit,
  onRemove,
}: {
  entry: InvEchoEnt
  resonatorId: string
  showScore: boolean
  usage: InvEchoSg[]
  slotFitStates: InvSlotFitSt[]
  onEquip: (slotIndex: number) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const definition = getEchoById(entry.echo.id)
  if (!definition) {
    return null
  }

  const setIcon = getSntSetIco(entry.echo.set)
  const sbstEnts = Object.entries(entry.echo.substats).filter(([, value]) => Number.isFinite(value) && value !== 0)
  const echoScore = showScore ? getEchoScrPr(resonatorId, entry.echo) : null
  const cv = cmptEchoCrit(entry.echo.substats)
  const visibleUsage = usage.filter((equipped) => equipped.icon)

  return (
    <div className="echo-rdt">
      <div className="echo-rdt__plate">
        <img
          src={definition.icon}
          alt=""
          className="echo-rdt__art"
          loading="lazy"
          decoding="async"
          onError={hideBrknMg}
        />
        <div className="echo-rdt__scrim" aria-hidden="true" />
        {setIcon ? (
          <span className="echo-rdt__set-badge" title={getSntSetNam(entry.echo.set)}>
            <img src={setIcon} alt={getSntSetNam(entry.echo.set)} onError={withDefIconM} />
          </span>
        ) : null}
        <div className="echo-rdt__title">
          <div className="echo-rdt__title-row">
            <h3 className="echo-rdt__name">{definition.name}</h3>
            <span className="echo-rdt__cost">
              <span className="echo-rdt__cost-num">{definition.cost}</span>
              <span className="echo-rdt__cost-unit">cost</span>
            </span>
          </div>
        </div>
        <div className="echo-rdt__plate-actions">
          <button
            type="button"
            className="echo-rdt__plate-btn"
            title="Edit echo"
            onClick={onEdit}
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            className="echo-rdt__plate-btn echo-rdt__plate-btn--danger"
            title="Remove echo"
            onClick={onRemove}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="echo-rdt__body">
        {echoScore !== null || cv > 0 ? (
          <div className="echo-rdt__grade">
            {echoScore !== null ? (
              <div className="echo-rdt__grade-block">
                <span className="echo-rdt__grade-cap">Score</span>
                <span className={`echo-rdt__grade-num ${getScrBdgCls(echoScore)}`}>
                  {formatTruncCompact(echoScore, 1)}<small>%</small>
                </span>
              </div>
            ) : null}
            {cv > 0 ? (
              <div className="echo-rdt__grade-block">
                <span className="echo-rdt__grade-cap">CV</span>
                <span className={`echo-rdt__grade-num ${getCvBdgClss(cv)}`}>{formatTruncCompact(cv, 1)}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="echo-rdt__spec">
          <div className="echo-rdt__stat">
            <span className="echo-rdt__stat-label">{formatStatKeyLabel(entry.echo.mainStats.primary.key)}</span>
            <span className="echo-rdt__stat-value">
              {formatStatKeyValue(entry.echo.mainStats.primary.key, entry.echo.mainStats.primary.value)}
            </span>
          </div>
          <div className="echo-rdt__stat">
            <span className="echo-rdt__stat-label">{formatStatKeyLabel(entry.echo.mainStats.secondary.key)}</span>
            <span className="echo-rdt__stat-value">
              {formatStatKeyValue(entry.echo.mainStats.secondary.key, entry.echo.mainStats.secondary.value)}
            </span>
          </div>
        </div>

        {sbstEnts.length > 0 ? (
          <div className="echo-rdt__ledger">
            {sbstEnts.map(([key, value]) => (
              <div key={key} className="echo-rdt__ledger-row">
                <span>{formatStatKeyLabel(key)}</span>
                <b>{formatStatKeyValue(key, value)}</b>
              </div>
            ))}
          </div>
        ) : null}

        {definition.skillDesc ? (
          <div className="echo-rdt__note echo-rdt__note--skill">
            <span className="echo-rdt__note-tag">Skill</span>
            <RichDscr description={definition.skillDesc} className="echo-rdt__prose" unstyled />
          </div>
        ) : null}

        {visibleUsage.length > 0 ? (
          <div className="echo-rdt__note echo-rdt__note--equip">
            <span className="echo-rdt__note-tag">Equipped</span>
            <div className="echo-rdt__usage">
              {visibleUsage.map((equipped) => (
                <img
                  key={`${entry.id}-${equipped.resonatorId}-${equipped.slotIndex}`}
                  src={equipped.icon}
                  alt={`${equipped.resName} equipped`}
                  title={`${equipped.resName} slot ${equipped.slotIndex + 1}`}
                  className={`echo-rdt__usage-icon ${equipped.rarity === 5 ? 'five' : 'four'}`}
                  loading="lazy"
                  onError={withDefResMg}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="echo-rdt__actions">
        <span className="echo-rdt__actions-label">Equip Slot</span>
        <div className="echo-rdt__slots">
          {slotFitStates.map((fitState, index) => (
            <button
              key={index}
              type="button"
              className={`echo-rdt__slot${fitState.selected ? ' is-selected' : ''}`}
              onClick={() => onEquip(index)}
              disabled={!fitState.fits}
              title={fitState.fits ? `Equip into slot ${index + 1}` : 'Does not fit within the 12 cost cap'}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function SvdMkCard({
  entry,
  currentBuild,
  usage,
  editing,
  editingName,
  onStrtRnm: onStrtRnm,
  onNameChange,
  onCmmtRnm: onCmmtRnm,
  onCnclRnm: onCnclRnm,
  onEquip,
  onRemove,
  style,
  ...articleProps
}: {
  entry: InventoryEntry
  currentBuild: {
    weapon: WeaponState
    echoes: Array<EchoInstance | null>
  }
  usage: InvBldUsr[]
  editing: boolean
  editingName: string
  onStrtRnm: () => void
  onNameChange: (value: string) => void
  onCmmtRnm: () => void
  onCnclRnm: () => void
  onEquip: () => void
  onRemove: () => void
} & HtmlAttrs<HTMLElement>) {
  const mtchCur = areMkSnpsQvl(entry.build, currentBuild)
  // saved builds can come from another resonator, so definitions are resolved from the entry instead of the currently
  // open modal resonator.
  const resonatorDef = getResSeedBy(entry.resonatorId)
  const weaponDef = entry.build.weapon.id ? getWpnById(entry.build.weapon.id) : null
  const visibleUsage = usage.filter((user) => user.icon)

  return (
    <article
      {...articleProps}
      className="echo-preset-card"
      style={style}
    >
      <span className="echo-tile-bracket echo-tile-bracket--tl" aria-hidden="true" />
      <span className="echo-tile-bracket echo-tile-bracket--br" aria-hidden="true" />
      <div className="echo-preset-card__head">
        {resonatorDef?.profile ? (
          <img
            src={resonatorDef.profile}
            alt={entry.resonatorName}
            className="echo-preset-card__resonator-icon"
            loading="lazy"
            onError={withDefResMg}
          />
        ) : (
          <div className="echo-preset-card__resonator-icon echo-preset-card__resonator-icon--empty" />
        )}
        <div className="echo-preset-card__copy">
          {editing ? (
            <input
              className="echo-preset-card__name-input"
              value={editingName}
              onChange={(event) => onNameChange(event.target.value)}
              onBlur={onCmmtRnm}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onCmmtRnm()
                }
                if (event.key === 'Escape') {
                  onCnclRnm()
                }
              }}
              autoFocus
            />
          ) : (
            <div className="echo-preset-card__title-row">
              <span className="echo-preset-card__title">{entry.name}</span>
              {mtchCur ? <span className="echo-preset-card__match">Live</span> : null}
            </div>
          )}
        </div>

        <div className="echo-preset-card__actions">
          <button
            type="button"
            className="echo-bag-card__icon-button"
            onClick={onEquip}
            title="Equip build"
          >
            <ArrowDownIcon size={15} />
          </button>
          <button
            type="button"
            className="echo-bag-card__icon-button"
            onClick={onStrtRnm}
            title="Rename build"
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            className="echo-bag-card__icon-button danger"
            onClick={onRemove}
            title="Delete build"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="echo-preset-card__body">
        <div
          className="echo-preset-card__weapon"
          style={weaponDef ? rarityVars(weaponDef.rarity) as CssProps : undefined}
        >
          {weaponDef ? (
            <>
              <img
                src={weaponDef.icon}
                alt={weaponDef.name}
                className="echo-preset-card__weapon-icon"
                loading="lazy"
                onError={withDefWpnMg}
              />
              <span className="echo-preset-card__weapon-rank">R{entry.build.weapon.rank}</span>
            </>
          ) : (
            <span className="echo-preset-card__weapon-empty">NO WPN</span>
          )}
        </div>
        --
        <div className="echo-preset-card__grid">
          {entry.build.echoes.map((echo, slotIndex) => {
            const definition = echo ? getEchoById(echo.id) : null
            const setIcon = echo ? getSntSetIco(echo.set) : null

            return (
              <div key={`${entry.id}-${slotIndex}`} className={`echo-preset-card__slot${echo ? '' : ' empty'}`}>
                {definition ? (
                  <>
                    {setIcon ? (
                      <img
                        src={setIcon}
                        alt={getSntSetNam(echo?.set ?? 0)}
                        className="echo-preset-card__slot-set"
                        loading="lazy"
                        onError={withDefIconM}
                      />
                    ) : null}
                    <img
                      src={definition.icon}
                      alt={definition.name}
                      className="echo-preset-card__slot-icon"
                      loading="lazy"
                      onError={hideBrknMg}
                    />
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      {visibleUsage.length > 0 ? (
        <div className="preset-equipped echo-preset-card__usage">
          {visibleUsage.map((user) => (
            <img
              key={`${entry.id}-${user.resonatorId}`}
              src={user.icon}
              alt={`${user.resName} equipped`}
              title={user.resName}
              className={`echo-preset-card__usage-icon ${user.rarity === 5 ? 'five' : 'four'}`}
              loading="lazy"
              onError={withDefResMg}
            />
          ))}
        </div>
      ) : null}
    </article>
  )
}

function fmtInvPstTst(addedCount: number, skippedCount: number): string {
  // paste reports duplicates explicitly because clipboard payloads can contain multiple echoes from a bulk copy.
  if (addedCount === 0) {
    return skippedCount > 0 ? 'All pasted echoes were already saved.' : 'Clipboard does not contain an echo.'
  }

  return skippedCount > 0
    ? `Added ${addedCount} echo${addedCount === 1 ? '' : 'es'} (${skippedCount} duplicate${skippedCount === 1 ? '' : 's'} skipped).`
    : `Added ${addedCount} echo${addedCount === 1 ? '' : 'es'}.`
}

export function InvMdl({
  visible,
  open,
  closing,
  portalTarget,
  resonatorId,
  currentBuild,
  invChs: invChs,
  invBlds: invBlds,
  ntlEchoSrch: initEchoSrch = '',
  bldUsrsById: bldUsrsById,
  echoSgByUid: echoSgByUid,
  onClose,
  onQpInvEcho: onQpInvEcho,
  onEditEcho: onEditInvEch,
  onAddInvChs: onAddInvChs,
  onSaveInitEchoes,
  onRmvInvEcho: onRmvInvEcho,
  onRmvInvChs: onRmvInvChs,
  onClrInvChs: onClrInvChs,
  onQpInvBld: onQpInvBld,
  onPdtInvBlgk: onPdtInvBldN,
  onRmvInvBld: onRmvInvBld,
  onClrInvBlds: onClrInvBlds,
}: InvMdlPrps) {
  const prssCmpcInv = useAppStore((state) => state.ui.compactInv)
  const setPrssCmpcI = useAppStore((state) => state.setCmpInv)

  const [compact, setCmpcInv] = useState(prssCmpcInv)
  const [gridSwtc, setGridSwtc] = useState(false)
  const cmpcTglTmrRe = useRef<number | null>(null)
  const compactRef = useRef(compact)
  useEffect(() => {
    compactRef.current = compact
  }, [compact])
  useEffect(() => () => {
    // defer persistence until unmount so rapid compact/full toggles do not spam the app store while the animation is
    // still in progress.
    const latest = useAppStore.getState().ui.compactInv
    if (compactRef.current !== latest) {
      setPrssCmpcI(compactRef.current)
    }
  }, [setPrssCmpcI])

  const titleId = useId()
  const dscrId = useId()
  const menu = useCtxBuilder()
  const showToast = useTstStr((state) => state.show)
  const [activeTab, setActiveTab] = useState<InventoryTab>('echoes')
  const railVisible = useMediaQuery('(min-width: 64rem)')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [echoSearch, setEchoSrch] = useState(initEchoSrch)
  const [buildSearch, setBldSrch] = useState('')
  const echoSearchTokens = useMemo(() => mkSrchTkns(echoSearch), [echoSearch])
  const buildSearchTokens = useMemo(() => mkSrchTkns(buildSearch), [buildSearch])
  const [selectedSet, setSelSet] = useState<number | null>(null)
  const [selectedCost, setSelCost] = useState<number | null>(null)
  const [dtngBldId, setDtngBldId] = useState<string | null>(null)
  const [dtngBldName, setDtngBldNa] = useState('')
  const confirmation = useCnfr()
  const exitSelModeR = useRef<() => void>(() => {})
  const resName = useMemo(() => getResSeedBy(resonatorId)?.name ?? resonatorId, [resonatorId])

  const clrCmpcTglTm = useCallback(() => {
    if (cmpcTglTmrRe.current !== null) {
      window.clearTimeout(cmpcTglTmrRe.current)
      cmpcTglTmrRe.current = null
    }
  }, [])

  useEffect(() => () => {
    clrCmpcTglTm()
  }, [clrCmpcTglTm])

  const [fcsdTileId, setFcsdTileI] = useState<string | null>(null)
  const modalBodyRef = useRef<HTMLDivElement | null>(null)
  const [echoGridRef, echoGridCols] = useGridColumns()
  const [buildsGridRef, buildsGridCols] = useGridColumns()
  const contextMenu = useAppCtxMen()

  const onCmpcTgl = useCallback(() => {
    if (gridSwtc) {
      return
    }

    setFcsdTileI(null)
    clrCmpcTglTm()
    setGridSwtc(true)
    cmpcTglTmrRe.current = window.setTimeout(() => {
      setCmpcInv((current) => !current)
      cmpcTglTmrRe.current = null
      window.requestAnimationFrame(() => {
        setGridSwtc(false)
      })
    }, 110)
  }, [clrCmpcTglTm, gridSwtc])

  const filteredBag = useMemo(() => {
    // search includes ids and uids so imported echoes remain findable even when duplicate names or generated ids are
    // the only clue the user has. equipped resonator names/ids are included so searching a resonator narrows to
    // echoes currently equipped by that resonator.
    return sortEntsByNa(invChs, getInvEchoDs).filter((entry) => {
      const definition = getEchoById(entry.echo.id)
      if (!definition) {
        return false
      }

      const usage = entry.echo.uid ? echoSgByUid[entry.echo.uid] ?? [] : []
      const mtchSrch = mtchSrchTkns(echoSearchTokens, [
        definition.name,
        entry.echo.id,
        entry.echo.uid,
        entry.id,
        ...usage.flatMap((equipped) => [equipped.resName, equipped.resonatorId]),
      ])
      const matchesSet = selectedSet == null || entry.echo.set === selectedSet
      const matchesCost = selectedCost == null || definition.cost === selectedCost
      return mtchSrch && matchesSet && matchesCost
    })
  }, [echoSearchTokens, echoSgByUid, invChs, selectedCost, selectedSet])
  const previewEntry = useMemo(
    () => filteredBag.find((entry) => entry.id === previewId) ?? filteredBag[0] ?? null,
    [filteredBag, previewId],
  )
  const fltrBlds = useMemo(() => {
    return sortEntsByNa(invBlds, (entry) => entry.name).filter((entry) => {
      return mtchSrchTkns(buildSearchTokens, [entry.name, entry.resonatorName, entry.resonatorId])
    })
  }, [buildSearchTokens, invBlds])
  const actEchoFltrC =
    (selectedCost !== null ? 1 : 0) +
    (selectedSet !== null ? 1 : 0) +
    (echoSearchTokens.length > 0 ? 1 : 0)
  const actMkFltrCnt = buildSearchTokens.length > 0 ? 1 : 0
  const actCollCnt = activeTab === 'echoes' ? filteredBag.length : fltrBlds.length
  const ttlCollCnt = activeTab === 'echoes' ? invChs.length : invBlds.length
  const actFltrCnt = activeTab === 'echoes' ? actEchoFltrC : actMkFltrCnt
  const invSetFilterIds = useMemo(
    () => Array.from(new Set(invChs.map((entry) => entry.echo.set))).sort((left, right) => left - right),
    [invChs],
  )

  const hasEchoScrWg = useMemo(() => getMaxEchoSc(resonatorId) > 0, [resonatorId])
  const clrDsbl = activeTab === 'echoes' ? invChs.length === 0 : invBlds.length === 0
  const curMkTtlCost = useMemo(() => cmptTtlEchoC(currentBuild.echoes), [currentBuild.echoes])
  const curMkSlotCst = useMemo(
    () => currentBuild.echoes.map((echo) => (echo ? (getEchoById(echo.id)?.cost ?? 0) : 0)),
    [currentBuild.echoes],
  )
  const mkInvSlotFit = useCallback((echo: EchoInstance) => Array.from(
    // fit state is computed per target slot against the live build cost, so the card can disable only the slots that
    // would break the 12-cost cap.
    { length: 5 },
    (_, index) => getInvSlotFi(
      currentBuild.echoes,
      curMkTtlCost,
      curMkSlotCst,
      echo,
      index,
    ),
  ), [currentBuild.echoes, curMkSlotCst, curMkTtlCost])
  const copyChsToClp = useCallback(async (echoes: EchoInstance[]) => {
    if (echoes.length === 0) {
      showToast({
        content: 'Nothing to copy yet.',
        variant: 'warning',
        duration: 2600,
      })
      return false
    }

    // clipboard payloads keep source metadata for future import flows while the paste resolver only needs echoes.
    const wrote = await writeEchoClp(mkEchoClpbPa({
      source: 'inventory',
      resonatorId,
      resName: resName,
      echoes,
    }))

    if (!wrote) {
      showToast({
        content: 'Clipboard write failed.',
        variant: 'error',
        duration: 3000,
      })
      return false
    }

    return true
  }, [resonatorId, resName, showToast])

  const pstClpbIntoI = useCallback(async () => {
    const payload = await readEchoClpb()
    if (!payload) {
      showToast({
        content: 'Clipboard does not contain an echo.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    // the resolver filters duplicates against saved echo uids before the parent store is asked to add anything.
    const result = resInvEchoPs(invChs.map((entry) => entry.echo), payload)
    if (result.addedCount === 0) {
      showToast({
        content: fmtInvPstTst(result.addedCount, result.skippedCount),
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    const addedCount = onAddInvChs(result.echoesToAdd)
    showToast({
      content: fmtInvPstTst(addedCount, payload.echoes.length - addedCount),
      variant: 'success',
      duration: 2600,
    })
  }, [invChs, onAddInvChs, showToast])

  const fltrBagIds = useMemo(
    () => filteredBag.map((entry) => entry.id),
    [filteredBag],
  )

  useEffect(() => {
    // when filters hide the focused compact tile, clear orbital focus so the floating actions cannot point at an
    // element that no longer exists.
    if (fcsdTileId && !fltrBagIds.includes(fcsdTileId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFcsdTileI(null)
    }
  }, [fltrBagIds, fcsdTileId])
  const fltrBagSelTm = useMemo(
    () => filteredBag.map((entry) => ({
      id: entry.id,
      val: entry,
    })),
    [filteredBag],
  )
  const selCtns = useMemo(() => [
    {
      id: 'inv:copy',
      key: 'copy' as const,
      needsSel: true,
      icon: <Copy size={14} />,
      label: ({ count }: { count: number }) => `Copy (${count})`,
      title: 'Copy selected echoes (Ctrl/Cmd+C)',
      run: async ({ vals }: { vals: InvEchoEnt[] }) => {
        const wrote = await copyChsToClp(vals.map((entry) => entry.echo))
        if (wrote) {
          showToast({
            content: `Copied ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
            variant: 'success',
            duration: 2200,
          })
        }
      },
    },
    {
      id: 'inv:cut',
      key: 'cut' as const,
      needsSel: true,
      icon: <Scissors size={14} />,
      label: ({ count }: { count: number }) => `Cut (${count})`,
      title: 'Cut selected echoes (Ctrl/Cmd+X)',
      run: ({ count, ids, vals }: { count: number; ids: string[]; vals: InvEchoEnt[] }) => {
        confirmation.confirm({
          title: 'You sure about that? ( · ❛ ֊ ❛)',
          message: `Cut ${count} selected echo${count === 1 ? '' : 'es'} from your inventory?`,
          confirmLabel: 'Cut Selected',
          variant: 'danger',
          onConfirm: () => {
            void (async () => {
              const wrote = await copyChsToClp(vals.map((entry) => entry.echo))
              if (!wrote) {
                return
              }

              onRmvInvChs(ids)
              exitSelModeR.current()
              showToast({
                content: `Cut ${count} echo${count === 1 ? '' : 'es'}.`,
                variant: 'success',
                duration: 2200,
              })
            })()
          },
        })
      },
    },
    {
      id: 'inv:paste',
      key: 'paste' as const,
      icon: <Clipboard size={14} />,
      label: 'Paste',
      title: 'Paste echoes into inventory (Ctrl/Cmd+V)',
      float: false,
      run: async () => {
        await pstClpbIntoI()
      },
    },
    {
      id: 'inv:del',
      key: 'delete' as const,
      needsSel: true,
      danger: true,
      icon: <Trash2 size={14} />,
      label: ({ count }: { count: number }) => `Remove (${count})`,
      title: 'Remove selected echoes (Delete / Backspace)',
      run: ({ count, ids }: { count: number; ids: string[] }) => {
        confirmation.confirm({
          title: 'You sure about that? ( · ❛ ֊ ❛)',
          message: count === 1
            ? 'Remove 1 selected echo from your inventory?'
            : `Remove ${count} selected echoes from your inventory?`,
          confirmLabel: 'Remove Selected',
          variant: 'danger',
          onConfirm: () => {
            onRmvInvChs(ids)
            exitSelModeR.current()
          },
        })
      },
    },
  ], [confirmation, copyChsToClp, onRmvInvChs, pstClpbIntoI, showToast])
  const echoSel = useSel({
    active: activeTab === 'echoes',
    surfaceId: 'inv-echoes',
    ariaLabel: 'Inventory echo selection actions',
    items: fltrBagSelTm,
    ord: fltrBagIds,
    acts: selCtns,
  })
  const selMode = echoSel.selectionMode
  const ffctSelEchoE = echoSel.selectedIdSet

  const exitSelMode = echoSel.exitSelectionMode

  useEffect(() => {
    exitSelModeR.current = exitSelMode
  }, [exitSelMode])

  const switchToTab = useCallback((nextTab: InventoryTab) => {
    if (nextTab !== 'echoes') {
      exitSelMode()
    }

    setActiveTab(nextTab)
    setFcsdTileI(null)
  }, [exitSelMode])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!visible) setFcsdTileI(null)
  }, [visible])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selMode) setFcsdTileI(null)
  }, [selMode])

  const copyInvEcho = useCallback(async (entry: InvEchoEnt) => {
    const wrote = await copyChsToClp([entry.echo])
    if (wrote) {
      showToast({
        content: 'Copied 1 echo.',
        variant: 'success',
        duration: 2200,
      })
    }
  }, [copyChsToClp, showToast])

  const cutInvEcho = useCallback(async (entry: InvEchoEnt) => {
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: `Cut "${getEchoById(entry.echo.id)?.name ?? 'echo'}" from your inventory?`,
      confirmLabel: 'Cut',
      variant: 'danger',
      onConfirm: () => {
        void (async () => {
          const wrote = await copyChsToClp([entry.echo])
          if (!wrote) {
            return
          }

          onRmvInvChs([entry.id])
          showToast({
            content: 'Cut 1 echo.',
            variant: 'success',
            duration: 2200,
          })
        })()
      },
    })
  }, [confirmation, copyChsToClp, onRmvInvChs, showToast])

  const mkInvEchoCtx = useCallback((entry: InvEchoEnt, slotFitStates: InvSlotFitSt[]) => {
    return getInvEchoCt({
      menu: menu.calculator.echo,
      entry,
      previewNode: (
        <EchoStatPreview echo={entry.echo} resonatorId={resonatorId} />
      ),
      fits: slotFitStates.map((fitState, index) => ({
        fits: fitState.fits,
        selected: fitState.selected,
        preview: (
          <EchoQpCmprdn
            currentEcho={currentBuild.echoes[index] ?? null}
            nextEcho={entry.echo}
          />
        ),
      })),
      onEquip: (slotIndex) => onQpInvEcho(entry, slotIndex),
      onEdit: () => onEditInvEch(entry),
      onRemove: () => confirmation.confirm({
        title: 'You sure about that? ( · ❛ ֊ ❛)',
        message: `Remove "${getEchoById(entry.echo.id)?.name ?? 'echo'}" from your inventory?`,
        confirmLabel: 'Remove',
        variant: 'danger',
        onConfirm: () => onRmvInvEcho(entry.id),
      }),
      onCopy: () => {
        void copyInvEcho(entry)
      },
      onCut: () => {
        void cutInvEcho(entry)
      },
      onPaste: () => {
        void pstClpbIntoI()
      },
      onSel: () => echoSel.addToSelection(entry.id),
    })
  }, [
    confirmation,
    copyInvEcho,
    currentBuild.echoes,
    cutInvEcho,
    echoSel,
    menu.calculator.echo,
    onEditInvEch,
    onQpInvEcho,
    onRmvInvEcho,
    pstClpbIntoI,
    resonatorId,
  ])

  const openTileMenu = useCallback((entry: InvEchoEnt, slotFitStates: InvSlotFitSt[], event: RctMsVnt<HTMLElement> | KybrVnt<HTMLElement>) => {
    if (selMode || gridSwtc) return
    const definition = getEchoById(entry.echo.id)
    setFcsdTileI(entry.id)
    const isKeyboard = !('clientX' in event)
    const pstnVnt = isKeyboard
      ? (() => {
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
          const cx = rect.right
          const cy = rect.top + rect.height / 2
          return {
            clientX: cx,
            clientY: cy,
            target: event.target,
            preventDefault: () => event.preventDefault(),
            stopPropagation: () => event.stopPropagation(),
          }
        })()
      : event
    const items = mkInvEchoCtx(entry, slotFitStates).filter((item) => {
      if (item.type === 'separator') return false
      if (item.id.endsWith(':paste')) return false
      return true
    })
    const opened = contextMenu.open(pstnVnt, {
      ariaLabel: `${definition?.name ?? 'Echo'} actions`,
      items,
      omitGlblTms: true,
      force: true,
      onClose: () => setFcsdTileI(null),
    })
    if (!opened) {
      setFcsdTileI(null)
    }
  }, [selMode, gridSwtc, contextMenu, mkInvEchoCtx])

  const startRnmMk = useCallback((entry: InventoryEntry) => {
    setDtngBldId(entry.id)
    setDtngBldNa(entry.name)
  }, [])

  const cnfrRmMk = useCallback((entry: InventoryEntry) => {
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: `Delete "${entry.name}" from your saved builds?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => onRmvInvBld(entry.id),
    })
  }, [confirmation, onRmvInvBld])

  const mkInvMkCtxMe = useCallback((entry: InventoryEntry) => {
    return menu.calculator.echo.invBld({
      entryId: entry.id,
      onEquip: () => onQpInvBld(entry),
      onRename: () => startRnmMk(entry),
      onRemove: () => cnfrRmMk(entry),
    })
  }, [
    cnfrRmMk,
    menu.calculator.echo,
    onQpInvBld,
    startRnmMk,
  ])

  const tabFilters = (extraControls?: ReactNode) => (
    <div className="picker-filter-layout echo-filter-row echo-bag-modal__toolbar-row">
      <div className="picker-filter-tabswitch echo-bag-modal__tab-group">
        <button
          type="button"
          className={activeTab === 'echoes' ? 'picker-filter-chip active' : 'picker-filter-chip'}
          onClick={() => switchToTab('echoes')}
        >
          Echoes
        </button>
        <button
          type="button"
          className={activeTab === 'builds' ? 'picker-filter-chip active' : 'picker-filter-chip'}
          onClick={() => switchToTab('builds')}
        >
          Builds
        </button>
      </div>
      <div className="picker-filter-divider" aria-hidden="true" />
      <div className="echo-bag-modal__action-group">
        {activeTab === 'echoes' ? (
          <button
            type="button"
            className="picker-filter-chip"
            title="Paste echoes into inventory (Ctrl/Cmd+V)"
            onClick={() => {
              void pstClpbIntoI()
            }}
          >
            <Clipboard size={14} />
            Paste
          </button>
        ) : null}
        <button
          type="button"
          className={`picker-filter-chip--expand picker-filter-chip ${compact ? 'active' : ''}`}
          onClick={onCmpcTgl}
          title={compact ? 'Expand view' : 'Compact view'}
          aria-label={compact ? 'Expand view' : 'Compact view'}
          disabled={gridSwtc}
        >
          {compact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          {compact ? 'Expand' : 'Compact'}
        </button>
        <button
          type="button"
          className="picker-filter-chip echo-bag-modal__clear"
          onClick={() => {
            const isEchoes = activeTab === 'echoes'
            confirmation.confirm({
              title: 'You sure about that? ( · ❛ ֊ ❛)',
              message: isEchoes
                ? `This will remove all ${invChs.length} saved echoes from your inventory.`
                : `This will remove all ${invBlds.length} saved builds from your inventory.`,
              confirmLabel: isEchoes ? 'Clear Echoes' : 'Clear Builds',
              variant: 'danger',
              onConfirm: isEchoes ? onClrInvChs : onClrInvBlds,
            })
          }}
          disabled={clrDsbl}
        >
          <Trash2 size={14} /> Clear
        </button>
      </div>
      <div className="picker-filter-divider" aria-hidden="true" />
      {extraControls}
    </div>
  )

  const hdrFltr = activeTab === 'echoes' ? (
    tabFilters(
      <>
        <label className="bp-search">
          <Search size={"0.72rem"} aria-hidden="true" />
          <input
            type="search"
            value={echoSearch}
            onChange={(event) => setEchoSrch(event.target.value)}
            placeholder="Search saved echoes (resonaor/echo name, ID, UID, etc.)..."
          />
        </label>
        <div className="picker-filter-divider" aria-hidden="true" />
        <div className="picker-filter-section">
          <div className="picker-filter-group echo-bag-modal__filter-group">
            {COST_FILTERS.map((cost) => (
                <button
                    key={cost}
                    type="button"
                    className={selectedCost === cost ? 'picker-filter-chip active' : 'picker-filter-chip'}
                    onClick={() => setSelCost((current) => (current === cost ? null : cost))}
                >
                  {cost}C
                </button>
            ))}
          </div>
        </div>
        <div className="picker-filter-divider" aria-hidden="true" />
        <div className="picker-filter-section echo-picker-set-filters">
          <AllowedSets
            selectedSetIds={selectedSet == null ? [] : [selectedSet]}
            availableSetIds={invSetFilterIds}
            selectionMode="single"
            closeOnSelect
            placeholder="All Sonata"
            triggerClass="picker-sonata-select"
            triggerVariant="liquid"
            menuMinWidth={420}
            onSetIdsChange={(nextIds) => setSelSet(nextIds[0] ?? null)}
          />
        </div>
      </>,
    )
  ) : (
    tabFilters(
      <label className="bp-search">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          value={buildSearch}
          onChange={(event) => setBldSrch(event.target.value)}
          placeholder="Search saved builds"
        />
      </label>,
    )
  )

  return (
    <>
      <AppModal
        state={{ visible, open, closing }}
        variant="inventory"
        ariaLabelBy={titleId}
        ariaDscrBy={dscrId}
        onClose={onClose}
      >
        <div
          className="picker-modal__frame echo-bag-modal"
          onClick={(event) => event.stopPropagation()}
          {...(activeTab === 'echoes' ? echoSel.focusProps : { tabIndex: 0 })}
        >
          <div className="picker-modal__header">
            <div className="picker-modal__header-top">
              <div className="picker-modal__heading">
                <div className="picker-modal__eyebrow">Library</div>
                <h2 id={titleId} className="picker-modal__title">Inventory</h2>
              </div>

              <div className="picker-modal__summary">
                <div className="picker-modal__summary-pill">
                  <span className="picker-modal__summary-label">{activeTab === 'echoes' ? 'Echoes' : 'Builds'}</span>
                  <span className="picker-modal__summary-value">{actCollCnt} of {ttlCollCnt}</span>
                </div>
                {actFltrCnt > 0 ? (
                  <div className="picker-modal__summary-pill">
                    <span className="picker-modal__summary-label">Filters</span>
                    <span className="picker-modal__summary-value">{actFltrCnt}</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="picker-modal__summary-action echo-bag-modal__save-equipped"
                  onClick={onSaveInitEchoes}
                  title="Save equipped echoes from initialized resonators"
                >
                  <ArrowDownIcon size={14} />
                  Save Equipped
                </button>
                <MdlClsBttn className="picker-modal__close" onClick={onClose} />
              </div>
              <p id={dscrId} className="picker-modal__description">Saved echoes and full builds.</p>
            </div>
          </div>

          <div className="picker-modal__filters">
            {hdrFltr}
          </div>

          <div
            className={`picker-modal__body echo-bag-modal__body${compact && activeTab === 'echoes' && filteredBag.length > 0 ? ' echo-bag-modal__body--rail' : ''}`}
            ref={modalBodyRef}
          >
            {activeTab === 'echoes' ? (
              filteredBag.length === 0 ? (
                <div className="picker-modal__empty">
                  <p>No saved echoes match the current filters.</p>
                </div>
              ) : (
                <>
                  <div
                    key={compact ? 'compact' : 'expanded'}
                    className={`picker-modal__grid echo-bag-modal__grid ${compact ? 'echo-bag-modal__compact' : ''}${gridSwtc ? ' is-switching' : ''}`}
                    data-orbital-focus-active={fcsdTileId ? 'true' : undefined}
                    {...echoSel.scopeProps}
                    ref={mergeRefs(echoGridRef, echoSel.scopeProps.ref)}
                  >
                    {filteredBag.map((entry, entryIndex) => {
                      const slotFitStates = compact ? null : mkInvSlotFit(entry.echo)
                      const selected = ffctSelEchoE.has(entry.id)

                      return (
                        <ContextTrigger
                          key={entry.id}
                          asChild
                          ariaLabel={`${getEchoById(entry.echo.id)?.name ?? 'Echo'} inventory actions`}
                          getItems={() => mkInvEchoCtx(
                            entry,
                            slotFitStates ?? mkInvSlotFit(entry.echo),
                          )}
                        >
                          <InvEchoEntCa
                            entry={entry}
                            compact={compact}
                            index={entryIndex}
                            columns={echoGridCols}
                            isPreview={compact && railVisible && entry.id === previewEntry?.id}
                            resonatorId={resonatorId}
                            usage={entry.echo.uid ? echoSgByUid[entry.echo.uid] ?? [] : []}
                            showScore={hasEchoScrWg}
                            slotFitStates={slotFitStates ?? MPTYSLOTFITS}
                            selected={selected}
                            selMode={selMode}
                            onActivate={selMode ? undefined : (event) => {
                              setPreviewId(entry.id)
                              if (railVisible) {
                                // the rail already surfaces everything the quick-actions popup
                                // offers, so a plain click just updates the preview there instead.
                                return
                              }
                              openTileMenu(
                                entry,
                                slotFitStates ?? mkInvSlotFit(entry.echo),
                                event,
                              )
                            }}
                            isRbtlFcsd={fcsdTileId === entry.id}
                            onEquip={(slotIndex) => onQpInvEcho(entry, slotIndex)}
                            onEdit={() => onEditInvEch(entry)}
                            onRemove={() => confirmation.confirm({
                              title: 'You sure about that? ( · ❛ ֊ ❛)',
                              message: `Remove "${getEchoById(entry.echo.id)?.name ?? 'this echo'}" from your inventory?`,
                              confirmLabel: 'Remove',
                              variant: 'danger',
                              onConfirm: () => onRmvInvEcho(entry.id),
                            })}
                            onClickCapture={echoSel.buildClickCapture(entry.id)}
                          />
                        </ContextTrigger>
                      )
                    })}
                  </div>
                  {compact && previewEntry ? (
                    <aside
                      className={`echo-bag-modal__rail${gridSwtc ? ' is-switching' : ''}`}
                      aria-label="Selected echo details"
                    >
                      <EchoBagRdt
                        key={previewEntry.id}
                        entry={previewEntry}
                        resonatorId={resonatorId}
                        showScore={hasEchoScrWg}
                        usage={previewEntry.echo.uid ? echoSgByUid[previewEntry.echo.uid] ?? [] : []}
                        slotFitStates={mkInvSlotFit(previewEntry.echo)}
                        onEquip={(slotIndex) => onQpInvEcho(previewEntry, slotIndex)}
                        onEdit={() => onEditInvEch(previewEntry)}
                        onRemove={() => confirmation.confirm({
                          title: 'You sure about that? ( · ❛ ֊ ❛)',
                          message: `Remove "${getEchoById(previewEntry.echo.id)?.name ?? 'this echo'}" from your inventory?`,
                          confirmLabel: 'Remove',
                          variant: 'danger',
                          onConfirm: () => onRmvInvEcho(previewEntry.id),
                        })}
                      />
                    </aside>
                  ) : null}
                </>
              )
            ) : (
              fltrBlds.length === 0 ? (
                <div className="picker-modal__empty">
                  <p>No saved builds match the current filters.</p>
                </div>
              ) : (
                <div
                  ref={buildsGridRef}
                  className="picker-modal__grid echo-bag-modal__grid echo-bag-modal__grid--builds"
                >
                  {fltrBlds.map((entry, entryIndex) => (
                    <ContextTrigger
                      key={entry.id}
                      asChild
                      ariaLabel={`${entry.name} build actions`}
                      getItems={() => mkInvMkCtxMe(entry)}
                    >
                      <SvdMkCard
                        entry={entry}
                        style={{ '--tile-index': Math.min(Math.floor(entryIndex / buildsGridCols), 6) } as CssProps}
                        currentBuild={currentBuild}
                        usage={bldUsrsById[entry.id] ?? []}
                        editing={dtngBldId === entry.id}
                        editingName={dtngBldName}
                        onStrtRnm={() => startRnmMk(entry)}
                        onNameChange={setDtngBldNa}
                        onCmmtRnm={() => {
                          if (dtngBldId === entry.id) {
                            onPdtInvBldN(entry.id, dtngBldName)
                            setDtngBldId(null)
                          }
                        }}
                        onCnclRnm={() => {
                          setDtngBldId(null)
                          setDtngBldNa('')
                        }}
                        onEquip={() => onQpInvBld(entry)}
                        onRemove={() => cnfrRmMk(entry)}
                      />
                    </ContextTrigger>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </AppModal>

      <CnfrMdl
        visible={confirmation.visible}
        open={confirmation.open}
        closing={confirmation.closing}
        portalTarget={portalTarget}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        cancelLabel={confirmation.cancelLabel}
        variant={confirmation.variant}
        onConfirm={confirmation.onConfirm}
        onCancel={confirmation.onCancel}
      />
    </>
  )
}
