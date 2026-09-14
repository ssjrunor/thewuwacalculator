/*
  Author: Runor Ewhro
  Description: the optimizer's echo pool: the inventory library wearing one
               extra question, whether the search is allowed to reach an echo.
*/

import { useCallback, useId, useMemo, useState } from 'react'
import type { CSSProperties as CssProps, HTMLAttributes as HtmlAttrs, KeyboardEvent as KeyboardEvent, MouseEvent as RctMsVnt } from 'react'
import { Ban, Check, RotateCcw, Search } from 'lucide-react'
import type { SavedEcho } from '@/domain/entities/inventoryStorage'
import type { OptInventorySelection } from '@/domain/entities/profile'
import { makeOptInventorySelection } from '@/domain/entities/profile'
import type { InvEchoSg } from '@/domain/state/inventoryUsage'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { getEchoScrPr } from '@/data/scoring/echoScoring'
import { useEchoScoringRevision } from '@/data/scoring/useEchoScoringRevision'
import { cmptEchoCrit } from '@/modules/simulation/features/echoes/lib/metric'
import { mkSrchTkns, mtchSrchTkns } from '@/modules/simulation/features/echoes/lib/search'
import { EchoStatGlyph } from '@/modules/simulation/features/echoes/lib/statGlyph'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView'
import { useSel } from '@/modules/simulation/lib/sel'
import { useMediaQuery } from '@/app/hooks/useMediaQuery'
import { AppModal } from '@/shared/ui/AppModal'
import { ContextTrigger } from '@/shared/ui/CtxTrigger'
import type { MenuEntry } from '@/shared/ui/CtxMenu'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { echoCardVars, echoStatTitle, type EchoCardStat } from '@/shared/ui/EchoCard'
import { hideBrknMg, withDefIconM, withDefResMg } from '@/shared/lib/imageFallback'
import { toTitle } from '@/shared/lib/format'
import { formatTruncCompact } from '@/shared/lib/number'
import { mergeRefs } from '@/shared/lib/mergeRefs.ts'
import { useGridColumns } from '@/shared/lib/useGridColumns.ts'
import { RichDscr } from '@/shared/ui/RichDescription'

/*
  Read in the order the game hands slots out, the same order the library reads
  them in, so the two rails do not disagree about which class comes first.
*/
const POOL_COSTS = [4, 3, 1]

function getInvEchoDs(entry: SavedEcho) {
  return getEchoById(entry.echo.id)?.name ?? toTitle(entry.echo.id)
}

/*
  A sonata colour can be white and colours repeat between sets, so a set is
  named by its glyph and only ever inked as a thin mark against the text.
*/
function sntTone(setId: number): string | undefined {
  const color = getSntSetClr(setId)
  return color ? `color-mix(in srgb, ${color} 68%, var(--text))` : undefined
}

function echoSubStats(entry: SavedEcho): EchoCardStat[] {
  return Object.entries(entry.echo.substats)
    .filter(([, value]) => Number.isFinite(value) && value !== 0)
    .map(([key, value]) => ({ key, value }))
}

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

/*
  The library's compact tile, carrying membership instead of a slot index: an
  echo the search can reach is painted as the library paints it, and one it
  cannot is drained. Only the corner mark ever names the state, and only when
  it has something to say.
*/
function OptInvTile({
  entry,
  usage,
  included,
  isPreview,
  selected = false,
  selMode: selectMode = false,
  onToggle,
  ...buttonProps
}: {
  entry: SavedEcho
  usage: InvEchoSg[]
  included: boolean
  isPreview?: boolean
  selected?: boolean
  selMode?: boolean
  onToggle: (event: RctMsVnt<HTMLElement> | KeyboardEvent<HTMLElement>) => void
} & HtmlAttrs<HTMLButtonElement>) {
  const definition = getEchoById(entry.echo.id)
  if (!definition) {
    return null
  }

  const setIcon = getSntSetIco(entry.echo.set)
  const wearer = usage.find((equipped) => equipped.icon)
  const cardVars = echoCardVars({
    setColor: sntTone(entry.echo.set),
    cv: cmptEchoCrit(entry.echo.substats),
  })

  const onTileKeyDow = (event: KeyboardEvent<HTMLElement>) => {
    // keyboard activation only belongs to the tile shell; child controls handle their own enter/space events.
    if (selectMode || event.currentTarget !== event.target) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(event)
    }
  }

  return (
    <button
      {...buttonProps}
      type="button"
      className={`inv-tile opi-tile${selected ? ' focus-selected' : ''}${selectMode ? ' selection-mode' : ''}${isPreview ? ' is-picked' : ''}`}
      style={cardVars}
      data-in={included ? 'true' : 'false'}
      data-inv-uid={entry.id}
      data-selection-focus-item="true"
      aria-pressed={included}
      title={`${definition.name} · ${definition.cost}c · ${getSntSetNam(entry.echo.set)}`}
      aria-label={`${definition.name}, ${included ? 'in the pool' : 'out of the pool'}`}
      onClick={onToggle}
      onKeyDown={onTileKeyDow}
    >
      <img
        src={definition.icon}
        alt=""
        aria-hidden="true"
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
      {wearer ? (
        <img
          src={wearer.icon}
          alt=""
          aria-hidden="true"
          title={`${wearer.resName} has it equipped`} className="inv-tile__wear"
          loading="lazy"
          onError={withDefResMg}
        />
      ) : null}

      <span className="opi-mark" aria-hidden="true">
        <span className="opi-mark__ico opi-mark__ico--out"><Ban size="0.72rem" /></span>
        <span className="opi-mark__ico opi-mark__ico--in"><Check size="0.72rem" /></span>
      </span>
    </button>
  )
}

// the wide-screen readout for the tile under the cursor, ending in the one write it offers
function OptInvRdt({
  entry,
  resonatorId,
  usage,
  included,
  onInclude,
  onExclude,
}: {
  entry: SavedEcho
  resonatorId: string
  usage: InvEchoSg[]
  included: boolean
  onInclude: () => void
  onExclude: () => void
}) {
  useEchoScoringRevision(resonatorId)

  const definition = getEchoById(entry.echo.id)
  if (!definition) {
    return null
  }

  const cv = cmptEchoCrit(entry.echo.substats)
  const score = getEchoScrPr(resonatorId, entry.echo)
  const mains: EchoCardStat[] = [entry.echo.mainStats.primary, entry.echo.mainStats.secondary]
  const subs = echoSubStats(entry)
  const worn = usage.filter((equipped) => equipped.icon)

  return (
    <aside className="inv-rdt opi-rdt"
      data-in={included ? 'true' : 'false'}
      style={echoCardVars({ setColor: sntTone(entry.echo.set), cv, score })}
      aria-label="Selected echo"
    >
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
      </div>

      <div className="inv-rdt__body">
        <div className="inv-card__caps opi-caps">
          {score !== null ? <span className="opi-caps__score">Score {formatTruncCompact(score, 1)}%</span> : null}
          {cv > 0 ? <span className="inv-card__cv">CV {formatTruncCompact(cv, 1)}</span> : null}
          <span className="opi-caps__set">{getSntSetNam(entry.echo.set)}</span>
        </div>

        {/*
          The card keeps its main stats in the band and its rolls in the
          ledger. There is no band here, so the two run as one ledger with
          the mains lit and the rolls left plain.
        */}
        <div className="ecr-card__list opi-ledger">
          {[...mains, ...subs].map((stat, index) => (
            <span
              key={`${stat.key}-${index}`}
              className={`ecr-card__line${index < mains.length ? ' opi-ledger__main' : ''}`}
              title={echoStatTitle(stat.key, stat.value)}
            >
              <EchoStatGlyph statKey={stat.key} size={0.78} />
              <span className="ecr-card__k">{formatStatKeyLabel(stat.key)}</span>
              <b>{formatStatKeyValue(stat.key, stat.value)}</b>
            </span>
          ))}
        </div>
      </div>

      {definition.skillDesc ? (
        <div className="inv-rdt__skill">
          <b>Skill</b>
          <RichDscr description={definition.skillDesc} className="inv-rdt__skill-desc" />
        </div>
      ) : null}

      {worn.length > 0 ? (
        <div className="inv-wear">
          <span className="inv-wear__lab">Worn by</span>
          {worn.map((equipped) => (
            <img
              key={`${entry.id}-${equipped.resonatorId}-${equipped.slotIndex}`}
              src={equipped.icon}
              alt={`${equipped.resName} has it equipped`}
              title={`${equipped.resName} · slot ${equipped.slotIndex + 1}`} className="inv-wear__face"
              loading="lazy"
              onError={withDefResMg}
            />
          ))}
        </div>
      ) : null}

      {/* the library ends its readout on the five slots it can be sent to; this one ends on the only pair it has */}
      <div className="opi-put">
        <button
          type="button"
          className={`opi-put__b${included ? ' is-on' : ''}`}
          aria-pressed={included}
          onClick={onInclude}
        >
          Include
        </button>
        <button
          type="button"
          className={`opi-put__b${included ? '' : ' is-on'}`}
          aria-pressed={!included}
          onClick={onExclude}
        >
          Exclude
        </button>
      </div>
    </aside>
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
  invChs: SavedEcho[]
  echoSgByUid: Record<string, InvEchoSg[]>
  resonatorId: string
  selection: OptInventorySelection
  onSelectionChange: (updater: (selection: OptInventorySelection) => OptInventorySelection) => void
  onClose: () => void
}) {
  const titleId = useId()
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
  const invSetCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const entry of validInvChs) {
      counts.set(entry.echo.set, (counts.get(entry.echo.set) ?? 0) + 1)
    }
    return [...counts.entries()].sort(
      (left, right) => getSntSetNam(left[0]).localeCompare(getSntSetNam(right[0])),
    )
  }, [validInvChs])
  /*
    The optimizer fills five slots under one cost cap, so a class it has run dry
    of is the failure this screen exists to catch. The rail reports the pool by
    cost class and each row doubles as the filter for it.
  */
  const poolRows = useMemo(() => {
    const rows = POOL_COSTS.map((cost) => ({ cost, held: 0, inPool: 0 }))
    const byCost = new Map(rows.map((row) => [row.cost, row]))

    for (const entry of validInvChs) {
      const row = byCost.get(getEchoById(entry.echo.id)?.cost ?? -1)
      if (!row) {
        continue
      }
      row.held += 1
      if (isEchoIncluded(selection, entry.echo.uid)) {
        row.inPool += 1
      }
    }

    return rows
  }, [selection, validInvChs])
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

  const applyEntries = useCallback((entries: SavedEcho[], included: boolean) => {
    const uids = entries.map((entry) => entry.echo.uid).filter((uid): uid is string => Boolean(uid))
    onSelectionChange((current) => applyEffectiveState(current, uids, included))
  }, [onSelectionChange])

  const toggleEntry = useCallback((entry: SavedEcho) => {
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
      icon: <Check size="1em" />,
      label: ({ count }: { count: number }) => `Include (${count})`,
      title: 'Include selected echoes',
      run: ({ vals }: { vals: SavedEcho[] }) => applyEntries(vals, true),
    },
    {
      id: 'opt-inv:exclude',
      key: 'cut' as const,
      needsSel: true,
      icon: <Ban size="1em" />,
      label: ({ count }: { count: number }) => `Exclude (${count})`,
      title: 'Exclude selected echoes',
      run: ({ vals }: { vals: SavedEcho[] }) => applyEntries(vals, false),
    },
  ], [applyEntries])
  const echoSel = useSel({
    active: true,
    surfaceId: 'opt-inv-echoes',
    ariaLabel: 'Optimizer inventory include and exclude actions',
    noun: { one: 'echo', many: 'echoes' },
    items: fltrBagSelTm,
    ord: fltrBagIds,
    acts: selCtns,
  })

  const mkCtx = useCallback((entry: SavedEcho): MenuEntry[] => [
    {
      id: `opt-inv:${entry.id}:include`,
      label: 'Include',
      icon: <Check size="1em" />,
      onSelect: () => {
        setPreviewId(entry.id)
        applyEntries([entry], true)
      },
    },
    {
      id: `opt-inv:${entry.id}:exclude`,
      label: 'Exclude',
      icon: <Ban size="1em" />,
      onSelect: () => {
        setPreviewId(entry.id)
        applyEntries([entry], false)
      },
    },
    { type: 'separator' },
    {
      id: `opt-inv:${entry.id}:select`,
      label: 'Select',
      icon: <Check size="1em" />,
      onSelect: () => echoSel.addToSelection(entry.id),
    },
  ], [applyEntries, echoSel])

  const outCount = validInvChs.length - includedCount
  const showRdt = railVisible && previewEntry !== null

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="inventory"
      ariaLabelBy={titleId}
      onClose={onClose}
    >
      <div className="amdl inv-modal"
        onClick={(event) => event.stopPropagation()}
        {...echoSel.focusProps}
      >
        <ModalHeader over="Optimizer" title={<h2 id={titleId}>Inventory Search</h2>} onClose={onClose}>
          <div className="amdl__gauge inv-head">
            {/*
              The library's first control names which collection you are in.
              This one names what a pick means, which is the only thing about
              this modal a reader has to hold on to.
            */}
            <div className="inv-tabs" role="group" aria-label="What picking an echo means">
              <button
                type="button"
                className={selection.mode === 'include' ? 'inv-tabs__b is-on' : 'inv-tabs__b'}
                aria-pressed={selection.mode === 'include'}
                title="Only the echoes you pick are searched"
                onClick={() => setMode('include')}
              >
                Include
              </button>
              <button
                type="button"
                className={selection.mode === 'exclude' ? 'inv-tabs__b is-on' : 'inv-tabs__b'}
                aria-pressed={selection.mode === 'exclude'}
                title="Every echo is searched except the ones you pick"
                onClick={() => setMode('exclude')}
              >
                Exclude
              </button>
            </div>

            <div className="amdl__pill">
              <span className="amdl__pill-label">In the pool</span>
              <span className="amdl__pill-value">{includedCount} of {validInvChs.length}</span>
            </div>
            {actFltrCnt > 0 ? (
              <div className="amdl__pill">
                <span className="amdl__pill-label">Filters</span>
                <span className="amdl__pill-value">{actFltrCnt}</span>
              </div>
            ) : null}

            {/* wiping the picks is worth a word, so it reads as an act and not as one more tool */}
            <button
              type="button" className="amdl__act opi-reset"
              title="Put every echo back in the pool"
              disabled={selection.mode === 'exclude' && trackedSet.size === 0}
              onClick={reset}
            >
              <RotateCcw size="0.82rem" />
              <span>Reset</span>
            </button>
          </div>
        </ModalHeader>

        <div className="inv-stage">
          <nav className="amdl__rail pkr-rail" aria-label="Optimizer inventory filters">
            <div className="pkr-rail__lab">The pool</div>
            <div className="opi-pool">
              {poolRows.map((row) => (
                <button
                  key={row.cost}
                  type="button"
                  className={`opi-pool__row${selectedCost === row.cost ? ' is-on' : ''}`}
                  aria-pressed={selectedCost === row.cost}
                  disabled={row.held === 0}
                  title={`Show only ${row.cost} cost echoes`}
                  onClick={() => setSelCost((current) => (current === row.cost ? null : row.cost))}
                >
                  <span className="opi-pool__c">{row.cost}c</span>
                  <span className="opi-pool__bar">
                    <i style={{ '--opi-at': `${row.held === 0 ? 0 : (row.inPool / row.held) * 100}%` } as CssProps} />
                  </span>
                  <span className="opi-pool__n">{row.inPool}<small>/{row.held}</small></span>
                </button>
              ))}
            </div>
            <div className="opi-pool__read">
              <span>{includedCount} searched</span>
              <span>{outCount === 0 ? 'all in' : `${outCount} out`}</span>
            </div>

            <div className="pkr-rail__lab">Library</div>
            <label className="amdl__find">
              <Search size="0.8rem" aria-hidden="true" />
              <input
                type="search"
                value={echoSearch}
                onChange={(event) => setEchoSrch(event.target.value)}
                placeholder="Search saved echoes"
              />
            </label>

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
                    onClick={() => setSelSet(picked ? null : setId)}
                  >
                    {setIcon ? <img src={setIcon} alt="" aria-hidden="true" onError={withDefIconM} /> : <span />}
                    <span className="amdl__tab-label">{getSntSetNam(setId)}</span>
                    {picked ? <Check size="0.7rem" /> : <span className="amdl__tab-n">{count}</span>}
                  </button>
                )
              })}
            </div>

            <div className="amdl__rail-foot">
              {filteredBag.length} of {validInvChs.length} echoes
            </div>
          </nav>

          <div className={`inv-body${showRdt ? ' inv-body--readout' : ''}`}>
            {filteredBag.length === 0 ? (
              <div className="inv-empty">
                <p>No saved echoes match the current filters.</p>
              </div>
            ) : (
              <>
                <div className="inv-grid inv-grid--wall"
                  {...echoSel.scopeProps}
                  ref={mergeRefs(echoGridRef, echoSel.scopeProps.ref)}
                >
                  {filteredBag.map((entry, entryIndex) => {
                    const included = isEchoIncluded(selection, entry.echo.uid)

                    return (
                      <ContextTrigger
                        key={entry.id}
                        asChild
                        ariaLabel={`${getEchoById(entry.echo.id)?.name ?? 'Echo'} optimizer inventory actions`}
                        getItems={() => mkCtx(entry)}
                      >
                        <OptInvTile
                          entry={entry}
                          usage={entry.echo.uid ? echoSgByUid[entry.echo.uid] ?? [] : []}
                          included={included}
                          isPreview={railVisible && entry.id === previewEntry?.id}
                          selected={echoSel.selectedIdSet.has(entry.id)}
                          selMode={echoSel.selectionMode}
                          style={{ animationDelay: `${Math.min(Math.floor(entryIndex / echoGridCols), 6) * 45}ms` } as CssProps}
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

                {showRdt && previewEntry ? (
                  <OptInvRdt
                    key={previewEntry.id}
                    entry={previewEntry}
                    resonatorId={resonatorId}
                    usage={previewEntry.echo.uid ? echoSgByUid[previewEntry.echo.uid] ?? [] : []}
                    included={isEchoIncluded(selection, previewEntry.echo.uid)}
                    onInclude={() => applyEntries([previewEntry], true)}
                    onExclude={() => applyEntries([previewEntry], false)}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </AppModal>
  )
}
