import { type CSSProperties, useCallback, useMemo, useState } from 'react'
import { Settings2, Swords } from 'lucide-react'
import { isUnsetWeaponId, type ResonatorRuntimeState } from '@/domain/entities/runtime'
import { cloneEchoLoadout, type InventoryBuildEntry } from '@/domain/entities/inventoryStorage'
import type { ResonatorStateControl } from '@/domain/entities/resonator'
import type { SourceStateDefinition } from '@/domain/gameData/contracts'
import { listWeaponsByType } from '@/domain/services/weaponCatalogService'
import { listStatesForSource, listOwnersForSource } from '@/domain/services/gameDataService'
import { applyCascadeResets, getStateTeamTargetMode, getTeamTargetOptions, isSourceStateVisible } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { RuntimeEchoSetBonuses, RuntimeMainEchoPanel } from '@/modules/calculator/components/workspace/panes/left/controls/EchoRuntimePanels'
import { ManualBuffEditor } from '@/modules/calculator/components/workspace/panes/left/controls/ManualBuffEditor'
import {
  STAT_ICON_MAP,
  formatDisplayValue,
  type OverviewStatsView,
} from '@/modules/calculator/model/overviewStats'
import { getWeapon, resolveWeaponStatsAtLevel, resolvePassiveParams } from '@/modules/calculator/model/weapon'
import { SourceStateControl } from '@/modules/calculator/components/workspace/panes/left/controls/SourceStateControl'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { RichDescription } from '@/shared/ui/RichDescription'
import { ModalCloseButton } from '@/shared/ui/ModalCloseButton'
import { AppDialog } from '@/shared/ui/AppDialog'
import type { ResonatorView } from '@/modules/calculator/model/resonator'

// surface the team member config modal that combines state controls, build picks, and stats.
interface TeamMemberConfigModalProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  member: ResonatorView
  runtime: ResonatorRuntimeState
  activeRuntime: ResonatorRuntimeState
  inventoryBuilds: InventoryBuildEntry[]
  stateDefinitions: SourceStateDefinition[]
  combatStatsView: OverviewStatsView | null
  onSequenceChange: (value: number) => void
  onRuntimeUpdate: RuntimeUpdateHandler
  getSelectedTarget: (ownerKey: string) => string | null
  setSelectedTarget: (ownerKey: string, targetResonatorId: string | null) => void
  onClose: () => void
}

function CompactCombatStats({
  statsView,
}: {
  statsView: OverviewStatsView | null
}) {
  if (!statsView) {
    return (
      <div className="soft-empty team-member-config-modal__empty">
        Combat stats are unavailable for this teammate.
      </div>
    )
  }

  return (
    <div className="team-member-config-modal__combat-stats">
      <div className="overview-main-metrics">
        {statsView.mainStats.map((stat) => (
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
        {statsView.secondaryStats.map((stat) => (
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
        {statsView.damageModifierStats.map((stat) => (
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
    </div>
  )
}

export function TeamMemberConfigModal({
  visible,
  open,
  closing = false,
  portalTarget,
  member,
  runtime,
  activeRuntime,
  inventoryBuilds,
  stateDefinitions,
  combatStatsView,
  onSequenceChange,
  onRuntimeUpdate,
  getSelectedTarget,
  setSelectedTarget,
  onClose,
}: TeamMemberConfigModalProps) {
  const [selectedBuildId, setSelectedBuildId] = useState<string>('')

  const availableControls = useMemo(() => [
    ...member.statePanels.flatMap((panel) => panel.controls),
    ...member.resonanceChains
      .map((entry) => entry.control ?? entry.toggleControl)
      .filter((c): c is ResonatorStateControl => Boolean(c)),
  ], [member])

  const cascadedRuntimeUpdate: RuntimeUpdateHandler = useCallback((updater) => {
    onRuntimeUpdate((prev) => {
      const next = updater(prev)
      const cascadedControls = applyCascadeResets(
        prev.state.controls,
        next.state.controls,
        availableControls,
      )
      return {
        ...next,
        state: { ...next.state, controls: cascadedControls },
      }
    })
  }, [onRuntimeUpdate, availableControls])

  const weapons = useMemo(() => listWeaponsByType(member.weaponType), [member.weaponType])
  const weaponId = runtime.build.weapon.id
  const weaponDef = useMemo(() => getWeapon(weaponId), [weaponId])
  const currentRank = runtime.build.weapon.rank

  const passiveParams = useMemo(
    () => (weaponDef ? resolvePassiveParams(weaponDef.passive.params, currentRank) : []),
    [weaponDef, currentRank],
  )

  const weaponOwner = useMemo(() => {
    if (!weaponId || isUnsetWeaponId(weaponId)) return null
    const owners = listOwnersForSource('weapon', weaponId)
    return owners[0] ?? null
  }, [weaponId])

  const weaponStates = useMemo(() => {
    if (!weaponId || isUnsetWeaponId(weaponId)) return []
    return listStatesForSource('weapon', weaponId).filter((state) =>
      isSourceStateVisible(runtime, runtime, state, activeRuntime),
    )
  }, [activeRuntime, weaponId, runtime])

  const weaponOptions = useMemo(
    () => weapons.map((w) => ({ value: w.id, label: w.name, icon: w.icon })),
    [weapons],
  )

  const buildOptions = useMemo(
    () => inventoryBuilds.map((entry) => ({
      value: entry.id,
      label: `${entry.name} - ${entry.resonatorName}`,
    })),
    [inventoryBuilds],
  )

  const resolvedSelectedBuildId =
    selectedBuildId && inventoryBuilds.some((entry) => entry.id === selectedBuildId)
      ? selectedBuildId
      : (inventoryBuilds[0]?.id ?? '')

  const selectedBuild = useMemo(
    () => inventoryBuilds.find((entry) => entry.id === resolvedSelectedBuildId) ?? null,
    [inventoryBuilds, resolvedSelectedBuildId],
  )

  const handleWeaponChange = useCallback((nextWeaponId: string) => {
    const selected = weapons.find((w) => w.id === nextWeaponId)
    if (!selected) return
    const stats = resolveWeaponStatsAtLevel(selected, 90)
    const newWeaponStates = listStatesForSource('weapon', nextWeaponId)

    onRuntimeUpdate((prev) => {
      const nextControls = { ...prev.state.controls }
      // Clear old weapon states
      if (prev.build.weapon.id && !isUnsetWeaponId(prev.build.weapon.id)) {
        const oldPrefix = `weapon:${prev.build.weapon.id}:`
        for (const key of Object.keys(nextControls)) {
          if (key.startsWith(oldPrefix)) {
            delete nextControls[key]
          }
        }
      }
      // Apply new weapon state defaults
      for (const state of newWeaponStates) {
        if (state.defaultValue !== undefined) {
          const controlKey = state.path.replace(/^runtime\.state\.controls\./, '')
          nextControls[controlKey] = state.defaultValue
        }
      }

      return {
        ...prev,
        build: {
          ...prev.build,
          weapon: { id: selected.id, level: 90, rank: 1, baseAtk: stats.atk },
        },
        state: { ...prev.state, controls: nextControls },
      }
    })
  }, [weapons, onRuntimeUpdate])

  const handleRankChange = useCallback((rank: number) => {
    const nextRank = Math.max(1, Math.min(5, Math.round(rank)))
    onRuntimeUpdate((prev) => ({
      ...prev,
      build: { ...prev.build, weapon: { ...prev.build.weapon, rank: nextRank } },
    }))
  }, [onRuntimeUpdate])

  const handleLoadBuild = useCallback(() => {
    if (!selectedBuild) {
      return
    }

    onRuntimeUpdate((prev) => {
      const buildWeaponId = selectedBuild.build.weapon.id
      const buildWeapon = buildWeaponId && !isUnsetWeaponId(buildWeaponId) ? getWeapon(buildWeaponId) : null
      const weaponMatchesType = buildWeapon?.weaponType === member.weaponType
      const buildWeaponStats = weaponMatchesType && buildWeapon
        ? resolveWeaponStatsAtLevel(buildWeapon, 90)
        : null
      let nextControls = prev.state.controls

      if (weaponMatchesType && buildWeaponId) {
        nextControls = { ...prev.state.controls }

        if (prev.build.weapon.id && !isUnsetWeaponId(prev.build.weapon.id)) {
          const oldPrefix = `weapon:${prev.build.weapon.id}:`
          for (const key of Object.keys(nextControls)) {
            if (key.startsWith(oldPrefix)) {
              delete nextControls[key]
            }
          }
        }

        for (const state of listStatesForSource('weapon', buildWeaponId)) {
          if (state.defaultValue !== undefined) {
            const controlKey = state.path.replace(/^runtime\.state\.controls\./, '')
            nextControls[controlKey] = state.defaultValue
          }
        }
      }

      return {
        ...prev,
        build: {
          ...prev.build,
          weapon: weaponMatchesType
            ? {
                ...prev.build.weapon,
                id: selectedBuild.build.weapon.id,
                level: 90,
                rank: selectedBuild.build.weapon.rank,
                baseAtk: buildWeaponStats?.atk ?? prev.build.weapon.baseAtk,
              }
            : prev.build.weapon,
          echoes: cloneEchoLoadout(selectedBuild.build.echoes),
        },
        state: {
          ...prev.state,
          controls: nextControls,
        },
      }
    })
  }, [member.weaponType, onRuntimeUpdate, selectedBuild])

  if (!visible || !portalTarget) {
    return null
  }

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      contentClassName="app-modal-panel app-modal-panel--wide team-member-config-modal"
      ariaLabelledBy="team-member-config-title"
      onClose={onClose}
    >
      <div className="app-modal-header team-member-config-modal__header team-member-config-modal__hero"
           onClick={(event) => event.stopPropagation()}>
        <div className="team-member-config-modal__hero-main">
          <div className="team-member-config-modal__hero-id">
              <span className={`picker-modal__media-frame team-member-config-modal__avatar team-member-config-modal__avatar-frame rarity-${member.rarity}`}>
                <img src={member.profile} alt={member.name} className="picker-modal__media-image" />
              </span>

            <div className="team-member-config-modal__heading">
              <div className="team-member-config-modal__eyebrow">Teammate</div>

              <div className="team-member-config-modal__hero-title-row">
                <div className="team-member-config-modal__copy">
                  <h2 id="team-member-config-title" className="team-member-config-modal__title">
                    {member.name}
                  </h2>
                  <p className="team-member-config-modal__description">
                    Configure this teammate's runtime, build, and state setup here.
                  </p>
                </div>

                <div className="team-member-config-modal__hero-pills">
                  <div className="team-member-config-modal__summary-pill">
                    <span className="team-member-config-modal__summary-label">Level</span>
                    <span className="team-member-config-modal__summary-value">Lv {runtime.base.level}</span>
                  </div>
                  <div className="team-member-config-modal__summary-pill">
                    <span className="team-member-config-modal__summary-label">Investment</span>
                    <span className="team-member-config-modal__summary-value">S{runtime.base.sequence} - R{currentRank}</span>
                  </div>
                  <div className="team-member-config-modal__summary-pill">
                    <span className="team-member-config-modal__summary-label">Current States</span>
                    <span className="team-member-config-modal__summary-value">{stateDefinitions.length + weaponStates.length}</span>
                  </div>
                  <div className="team-member-config-modal__summary-pill">
                    <span className="team-member-config-modal__summary-label">Weapon States</span>
                    <span className="team-member-config-modal__summary-value">{weaponStates.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <ModalCloseButton className="team-member-config-modal__close" onClick={onClose} />
        </div>
      </div>

      <div className="team-member-config-modal__workspace">
        <aside className="team-member-config-modal__rail">
          <section className="team-member-config-modal__section team-member-config-modal__section--config ui-surface-card ui-surface-card--section">
            <div className="team-member-config-modal__section-head">
              <div className="team-member-config-modal__section-title">
                  <span className="team-member-config-modal__section-icon" aria-hidden="true">
                    <Settings2 size={16} />
                  </span>
                <div className="team-member-config-modal__section-copy">
                  <h3>Runtime</h3>
                </div>
              </div>
            </div>

            <div className="team-member-config-modal__config-stack">
              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Load Build</span>
                  <span className="team-state-badge">{inventoryBuilds.length}</span>
                </div>

                <div className="team-member-config-modal__build-loader">
                  <LiquidSelect
                    value={resolvedSelectedBuildId}
                    options={buildOptions}
                    disabled={buildOptions.length === 0}
                    placeholder="No saved builds"
                    onChange={setSelectedBuildId}
                  />
                  <button
                    type="button"
                    className="ui-pill-button team-member-config-modal__build-loader-action"
                    disabled={!selectedBuild}
                    onClick={handleLoadBuild}
                  >
                    Load Build
                  </button>
                </div>
              </section>

              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Sequence</span>
                  <span className="team-state-badge">S{runtime.base.sequence}</span>
                </div>

                <div className="slider-group">
                  <div className="slider-controls">
                    <input
                        type="range"
                        min={0}
                        max={6}
                        value={runtime.base.sequence}
                        onChange={(event) => onSequenceChange(Number(event.target.value))}
                        style={{ '--slider-fill': `${(runtime.base.sequence / 6) * 100}%` } as CSSProperties}
                    />
                    <span>{runtime.base.sequence}</span>
                  </div>
                </div>
              </section>

              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Combat Stats</span>
                  <span className="team-state-badge">Live</span>
                </div>
                <CompactCombatStats statsView={combatStatsView} />
              </section>

              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Echo Sets</span>
                </div>
                <RuntimeEchoSetBonuses
                  runtime={runtime}
                  activeRuntime={activeRuntime}
                  onRuntimeUpdate={cascadedRuntimeUpdate}
                  getSelectedTarget={getSelectedTarget}
                  setSelectedTarget={setSelectedTarget}
                />
              </section>

              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Main Echo</span>
                </div>
                <RuntimeMainEchoPanel
                  runtime={runtime}
                  activeRuntime={activeRuntime}
                  onRuntimeUpdate={cascadedRuntimeUpdate}
                  getSelectedTarget={getSelectedTarget}
                  setSelectedTarget={setSelectedTarget}
                />
              </section>

              <ManualBuffEditor
                runtime={runtime}
                onRuntimeUpdate={onRuntimeUpdate}
                cardVariant="inner"
                showQuickStats={false}
              />
            </div>
          </section>
        </aside>

        <main className="team-member-config-modal__content">
          <section className="team-member-config-modal__section team-member-config-modal__section--config ui-surface-card ui-surface-card--section">
            <div className="team-member-config-modal__section-head">
              <div className="team-member-config-modal__section-title">
                  <span className="team-member-config-modal__section-icon" aria-hidden="true">
                    <Swords size={16} />
                  </span>
                <div className="team-member-config-modal__section-copy">
                  <h3>Weapon Setup</h3>
                  <span>Weapon stuff.</span>
                </div>
              </div>
            </div>

            <div className="team-member-config-modal__config-stack">
              <div className="team-member-config-modal__weapon-meta">
                <div className={`picker-modal__media-frame team-member-config-modal__avatar team-member-config-modal__avatar-frame rarity-${member.rarity}`}>
                  <img src={weaponDef?.icon ?? `/assets/weapon-icons/${weaponId}.webp`} alt={weaponDef?.name} className="picker-modal__media-image" />
                </div>

                <div>
                  <section className="team-state-config ui-surface-card ui-surface-card--inner">
                    <div className="team-member-config-modal__card-head">
                      <span className="team-state-config-title">Weapon</span>
                      <span className="team-state-badge">Lv 90</span>
                    </div>

                    <LiquidSelect
                        value={weaponId ?? ''}
                        options={weaponOptions}
                        onChange={handleWeaponChange}
                    />
                  </section>

                  <section className="team-state-config ui-surface-card ui-surface-card--inner">
                    <div className="team-member-config-modal__card-head">
                      <span className="team-state-config-title">Rank</span>
                      <span className="team-state-badge">R{currentRank}</span>
                    </div>

                    <div className="slider-group">
                      <div className="slider-controls">
                        <input
                            type="range"
                            min={1}
                            max={5}
                            value={currentRank}
                            onChange={(event) => handleRankChange(Number(event.target.value))}
                            style={{ '--slider-fill': `${((currentRank - 1) / 4) * 100}%` } as CSSProperties}
                        />
                        <span>{currentRank}</span>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              {(weaponOwner || weaponStates.length > 0) ? (
                  <section className="team-state-config ui-surface-card ui-surface-card--inner">
                    <div className="team-member-config-modal__card-head">
                      <span className="team-state-config-title">{weaponDef?.passive.name || 'Passive'}</span>
                      <span className="team-state-badge">
                        {weaponStates.length} {weaponStates.length === 1 ? 'state' : 'states'}
                      </span>
                    </div>

                    {weaponOwner?.description ? (
                        <div className="team-member-config-modal__weapon-desc">
                          <RichDescription
                              description={weaponOwner.description}
                              params={passiveParams}
                          />
                        </div>
                    ) : null}

                    {weaponStates.length > 0 ? (
                        <div className="team-member-config-modal__mini-state-grid">
                          {weaponStates.map((state) => {
                            const targetMode = getStateTeamTargetMode(state)
                            const teamTargetSelect = targetMode ? (() => {
                              const options = getTeamTargetOptions(activeRuntime, member.id, targetMode)
                              const currentValue = getSelectedTarget(state.ownerKey)
                              const fallbackValue = options[0]?.value ?? ''
                              const selectedValue =
                                  typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
                                      ? currentValue
                                      : fallbackValue

                              return (
                                  <label className="team-state-target">
                                    Active Resonator
                                    <LiquidSelect
                                        value={selectedValue}
                                        options={options}
                                        disabled={options.length <= 1}
                                        onChange={(nextValue) => setSelectedTarget(state.ownerKey, nextValue || null)}
                                    />
                                  </label>
                              )
                            })() : undefined

                            return (
                                <div key={state.controlKey} className="team-member-config-modal__state-row team-state-control team-member-config-modal__state-row--mini">
                                  <SourceStateControl
                                  sourceRuntime={runtime}
                                      targetRuntime={runtime}
                                      activeRuntime={activeRuntime}
                                      state={state}
                                      onRuntimeUpdate={cascadedRuntimeUpdate}
                                      teamTargetSelect={teamTargetSelect}
                                      descriptionParams={passiveParams}
                                  />
                                </div>
                            )
                          })}
                        </div>
                    ) : null}
                  </section>
              ) : null}
            </div>
          </section>
          <section className="team-member-config-modal__section team-member-config-modal__section--states ui-surface-card ui-surface-card--section">
            <div className="team-member-config-modal__section-head">
              <div className="team-member-config-modal__section-copy">
                <h3>State Gallery</h3>
                <span>States and target routing.</span>
              </div>
              <span className="team-state-badge">{stateDefinitions.length}</span>
            </div>

            {stateDefinitions.length > 0 ? (
                <div className="team-member-config-modal__state-gallery">
                  {stateDefinitions.map((state) => {
                    const targetMode = getStateTeamTargetMode(state)
                    const teamTargetSelect = targetMode ? (() => {
                      const options = getTeamTargetOptions(activeRuntime, member.id, targetMode)
                      const currentValue = getSelectedTarget(state.ownerKey)
                      const fallbackValue = options[0]?.value ?? ''
                      const selectedValue =
                          typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
                              ? currentValue
                              : fallbackValue

                      return (
                          <label className="team-state-target">
                            Active Resonator
                            <LiquidSelect
                                value={selectedValue}
                                options={options}
                                disabled={options.length <= 1}
                                onChange={(nextValue) => setSelectedTarget(state.ownerKey, nextValue || null)}
                            />
                          </label>
                      )
                    })() : undefined

                    return (
                        <div key={state.controlKey} className="team-member-config-modal__state-row team-state-control">
                          <SourceStateControl
                              sourceRuntime={runtime}
                              targetRuntime={runtime}
                              activeRuntime={activeRuntime}
                              state={state}
                              onRuntimeUpdate={cascadedRuntimeUpdate}
                              teamTargetSelect={teamTargetSelect}
                          />
                        </div>
                    )
                  })}
                </div>
            ) : (
                <div className="soft-empty team-member-config-modal__empty">
                  No visible states for this teammate right now.
                </div>
            )}
          </section>
        </main>
      </div>
    </AppDialog>
  )
}
