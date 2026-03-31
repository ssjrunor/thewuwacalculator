import { useId, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Pencil, Save, Trash2 } from 'lucide-react'
import type { InventoryEchoEntry, InventoryBuildEntry } from '@/domain/entities/inventoryStorage'
import type { EchoInstance, WeaponBuildState } from '@/domain/entities/runtime'
import { areBuildSnapshotsEquivalent } from '@/domain/entities/inventoryStorage'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { getWeaponById } from '@/domain/services/weaponCatalogService'
import { getSonataSetIcon, getSonataSetName } from '@/data/gameData/catalog/sonataSets'
import { getEchoScorePercent, getMaxEchoScore } from '@/data/scoring/echoScoring'
import { computeEchoCritValue, getCvBadgeClass, getScoreBadgeClass } from '@/modules/calculator/model/echoMetricBadges'
import { computeTotalEchoCost } from '@/modules/calculator/model/echoes'
import { getInventorySlotFitState, sortEntriesByName } from '@/modules/calculator/model/inventory'
import { formatStatKeyLabel, formatStatKeyValue, toTitle } from '@/modules/calculator/model/overviewStats'
import { hideBrokenImage } from '@/shared/lib/imageFallback'
import { AppDialog } from '@/shared/ui/AppDialog'
import { ModalCloseButton } from '@/shared/ui/ModalCloseButton'
import { ConfirmationModal } from '@/shared/ui/ConfirmationModal'
import { useConfirmation } from '@/app/hooks/useConfirmation.ts'

type InventoryTab = 'echoes' | 'builds'

// presents the saved echo and build inventory overlay for the current resonator.
interface InventoryModalProps {
  visible: boolean
  open: boolean
  closing: boolean
  portalTarget: HTMLElement | null
  resonatorId: string
  currentBuild: {
    weapon: WeaponBuildState
    echoes: Array<EchoInstance | null>
  }
  inventoryEchoes: InventoryEchoEntry[]
  inventoryBuilds: InventoryBuildEntry[]
  buildUsageNamesById: Record<string, string[]>
  onClose: () => void
  onEquipInventoryEcho: (entry: InventoryEchoEntry, slotIndex: number) => void
  onEditInventoryEcho: (entry: InventoryEchoEntry) => void
  onRemoveInventoryEcho: (entryId: string) => void
  onClearInventoryEchoes: () => void
  onSaveCurrentBuild: () => void
  onEquipInventoryBuild: (entry: InventoryBuildEntry) => void
  onUpdateInventoryBuildName: (entryId: string, name: string) => void
  onRemoveInventoryBuild: (entryId: string) => void
  onClearInventoryBuilds: () => void
}

const COST_FILTERS = [1, 3, 4]

function InventoryEchoEntryCard({
  entry,
  resonatorId,
  showScore,
  currentBuild,
  currentTotalCost,
  currentSlotCosts,
  onEquip,
  onEdit,
  onRemove,
}: {
  entry: InventoryEchoEntry
  resonatorId: string
  showScore: boolean
  currentBuild: { echoes: Array<EchoInstance | null> }
  currentTotalCost: number
  currentSlotCosts: number[]
  onEquip: (slotIndex: number) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const definition = getEchoById(entry.echo.id)
  const setIcon = getSonataSetIcon(entry.echo.set)
  const substatEntries = Object.entries(entry.echo.substats)
  const echoScore = showScore ? getEchoScorePercent(resonatorId, entry.echo) : null
  const cv = computeEchoCritValue(entry.echo.substats)
  const slotFitStates = useMemo(
    () => Array.from(
      { length: 5 },
      (_, index) => getInventorySlotFitState(currentBuild.echoes, currentTotalCost, currentSlotCosts, entry.echo, index),
    ),
    [currentBuild.echoes, currentSlotCosts, currentTotalCost, entry.echo],
  )

  const handleTileKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onEdit()
    }
  }

  if (!definition) {
    return null
  }

  return (
    <article
      className="echo-bag-card"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '320px' }}
    >
      <div
        className="overview-echo-tile echo-bag-card__tile"
        role="button"
        tabIndex={0}
        onClick={onEdit}
        onKeyDown={handleTileKeyDown}
        aria-label={`Edit ${definition.name}`}
      >
        <div className="overview-echo-tile-head">
          <img
            src={definition.icon}
            alt={definition.name}
            className="overview-echo-glyph"
            loading="lazy"
            decoding="async"
            onError={hideBrokenImage}
          />

          <div className="overview-echo-tile-info">
            <div className="overview-echo-tile-info__meta">
              {setIcon ? (
                  <img
                      src={setIcon}
                      alt={getSonataSetName(entry.echo.set)}
                      className="overview-echo-set-icon"
                      loading="lazy"
                  />
              ) : null}
              <strong>{definition.name ?? toTitle(entry.echo.id)}</strong>
            </div>
            <div className="overview-echo-tile-meta">
              <span className="echo-slot-cost overview-echo-cost">{definition.cost}C</span>
              {echoScore !== null ? (
                <span className={getScoreBadgeClass(echoScore)}>{echoScore.toFixed(1)}%</span>
              ) : null}
              {cv > 0 ? (
                <span className={getCvBadgeClass(cv)}>CV {cv.toFixed(1)}</span>
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
            ×
          </button>
        </div>

        <div className="overview-echo-tile-stats">
          <div className="overview-echo-stat overview-echo-stat--primary">
            <span className="overview-echo-stat-label">{formatStatKeyLabel(entry.echo.mainStats.primary.key)}</span>
            <span className="overview-echo-stat-value">{formatStatKeyValue(entry.echo.mainStats.primary.key, entry.echo.mainStats.primary.value)}</span>
          </div>
          <div className="overview-echo-stat overview-echo-stat--secondary">
            <span className="overview-echo-stat-label">{formatStatKeyLabel(entry.echo.mainStats.secondary.key)}</span>
            <span className="overview-echo-stat-value">{formatStatKeyValue(entry.echo.mainStats.secondary.key, entry.echo.mainStats.secondary.value)}</span>
          </div>

          {substatEntries.length > 0 ? (
            <div className="overview-echo-subs">
              {substatEntries.map(([key, value]) => (
                <div key={key} className="overview-echo-stat overview-echo-stat--sub">
                  <span className="overview-echo-stat-label">{formatStatKeyLabel(key)}</span>
                  <span className="overview-echo-stat-value">{formatStatKeyValue(key, value)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

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
      </div>
    </article>
  )
}

function SavedBuildCard({
  entry,
  currentBuild,
  usage,
  editing,
  editingName,
  onStartRename,
  onNameChange,
  onCommitRename,
  onCancelRename,
  onEquip,
  onRemove,
}: {
  entry: InventoryBuildEntry
  currentBuild: {
    weapon: WeaponBuildState
    echoes: Array<EchoInstance | null>
  }
  usage: string[]
  editing: boolean
  editingName: string
  onStartRename: () => void
  onNameChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onEquip: () => void
  onRemove: () => void
}) {
  const matchesCurrent = areBuildSnapshotsEquivalent(entry.build, currentBuild)
  const resonatorDef = getResonatorSeedById(entry.resonatorId)
  const weaponDef = entry.build.weapon.id ? getWeaponById(entry.build.weapon.id) : null

  return (
    <article
      className="echo-preset-card"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '216px' }}
    >
      {/* Header: resonator profile + name + current badge + actions */}
      <div className="echo-preset-card__head">
        {resonatorDef?.profile ? (
          <img
            src={resonatorDef.profile}
            alt={entry.resonatorName}
            className="echo-preset-card__resonator-icon"
            loading="lazy"
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
              onBlur={onCommitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onCommitRename()
                }
                if (event.key === 'Escape') {
                  onCancelRename()
                }
              }}
              autoFocus
            />
          ) : (
            <div className="echo-preset-card__title-row">
              <span className="echo-preset-card__title">{entry.name}</span>
              {matchesCurrent ? <span className="echo-preset-card__match">Current</span> : null}
            </div>
          )}
          {usage.length > 0 ? (
            <div className="echo-preset-card__usage">
              {usage.map((label) => (
                <span key={`${entry.id}-${label}`} className="echo-preset-card__usage-chip">
                  {label}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="echo-preset-card__actions">
          <button type="button" className="echo-bag-card__icon-button" onClick={onStartRename} title="Rename build">
            <Pencil size={15} />
          </button>
          <button type="button" className="echo-bag-card__icon-button danger" onClick={onRemove} title="Delete build">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Body: weapon icon + echo strip */}
      <div className="echo-preset-card__body">
        <div className={`echo-preset-card__weapon${weaponDef ? ` rarity-${weaponDef.rarity}` : ''}`}>
          {weaponDef ? (
            <>
              <img
                src={weaponDef.icon}
                alt={weaponDef.name}
                className="echo-preset-card__weapon-icon"
                loading="lazy"
              />
              <span className="echo-preset-card__weapon-rank">R{entry.build.weapon.rank}</span>
            </>
          ) : (
            <span className="echo-preset-card__weapon-empty">—</span>
          )}
        </div>
        <div className="echo-preset-card__divider" />
        <div className="echo-preset-card__grid">
          {entry.build.echoes.map((echo, slotIndex) => {
            const definition = echo ? getEchoById(echo.id) : null
            const setIcon = echo ? getSonataSetIcon(echo.set) : null

            return (
              <div key={`${entry.id}-${slotIndex}`} className={`echo-preset-card__slot${echo ? '' : ' empty'}`}>
                {definition ? (
                  <>
                    {setIcon ? (
                      <img
                        src={setIcon}
                        alt={getSonataSetName(echo?.set ?? 0)}
                        className="echo-preset-card__slot-set"
                        loading="lazy"
                      />
                    ) : null}
                    <img
                      src={definition.icon}
                      alt={definition.name}
                      className="echo-preset-card__slot-icon"
                      loading="lazy"
                      onError={hideBrokenImage}
                    />
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer: equip button */}
      <div className="echo-preset-card__footer">
        <button type="button" className="ui-pill-button" onClick={onEquip}>
          Equip
        </button>
      </div>
    </article>
  )
}

export function InventoryModal({
  visible,
  open,
  closing,
  portalTarget,
  resonatorId,
  currentBuild,
  inventoryEchoes,
  inventoryBuilds,
  buildUsageNamesById,
  onClose,
  onEquipInventoryEcho,
  onEditInventoryEcho,
  onRemoveInventoryEcho,
  onClearInventoryEchoes,
  onSaveCurrentBuild,
  onEquipInventoryBuild,
  onUpdateInventoryBuildName,
  onRemoveInventoryBuild,
  onClearInventoryBuilds,
}: InventoryModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [activeTab, setActiveTab] = useState<InventoryTab>('echoes')
  const [echoSearch, setEchoSearch] = useState('')
  const [buildSearch, setBuildSearch] = useState('')
  const [selectedSet, setSelectedSet] = useState<number | null>(null)
  const [selectedCost, setSelectedCost] = useState<number | null>(null)
  const [editingBuildId, setEditingBuildId] = useState<string | null>(null)
  const [editingBuildName, setEditingBuildName] = useState('')
  const filteredBag = useMemo(() => {
    return sortEntriesByName(inventoryEchoes, (entry) => getEchoById(entry.echo.id)?.name ?? entry.echo.id).filter((entry) => {
      const definition = getEchoById(entry.echo.id)
      if (!definition) {
        return false
      }

      const matchesSearch = definition.name.toLowerCase().includes(echoSearch.trim().toLowerCase())
      const matchesSet = selectedSet == null || entry.echo.set === selectedSet
      const matchesCost = selectedCost == null || definition.cost === selectedCost
      return matchesSearch && matchesSet && matchesCost
    })
  }, [inventoryEchoes, echoSearch, selectedCost, selectedSet])
  const filteredBuilds = useMemo(() => {
    return sortEntriesByName(inventoryBuilds, (entry) => entry.name).filter((entry) => {
      const search = buildSearch.trim().toLowerCase()
      return !search || (
        entry.name.toLowerCase().includes(search)
        || entry.resonatorName.toLowerCase().includes(search)
      )
    })
  }, [inventoryBuilds, buildSearch])
  const activeEchoFilterCount =
    (selectedCost !== null ? 1 : 0) +
    (selectedSet !== null ? 1 : 0) +
    (echoSearch.trim() ? 1 : 0)
  const activeBuildFilterCount = buildSearch.trim() ? 1 : 0
  const activeCollectionCount = activeTab === 'echoes' ? filteredBag.length : filteredBuilds.length
  const totalCollectionCount = activeTab === 'echoes' ? inventoryEchoes.length : inventoryBuilds.length
  const activeFilterCount = activeTab === 'echoes' ? activeEchoFilterCount : activeBuildFilterCount

  const currentBuildSaved = useMemo(
    () => inventoryBuilds.some((entry) => areBuildSnapshotsEquivalent(entry.build, currentBuild)),
    [inventoryBuilds, currentBuild],
  )
  const hasEchoScoreWeights = useMemo(() => getMaxEchoScore(resonatorId) > 0, [resonatorId])
  const confirmation = useConfirmation()
  const clearDisabled = activeTab === 'echoes' ? inventoryEchoes.length === 0 : inventoryBuilds.length === 0
  const currentBuildTotalCost = useMemo(() => computeTotalEchoCost(currentBuild.echoes), [currentBuild.echoes])
  const currentBuildSlotCosts = useMemo(
    () => currentBuild.echoes.map((echo) => (echo ? (getEchoById(echo.id)?.cost ?? 0) : 0)),
    [currentBuild.echoes],
  )

  const tabFilters = (
    <div className="picker-filter-section">
      <div className="picker-filter-group echo-bag-modal__tab-group">
        <button
          type="button"
          className={activeTab === 'echoes' ? 'picker-filter-chip active' : 'picker-filter-chip'}
          onClick={() => setActiveTab('echoes')}
        >
          Echoes
        </button>
        <button
          type="button"
          className={activeTab === 'builds' ? 'picker-filter-chip active' : 'picker-filter-chip'}
          onClick={() => setActiveTab('builds')}
        >
          Builds
        </button>
        <button
          type="button"
          className="picker-filter-chip echo-bag-modal__clear"
          onClick={() => {
            const isEchoes = activeTab === 'echoes'
            confirmation.confirm({
              title: 'You sure about that? ( · ❛ ֊ ❛)',
              message: isEchoes
                ? `This will remove all ${inventoryEchoes.length} saved echoes from your inventory.`
                : `This will remove all ${inventoryBuilds.length} saved builds from your inventory.`,
              confirmLabel: isEchoes ? 'Clear Echoes' : 'Clear Builds',
              variant: 'danger',
              onConfirm: isEchoes ? onClearInventoryEchoes : onClearInventoryBuilds,
            })
          }}
          disabled={clearDisabled}
        >
          Clear {activeTab === 'echoes' ? 'Echoes' : 'Builds'}
        </button>
      </div>
    </div>
  )

  const headerFilters = activeTab === 'echoes' ? (
    <>
      {tabFilters}
      <div className="picker-filter-layout echo-picker-filters">
        <div className="picker-filter-section">
          <div className="picker-filter-group echo-bag-modal__filter-group">
            {COST_FILTERS.map((cost) => (
              <button
                key={cost}
                type="button"
                className={selectedCost === cost ? 'picker-filter-chip active' : 'picker-filter-chip'}
                onClick={() => setSelectedCost((current) => (current === cost ? null : cost))}
              >
                {cost}C
              </button>
            ))}
          </div>
        </div>
        <div className="picker-filter-section echo-picker-set-filters">
          <div className="picker-filter-group echo-picker-set-group">
            {Array.from(new Set(inventoryEchoes.map((entry) => entry.echo.set))).sort((left, right) => left - right).map((setId) => {
              const icon = getSonataSetIcon(setId)
              return (
                <button
                  key={`set-filter-${setId}`}
                  type="button"
                  className={selectedSet === setId ? 'picker-filter-icon active' : 'picker-filter-icon'}
                  onClick={() => setSelectedSet((current) => (current === setId ? null : setId))}
                  title={getSonataSetName(setId)}
                >
                  {icon ? <img src={icon} alt={getSonataSetName(setId)} className="echo-picker-set-icon" loading="lazy" /> : <span>{setId}</span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="picker-filter-section">
          <input
            className="echo-picker-search"
            value={echoSearch}
            onChange={(event) => setEchoSearch(event.target.value)}
            placeholder="Search saved echoes"
          />
        </div>
      </div>
    </>
  ) : (
    <>
      {tabFilters}
      <div className="picker-filter-layout echo-bag-modal__filter-layout">
        <div className="picker-filter-section">
          <input
            className="echo-picker-search"
            value={buildSearch}
            onChange={(event) => setBuildSearch(event.target.value)}
            placeholder="Search saved builds"
          />
        </div>
      </div>
    </>
  )

  return (
    <>
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      overlayClassName="picker-modal__overlay echo-bag-modal__overlay"
      contentClassName="app-modal-panel picker-modal__panel picker-modal__panel--wide echo-bag-modal__panel"
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      onClose={onClose}
    >
      <div className="picker-modal__frame echo-bag-modal" onClick={(event) => event.stopPropagation()}>
        <div className="picker-modal__header">
          <div className="picker-modal__header-top">
            <div className="picker-modal__heading">
              <div className="picker-modal__eyebrow">Library</div>
              <h2 id={titleId} className="picker-modal__title">Inventory</h2>
              <p id={descriptionId} className="picker-modal__description">Saved echoes and full builds.</p>
            </div>

            <div className="picker-modal__summary">
              <div className="picker-modal__summary-pill">
                <span className="picker-modal__summary-label">{activeTab === 'echoes' ? 'Echoes' : 'Builds'}</span>
                <span className="picker-modal__summary-value">{activeCollectionCount} of {totalCollectionCount}</span>
              </div>
              {activeFilterCount > 0 ? (
                <div className="picker-modal__summary-pill">
                  <span className="picker-modal__summary-label">Filters</span>
                  <span className="picker-modal__summary-value">{activeFilterCount}</span>
                </div>
              ) : null}
              <button
                type="button"
                className="picker-modal__close echo-bag-modal__save"
                onClick={onSaveCurrentBuild}
                disabled={currentBuildSaved}
              >
                <Save size={15} />
                {currentBuildSaved ? 'Build Saved' : 'Save Current Build'}
              </button>
            </div>

            <ModalCloseButton className="picker-modal__close" onClick={onClose} />
          </div>
          <div className="picker-modal__filters">
            {headerFilters}
          </div>
        </div>

        <div className="picker-modal__body echo-bag-modal__body">
          {activeTab === 'echoes' ? (
            filteredBag.length === 0 ? (
              <div className="picker-modal__empty">
                <p>No saved echoes match the current filters.</p>
              </div>
            ) : (
              <div className="picker-modal__grid echo-bag-modal__grid">
                {filteredBag.map((entry) => (
                  <InventoryEchoEntryCard
                    key={entry.id}
                  entry={entry}
                  resonatorId={resonatorId}
                  showScore={hasEchoScoreWeights}
                  currentBuild={currentBuild}
                  currentTotalCost={currentBuildTotalCost}
                  currentSlotCosts={currentBuildSlotCosts}
                  onEquip={(slotIndex) => onEquipInventoryEcho(entry, slotIndex)}
                  onEdit={() => onEditInventoryEcho(entry)}
                  onRemove={() => confirmation.confirm({
                    title: 'You sure about that? ( · ❛ ֊ ❛)',
                    message: `Remove "${getEchoById(entry.echo.id)?.name ?? 'echo'}" from your inventory?`,
                    confirmLabel: 'Remove',
                    variant: 'danger',
                    onConfirm: () => onRemoveInventoryEcho(entry.id),
                  })}
                />
                ))}
              </div>
            )
          ) : (
            filteredBuilds.length === 0 ? (
              <div className="picker-modal__empty">
                <p>No saved builds match the current filters.</p>
              </div>
            ) : (
              <div className="picker-modal__grid echo-bag-modal__grid echo-bag-modal__grid--builds">
                {filteredBuilds.map((entry) => (
                  <SavedBuildCard
                    key={entry.id}
                    entry={entry}
                    currentBuild={currentBuild}
                    usage={buildUsageNamesById[entry.id] ?? []}
                    editing={editingBuildId === entry.id}
                    editingName={editingBuildName}
                    onStartRename={() => {
                      setEditingBuildId(entry.id)
                      setEditingBuildName(entry.name)
                    }}
                    onNameChange={setEditingBuildName}
                    onCommitRename={() => {
                      if (editingBuildId === entry.id) {
                        onUpdateInventoryBuildName(entry.id, editingBuildName)
                        setEditingBuildId(null)
                      }
                    }}
                    onCancelRename={() => {
                      setEditingBuildId(null)
                      setEditingBuildName('')
                    }}
                    onEquip={() => onEquipInventoryBuild(entry)}
                    onRemove={() => confirmation.confirm({
                      title: 'You sure about that? ( · ❛ ֊ ❛)',
                      message: `Delete "${entry.name}" from your saved builds?`,
                      confirmLabel: 'Delete',
                      variant: 'danger',
                      onConfirm: () => onRemoveInventoryBuild(entry.id),
                    })}
                  />
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </AppDialog>

    <ConfirmationModal
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
