/*
  Author: Runor Ewhro
  Description: Manages saved echo and build inventory browsing, filtering,
               selection actions, equip targets, and persistence commands.
*/

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties as CssProps, HTMLAttributes as HtmlAttrs, KeyboardEvent as KeyboardEvent, MouseEvent as RctMsVnt, ReactNode } from 'react'
import {ArrowBigDownDash as ArrowDownIcon, Check, ChevronLeft, ChevronRight, Clipboard, Copy, Maximize2, Minimize2, Pencil, Plus, Rows3, Scissors, Search, Trash2, X} from 'lucide-react'
import type { SavedEcho, SavedBuild } from '@/domain/entities/inventoryStorage'
import type { EchoInstance, WeaponState } from '@/domain/entities/runtime'
import { equalBuildSnapshots } from '@/domain/entities/inventoryStorage'
import { getEchoById, listEchoes } from '@/data/catalog/echoCatalogService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { cmptEchoCrit } from '@/modules/simulation/features/echoes/lib/metric.ts'
import { cmptTtlEchoC } from '@/modules/simulation/features/echoes/lib/echoes.ts'
import { mkDefEchoNst } from '@/modules/simulation/features/echoes/lib/echoPane.ts'
import { EchoPicker } from '@/modules/simulation/features/echoes/Picker.tsx'
import {
  getInvSlotFi,
  paginateInventoryGroups,
  sortEntsByNa,
  type InvSlotFitSt,
} from '@/modules/simulation/features/inventory/lib/inventory.ts'
import type { InvBldUsr, InvEchoSg } from '@/engine/runtime/inventoryUsage.ts'
import { toTitle } from '@/shared/lib/format'
import { hideBrknMg, withDefIconM, withDefResMg, withDefWpnMg } from '@/shared/lib/imageFallback'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { mergeRefs } from '@/shared/lib/mergeRefs.ts'
import { useGridColumns } from '@/shared/lib/useGridColumns.ts'
import { AppModal } from '@/shared/ui/AppModal'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import {
  EchoCardBand,
  EchoCardList,
  echoCardVars,
  type EchoCardStat,
} from '@/modules/simulation/features/echoes/ui/EchoCard.tsx'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal'
import { useConfirm } from '@/shared/hooks/useConfirmation.ts'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery.ts'
import { useCtxBuilder } from '@/modules/simulation/shell/context-menu/useContextMenuBuilder.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import {
  makeEchoClip,
  readEchoClip,
  resolveInventoryPaste,
  writeEchoClip,
} from '@/modules/simulation/features/echoes/lib/clipboard.ts'
import { EchoQpCmprdn } from '@/modules/simulation/features/echoes/lib/EchoEquipComparePreview.tsx'
import { mkSrchTkns, mtchSrchTkns } from '@/modules/simulation/features/echoes/lib/search.ts'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import { getInvEchoCt } from '@/modules/simulation/features/inventory/lib/ctx.tsx'
import {useAppStore} from "@/application/state";
import { useAppCtxMen } from '@/application/context-menu/AppContextMenu'
import { EchoStatPreview } from '@/modules/simulation/features/echoes/ui/EchoStatPreview'
import { RichDscr } from '@/modules/simulation/ui/RichDescription.tsx'
import { rarityVars } from '@/modules/simulation/model/display.ts'

type InventoryTab = 'echoes' | 'builds'

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
  invChs: SavedEcho[]
  invBlds: SavedBuild[]
  ntlEchoSrch?: string
  bldUsrsById: Record<string, InvBldUsr[]>
  echoSgByUid: Record<string, InvEchoSg[]>
  onClose: () => void
  onQpInvEcho: (entry: SavedEcho, slotIndex: number) => void
  onEditEcho: (entry: SavedEcho) => void
  onAddInvChs: (echoes: EchoInstance[]) => number
  onSaveInitEchoes: () => void
  onRmvInvEcho: (entryId: string) => void
  onRmvInvChs: (entryIds: string[]) => void
  onClrInvChs: () => void
  onQpInvBld: (entry: SavedBuild) => void
  onPdtInvBlgk: (entryId: string, name: string) => void
  onRmvInvBld: (entryId: string) => void
  onClrInvBlds: () => void
}

const COST_FILTERS = [4, 3, 1]
const ECHO_COST_CAP = 12
const EXPANDED_ECHO_PAGE_SIZE = 48
const COMPACT_ECHO_PAGE_SIZE = 160
const BUILD_PAGE_SIZE = 48

function InventoryPager({
  label,
  page,
  pageCount,
  start,
  end,
  total,
  onPage,
}: {
  label: string
  page: number
  pageCount: number
  start: number
  end: number
  total: number
  onPage: (page: number) => void
}) {
  if (pageCount <= 1) return null

  return (
    <nav className="inv-page" aria-label={`${label} pages`}>
      <button
        type="button"
        className="inv-page__button"
        aria-label={`Previous ${label} page`}
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size="0.9rem" aria-hidden="true" />
      </button>
      <span className="inv-page__read" aria-live="polite">
        <b>{start + 1}–{end}</b> of {total}
        <i>Page {page + 1}/{pageCount}</i>
      </span>
      <button
        type="button"
        className="inv-page__button"
        aria-label={`Next ${label} page`}
        disabled={page >= pageCount - 1}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size="0.9rem" aria-hidden="true" />
      </button>
    </nav>
  )
}

function getInvEchoDs(entry: SavedEcho) {
  // saved echoes only store ids, so sort/search labels must tolerate catalog entries that no longer exist.
  return getEchoById(entry.echo.id)?.name ?? toTitle(entry.echo.id)
}

function sntTone(setId: number): string | undefined {
  const color = getSntSetClr(setId)
  return color ? `color-mix(in srgb, ${color} 68%, var(--text))` : undefined
}

function echoSubStats(echo: EchoInstance): EchoCardStat[] {
  return Object.entries(echo.substats)
    .filter(([, value]) => Number.isFinite(value) && value !== 0)
    .map(([key, value]) => ({ key, value }))
}

function InvWear({ label, users }: { label: string; users: Array<InvEchoSg | InvBldUsr> }) {
  const shown = users.filter((user) => user.icon)
  if (shown.length === 0) {
    return null
  }

  return (
    <div className="inv-wear">
      <span className="inv-wear__lab">{label}</span>
      {shown.map((user) => (
        <img
          key={`${user.resonatorId}-${'slotIndex' in user ? user.slotIndex : 'build'}`}
          src={user.icon}
          alt={`${user.resName} has it equipped`}
          title={'slotIndex' in user ? `${user.resName} · slot ${user.slotIndex + 1}` : `${user.resName} is running this build`} className="inv-wear__face"
          loading="lazy"
          onError={withDefResMg}
        />
      ))}
    </div>
  )
}

function InvBadge({ users }: { users: InvEchoSg[] }) {
  const shown = users.filter((user) => user.icon)
  if (shown.length === 0) {
    return null
  }

  return (
    <span className="inv-badge" title={shown.map((user) => `${user.resName} · slot ${user.slotIndex + 1}`).join('\n')}>
      {shown.map((user) => (
        <img
          key={`${user.resonatorId}-${user.slotIndex}`}
          src={user.icon}
          alt={`${user.resName} has it equipped`} className="inv-wear__face"
          loading="lazy"
          onError={withDefResMg}
        />
      ))}
    </span>
  )
}

function InvGutter({ side, children }: { side: 'left' | 'right'; children: ReactNode }) {
  return (
    <div
      className={`inv-gut inv-gut--${side}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}

function InvSlotRail({
  slotFitStates: slotFitStates,
  cost,
  onEquip,
}: {
  slotFitStates: InvSlotFitSt[]
  cost?: number
  onEquip: (slotIndex: number) => void
}) {
  return (
    <div className="inv-slots">
      {cost == null
        ? <span className="inv-slots__lab">Slot</span>
        : <span className="inv-slots__cost" title={`${cost} cost`}>{cost}c</span>}
      {slotFitStates.map((fitState, index) => (
        <button
          key={index}
          type="button"
          className={`inv-slots__n${fitState.selected ? ' is-here' : ''}`}
          disabled={!fitState.fits}
          title={fitState.fits ? `Equip into slot ${index + 1}` : 'Does not fit within the 12 cost cap'}
          onClick={(event) => {
            event.stopPropagation()
            onEquip(index)
          }}
        >
          {index + 1}
        </button>
      ))}
    </div>
  )
}

function InvEchoEntCa({
  entry,
  usage,
  compact,
  index,
  columns,
  slotFitStates: slotFitStates,
  onEquip,
  onEdit,
  onRemove,
  onCopyEcho,
  onCutEcho,
  onActivate,
  isRbtlFcsd: isRbtlFcsd = false,
  selected = false,
  isPreview,
  selMode: selectMode = false,
  ...articleProps
}: {
  entry: SavedEcho
  compact: boolean
  index: number
  columns: number
  usage: InvEchoSg[]
  slotFitStates: InvSlotFitSt[]
  onEquip: (slotIndex: number) => void
  onEdit: () => void
  onRemove: () => void
  onCopyEcho: () => void
  onCutEcho: () => void
  onActivate?: (event: RctMsVnt<HTMLElement> | KeyboardEvent<HTMLElement>) => void
  isRbtlFcsd?: boolean
  selected?: boolean
  selMode?: boolean
  isPreview?: boolean
} & HtmlAttrs<HTMLElement>) {
  const definition = getEchoById(entry.echo.id)
  const setIcon = getSntSetIco(entry.echo.set)
  const cv = cmptEchoCrit(entry.echo.substats)
  const wornSlot = slotFitStates.findIndex((fitState) => fitState.selected)

  const onTileKeyDow = (event: KeyboardEvent<HTMLElement>) => {
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

  const tone = sntTone(entry.echo.set)
  const cardVars = { ...echoCardVars({ setColor: tone, cv }), animationDelay: `${Math.min(Math.floor(index / columns), 6) * 45}ms` } as CssProps

  if (compact) {
    const wearer = usage.find((equipped) => equipped.icon)

    return (
      <button
        {...(articleProps as HtmlAttrs<HTMLButtonElement>)}
        type="button"
        className={`inv-tile${selected ? ' focus-selected' : ''}${selectMode ? ' selection-mode' : ''}${isPreview ? ' is-picked' : ''}${wornSlot >= 0 ? ' is-worn' : ''}${isRbtlFcsd ? ' is-orbital' : ''}`}
        style={cardVars}
        data-inv-uid={entry.id}
        data-selection-focus-item="true"
        title={`${definition.name} · ${definition.cost}c · ${getSntSetNam(entry.echo.set)}`}
        onClick={(event) => {
          if (onActivate) onActivate(event)
        }}
        onKeyDown={onTileKeyDow}
      >
        <img
          src={definition.icon}
          alt={definition.name}
          loading="lazy"
          decoding="async"
          onError={hideBrknMg}
        />
        {setIcon ? (
          <img
            src={setIcon}
            alt=""
            aria-hidden="true" className="inv-tile__coin"
            loading="lazy"
            onError={withDefIconM}
          />
        ) : null}
        <span className="inv-tile__cost">{definition.cost}c</span>
        {wornSlot >= 0 ? <span className="inv-tile__here">S{wornSlot + 1}</span> : null}
        {wornSlot < 0 && wearer ? (
          <img
            src={wearer.icon}
            alt=""
            aria-hidden="true"
            title={`${wearer.resName} has it equipped`} className="inv-tile__wear"
            loading="lazy"
            onError={withDefResMg}
          />
        ) : null}
      </button>
    )
  }

  const gutter = !selectMode

  return (
    <article
      {...articleProps}
      className={`ecr-card ecr-card--live inv-card${gutter ? ' has-gutter' : ''}${wornSlot >= 0 ? ' is-worn' : ''}${selected ? ' focus-selected' : ''}${selectMode ? ' selection-mode' : ''}`}
      style={cardVars}
      data-inv-uid={entry.id}
      data-selection-focus-item="true"
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={onTileKeyDow}
      aria-label={`Edit ${definition.name}`}
    >
      {gutter ? (
        <InvGutter side="left">
          <button
            type="button" className="inv-gut__ctl"
            title="Copy echo"
            aria-label={`Copy ${definition.name}`}
            onClick={(event) => {
              event.stopPropagation()
              onCopyEcho()
            }}
          >
            <Copy size="0.84rem" />
          </button>
          <button
            type="button" className="inv-gut__ctl"
            title="Cut echo"
            aria-label={`Cut ${definition.name} from the inventory`}
            onClick={(event) => {
              event.stopPropagation()
              onCutEcho()
            }}
          >
            <Scissors size="0.84rem" />
          </button>
          <button
            type="button" className="inv-gut__ctl inv-gut__ctl--danger"
            title="Remove echo"
            aria-label={`Remove ${definition.name} from the inventory`}
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
          >
            <X size="0.86rem" />
          </button>
        </InvGutter>
      ) : null}

      <EchoCardBand
        icon={definition.icon}
        name={definition.name}
        setIcon={setIcon}
        setName={getSntSetNam(entry.echo.set)}
        mainEcho={false}
        primary={entry.echo.mainStats.primary}
        secondary={entry.echo.mainStats.secondary}
        overlay={<InvBadge users={usage} />}
      />

      <div className="inv-card__nameline">
        <span className="inv-card__name" title={definition.name}>{definition.name}</span>
        {cv > 0 ? <span className="inv-card__cv" title={`Crit value ${formatTruncCompact(cv, 1)}`}>{formatTruncCompact(cv, 1)}</span> : null}
      </div>

      <EchoCardList subs={echoSubStats(entry.echo)} />
      <InvSlotRail slotFitStates={slotFitStates} cost={definition.cost} onEquip={onEquip} />
    </article>
  )
}

function EchoBagRdt({
  entry,
  usage,
  slotFitStates,
  onEquip,
  onEdit,
  onRemove,
}: {
  entry: SavedEcho
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

  const cv = cmptEchoCrit(entry.echo.substats)
  const subs: EchoCardStat[] = [
    entry.echo.mainStats.primary,
    entry.echo.mainStats.secondary,
    ...echoSubStats(entry.echo),
  ]

  return (
    <aside className="inv-rdt" style={echoCardVars({ setColor: sntTone(entry.echo.set), cv })} aria-label="Selected echo">
      <div className="inv-rdt__art">
        <img
          src={definition.icon}
          alt=""
          loading="lazy"
          decoding="async"
          onError={hideBrknMg}
        />
        <div className="inv-rdt__title">
          <h3>{definition.name}</h3>
          <span>{definition.cost}c</span>
        </div>
        <div className="inv-rdt__acts">
          <button type="button" className="inv-act" title="Edit echo" onClick={onEdit}>
            <Pencil size="0.78rem" />
          </button>
          <button type="button" className="inv-act inv-act--danger" title="Remove echo" onClick={onRemove}>
            <X size="0.82rem" />
          </button>
        </div>
      </div>

      <div className="inv-rdt__body">
        <div className="inv-card__caps" style={{ padding: '0 0 0.3rem' }}>
          {cv > 0 ? <span className="inv-card__cv">CV {formatTruncCompact(cv, 1)}</span> : null}
          <span>{getSntSetNam(entry.echo.set)}</span>
        </div>
        <EchoCardList subs={subs} />
      </div>

      {definition.skillDesc ? (
        <div className="inv-rdt__skill">
          <b>Skill</b>
          <RichDscr description={definition.skillDesc} className="inv-rdt__skill-desc" />
        </div>
      ) : null}

      <InvWear label="Worn by" users={usage} />
      <InvSlotRail slotFitStates={slotFitStates} onEquip={onEquip} />
    </aside>
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
  entry: SavedBuild
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
  const mtchCur = equalBuildSnapshots(entry.build, currentBuild)
  // saved builds can come from another resonator, so definitions are resolved from the entry instead of the currently
  // open modal resonator.
  const resonatorDef = getResSeedBy(entry.resonatorId)
  const weaponDef = entry.build.weapon.id ? getWpnById(entry.build.weapon.id) : null

  return (
    <article
      {...articleProps}
      className={`inv-bld has-gutter${mtchCur ? ' is-live' : ''}`}
      style={style}
    >
      <div className="inv-bld__band">
        {resonatorDef?.profile ? (
          <img
            src={resonatorDef.profile}
            alt={entry.resonatorName}
            title={entry.resonatorName} className="inv-bld__face"
            loading="lazy"
            onError={withDefResMg}
          />
        ) : (
          <div className="inv-bld__face" />
        )}

        <div className="inv-bld__who">
          {editing ? (
            <input className="inv-bld__rename"
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
            <>
              <div className="inv-bld__name" title={entry.name}>{entry.name}</div>
              <div className="inv-bld__sub">{mtchCur ? 'Equipped' : entry.resonatorName}</div>
            </>
          )}
        </div>

        {weaponDef ? (
          <div className="inv-wpn" style={rarityVars(weaponDef.rarity) as CssProps}>
            <img
              src={weaponDef.icon}
              alt={weaponDef.name}
              title={`${weaponDef.name} R${entry.build.weapon.rank}`}
              loading="lazy"
              onError={withDefWpnMg}
            />
            <b>R{entry.build.weapon.rank}</b>
          </div>
        ) : (
          <div className="inv-wpn" title="No weapon" />
        )}
      </div>

      <div className="inv-bld__foot">
        {entry.build.echoes.map((echo, slotIndex) => {
          const definition = echo ? getEchoById(echo.id) : null
          const setIcon = echo ? getSntSetIco(echo.set) : null

          return (
            <div
              key={`${entry.id}-${slotIndex}`}
              className={`inv-pip${definition ? '' : ' inv-pip--void'}`}
              style={echo ? { '--inv-tone': sntTone(echo.set) } as CssProps : undefined}
            >
              {definition ? (
                <>
                  <img
                    src={definition.icon}
                    alt={definition.name}
                    title={`${definition.name} · ${getSntSetNam(echo!.set)}`}
                    loading="lazy"
                    onError={hideBrknMg}
                  />
                  {setIcon ? (
                    <img
                      src={setIcon}
                      alt=""
                      aria-hidden="true" className="inv-pip__coin"
                      loading="lazy"
                      onError={withDefIconM}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          )
        })}
        <InvWear label="" users={usage} />
      </div>

      <InvGutter side="right">
        <button type="button" className="inv-gut__ctl" onClick={onEquip} title="Equip build" aria-label={`Equip ${entry.name}`}>
          <ArrowDownIcon size="0.84rem" />
        </button>
        <button type="button" className="inv-gut__ctl" onClick={onStrtRnm} title="Rename build" aria-label={`Rename ${entry.name}`}>
          <Pencil size="0.82rem" />
        </button>
        <button type="button" className="inv-gut__ctl inv-gut__ctl--danger" onClick={onRemove} title="Delete build" aria-label={`Delete ${entry.name}`}>
          <Trash2 size="0.82rem" />
        </button>
      </InvGutter>
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
  const persistedGrouped = useAppStore((state) => state.ui.groupInv)
  const setGrouped = useAppStore((state) => state.setGrpInv)

  const [compact, setCmpcInv] = useState(prssCmpcInv)
  const [gridSwtc, setGridSwtc] = useState(false)
  const cmpcTglTmrRe = useRef<number | null>(null)
  const compactRef = useRef(compact)
  const [grouped, setGroupedDraft] = useState(persistedGrouped)
  const groupedRef = useRef(grouped)
  useEffect(() => {
    compactRef.current = compact
  }, [compact])
  useEffect(() => {
    groupedRef.current = grouped
  }, [grouped])
  useEffect(() => () => {
    // defer persistence until unmount so rapid compact/full toggles do not spam the app store while the animation is
    // still in progress.
    const latest = useAppStore.getState().ui.compactInv
    if (compactRef.current !== latest) {
      setPrssCmpcI(compactRef.current)
    }
    const latestGrouped = useAppStore.getState().ui.groupInv
    if (groupedRef.current !== latestGrouped) {
      setGrouped(groupedRef.current)
    }
  }, [setGrouped, setPrssCmpcI])

  const titleId = useId()
  const menu = useCtxBuilder()
  const showToast = useTstStr((state) => state.show)
  const addEchoModal = useAppModal()
  const allEchoes = useMemo(() => listEchoes(), [])
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const addEcho = useCallback((echoId: string) => {
    const instance = mkDefEchoNst(echoId, 0, null)
    if (!instance) return

    const addedCount = onAddInvChs([instance])
    if (addedCount > 0) {
      bumpPickerFreq({ bucket: 'echo', ids: [instance.id] })
    }
    showToast({
      content: addedCount > 0 ? 'Added echo to inventory.' : 'This echo is already in inventory.',
      variant: addedCount > 0 ? 'success' : 'warning',
      duration: 2800,
    })
  }, [bumpPickerFreq, onAddInvChs, showToast])
  const [activeTab, setActiveTab] = useState<InventoryTab>('echoes')
  const [echoPage, setEchoPage] = useState(0)
  const [buildPage, setBuildPage] = useState(0)
  const railVisible = useMediaQuery('(min-width: 64rem)')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [echoSearch, setEchoSrch] = useState(initEchoSrch)
  const [buildSearch, setBldSrch] = useState('')
  const echoSearchTokens = useMemo(() => mkSrchTkns(echoSearch), [echoSearch])
  const buildSearchTokens = useMemo(() => mkSrchTkns(buildSearch), [buildSearch])
  const [selectedSet, setSelSet] = useState<number | null>(null)
  const [selectedCost, setSelCost] = useState<number | null>(null)
  const [jumpToId, setJumpToId] = useState<string | null>(null)
  const [dtngBldId, setDtngBldId] = useState<string | null>(null)
  const [dtngBldName, setDtngBldNa] = useState('')
  const confirmation = useConfirm()
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
      setEchoPage(0)
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

    // The clipboard envelope includes source metadata; duplicate resolution reads only Echoes.
    const wrote = await writeEchoClip(makeEchoClip({
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
    const payload = await readEchoClip()
    if (!payload) {
      showToast({
        content: 'Clipboard does not contain an echo.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    // the resolver filters duplicates against saved echo uids before the parent store is asked to add anything.
    const result = resolveInventoryPaste(invChs.map((entry) => entry.echo), payload)
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
    // Clear focus identity when the filtered dataset no longer contains it.
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
      icon: <Copy size="1em" />,
      label: ({ count }: { count: number }) => `Copy (${count})`,
      title: 'Copy selected echoes (Ctrl/Cmd+C)',
      run: async ({ vals }: { vals: SavedEcho[] }) => {
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
      icon: <Scissors size="1em" />,
      label: ({ count }: { count: number }) => `Cut (${count})`,
      title: 'Cut selected echoes (Ctrl/Cmd+X)',
      run: ({ count, ids, vals }: { count: number; ids: string[]; vals: SavedEcho[] }) => {
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
      icon: <Clipboard size="1em" />,
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
      icon: <Trash2 size="1em" />,
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
    noun: { one: 'echo', many: 'echoes' },
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
    if (nextTab === 'echoes') setEchoPage(0)
    else setBuildPage(0)
  }, [exitSelMode])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!visible) setFcsdTileI(null)
  }, [visible])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selMode) setFcsdTileI(null)
  }, [selMode])

  const copyInvEcho = useCallback(async (entry: SavedEcho) => {
    const wrote = await copyChsToClp([entry.echo])
    if (wrote) {
      showToast({
        content: 'Copied 1 echo.',
        variant: 'success',
        duration: 2200,
      })
    }
  }, [copyChsToClp, showToast])

  const cutInvEcho = useCallback(async (entry: SavedEcho) => {
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

  const mkInvEchoCtx = useCallback((entry: SavedEcho, slotFitStates: InvSlotFitSt[]) => {
    return getInvEchoCt({
      menu: menu.simulation.echo,
      entry,
      previewNode: (
        <EchoStatPreview echo={entry.echo} />
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
    menu.simulation.echo,
    onEditInvEch,
    onQpInvEcho,
    onRmvInvEcho,
    pstClpbIntoI,
  ])

  const openTileMenu = useCallback((entry: SavedEcho, slotFitStates: InvSlotFitSt[], event: RctMsVnt<HTMLElement> | KeyboardEvent<HTMLElement>) => {
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

  const startRnmMk = useCallback((entry: SavedBuild) => {
    setDtngBldId(entry.id)
    setDtngBldNa(entry.name)
  }, [])

  const cnfrRmMk = useCallback((entry: SavedBuild) => {
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: `Delete "${entry.name}" from your saved builds?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => onRmvInvBld(entry.id),
    })
  }, [confirmation, onRmvInvBld])

  const mkInvMkCtxMe = useCallback((entry: SavedBuild) => {
    return menu.simulation.echo.invBld({
      entryId: entry.id,
      onEquip: () => onQpInvBld(entry),
      onRename: () => startRnmMk(entry),
      onRemove: () => cnfrRmMk(entry),
    })
  }, [
    cnfrRmMk,
    menu.simulation.echo,
    onQpInvBld,
    startRnmMk,
  ])

  // Group Echoes by Sonata and saved builds by resonator identity.
  const echoGroups = useMemo(() => {
    if (!grouped) {
      return [{ setId: null as number | null, entries: filteredBag }]
    }

    const groups = new Map<number, SavedEcho[]>()
    for (const entry of filteredBag) {
      const rows = groups.get(entry.echo.set)
      if (rows) rows.push(entry)
      else groups.set(entry.echo.set, [entry])
    }
    return [...groups.entries()]
      .sort((left, right) => getSntSetNam(left[0]).localeCompare(getSntSetNam(right[0])))
      .map(([setId, entries]) => ({ setId: setId as number | null, entries }))
  }, [filteredBag, grouped])

  const buildGroups = useMemo(() => {
    if (!grouped) {
      return [{ resonatorId: '__all__', resName: '', icon: undefined as string | undefined, entries: fltrBlds }]
    }

    const groups = new Map<string, { resName: string; icon?: string; entries: SavedBuild[] }>()
    for (const entry of fltrBlds) {
      const seen = groups.get(entry.resonatorId)
      if (seen) {
        seen.entries.push(entry)
        continue
      }
      const seed = getResSeedBy(entry.resonatorId)
      groups.set(entry.resonatorId, {
        resName: entry.resonatorName,
        ...(seed?.profile ? { icon: seed.profile } : {}),
        entries: [entry],
      })
    }
    return [...groups.entries()]
      .sort((left, right) => left[1].resName.localeCompare(right[1].resName))
      .map(([resonatorId, group]) => ({ resonatorId, icon: undefined as string | undefined, ...group }))
  }, [fltrBlds, grouped])

  const echoPageSize = compact ? COMPACT_ECHO_PAGE_SIZE : EXPANDED_ECHO_PAGE_SIZE
  const pagedEchoes = useMemo(
    () => paginateInventoryGroups(echoGroups, echoPage, echoPageSize),
    [echoGroups, echoPage, echoPageSize],
  )
  const pagedBuilds = useMemo(
    () => paginateInventoryGroups(buildGroups, buildPage, BUILD_PAGE_SIZE),
    [buildGroups, buildPage],
  )
  const echoEntryIndexById = useMemo(
    () => new Map(fltrBagIds.map((id, index) => [id, index])),
    [fltrBagIds],
  )

  const showInventoryPage = useCallback((tab: InventoryTab, page: number) => {
    if (tab === 'echoes') setEchoPage(page)
    else setBuildPage(page)
    window.requestAnimationFrame(() => {
      modalBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }, [])

  const invSetCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const entry of invChs) {
      counts.set(entry.echo.set, (counts.get(entry.echo.set) ?? 0) + 1)
    }
    return [...counts.entries()].sort(
      (left, right) => getSntSetNam(left[0]).localeCompare(getSntSetNam(right[0])),
    )
  }, [invChs])

  const invResCounts = useMemo(() => {
    const counts = new Map<string, { name: string; icon?: string; n: number }>()
    for (const entry of invBlds) {
      const seen = counts.get(entry.resonatorId)
      if (seen) {
        seen.n += 1
        continue
      }
      const seed = getResSeedBy(entry.resonatorId)
      counts.set(entry.resonatorId, {
        name: entry.resonatorName,
        ...(seed?.profile ? { icon: seed.profile } : {}),
        n: 1,
      })
    }
    return [...counts.entries()].sort((left, right) => left[1].name.localeCompare(right[1].name))
  }, [invBlds])

  const benchSlots = useMemo(() => currentBuild.echoes.map((echo, slotIndex) => {
    const definition = echo ? getEchoById(echo.id) : null
    const saved = echo?.uid
      ? invChs.find((candidate) => candidate.echo.uid === echo.uid)
      : undefined
    return { slotIndex, echo, definition, savedId: saved?.id ?? null }
  }), [currentBuild.echoes, invChs])

  const jumpToEcho = useCallback((savedId: string) => {
    // Clear filters before focusing an equipped Echo absent from the filtered grid.
    setSelCost(null)
    setSelSet(null)
    setEchoSrch('')
    setPreviewId(savedId)
    const sorted = sortEntsByNa(invChs, getInvEchoDs)
    const displayIds = grouped
      ? [...sorted.reduce<Map<number, SavedEcho[]>>((groups, entry) => {
          const entries = groups.get(entry.echo.set)
          if (entries) entries.push(entry)
          else groups.set(entry.echo.set, [entry])
          return groups
        }, new Map())]
          .sort((left, right) => getSntSetNam(left[0]).localeCompare(getSntSetNam(right[0])))
          .flatMap(([, entries]) => entries.map((entry) => entry.id))
      : sorted.map((entry) => entry.id)
    const displayIndex = displayIds.indexOf(savedId)
    if (displayIndex >= 0) setEchoPage(Math.floor(displayIndex / echoPageSize))
    setJumpToId(savedId)
  }, [echoPageSize, grouped, invChs])

  useEffect(() => {
    if (!jumpToId) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const target = modalBodyRef.current?.querySelector<HTMLElement>(`[data-inv-uid="${jumpToId}"]`)
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        target.classList.add('inv-pinged')
        window.setTimeout(() => target.classList.remove('inv-pinged'), 1900)
      }
      setJumpToId(null)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [jumpToId, filteredBag])

  const headTools = (
    <div className="inv-head__tools">
      {activeTab === 'echoes' ? (
        <button
          type="button" className="inv-tool"
          title="Paste echoes into inventory (Ctrl/Cmd+V)"
          aria-label="Paste echoes into inventory"
          onClick={() => {
            void pstClpbIntoI()
          }}
        >
          <Clipboard size="0.82rem" />
        </button>
      ) : null}
      <button
        type="button"
        className={`inv-tool${grouped ? ' is-on' : ''}`}
        title={grouped ? 'Stop grouping' : (activeTab === 'echoes' ? 'Group by sonata' : 'Group by resonator')}
        aria-label={activeTab === 'echoes' ? 'Group by sonata' : 'Group by resonator'}
        aria-pressed={grouped}
        onClick={() => {
          setGroupedDraft(!grouped)
          setEchoPage(0)
          setBuildPage(0)
        }}
      >
        <Rows3 size="0.82rem" />
      </button>
      <button
        type="button"
        className={`inv-tool${compact ? ' is-on' : ''}`}
        onClick={onCmpcTgl}
        title={compact ? 'Expand view' : 'Compact view'}
        aria-label={compact ? 'Expand view' : 'Compact view'}
        aria-pressed={compact}
        disabled={gridSwtc}
      >
        {compact ? <Maximize2 size="0.82rem" /> : <Minimize2 size="0.82rem" />}
      </button>
      <button
        type="button" className="inv-tool inv-tool--danger"
        title={activeTab === 'echoes' ? 'Clear all saved echoes' : 'Clear all saved builds'}
        aria-label={activeTab === 'echoes' ? 'Clear all saved echoes' : 'Clear all saved builds'}
        disabled={clrDsbl}
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
      >
        <Trash2 size="0.82rem" />
      </button>
    </div>
  )

  const headTabs = (
    <div className="inv-tabs" role="group" aria-label="Inventory collection">
      <button
        type="button"
        className={activeTab === 'echoes' ? 'inv-tabs__b is-on' : 'inv-tabs__b'}
        aria-pressed={activeTab === 'echoes'}
        onClick={() => switchToTab('echoes')}
      >
        Echoes
      </button>
      <button
        type="button"
        className={activeTab === 'builds' ? 'inv-tabs__b is-on' : 'inv-tabs__b'}
        aria-pressed={activeTab === 'builds'}
        onClick={() => switchToTab('builds')}
      >
        Builds
      </button>
    </div>
  )

  const railFilters = (
    <>
      {activeTab === 'echoes' ? (
        <>
          <div className="pkr-rail__lab">Equipped</div>
          <div className="inv-bench">
            {benchSlots.map(({ slotIndex, echo, definition, savedId }) => (
              <button
                key={`workspace-${slotIndex}`}
                type="button" className="inv-bench__row"
                disabled={!savedId}
                style={echo ? { '--inv-tone': sntTone(echo.set) } as CssProps : undefined}
                title={savedId ? `Find ${definition?.name ?? 'this echo'} in the library` : undefined}
                onClick={() => {
                  if (savedId) jumpToEcho(savedId)
                }}
              >
                <span className="inv-bench__n">{slotIndex + 1}</span>
                <span className={`inv-bench__face${definition ? '' : ' inv-bench__face--void'}`}>
                  {definition ? (
                    <img src={definition.icon} alt="" aria-hidden="true" loading="lazy" onError={hideBrknMg} />
                  ) : null}
                </span>
                <span className="inv-bench__name">{definition?.name ?? 'Empty'}</span>
                <span className="inv-bench__c">{definition ? `${definition.cost}c` : '–'}</span>
              </button>
            ))}
          </div>
          <div className="inv-bench__meter">
            <div className={`inv-bench__bar${curMkTtlCost >= ECHO_COST_CAP ? ' is-full' : ''}`}>
              <i style={{ '--inv-at': `${Math.min(100, (curMkTtlCost / ECHO_COST_CAP) * 100)}%` } as CssProps} />
            </div>
            <div className="inv-bench__read">
              <span>{curMkTtlCost} of {ECHO_COST_CAP} cost</span>
              <span>{curMkTtlCost >= ECHO_COST_CAP ? 'full' : `${ECHO_COST_CAP - curMkTtlCost} left`}</span>
            </div>
          </div>

          <div className="pkr-rail__lab">Library</div>
          <label className="amdl__find">
            <Search size="0.8rem" aria-hidden="true" />
            <input
              type="search"
              value={echoSearch}
              onChange={(event) => {
                setEchoSrch(event.target.value)
                setEchoPage(0)
              }}
              placeholder="Search saved echoes"
            />
          </label>

          <div className="pkr-rail__row">
            {COST_FILTERS.map((cost) => (
              <button
                key={cost}
                type="button"
                className={selectedCost === cost ? 'pkr-rail__chip is-on' : 'pkr-rail__chip'}
                aria-pressed={selectedCost === cost}
                onClick={() => {
                  setSelCost((current) => (current === cost ? null : cost))
                  setEchoPage(0)
                }}
              >
                {cost}C
              </button>
            ))}
          </div>

          <div className="pkr-rail__lab">Sonata</div>
          <div className="pkr-rail__list">
            {invSetCounts.map(([setId, count]) => {
              const picked = selectedSet === setId
              const setIcon = getSntSetIco(setId)
              return (
                <button
                  key={setId}
                  type="button"
                  className={picked ? 'amdl__tab is-on' : 'amdl__tab'}
                  aria-pressed={picked}
                  onClick={() => {
                    setSelSet(picked ? null : setId)
                    setEchoPage(0)
                  }}
                >
                  {setIcon ? <img src={setIcon} alt="" aria-hidden="true" onError={withDefIconM} /> : <span />}
                  <span className="amdl__tab-label">{getSntSetNam(setId)}</span>
                  {picked ? <Check size="0.7rem" /> : <span className="amdl__tab-n">{count}</span>}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="pkr-rail__lab">Library</div>
          <label className="amdl__find">
            <Search size="0.8rem" aria-hidden="true" />
            <input
              type="search"
              value={buildSearch}
              onChange={(event) => {
                setBldSrch(event.target.value)
                setBuildPage(0)
              }}
              placeholder="Search saved builds"
            />
          </label>

          <div className="pkr-rail__lab">Resonator</div>
          <div className="pkr-rail__list">
            {invResCounts.map(([resId, info]) => (
              <button
                key={resId}
                type="button" className="amdl__tab"
                onClick={() => {
                  setBldSrch(info.name)
                  setBuildPage(0)
                }}
                title={`Show only ${info.name} builds`}
              >
                {info.icon ? (
                  <img src={info.icon} alt="" aria-hidden="true" style={{ borderRadius: '50%' }} onError={withDefResMg} />
                ) : <span />}
                <span className="amdl__tab-label">{info.name}</span>
                <span className="amdl__tab-n">{info.n}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )

  return (
    <>
      <AppModal
        state={{ visible, open, closing }}
        variant="inventory"
        ariaLabelBy={titleId}
          onClose={onClose}
      >
        <div className="amdl inv-modal"
          onClick={(event) => event.stopPropagation()}
          {...(activeTab === 'echoes' ? echoSel.focusProps : { tabIndex: 0 })}
        >
          <ModalHeader over="Library" title={<h2 id={titleId}>Inventory</h2>} onClose={onClose}>
            <div className="amdl__gauge inv-head">
              {headTabs}
              <div className="amdl__pill">
                <span className="amdl__pill-label">{activeTab === 'echoes' ? 'Echoes' : 'Builds'}</span>
                <span className="amdl__pill-value">{actCollCnt} of {ttlCollCnt}</span>
              </div>
              {actFltrCnt > 0 ? (
                <div className="amdl__pill">
                  <span className="amdl__pill-label">Filters</span>
                  <span className="amdl__pill-value">{actFltrCnt}</span>
                </div>
              ) : null}
              {headTools}
              {activeTab === 'echoes' ? (
                <button
                  type="button" className="amdl__act"
                  onClick={addEchoModal.show}
                  title="Add an echo to inventory"
                >
                  <Plus size="0.82rem" aria-hidden="true" />
                  <span>Add</span>
                </button>
              ) : null}
              <button
                type="button" className="amdl__act inv-head__save"
                onClick={onSaveInitEchoes}
                title="Save equipped echoes from initialized resonators"
              >
                <ArrowDownIcon size="0.82rem" />
                <span>Save equipped</span>
              </button>
            </div>
          </ModalHeader>

          <div className="inv-stage">
            <nav className="amdl__rail pkr-rail" aria-label="Inventory filters">
              {railFilters}
              <div className="amdl__rail-foot">
                {actCollCnt} of {ttlCollCnt} {activeTab === 'echoes' ? 'echoes' : 'builds'}
              </div>
            </nav>

            <div
              className={`inv-body${compact && activeTab === 'echoes' && previewEntry ? ' inv-body--readout' : ''}`}
              ref={modalBodyRef}
            >
              {activeTab === 'echoes' ? (
                filteredBag.length === 0 ? (
                  <div className="inv-empty">
                    <p>No saved echoes match the current filters.</p>
                  </div>
                ) : (
                  <>
                    <div
                      key={compact ? 'compact' : 'expanded'}
                      className={`inv-grid${compact ? ' inv-grid--wall' : ''}${gridSwtc ? ' is-switching' : ''}`}
                      data-orbital-focus-active={fcsdTileId ? 'true' : undefined}
                      {...echoSel.scopeProps}
                      ref={mergeRefs(echoGridRef, echoSel.scopeProps.ref)}
                    >
                      {pagedEchoes.groups.map((group) => (
                        <Fragment key={group.setId ?? '__all__'}>
                          {group.setId != null ? (
                            <div className="inv-band" style={{ '--inv-tone': sntTone(group.setId) } as CssProps}>
                              {getSntSetIco(group.setId) ? (
                                <img
                                  src={getSntSetIco(group.setId) ?? ''}
                                  alt=""
                                  aria-hidden="true" className="inv-band__ico"
                                  onError={withDefIconM}
                                />
                              ) : null}
                              <span className="inv-band__name">{getSntSetNam(group.setId)}</span>
                              <i className="inv-band__rule" aria-hidden="true" />
                              <span className="inv-band__n">{group.totalEntries}</span>
                            </div>
                          ) : null}

                          {group.entries.map((entry) => {
                            const slotFitStates = mkInvSlotFit(entry.echo)
                            const selected = ffctSelEchoE.has(entry.id)
                            const entryIndex = echoEntryIndexById.get(entry.id) ?? 0

                            return (
                              <ContextTrigger
                                key={entry.id}
                                asChild
                                ariaLabel={`${getEchoById(entry.echo.id)?.name ?? 'Echo'} inventory actions`}
                                getItems={() => mkInvEchoCtx(entry, slotFitStates)}
                              >
                                <InvEchoEntCa
                                  entry={entry}
                                  compact={compact}
                                  index={entryIndex}
                                  columns={echoGridCols}
                                  isPreview={compact && railVisible && entry.id === previewEntry?.id}
                                  usage={entry.echo.uid ? echoSgByUid[entry.echo.uid] ?? [] : []}
                                  slotFitStates={slotFitStates}
                                  selected={selected}
                                  selMode={selMode}
                                  onActivate={selMode ? undefined : (event) => {
                                    setPreviewId(entry.id)
                                    if (railVisible) {
                                      // With the rail active, tile clicks select a preview without opening a menu.
                                      return
                                    }
                                    openTileMenu(entry, slotFitStates, event)
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
                                  onCopyEcho={() => { void copyInvEcho(entry) }}
                                  onCutEcho={() => { void cutInvEcho(entry) }}
                                  onClickCapture={echoSel.buildClickCapture(entry.id)}
                                />
                              </ContextTrigger>
                            )
                          })}
                        </Fragment>
                      ))}
                      <InventoryPager
                        label="Echo inventory"
                        page={pagedEchoes.page}
                        pageCount={pagedEchoes.pageCount}
                        start={pagedEchoes.start}
                        end={pagedEchoes.end}
                        total={pagedEchoes.total}
                        onPage={(page) => showInventoryPage('echoes', page)}
                      />
                    </div>

                    {compact && previewEntry ? (
                      <EchoBagRdt
                        key={previewEntry.id}
                        entry={previewEntry}
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
                    ) : null}
                  </>
                )
              ) : (
                fltrBlds.length === 0 ? (
                  <div className="inv-empty">
                    <p>No saved builds match the current filters.</p>
                  </div>
                ) : (
                  <div ref={buildsGridRef} className="inv-grid inv-grid--builds">
                    {pagedBuilds.groups.map((group) => (
                      <Fragment key={group.resonatorId}>
                        {group.resonatorId === '__all__' ? null : (
                        <div className="inv-band">
                          {group.icon ? (
                            <img
                              src={group.icon}
                              alt=""
                              aria-hidden="true" className="inv-band__ico inv-band__ico--face"
                              onError={withDefResMg}
                            />
                          ) : null}
                          <span className="inv-band__name">{group.resName}</span>
                          <i className="inv-band__rule" aria-hidden="true" />
                          <span className="inv-band__n">{group.totalEntries}</span>
                        </div>
                        )}

                        {group.entries.map((entry, entryIndex) => (
                          <ContextTrigger
                            key={entry.id}
                            asChild
                            ariaLabel={`${entry.name} build actions`}
                            getItems={() => mkInvMkCtxMe(entry)}
                          >
                            <SvdMkCard
                              entry={entry}
                              style={{ animationDelay: `${Math.min(Math.floor(entryIndex / buildsGridCols), 6) * 45}ms` } as CssProps}
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
                      </Fragment>
                    ))}
                    <InventoryPager
                      label="Saved build inventory"
                      page={pagedBuilds.page}
                      pageCount={pagedBuilds.pageCount}
                      start={pagedBuilds.start}
                      end={pagedBuilds.end}
                      total={pagedBuilds.total}
                      onPage={(page) => showInventoryPage('builds', page)}
                    />
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </AppModal>

      {addEchoModal.visible ? (
        <EchoPicker
          {...addEchoModal.dialogProps}
          portalTarget={portalTarget}
          echoes={allEchoes}
          slotIndex={0}
          eyebrow="Inventory"
          onSelect={addEcho}
          onClear={addEchoModal.hide}
          onClose={addEchoModal.hide}
        />
      ) : null}

      <ConfirmHost control={confirmation} portalTarget={portalTarget} />
    </>
  )
}
