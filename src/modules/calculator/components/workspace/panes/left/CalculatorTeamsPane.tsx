import { useCallback, useMemo, useState } from 'react'
import { Wrench, X } from 'lucide-react'
import { isUnsetWeaponId, type ResonatorRuntimeState } from '@/domain/entities/runtime'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { listStatesForSource } from '@/domain/services/gameDataService'
import { buildRuntimeSourceCatalog } from '@/domain/services/runtimeSourceService'
import { findCombatParticipantSlotId, buildTransientCombatGraph } from '@/domain/state/combatGraph'
import { selectActiveTargetSelections, selectEnemyProfile } from '@/domain/state/selectors'
import { useAppStore } from '@/domain/state/store'
import { buildCombatContext } from '@/engine/pipeline/buildCombatContext'
import { ResonatorPickerModal } from '@/modules/calculator/components/resonator/modals/ResonatorPickerModal'
import { SourceStateControl } from '@/modules/calculator/components/workspace/panes/left/controls/SourceStateControl'
import { TeamMemberConfigModal } from '@/modules/calculator/components/workspace/panes/left/modals/TeamMemberConfigModal'
import {
  filterSourceStatesWithDependencies,
  getStateTeamTargetMode,
  getTeamTargetOptions,
  isSourceStateVisible,
  stateHasTeamFacingEffects,
  withDefaultResonatorImage,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { buildOverviewStatsView } from '@/modules/calculator/model/overviewStats'
import { RESONATOR_MENU, getResonator } from '@/modules/calculator/model/resonator'
import { buildSelectedTargetsByResonatorId } from '@/modules/calculator/model/teamTargets'
import { getWeapon, resolvePassiveParams, withDefaultWeaponImage } from '@/modules/calculator/model/weapon'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility.ts'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'
import { Expandable } from '@/shared/ui/Expandable'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'

// manages the team-building pane and surfaces the helper modals for slots and controls.
interface CalculatorTeamsPaneProps {
  runtime: ResonatorRuntimeState
  participantRuntimesById: Record<string, ResonatorRuntimeState>
  onRuntimeUpdate: RuntimeUpdateHandler
}

// manages the team-building pane and surfaces the helper modals for slots and controls.
const EXIT_DURATION_MS = 300

export function CalculatorTeamsPane({
  runtime,
  participantRuntimesById,
  onRuntimeUpdate,
}: CalculatorTeamsPaneProps) {
  const enemyProfile = useAppStore(selectEnemyProfile)
  const selectedTargetsByOwnerKey = useAppStore(selectActiveTargetSelections)
  const inventoryBuilds = useAppStore((state) => state.calculator.inventoryBuilds)
  const ensureTeamMemberRuntime = useAppStore((state) => state.ensureTeamMemberRuntime)
  const updateResonatorRuntime = useAppStore((state) => state.updateResonatorRuntime)
  const profilesById = useAppStore((state) => state.calculator.profiles)
  const setResonatorTargetSelection = useAppStore((state) => state.setResonatorTargetSelection)

  const [teamPickerSlotIndex, setTeamPickerSlotIndex] = useState<number | null>(null)
  const [configResonatorId, setConfigResonatorId] = useState<string | null>(null)
  const teamPicker = useAnimatedVisibility(EXIT_DURATION_MS)
  const configModal = useAnimatedVisibility(EXIT_DURATION_MS)
  const {
    closing: teamPickerClosing,
    hide: hideTeamPicker,
    open: teamPickerOpen,
    show: showTeamPicker,
    visible: teamPickerVisible,
  } = teamPicker
  const {
    closing: configModalClosing,
    hide: hideConfigModal,
    open: configModalOpen,
    show: showConfigModal,
    visible: configModalVisible,
  } = configModal
  const modalPortalTarget = getMainContentPortalTarget()

  const closeTeamPicker = useCallback(() => {
    hideTeamPicker(() => {
      setTeamPickerSlotIndex(null)
    })
  }, [hideTeamPicker])

  const openTeamPicker = useCallback((slotIndex: number) => {
    if (slotIndex === 0) {
      return
    }

    setTeamPickerSlotIndex(slotIndex)
    showTeamPicker()
  }, [showTeamPicker])

  const closeConfigModal = useCallback(() => {
    hideConfigModal(() => {
      setConfigResonatorId(null)
    })
  }, [hideConfigModal])

  const openConfigModal = useCallback((resonatorId: string) => {
    setConfigResonatorId(resonatorId)
    showConfigModal()
  }, [showConfigModal])

  const selectTeamMember = useCallback((slotIndex: number, nextMemberId: string | null) => {
    if (nextMemberId) {
      const fullSeed = getResonatorSeedById(nextMemberId)
      if (fullSeed) {
        ensureTeamMemberRuntime(fullSeed)
      }
    }

    onRuntimeUpdate((prev) => {
      const nextTeam = [...prev.build.team] as ResonatorRuntimeState['build']['team']
      nextTeam[slotIndex] = nextMemberId
      return {
        ...prev,
        build: {
          ...prev.build,
          team: nextTeam,
        },
      }
    })
  }, [ensureTeamMemberRuntime, onRuntimeUpdate])

  const eligibleTeamPickerResonators = useMemo(() => {
    if (teamPickerSlotIndex === null || teamPickerSlotIndex === 0) {
      return []
    }

    const blockedIds = new Set(
      runtime.build.team.filter(
        (memberId, memberIndex): memberId is string => Boolean(memberId) && memberIndex !== teamPickerSlotIndex,
      ),
    )

    return RESONATOR_MENU.filter((entry) => !blockedIds.has(entry.id))
  }, [runtime.build.team, teamPickerSlotIndex])

  const activeSlotLabel = teamPickerSlotIndex === null ? 'Teammate' : `Teammate ${teamPickerSlotIndex}`

  const configMember = configResonatorId ? getResonator(configResonatorId) : null
  const configRuntime = configResonatorId ? participantRuntimesById[configResonatorId] ?? null : null
  const configVisibleStates = useMemo(() => {
    if (!configRuntime) {
      return []
    }

    return buildRuntimeSourceCatalog(configRuntime).states.filter((state) =>
      isSourceStateVisible(configRuntime, configRuntime, state, runtime),
    )
  }, [configRuntime, runtime])
  const configStates = useMemo(
    () => configVisibleStates.filter(
      (state) =>
        state.source.type !== 'echo'
        && !stateHasTeamFacingEffects(state, { includeTeamWide: true }),
    ),
    [configVisibleStates],
  )
  const configCombatStatsView = useMemo(() => {
    if (!configRuntime) {
      return null
    }

    const activeSeed = getResonatorSeedById(runtime.id)
    if (!activeSeed) {
      return null
    }

    const graph = buildTransientCombatGraph({
      activeRuntime: runtime,
      activeSeed,
      participantRuntimes: {
        ...participantRuntimesById,
        [configRuntime.id]: configRuntime,
      },
      selectedTargetsByResonatorId: buildSelectedTargetsByResonatorId(
        runtime.build.team,
        selectedTargetsByOwnerKey,
      ),
    })

    const targetSlotId = findCombatParticipantSlotId(graph, configRuntime.id)
    if (!targetSlotId) {
      return null
    }

    const context = buildCombatContext({
      graph,
      targetSlotId,
      enemy: enemyProfile,
    })

    return buildOverviewStatsView(configRuntime, context.finalStats)
  }, [
    configRuntime,
    enemyProfile,
    participantRuntimesById,
    runtime,
    selectedTargetsByOwnerKey,
  ])

  const teamStateCards = runtime.build.team.flatMap((memberId, index) => {
    const isLead = index === 0
    const resolvedMemberId = index === 0 ? runtime.id : memberId
    if (!resolvedMemberId) {
      return []
    }

    const member = getResonator(resolvedMemberId)
    const memberRuntime = resolvedMemberId === runtime.id ? runtime : participantRuntimesById[resolvedMemberId] ?? null
    if (!member || !memberRuntime) {
      return []
    }

    const weaponId = memberRuntime.build.weapon.id
    const weaponDef = !isUnsetWeaponId(weaponId) ? getWeapon(weaponId) : null
    const weaponParams = weaponDef ? resolvePassiveParams(weaponDef.passive.params, memberRuntime.build.weapon.rank) : []
    const includeTeamWide = resolvedMemberId !== runtime.id
    const resonatorStates = filterSourceStatesWithDependencies(
      listStatesForSource('resonator', resolvedMemberId),
      (state) =>
        stateHasTeamFacingEffects(state, {
          includeTeamWide,
        }),
      (state) => isSourceStateVisible(memberRuntime, runtime, state),
    )
    const weaponStates = !isUnsetWeaponId(weaponId)
      ? filterSourceStatesWithDependencies(
          listStatesForSource('weapon', weaponId),
          (state) =>
            stateHasTeamFacingEffects(state, {
              includeTeamWide,
            }),
          (state) => isSourceStateVisible(memberRuntime, runtime, state),
        )
      : []
    const weaponStateKeys = new Set(weaponStates.map((s) => s.controlKey))
    const stateDefinitions = [...resonatorStates, ...weaponStates]

    return [
      (
        <Expandable
          key={`team-state-${resolvedMemberId}-${index}`}
          as="article"
          className="team-state-card ui-surface-card ui-surface-card--section"
          triggerClassName="team-state-expandable-trigger"
          contentClassName="team-state-expandable"
          contentInnerClassName="team-state-controls"
          chevronClassName="team-state-chevron"
          chevronSize={16}
          defaultOpen={false}
          header={
            <div className="team-state-card-head">
              <div className="team-state-source">
                <span className="team-state-source-frame">
                  <img
                    src={member.profile}
                    alt={member.name}
                    className="team-state-source-image"
                    loading="lazy"
                    decoding="async"
                    onError={withDefaultResonatorImage}
                  />
                </span>
                <div className="team-state-source-copy">
                  <span>{index === 0 ? 'Active Resonator' : `Teammate ${index}`}</span>
                  <strong>{member.name}</strong>
                </div>
              </div>
              <div className="team-state-head-controls">
                {!isLead ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="team-state-badge config"
                    onClick={(event) => {
                      event.stopPropagation()
                      openConfigModal(resolvedMemberId)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        openConfigModal(resolvedMemberId)
                      }
                    }}
                    aria-label={`Configure ${member.name}`}
                  >
                    <Wrench size={15} />
                  </span>
                ) : null}
                <span className="team-state-badge">
                  {stateDefinitions.length} {stateDefinitions.length === 1 ? 'state' : 'states'}
                </span>
              </div>
            </div>
          }
        >
          {stateDefinitions.length === 0 ? (
            <p className="team-state-empty">No Teammate Buffs</p>
          ) : stateDefinitions.map((state) => {
            const targetMode = getStateTeamTargetMode(state)
            const teamTargetSelect = targetMode ? (() => {
              const options = getTeamTargetOptions(runtime, resolvedMemberId, targetMode)
              const currentValue = profilesById[runtime.id]?.runtime.routing.selectedTargetsByOwnerKey[state.ownerKey] ?? null
              const fallbackValue = options[0]?.value ?? ''
              const selectedValue = typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
                ? currentValue
                : fallbackValue

              return (
                <label className="team-state-target">
                  Active Resonator
                  <LiquidSelect
                    value={selectedValue}
                    options={options}
                    disabled={options.length <= 1}
                    onChange={(nextValue) =>
                      setResonatorTargetSelection(
                        resolvedMemberId,
                        state.ownerKey,
                        nextValue || null,
                      )
                    }
                  />
                </label>
              )
            })() : undefined

                  const isWeaponState = weaponStateKeys.has(state.controlKey)

                  return (
                    <div key={state.controlKey} className="team-state-control">
                      {isWeaponState && weaponDef ? (
                        <div className="team-state-weapon-header">
                          <img
                            src={weaponDef.icon}
                            alt={weaponDef.name}
                            className="team-state-weapon-icon"
                            loading="lazy"
                            decoding="async"
                            onError={withDefaultWeaponImage}
                          />
                          <span className="team-state-weapon-name">{weaponDef.passive.name || 'Passive'}</span>
                        </div>
                      ) : null}
                      <SourceStateControl
                        sourceRuntime={memberRuntime}
                        targetRuntime={memberRuntime}
                        state={state}
                        onRuntimeUpdate={
                          isLead
                            ? onRuntimeUpdate
                            : (updater) => updateResonatorRuntime(resolvedMemberId, updater)
                        }
                        teamTargetSelect={teamTargetSelect}
                        descriptionParams={isWeaponState ? weaponParams : undefined}
                      />
                    </div>
                  )
                })}
        </Expandable>
      ),
    ]
  })

  return (
    <section className="calc-pane teams-pane">
      <div>
        <div className="panel-overline">Simulation</div>
        <h3>Team Setup</h3>
      </div>
      <div className="teams pane-section">
        <h4>Team Slots</h4>
        <div className="team-slot-deck">
          {runtime.build.team.map((memberId, index) => {
            const isLead = index === 0
            const resolvedMemberId = isLead ? runtime.id : memberId
            const member = resolvedMemberId ? getResonator(resolvedMemberId) : null
            const slotRarity = member?.rarity ?? 1
            const slotLabel = isLead ? 'Active Resonator' : `Teammate ${index}`
            const slotStatus = isLead ? 'Locked' : member ? 'Tap to replace' : 'Tap to assign'

            return (
              <article
                key={`team-slot-${index}`}
                className={`team-slot-card ui-surface-card ui-surface-card--section rarity-${slotRarity} ${isLead ? 'is-lead' : ''} ${member ? 'is-filled' : 'is-empty'}`}
              >
                {isLead ? (
                  <div className={`team-slot-trigger team-slot-trigger--static picker-modal__media-frame rarity-${slotRarity}`} aria-hidden="true">
                    <img
                      src={member?.profile ?? '/assets/default-icon.webp'}
                      alt=""
                      className="picker-modal__media-image"
                      onError={withDefaultResonatorImage}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`team-slot-trigger picker-modal__media-frame rarity-${slotRarity}`}
                    onClick={() => openTeamPicker(index)}
                  >
                    {member ? (
                      <img
                        src={member.profile}
                        alt={member.name}
                        className="picker-modal__media-image"
                        onError={withDefaultResonatorImage}
                      />
                    ) : (
                      <span className="team-slot-placeholder">+</span>
                    )}
                  </button>
                )}
                {!isLead && member ? (
                  <button
                    type="button"
                    className="team-slot-remove"
                    aria-label={`Remove ${member.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      selectTeamMember(index, null)
                    }}
                  >
                    <X size={14} />
                  </button>
                ) : null}

                <div className="team-slot-copy">
                  <div className="team-slot-label-row">
                    <span className="team-slot-label">{slotLabel}</span>
                  </div>
                  <strong className="team-slot-name">{member?.name ?? 'Empty Slot'}</strong>
                  <span className="team-slot-status">{slotStatus}</span>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <div className="pane-section">
        <h4>Team States</h4>
        <div className="team-state-grid">
          {teamStateCards.length > 0 ? (
            teamStateCards
          ) : (
            <article className="team-state-card team-state-card--empty soft-empty">
              No team-facing states available.
            </article>
          )}
        </div>
      </div>

      {configModalVisible && configMember && configRuntime ? (
        <TeamMemberConfigModal
          visible={configModalVisible}
          open={configModalOpen}
          closing={configModalClosing}
          portalTarget={modalPortalTarget}
          member={configMember}
          runtime={configRuntime}
          activeRuntime={runtime}
          inventoryBuilds={inventoryBuilds}
          stateDefinitions={configStates}
          combatStatsView={configCombatStatsView}
          onSequenceChange={(value) =>
            updateResonatorRuntime(configMember.id, (prev) => ({
              ...prev,
              base: {
                ...prev.base,
                sequence: Math.max(0, Math.min(6, value)),
              },
            }))
          }
          onRuntimeUpdate={(updater) => updateResonatorRuntime(configMember.id, updater)}
          getSelectedTarget={(ownerKey) => profilesById[runtime.id]?.runtime.routing.selectedTargetsByOwnerKey[ownerKey] ?? null}
          setSelectedTarget={(ownerKey, targetResonatorId) =>
            setResonatorTargetSelection(configMember.id, ownerKey, targetResonatorId)
          }
          onClose={closeConfigModal}
        />
      ) : null}

      {teamPickerVisible ? (
        <ResonatorPickerModal
          visible={teamPickerVisible}
          open={teamPickerOpen}
          closing={teamPickerClosing}
          portalTarget={modalPortalTarget}
          eyebrow="Team Slots"
          title="Select Teammate"
          description="Occupied team members are hidden so every slot stays unique."
          resonators={eligibleTeamPickerResonators}
          selectedResonatorId={teamPickerSlotIndex === null ? null : runtime.build.team[teamPickerSlotIndex] ?? null}
          selectionLabel="Selected"
          summaryPrimary={{
            label: 'Slot',
            value: activeSlotLabel,
          }}
          emptyState={<p>No eligible resonators remain for this slot.</p>}
          panelWidth="regular"
          onClose={closeTeamPicker}
          onSelect={(resonatorId) => {
            if (teamPickerSlotIndex === null) {
              return
            }

            selectTeamMember(teamPickerSlotIndex, resonatorId)
            closeTeamPicker()
          }}
        />
      ) : null}
    </section>
  )
}
