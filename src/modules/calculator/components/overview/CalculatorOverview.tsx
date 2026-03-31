import { useMemo, useState } from 'react'
import type { CSSProperties, SyntheticEvent } from 'react'
import type { EchoInstance, ResonatorRuntimeState } from '@/domain/entities/runtime'
import { isUnsetWeaponId } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import { buildRuntimeParticipantLookup } from '@/domain/state/runtimeAdapters'
import { buildTransientCombatGraph } from '@/domain/state/combatGraph'
import { getEchoById } from '@/domain/services/echoCatalogService'
import type { SimulationResult } from '@/engine/pipeline/types'
import type { OverviewStateSummaryGroup } from '@/modules/calculator/model/overviewStateSummary'
import { getWeaponById } from '@/domain/services/weaponCatalogService'
import { getSonataSetIcon, getSonataSetName } from '@/data/gameData/catalog/sonataSets'
import {
  aggregateEchoStats,
  getBuildScorePercent,
  getEchoScorePercent,
  getMaxEchoScore,
} from '@/data/scoring/echoScoring'
import { computeEchoCritValue, getCvBadgeClass, getScoreBadgeClass } from '@/modules/calculator/model/echoMetricBadges'
import { listRotationFeatureRows } from '@/engine/rotation/system'
import { buildOverviewStateSummary } from '@/modules/calculator/model/overviewStateSummary'
import { getResonator } from '@/modules/calculator/model/resonator'
import { seedResonatorsById } from '@/modules/calculator/model/seedData'
import { buildPreparedLiveComputation } from '@/modules/calculator/model/selectors'
import { getPrimarySkillType, getSkillTypeDisplay } from '@/modules/calculator/model/skillTypes'
import { getEchoCostById } from '@/modules/calculator/model/echoes'
import { getRotationFooter, getWeaponVisualKey, groupByAverage } from '@/modules/calculator/model/overview'
import type { StatsTreeNode } from '@/modules/calculator/model/overviewStats'
import {
  ATTRIBUTE_COLORS,
  STAT_ICON_MAP,
  buildOverviewStatsView,
  buildStatsTree,
  formatCompactNumber,
  formatDisplayValue,
  formatStatKeyLabel,
  formatStatKeyValue,
  toTitle,
} from '@/modules/calculator/model/overviewStats'
import { useConfirmation } from '@/app/hooks/useConfirmation.ts'
import { Expandable } from '@/shared/ui/Expandable'
import { useAppStore } from '@/domain/state/store.ts'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'
import { ConfirmationModal } from '@/shared/ui/ConfirmationModal'
import { useToastStore } from '@/shared/util/toastStore.ts'
import { buildPreparedWorkspace } from '@/engine/pipeline/preparedWorkspace'

// renders the overview modal that surfaces alternate resonators and detailed stats.
interface CalculatorOverviewProps {
  activeResonatorId: string | null
  enemyProfile: EnemyProfile
  onClose: () => void
  overviewStateSummary: OverviewStateSummaryGroup[]
  routingSelectionsByResonatorId: Record<string, Record<string, string | null>>
  runtime: ResonatorRuntimeState | null
  runtimesById: Record<string, ResonatorRuntimeState>
  simulation: SimulationResult | null
  onImageError: (event: SyntheticEvent<HTMLImageElement>) => void
}

function StatsTreeLeafView({ node }: { node: StatsTreeNode & { kind: 'leaf' } }) {
  if (node.baseValue) {
    return (
      <div className="overview-tree-tile">
        <span className="overview-tree-tile-label">{node.label}</span>
        <span className="overview-tree-tile-final">
          {node.displayValue}
          {node.diffValue ? (
            <sup className={`overview-tree-tile-diff overview-tree-tile-diff--${node.diffSign}`}>
              {node.diffValue}
            </sup>
          ) : null}
        </span>
        <span className="overview-tree-tile-base">Base {node.baseValue}</span>
      </div>
    )
  }

  return (
    <div className="overview-tree-leaf">
      <span className="overview-tree-leaf-label">{node.label}</span>
      <span className="overview-tree-leaf-value" style={node.color ? { color: node.color } as CSSProperties : undefined}>
        {node.displayValue}
      </span>
    </div>
  )
}

function StatsTreeNodeView({ node }: { node: StatsTreeNode }) {
  if (node.kind === 'leaf') {
    return <StatsTreeLeafView node={node} />
  }

  const childrenClass = node.flow
    ? `overview-tree-children overview-tree-children--${node.flow}`
    : 'overview-tree-children'

  return (
    <div className="overview-tree-branch">
      <div className="overview-tree-branch-head" style={node.color ? { '--tree-accent': node.color } as CSSProperties : undefined}>
        {node.label}
      </div>
      <div className={childrenClass}>
        {node.children.map((child) => (
          <StatsTreeNodeView key={child.key} node={child} />
        ))}
      </div>
    </div>
  )
}

export function CalculatorOverview({
  activeResonatorId,
  enemyProfile,
  onClose,
  overviewStateSummary,
  routingSelectionsByResonatorId,
  runtime,
  runtimesById,
  simulation,
  onImageError,
}: CalculatorOverviewProps) {
  const availableResonators = useMemo(
    () =>
      Object.entries(runtimesById)
        .map(([resonatorId, runtimeState]) => {
          const resonator = getResonator(resonatorId)
          const attribute = resonator?.attribute ?? 'aero'

          return {
            id: resonatorId,
            name: resonator?.name ?? toTitle(resonatorId),
            attribute,
            resonator,
            runtime: runtimeState,
            accent: ATTRIBUTE_COLORS[attribute] ?? '#6b7cff',
          }
        })
        .sort((left, right) => {
          if (left.attribute !== right.attribute) {
            return left.attribute.localeCompare(right.attribute)
          }

          return left.name.localeCompare(right.name)
        }),
    [runtimesById],
  )

  const [selectedResonatorId, setSelectedResonatorId] = useState<string | null>(
    activeResonatorId ?? availableResonators[0]?.id ?? null,
  )

  const selectedEntry =
    availableResonators.find((entry) => entry.id === selectedResonatorId) ??
    availableResonators.find((entry) => entry.id === activeResonatorId) ??
    availableResonators[0] ??
    null
  const switchToResonator = useAppStore((s) => s.switchToResonator)
  const deleteResonatorProfile = useAppStore((s) => s.deleteResonatorProfile)
  const confirmation = useConfirmation()
  const showToast = useToastStore((state) => state.show)
  const portalTarget = getMainContentPortalTarget()

  const selectedRuntime = selectedEntry?.runtime ?? (selectedEntry?.id === activeResonatorId ? runtime : null)
  const isSelectedResonatorActive = selectedEntry?.id === activeResonatorId
  const selectedSeed = selectedEntry ? seedResonatorsById[selectedEntry.id] ?? null : null
  const selectedParticipantRuntimesById = useMemo(
    () => (selectedRuntime ? buildRuntimeParticipantLookup(selectedRuntime, runtimesById) : {}),
    [runtimesById, selectedRuntime],
  )
  const selectedTargetsByOwnerKey = useMemo(
    () => (selectedEntry ? routingSelectionsByResonatorId[selectedEntry.id] ?? {} : {}),
    [routingSelectionsByResonatorId, selectedEntry],
  )
  const selectedCombatGraph = useMemo(() => {
    if (!selectedRuntime || isSelectedResonatorActive) {
      return null
    }

    return buildTransientCombatGraph({
      activeRuntime: selectedRuntime,
      participantRuntimes: selectedParticipantRuntimesById,
      selectedTargetsByResonatorId: {
        [selectedRuntime.id]: selectedTargetsByOwnerKey,
      },
    })
  }, [
    isSelectedResonatorActive,
    selectedParticipantRuntimesById,
    selectedRuntime,
    selectedTargetsByOwnerKey,
  ])
  const selectedPreparedWorkspace = useMemo(() => {
    if (!selectedRuntime || !selectedSeed || isSelectedResonatorActive) {
      return null
    }

    return buildPreparedWorkspace({
      runtime: selectedRuntime,
      seed: selectedSeed,
      enemy: enemyProfile,
      participantRuntimesById: selectedParticipantRuntimesById,
      activeTargetSelections: selectedTargetsByOwnerKey,
      combatGraph: selectedCombatGraph,
    })
  }, [
    enemyProfile,
    isSelectedResonatorActive,
    selectedCombatGraph,
    selectedParticipantRuntimesById,
    selectedRuntime,
    selectedSeed,
    selectedTargetsByOwnerKey,
  ])
  const selectedSimulation = useMemo(() => {
    if (!selectedRuntime || !selectedSeed) {
      return null
    }

    if (isSelectedResonatorActive) {
      return simulation
    }

    return buildPreparedLiveComputation(selectedPreparedWorkspace)
  }, [
    isSelectedResonatorActive,
    selectedRuntime,
    selectedSeed,
    selectedPreparedWorkspace,
    simulation,
  ])
  const selectedEntryHasEchoWeights = selectedEntry ? getMaxEchoScore(selectedEntry.id) > 0 : false
  const selectedOverviewStateSummary = useMemo(() => {
    if (!selectedRuntime) {
      return []
    }

    if (isSelectedResonatorActive) {
      return overviewStateSummary
    }

    return buildOverviewStateSummary(
      selectedRuntime,
      selectedParticipantRuntimesById,
      selectedCombatGraph,
      selectedTargetsByOwnerKey,
      {
        contextsByResonatorId: selectedPreparedWorkspace?.contextsByResonatorId,
        enemyProfile,
      },
    )
  }, [
    enemyProfile,
    isSelectedResonatorActive,
    selectedCombatGraph,
    overviewStateSummary,
    selectedPreparedWorkspace,
    selectedParticipantRuntimesById,
    selectedRuntime,
    selectedTargetsByOwnerKey,
  ])
  const activeOverviewStateGroup =
    selectedOverviewStateSummary.find((group) => group.sourceId === selectedRuntime?.id) ?? null
  const supportingOverviewStateGroups = selectedOverviewStateSummary.filter(
    (group) => group.sourceId !== selectedRuntime?.id,
  )

  const activeResonator = selectedEntry?.resonator ?? null
  const activeResonatorName = activeResonator?.name ?? selectedEntry?.name ?? 'No Resonator'
  const activeAttribute = activeResonator?.attribute ?? selectedEntry?.attribute ?? 'aero'
  const activeAccent = selectedEntry?.accent ?? ATTRIBUTE_COLORS[activeAttribute] ?? '#6b7cff'

  const handleDeleteResonator = () => {
    if (!selectedEntry) {
      return
    }

    const currentIndex = availableResonators.findIndex((entry) => entry.id === selectedEntry.id)
    const remainingResonators = availableResonators.filter((entry) => entry.id !== selectedEntry.id)
    const nextEntry =
      availableResonators[currentIndex + 1] ??
      availableResonators[currentIndex - 1] ??
      remainingResonators[0] ??
      null

    confirmation.confirm({
      title: 'Delete this resonator profile?',
      message: `${selectedEntry.name}'s saved calculator state will be removed from overview. inventory items stay intact.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: () => {
        deleteResonatorProfile(selectedEntry.id, nextEntry?.id ?? null)
        setSelectedResonatorId(nextEntry?.id ?? null)
        showToast({
          content: `${selectedEntry.name} removed from overview.`,
          variant: 'success',
          duration: 3000,
        })
      },
    })
  }

  const weaponState = selectedRuntime?.build.weapon ?? null
  const weapon =
    weaponState?.id && !isUnsetWeaponId(weaponState.id) ? getWeaponById(weaponState.id) : null
  const currentWeaponKey = getWeaponVisualKey(activeResonator?.weaponType ?? null)
  const weaponVisualKey =
    weapon?.weaponType != null
      ? getWeaponVisualKey(weapon.weaponType)
      : currentWeaponKey
  const weaponName =
    weapon?.name ??
    (weaponState && !isUnsetWeaponId(weaponState.id) && weaponState.id ? toTitle(weaponState.id) : 'No Weapon')

  const overviewStats =
    selectedSimulation && selectedRuntime ? buildOverviewStatsView(selectedRuntime, selectedSimulation.finalStats) : null
  const statsTree =
    selectedSimulation ? buildStatsTree(selectedSimulation.finalStats) : null

  const selectedPersonalRotationRows = useMemo(
    () =>
      selectedRuntime && selectedSeed
        ? listRotationFeatureRows(
            selectedSeed,
            selectedRuntime,
            selectedParticipantRuntimesById,
            seedResonatorsById,
            'personal',
          )
        : [],
    [selectedParticipantRuntimesById, selectedRuntime, selectedSeed],
  )
  const selectedTeamRotationRows = useMemo(
    () =>
      selectedRuntime && selectedSeed
        ? listRotationFeatureRows(
            selectedSeed,
            selectedRuntime,
            selectedParticipantRuntimesById,
            seedResonatorsById,
            'team',
          )
        : [],
    [selectedParticipantRuntimesById, selectedRuntime, selectedSeed],
  )
  const selectedPersonalRotationCount = selectedPersonalRotationRows.filter((entry) => entry.enabled).length || selectedPersonalRotationRows.length
  const selectedTeamRotationCount = selectedTeamRotationRows.filter((entry) => entry.enabled).length || selectedTeamRotationRows.length

  const personalRotation = selectedSimulation?.rotations.personal.total ?? null
  const teamRotation = selectedSimulation?.rotations.team.total ?? null
  const topSkillTypes = selectedSimulation
    ? groupByAverage(
        selectedSimulation.rotations.personal.entries,
        (entry) => getPrimarySkillType(entry.skill.skillType) ?? 'all',
        (entry) => getSkillTypeDisplay(entry.skill.skillType).label,
        (entry) => entry.avg,
      )
    : []
  const topContributors = selectedSimulation
    ? groupByAverage(
        selectedSimulation.rotations.team.entries,
        (entry) => entry.resonatorId,
        (entry) => entry.resonatorName,
        (entry) => entry.avg,
      )
    : []

  const equippedEchoes = selectedRuntime?.build.echoes ?? []
  const equippedEchoCount = equippedEchoes.filter((echo): echo is EchoInstance => Boolean(echo)).length
  const echoCostSpread = equippedEchoes
    .filter((echo): echo is EchoInstance => Boolean(echo))
    .map((echo) => getEchoCostById(echo.id, 1))
    .join('-')

  const supportMembers = (selectedRuntime?.build.team.slice(1) ?? [null, null]).map((memberId, index) => {
    const resonator = memberId ? getResonator(memberId) : null
    const memberRuntime = memberId ? selectedParticipantRuntimesById[memberId] ?? null : null
    return {
      slotLabel: index === 0 ? 'Support Alpha' : 'Support Beta',
      resonator,
      runtime: memberRuntime,
    }
  })

  const supportWeapons = supportMembers
    .map(({ resonator, runtime: supportRuntime }) => {
      if (!resonator || !supportRuntime) return null
      const supportWeaponState = supportRuntime.build.weapon
      const supportWeapon =
        supportWeaponState.id && !isUnsetWeaponId(supportWeaponState.id)
          ? getWeaponById(supportWeaponState.id)
          : null
      const supportWeaponVisualKey =
        supportWeapon?.weaponType != null
          ? getWeaponVisualKey(supportWeapon.weaponType)
          : getWeaponVisualKey(resonator.weaponType)

      return {
        id: resonator.id,
        icon: supportWeaponVisualKey ? `/assets/weapons/${supportWeaponVisualKey}.webp` : null,
        label: supportWeapon?.name ?? 'Weapon Pending',
        detail: `R${supportWeaponState.rank ?? 1}`,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  const setBuffs = Array.from(
      new Map(
          equippedEchoes
              .filter((echo): echo is EchoInstance => Boolean(echo))
              .map((echo) => {
                const setIcon = getSonataSetIcon(echo.set)
                const setName = getSonataSetName(echo.set)

                return [
                  echo.set,
                  {
                    id: echo.set,
                    icon: setIcon,
                    name: setName,
                  },
                ]
              }),
      ).values(),
  ).slice(0, 2)

  const memberCount = selectedRuntime?.build.team.filter((memberId): memberId is string => Boolean(memberId)).length ?? 0

  const hasWeights = useMemo(() => getMaxEchoScore(selectedRuntime?.id) > 0, [selectedRuntime?.id])
  const totals = aggregateEchoStats(equippedEchoes)
  const totalCV = (totals.critRate ?? 0) * 2 + (totals.critDmg ?? 0)

  const buildScore = hasWeights ? getBuildScorePercent(selectedRuntime.id, equippedEchoes) : null

  const renderStateGroup = (group: OverviewStateSummaryGroup) => (
    <Expandable
      key={group.id}
      as="article"
      className="calculator-hero-state-card"
      triggerClassName="calculator-hero-state-expandable-trigger"
      contentClassName="calculator-hero-state-expandable"
      contentInnerClassName="calculator-hero-state-scopes"
      chevronClassName="calculator-hero-state-chevron"
      chevronSize={14}
      defaultOpen
      header={
        <div className="calculator-hero-state-card-head">
          <div className="calculator-hero-state-source">
            <span className="calculator-hero-state-source-frame">
              <img
                src={group.sourceProfile || '/assets/default-icon.webp'}
                alt={group.sourceName}
                className="calculator-hero-state-source-image"
                loading="lazy"
                decoding="async"
                onError={onImageError}
              />
            </span>
            <div className="calculator-hero-state-source-copy">
              <span>Resonator Source</span>
              <strong>{group.sourceName}</strong>
            </div>
          </div>
          <span className="calculator-hero-state-badge">
            {group.scopes.length} {group.scopes.length === 1 ? 'branch' : 'branches'}
          </span>
        </div>
      }
    >
      {group.scopes.map((scope) => (
        <section key={scope.id} className="calculator-hero-state-scope">
          <div className="calculator-hero-state-scope-head">
            <span className="calculator-hero-state-scope-label">{scope.label}</span>
            <span className="calculator-hero-state-badge">
              {scope.nodes.length} {scope.nodes.length === 1 ? 'node' : 'nodes'}
            </span>
          </div>

          <div className="calculator-hero-state-nodes">
            {scope.nodes.map((node) => (
              <section key={node.id} className="calculator-hero-state-node">
                <div className="calculator-hero-state-node-head">
                  <div>
                    <strong>{node.ownerLabel}</strong>
                  </div>
                </div>

                <ul className="calculator-hero-state-effects">
                  {node.effectLabels.length > 0 ? (
                      node.effectLabels.map((label, index) => (
                          <li
                              key={`${node.id}-${index}`}
                              dangerouslySetInnerHTML={{ __html: label }}
                          />
                      ))
                  ) : (
                      <li>Active.</li>
                  )}
                </ul>
              </section>
            ))}
          </div>
        </section>
      ))}
    </Expandable>
  )

  return (
    <div
      className="character-overview-pane"
      style={{ '--resonator-accent': activeAccent } as CSSProperties}
    >
      <div className="character-overview-header">
        <h2>Overview</h2>
        <button type="button" onClick={onClose} className="character-overview-close">
          ← Back
        </button>
      </div>

      <div className="character-overview-content">
        <nav className="overview-resonator-strip" aria-label="Resonator browser">
          {availableResonators.length > 0 ? (
            availableResonators.map(({ id, name, resonator, runtime: resonatorRuntime, accent }, i) => {
              const isSelected = id === selectedEntry?.id
              const isActive = id === runtime?.id

              return (
                <button
                  key={id}
                  type="button"
                  className={`overview-resonator-pill ${isSelected ? 'selected' : ''}`.trim()}
                  onClick={() => setSelectedResonatorId(id)}
                  aria-pressed={isSelected}
                  style={{ '--browser-accent': accent, '--pill-index': i } as CSSProperties}
                >
                  <img
                    src={resonator?.profile ?? '/assets/default-icon.webp'}
                    alt={name}
                    className="overview-resonator-pill-avatar"
                    loading="lazy"
                    decoding="async"
                    onError={onImageError}
                  />
                  <div className="overview-resonator-pill-copy">
                    <span className="overview-resonator-pill-name">{name}</span>
                    <span className="overview-resonator-pill-meta">Lv.{resonatorRuntime.base.level} · S{resonatorRuntime.base.sequence}</span>
                  </div>
                  {isActive ? ( <span className="overview-portrait-badge">current</span> ) : null}
                </button>
              )
            })
          ) : (
            <div className="placeholder">No initialized resonator runtimes.</div>
          )}
        </nav>

        <div className="overview-dashboard">
          {selectedEntry && selectedRuntime ? (
            <div className="overview-dashboard-layout">
              <div className="overview-dashboard-left">
              <div className="overview-mosaic">
                {/* ── Portrait cell ── */}
                <div className="overview-cell overview-cell--portrait">
                  <div className="overview-portrait-inner">
                    <div className="overview-portrait-details">
                      <span className="overview-portrait-name">{activeResonatorName}</span>
                      <span className="overview-portrait-level">Lv.{selectedRuntime.base.level ?? 1}</span>
                    </div>
                    <div className="portrait-ops">
                      {selectedRuntime?.id !== runtime?.id ? (
                        <button
                          className="team-state-badge overview-badge-button"
                          onClick={() => switchToResonator(selectedRuntime?.id)}
                        >
                          Switch
                        </button>
                      ) : null}
                      <button
                        className="team-state-badge overview-badge-button ui-pill-button-danger"
                        onClick={handleDeleteResonator}
                      >
                        Delete
                      </button>
                    </div>
                    <div className="overview-portrait-frame">
                      <img
                        key={activeResonator?.sprite ?? activeResonator?.profile ?? 'default'}
                        src={activeResonator?.sprite ?? activeResonator?.profile ?? '/assets/default-icon.webp'}
                        alt={activeResonatorName}
                        className="overview-portrait-img"
                        loading="lazy"
                        decoding="async"
                        onError={onImageError}
                      />
                    </div>
                    <div className="overview-portrait-badges">
                      <span className="overview-portrait-badge">{isSelectedResonatorActive ? 'Live' : 'Init'}</span>
                      {totalCV > 0 ? (
                        <span className={`${getCvBadgeClass((totalCV - 44)/5)} overview-portrait-badge`}>
                          CV {totalCV.toFixed(1)}
                        </span>
                      ) : null}
                      {buildScore !== null ? (
                        <span className={`${getScoreBadgeClass(buildScore)} overview-portrait-badge echo-score-badge--build`}>
                          {buildScore.toFixed(1)}%
                        </span>
                      ) : null}
                      {setBuffs.map((entry) => (
                        <span key={`s:${entry.id}`} className="overview-portrait-badge">
                          {entry.icon ? (
                            <img
                              src={entry.icon}
                              alt={entry.name}
                              className="overview-echo-set-icon"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : null}
                            {entry.name}
                        </span>
                      ))}
                      <span className="overview-portrait-badge">{`${equippedEchoCount}/5 Echoes${echoCostSpread ? ` · ${echoCostSpread}` : ''}`}</span>
                    </div>
                  </div>
                </div>

                {/* ── Stats cell ── */}
                <div className="overview-cell overview-cell--stats">
                  <span className="overview-cell-label">Combat Stats</span>
                  {overviewStats ? (
                    <>
                      <div className="overview-main-metrics">
                        {overviewStats.mainStats.map((stat) => (
                          <div key={stat.label} className="overview-metric-tile">
                            <div className="overview-metric-tile-head">
                              {STAT_ICON_MAP[stat.label] ? (
                                <div
                                  className="grid-stat-icon overview"
                                  style={{
                                    '--stat-color': stat.color ?? '#999999',
                                    WebkitMaskImage: `url(${STAT_ICON_MAP[stat.label]})`,
                                    maskImage: `url(${STAT_ICON_MAP[stat.label]})`,
                                  } as CSSProperties}
                                />
                              ) : null}
                              <span>{stat.label}</span>
                            </div>
                            <span className="overview-metric-tile-value">{formatDisplayValue(stat.label, stat.total)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="overview-secondary-list">
                        {overviewStats.secondaryStats.map((stat) => (
                          <div key={stat.label} className="overview-secondary-row">
                            <span className="overview-secondary-label">
                              {STAT_ICON_MAP[stat.label] ? (
                                <div
                                  className="grid-stat-icon overview small"
                                  style={{
                                    '--stat-color': stat.color ?? '#999999',
                                    WebkitMaskImage: `url(${STAT_ICON_MAP[stat.label]})`,
                                    maskImage: `url(${STAT_ICON_MAP[stat.label]})`,
                                  } as CSSProperties}
                                />
                              ) : null}
                              {stat.label}
                            </span>
                            <span className="overview-secondary-value">{formatDisplayValue(stat.label, stat.total)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="overview-secondary-list">
                        {overviewStats.damageModifierStats.map((stat) => (
                          <div key={stat.label} className="overview-secondary-row">
                            <span
                              className="overview-secondary-label"
                              style={stat.color ? ({ color: stat.color } as CSSProperties) : undefined}
                            >
                              {STAT_ICON_MAP[stat.label] ? (
                                <div
                                  className="grid-stat-icon overview small"
                                  style={{
                                    '--stat-color': stat.color ?? '#999999',
                                    WebkitMaskImage: `url(${STAT_ICON_MAP[stat.label]})`,
                                    maskImage: `url(${STAT_ICON_MAP[stat.label]})`,
                                  } as CSSProperties}
                                />
                              ) : null}
                              {stat.label.replace(' DMG Bonus', '')}
                            </span>
                            <span
                              className="overview-secondary-value"
                              style={stat.color ? ({ color: stat.color } as CSSProperties) : undefined}
                            >
                              {formatDisplayValue(stat.label, stat.total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="overview-stats-placeholder">No live stat matrix.</div>
                  )}
                </div>

                {/* ── Equipment cell ── */}
                <div className="overview-cell overview-cell--equip">
                  <span className="overview-cell-label">Equipment & Team</span>
                  <div className="overview-weapon-strip">
                    <div className="overview-weapon-icon-wrap">
                      {weapon?.icon ? (
                        <img
                          src={weapon.icon}
                          alt={weaponName}
                          className="overview-weapon-icon"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : weaponVisualKey ? (
                        <img
                          src={`/assets/weapons/${weaponVisualKey}.webp`}
                          alt={weaponName}
                          className="overview-weapon-icon"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="overview-weapon-icon overview-weapon-icon--fallback">W</div>
                      )}
                    </div>
                    <div className="overview-weapon-copy">
                      <strong className="overview-weapon-name">{weaponName}</strong>
                      <span className="overview-weapon-meta">
                        Lv.{weaponState?.level ?? 1} · R{weaponState?.rank ?? 1}
                        {weapon ? ` · ${formatStatKeyLabel(weapon.statKey)} ${formatStatKeyValue(weapon.statKey, weapon.statValue)}` : ''}
                        {' · '}ATK: {weaponState?.baseAtk ? weaponState.baseAtk : weapon?.baseAtk ?? '--'}
                      </span>
                    </div>
                  </div>

                  <div className="overview-team-row">
                    {supportMembers.map(({ resonator, slotLabel }, index) => (
                      <div key={`${slotLabel}:${resonator?.id ?? index}`} className="overview-team-member">
                        {resonator?.profile ? (
                          <img
                            src={resonator.profile}
                            alt={resonator.name}
                            className="overview-team-avatar"
                            loading="lazy"
                            decoding="async"
                            onError={onImageError}
                          />
                        ) : (
                          <div className="overview-team-avatar overview-team-avatar--empty" />
                        )}
                        <span>{resonator?.name ?? slotLabel}</span>
                      </div>
                    ))}
                  </div>

                  <div className="overview-inline-buffs">
                    {supportWeapons.map((entry) => (
                      <span key={`w:${entry.id}`} className="overview-inline-buff">
                        {entry.icon ? (
                          <img src={entry.icon} alt={entry.label} className="overview-inline-buff-icon" loading="lazy" decoding="async" />
                        ) : null}
                        {entry.label} {entry.detail}
                      </span>
                    ))}
                    {supportWeapons.length === 0 && setBuffs.length === 0 ? (
                      <span className="overview-inline-buff overview-inline-buff--empty">Nothing...</span>
                    ) : null}
                  </div>
                </div>

                {/* ── Rotation cell ── */}
                <div className="overview-cell overview-cell--rotation">
                  <span className="overview-cell-label">Rotation Damage</span>
                  <div className="overview-rotation-grid-header">
                    <span />
                    <span>Personal</span>
                    <span>Team</span>
                  </div>
                  <div className="overview-rotation-grid-row">
                    <strong className="label">Normal</strong>
                    <span className="value">{formatCompactNumber(personalRotation?.normal ?? null)}</span>
                    <span className="value">{formatCompactNumber(teamRotation?.normal ?? null)}</span>
                  </div>
                  <div className="overview-rotation-grid-row">
                    <strong className="label">CRIT</strong>
                    <span className="value">{formatCompactNumber(personalRotation?.crit ?? null)}</span>
                    <span className="value">{formatCompactNumber(teamRotation?.crit ?? null)}</span>
                  </div>
                  <div className="overview-rotation-grid-row overview-rotation-grid-row--avg">
                    <strong className="label">AVG</strong>
                    <span className="value avg">{formatCompactNumber(personalRotation?.avg ?? null)}</span>
                    <span className="value avg">{formatCompactNumber(teamRotation?.avg ?? null)}</span>
                  </div>
                  <div className="overview-rotation-grid-footer">
                    <span />
                    <span>
                      {getRotationFooter(
                        topSkillTypes[0] ? `${topSkillTypes[0].label} · ${selectedPersonalRotationCount}n` : null,
                        'No rotation',
                      )}
                    </span>
                    <span>
                      {getRotationFooter(
                        topContributors[0] ? `${topContributors[0].label} · ${selectedTeamRotationCount}n` : null,
                        'No rotation',
                      )}
                    </span>
                  </div>
                </div>

              </div>

                {/* ── Echoes cell ── */}
                <div className="overview-cell overview-cell--echoes">
                  {Array.from({ length: 5 }, (_, index) => {
                    const echo = equippedEchoes[index] ?? null
                    const echoDefinition = echo?.id ? getEchoById(echo.id) : null
                    const echoCost = echo ? getEchoCostById(echo.id) : 0

                    const setIcon = echo ? getSonataSetIcon(echo.set) : null
                    const substatEntries = echo ? Object.entries(echo.substats) : []
                    const echoScore = echo && selectedEntry && selectedEntryHasEchoWeights
                      ? getEchoScorePercent(selectedEntry.id, echo)
                      : null
                    const echoCv = echo ? computeEchoCritValue(echo.substats) : 0

                    return (
                      <article key={`echo:${index}`} className="overview-echo-tile">
                        {echo ? (
                          <>
                            <div className="overview-echo-tile-head">
                              {echoDefinition?.icon ? (
                                <img
                                  src={echoDefinition.icon}
                                  alt={echoDefinition.name}
                                  className="overview-echo-glyph"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="overview-echo-glyph" />
                              )}
                              <div className="overview-echo-tile-info">
                                <strong>{echoDefinition?.name ?? toTitle(echo.id)}</strong>
                                <div className="overview-echo-tile-meta">
                                  {setIcon ? (
                                    <img src={setIcon} alt="" className="overview-echo-set-icon" loading="lazy" />
                                  ) : null}
                                  <span className="echo-slot-cost overview-echo-cost">{echoCost}C</span>
                                  {echoScore !== null ? (
                                    <span className={getScoreBadgeClass(echoScore)}>{echoScore.toFixed(1)}%</span>
                                  ) : null}
                                  {echoCv > 0 ? (
                                    <span className={getCvBadgeClass(echoCv)}>CV {echoCv.toFixed(1)}</span>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div className="overview-echo-tile-stats">
                              <div className="overview-echo-stat overview-echo-stat--primary">
                                <span className="overview-echo-stat-label">{formatStatKeyLabel(echo.mainStats.primary.key)}</span>
                                <span className="overview-echo-stat-value">{formatStatKeyValue(echo.mainStats.primary.key, echo.mainStats.primary.value)}</span>
                              </div>
                              <div className="overview-echo-stat overview-echo-stat--secondary">
                                <span className="overview-echo-stat-label">{formatStatKeyLabel(echo.mainStats.secondary.key)}</span>
                                <span className="overview-echo-stat-value">{formatStatKeyValue(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}</span>
                              </div>
                              {substatEntries.length > 0 ? (
                                <div className="overview-echo-subs">
                                  {substatEntries.map(([key, val]) => (
                                    <div key={key} className="overview-echo-stat overview-echo-stat--sub">
                                      <span className="overview-echo-stat-label">{formatStatKeyLabel(key)}</span>
                                      <span className="overview-echo-stat-value">{formatStatKeyValue(key, val)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <div className="overview-echo-tile-empty">Empty</div>
                        )}
                      </article>
                    )
                  })}
                </div>

                {statsTree && statsTree.length > 0 ? (
                  <div className="overview-stats-tree">
                    <span className="overview-cell-label">Stat Breakdown</span>
                    <div className="overview-tree-children">
                      {statsTree.map((node) => (
                        <StatsTreeNodeView key={node.key} node={node} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <section className="calculator-hero-state-summary ui-surface-card ui-surface-card--section" aria-label="Active state sources">
                <div className="calculator-hero-panel-head calculator-hero-state-summary-head">
                  <div>
                    <span className="calculator-hero-stat-label">Active State Sources</span>
                    <h2>Resolved buff topology</h2>
                  </div>
                  <div className="calculator-hero-inline-pills">
                    <span className="calculator-hero-pill">
                      {selectedOverviewStateSummary.length} active {selectedOverviewStateSummary.length === 1 ? 'root' : 'roots'}
                    </span>
                    <span className="calculator-hero-pill">{memberCount}/3 linked resonators</span>
                  </div>
                </div>

                <div
                  className={[
                    'calculator-hero-state-layout',
                    activeOverviewStateGroup && supportingOverviewStateGroups.length > 0
                      ? ''
                      : 'calculator-hero-state-layout--single',
                  ].filter(Boolean).join(' ')}
                >
                  {selectedOverviewStateSummary.length > 0 ? (
                    <>
                      {activeOverviewStateGroup ? (
                        <div className="calculator-hero-state-column calculator-hero-state-column--active">
                          {renderStateGroup(activeOverviewStateGroup)}
                        </div>
                      ) : null}
                      {supportingOverviewStateGroups.length > 0 ? (
                        <div className="calculator-hero-state-column calculator-hero-state-column--support">
                          {supportingOverviewStateGroups.map(renderStateGroup)}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <article className="calculator-hero-state-card calculator-hero-state-card--empty">
                      <div className="calculator-hero-state-card-head">
                        <div className="calculator-hero-state-source-copy">
                          <span>Overview</span>
                          <strong>No active state sources</strong>
                        </div>
                      </div>
                      <ul className="calculator-hero-state-effects">
                        <li>
                          No active state sources
                        </li>
                      </ul>
                    </article>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="placeholder">No resonator selected.</div>
          )}
        </div>

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
      </div>
    </div>
  )
}
