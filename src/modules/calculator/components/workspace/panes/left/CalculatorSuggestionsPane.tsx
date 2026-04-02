import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { RandomGeneratorSettings, RandomGeneratorSetPreference } from '@/domain/entities/suggestions'
import type { EchoInstance, ResonatorRuntimeState } from '@/domain/entities/runtime'
import { cloneEchoLoadout } from '@/domain/entities/inventoryStorage'
import { DEFAULT_SONATA_SET_CONDITIONALS } from '@/domain/entities/sonataSetConditionals'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { selectActiveTargetSelections } from '@/domain/state/selectors'
import { useAppStore } from '@/domain/state/store'
import { ECHO_PRIMARY_STATS, ECHO_SECONDARY_STATS } from '@/data/gameData/catalog/echoStats'
import { getSonataSetIcon, getSonataSetName } from '@/data/gameData/catalog/sonataSets'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { isOptimizerDamageSkill } from '@/engine/optimizer/rules/eligibility.ts'
import { applySetPlanToEchoes, buildEchoMainStatLayoutSignature } from '@/engine/suggestions/mutate'
import { applyMainStatRecipesToEchoes } from '@/engine/suggestions/mainStat-suggestion/utils'
import { runMainStatSuggestionsJob, runRandomSuggestionsJob, runSetPlanSuggestionsJob } from '@/engine/suggestions/client'
import { readSuggestionsSessionCache, writeSuggestionsSessionCache } from '@/engine/suggestions/sessionCache'
import {
  buildPreparedMainStatSuggestionsInput,
  buildPreparedRandomSuggestionsInput,
  buildPreparedSetPlanSuggestionsInput,
  buildSuggestionEvaluationContext,
  evaluateSuggestionEchoes,
} from '@/engine/suggestions/shared'
import type {
  MainStatSuggestionEntry,
  RandomSuggestionEntry,
  SetPlanSuggestionEntry,
} from '@/engine/suggestions/types'
import type { SimulationResult } from '@/engine/pipeline/types'
import { formatCompactNumber, formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/overviewStats'
import {
  DEFAULT_RANDOM_SETTINGS,
  DEFAULT_SUGGESTIONS_STATE,
  ROTATION_TARGET_VALUE,
  buildCostSignature,
  buildEchoFullSignature,
  buildGroupedSubstats,
  buildMainStatCostSignature,
  buildMainStatRecipeSignature,
  buildRandomSettingsSignature,
  buildSetConditionalsSignature,
  buildSuggestionInputSignature,
  computeDiffPercent,
  formatDamage,
  getDiffArrow,
  getDiffLabel,
  getDiffTone,
  getRandomSetCountOptions,
  normalizeRandomSetPreferenceCount,
  setPlansEqual,
  sortEchoesForDisplay,
  sortMainStatRecipesForDisplay,
  summarizeCurrentSetPlan,
  trimRandomSetPreferences,
  type SuggestionsViewMode,
} from '@/modules/calculator/model/suggestions'
import { getEquippedEchoCost } from '@/modules/calculator/model/echoes'
import { EchoPickerModal } from '@/modules/calculator/components/workspace/panes/left/modals/EchoPickerModal'
import { SonataSetConditionalsModal } from '@/modules/calculator/components/workspace/panes/left/modals/SonataSetConditionalsModal'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility.ts'
import { getBodyPortalTarget } from '@/shared/lib/portalTarget'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'
import { AppDialog } from '@/shared/ui/AppDialog'
import { ModalCloseButton } from '@/shared/ui/ModalCloseButton'
import { EchoGrid } from '@/shared/ui/EchoGrid'

interface CalculatorSuggestionsPaneProps {
  runtime: ResonatorRuntimeState
  simulation: SimulationResult | null
  enemyProfile: EnemyProfile
  participantRuntimesById: Record<string, ResonatorRuntimeState>
}

interface SuggestionTargetOption {
  value: string
  label: string
}

const MODAL_EXIT_DURATION_MS = 320
const portalTarget = getBodyPortalTarget()

function SuggestionsModal(props: {
  open: boolean
  closing: boolean
  visible: boolean
  title: string
  onClose: () => void
  onApply?: () => void
  extraClassName?: string
  children: ReactNode
}) {
  const { open, closing, visible, title, onClose, onApply, extraClassName, children } = props
  const dashIdx = title.indexOf(' — ')
  const eyebrow = dashIdx !== -1 ? title.slice(0, dashIdx) : null
  const mainTitle = dashIdx !== -1 ? title.slice(dashIdx + 3) : title

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      contentClassName={['app-modal-panel suggestions-modal', extraClassName].filter(Boolean).join(' ')}
      ariaLabel={title}
      onClose={onClose}
    >
      <div className="app-modal-header suggestions-modal-header">
        <div className="app-modal-header-top">
          <div className="suggestions-modal-heading">
            {eyebrow && <span className="picker-modal__eyebrow">{eyebrow}</span>}
            <h3 className="suggestions-modal-title">{mainTitle}</h3>
          </div>
          <div className="suggestions-modal-header-actions">
            {onApply && (
              <button
                type="button"
                className="suggestions-apply-btn"
                onClick={() => { onApply(); onClose() }}
              >
                Apply
              </button>
            )}
            <ModalCloseButton onClick={onClose} />
          </div>
        </div>
      </div>
      <div className="suggestions-modal-body">{children}</div>
    </AppDialog>
  )
}


function SetBadge({ setId, pieces, className = 'echo-buff set-badge' }: { setId: number; pieces: number; className?: string }) {
  const label = getSonataSetName(setId)
  const icon = getSonataSetIcon(setId)

  return (
    <span className={className}>
      {icon ? (
        <img
          src={icon}
          alt={label}
          className="set-icon"
          loading="lazy"
        />
      ) : null}
      {pieces}pc {label}
    </span>
  )
}

export function CalculatorSuggestionsPane({
  runtime,
  simulation,
  enemyProfile,
  participantRuntimesById,
}: CalculatorSuggestionsPaneProps) {
  const [viewMode, setViewMode] = useState<SuggestionsViewMode>('mainStats')
  const [mainStatResults, setMainStatResults] = useState<MainStatSuggestionEntry[]>([])
  const [setPlanResults, setSetPlanResults] = useState<SetPlanSuggestionEntry[]>([])
  const [randomResults, setRandomResults] = useState<RandomSuggestionEntry[]>([])
  const [selectedMainStatIndex, setSelectedMainStatIndex] = useState(0)
  const [selectedSetPlanIndex, setSelectedSetPlanIndex] = useState(0)
  const [selectedRandomIndex, setSelectedRandomIndex] = useState(0)
  const [runningMainStats, setRunningMainStats] = useState(false)
  const [runningSetPlans, setRunningSetPlans] = useState(false)
  const [runningRandom, setRunningRandom] = useState(false)

  const inspectModal = useAnimatedVisibility(MODAL_EXIT_DURATION_MS)
  const setConfigModal = useAnimatedVisibility(MODAL_EXIT_DURATION_MS)
  const randomConfigModal = useAnimatedVisibility(MODAL_EXIT_DURATION_MS)
  const randomMainEchoPicker = useAnimatedVisibility(MODAL_EXIT_DURATION_MS)

  const selectedTargetsByOwnerKey = useAppStore(selectActiveTargetSelections)
  const suggestionsMap = useAppStore((state) => state.calculator.suggestionsByResonatorId)
  const updateActiveResonatorSuggestionsState = useAppStore((state) => state.updateActiveResonatorSuggestionsState)
  const updateActiveResonatorRuntime = useAppStore((state) => state.updateActiveResonatorRuntime)
  const updateActiveResonatorSetConditionals = useAppStore((state) => state.updateActiveResonatorSetConditionals)
  const setConditionals = useAppStore((state) => (
    state.calculator.profiles[runtime.id]?.runtime.local.setConditionals ?? DEFAULT_SONATA_SET_CONDITIONALS
  ))

  const suggestionsState = suggestionsMap[runtime.id] ?? DEFAULT_SUGGESTIONS_STATE
  const targetSequenceRef = useRef({ main: 0, set: 0, random: 0 })
  const didHydrateSetConditionalsRef = useRef(false)
  const activeSeed = useMemo(() => getResonatorSeedById(runtime.id), [runtime.id])
  const allEchoes = useMemo(() => listEchoes(), [])
  const setConditionalsSignature = useMemo(
    () => buildSetConditionalsSignature(setConditionals),
    [setConditionals],
  )

  const updateRandomSettings = useCallback((patch: Partial<RandomGeneratorSettings>) => {
    updateActiveResonatorSuggestionsState((state) => ({
      ...state,
      random: {
        ...state.random,
        ...patch,
      },
    }))
  }, [updateActiveResonatorSuggestionsState])

  const updateRandomSetPreferences = useCallback((
    updater: (preferences: RandomGeneratorSetPreference[]) => RandomGeneratorSetPreference[],
  ) => {
    updateActiveResonatorSuggestionsState((state) => ({
      ...state,
      random: {
        ...state.random,
        setPreferences: trimRandomSetPreferences(updater(state.random.setPreferences)),
      },
    }))
  }, [updateActiveResonatorSuggestionsState])

  const targetOptions = useMemo<SuggestionTargetOption[]>(() => {
    const direct = (simulation?.allSkills ?? [])
      .filter((entry) => (
        entry.resonatorId === runtime.id &&
        entry.aggregationType === 'damage' &&
        isOptimizerDamageSkill(entry.skill)
      ))
      .map((entry) => ({
        value: entry.id,
        label: entry.feature.label || entry.skill.label,
      }))

    if ((simulation?.rotations.personal.entries ?? []).some((entry) => (
      entry.resonatorId === runtime.id &&
      entry.aggregationType === 'damage' &&
      isOptimizerDamageSkill(entry.skill)
    ))) {
      return [
        ...direct,
        { value: ROTATION_TARGET_VALUE, label: 'Total Rotation DMG' },
      ]
    }

    return direct
  }, [runtime.id, simulation])

  const selectedTargetValue = suggestionsState.settings.rotationMode
    ? ROTATION_TARGET_VALUE
    : (suggestionsState.settings.targetFeatureId ?? '')

  useEffect(() => {
    if (targetOptions.length === 0) {
      return
    }

    if (suggestionsState.settings.rotationMode) {
      const hasRotationOption = targetOptions.some((option) => option.value === ROTATION_TARGET_VALUE)
      if (hasRotationOption) {
        return
      }
    } else if (
      suggestionsState.settings.targetFeatureId &&
      targetOptions.some((option) => option.value === suggestionsState.settings.targetFeatureId)
    ) {
      return
    }

    const fallback = targetOptions[0]
    updateActiveResonatorSuggestionsState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        rotationMode: fallback.value === ROTATION_TARGET_VALUE,
        targetFeatureId: fallback.value === ROTATION_TARGET_VALUE ? state.settings.targetFeatureId : fallback.value,
      },
    }))
  }, [
    suggestionsState.settings.rotationMode,
    suggestionsState.settings.targetFeatureId,
    targetOptions,
    updateActiveResonatorSuggestionsState,
  ])

  const suggestionEvaluationContext = useMemo(() => {
    if (
      !simulation ||
      !activeSeed ||
      (!suggestionsState.settings.rotationMode && targetOptions.length === 0)
    ) {
      return null
    }

    return buildSuggestionEvaluationContext({
      runtime,
      seed: activeSeed,
      enemy: enemyProfile,
      runtimesById: participantRuntimesById,
      selectedTargetsByOwnerKey,
      setConditionals,
      targetFeatureId: suggestionsState.settings.targetFeatureId,
      rotationMode: suggestionsState.settings.rotationMode,
    }, simulation)
  }, [
    activeSeed,
    enemyProfile,
    participantRuntimesById,
    runtime,
    selectedTargetsByOwnerKey,
    setConditionals,
    simulation,
    suggestionsState.settings.rotationMode,
    suggestionsState.settings.targetFeatureId,
    targetOptions.length,
  ])

  const baseDamage = useMemo(() => {
    if (!suggestionEvaluationContext) {
      return 0
    }

    return evaluateSuggestionEchoes(suggestionEvaluationContext, runtime.build.echoes)
  }, [runtime.build.echoes, suggestionEvaluationContext])

  const currentMainStatSignature = useMemo(
    () => buildEchoMainStatLayoutSignature(runtime.build.echoes),
    [runtime.build.echoes],
  )
  const currentEchoSignature = useMemo(
    () => buildEchoFullSignature(runtime.build.echoes),
    [runtime.build.echoes],
  )
  const currentSetPlan = useMemo(
    () => summarizeCurrentSetPlan(runtime.build.echoes),
    [runtime.build.echoes],
  )

  const canRunDirectSuggestions = Boolean(activeSeed) && targetOptions.length > 0 && (
    suggestionsState.settings.rotationMode ||
    suggestionsState.settings.targetFeatureId != null
  )
  const baseSuggestionInputSignature = useMemo(() => buildSuggestionInputSignature({
    runtime,
    enemyProfile,
    participantRuntimesById,
    selectedTargetsByOwnerKey,
    setConditionals,
    targetFeatureId: suggestionsState.settings.targetFeatureId,
    rotationMode: suggestionsState.settings.rotationMode,
  }), [
    enemyProfile,
    participantRuntimesById,
    runtime,
    selectedTargetsByOwnerKey,
    setConditionals,
    suggestionsState.settings.rotationMode,
    suggestionsState.settings.targetFeatureId,
  ])
  const mainStatsCacheKey = useMemo(
    () => `main:${runtime.id}:${baseSuggestionInputSignature}`,
    [baseSuggestionInputSignature, runtime.id],
  )
  const setPlansCacheKey = useMemo(
    () => `sets:${runtime.id}:${baseSuggestionInputSignature}`,
    [baseSuggestionInputSignature, runtime.id],
  )
  const randomCacheKey = useMemo(
    () => `random:${runtime.id}:${baseSuggestionInputSignature}:${buildRandomSettingsSignature(suggestionsState.random)}`,
    [baseSuggestionInputSignature, runtime.id, suggestionsState.random],
  )

  const runMainStats = useCallback(async (force = false) => {
    if (!canRunDirectSuggestions) {
      setMainStatResults([])
      return
    }
    if (!activeSeed) {
      return
    }

    if (!force) {
      const cached = readSuggestionsSessionCache<MainStatSuggestionEntry[]>(mainStatsCacheKey)
      if (cached) {
        setMainStatResults(cached)
        setSelectedMainStatIndex(0)
        setRunningMainStats(false)
        return
      }
    }

    const seq = targetSequenceRef.current.main + 1
    targetSequenceRef.current.main = seq
    setRunningMainStats(true)

    try {
      const prepared = simulation ? buildPreparedMainStatSuggestionsInput({
        runtime,
        seed: activeSeed,
        enemy: enemyProfile,
        runtimesById: participantRuntimesById,
        selectedTargetsByOwnerKey,
        setConditionals,
        targetFeatureId: suggestionsState.settings.targetFeatureId,
        rotationMode: suggestionsState.settings.rotationMode,
      }, simulation) : null

      if (!prepared) {
        setMainStatResults([])
        return
      }

      const results = await runMainStatSuggestionsJob(prepared)

      if (targetSequenceRef.current.main !== seq) {
        return
      }

      writeSuggestionsSessionCache(mainStatsCacheKey, results)
      setMainStatResults(results)
      setSelectedMainStatIndex(0)
    } catch (error) {
      if (targetSequenceRef.current.main === seq) {
        setMainStatResults([])
      }
      console.error('[CalculatorSuggestionsPane] main stat suggestions failed', error)
    } finally {
      if (targetSequenceRef.current.main === seq) {
        setRunningMainStats(false)
      }
    }
  }, [
    canRunDirectSuggestions,
    enemyProfile,
    activeSeed,
    participantRuntimesById,
    runtime,
    simulation,
    setConditionals,
    selectedTargetsByOwnerKey,
    mainStatsCacheKey,
    suggestionsState.settings.rotationMode,
    suggestionsState.settings.targetFeatureId,
  ])

  const runSetPlans = useCallback(async (force = false) => {
    if (!canRunDirectSuggestions) {
      setSetPlanResults([])
      return
    }
    if (!activeSeed) {
      return
    }

    if (!force) {
      const cached = readSuggestionsSessionCache<SetPlanSuggestionEntry[]>(setPlansCacheKey)
      if (cached) {
        setSetPlanResults(cached)
        setSelectedSetPlanIndex(0)
        setRunningSetPlans(false)
        return
      }
    }

    const seq = targetSequenceRef.current.set + 1
    targetSequenceRef.current.set = seq
    setRunningSetPlans(true)

    try {
      const prepared = simulation ? buildPreparedSetPlanSuggestionsInput({
        runtime,
        seed: activeSeed,
        enemy: enemyProfile,
        runtimesById: participantRuntimesById,
        selectedTargetsByOwnerKey,
        setConditionals,
        targetFeatureId: suggestionsState.settings.targetFeatureId,
        rotationMode: suggestionsState.settings.rotationMode,
      }, simulation) : null

      if (!prepared) {
        setSetPlanResults([])
        return
      }

      const results = await runSetPlanSuggestionsJob(prepared)

      if (targetSequenceRef.current.set !== seq) {
        return
      }

      writeSuggestionsSessionCache(setPlansCacheKey, results)
      setSetPlanResults(results)
      setSelectedSetPlanIndex(0)
    } catch (error) {
      if (targetSequenceRef.current.set === seq) {
        setSetPlanResults([])
      }
      console.error('[CalculatorSuggestionsPane] set plan suggestions failed', error)
    } finally {
      if (targetSequenceRef.current.set === seq) {
        setRunningSetPlans(false)
      }
    }
  }, [
    canRunDirectSuggestions,
    enemyProfile,
    activeSeed,
    participantRuntimesById,
    runtime,
    simulation,
    setConditionals,
    selectedTargetsByOwnerKey,
    setPlansCacheKey,
    suggestionsState.settings.rotationMode,
    suggestionsState.settings.targetFeatureId,
  ])

  const runRandom = useCallback(async (force = false) => {
    if (!canRunDirectSuggestions) {
      setRandomResults([])
      return
    }
    if (!activeSeed) {
      return
    }

    if (!force) {
      const cached = readSuggestionsSessionCache<RandomSuggestionEntry[]>(randomCacheKey)
      if (cached) {
        setRandomResults(cached)
        setSelectedRandomIndex(0)
        setRunningRandom(false)
        return
      }
    }

    const seq = targetSequenceRef.current.random + 1
    targetSequenceRef.current.random = seq
    setRunningRandom(true)

    try {
      const prepared = simulation ? buildPreparedRandomSuggestionsInput({
        runtime,
        seed: activeSeed,
        enemy: enemyProfile,
        runtimesById: participantRuntimesById,
        selectedTargetsByOwnerKey,
        setConditionals,
        targetFeatureId: suggestionsState.settings.targetFeatureId,
        rotationMode: suggestionsState.settings.rotationMode,
        settings: suggestionsState.random,
      }, simulation) : null

      if (!prepared) {
        setRandomResults([])
        return
      }

      const results = await runRandomSuggestionsJob(prepared)

      if (targetSequenceRef.current.random !== seq) {
        return
      }

      writeSuggestionsSessionCache(randomCacheKey, results)
      setRandomResults(results)
      setSelectedRandomIndex(0)
    } catch (error) {
      if (targetSequenceRef.current.random === seq) {
        setRandomResults([])
      }
      console.error('[CalculatorSuggestionsPane] random suggestions failed', error)
    } finally {
      if (targetSequenceRef.current.random === seq) {
        setRunningRandom(false)
      }
    }
  }, [
    canRunDirectSuggestions,
    enemyProfile,
    activeSeed,
    participantRuntimesById,
    runtime,
    simulation,
    setConditionals,
    selectedTargetsByOwnerKey,
    randomCacheKey,
    suggestionsState.random,
    suggestionsState.settings.rotationMode,
    suggestionsState.settings.targetFeatureId,
  ])

  useEffect(() => {
    setRandomResults([])
    setSelectedRandomIndex(0)
    void runMainStats()
    void runSetPlans()
  }, [runMainStats, runSetPlans])

  useEffect(() => {
    if (!didHydrateSetConditionalsRef.current) {
      didHydrateSetConditionalsRef.current = true
      return
    }

    setRandomResults([])
    setSelectedRandomIndex(0)
    void runMainStats(true)
    void runSetPlans(true)
  }, [setConditionalsSignature, runMainStats, runSetPlans])

  useEffect(() => {
    if (viewMode === 'random' && randomResults.length === 0 && !runningRandom && canRunDirectSuggestions) {
      void runRandom()
    }
  }, [canRunDirectSuggestions, randomResults.length, runRandom, runningRandom, viewMode])

  const handleTargetChange = useCallback((value: string) => {
    updateActiveResonatorSuggestionsState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        rotationMode: value === ROTATION_TARGET_VALUE,
        targetFeatureId: value === ROTATION_TARGET_VALUE ? state.settings.targetFeatureId : value,
      },
    }))
  }, [updateActiveResonatorSuggestionsState])

  const applyEchoes = useCallback((echoes: Array<EchoInstance | null>) => {
    updateActiveResonatorRuntime((currentRuntime) => ({
      ...currentRuntime,
      build: {
        ...currentRuntime.build,
        echoes: cloneEchoLoadout(echoes),
      },
    }))
  }, [updateActiveResonatorRuntime])

  const selectedMainStatPlan = mainStatResults[selectedMainStatIndex] ?? null
  const selectedMainStatEchoes = useMemo(
    () => selectedMainStatPlan
      ? applyMainStatRecipesToEchoes(selectedMainStatPlan.recipes, runtime.build.echoes)
      : [],
    [runtime.build.echoes, selectedMainStatPlan],
  )
  const selectedSetPlan = setPlanResults[selectedSetPlanIndex] ?? null
  const selectedSetPlanEchoes = useMemo(
    () => selectedSetPlan
      ? applySetPlanToEchoes(selectedSetPlan.setPlan, runtime.build.echoes)
      : [],
    [runtime.build.echoes, selectedSetPlan],
  )
  const selectedRandomPlan = randomResults[selectedRandomIndex] ?? null
  const randomSubstats = useMemo(
    () => buildGroupedSubstats(selectedRandomPlan?.echoes ?? []),
    [selectedRandomPlan],
  )
  const selectedRandomMainEchoId = suggestionsState.random.mainEchoId ?? runtime.build.echoes[0]?.id ?? null
  const selectedRandomMainEcho = useMemo(
    () => selectedRandomMainEchoId ? getEchoById(selectedRandomMainEchoId) : null,
    [selectedRandomMainEchoId],
  )
  const totalRandomSetPieces = useMemo(
    () => suggestionsState.random.setPreferences.reduce((sum, entry) => sum + entry.count, 0),
    [suggestionsState.random.setPreferences],
  )
  const canAddRandomSet = totalRandomSetPieces === 0 || (
    totalRandomSetPieces < 4 &&
    suggestionsState.random.setPreferences.length < 2
  )
  const availableRandomSetOptions = useMemo(() => (
    ECHO_SET_DEFS
      .filter((entry) => !suggestionsState.random.setPreferences.some((selected) => selected.setId === entry.id))
      .map((entry) => ({
        value: String(entry.id),
        label: entry.name,
        icon: getSonataSetIcon(entry.id) ?? undefined,
      }))
  ), [suggestionsState.random.setPreferences])

  const handleAddRandomSet = useCallback((value: string) => {
    const setId = Number(value)
    if (!Number.isFinite(setId)) {
      return
    }

    const defaultCount = getRandomSetCountOptions(setId)[0]
    if (!defaultCount) {
      return
    }

    updateRandomSetPreferences((preferences) => [
      { setId, count: defaultCount },
      ...preferences.filter((entry) => entry.setId !== setId),
    ])
  }, [updateRandomSetPreferences])

  const handleRandomSetCountChange = useCallback((setId: number, nextCount: number) => {
    updateRandomSetPreferences((preferences) => {
      const current = preferences.find((entry) => entry.setId === setId)
      if (!current) {
        return preferences
      }

      return [
        {
          setId,
          count: normalizeRandomSetPreferenceCount(setId, nextCount),
        },
        ...preferences.filter((entry) => entry.setId !== setId),
      ]
    })
  }, [updateRandomSetPreferences])

  const handleRemoveRandomSet = useCallback((setId: number) => {
    updateRandomSetPreferences((preferences) => preferences.filter((entry) => entry.setId !== setId))
  }, [updateRandomSetPreferences])

  return (
    <div className="suggestions-pane">
      <div>
        <div className="panel-overline">Optimizer</div>
        <h3>Suggestions</h3>
      </div>

      <div className="rotation-view-toggle">
        <button
          type="button"
          className={`view-toggle-button${viewMode === 'mainStats' ? ' active' : ''}`}
          onClick={() => setViewMode('mainStats')}
        >
          Main Stats
        </button>
        <button
          type="button"
          className={`view-toggle-button${viewMode === 'setPlans' ? ' active' : ''}`}
          onClick={() => setViewMode('setPlans')}
        >
          Sonata Sets
        </button>
        <button
          type="button"
          className={`view-toggle-button${viewMode === 'random' ? ' active' : ''}`}
          onClick={() => setViewMode('random')}
        >
          Random Echoes
        </button>
      </div>

      {viewMode === 'mainStats' && (
        <div className={`suggestions-list main-stats app-loader-host${runningMainStats ? ' running' : ''}`}>
          {runningMainStats && <AppLoaderOverlay text="Generating main stat suggestions…" />}
          <div className="pane-section suggestions-controls rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                  <LiquidSelect
                    value={selectedTargetValue}
                    options={targetOptions}
                    onChange={(value) => handleTargetChange(String(value))}
                    placeholder="Target Skill"
                  />
                </div>
              </div>
              <div className="rotation-toolbar-group">
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() => selectedMainStatPlan && applyEchoes(selectedMainStatEchoes)}
                  disabled={!selectedMainStatPlan}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={inspectModal.show}
                  disabled={!selectedMainStatPlan}
                >
                  Inspect
                </button>
                <button
                  type="button"
                  className="rotation-button clear"
                  onClick={() => setSelectedMainStatIndex(0)}
                >
                  Reset Selection
                </button>
              </div>
            </div>
          </div>

          {mainStatResults.length === 0 ? (
            <span className="suggestions-empty-state">Select a target above to see main stat suggestions.</span>
          ) : (
            mainStatResults.map((plan, index) => {
              const diff = computeDiffPercent(plan.damage, baseDamage)
              const isCurrent = buildMainStatRecipeSignature(plan.recipes) === currentMainStatSignature

              return (
                <div
                  key={`main-${index}`}
                  className={`main-stat-card${selectedMainStatIndex === index ? ' selected' : ''}`}
                  onClick={() => setSelectedMainStatIndex(index)}
                >
                  <div className="main-stat-rows">
                    <div className="main-stat-header">
                      <div className="main-stat-title-row">
                        <span className="main-stat-rank">#{index + 1}</span>
                        <div className="main-stat-details-container">
                          <div className="cost-signature">{buildMainStatCostSignature(plan.recipes)}</div>
                          <div className="main-stat-details">
                            <div className="set-plan-damage-container" style={{ marginLeft: 'unset' }}>
                              <span className="set-plan-damage-main avg">{formatDamage(plan.damage)}</span>
                            </div>
                            <span className="main-stat-row-echo">
                              <span className={`set-plan-damage-diff ${getDiffTone(diff)}`}>
                                {getDiffLabel(diff, isCurrent)}
                                {getDiffArrow(diff)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {sortMainStatRecipesForDisplay(plan.recipes).map((recipe, recipeIndex) => (
                      <div key={`${recipe.cost}-${recipe.primaryKey}-${recipeIndex}`} className="echo-buff main-stat-row">
                        <div className="main-stat-row-left">
                          <span className="main-stat-row-slot">Cost {recipe.cost}</span>
                        </div>
                        <div className="main-stat-row-pills">
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{formatStatKeyLabel(recipe.primaryKey)}</span>
                            <span className="main-stat-pill-value highlight">{formatStatKeyValue(recipe.primaryKey, ECHO_PRIMARY_STATS[recipe.cost]?.[recipe.primaryKey] ?? 0)}</span>
                          </span>
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{formatStatKeyLabel(ECHO_SECONDARY_STATS[recipe.cost]?.key ?? 'atkFlat')}</span>
                            <span className="main-stat-pill-value highlight">{formatStatKeyValue(ECHO_SECONDARY_STATS[recipe.cost]?.key ?? 'atkFlat', ECHO_SECONDARY_STATS[recipe.cost]?.value ?? 0)}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {viewMode === 'setPlans' && (
        <div className={`suggestions-list set-plan app-loader-host${runningSetPlans ? ' running' : ''}`}>
          {runningSetPlans && <AppLoaderOverlay text="Generating Sonata set suggestions…" />}
          <div className="pane-section suggestions-controls rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                  <LiquidSelect
                    value={selectedTargetValue}
                    options={targetOptions}
                    onChange={(value) => handleTargetChange(String(value))}
                    placeholder="Target Skill"
                  />
                </div>
              </div>
              <div className="rotation-toolbar-group">
                <button type="button" className="rotation-button" onClick={setConfigModal.show}>
                  Config
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() => selectedSetPlan && applyEchoes(selectedSetPlanEchoes)}
                  disabled={!selectedSetPlan}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={inspectModal.show}
                  disabled={!selectedSetPlan}
                >
                  Inspect
                </button>
                <button
                  type="button"
                  className="rotation-button clear"
                  onClick={() => setSelectedSetPlanIndex(0)}
                >
                  Reset Selection
                </button>
              </div>
            </div>
          </div>

          {setPlanResults.length === 0 ? (
            <span className="suggestions-empty-state">Select a target above to see Sonata set suggestions.</span>
          ) : (
            setPlanResults.map((plan, index) => {
              const diff = computeDiffPercent(plan.avgDamage, baseDamage)
              const isCurrent = setPlansEqual(plan.setPlan, currentSetPlan)

              return (
                <button
                  key={`set-${index}`}
                  type="button"
                  className={`set-plan-card${selectedSetPlanIndex === index ? ' selected' : ''}`}
                  onClick={() => setSelectedSetPlanIndex(index)}
                >
                  <div className="set-plan-header">
                    <div className="set-plan-title-row">
                      <span className="set-plan-rank">#{index + 1}</span>
                      <div className="set-plan-sets">
                        {plan.setPlan.map((entry) => (
                          <SetBadge
                            key={`${entry.setId}-${entry.pieces}`}
                            setId={entry.setId}
                            pieces={entry.pieces}
                          />
                        ))}
                      </div>
                      <div className="set-plan-damage-container">
                        <span className="set-plan-damage-main avg">avg: {formatCompactNumber(plan.avgDamage)}</span>
                        <span className={`echo-buff set-plan-damage-diff ${getDiffTone(diff)}`}>
                          {getDiffLabel(diff, isCurrent)}
                          {getDiffArrow(diff)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      )}

      {viewMode === 'random' && (
        <div className={`suggestions-list random-view app-loader-host${runningRandom ? ' running' : ''}`}>
          {runningRandom && <AppLoaderOverlay text="Generating random echo builds…" />}
          <div className="pane-section suggestions-controls rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                  <LiquidSelect
                    value={selectedTargetValue}
                    options={targetOptions}
                    onChange={(value) => handleTargetChange(String(value))}
                    placeholder="Target Skill"
                  />
                </div>
              </div>
              <div className="rotation-toolbar-group">
                <button type="button" className="rotation-button" onClick={randomConfigModal.show}>
                  Config
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() => selectedRandomPlan && applyEchoes(selectedRandomPlan.echoes)}
                  disabled={!selectedRandomPlan}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={inspectModal.show}
                  disabled={!selectedRandomPlan}
                >
                  Inspect
                </button>
                <button type="button" className="rotation-button" onClick={() => void runRandom(true)}>
                  Regenerate
                </button>
                <button
                  type="button"
                  className="rotation-button clear"
                  onClick={() => setSelectedRandomIndex(0)}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {randomResults.length === 0 ? (
            <span className="suggestions-empty-state">Open this view or regenerate to roll random echo builds.</span>
          ) : (
            randomResults.map((plan, index) => {
              const diff = computeDiffPercent(plan.damage, baseDamage)
              const isCurrent = buildEchoFullSignature(plan.echoes) === currentEchoSignature
              const groupedSubstats = buildGroupedSubstats(plan.echoes).slice(0, 6)

              return (
                <div
                  key={`random-${index}`}
                  className={`main-stat-card${selectedRandomIndex === index ? ' selected' : ''}`}
                  onClick={() => setSelectedRandomIndex(index)}
                >
                  <div className="main-stat-rows">
                    <div className="main-stat-header">
                      <div className="main-stat-title-row">
                        <span className="main-stat-rank">#{index + 1}</span>
                        <div className="main-stat-details-container">
                          <div className="cost-signature">{buildCostSignature(plan.echoes)}</div>
                          <div className="main-stat-details">
                            <div className="set-plan-damage-container" style={{ marginLeft: 'unset' }}>
                              <span className="set-plan-damage-main avg">{formatDamage(plan.damage)}</span>
                            </div>
                            <span className="main-stat-row-echo">
                              <span className={`set-plan-damage-diff ${getDiffTone(diff)}`}>
                                {getDiffLabel(diff, isCurrent)}
                                {getDiffArrow(diff)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {sortEchoesForDisplay(plan.echoes).map((echo) => (
                      <div key={echo.uid} className="echo-buff main-stat-row">
                        <div className="main-stat-row-left">
                          <span className="main-stat-row-slot">Cost {getEquippedEchoCost(echo)}</span>
                        </div>
                        <div className="main-stat-row-pills random">
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{formatStatKeyLabel(echo.mainStats.primary.key)}</span>
                            <span className="main-stat-pill-value highlight">{formatStatKeyValue(echo.mainStats.primary.key, echo.mainStats.primary.value)}</span>
                          </span>
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{formatStatKeyLabel(echo.mainStats.secondary.key)}</span>
                            <span className="main-stat-pill-value highlight">{formatStatKeyValue(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {groupedSubstats.length > 0 && (
                    <div className="sub-stat-row-pills">
                      {groupedSubstats.map((entry) => (
                        <span key={entry.key} className="echo-buff main-stat-pill subs">
                          <span className="main-stat-pill-stat">∑{entry.label}</span>
                          <span className="main-stat-pill-value highlight">{entry.value}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      <SuggestionsModal
        {...inspectModal}
        title={
          viewMode === 'setPlans'
            ? 'Inspect — Suggested Sonata Sets'
            : viewMode === 'random'
              ? 'Inspect — Random Echo Build'
              : 'Inspect — Suggested Main Stats'
        }
        onClose={inspectModal.hide}
        onApply={
          viewMode === 'mainStats' && selectedMainStatPlan
            ? () => applyEchoes(selectedMainStatEchoes)
            : viewMode === 'setPlans' && selectedSetPlan
              ? () => applyEchoes(selectedSetPlanEchoes)
              : viewMode === 'random' && selectedRandomPlan
                ? () => applyEchoes(selectedRandomPlan.echoes)
                : undefined
        }
      >
        {viewMode === 'random' && selectedRandomPlan && (
          <div className="suggestions-inspect-score-row">
            <span className="suggestions-config-label">Build Score</span>
            <span className={`set-plan-damage-diff echo-buff ${getDiffTone(computeDiffPercent(selectedRandomPlan.damage, baseDamage))}`}>
              {Math.abs(computeDiffPercent(selectedRandomPlan.damage, baseDamage)).toFixed(1)}%
              {getDiffArrow(computeDiffPercent(selectedRandomPlan.damage, baseDamage))}
            </span>
          </div>
        )}
        <EchoGrid
          echoes={
            viewMode === 'setPlans'
              ? selectedSetPlanEchoes
              : viewMode === 'random'
                ? (selectedRandomPlan?.echoes ?? [])
                : selectedMainStatEchoes
          }
          variant="full"
          showSubstats
          showImage
        />
        {viewMode === 'setPlans' && selectedSetPlan && (
          <div className="suggestions-set-detail">
            {selectedSetPlan.setPlan.map((entry) => {
              const definition = ECHO_SET_DEFS.find((set) => set.id === entry.setId)
              const desc = entry.pieces === 2
                ? definition?.desc.twoPiece
                : entry.pieces === 3
                  ? definition?.desc.threePiece
                  : definition?.desc.fivePiece

              return (
                <div key={`${entry.setId}-${entry.pieces}`} className="suggestions-set-detail-row">
                  <SetBadge
                    setId={entry.setId}
                    pieces={entry.pieces}
                    className="set-badge"
                  />
                  <p className="suggestions-modal-hint" style={{ margin: 0 }}>
                    {desc ?? 'Active set bonus.'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
        {viewMode === 'random' && randomSubstats.length > 0 && (
          <div>
            <span className="suggestions-config-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Combined Substats
            </span>
            <div className="sub-stat-row-pills" style={{ flexWrap: 'wrap' }}>
              {randomSubstats.map((entry) => (
                <span key={entry.key} className="echo-buff main-stat-pill subs">
                  <span className="main-stat-pill-stat">∑{entry.label}</span>
                  <span className="main-stat-pill-value highlight">{entry.value}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </SuggestionsModal>

      <SonataSetConditionalsModal
        {...setConfigModal}
        portalTarget={portalTarget}
        onClose={setConfigModal.hide}
        title="Sonata Set Config"
        setConditionals={setConditionals}
        onSetConditionalsChange={updateActiveResonatorSetConditionals}
      />

      <SuggestionsModal
        {...randomConfigModal}
        title="Config — Random Echoes"
        onClose={randomConfigModal.hide}
        extraClassName="suggestions-modal--narrow"
      >
        <div className="rc-panel">
          {/* ── Basics ── */}
          <div className="rc-section">
            <div className="rc-row-pair">
              <div className="rc-row">
                <span className="rc-label">Main Echo</span>
                <button type="button" className="rc-echo-btn" onClick={randomMainEchoPicker.show}>
                  {selectedRandomMainEcho?.icon ? (
                    <img
                      src={selectedRandomMainEcho.icon}
                      alt={selectedRandomMainEcho.name}
                      className="rc-echo-img"
                      loading="lazy"
                    />
                  ) : (
                    <span className="rc-echo-empty">?</span>
                  )}
                  <span className="rc-echo-name">
                    {selectedRandomMainEcho?.name ?? 'Any echo'}
                  </span>
                </button>
              </div>

              <div className="rc-row">
                <span className="rc-label">Target</span>
                <LiquidSelect
                  value={selectedTargetValue}
                  options={targetOptions}
                  onChange={(value) => handleTargetChange(String(value))}
                  placeholder="Target Skill"
                />
              </div>
            </div>

            <div className="rc-row">
              <span className="rc-label">Energy</span>
              <input
                type="number"
                min={0}
                max={200}
                step={100}
                value={suggestionsState.random.targetEnergyRegen}
                onChange={(event) => updateRandomSettings({
                  targetEnergyRegen: Math.max(0, Math.min(200, Number(event.target.value) || 0)),
                })}
                className="rc-number"
              />
            </div>
          </div>

          <div className="rc-sep" />

          {/* ── Sliders ── */}
          <div className="rc-section">
            <div className="rc-sliders-grid">
              <div className="rc-slider-row">
                <div className="rc-slider-meta">
                  <span className="rc-label">Bias</span>
                  <div className="rc-slider-ends">
                    <span>Balanced</span>
                    <span>Focused</span>
                  </div>
                </div>
                <div className="rc-slider-track">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={suggestionsState.random.bias}
                    onChange={(event) => updateRandomSettings({ bias: Number(event.target.value) })}
                  />
                  <span className="rc-slider-value">{suggestionsState.random.bias.toFixed(1)}</span>
                </div>
              </div>

              <div className="rc-slider-row">
                <div className="rc-slider-meta">
                  <span className="rc-label">Quality</span>
                  <div className="rc-slider-ends">
                    <span>Lower</span>
                    <span>Higher</span>
                  </div>
                </div>
                <div className="rc-slider-track">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={suggestionsState.random.rollQuality}
                    onChange={(event) => updateRandomSettings({ rollQuality: Number(event.target.value) })}
                  />
                  <span className="rc-slider-value">{suggestionsState.random.rollQuality.toFixed(1)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rc-sep" />

          {/* ── Sonata Sets ── */}
          <div className="rc-section">
            <div className="rc-section-head">
              <span className="rc-label">Sonata Sets</span>
              {canAddRandomSet && availableRandomSetOptions.length > 0 && (
                <LiquidSelect
                  value=""
                  options={availableRandomSetOptions}
                  onChange={(value) => handleAddRandomSet(String(value))}
                  placeholder="+ Add set"
                />
              )}
            </div>

            {suggestionsState.random.setPreferences.length === 0 ? (
              <span className="rc-empty">No constraint — generator picks freely.</span>
            ) : (
              suggestionsState.random.setPreferences.map((entry) => {
                const definition = ECHO_SET_DEFS.find((set) => set.id === entry.setId)
                if (!definition) return null
                const setIcon = getSonataSetIcon(entry.setId)
                const countOptions = getRandomSetCountOptions(entry.setId)

                return (
                  <div key={`rc-set-${entry.setId}`} className="rc-set-row">
                    {setIcon && (
                      <img src={setIcon} alt={definition.name} className="rc-set-icon" loading="lazy" />
                    )}
                    <span className="rc-set-name">{definition.name}</span>
                    <div className="rc-set-counts">
                      {countOptions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`rc-count-btn${entry.count === option ? ' active' : ''}`}
                          onClick={() => handleRandomSetCountChange(entry.setId, option)}
                        >
                          {option}pc
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="rc-remove-btn"
                      onClick={() => handleRemoveRandomSet(entry.setId)}
                      aria-label={`Remove ${definition.name}`}
                    >
                      ×
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <div className="rc-footer">
            <button
              type="button"
              className="rc-reset-btn"
              onClick={() => updateRandomSettings({ ...DEFAULT_RANDOM_SETTINGS, setPreferences: [] })}
            >
              ↺ Reset to defaults
            </button>
          </div>
        </div>
      </SuggestionsModal>

      <EchoPickerModal
        visible={randomMainEchoPicker.visible}
        open={randomMainEchoPicker.open}
        closing={randomMainEchoPicker.closing}
        portalTarget={portalTarget}
        echoes={allEchoes}
        selectedEchoId={selectedRandomMainEchoId}
        slotIndex={0}
        onSelect={(echoId: string) => updateRandomSettings({ mainEchoId: echoId })}
        onClear={() => updateRandomSettings({ mainEchoId: null })}
        onClose={randomMainEchoPicker.hide}
      />
    </div>
  )
}
