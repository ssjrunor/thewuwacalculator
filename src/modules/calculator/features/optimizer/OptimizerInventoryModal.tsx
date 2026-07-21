/*
  Author: Runor Ewhro
  Description: Optimizer-specific inventory include/exclude selector.
*/

import { useCallback, useId, useMemo, useState } from 'react'
import type { AnimationEvent as RctAnmVnt, CSSProperties as CssProps, HTMLAttributes as HtmlAttrs, KeyboardEvent as KybrVnt, MouseEvent as RctMsVnt } from 'react'
import { Ban, Check, RotateCcw, Search } from 'lucide-react'
import type { InvEchoEnt } from '@/domain/entities/inventoryStorage'
import type { OptInventorySelection } from '@/domain/entities/profile'
import { makeOptInventorySelection } from '@/domain/entities/profile'
import type { InvEchoSg } from '@/domain/state/inventoryUsage'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { getEchoScrPr } from '@/data/scoring/echoScoring'
import { cmptEchoCrit, getCvBdgClss, getScrBdgCls } from '@/modules/calculator/features/echoes/lib/metric'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/statsView'
import { mkSrchTkns, mtchSrchTkns } from '@/modules/calculator/features/echoes/lib/search'
import { AllowedSets } from '@/modules/calculator/features/optimizer/AllowedSets'
import { useSel } from '@/modules/calculator/lib/sel'
import { useMediaQuery } from '@/app/hooks/useMediaQuery'
import { AppModal } from '@/shared/ui/AppModal'
import { ContextTrigger } from '@/shared/ui/CtxTrigger'
import type { MenuEntry } from '@/shared/ui/CtxMenu'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton'
import { hideBrknMg, withDefIconM, withDefResMg } from '@/shared/lib/imageFallback'
import { toTitle } from '@/shared/lib/format'
import { formatTruncCompact } from '@/shared/lib/number'
import { mergeRefs } from '@/shared/lib/mergeRefs.ts'
import { useGridColumns } from '@/shared/lib/useGridColumns.ts'
import { RichDscr } from '@/shared/ui/RichDescription'

const COST_FILTERS = [1, 3, 4]

function getInvEchoDs(entry: InvEchoEnt) {
  return getEchoById(entry.echo.id)?.name ?? toTitle(entry.echo.id)
}

// Toggle one uid in the sparse rule without interpreting mode. Direct card
// clicks edit presence in echoUids; the current mode decides the meaning later.
function withUid(
  selection: OptInventorySelection,
  uid: string,
  tracked: boolean,
): OptInventorySelection {
  const echoUids = new Set(selection.echoUids)
  if (tracked) {
    echoUids.add(uid)
  } else {
    echoUids.delete(uid)
  }

  return {
    ...selection,
    echoUids: [...echoUids],
  }
}

function applyEffectiveState(
  selection: OptInventorySelection,
  uids: string[],
  included: boolean,
): OptInventorySelection {
  const echoUids = new Set(selection.echoUids)
  // Bulk actions speak in effective inventory state. Convert that request into
  // the sparse list representation used by the active include/exclude mode.
  const shouldTrack = selection.mode === 'include' ? included : !included

  for (const uid of uids) {
    if (!uid) {
      continue
    }
    if (shouldTrack) {
      echoUids.add(uid)
    } else {
      echoUids.delete(uid)
    }
  }

  return {
    ...selection,
    echoUids: [...echoUids],
  }
}

function isEchoIncluded(selection: OptInventorySelection, uid: string | undefined): boolean {
  if (!uid) {
    return false
  }
  const tracked = selection.echoUids.includes(uid)
  return selection.mode === 'include' ? tracked : !tracked
}

function OptInvEchoCard({
  entry,
  index,
  columns,
  included,
  isPreview,
  selected,
  selMode: selectMode = false,
  onToggle,
  ...articleProps
}: {
  entry: InvEchoEnt
  index: number
  columns: number
  included: boolean
  isPreview?: boolean
  selected?: boolean
  selMode?: boolean
  onToggle: (event: RctMsVnt<HTMLElement> | KybrVnt<HTMLElement>) => void
} & HtmlAttrs<HTMLElement>) {
  const definition = getEchoById(entry.echo.id)
  if (!definition) {
    return null
  }

  const setIcon = getSntSetIco(entry.echo.set)
  const tileRow = Math.min(Math.floor(index / columns), 6)
  const tileStyle = { '--tile-index': tileRow } as CssProps
  const [entered, setEntered] = useState(false)
  const onTileEntranceEnd = (event: RctAnmVnt<HTMLElement>) => {
    if (event.animationName === 'echoes-section-in') {
      setEntered(true)
    }
  }
  const onTileKeyDow = (event: KybrVnt<HTMLElement>) => {
    if (selectMode || event.currentTarget !== event.target) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(event)
    }
  }

  return (
    <article
      {...articleProps}
      className={`overview-echo-tile echo-bag-card__compact opt-inv-echo${selected ? ' focus-selected' : ''}${selectMode ? ' selection-mode' : ''}${entered ? ' echo-tile-entered' : ''}`}
      style={tileStyle}
      data-included={included ? 'true' : 'false'}
      data-preview={isPreview}
      data-selection-focus-item="true"
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={onTileKeyDow}
      onAnimationEnd={onTileEntranceEnd}
      aria-label={`${included ? 'Included' : 'Excluded'} ${definition.name}`}
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

      <div className="opt-inv-echo__status" aria-hidden="true">
        <span className="opt-inv-echo__status-icon opt-inv-echo__status-icon--current">
          {included ? <Check size={13} /> : <Ban size={13} />}
        </span>
        <span className="opt-inv-echo__status-icon opt-inv-echo__status-icon--action">
          {included ? <Ban size={13} /> : <Check size={13} />}
        </span>
      </div>
    </article>
  )
}

function OptInvPreviewRail({
  entry,
  resonatorId,
  usage,
  included,
  onInclude,
  onExclude,
}: {
  entry: InvEchoEnt
  resonatorId: string
  usage: InvEchoSg[]
  included: boolean
  onInclude: () => void
  onExclude: () => void
}) {
  const definition = getEchoById(entry.echo.id)
  if (!definition) {
    return null
  }

  const setIcon = getSntSetIco(entry.echo.set)
  const sbstEnts = Object.entries(entry.echo.substats).filter(([, value]) => Number.isFinite(value) && value !== 0)
  const echoScore = getEchoScrPr(resonatorId, entry.echo)
  const cv = cmptEchoCrit(entry.echo.substats)
  const visibleUsage = usage.filter((equipped) => equipped.icon)

  return (
    <div className="echo-rdt opt-inv-rdt" data-included={included ? 'true' : 'false'}>
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

      <div className="echo-rdt__actions opt-inv-rdt__actions">
        <button
          type="button"
          className={`echo-rdt__slot opt-inv-rdt__action${included ? ' is-selected' : ''}`}
          onClick={onInclude}
        >
          Include
        </button>
        <button
          type="button"
          className={`echo-rdt__slot opt-inv-rdt__action${included ? '' : ' is-selected'}`}
          onClick={onExclude}
        >
          Exclude
        </button>
      </div>
    </div>
  )
}

export function OptimizerInventoryModal({
  visible,
  open,
  closing,
  invChs,
  echoSgByUid,
  resonatorId,
  selection,
  onSelectionChange,
  onClose,
}: {
  visible: boolean
  open: boolean
  closing: boolean
  invChs: InvEchoEnt[]
  echoSgByUid: Record<string, InvEchoSg[]>
  resonatorId: string
  selection: OptInventorySelection
  onSelectionChange: (updater: (selection: OptInventorySelection) => OptInventorySelection) => void
  onClose: () => void
}) {
  const titleId = useId()
  const dscrId = useId()
  const railVisible = useMediaQuery('(min-width: 64rem)')
  const [echoGridRef, echoGridCols] = useGridColumns()
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [echoSearch, setEchoSrch] = useState('')
  const [selectedSet, setSelSet] = useState<number | null>(null)
  const [selectedCost, setSelCost] = useState<number | null>(null)
  const echoSearchTokens = useMemo(() => mkSrchTkns(echoSearch), [echoSearch])
  const trackedSet = useMemo(() => new Set(selection.echoUids), [selection.echoUids])
  const validInvChs = useMemo(
    () => invChs.filter((entry) => getEchoById(entry.echo.id)),
    [invChs],
  )
  const filteredBag = useMemo(() => {
    return [...validInvChs]
      .sort((left, right) => getInvEchoDs(left).localeCompare(getInvEchoDs(right)))
      .filter((entry) => {
        const definition = getEchoById(entry.echo.id)
        if (!definition) {
          return false
        }

        const usage = entry.echo.uid ? echoSgByUid[entry.echo.uid] ?? [] : []
        // Include usage names so an echo can be found by the resonator that is
        // currently holding it, not only by echo identity.
        const matchesSearch = mtchSrchTkns(echoSearchTokens, [
          definition.name,
          entry.echo.id,
          entry.echo.uid,
          entry.id,
          ...usage.flatMap((equipped) => [equipped.resName, equipped.resonatorId]),
        ])
        const matchesSet = selectedSet == null || entry.echo.set === selectedSet
        const matchesCost = selectedCost == null || definition.cost === selectedCost
        return matchesSearch && matchesSet && matchesCost
      })
  }, [echoSearchTokens, echoSgByUid, selectedCost, selectedSet, validInvChs])
  const invSetFilterIds = useMemo(
    () => Array.from(new Set(validInvChs.map((entry) => entry.echo.set))).sort((left, right) => left - right),
    [validInvChs],
  )
  const includedCount = useMemo(
    () => validInvChs.filter((entry) => isEchoIncluded(selection, entry.echo.uid)).length,
    [selection, validInvChs],
  )
  const actFltrCnt =
    (selectedCost !== null ? 1 : 0) +
    (selectedSet !== null ? 1 : 0) +
    (echoSearchTokens.length > 0 ? 1 : 0)
  const fltrBagIds = useMemo(
    () => filteredBag.map((entry) => entry.id),
    [filteredBag],
  )
  const fltrBagSelTm = useMemo(
    () => filteredBag.map((entry) => ({
      id: entry.id,
      val: entry,
    })),
    [filteredBag],
  )
  const previewEntry = useMemo(
    () => filteredBag.find((entry) => entry.id === previewId) ?? filteredBag[0] ?? null,
    [filteredBag, previewId],
  )

  const setMode = useCallback((mode: OptInventorySelection['mode']) => {
    onSelectionChange((current) => ({
      ...current,
      mode,
    }))
  }, [onSelectionChange])

  const reset = useCallback(() => {
    onSelectionChange(() => makeOptInventorySelection())
  }, [onSelectionChange])

  const applyEntries = useCallback((entries: InvEchoEnt[], included: boolean) => {
    const uids = entries.map((entry) => entry.echo.uid).filter((uid): uid is string => Boolean(uid))
    onSelectionChange((current) => applyEffectiveState(current, uids, included))
  }, [onSelectionChange])

  const toggleEntry = useCallback((entry: InvEchoEnt) => {
    const uid = entry.echo.uid
    if (!uid) {
      return
    }
    onSelectionChange((current) => withUid(current, uid, !current.echoUids.includes(uid)))
  }, [onSelectionChange])

  const selCtns = useMemo(() => [
    {
      id: 'opt-inv:include',
      key: 'copy' as const,
      needsSel: true,
      icon: <Check size={14} />,
      label: ({ count }: { count: number }) => `Include (${count})`,
      title: 'Include selected echoes',
      run: ({ vals }: { vals: InvEchoEnt[] }) => applyEntries(vals, true),
    },
    {
      id: 'opt-inv:exclude',
      key: 'cut' as const,
      needsSel: true,
      icon: <Ban size={14} />,
      label: ({ count }: { count: number }) => `Exclude (${count})`,
      title: 'Exclude selected echoes',
      run: ({ vals }: { vals: InvEchoEnt[] }) => applyEntries(vals, false),
    },
  ], [applyEntries])
  const echoSel = useSel({
    active: true,
    surfaceId: 'opt-inv-echoes',
    ariaLabel: 'Optimizer inventory include and exclude actions',
    items: fltrBagSelTm,
    ord: fltrBagIds,
    acts: selCtns,
  })

  const mkCtx = useCallback((entry: InvEchoEnt): MenuEntry[] => [
    {
      id: `opt-inv:${entry.id}:include`,
      label: 'Include',
      icon: <Check size={15} />,
      onSelect: () => {
        setPreviewId(entry.id)
        applyEntries([entry], true)
      },
    },
    {
      id: `opt-inv:${entry.id}:exclude`,
      label: 'Exclude',
      icon: <Ban size={15} />,
      onSelect: () => {
        setPreviewId(entry.id)
        applyEntries([entry], false)
      },
    },
    { type: 'separator' },
    {
      id: `opt-inv:${entry.id}:select`,
      label: 'Select',
      icon: <Check size={15} />,
      onSelect: () => echoSel.addToSelection(entry.id),
    },
  ], [applyEntries, echoSel])

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="inventory"
      ariaLabelBy={titleId}
      ariaDscrBy={dscrId}
      onClose={onClose}
    >
      <div
        className="picker-modal__frame echo-bag-modal opt-inv-modal"
        onClick={(event) => event.stopPropagation()}
        {...echoSel.focusProps}
      >
        <div className="picker-modal__header">
          <div className="picker-modal__header-top">
            <div className="picker-modal__heading">
              <div className="picker-modal__eyebrow">Optimizer</div>
              <h2 id={titleId} className="picker-modal__title">Inventory Search</h2>
            </div>
            <div className="picker-modal__summary">
              <div className="picker-modal__summary-pill">
                <span className="picker-modal__summary-label">Included</span>
                <span className="picker-modal__summary-value">{includedCount} of {validInvChs.length}</span>
              </div>
              {actFltrCnt > 0 ? (
                <div className="picker-modal__summary-pill">
                  <span className="picker-modal__summary-label">Filters</span>
                  <span className="picker-modal__summary-value">{actFltrCnt}</span>
                </div>
              ) : null}
              <MdlClsBttn className="picker-modal__close" onClick={onClose} />
            </div>
            <p id={dscrId} className="picker-modal__description">Choose which inventory echoes the optimizer may use.</p>
          </div>
        </div>

        <div className="picker-modal__filters">
          <div className="picker-filter-layout echo-filter-row echo-bag-modal__toolbar-row">
            <div className="picker-filter-tabswitch echo-bag-modal__tab-group">
              <button
                type="button"
                className={selection.mode === 'include' ? 'picker-filter-chip active' : 'picker-filter-chip'}
                onClick={() => setMode('include')}
              >
                Include
              </button>
              <button
                type="button"
                className={selection.mode === 'exclude' ? 'picker-filter-chip active' : 'picker-filter-chip'}
                onClick={() => setMode('exclude')}
              >
                Exclude
              </button>
            </div>
            <div className="picker-filter-divider" aria-hidden="true" />
            <div className="echo-bag-modal__action-group">
              <button
                type="button"
                className="picker-filter-chip"
                onClick={reset}
                disabled={selection.mode === 'exclude' && trackedSet.size === 0}
              >
                <RotateCcw size={14} /> Reset
              </button>
            </div>
            <div className="picker-filter-divider" aria-hidden="true" />
            <label className="bp-search">
              <Search size="0.72rem" aria-hidden="true" />
              <input
                type="search"
                value={echoSearch}
                onChange={(event) => setEchoSrch(event.target.value)}
                placeholder="Search inventory echoes (resonator/echo name, ID, UID, etc.)..."
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
          </div>
        </div>

        <div className={`picker-modal__body echo-bag-modal__body${railVisible && filteredBag.length > 0 ? ' echo-bag-modal__body--rail' : ''}`}>
          {filteredBag.length === 0 ? (
            <div className="picker-modal__empty">
              <p>No inventory echoes match the current filters.</p>
            </div>
          ) : (
            <>
              <div
                className="picker-modal__grid echo-bag-modal__grid echo-bag-modal__compact opt-inv-modal__grid"
                {...echoSel.scopeProps}
                ref={mergeRefs(echoGridRef, echoSel.scopeProps.ref)}
              >
                {filteredBag.map((entry, entryIndex) => {
                  const included = isEchoIncluded(selection, entry.echo.uid)
                  const selected = echoSel.selectedIdSet.has(entry.id)

                  return (
                    <ContextTrigger
                      key={entry.id}
                      asChild
                      ariaLabel={`${getEchoById(entry.echo.id)?.name ?? 'Echo'} optimizer inventory actions`}
                      getItems={() => mkCtx(entry)}
                    >
                      <OptInvEchoCard
                        entry={entry}
                        columns={echoGridCols}
                        index={entryIndex}
                        included={included}
                        isPreview={railVisible && entry.id === previewEntry?.id}
                        selected={selected}
                        selMode={echoSel.selectionMode}
                        onToggle={() => {
                          setPreviewId(entry.id)
                          toggleEntry(entry)
                        }}
                        onClickCapture={echoSel.buildClickCapture(entry.id)}
                      />
                    </ContextTrigger>
                  )
                })}
              </div>
              {railVisible && previewEntry ? (
                <aside className="echo-bag-modal__rail" aria-label="Selected optimizer echo details">
                  <OptInvPreviewRail
                    key={previewEntry.id}
                    entry={previewEntry}
                    resonatorId={resonatorId}
                    usage={previewEntry.echo.uid ? echoSgByUid[previewEntry.echo.uid] ?? [] : []}
                    included={isEchoIncluded(selection, previewEntry.echo.uid)}
                    onInclude={() => applyEntries([previewEntry], true)}
                    onExclude={() => applyEntries([previewEntry], false)}
                  />
                </aside>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppModal>
  )
}
