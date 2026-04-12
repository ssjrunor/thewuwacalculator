import { useCallback, useMemo } from 'react'
import { isUnsetWeaponId, type ResonatorRuntimeState, type TeamMemberRuntime } from '@/domain/entities/runtime'
import { MAX_RESONATOR_LEVEL, makeDefaultTeamMemberRuntime } from '@/domain/state/defaults'
import { materializeTeamMemberFromCompactRuntime } from '@/domain/state/runtimeMaterialization'
import type { EchoDefinition } from '@/domain/entities/catalog'
import { getSonataSetIcon } from '@/data/gameData/catalog/sonataSets'
import { getEchoSetControlKey, getEchoSetDef, type SetDef } from '@/data/gameData/echoSets/effects'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { StepScrubber } from '@/shared/ui/StepScrubber'
import { NumberInput } from '@/modules/calculator/components/workspace/panes/left/controls/NumberInput'
import type { SourceOwnerScope, SourceStateDefinition } from '@/domain/gameData/contracts'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { listStatesForSource, getOwnerForKey } from '@/domain/services/gameDataService'
import { getMainEchoSourceRef } from '@/domain/services/runtimeSourceService'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import {
  filterSourceStatesWithDependencies,
  getStateEffectTargetScopes,
  isSourceStateEnabled,
  setSourceStateValue,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { evaluateSourceStateVisibility } from '@/modules/calculator/model/sourceStateEvaluation'
import { getSourceStateDisplay } from '@/modules/calculator/model/sourceStateDisplay'
import { getResonator } from '@/modules/calculator/model/resonator'
import { getWeapon, withDefaultWeaponImage, resolveWeaponStatsAtLevel } from '@/modules/calculator/model/weapon'
import { RichDescription } from '@/shared/ui/RichDescription'
import type { OptimizerSetSelections } from '@/domain/entities/optimizer'
import type { RandomGeneratorSetPreference } from '@/domain/entities/suggestions'
import { getRandomSetCountOptions } from '@/modules/calculator/model/suggestions'
import { buildTeammateControls, compactTeamMemberRuntime } from './teamRuntime'
import { renderRuntimeState } from './renderRuntimeState'
import { AllowedSetDropdown } from './AllowedSetDropdown'

const SCOPE_LABELS: Record<SourceOwnerScope, string> = {
  resonator: 'State',
  weapon: 'Weapon',
  echo: 'Echo',
  team: 'Team',
  sequence: 'Sequence',
  inherent: 'Inherent',
}

interface StateGroup {
  scopeKey: string
  label: string
  states: ReturnType<typeof listStatesForSource>
}

interface OptimizerTeamPanelProps {
  rarity: number
  displayName: string
  optimizerRuntime: ResonatorRuntimeState | null
  invalidMainEchoIds: [string | null, string | null]
  teammateSetPreferences: [RandomGeneratorSetPreference[], RandomGeneratorSetPreference[]]
  onRuntimeUpdate: RuntimeUpdateHandler
  onOpenTeammatePicker: (slotIndex: 0 | 1) => void
  onOpenWeaponPicker: (slot: 'active' | 0 | 1) => void
  onOpenTeammateMainEchoPicker: (slotIndex: 0 | 1) => void
  onAddTeammateSetPreference: (slotIndex: 0 | 1, setId: number) => void
  onRemoveTeammateSetPreference: (slotIndex: 0 | 1, setId: number) => void
  onSetTeammateSetPreferenceCount: (slotIndex: 0 | 1, setId: number, count: number) => void
  onRemoveTeammate: (slotIndex: 0 | 1) => void
  onRemoveTeammateMainEcho: (slotIndex: 0 | 1) => void
}

interface OptimizerRuntimeCardProps {
  slotLabel: string
  rarity: number
  displayName: string
  profileSrc?: string
  runtime: ResonatorRuntimeState
  activeRuntime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
  editableLevel: boolean
  onPortraitClick?: (() => void) | undefined
  onRemoveCharacter?: (() => void) | undefined
  onWeaponClick: (() => void) | undefined
  invalidMainEcho?: EchoDefinition | null
  onMainEchoClick?: (() => void) | undefined
  onRemoveMainEcho?: (() => void) | undefined
  setPreferences?: RandomGeneratorSetPreference[] | undefined
  setPreferenceSlotIndex?: (0 | 1) | undefined
  onAddSetPreference?: ((slotIndex: 0 | 1, setId: number) => void) | undefined
  onRemoveSetPreference?: ((slotIndex: 0 | 1, setId: number) => void) | undefined
  onSetPreferenceCount?: ((slotIndex: 0 | 1, setId: number, count: number) => void) | undefined
}

interface OptimizerTeammateCardProps {
  slotIndex: 0 | 1
  memberId: string
  invalidMainEchoId: string | null
  setPreferences: RandomGeneratorSetPreference[]
  activeRuntime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
  onOpenTeammatePicker: (slotIndex: 0 | 1) => void
  onOpenWeaponPicker: (slot: 'active' | 0 | 1) => void
  onOpenMainEchoPicker: (slotIndex: 0 | 1) => void
  onAddSetPreference: (slotIndex: 0 | 1, setId: number) => void
  onRemoveSetPreference: (slotIndex: 0 | 1, setId: number) => void
  onSetPreferenceCount: (slotIndex: 0 | 1, setId: number, count: number) => void
  onRemoveTeammate: (slotIndex: 0 | 1) => void
  onRemoveMainEcho: (slotIndex: 0 | 1) => void
}

type PanelTargetScope = 'self' | 'active' | 'activeOther' | 'teamWide' | 'otherTeammates'

const ACTIVE_CARD_TARGET_SCOPES: readonly PanelTargetScope[] = ['self', 'active', 'teamWide']
const TEAMMATE_CARD_TARGET_SCOPES: readonly PanelTargetScope[] = [
  'active',
  'activeOther',
  'teamWide',
  'otherTeammates',
]

interface CardStateGroups {
  resonator: StateGroup[]
  weapon: StateGroup[]
}

function groupStates(states: SourceStateDefinition[], fallbackScope: 'resonator' | 'weapon'): StateGroup[] {
  const byScope = new Map<string, SourceStateDefinition[]>()

  for (const state of states) {
    const scope = getOwnerForKey(state.ownerKey)?.scope ?? fallbackScope
    const bucket = byScope.get(scope) ?? []
    bucket.push(state)
    byScope.set(scope, bucket)
  }

  return Array.from(byScope.entries()).map(([scope, states]) => ({
    scopeKey: scope,
    label: SCOPE_LABELS[scope as SourceOwnerScope] ?? scope,
    states,
  }))
}

function filterStatesForCard(
  states: SourceStateDefinition[],
  runtime: ResonatorRuntimeState,
  activeRuntime: ResonatorRuntimeState,
  allowedTargetScopes: readonly PanelTargetScope[],
): SourceStateDefinition[] {
  return filterSourceStatesWithDependencies(
    states,
    (state) => getStateEffectTargetScopes(state).some((scope) => allowedTargetScopes.includes(scope)),
    (state) => evaluateSourceStateVisibility(runtime, runtime, state, activeRuntime),
  )
}

function buildCardStateGroups(
  runtime: ResonatorRuntimeState,
  activeRuntime: ResonatorRuntimeState,
  allowedTargetScopes: readonly PanelTargetScope[],
): CardStateGroups {
  const allResonatorStates = listStatesForSource('resonator', runtime.id)
  const resonatorStates = filterStatesForCard(allResonatorStates, runtime, activeRuntime, allowedTargetScopes)
  const weaponId = runtime.build.weapon.id
  const allWeaponStates = weaponId && !isUnsetWeaponId(weaponId)
    ? listStatesForSource('weapon', weaponId)
    : []
  const weaponStates = filterStatesForCard(allWeaponStates, runtime, activeRuntime, allowedTargetScopes)

  return {
    resonator: groupStates(
      resonatorStates,
      'resonator',
    ),
    weapon: groupStates(
      weaponStates,
      'weapon',
    ),
  }
}

function OptimizerMainEchoCard({
  runtime,
  activeRuntime,
  allowedTargetScopes,
  onRuntimeUpdate,
  invalidMainEcho = null,
  onMainEchoClick,
  onRemoveMainEcho,
  showEmptyPlaceholder = false,
}: {
  runtime: ResonatorRuntimeState
  activeRuntime: ResonatorRuntimeState
  allowedTargetScopes: readonly PanelTargetScope[]
  onRuntimeUpdate: RuntimeUpdateHandler
  invalidMainEcho?: EchoDefinition | null
  onMainEchoClick?: (() => void) | undefined
  onRemoveMainEcho?: (() => void) | undefined
  showEmptyPlaceholder?: boolean
}) {
  const mainEcho = runtime.build.echoes[0]
  const runtimeMainEchoDefinition = useMemo(
    () => (mainEcho ? getEchoById(mainEcho.id) : null),
    [mainEcho],
  )
  const mainEchoDefinition = invalidMainEcho ?? runtimeMainEchoDefinition
  const hasInvalidMainEcho = invalidMainEcho != null
  const mainEchoSource = useMemo(() => getMainEchoSourceRef(runtime), [runtime])
  const mainEchoStates = useMemo(() => {
    if (!mainEchoSource) {
      return []
    }

    return filterStatesForCard(
      listStatesForSource(mainEchoSource.type, mainEchoSource.id),
      runtime,
      activeRuntime,
      allowedTargetScopes,
    )
  }, [activeRuntime, allowedTargetScopes, mainEchoSource, runtime])

  if (!mainEchoDefinition) {
    if (!showEmptyPlaceholder) {
      return null
    }

    return (
      <div className="opt-team__echo-block">
        <button
          type="button"
          className="opt-team__set-card opt-team__set-card--empty opt-team__set-card--button"
          onClick={onMainEchoClick}
          aria-label="Select teammate main echo"
        >
          <div className="opt-team__set-head">
            <div className="opt-team__set-icon-wrap opt-team__set-icon-wrap--empty">
              <span className="opt-team__set-empty-plus">+</span>
            </div>
            <div className="opt-team__set-copy">
              <strong className="co-weapon-card__name">Main Echo</strong>
              <span className="opt-team__set-count">No Main Echo</span>
            </div>
          </div>
        </button>
      </div>
    )
  }

  return (
    <div className="opt-team__echo-block">
      <div className={`opt-team__set-card${hasInvalidMainEcho ? ' opt-team__set-card--invalid' : ''}`}>
        <div className="opt-team__set-head">
          {onMainEchoClick ? (
            <button
              type="button"
              className={`opt-team__set-icon-wrap opt-team__set-icon-wrap--button${hasInvalidMainEcho ? ' opt-team__set-icon-wrap--invalid' : ''}`}
              onClick={onMainEchoClick}
              aria-label={`Select ${runtime.id} main echo`}
            >
              <img
                src={mainEchoDefinition.icon ?? '/assets/echo-icons/default.webp'}
                alt={mainEchoDefinition.name}
                className={`opt-team__set-icon${hasInvalidMainEcho ? ' opt-team__set-icon--invalid' : ''}`}
                loading="lazy"
              />
            </button>
          ) : (
            <div className="opt-team__set-icon-wrap">
              <img
                src={mainEchoDefinition.icon ?? '/assets/echo-icons/default.webp'}
                alt={mainEchoDefinition.name}
                className="opt-team__set-icon"
                loading="lazy"
              />
            </div>
          )}
          <div className="opt-team__set-copy">
            <strong className="co-weapon-card__name">{mainEchoDefinition.name}</strong>
            <span className="opt-team__set-count">
              {hasInvalidMainEcho ? 'Invalid' : mainEchoStates.length > 0 ? 'Main Echo' : 'Active'}
            </span>
          </div>
          {onRemoveMainEcho ? (
            <button
              type="button"
              className="opt-team__remove-btn"
              onClick={onRemoveMainEcho}
              aria-label="Remove main echo"
            >
              ×
            </button>
          ) : null}
        </div>

        {hasInvalidMainEcho ? (
          <span className="opt-team__set-warning">Does not match the current set plan.</span>
        ) : null}

        {!hasInvalidMainEcho && mainEchoStates.length > 0 ? (
          <div className="co-runtime-states">
            {mainEchoStates.map((state) =>
              renderRuntimeState(runtime, state, onRuntimeUpdate, {
                sourceRuntime: runtime,
                targetRuntime: runtime,
                activeRuntime,
              }),
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function buildSetSelectionForCard(setId: number, count: number): OptimizerSetSelections {
  if (count >= 3 && getEchoSetDef(setId)?.setMax === 3) {
    return { 3: [setId], 5: [] }
  }

  return { 3: [], 5: [setId] }
}

function buildSetSelectionForPreferences(
  preferences: RandomGeneratorSetPreference[],
): OptimizerSetSelections {
  return {
    3: preferences.filter((entry) => entry.count === 3).map((entry) => entry.setId),
    5: preferences.filter((entry) => entry.count !== 3).map((entry) => entry.setId),
  }
}

function OptimizerEchoSetCards({
  runtime,
  activeRuntime,
  allowedTargetScopes,
  onRuntimeUpdate,
  configurable = false,
  setPreferences,
  setPreferenceSlotIndex,
  onAddSetPreference,
  onRemoveSetPreference,
  onSetPreferenceCount,
  showEmptyPlaceholder = false,
}: {
  runtime: ResonatorRuntimeState
  activeRuntime: ResonatorRuntimeState
  allowedTargetScopes: readonly PanelTargetScope[]
  onRuntimeUpdate: RuntimeUpdateHandler
  configurable?: boolean
  setPreferences?: RandomGeneratorSetPreference[] | undefined
  setPreferenceSlotIndex?: (0 | 1) | undefined
  onAddSetPreference?: ((slotIndex: 0 | 1, setId: number) => void) | undefined
  onRemoveSetPreference?: ((slotIndex: 0 | 1, setId: number) => void) | undefined
  onSetPreferenceCount?: ((slotIndex: 0 | 1, setId: number, count: number) => void) | undefined
  showEmptyPlaceholder?: boolean
}) {
  const resolvedSetPreferences = useMemo(
    () => setPreferences ?? [],
    [setPreferences],
  )

  const activeSets = useMemo(() => {
    if (configurable) {
      return resolvedSetPreferences.map((entry) => ({
        setId: entry.setId,
        count: entry.count,
      }))
    }

    return Object.entries(computeEchoSetCounts(runtime.build.echoes))
      .map(([setId, count]) => ({ setId: Number(setId), count }))
      .filter(({ setId, count }) => {
        const def = getEchoSetDef(setId)
        if (!def) {
          return false
        }

        const minReq = def.setMax === 3 ? 3 : 2
        return count >= minReq
      })
      .reverse()
  }, [configurable, resolvedSetPreferences, runtime.build.echoes])

  const totalSelectedPieces = resolvedSetPreferences.reduce((sum, entry) => sum + entry.count, 0)
  const canAddSetPreference = Boolean(
    configurable
    && setPreferenceSlotIndex !== undefined
    && onAddSetPreference
    && totalSelectedPieces < 4
    && resolvedSetPreferences.length < 2
  )
  const selectedIdsByPiece = useMemo(
    () => buildSetSelectionForPreferences(resolvedSetPreferences),
    [resolvedSetPreferences],
  )

  if (activeSets.length === 0) {
    if (!showEmptyPlaceholder) {
      return null
    }

    return (
      <div className="opt-team__set-grid">
        <AllowedSetDropdown
          selectedIdsByPiece={selectedIdsByPiece}
          onChange={(nextSelectedIdsByPiece) => {
            if (
              !configurable ||
              setPreferenceSlotIndex === undefined ||
              !onAddSetPreference ||
              !onRemoveSetPreference
            ) {
              return
            }

            const nextSetIds = new Set([
              ...nextSelectedIdsByPiece[3],
              ...nextSelectedIdsByPiece[5],
            ])
            for (const entry of resolvedSetPreferences) {
              if (!nextSetIds.has(entry.setId)) {
                onRemoveSetPreference(setPreferenceSlotIndex, entry.setId)
              }
            }
            for (const setId of nextSetIds) {
              if (!resolvedSetPreferences.some((entry) => entry.setId === setId)) {
                onAddSetPreference(setPreferenceSlotIndex, setId)
              }
            }
          }}
          resetLabel="Any Set"
          resetMeta="No active set focus"
          triggerClassName="co-set-dropdown__trigger--card"
          renderTriggerContent={() => (
            <div className="opt-team__set-card opt-team__set-card--empty">
              <div className="opt-team__set-head">
                <div className="opt-team__set-icon-wrap opt-team__set-icon-wrap--empty">
                  <span className="opt-team__set-empty-plus">+</span>
                </div>
                <div className="opt-team__set-copy">
                  <strong className="co-weapon-card__name">Set Effects</strong>
                  <span className="opt-team__set-count">No Active Set</span>
                </div>
              </div>
            </div>
          )}
        />
      </div>
    )
  }

  return (
    <div className="opt-team__set-grid">
      {activeSets.map(({ setId, count }) => {
        const def = getEchoSetDef(setId)
        if (!def) {
          return null
        }

        const icon = getSonataSetIcon(setId)
        const setStates = filterStatesForCard(
          listStatesForSource('echoSet', String(setId)),
          runtime,
          activeRuntime,
          allowedTargetScopes,
        )
        const pieceReq = def.setMax === 3 ? 3 : 5
        const hasPieceReq = count >= pieceReq
        const passiveParts = def.parts.filter((part) => {
          const isPassive = part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
          if (!isPassive) {
            return false
          }
          if (part.key === 'twoPiece') {
            return count >= 2
          }
          return count >= pieceReq
        })
        const stateEntries = def.parts
          .filter((part) => {
            const isPassive = part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
            return !isPassive && hasPieceReq
          })
          .map((part) => setStates.find((state) => state.id === part.key))
          .filter((state): state is SourceStateDefinition => Boolean(state))

        return (
          <div key={`set-${setId}`} className="opt-team__set-card">
            <div className="opt-team__set-head">
              {configurable ? (
                <AllowedSetDropdown
                  selectedIdsByPiece={buildSetSelectionForCard(setId, count)}
                  onChange={(nextSelectedIdsByPiece) => {
                    if (
                      !configurable ||
                      setPreferenceSlotIndex === undefined ||
                      !onAddSetPreference ||
                      !onRemoveSetPreference
                    ) {
                      return
                    }

                    const nextSetIds = new Set([
                      ...nextSelectedIdsByPiece[3],
                      ...nextSelectedIdsByPiece[5],
                    ])
                    const stillSelected = nextSetIds.has(setId)
                    if (!stillSelected) {
                      onRemoveSetPreference(setPreferenceSlotIndex, setId)
                      return
                    }

                    const replacementSetId = [...nextSetIds].find((id) => id !== setId) ?? setId
                    if (replacementSetId !== setId) {
                      onRemoveSetPreference(setPreferenceSlotIndex, setId)
                      onAddSetPreference(setPreferenceSlotIndex, replacementSetId)
                    }
                  }}
                  resetLabel="Any Set"
                  resetMeta="No active set focus"
                  triggerClassName="co-set-dropdown__trigger--icon"
                  renderTriggerContent={() => (
                    <div className="opt-team__set-icon-wrap">
                      {icon ? <img src={icon} alt={def.name} className="opt-team__set-icon" loading="lazy" /> : null}
                    </div>
                  )}
                />
              ) : (
                <div className="opt-team__set-icon-wrap">
                  {icon ? <img src={icon} alt={def.name} className="opt-team__set-icon" loading="lazy" /> : null}
                </div>
              )}
              <div className="opt-team__set-copy">
                <strong className="co-weapon-card__name">{def.name}</strong>
                <span className="opt-team__set-count">{count}/{pieceReq}</span>
              </div>
              <div className="opt-team__set-header-right">
                {configurable ? (
                  <div className="opt-team__set-piece-pills">
                    {getRandomSetCountOptions(setId).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`opt-team__set-piece-pill${count === option ? ' is-active' : ''}`}
                        onClick={() => {
                          if (setPreferenceSlotIndex === undefined || !onSetPreferenceCount) {
                            return
                          }
                          onSetPreferenceCount(setPreferenceSlotIndex, setId, option)
                        }}
                      >
                        {option}pc
                      </button>
                    ))}
                  </div>
                ) : null}
                {configurable && onRemoveSetPreference && setPreferenceSlotIndex !== undefined ? (
                  <button
                    type="button"
                    className="opt-team__remove-btn"
                    onClick={() => onRemoveSetPreference(setPreferenceSlotIndex, setId)}
                    aria-label={`Remove ${def.name} set preference`}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>

            {passiveParts.length > 0 ? (
              <div className="opt-team__set-passives">
                {passiveParts.map((part) => (
                  <div key={part.key} className="opt-team__set-passive">
                    <span className="opt-team__set-passive-tag">
                      {part.key === 'twoPiece' ? '2pc' : part.key === 'threePiece' ? '3pc' : '5pc'}
                    </span>
                    <RichDescription description={part.label} unstyled />
                  </div>
                ))}
              </div>
            ) : null}

            {stateEntries.length > 0 ? (
              <div className="co-runtime-states">
                {stateEntries.map((state) => (
                  <OptimizerEchoSetStatePart
                    key={state.controlKey}
                    runtime={runtime}
                    activeRuntime={activeRuntime}
                    setDef={def}
                    sourceState={state}
                    onRuntimeUpdate={onRuntimeUpdate}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}

      {canAddSetPreference ? (
        <AllowedSetDropdown
          selectedIdsByPiece={selectedIdsByPiece}
          onChange={(nextSelectedIdsByPiece) => {
            if (
              setPreferenceSlotIndex === undefined ||
              !configurable ||
              !onAddSetPreference ||
              !onRemoveSetPreference
            ) {
              return
            }

            const nextSetIds = new Set([
              ...nextSelectedIdsByPiece[3],
              ...nextSelectedIdsByPiece[5],
            ])
            for (const entry of resolvedSetPreferences) {
              if (!nextSetIds.has(entry.setId)) {
                onRemoveSetPreference(setPreferenceSlotIndex, entry.setId)
              }
            }
            for (const setId of nextSetIds) {
              if (!resolvedSetPreferences.some((entry) => entry.setId === setId)) {
                onAddSetPreference(setPreferenceSlotIndex, setId)
              }
            }
          }}
          resetLabel="Any Set"
          resetMeta="No active set focus"
          triggerClassName="co-set-dropdown__trigger--card"
          renderTriggerContent={() => (
            <div className="opt-team__set-card opt-team__set-card--empty">
              <div className="opt-team__set-head">
                <div className="opt-team__set-icon-wrap opt-team__set-icon-wrap--empty">
                  <span className="opt-team__set-empty-plus">+</span>
                </div>
                <div className="opt-team__set-copy">
                  <strong className="co-weapon-card__name">Set Effects</strong>
                  <span className="opt-team__set-count">Add Set</span>
                </div>
              </div>
            </div>
          )}
        />
      ) : null}
    </div>
  )
}

function OptimizerEchoSetStatePart({
  runtime,
  activeRuntime,
  setDef,
  sourceState,
  onRuntimeUpdate,
}: {
  runtime: ResonatorRuntimeState
  activeRuntime: ResonatorRuntimeState
  setDef: SetDef
  sourceState: SourceStateDefinition
  onRuntimeUpdate: RuntimeUpdateHandler
}) {
  const stateEntry = setDef.states[sourceState.id]
  if (!stateEntry) {
    return null
  }

  const currentValue = runtime.state?.controls?.[getEchoSetControlKey(setDef.id, sourceState.id)]
  const isEnabled = isSourceStateEnabled(runtime, runtime, sourceState, activeRuntime)
  const display = getSourceStateDisplay(sourceState)
  const perStep = stateEntry.perStep ?? []
  const perStack = stateEntry.perStack ?? []
  const stackLikeEntries = perStep.length > 0 ? perStep : (perStack.length > 0 ? perStack : stateEntry.max)
  const isToggle = stackLikeEntries.every((entry, index) => entry.value === stateEntry.max[index].value)

  if (isToggle) {
    const checked = typeof currentValue === 'boolean' ? currentValue : Boolean(currentValue)

    return (
      <div
        className={`co-runtime-state${checked ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
      >
        <span className="co-runtime-state__label">{display.label}</span>
        <label className="co-runtime-state__toggle">
          <input
            type="checkbox"
            checked={checked}
            disabled={!isEnabled}
            onChange={(event) => {
              setSourceStateValue(onRuntimeUpdate, runtime, runtime, sourceState, event.target.checked, activeRuntime)
            }}
          />
          <span className="co-runtime-state__switch" />
        </label>
      </div>
    )
  }

  if (perStep.length > 0) {
    const min = Math.max(0, Math.floor(sourceState.min ?? 0))
    const max = Math.round(
      Math.max(...perStep.map((entry, index) => stateEntry.max[index].value / entry.value)),
    )
    const stepValue = typeof currentValue === 'number' && Number.isFinite(currentValue)
      ? currentValue
      : min

    return (
      <div
        className={`co-runtime-state co-runtime-state--step${stepValue > min ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
      >
        <div className="co-runtime-state__step-header">
          <span className="co-runtime-state__label">{display.label}</span>
          <div className="co-runtime-state__step-count">
            <input
              type="number"
              className="co-runtime-state__step-count-input"
              value={stepValue}
              min={min}
              max={max}
              disabled={!isEnabled}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10)
                if (!isNaN(parsed)) {
                  setSourceStateValue(onRuntimeUpdate, runtime, runtime, sourceState, Math.min(max, Math.max(min, parsed)), activeRuntime)
                }
              }}
            />
            <span className="co-runtime-state__step-max">/{max}</span>
          </div>
        </div>
        <StepScrubber
          min={min}
          max={max}
          value={stepValue}
          disabled={!isEnabled}
          onChange={(v) =>
            setSourceStateValue(onRuntimeUpdate, runtime, runtime, sourceState, v, activeRuntime)
          }
        />
      </div>
    )
  }

  const min = Math.max(0, Math.floor(sourceState.min ?? 0))
  const max = Math.round(
    Math.max(...stackLikeEntries.map((entry, index) => stateEntry.max[index].value / entry.value)),
  )
  const stackValue = typeof currentValue === 'number' && Number.isFinite(currentValue)
    ? currentValue
    : min

  return (
    <div
      className={`co-runtime-state${stackValue > min ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
    >
      <span className="co-runtime-state__label">{display.label}</span>
      <div className="co-runtime-state__stack">
        {Array.from({ length: max - min + 1 }, (_, offset) => {
          const value = min + offset
          return (
            <button
              key={value}
              type="button"
              className={`co-runtime-state__stack-btn${value === stackValue ? ' is-active' : ''}`}
              disabled={!isEnabled}
              onClick={() => {
                setSourceStateValue(onRuntimeUpdate, runtime, runtime, sourceState, value, activeRuntime)
              }}
            >
              {value}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function OptimizerRuntimeCard({
  slotLabel,
  rarity,
  displayName,
  profileSrc,
  runtime,
  activeRuntime,
  onRuntimeUpdate,
  editableLevel,
  onPortraitClick,
  onRemoveCharacter,
  onWeaponClick,
  invalidMainEcho,
  onMainEchoClick,
  onRemoveMainEcho,
  setPreferences,
  setPreferenceSlotIndex,
  onAddSetPreference,
  onRemoveSetPreference,
  onSetPreferenceCount,
}: OptimizerRuntimeCardProps) {
  const allowedTargetScopes = editableLevel ? ACTIVE_CARD_TARGET_SCOPES : TEAMMATE_CARD_TARGET_SCOPES
  const level = editableLevel ? runtime.base.level : MAX_RESONATOR_LEVEL
  const sequence = runtime.base.sequence ?? 0
  const weaponId = runtime.build.weapon.id ?? null
  const sequenceOptions = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({ value: i, label: `S${i}` })),
    [],
  )
  const rankOptions = useMemo(
    () => Array.from({ length: 5 }, (_, i) => ({ value: i + 1, label: `R${i + 1}` })),
    [],
  )
  const weaponLevel = runtime.build.weapon.level
  const weaponRank = runtime.build.weapon.rank
  const weaponDef = useMemo(
    () => (weaponId && !isUnsetWeaponId(weaponId) ? getWeapon(weaponId) : null),
    [weaponId],
  )

  const stateGroups = useMemo(
    () => buildCardStateGroups(runtime, activeRuntime, allowedTargetScopes),
    [activeRuntime, allowedTargetScopes, runtime],
  )
  const resonatorStateGroups = stateGroups.resonator
  const weaponStateGroups = stateGroups.weapon

  return (
    <article className={`opt-team__card${editableLevel ? ' opt-team__card--active' : ''}`}>
      <div className="opt-team__portrait-row">
        {onPortraitClick ? (
          <button
            type="button"
            className={`opt-team__thumb-ring opt-team__thumb-ring--button rarity-${rarity}`}
            onClick={onPortraitClick}
            aria-label={`Change ${slotLabel.toLowerCase()}`}
          >
            <img src={profileSrc} alt={displayName} className="opt-team__thumb" loading="eager" />
          </button>
        ) : (
          <div className={`opt-team__thumb-ring rarity-${rarity}`}>
            <img src={profileSrc} alt={displayName} className="opt-team__thumb" loading="eager" />
          </div>
        )}
        <div className="opt-team__identity">
          <div className="opt-team__identity-header">
            <span className="opt-team__slot-label">{slotLabel}</span>
            {onRemoveCharacter ? (
              <button
                type="button"
                className="opt-team__remove-btn"
                onClick={onRemoveCharacter}
                aria-label={`Remove ${displayName} from team`}
              >
                ×
              </button>
            ) : null}
          </div>
          <span className="opt-team__name">{displayName}</span>
          <div className="opt-team__inline-fields">
            <div className="co-topbar-field">
              <span className="co-topbar-field__label">Lv</span>
              {editableLevel ? (
                <div className="co-topbar-input">
                  <NumberInput
                    value={level}
                    min={1}
                    max={90}
                    step={1}
                    onChange={(value) => {
                      onRuntimeUpdate((prev) => ({
                        ...prev,
                        base: {
                          ...prev.base,
                          level: Math.max(1, Math.min(90, Math.round(value))),
                        },
                      }))
                    }}
                  />
                </div>
              ) : (
                <span className="co-badge">{MAX_RESONATOR_LEVEL}</span>
              )}
            </div>
            <span className="co-bar__sep" />
            <div className="co-topbar-field">
              <span className="co-topbar-field__label">Sequence</span>
              <LiquidSelect
                value={sequence}
                options={sequenceOptions}
                onChange={(value) => {
                  onRuntimeUpdate((prev) => ({
                    ...prev,
                    base: { ...prev.base, sequence: value },
                  }))
                }}
                baseClass="co-topbar-select"
                ariaLabel={`${displayName} sequence`}
                preferredPlacement="down"
              />
            </div>
          </div>
        </div>
      </div>

      {resonatorStateGroups.length > 0 && (
        <div className="opt-team__state-groups">
          {resonatorStateGroups.map((group) => (
            <div key={group.scopeKey} className="opt-team__state-group">
              <span className="opt-team__group-label">{group.label}</span>
              <div className="co-runtime-states">
                {group.states.map((state) =>
                  renderRuntimeState(runtime, state, onRuntimeUpdate, {
                    sourceRuntime: runtime,
                    targetRuntime: runtime,
                    activeRuntime,
                  }),
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="opt-team__weapon">
        <span className="opt-team__group-label">Weapon</span>
        <div className="co-weapon-card">
          <button
            type="button"
            className="co-weapon-card__icon-wrap co-weapon-card__icon-wrap--button"
            onClick={onWeaponClick}
            aria-label={`Change ${displayName} weapon`}
          >
            <img
              src={weaponDef?.icon ?? '/assets/weapon-icons/default.webp'}
              alt={weaponDef?.name ?? 'Weapon'}
              className="co-weapon-card__icon"
              loading="lazy"
              onError={withDefaultWeaponImage}
            />
          </button>
          <div className="co-weapon-card__copy">
            <strong className="co-weapon-card__name">{weaponDef?.name ?? 'No Weapon'}</strong>
            <div className="opt-team__inline-fields">
              {editableLevel && (
                <>
                  <div className="co-topbar-field">
                    <span className="co-topbar-field__label">Lv</span>
                    <div className="co-topbar-input">
                      <NumberInput
                        value={weaponLevel}
                        min={1}
                        max={90}
                        step={1}
                        onChange={(value) => {
                          const nextLevel = Math.max(1, Math.min(90, Math.round(value)))
                          onRuntimeUpdate((prev) => {
                            const stats = weaponDef
                                ? resolveWeaponStatsAtLevel(weaponDef, nextLevel)
                                : null
                            return {
                              ...prev,
                              build: {
                                ...prev.build,
                                weapon: {
                                  ...prev.build.weapon,
                                  level: nextLevel,
                                  ...(stats ? { baseAtk: stats.atk } : {}),
                                },
                              },
                            }
                          })
                        }}
                      />
                    </div>
                  </div>
                  <span className="co-bar__sep" />
                </>
              )}
              <div className="co-topbar-field">
                <span className="co-topbar-field__label">Rank</span>
                <LiquidSelect
                  value={weaponRank}
                  options={rankOptions}
                  onChange={(value) => {
                    onRuntimeUpdate((prev) => ({
                      ...prev,
                      build: {
                        ...prev.build,
                        weapon: { ...prev.build.weapon, rank: value },
                      },
                    }))
                  }}
                  baseClass="co-topbar-select"
                  ariaLabel={`${displayName} weapon rank`}
                  preferredPlacement="down"
                />
              </div>
            </div>
          </div>
        </div>

        {weaponStateGroups.length > 0 && (
          <div className="opt-team__state-groups">
            {weaponStateGroups.map((group) => (
              <div key={group.scopeKey} className="opt-team__state-group">
                <div className="co-runtime-states">
                  {group.states.map((state) =>
                    renderRuntimeState(runtime, state, onRuntimeUpdate, {
                      sourceRuntime: runtime,
                      targetRuntime: runtime,
                      activeRuntime,
                    }),
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="opt-team__weapon">
        <span className="opt-team__group-label">{"Echoes"}</span>
        <OptimizerMainEchoCard
          runtime={runtime}
          activeRuntime={activeRuntime}
          allowedTargetScopes={allowedTargetScopes}
          onRuntimeUpdate={onRuntimeUpdate}
          invalidMainEcho={invalidMainEcho}
          onMainEchoClick={onMainEchoClick}
          onRemoveMainEcho={onRemoveMainEcho}
          showEmptyPlaceholder={!editableLevel}
        />

        <OptimizerEchoSetCards
          runtime={runtime}
          activeRuntime={activeRuntime}
          allowedTargetScopes={allowedTargetScopes}
          onRuntimeUpdate={onRuntimeUpdate}
          configurable={!editableLevel}
          setPreferences={setPreferences}
          setPreferenceSlotIndex={setPreferenceSlotIndex}
          onAddSetPreference={onAddSetPreference}
          onRemoveSetPreference={onRemoveSetPreference}
          onSetPreferenceCount={onSetPreferenceCount}
          showEmptyPlaceholder={!editableLevel}
        />
      </div>
    </article>
  )
}

function OptimizerTeammateCard({
  slotIndex,
  memberId,
  invalidMainEchoId,
  setPreferences,
  activeRuntime,
  onRuntimeUpdate,
  onOpenTeammatePicker,
  onOpenWeaponPicker,
  onOpenMainEchoPicker,
  onAddSetPreference,
  onRemoveSetPreference,
  onSetPreferenceCount,
  onRemoveTeammate,
  onRemoveMainEcho,
}: OptimizerTeammateCardProps) {
  const member = useMemo(() => getResonator(memberId), [memberId])
  const seed = useMemo(() => getResonatorSeedById(memberId), [memberId])
  const invalidMainEcho = useMemo(
    () => (invalidMainEchoId ? getEchoById(invalidMainEchoId) : null),
    [invalidMainEchoId],
  )

  const teammateRuntime = useMemo(() => {
    if (!seed) {
      return null
    }

    const compactRuntime = activeRuntime.teamRuntimes[slotIndex]
    const resolvedCompactRuntime = compactRuntime?.id === memberId
      ? compactRuntime
      : makeDefaultTeamMemberRuntime(seed)

    return materializeTeamMemberFromCompactRuntime(
      seed,
      resolvedCompactRuntime,
      activeRuntime.state.controls,
      activeRuntime.state.combat,
      activeRuntime.build.team,
    )
  }, [activeRuntime, memberId, seed, slotIndex])

  const updateTeammateRuntime = useCallback<RuntimeUpdateHandler>((updater) => {
    onRuntimeUpdate((prev) => {
      const nextMemberId = prev.build.team[slotIndex + 1]
      if (!nextMemberId) {
        return prev
      }

      const nextSeed = getResonatorSeedById(nextMemberId)
      if (!nextSeed) {
        return prev
      }

      const existingCompactRuntime = prev.teamRuntimes[slotIndex]
      const resolvedCompactRuntime = existingCompactRuntime?.id === nextMemberId
        ? existingCompactRuntime
        : makeDefaultTeamMemberRuntime(nextSeed)

      const materializedRuntime = materializeTeamMemberFromCompactRuntime(
        nextSeed,
        resolvedCompactRuntime,
        prev.state.controls,
        prev.state.combat,
        prev.build.team,
      )
      const nextRuntime = updater(materializedRuntime)
      const nextTeamRuntimes = [...prev.teamRuntimes] as [TeamMemberRuntime | null, TeamMemberRuntime | null]
      nextTeamRuntimes[slotIndex] = compactTeamMemberRuntime(nextRuntime)

      const memberIdsToClear = Array.from(
        new Set([existingCompactRuntime?.id, nextMemberId].filter((value): value is string => Boolean(value))),
      )

      return {
        ...prev,
        state: {
          ...prev.state,
          controls: buildTeammateControls(prev.state.controls, memberIdsToClear, nextMemberId, nextRuntime),
        },
        teamRuntimes: nextTeamRuntimes,
      }
    })
  }, [onRuntimeUpdate, slotIndex])

  if (!member || !teammateRuntime) {
    return (
      <article className="opt-team__card opt-team__card--empty">
        <span className="opt-team__slot-label">Teammate {slotIndex + 1}</span>
      </article>
    )
  }

  return (
    <OptimizerRuntimeCard
      slotLabel={`Teammate ${slotIndex + 1}`}
      rarity={member.rarity ?? 4}
      displayName={member.name}
      profileSrc={member.profile || `/assets/resonators/profiles/${memberId}.webp`}
      runtime={teammateRuntime}
      activeRuntime={activeRuntime}
      onRuntimeUpdate={updateTeammateRuntime}
      editableLevel={false}
      onPortraitClick={() => onOpenTeammatePicker(slotIndex)}
      onRemoveCharacter={() => onRemoveTeammate(slotIndex)}
      onWeaponClick={() => onOpenWeaponPicker(slotIndex)}
      invalidMainEcho={invalidMainEcho}
      onMainEchoClick={() => onOpenMainEchoPicker(slotIndex)}
      onRemoveMainEcho={() => onRemoveMainEcho(slotIndex)}
      setPreferences={setPreferences}
      setPreferenceSlotIndex={slotIndex}
      onAddSetPreference={onAddSetPreference}
      onRemoveSetPreference={onRemoveSetPreference}
      onSetPreferenceCount={onSetPreferenceCount}
    />
  )
}

export function OptimizerTeamPanel({
  rarity,
  displayName,
  optimizerRuntime,
  invalidMainEchoIds,
  teammateSetPreferences,
  onRuntimeUpdate,
  onOpenTeammatePicker,
  onOpenWeaponPicker,
  onOpenTeammateMainEchoPicker,
  onAddTeammateSetPreference,
  onRemoveTeammateSetPreference,
  onSetTeammateSetPreferenceCount,
  onRemoveTeammate,
  onRemoveTeammateMainEcho,
}: OptimizerTeamPanelProps) {
  const profileSrc = optimizerRuntime
    ? `/assets/resonators/profiles/${optimizerRuntime.id}.webp`
    : undefined

  if (!optimizerRuntime) {
    return null
  }

  return (
    <div className="opt-team">
      <div className="opt-team__grid">
        <OptimizerRuntimeCard
          slotLabel="Active Resonator"
          rarity={rarity}
          displayName={displayName}
          profileSrc={profileSrc}
          runtime={optimizerRuntime}
          activeRuntime={optimizerRuntime}
          onRuntimeUpdate={onRuntimeUpdate}
          editableLevel
          onWeaponClick={() => onOpenWeaponPicker('active')}
        />

        {([0, 1] as const).map((slotIndex) => {
          const memberId = optimizerRuntime.build.team[slotIndex + 1]

          if (!memberId) {
            return (
              <button
                key={slotIndex}
                type="button"
                className="opt-team__card opt-team__card--empty opt-team__card--empty-button"
                onClick={() => onOpenTeammatePicker(slotIndex)}
                aria-label={`Select teammate ${slotIndex + 1}`}
              >
                <span className="opt-team__slot-label">Teammate {slotIndex + 1}</span>
                <span className="opt-team__empty-add">Add Teammate</span>
              </button>
            )
          }

          return (
            <OptimizerTeammateCard
              key={`${slotIndex}-${memberId}`}
              slotIndex={slotIndex}
              memberId={memberId}
              invalidMainEchoId={invalidMainEchoIds[slotIndex]}
              setPreferences={teammateSetPreferences[slotIndex]}
              activeRuntime={optimizerRuntime}
              onRuntimeUpdate={onRuntimeUpdate}
              onOpenTeammatePicker={onOpenTeammatePicker}
              onOpenWeaponPicker={onOpenWeaponPicker}
              onOpenMainEchoPicker={onOpenTeammateMainEchoPicker}
              onAddSetPreference={onAddTeammateSetPreference}
              onRemoveSetPreference={onRemoveTeammateSetPreference}
              onSetPreferenceCount={onSetTeammateSetPreferenceCount}
              onRemoveTeammate={onRemoveTeammate}
              onRemoveMainEcho={onRemoveTeammateMainEcho}
            />
          )
        })}
      </div>
    </div>
  )
}
