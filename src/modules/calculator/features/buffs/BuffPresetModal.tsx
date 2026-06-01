/*
  Author: Runor Ewhro
  Description: Presents game-data buff presets and converts selected entries
               into editable manual buff modifiers.
*/

import { useCallback, useMemo, useState } from 'react'
import type {
  ComponentType,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  SVGProps,
} from 'react'
import {
  Boxes,
  ChevronDown,
  Copy,
  Globe,
  Layers,
  Plus,
  Search,
  Swords,
  User,
  Users,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MnlMod } from '@/domain/entities/manualBuffs.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService.ts'
import { withDefEchoMg, withDefIconM, withDefWpnMg } from '@/shared/lib/imageFallback.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import type { AppMdlStt } from '@/shared/ui/AppModal.tsx'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { resPssvPrms } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { useSel } from '@/modules/calculator/lib/sel.tsx'
import type { SelAct } from '@/modules/calculator/lib/sel.tsx'
import {
  cloneMnlMdfr,
  makeModClip,
  writeMnlModC,
} from './lib/clipboard.ts'
import EchoSourceIcon from '@/assets/echo.svg?react'
import {
  getBuffPresetEntryCtx,
  getBuffPresetPaneCtx,
} from '@/modules/calculator/features/buffs/lib/ctx.tsx'
import {
  buildBuffPresetCatalog,
  buffTypeLabel,
  formatManualModifierPreview,
  presetToManualModifiers,
} from './lib/presets.ts'
import type {
  BuffPresetEntry,
  BuffPresetSourceKind,
  BuffPresetType,
  BuffPresetValues,
} from './lib/presets.ts'

interface BuffPresetModalProps {
  state: AppMdlStt
  runtime: ResRuntime
  onClose: () => void
  onAdd: (modifiers: MnlMod[]) => void
}

type SourceFilter = 'all' | BuffPresetSourceKind
type BuffTypeFilter = 'all' | BuffPresetType

const SOURCE_FILTER_VALUES = ['all', 'echo', 'echoSet', 'weapon'] as const satisfies readonly SourceFilter[]
const BUFF_TYPE_FILTER_VALUES = ['all', 'self', 'active', 'team'] as const satisfies readonly BuffTypeFilter[]
const BUFF_PRESET_FILTERS_STORAGE_KEY = 'wwcalc.buff-preset-filters'

interface SegOption<T extends string> {
  value: T
  label: string
  icon: LucideIcon | ComponentType<SVGProps<SVGSVGElement>>
}

const SOURCE_KIND_OPTIONS: Array<SegOption<SourceFilter>> = [
  { value: 'all', label: 'All', icon: Layers },
  { value: 'echo', label: 'Echoes', icon: EchoSourceIcon },
  { value: 'echoSet', label: 'Sets', icon: Boxes },
  { value: 'weapon', label: 'Weapons', icon: Swords },
]

const BUFF_TYPE_OPTIONS: Array<SegOption<BuffTypeFilter>> = [
  { value: 'all', label: 'All', icon: Globe },
  { value: 'self', label: 'Self', icon: User },
  { value: 'active', label: 'Active', icon: Zap },
  { value: 'team', label: 'Team', icon: Users },
]

const RANK_OPTIONS = [1, 2, 3, 4, 5].map((rank) => ({
  value: rank,
  label: `R${rank}`,
}))

const ECHO_SOURCE_ICON = '/assets/echo.svg'

function isSourceFilter(value: unknown): value is SourceFilter {
  return typeof value === 'string' && SOURCE_FILTER_VALUES.includes(value as SourceFilter)
}

function isBuffTypeFilter(value: unknown): value is BuffTypeFilter {
  return typeof value === 'string' && BUFF_TYPE_FILTER_VALUES.includes(value as BuffTypeFilter)
}

function readPersistedFilters(): { sourceKind: SourceFilter; buffType: BuffTypeFilter } {
  if (typeof window === 'undefined') {
    return { sourceKind: 'all', buffType: 'all' }
  }

  try {
    const raw = window.localStorage.getItem(BUFF_PRESET_FILTERS_STORAGE_KEY)
    if (!raw) {
      return { sourceKind: 'all', buffType: 'all' }
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      sourceKind: isSourceFilter(parsed.sourceKind) ? parsed.sourceKind : 'all',
      buffType: isBuffTypeFilter(parsed.buffType) ? parsed.buffType : 'all',
    }
  } catch {
    return { sourceKind: 'all', buffType: 'all' }
  }
}

function persistFilters(sourceKind: SourceFilter, buffType: BuffTypeFilter): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      BUFF_PRESET_FILTERS_STORAGE_KEY,
      JSON.stringify({ sourceKind, buffType }),
    )
  } catch {
    // persistence is best-effort; filter controls should remain usable if storage is unavailable.
  }
}

function kindLabel(kind: BuffPresetSourceKind): string {
  if (kind === 'echoSet') return 'Set'
  if (kind === 'weapon') return 'Weapon'
  return 'Echo'
}

function entryValues(
    entry: BuffPresetEntry,
    controlValues: Record<string, BuffPresetValues>,
): BuffPresetValues {
  const stored = controlValues[entry.id] ?? {}
  return Object.fromEntries(
    entry.controls.map((control) => [control.key, stored[control.key] ?? control.defaultValue]),
  )
}

function visibleControls(entry: BuffPresetEntry) {
  return entry.controls.filter((control) => control.kind !== 'toggle')
}

function entryRank(entry: BuffPresetEntry, rankValues: Record<string, number>): number {
  return entry.source.type === 'weapon' ? rankValues[entry.id] ?? 1 : 1
}

function entryDescriptionParams(entry: BuffPresetEntry, rank: number): Array<string | number> | undefined {
  if (entry.source.type !== 'weapon') {
    return entry.descriptionParams
  }

  const weapon = getWpnById(entry.source.id)
  return weapon ? resPssvPrms(weapon.passive.params, rank) : entry.descriptionParams
}

function entryImageFallback(entry: BuffPresetEntry) {
  if (entry.source.type === 'weapon') return withDefWpnMg
  if (entry.source.type === 'echo') return withDefEchoMg
  return withDefIconM
}

function searchableText(entry: BuffPresetEntry): string {
  return [
    entry.sourceName,
    entry.label,
    entry.effectName,
    entry.description,
    kindLabel(entry.source.type),
    buffTypeLabel(entry.buffType),
    ...entry.controls.map((control) => control.label),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

interface SegControlProps<T extends string> {
  value: T
  options: Array<SegOption<T>>
  onChange: (value: T) => void
  ariaLabel: string
}

function SegControl<T extends string>({ value, options, onChange, ariaLabel }: SegControlProps<T>) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value))

  return (
    <div
      className="bp-seg"
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ '--bp-seg-count': options.length, '--bp-seg-index': activeIndex } as CSSProperties}
    >
      <span className="bp-seg__thumb" aria-hidden="true" />
      {options.map((option) => {
        const isActive = option.value === value
        const Icon = option.icon

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={`bp-seg__option${isActive ? ' bp-seg__option--active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            <Icon width={15} height={15} aria-hidden="true" />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function BuffPresetModal({
  state,
  runtime,
  onClose,
  onAdd,
}: BuffPresetModalProps) {
  const catalog = useMemo(() => buildBuffPresetCatalog(), [])
  const initialFilters = useMemo(() => readPersistedFilters(), [])
  const [query, setQuery] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceFilter>(initialFilters.sourceKind)
  const [buffType, setBuffType] = useState<BuffTypeFilter>(initialFilters.buffType)
  const [controlValues, setControlValues] = useState<Record<string, BuffPresetValues>>({})
  const [rankValues, setRankValues] = useState<Record<string, number>>({})
  const showToast = useTstStr((store) => store.show)

  const setPersistedSourceKind = useCallback((value: SourceFilter) => {
    setSourceKind(value)
    persistFilters(value, buffType)
  }, [buffType])

  const setPersistedBuffType = useCallback((value: BuffTypeFilter) => {
    setBuffType(value)
    persistFilters(sourceKind, value)
  }, [sourceKind])

  const previews = useMemo(() => {
    const next = new Map<string, MnlMod[]>()

    // preview rows are the source of truth for whether a preset can be selected
    // or copied, so evaluate them once per control/rank state change.
    for (const entry of catalog) {
      next.set(
        entry.id,
        presetToManualModifiers(
          entry,
          runtime,
          entryValues(entry, controlValues),
          entryRank(entry, rankValues),
        ),
      )
    }

    return next
  }, [catalog, controlValues, rankValues, runtime])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return catalog.filter((entry) => {
      if (sourceKind !== 'all' && entry.source.type !== sourceKind) return false
      if (buffType !== 'all' && entry.buffType !== buffType) return false
      if (normalizedQuery && !searchableText(entry).includes(normalizedQuery)) return false
      return true
    })
  }, [buffType, catalog, query, sourceKind])

  const visiblePresetIds = useMemo(
    () => filtered.map((entry) => entry.id),
    [filtered],
  )

  const selectablePresetIds = useMemo(
    () => filtered
      .filter((entry) => (previews.get(entry.id)?.length ?? 0) > 0)
      .map((entry) => entry.id),
    [filtered, previews],
  )

  const selectionItems = useMemo(
    () => filtered.map((entry) => ({ id: entry.id, val: entry })),
    [filtered],
  )

  const copyPresetModifiers = useCallback(async (modifiers: MnlMod[]) => {
    if (modifiers.length === 0) {
      return false
    }

    const wrote = await writeMnlModC(
      makeModClip(cloneMnlMdfr(modifiers)),
    )

    showToast({
      content: wrote
        ? (modifiers.length === 1 ? 'Copied 1 preset modifier.' : `Copied ${modifiers.length} preset modifiers.`)
        : 'Could not write preset modifiers to clipboard.',
      variant: wrote ? 'success' : 'warning',
      duration: wrote ? 2200 : 3200,
    })

    return wrote
  }, [showToast])

  const copyPresetEntries = useCallback((entries: BuffPresetEntry[]) => (
    copyPresetModifiers(entries.flatMap((entry) => previews.get(entry.id) ?? []))
  ), [copyPresetModifiers, previews])

  const selectionActions = useMemo<Array<SelAct<string, BuffPresetEntry>>>(() => [
    {
      id: 'copy',
      label: 'Copy',
      key: 'copy',
      needsSel: true,
      float: false,
      run: ({ vals }) => {
        void copyPresetEntries(vals)
      },
    },
  ], [copyPresetEntries])

  const presetSelection = useSel<string, BuffPresetEntry>({
    surfaceId: 'buff-preset-modal',
    ariaLabel: 'Buff preset selection',
    items: selectionItems,
    ord: visiblePresetIds,
    av: selectablePresetIds,
    acts: selectionActions,
    bar: false,
  })

  const selectedEntries = presetSelection.selectedVals

  const selectedModifiers = useMemo(
    () => selectedEntries.flatMap((entry) => previews.get(entry.id) ?? []),
    [previews, selectedEntries],
  )

  const resolveEntryContextTarget = useCallback((entry: BuffPresetEntry) => {
    // context-menu actions operate on the whole current selection when the
    // clicked preset is already selected, matching shared selection behavior.
    if (
      presetSelection.selectionMode &&
      presetSelection.selectedIdSet.has(entry.id) &&
      selectedEntries.length > 0
    ) {
      return {
        entries: selectedEntries,
        modifiers: selectedModifiers,
      }
    }

    return {
      entries: [entry],
      modifiers: previews.get(entry.id) ?? [],
    }
  }, [
    presetSelection.selectedIdSet,
    presetSelection.selectionMode,
    previews,
    selectedEntries,
    selectedModifiers,
  ])

  const setControlValue = useCallback((
      entryId: string,
      key: string,
      value: boolean | number | string,
  ) => {
    setControlValues((previous) => ({
      ...previous,
      [entryId]: {
        ...previous[entryId],
        [key]: value,
      },
    }))
  }, [])

  const setRankValue = useCallback((entryId: string, rank: number) => {
    setRankValues((previous) => ({
      ...previous,
      [entryId]: rank,
    }))
  }, [])

  const addSelected = useCallback(() => {
    if (selectedModifiers.length === 0) return
    onAdd(selectedModifiers)
    presetSelection.exitSelectionMode()
  }, [onAdd, presetSelection, selectedModifiers])

  const addPresetModifiers = useCallback((modifiers: MnlMod[]) => {
    if (modifiers.length === 0) return
    onAdd(modifiers)
  }, [onAdd])

  const copySelected = useCallback(() => {
    void copyPresetModifiers(selectedModifiers)
  }, [copyPresetModifiers, selectedModifiers])

  const selectEntry = useCallback((entry: BuffPresetEntry) => {
    if ((previews.get(entry.id)?.length ?? 0) === 0) return
    presetSelection.addToSelection(entry.id)
  }, [presetSelection, previews])

  const deselectEntry = useCallback((entry: BuffPresetEntry) => {
    if (!presetSelection.selectedIdSet.has(entry.id)) return
    presetSelection.toggleSelection(entry.id)
  }, [presetSelection])

  const buildEntryContextMenu = useCallback((entry: BuffPresetEntry) => {
    const target = resolveEntryContextTarget(entry)
    const entrySelected = presetSelection.selectedIdSet.has(entry.id)
    const entrySelectable = (previews.get(entry.id)?.length ?? 0) > 0

    // menu builders receive materialized targets so they do not need to know
    // about preview caches, selection state, or preset control values.
    return getBuffPresetEntryCtx({
      entry,
      target,
      entrySelected,
      entrySelectable,
      canSelectVisible: selectablePresetIds.length > 0,
      selectedCount: presetSelection.selectedCount,
      onAdd: addPresetModifiers,
      onCopy: copyPresetModifiers,
      onSelect: selectEntry,
      onDeselect: deselectEntry,
      onSelectVisible: presetSelection.selectAll,
      onClearSelection: presetSelection.exitSelectionMode,
    })
  }, [
    addPresetModifiers,
    copyPresetModifiers,
    deselectEntry,
    presetSelection,
    previews,
    resolveEntryContextTarget,
    selectablePresetIds.length,
    selectEntry,
  ])

  const buildModalContextMenu = useCallback(() => getBuffPresetPaneCtx({
    selectedModifiers,
    canSelectVisible: selectablePresetIds.length > 0,
    selectedCount: presetSelection.selectedCount,
    onAddSelected: addSelected,
    onCopySelected: copySelected,
    onSelectVisible: presetSelection.selectAll,
    onClearSelection: presetSelection.exitSelectionMode,
  }), [
    addSelected,
    copySelected,
    presetSelection,
    selectablePresetIds.length,
    selectedModifiers,
  ])

  const ignoreCardClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    return Boolean(
      target.closest('button, input, a, [role="listbox"], [role="radio"], .liquid-select'),
    )
  }, [])

  return (
    <AppModal
      state={state}
      variant="buff-presets"
      ariaLabel="Buff presets"
      onClose={onClose}
    >
      <div className="bp-modal">
        <header className="bp-header">
          <div className="bp-header__main">
            <span className="bp-eyebrow">
              <span className="bp-eyebrow__dot" aria-hidden="true" />
              Manual Buffs
            </span>
            <h2 className="bp-title">Buff Presets</h2>
          </div>

          <div className="bp-meters" aria-label="Preset counts">
            <div className="bp-meter">
              <span className="bp-meter__value">{filtered.length}</span>
              <span className="bp-meter__label">Shown</span>
            </div>
            <div className="bp-meter bp-meter--accent">
              <span className="bp-meter__value">{presetSelection.selectedCount}</span>
              <span className="bp-meter__label">Selected</span>
            </div>
          </div>

          <MdlClsBttn label="Close" onClick={onClose} />
        </header>

        <div className="bp-toolbar">
          <label className="bp-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search buffs, sources, effects…"
            />
          </label>

          <div className="bp-toolbar__filters">
            <SegControl
              value={sourceKind}
              options={SOURCE_KIND_OPTIONS}
              onChange={setPersistedSourceKind}
              ariaLabel="Filter by source"
            />
            <SegControl
              value={buffType}
              options={BUFF_TYPE_OPTIONS}
              onChange={setPersistedBuffType}
              ariaLabel="Filter by buff type"
            />
          </div>
        </div>

        <ContextTrigger
          asChild
          ariaLabel="Buff preset list actions"
          getItems={buildModalContextMenu}
        >
          <div className="bp-body" {...presetSelection.surfaceProps}>
            {filtered.length > 0 ? (
              <div className="bp-grid">
                {filtered.map((entry, index) => {
                  const rank = entryRank(entry, rankValues)
                  const values = entryValues(entry, controlValues)
                  const modifiers = previews.get(entry.id) ?? []
                  const isSelectable = modifiers.length > 0
                  const isSelected = presetSelection.selectedIdSet.has(entry.id)
                  const descriptionParams = entryDescriptionParams(entry, rank)
                  const controls = visibleControls(entry)
                  const isWeapon = entry.source.type === 'weapon'
                  const sourceIcon = entry.sourceIcon
                    ?? (entry.source.type === 'echo' ? ECHO_SOURCE_ICON : null)

                  return (
                    <ContextTrigger
                      key={entry.id}
                      asChild
                      ariaLabel={`${entry.sourceName} preset actions`}
                      items={buildEntryContextMenu(entry)}
                    >
                      <article
                        className={[
                          'bp-card',
                          presetSelection.selectionMode ? 'selection-mode' : '',
                          isSelected ? 'bp-card--selected focus-selected' : '',
                        ].filter(Boolean).join(' ')}
                        data-selection-focus-item="true"
                        aria-selected={isSelected ? 'true' : 'false'}
                        style={{ '--bp-i': Math.min(index, 24) } as CSSProperties}
                        onClickCapture={presetSelection.buildClickCapture(entry.id, {
                          active: isSelectable,
                          shouldIgnore: ignoreCardClick,
                        })}
                        onClick={(event) => {
                          if (ignoreCardClick(event)) return
                          presetSelection.addToSelection(entry.id)
                        }}
                      >
                        <div className="bp-card__top">
                          <div className="bp-card__icon" aria-hidden="true">
                            {sourceIcon ? (
                              <img
                                src={sourceIcon}
                                alt=""
                                loading="lazy"
                                onError={entryImageFallback(entry)}
                              />
                            ) : (
                              <span>{kindLabel(entry.source.type).slice(0, 1)}</span>
                            )}
                          </div>

                          <div className="bp-card__head">
                            <div className="bp-card__tags">
                              <span className={`bp-tag bp-tag--${entry.source.type}`}>{kindLabel(entry.source.type)}</span>
                              <span className={`bp-tag bp-tag--type-${entry.buffType}`}>{buffTypeLabel(entry.buffType)}</span>
                            </div>
                            <h3 className="bp-card__name">{entry.sourceName}</h3>
                          </div>

                          {isWeapon ? (
                            <LiquidSelect
                              value={rank}
                              options={RANK_OPTIONS}
                              onChange={(nextRank) => setRankValue(entry.id, nextRank)}
                              ariaLabel={`${entry.sourceName} rank`}
                              className="bp-rank"
                              viewTrggCntn={(selected) => (
                                <>
                                  <span className="bp-rank__label">Rank</span>
                                  <span className="bp-rank__value">{selected?.label ?? `R${rank}`}</span>
                                  <ChevronDown size={13} className="bp-rank__chevron" aria-hidden="true" />
                                </>
                              )}
                            />
                          ) : null}
                        </div>

                        {entry.description ? (
                          <RichDscr
                            description={entry.description}
                            params={descriptionParams}
                            unstyled
                            className="bp-card__desc"
                          />
                        ) : <p className="bp-card__desc">{entry.label}</p>}

                        <div className="bp-card__preview" aria-label="Generated modifiers">
                          {modifiers.length > 0 ? modifiers.map((modifier, modIndex) => (
                            <span className="bp-chip" key={`${modifier.scope}-${modIndex}`}>
                              {formatManualModifierPreview(modifier)}
                            </span>
                          )) : (
                            <span className="bp-chip bp-chip--empty">No modifier</span>
                          )}
                        </div>

                        {controls.length > 0 ? (
                          <div className="bp-card__controls">
                            {controls.map((control) => (
                              <label key={control.key} className="bp-control">
                                <span>{control.label}</span>
                                {control.kind === 'select' && control.options ? (
                                  <LiquidSelect
                                    value={String(values[control.key])}
                                    options={control.options.map((option) => ({
                                      value: option.id,
                                      label: option.label,
                                    }))}
                                    onChange={(value) => setControlValue(entry.id, control.key, value)}
                                    ariaLabel={control.label}
                                  />
                                ) : (
                                  <input
                                    type="number"
                                    value={Number(values[control.key] ?? 0)}
                                    min={control.min}
                                    max={control.max}
                                    onChange={(event) => {
                                      const nextValue = Number(event.target.value)
                                      setControlValue(
                                        entry.id,
                                        control.key,
                                        Number.isFinite(nextValue) ? nextValue : control.defaultValue,
                                      )
                                    }}
                                  />
                                )}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    </ContextTrigger>
                  )
                })}
              </div>
            ) : (
              <div className="bp-empty">
                <div className="bp-empty__icon" aria-hidden="true">
                  <Search size={22} />
                </div>
                <strong>No presets found</strong>
                <span>Adjust the filters or search text to see more.</span>
              </div>
            )}
          </div>
        </ContextTrigger>

        <footer className="bp-footer">
          <div className="bp-footer__summary">
            <span className="bp-footer__count">{presetSelection.selectedCount}</span>
            <div className="bp-footer__copy">
              <strong>{presetSelection.selectedCount === 1 ? 'preset selected' : 'presets selected'}</strong>
              <span>{selectedModifiers.length} {selectedModifiers.length === 1 ? 'modifier' : 'modifiers'} ready</span>
            </div>
          </div>
          <div className="bp-footer__actions">
            <button type="button" className="bp-btn bp-btn--ghost" onClick={presetSelection.selectAll}>
              Select Visible
            </button>
            <button
              type="button"
              className="bp-btn bp-btn--ghost"
              onClick={presetSelection.exitSelectionMode}
              disabled={presetSelection.selectedCount === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="bp-btn bp-btn--ghost"
              onClick={copySelected}
              disabled={selectedModifiers.length === 0}
            >
              <Copy size={16} aria-hidden="true" />
              Copy
            </button>
            <button
              type="button"
              className="bp-btn bp-btn--primary"
              onClick={addSelected}
              disabled={selectedModifiers.length === 0}
            >
              <Plus size={16} aria-hidden="true" />
              Add Selected
            </button>
          </div>
        </footer>
      </div>
    </AppModal>
  )
}
