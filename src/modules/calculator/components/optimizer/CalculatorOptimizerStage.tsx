import {type ReactNode, useCallback} from 'react'
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {RotationNode} from '@/domain/gameData/contracts'
import {DEFAULT_SONATA_SET_CONDITIONALS} from '@/domain/entities/sonataSetConditionals'
import { isUnsetWeaponId, type EchoInstance, type ResonatorRuntimeState, type TeamMemberRuntime } from '@/domain/entities/runtime'
import {cloneEchoForSlot} from '@/domain/entities/inventoryStorage'
import { makeDefaultTeamMemberRuntime } from '@/domain/state/defaults'
import { materializeTeamMemberFromCompactRuntime } from '@/domain/state/runtimeMaterialization'
import {useAnimatedModalValue, useAnimatedVisibility} from '@/app/hooks/useAnimatedVisibility.ts'
import type {LiquidSelectOption, LiquidSelectOptionGroup} from '@/shared/ui/LiquidSelect'
import {getSonataSetIcon, getSonataSetName} from '@/data/gameData/catalog/sonataSets'
import {getEchoCatalogById} from '@/data/gameData/catalog/echoes'
import {getGameData} from '@/data/gameData'
import {ECHO_SET_DEFS, getEchoSetDef} from '@/data/gameData/echoSets/effects'
import {getResonatorCatalogById, getResonatorDetailsById} from '@/data/gameData/resonators/resonatorDataStore'
import {getWeaponsById} from '@/data/gameData/weapons/weaponDataStore'
import {getEchoById, listEchoes} from '@/domain/services/echoCatalogService'
import { listStatesForSource } from '@/domain/services/gameDataService'
import { listWeaponsByType } from '@/domain/services/weaponCatalogService'
import {buildRuntimeParticipantLookup} from '@/domain/state/runtimeAdapters'
import {useAppStore} from '@/domain/state/store'
import {
  selectActiveResonatorId,
  selectActiveTargetSelections,
  selectEnemyProfile,
  selectOptimizerContext,
} from '@/domain/state/selectors'
import {compileOptimizerPayload} from '@/engine/optimizer/compiler'
import {applyKeepPercentFilter, buildOptimizerStatWeightMap} from '@/engine/optimizer/search/filtering.ts'
import {
  evaluateOptimizerBagResultStats,
  evaluatePreparedOptimizerBaseline,
  resolveOptimizerResultEchoes,
} from '@/engine/optimizer/results/materialize.ts'
import {compileOptimizerTargetContext} from '@/engine/optimizer/target/context'
import {listOptimizerTargets} from '@/engine/optimizer/target/skills'
import {countOptimizerCombinationsByMode} from '@/engine/optimizer/search/counting'
import type {OptimizerBagResultRef, OptimizerProgress} from '@/engine/optimizer/types'
import {seedResonatorsById} from '@/modules/calculator/model/seedData'
import {AppDialog} from '@/shared/ui/AppDialog'
import {Expandable} from '@/shared/ui/Expandable'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'
import {EchoPickerModal} from '@/modules/calculator/components/workspace/panes/left/modals/EchoPickerModal'
import { WeaponPickerModal } from '@/modules/calculator/components/workspace/panes/left/modals/WeaponPickerModal'
import {
  SonataSetConditionalsModal
} from '@/modules/calculator/components/workspace/panes/left/modals/SonataSetConditionalsModal'
import {ResonatorPickerModal} from '@/modules/calculator/components/resonator/modals/ResonatorPickerModal'
import {CharacterOptionsPanel} from '@/modules/calculator/components/optimizer/ResonatorOptionsPanel.tsx'
import { OptimizerTeamPanel } from '@/modules/calculator/components/optimizer/OptimizerTeamPanel'
import {
  buildTeammateControls,
  compactTeamMemberRuntime,
} from '@/modules/calculator/components/optimizer/teamRuntime'
import {OptimizerControlBox} from '@/modules/calculator/components/optimizer/OptimizerControlBox'
import {
  type OptimizerDisplayRow,
  type OptimizerDisplaySetEntry,
  OptimizerRow
} from '@/modules/calculator/components/optimizer/OptimizerRow'
import {OptimizerRules} from '@/modules/calculator/components/optimizer/OptimizerRules'
import {HEADER_TITLES} from '@/modules/calculator/components/optimizer/mockData'
import {formatStatKeyLabel, formatStatKeyValue} from '@/modules/calculator/model/overviewStats'
import { toTitle } from '@/shared/lib/format'
import { OPTIMIZER_SKILL_TAB_ORDER, getSkillTabLabel } from '@/modules/calculator/model/skillTabs'
import {modalContent} from '@/modules/calculator/components/optimizer/OptimizerModals'
import {RESONATOR_MENU} from '@/modules/calculator/model/resonator'
import { getWeapon, resolveWeaponStatsAtLevel } from '@/modules/calculator/model/weapon'
import {
  type TeammateEchoPlan,
  addTeammateSetPreference as addTeammateEchoPlanSetPreference,
  deriveTeammateEchoPlan,
  removeTeammateSetPreference as removeTeammateEchoPlanSetPreference,
  resolveTeammateEchoPlan,
  selectTeammateMainEcho,
  setTeammateSetPreferenceCount as setTeammateEchoPlanSetPreferenceCount,
} from '@/modules/calculator/components/optimizer/teammateEchoPlan'

function createEmptyProgress(): OptimizerProgress {
  return {
    progress: 0,
    elapsedMs: 0,
    remainingMs: Infinity,
    processed: 0,
    speed: 0,
  }
}

const MODAL_EXIT_MS = 320

function mapMainStatFilterToEchoKey(filterKey: string, selectedBonus: string | null): string | null {
  if (filterKey === 'atk%') return 'atkPercent'
  if (filterKey === 'hp%') return 'hpPercent'
  if (filterKey === 'def%') return 'defPercent'
  if (filterKey === 'er') return 'energyRegen'
  if (filterKey === 'cr') return 'critRate'
  if (filterKey === 'cd') return 'critDmg'
  if (filterKey === 'healing') return 'healingBonus'
  if (filterKey === 'bonus') return selectedBonus
  return null
}

function summarizeEchoLoadout(echoes: Array<EchoInstance | null>): Pick<OptimizerDisplayRow, 'cost' | 'sets' | 'mainEchoIcon'> {
  const setCounts = new Map<number, number>()
  let cost = 0

  for (const echo of echoes) {
    if (!echo) {
      continue
    }

    setCounts.set(echo.set, (setCounts.get(echo.set) ?? 0) + 1)
    cost += getEchoById(echo.id)?.cost ?? 0
  }

  const sets: OptimizerDisplaySetEntry[] = Array.from(setCounts.entries())
    .flatMap(([id, count]) => {
      const setDef = getEchoSetDef(id)
      if (!setDef) {
        return []
      }

      const compositionCount =
        setDef.setMax === 3
          ? count >= 3 ? 3 : null
          : count >= 5
            ? 5
            : count >= 2
              ? 2
              : null

      if (compositionCount == null) {
        return []
      }

      return [{
        id,
        count: compositionCount,
        icon: getSonataSetIcon(id),
      }]
    })
    .sort((left, right) => right.count - left.count || left.id - right.id)

  return {
    cost,
    sets,
    mainEchoIcon: echoes[0] ? getEchoById(echoes[0].id)?.icon ?? null : null,
  }
}

type PreviewTarget =
  | { kind: 'base' }
  | { kind: 'result'; index: number }

type OptimizerPickerSlot = 'active' | 0 | 1
type OptimizerMainEchoPickerTarget = 'filter' | 0 | 1

const RUNTIME_CONTROL_PREFIX = 'runtime.state.controls.'

function makeEmptyTeammateEchoPlans(): [TeammateEchoPlan | null, TeammateEchoPlan | null] {
  return [null, null]
}

function normalizeEchoLoadout(echoes: ReadonlyArray<EchoInstance | null | undefined>): Array<EchoInstance | null> {
  const out: Array<EchoInstance | null> = [null, null, null, null, null]
  for (let index = 0; index < out.length; index += 1) {
    out[index] = echoes[index] ?? null
  }
  return out
}

function materializeOptimizerSlotRuntime(
  runtime: ResonatorRuntimeState,
  slot: OptimizerPickerSlot,
): ResonatorRuntimeState | null {
  if (slot === 'active') {
    return runtime
  }

  const memberId = runtime.build.team[slot + 1]
  if (!memberId) {
    return null
  }

  const seed = seedResonatorsById[memberId] ?? null
  if (!seed) {
    return null
  }

  const compactRuntime = runtime.teamRuntimes[slot]
  const resolvedCompactRuntime = compactRuntime?.id === memberId
    ? compactRuntime
    : makeDefaultTeamMemberRuntime(seed)

  return materializeTeamMemberFromCompactRuntime(
    seed,
    resolvedCompactRuntime,
    runtime.state.controls,
    runtime.state.combat,
    runtime.build.team,
  )
}

function clearWeaponStateControls(
  controls: Record<string, boolean | number | string>,
  weaponId: string | null,
  prefix = '',
) {
  if (!weaponId || isUnsetWeaponId(weaponId)) {
    return
  }

  const targetPrefix = `${prefix}weapon:${weaponId}:`
  for (const key of Object.keys(controls)) {
    if (key.startsWith(targetPrefix)) {
      delete controls[key]
    }
  }
}

function applyWeaponStateDefaults(
  controls: Record<string, boolean | number | string>,
  weaponId: string,
  prefix = '',
) {
  for (const state of listStatesForSource('weapon', weaponId)) {
    if (state.defaultValue === undefined) {
      continue
    }

    const controlKey = state.path.startsWith(RUNTIME_CONTROL_PREFIX)
      ? state.path.slice(RUNTIME_CONTROL_PREFIX.length)
      : state.controlKey
    controls[`${prefix}${controlKey}`] = state.defaultValue
  }
}

function OptimizerPreviewEchoTile(props: {
  echo: EchoInstance | null
  index: number
}) {
  const { echo, index } = props
  const definition = echo ? getEchoById(echo.id) : null
  const slotLabel = index === 0 ? 'Main Echo' : `Echo ${index + 1}`
  const isMainSlot = index === 0

  if (!echo || !definition) {
    return (
      <article className="opt-echo-preview__slot opt-echo-preview__slot--empty">
        <div className="opt-echo-preview__slot-top">
          <span className="opt-echo-preview__slot-tag">{slotLabel}</span>
        </div>
        <div className="opt-echo-preview__empty-shell">
          <span className="opt-echo-preview__empty-mark">+</span>
          <span className="opt-echo-preview__empty">Empty Slot</span>
        </div>
      </article>
    )
  }

  const setIcon = getSonataSetIcon(echo.set)
  const cost = definition.cost ?? 0
  const substatEntries = Object.entries(echo.substats)

  return (
    <article className={`opt-echo-preview__slot${isMainSlot ? ' opt-echo-preview__slot--main' : ''}`}>
      <div className="opt-echo-preview__slot-top">
        <span className="opt-echo-preview__slot-tag">{slotLabel}</span>
        <span className="opt-echo-preview__cost-pill">{cost}C</span>
      </div>

      <div className="opt-echo-preview__slot-body">
        <div className="opt-echo-preview__glyph-frame">
          {definition.icon ? (
            <img
              src={definition.icon}
              alt={definition.name}
              className="opt-echo-preview__glyph"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="opt-echo-preview__glyph opt-echo-preview__glyph--empty" />
          )}
        </div>

        <div className="opt-echo-preview__summary">
          <strong className="opt-echo-preview__name">{definition.name ?? toTitle(echo.id)}</strong>
          <div className="opt-echo-preview__set-line">
            {setIcon ? (
              <img
                src={setIcon}
                alt={getSonataSetName(echo.set)}
                className="opt-echo-preview__set-icon"
                loading="lazy"
              />
            ) : null}
            <span className="opt-echo-preview__set-name">{getSonataSetName(echo.set)}</span>
          </div>
        </div>
      </div>

      <div className="opt-echo-preview__stats-table">
        <div className="opt-echo-preview__stats-row opt-echo-preview__stats-row--main">
          <span className="opt-echo-preview__stats-label">{formatStatKeyLabel(echo.mainStats.primary.key)}</span>
          <span className="opt-echo-preview__stats-value">{formatStatKeyValue(echo.mainStats.primary.key, echo.mainStats.primary.value)}</span>
        </div>
        <div className="opt-echo-preview__stats-row opt-echo-preview__stats-row--main">
          <span className="opt-echo-preview__stats-label">{formatStatKeyLabel(echo.mainStats.secondary.key)}</span>
          <span className="opt-echo-preview__stats-value">{formatStatKeyValue(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}</span>
        </div>
        {substatEntries.map(([key, value], subIndex) => (
          <div
            key={key}
            className={`opt-echo-preview__stats-row${subIndex === 0 ? ' opt-echo-preview__stats-row--substart' : ''}`}
          >
            <span className="opt-echo-preview__stats-label">{formatStatKeyLabel(key)}</span>
            <span className="opt-echo-preview__stats-value">{formatStatKeyValue(key, value)}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

function buildPlaceholderResult(): OptimizerDisplayRow {
  return {
    damage: 0,
    stats: {
      atk: 0,
      hp: 0,
      def: 0,
      er: 0,
      cr: 0,
      cd: 0,
      bonus: 0,
      amp: 0,
    },
    cost: null,
    sets: [],
    mainEchoIcon: null,
  }
}

interface LegacyOptimizerResultEntry {
  damage: number
  uids: string[]
  stats: OptimizerDisplayRow['stats']
}

function hasLegacyOptimizerResultEntry(entry: unknown): entry is LegacyOptimizerResultEntry {
  if (!entry || typeof entry !== 'object') {
    return false
  }

  return Array.isArray((entry as { uids?: unknown }).uids)
}

export function CalculatorOptimizerStage() {
  const activeResonatorId = useAppStore(selectActiveResonatorId)
  const activeTargetSelections = useAppStore(selectActiveTargetSelections)
  const enemyProfile = useAppStore(selectEnemyProfile)
  const optimizerContext = useAppStore(selectOptimizerContext)
  const optimizerStatus = useAppStore((state) => state.optimizer.status)
  const optimizerResults = useAppStore((state) => (
    Array.isArray(state.optimizer.results)
      ? state.optimizer.results
      : []
  ) as Array<OptimizerBagResultRef | LegacyOptimizerResultEntry>)
  const optimizerError = useAppStore((state) => state.optimizer.error)
  const optimizerBatchSize = useAppStore((state) => state.optimizer.batchSize)
  const optimizerResolutionPayload = useAppStore((state) => state.optimizer.resolutionPayload)
  const optimizerResultEchoes = useAppStore((state) => (
    Array.isArray(state.optimizer.resultEchoes)
      ? state.optimizer.resultEchoes
      : []
  ))
  const inventoryEchoEntries = useAppStore((state) => state.calculator.inventoryEchoes)
  const inventoryRotations = useAppStore((state) => state.calculator.inventoryRotations)
  const optimizerCpuHintSeen = useAppStore((state) => state.ui.optimizerCpuHintSeen)
  const ensureOptimizerContext = useAppStore((state) => state.ensureOptimizerContext)
  const syncOptimizerContextToLiveRuntime = useAppStore((state) => state.syncOptimizerContextToLiveRuntime)
  const setOptimizerCpuHintSeen = useAppStore((state) => state.setOptimizerCpuHintSeen)
  const updateOptimizerRuntime = useAppStore((state) => state.updateOptimizerRuntime)
  const updateResonatorRuntime = useAppStore((state) => state.updateResonatorRuntime)
  const updateOptimizerSettings = useAppStore((state) => state.updateOptimizerSettings)
  const updateResonatorSetConditionals = useAppStore((state) => state.updateResonatorSetConditionals)
  const switchToResonator = useAppStore((state) => state.switchToResonator)
  const startOptimizer = useAppStore((state) => state.startOptimizer)
  const cancelOptimizer = useAppStore((state) => state.cancelOptimizer)
  const clearOptimizerResults = useAppStore((state) => state.clearOptimizerResults)
  const optimizerResonatorId = optimizerContext?.resonatorId ?? activeResonatorId

  useEffect(() => {
    ensureOptimizerContext()
  }, [activeResonatorId, ensureOptimizerContext])

  const optimizerRuntime = optimizerContext?.runtime ?? null
  const optimizerSettings = optimizerContext?.settings ?? null
  const optimizerSetConditionals = useAppStore((state) => {
    const resonatorId = optimizerContext?.resonatorId ?? activeResonatorId
    if (!resonatorId) {
      return DEFAULT_SONATA_SET_CONDITIONALS
    }

    return state.calculator.profiles[resonatorId]?.runtime.local.setConditionals ?? DEFAULT_SONATA_SET_CONDITIONALS
  })
  const activeSeed = optimizerResonatorId ? seedResonatorsById[optimizerResonatorId] ?? null : null
  const displayName = activeSeed?.name ?? 'Unknown'
  const rotationMode = optimizerSettings?.rotationMode ?? false
  const targetMode: 'skill' | 'combo' = rotationMode ? 'combo' : 'skill'

  const [isSprite, setIsSprite] = useState(true)
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1600 : true,
  )
  const [pageIndex, setPageIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>({ kind: 'base' })
  const [rulesVisible, setRulesVisible] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [rulesClosing, setRulesClosing] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalClosing, setModalClosing] = useState(false)
  const [uiModalContent, setUiModalContent] = useState<ReactNode>(null)
  const [mainEchoPickerVisible, setMainEchoPickerVisible] = useState(false)
  const [mainEchoPickerOpen, setMainEchoPickerOpen] = useState(false)
  const [mainEchoPickerClosing, setMainEchoPickerClosing] = useState(false)
  const [mainEchoPickerTarget, setMainEchoPickerTarget] = useState<OptimizerMainEchoPickerTarget>('filter')
  const [teammateEchoPlanStore, setTeammateEchoPlanStore] = useState<{
    resonatorId: string | null
    plans: [TeammateEchoPlan | null, TeammateEchoPlan | null]
  }>(() => ({
    resonatorId: null,
    plans: makeEmptyTeammateEchoPlans(),
  }))
  const [progress, setProgress] = useState<OptimizerProgress>(() => createEmptyProgress())
  const setConditionalsModal = useAnimatedVisibility(MODAL_EXIT_MS)
  const equipChoiceModal = useAnimatedModalValue<number>()
  const resonatorPicker = useAnimatedModalValue<OptimizerPickerSlot>(180)
  const weaponPicker = useAnimatedModalValue<OptimizerPickerSlot>(180)

  const modalRef = useRef<HTMLDivElement>(null)
  const modalOpenFrameRef = useRef<number | null>(null)
  const modalCloseTimerRef = useRef<number | null>(null)
  const rulesOpenFrameRef = useRef<number | null>(null)
  const rulesCloseTimerRef = useRef<number | null>(null)
  const mainEchoPickerCloseTimerRef = useRef<number | null>(null)
  const [modalPortalTarget, setModalPortalTarget] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    function handleResize() {
      setIsWide(window.innerWidth >= 1600)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    setModalPortalTarget(modalRef.current)
  }, [])

  const teammateEchoPlans = useMemo(
    () => (
      teammateEchoPlanStore.resonatorId === optimizerResonatorId
        ? teammateEchoPlanStore.plans
        : makeEmptyTeammateEchoPlans()
    ),
    [optimizerResonatorId, teammateEchoPlanStore],
  )

  const setTeammateEchoPlans = useCallback((
    action:
      | [TeammateEchoPlan | null, TeammateEchoPlan | null]
      | ((
        prev: [TeammateEchoPlan | null, TeammateEchoPlan | null]
      ) => [TeammateEchoPlan | null, TeammateEchoPlan | null]),
  ) => {
    setTeammateEchoPlanStore((prevStore) => {
      const previousPlans = prevStore.resonatorId === optimizerResonatorId
        ? prevStore.plans
        : makeEmptyTeammateEchoPlans()
      const nextPlans = typeof action === 'function'
        ? action(previousPlans)
        : action

      return {
        resonatorId: optimizerResonatorId,
        plans: nextPlans,
      }
    })
  }, [optimizerResonatorId])

  const teammateEchoPlanState = useMemo(() => {
    if (!optimizerRuntime) {
      return {
        runtime: null,
        plans: [null, null] as [TeammateEchoPlan | null, TeammateEchoPlan | null],
        invalidMainEchoes: [null, null] as [string | null, string | null],
      }
    }

    const resolvedPlans = [...teammateEchoPlans] as [TeammateEchoPlan | null, TeammateEchoPlan | null]
    const invalidMainEchoes: [string | null, string | null] = [null, null]
    const nextTeamRuntimes = [...optimizerRuntime.teamRuntimes] as [TeamMemberRuntime | null, TeamMemberRuntime | null]
    let changed = false

    for (const slotIndex of [0, 1] as const) {
      const memberRuntime = materializeOptimizerSlotRuntime(optimizerRuntime, slotIndex)
      if (!memberRuntime) {
        continue
      }

      const resolvedPlan = resolveTeammateEchoPlan(
        memberRuntime.build.echoes,
        teammateEchoPlans[slotIndex],
      )
      resolvedPlans[slotIndex] = resolvedPlan.plan
      invalidMainEchoes[slotIndex] = resolvedPlan.invalidMainEchoId

      if (resolvedPlan.effectiveEchoes.every((echo, echoIndex) => echo === memberRuntime.build.echoes[echoIndex])) {
        continue
      }

      nextTeamRuntimes[slotIndex] = compactTeamMemberRuntime({
        ...memberRuntime,
        build: {
          ...memberRuntime.build,
          echoes: resolvedPlan.effectiveEchoes,
        },
      })
      changed = true
    }

    return {
      runtime: changed
        ? {
            ...optimizerRuntime,
            teamRuntimes: nextTeamRuntimes,
          }
        : optimizerRuntime,
      plans: resolvedPlans,
      invalidMainEchoes,
    }
  }, [optimizerRuntime, teammateEchoPlans])

  const effectiveOptimizerRuntime = teammateEchoPlanState.runtime
  const resolvedTeammateEchoPlans = teammateEchoPlanState.plans
  const invalidTeammateMainEchoIds = teammateEchoPlanState.invalidMainEchoes

  const resetOptimizerPresentation = () => {
    clearOptimizerResults()
    setPageIndex(0)
    setSelectedIndex(0)
    setPreviewTarget({ kind: 'base' })
    setProgress(createEmptyProgress())
  }

  const openUiModal = (content: ReactNode) => {
    if (modalOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(modalOpenFrameRef.current)
      modalOpenFrameRef.current = null
    }
    if (modalCloseTimerRef.current !== null) {
      window.clearTimeout(modalCloseTimerRef.current)
      modalCloseTimerRef.current = null
    }

    setUiModalContent(content)
    setModalVisible(true)
    setModalClosing(false)
    setModalOpen(false)
    modalOpenFrameRef.current = window.requestAnimationFrame(() => {
      setModalOpen(true)
      modalOpenFrameRef.current = null
    })
  }

  const closeUiModal = () => {
    if (!modalVisible) {
      return
    }
    if (modalOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(modalOpenFrameRef.current)
      modalOpenFrameRef.current = null
    }
    if (modalCloseTimerRef.current !== null) {
      window.clearTimeout(modalCloseTimerRef.current)
    }

    setModalOpen(false)
    setModalClosing(true)
    modalCloseTimerRef.current = window.setTimeout(() => {
      setModalVisible(false)
      setModalClosing(false)
      setUiModalContent(null)
      modalCloseTimerRef.current = null
    }, MODAL_EXIT_MS)
  }

  const openRulesModal = () => {
    if (rulesOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(rulesOpenFrameRef.current)
      rulesOpenFrameRef.current = null
    }
    if (rulesCloseTimerRef.current !== null) {
      window.clearTimeout(rulesCloseTimerRef.current)
      rulesCloseTimerRef.current = null
    }

    setRulesVisible(true)
    setRulesClosing(false)
    setRulesOpen(false)
    rulesOpenFrameRef.current = window.requestAnimationFrame(() => {
      setRulesOpen(true)
      rulesOpenFrameRef.current = null
    })
  }

  const closeRulesModal = () => {
    if (!rulesVisible) {
      return
    }
    if (rulesOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(rulesOpenFrameRef.current)
      rulesOpenFrameRef.current = null
    }
    if (rulesCloseTimerRef.current !== null) {
      window.clearTimeout(rulesCloseTimerRef.current)
    }

    setRulesOpen(false)
    setRulesClosing(true)
    rulesCloseTimerRef.current = window.setTimeout(() => {
      setRulesVisible(false)
      setRulesClosing(false)
      rulesCloseTimerRef.current = null
    }, MODAL_EXIT_MS)
  }

  const imageSrc =
    activeSeed
      ? isSprite
        ? `/assets/resonators/sprite/${optimizerResonatorId}.webp`
        : `/assets/resonators/profiles/${optimizerResonatorId}.webp`
      : '/assets/default-icon.webp'

  const targetableSkills = useMemo(
    () => (effectiveOptimizerRuntime ? listOptimizerTargets(effectiveOptimizerRuntime) : []),
    [effectiveOptimizerRuntime],
  )

  const skillOptions = useMemo<LiquidSelectOption<string>[]>(() => {
    return targetableSkills.map((skill) => ({
      value: skill.id,
      label: skill.label,
    }))
  }, [targetableSkills])

  const skillGroups = useMemo<LiquidSelectOptionGroup<string>[]>(() => {
    const grouped = new Map<string, LiquidSelectOption<string>[]>()

    for (const skill of targetableSkills) {
      const existing = grouped.get(skill.tab) ?? []
      existing.push({
        value: skill.id,
        label: skill.label,
      })
      grouped.set(skill.tab, existing)
    }

    return OPTIMIZER_SKILL_TAB_ORDER
      .map((tab) => ({
        label: getSkillTabLabel(tab),
        options: grouped.get(tab) ?? [],
      }))
      .filter((group) => group.options.length > 0)
  }, [targetableSkills])

  const comboOptions: LiquidSelectOption<string>[] = (() => {
    if (!effectiveOptimizerRuntime || !optimizerResonatorId) {
      return []
    }

    const options: LiquidSelectOption<string>[] = [{
      value: `live:${optimizerResonatorId}`,
      label: `${displayName} · Current Personal Rotation · Live`,
    }]

    for (const entry of inventoryRotations) {
      if (entry.mode !== 'personal' || entry.resonatorId !== optimizerResonatorId) {
        continue
      }

      options.push({
        value: `saved:${entry.id}`,
        label: `${entry.resonatorName} · ${entry.name} · Personal`,
      })
    }

    return options
  })()

  const selectedRotationItems: RotationNode[] | null = (() => {
    if (!effectiveOptimizerRuntime || !optimizerResonatorId) {
      return null
    }

    const selectedSourceId = optimizerSettings?.targetComboSourceId
    if (!selectedSourceId) {
      return effectiveOptimizerRuntime.rotation.personalItems
    }

    if (selectedSourceId === `live:${optimizerResonatorId}`) {
      return effectiveOptimizerRuntime.rotation.personalItems
    }

    if (selectedSourceId.startsWith('saved:')) {
      const rotationId = selectedSourceId.slice('saved:'.length)
      const saved = inventoryRotations.find((entry) => (
        entry.id === rotationId &&
        entry.mode === 'personal' &&
        entry.resonatorId === optimizerResonatorId
      ))
      return saved?.items ?? null
    }

    return effectiveOptimizerRuntime.rotation.personalItems
  })()

  useEffect(() => {
    if (!optimizerSettings) {
      return
    }

    const hasSelectedSkill = optimizerSettings.targetSkillId
      ? targetableSkills.some((skill) => skill.id === optimizerSettings.targetSkillId)
      : false

    if (hasSelectedSkill) {
      return
    }

    const nextTargetSkillId = targetableSkills[0]?.id ?? null
    if (optimizerSettings.targetSkillId === nextTargetSkillId) {
      return
    }

    updateOptimizerSettings((settings) => ({
      ...settings,
      targetSkillId: nextTargetSkillId,
    }))
  }, [optimizerSettings, targetableSkills, updateOptimizerSettings])

  useEffect(() => {
    if (!optimizerSettings || comboOptions.length === 0) {
      return
    }

    const hasSelectedCombo = optimizerSettings.targetComboSourceId
      ? comboOptions.some((option) => option.value === optimizerSettings.targetComboSourceId)
      : false

    if (hasSelectedCombo) {
      return
    }

    const nextTargetComboId = comboOptions[0]?.value ?? null
    if (optimizerSettings.targetComboSourceId === nextTargetComboId) {
      return
    }

    updateOptimizerSettings((settings) => ({
      ...settings,
      targetComboSourceId: nextTargetComboId,
    }))
  }, [comboOptions, optimizerSettings, updateOptimizerSettings])

  const filteredRuleEchoEntries = useMemo(() => {
    if (!optimizerSettings) {
      return inventoryEchoEntries
    }

    const allowedSetIds = new Set([
      ...optimizerSettings.allowedSets[3],
      ...optimizerSettings.allowedSets[5],
    ])
    const allowedMainStatKeys = new Set(
      optimizerSettings.mainStatFilter
        .map((key) => mapMainStatFilterToEchoKey(key, optimizerSettings.selectedBonus))
        .filter((value): value is string => Boolean(value)),
    )

    return inventoryEchoEntries.filter(({ echo }) => {
      if (allowedSetIds.size > 0 && !allowedSetIds.has(echo.set)) {
        return false
      }
      return !(allowedMainStatKeys.size > 0 && !allowedMainStatKeys.has(echo.mainStats.primary.key));
    })
  }, [inventoryEchoEntries, optimizerSettings])

  const allEchoes = useMemo(() => listEchoes(), [])

  const preparedTargetSkill = useMemo(() => {
    const resonatorId = optimizerResonatorId
    const targetSkillId = optimizerSettings?.targetSkillId
    if (
      !resonatorId ||
      !effectiveOptimizerRuntime ||
      !targetSkillId ||
      rotationMode
    ) {
      return null
    }

    return compileOptimizerTargetContext({
      runtime: effectiveOptimizerRuntime,
      resonatorId,
      skillId: targetSkillId,
      enemy: enemyProfile,
      runtimesById: buildRuntimeParticipantLookup(effectiveOptimizerRuntime),
      selectedTargetsByOwnerKey: activeTargetSelections,
    })
  }, [activeTargetSelections, effectiveOptimizerRuntime, enemyProfile, optimizerResonatorId, optimizerSettings, rotationMode])

  const optimizerWeightMap = useMemo(() => {
    if (
      !effectiveOptimizerRuntime ||
      !optimizerSettings ||
      rotationMode ||
      !preparedTargetSkill
    ) {
      return null
    }

    return buildOptimizerStatWeightMap({
      finalStats: preparedTargetSkill.combat.finalStats,
      skill: preparedTargetSkill.skill,
      enemy: enemyProfile,
      level: effectiveOptimizerRuntime.base.level,
      combat: effectiveOptimizerRuntime.state.combat,
    })
  }, [effectiveOptimizerRuntime, enemyProfile, optimizerSettings, preparedTargetSkill, rotationMode])

  const filteredInventoryEchoEntries = useMemo(() => {
    if (!optimizerSettings) {
      return filteredRuleEchoEntries
    }

    const filteredEchoes = applyKeepPercentFilter(
      filteredRuleEchoEntries.map((entry) => entry.echo),
      {
        keepPercent: optimizerSettings.keepPercent,
        rotationMode: optimizerSettings.rotationMode,
        lockedMainEchoId: optimizerSettings.lockedMainEchoId,
        weights: optimizerWeightMap,
      },
    )

    const entriesByUid = new Map(
      filteredRuleEchoEntries.map((entry) => [entry.echo.uid, entry] as const),
    )

    return filteredEchoes
      .map((echo) => entriesByUid.get(echo.uid) ?? null)
      .filter((entry): entry is (typeof filteredRuleEchoEntries)[number] => Boolean(entry))
  }, [filteredRuleEchoEntries, optimizerSettings, optimizerWeightMap])

  const filteredCombinationEchoes = useMemo(
    () => filteredInventoryEchoEntries.map((entry) => entry.echo),
    [filteredInventoryEchoEntries],
  )

  const shouldCountCombinations = filteredCombinationEchoes.length >= 5
  const pendingCombinations = false
  const resolvedCombinationCount = useMemo(() => {
    if (!shouldCountCombinations) {
      return 0
    }

    return countOptimizerCombinationsByMode(
      filteredCombinationEchoes,
      optimizerSettings?.lockedMainEchoId ?? null,
      optimizerSettings?.enableGpu ? 'combinadic' : 'rows',
    )
  }, [
    filteredCombinationEchoes,
    optimizerSettings?.enableGpu,
    optimizerSettings?.lockedMainEchoId,
    shouldCountCombinations,
  ])

  const equippedEchoes = normalizeEchoLoadout(effectiveOptimizerRuntime?.build.echoes ?? []).filter(
    (echo): echo is EchoInstance => echo != null,
  )

  const baselinePreparedPayload = useMemo(() => {
    if (
      !optimizerResonatorId ||
      !effectiveOptimizerRuntime ||
      !optimizerSettings ||
      (!rotationMode && !optimizerSettings.targetSkillId) ||
      equippedEchoes.length === 0
    ) {
      return null
    }

    return compileOptimizerPayload({
      resonatorId: optimizerResonatorId,
      resonatorSeed: seedResonatorsById[optimizerResonatorId],
      staticData: {
        gameDataRegistry: getGameData(),
        resonatorCatalogById: getResonatorCatalogById(),
        resonatorDetailsById: getResonatorDetailsById(),
        weaponsById: getWeaponsById(),
        echoCatalogById: getEchoCatalogById(),
        echoSetDefs: ECHO_SET_DEFS,
      },
      runtime: effectiveOptimizerRuntime,
      settings: optimizerSettings,
      inventoryEchoes: equippedEchoes,
      enemyProfile,
      selectedTargetsByOwnerKey: activeTargetSelections,
      setConditionals: optimizerSetConditionals,
      rotationItems: rotationMode ? selectedRotationItems : undefined,
    })
  }, [
    activeTargetSelections,
    enemyProfile,
    equippedEchoes,
    optimizerResonatorId,
    effectiveOptimizerRuntime,
    optimizerSetConditionals,
    optimizerSettings,
    rotationMode,
    selectedRotationItems,
  ])

  const baselineEvaluation = useMemo(() => {
    if (!baselinePreparedPayload || equippedEchoes.length === 0) {
      return null
    }

    const mainIndex = equippedEchoes.findIndex((echo) => echo.mainEcho)
    return evaluatePreparedOptimizerBaseline(
      baselinePreparedPayload,
      mainIndex >= 0 ? mainIndex : 0,
    )
  }, [baselinePreparedPayload, equippedEchoes])

  const baseResult: OptimizerDisplayRow = (() => {
    if (!effectiveOptimizerRuntime) {
      return buildPlaceholderResult()
    }

    const summary = summarizeEchoLoadout(effectiveOptimizerRuntime.build.echoes)

    return {
      damage: baselineEvaluation?.damage ?? 0,
      cost: summary.cost,
      sets: summary.sets,
      mainEchoIcon: summary.mainEchoIcon,
      stats: baselineEvaluation?.stats ?? null,
    }
  })()

  const inventoryEchoesByUid = useMemo(
    () => new Map(inventoryEchoEntries.map((entry) => [entry.echo.uid, entry.echo] as const)),
    [inventoryEchoEntries],
  )

  const resultsPerPage = 32
  const resultLength = optimizerResults.length
  const totalPages = Math.max(1, Math.ceil(resultLength / resultsPerPage))
  const pageStart = pageIndex * resultsPerPage
  const pageEnd = pageStart + resultsPerPage

  const visibleResults = useMemo<OptimizerDisplayRow[]>(() => {
    return optimizerResults.slice(pageStart, pageEnd).map((entry) => {
      if (hasLegacyOptimizerResultEntry(entry)) {
        const echoes = entry.uids.map((uid) => inventoryEchoesByUid.get(uid) ?? null)
        const summary = summarizeEchoLoadout(echoes)
        return {
          damage: entry.damage,
          cost: summary.cost,
          sets: summary.sets,
          mainEchoIcon: summary.mainEchoIcon,
          stats: entry.stats ?? null,
        }
      }

      const echoes = resolveOptimizerResultEchoes(optimizerResultEchoes, entry)
      const summary = summarizeEchoLoadout(echoes)
      return {
        damage: entry.damage,
        cost: summary.cost,
        sets: summary.sets,
        mainEchoIcon: summary.mainEchoIcon,
        stats: optimizerResolutionPayload
          ? evaluateOptimizerBagResultStats(optimizerResolutionPayload, entry)
          : null,
      }
    })
  }, [inventoryEchoesByUid, optimizerResults, optimizerResolutionPayload, optimizerResultEchoes, pageEnd, pageStart])
  const globalSelectedIndex = pageStart + selectedIndex
  const resolvedPreviewTarget = useMemo<PreviewTarget>(() => {
    if (previewTarget.kind === 'result' && !optimizerResults[previewTarget.index]) {
      return { kind: 'base' }
    }

    return previewTarget
  }, [optimizerResults, previewTarget])
  const activeResultIndex = resolvedPreviewTarget.kind === 'result'
    ? resolvedPreviewTarget.index
    : globalSelectedIndex
  const selectedPreviewIndex = (
    resolvedPreviewTarget.kind === 'result' &&
    resolvedPreviewTarget.index >= pageStart &&
    resolvedPreviewTarget.index < pageEnd
  )
    ? resolvedPreviewTarget.index - pageStart
    : null
  const previewEchoes = useMemo(() => {
    if (resolvedPreviewTarget.kind === 'base') {
      return normalizeEchoLoadout(effectiveOptimizerRuntime?.build.echoes ?? [])
    }

    const entry = optimizerResults[resolvedPreviewTarget.index]
    if (!entry) {
      return normalizeEchoLoadout(effectiveOptimizerRuntime?.build.echoes ?? [])
    }

    if (hasLegacyOptimizerResultEntry(entry)) {
      return normalizeEchoLoadout(entry.uids.map((uid) => inventoryEchoesByUid.get(uid) ?? null))
    }

    return normalizeEchoLoadout(resolveOptimizerResultEchoes(optimizerResultEchoes, entry))
  }, [
    inventoryEchoesByUid,
    optimizerResultEchoes,
    optimizerResults,
    effectiveOptimizerRuntime?.build.echoes,
    resolvedPreviewTarget,
  ])

  const showBasePreview = () => {
    setPreviewTarget({ kind: 'base' })
  }

  function resolveOptimizerResultLoadout(index: number): Array<EchoInstance | null> {
    const entry = optimizerResults[index]
    if (!entry) {
      return normalizeEchoLoadout([])
    }

    if (hasLegacyOptimizerResultEntry(entry)) {
      return normalizeEchoLoadout(
        entry.uids
          .map((uid) => inventoryEchoesByUid.get(uid) ?? null)
          .map((echo, slotIndex) => (echo ? cloneEchoForSlot(echo, slotIndex) : null)),
      )
    }

    return normalizeEchoLoadout(
      resolveOptimizerResultEchoes(optimizerResultEchoes, entry)
        .map((echo, slotIndex) => echo ? cloneEchoForSlot(echo, slotIndex) : null),
    )
  }

  function applyOptimizerResultToSimulation(index: number) {
    const nextEchoes = resolveOptimizerResultLoadout(index)
    if (nextEchoes.every((echo) => echo == null)) {
      return
    }

    updateOptimizerRuntime((runtime) => ({
      ...runtime,
      build: {
        ...runtime.build,
        echoes: nextEchoes,
      },
    }))
  }

  function applyOptimizerResultToSimulationAndLive(index: number) {
    const nextEchoes = resolveOptimizerResultLoadout(index)
    if (nextEchoes.every((echo) => echo == null)) {
      return
    }

    applyOptimizerResultToSimulation(index)

    if (!optimizerResonatorId) {
      return
    }

    updateResonatorRuntime(optimizerResonatorId, (runtime) => ({
      ...runtime,
      build: {
        ...runtime.build,
        echoes: nextEchoes,
      },
    }))

    if (activeResonatorId !== optimizerResonatorId) {
      switchToResonator(optimizerResonatorId)
    }
  }

  const showResultPreview = (index: number) => {
    setSelectedIndex(index)
    setPreviewTarget({ kind: 'result', index: pageStart + index })
  }

  const visibleHeaderTitles = useMemo(() => {
    if (!rotationMode) {
      return HEADER_TITLES
    }

    return HEADER_TITLES.filter((title) => title !== 'Ʃ BNS%' && title !== 'Ʃ AMP%')
  }, [rotationMode])

  const pageItems = useMemo(() => {
    const items: Array<number | string> = []
    if (totalPages <= 10) {
      for (let i = 0; i < totalPages; i += 1) {
        items.push(i)
      }
      return items
    }
    if (pageIndex < 7) {
      for (let i = 0; i < 7; i += 1) {
        items.push(i)
      }
      items.push('...')
      items.push(totalPages - 1)
      return items
    }
    if (pageIndex > totalPages - 8) {
      items.push(0)
      items.push('...')
      for (let i = totalPages - 7; i < totalPages; i += 1) {
        items.push(i)
      }
      return items
    }
    items.push(0)
    items.push('...')
    for (let i = pageIndex - 2; i <= pageIndex + 2; i += 1) {
      items.push(i)
    }
    items.push('...')
    items.push(totalPages - 1)
    return items
  }, [pageIndex, totalPages])

  const selectedMainEchoFilter = useMemo(() => {
    const echoId = optimizerSettings?.lockedMainEchoId
    if (!echoId) {
      return null
    }

    const echo = getEchoById(echoId)
    if (!echo) {
      return null
    }

    return {
      id: echo.id,
      name: echo.name,
      icon: echo.icon,
    }
  }, [optimizerSettings?.lockedMainEchoId])

  const selectedResonatorPickerSlot = resonatorPicker.value
  const selectedWeaponPickerSlot = weaponPicker.value

  const eligibleOptimizerTeamResonators = useMemo(() => {
    if (!optimizerRuntime || selectedResonatorPickerSlot === null || selectedResonatorPickerSlot === 'active') {
      return RESONATOR_MENU
    }

    const occupiedIds = new Set(
      optimizerRuntime.build.team.filter(
        (memberId, memberIndex): memberId is string =>
          Boolean(memberId) && memberIndex !== selectedResonatorPickerSlot + 1,
      ),
    )

    return RESONATOR_MENU.filter((entry) => !occupiedIds.has(entry.id))
  }, [optimizerRuntime, selectedResonatorPickerSlot])

  const selectedWeaponPickerRuntime = useMemo(
    () => (
      optimizerRuntime && selectedWeaponPickerSlot !== null
        ? materializeOptimizerSlotRuntime(optimizerRuntime, selectedWeaponPickerSlot)
        : null
    ),
    [optimizerRuntime, selectedWeaponPickerSlot],
  )

  const selectedWeaponPickerWeapons = useMemo(() => {
    if (!selectedWeaponPickerRuntime) {
      return []
    }

    const seed = seedResonatorsById[selectedWeaponPickerRuntime.id] ?? null
    if (!seed) {
      return []
    }

    return listWeaponsByType(seed.weaponType)
  }, [selectedWeaponPickerRuntime])

  const applyOptimizerWeaponSelection = useCallback((slot: OptimizerPickerSlot, weaponId: string) => {
    const selectedWeapon = getWeapon(weaponId)
    if (!selectedWeapon) {
      return
    }

    updateOptimizerRuntime((prev) => {
      if (slot === 'active') {
        const nextControls = { ...prev.state.controls }
        clearWeaponStateControls(nextControls, prev.build.weapon.id)
        applyWeaponStateDefaults(nextControls, selectedWeapon.id)
        const stats = resolveWeaponStatsAtLevel(selectedWeapon, prev.build.weapon.level)

        return {
          ...prev,
          build: {
            ...prev.build,
            weapon: {
              ...prev.build.weapon,
              id: selectedWeapon.id,
              baseAtk: stats.atk,
              rank: 1,
            },
          },
          state: {
            ...prev.state,
            controls: nextControls,
          },
        }
      }

      const memberId = prev.build.team[slot + 1]
      if (!memberId) {
        return prev
      }

      const seed = seedResonatorsById[memberId] ?? null
      if (!seed) {
        return prev
      }

      const existingCompactRuntime = prev.teamRuntimes[slot]
      const resolvedCompactRuntime = existingCompactRuntime?.id === memberId
        ? existingCompactRuntime
        : makeDefaultTeamMemberRuntime(seed)
      const currentRuntime = materializeTeamMemberFromCompactRuntime(
        seed,
        resolvedCompactRuntime,
        prev.state.controls,
        prev.state.combat,
        prev.build.team,
      )
      const nextControls = { ...currentRuntime.state.controls }
      clearWeaponStateControls(nextControls, currentRuntime.build.weapon.id)
      applyWeaponStateDefaults(nextControls, selectedWeapon.id)
      const stats = resolveWeaponStatsAtLevel(selectedWeapon, currentRuntime.build.weapon.level)
      const nextRuntime: ResonatorRuntimeState = {
        ...currentRuntime,
        build: {
          ...currentRuntime.build,
          weapon: {
            ...currentRuntime.build.weapon,
            id: selectedWeapon.id,
            baseAtk: stats.atk,
            rank: 1,
          },
        },
        state: {
          ...currentRuntime.state,
          controls: nextControls,
        },
      }
      const nextTeamRuntimes = [...prev.teamRuntimes] as [TeamMemberRuntime | null, TeamMemberRuntime | null]
      nextTeamRuntimes[slot] = compactTeamMemberRuntime(nextRuntime)

      return {
        ...prev,
        state: {
          ...prev.state,
          controls: buildTeammateControls(prev.state.controls, [memberId], memberId, nextRuntime),
        },
        teamRuntimes: nextTeamRuntimes,
      }
    })
  }, [updateOptimizerRuntime])

  const applyOptimizerTeammateSelection = useCallback((slotIndex: 0 | 1, resonatorId: string) => {
    updateOptimizerRuntime((prev) => {
      const nextSeed = seedResonatorsById[resonatorId] ?? null
      if (!nextSeed) {
        return prev
      }

      const currentMemberId = prev.build.team[slotIndex + 1]
      const nextTeam = [...prev.build.team] as typeof prev.build.team
      nextTeam[slotIndex + 1] = resonatorId

      const nextRuntime = materializeTeamMemberFromCompactRuntime(
        nextSeed,
        makeDefaultTeamMemberRuntime(nextSeed),
        prev.state.controls,
        prev.state.combat,
        nextTeam,
      )
      const existingCompactRuntime = prev.teamRuntimes[slotIndex]
      const memberIdsToClear = Array.from(
        new Set([existingCompactRuntime?.id, currentMemberId].filter((value): value is string => Boolean(value))),
      )
      const nextTeamRuntimes = [...prev.teamRuntimes] as [TeamMemberRuntime | null, TeamMemberRuntime | null]
      nextTeamRuntimes[slotIndex] = compactTeamMemberRuntime(nextRuntime)

      return {
        ...prev,
        build: {
          ...prev.build,
          team: nextTeam,
        },
        state: {
          ...prev.state,
          controls: buildTeammateControls(prev.state.controls, memberIdsToClear, resonatorId, nextRuntime),
        },
        teamRuntimes: nextTeamRuntimes,
      }
    })

    setTeammateEchoPlans((prev) => {
      const next = [...prev] as [TeammateEchoPlan | null, TeammateEchoPlan | null]
      next[slotIndex] = null
      return next
    })
  }, [setTeammateEchoPlans, updateOptimizerRuntime])

  const addTeammateSetPreference = useCallback((slotIndex: 0 | 1, setId: number) => {
    setTeammateEchoPlans((prev) => {
      const memberRuntime = optimizerRuntime ? materializeOptimizerSlotRuntime(optimizerRuntime, slotIndex) : null
      if (!memberRuntime) {
        return prev
      }

      const next = [...prev] as [TeammateEchoPlan | null, TeammateEchoPlan | null]
      next[slotIndex] = addTeammateEchoPlanSetPreference(
        prev[slotIndex] ?? deriveTeammateEchoPlan(memberRuntime.build.echoes),
        setId,
      )
      return next
    })
  }, [optimizerRuntime, setTeammateEchoPlans])

  const removeTeammateSetPreference = useCallback((slotIndex: 0 | 1, setId: number) => {
    setTeammateEchoPlans((prev) => {
      const memberRuntime = optimizerRuntime ? materializeOptimizerSlotRuntime(optimizerRuntime, slotIndex) : null
      if (!memberRuntime) {
        return prev
      }

      const next = [...prev] as [TeammateEchoPlan | null, TeammateEchoPlan | null]
      next[slotIndex] = removeTeammateEchoPlanSetPreference(
        prev[slotIndex] ?? deriveTeammateEchoPlan(memberRuntime.build.echoes),
        setId,
      )
      return next
    })
  }, [optimizerRuntime, setTeammateEchoPlans])

  const setTeammateSetPreferenceCount = useCallback((slotIndex: 0 | 1, setId: number, count: number) => {
    setTeammateEchoPlans((prev) => {
      const memberRuntime = optimizerRuntime ? materializeOptimizerSlotRuntime(optimizerRuntime, slotIndex) : null
      if (!memberRuntime) {
        return prev
      }

      const next = [...prev] as [TeammateEchoPlan | null, TeammateEchoPlan | null]
      next[slotIndex] = setTeammateEchoPlanSetPreferenceCount(
        prev[slotIndex] ?? deriveTeammateEchoPlan(memberRuntime.build.echoes),
        setId,
        count,
      )
      return next
    })
  }, [optimizerRuntime, setTeammateEchoPlans])

  const removeTeammate = useCallback((slotIndex: 0 | 1) => {
    updateOptimizerRuntime((prev) => {
      const currentMemberId = prev.build.team[slotIndex + 1]
      const nextTeam = [...prev.build.team] as typeof prev.build.team
      nextTeam[slotIndex + 1] = null
      const nextTeamRuntimes = [...prev.teamRuntimes] as [TeamMemberRuntime | null, TeamMemberRuntime | null]
      nextTeamRuntimes[slotIndex] = null
      const nextControls: Record<string, boolean | number | string> = {}
      for (const [key, value] of Object.entries(prev.state.controls)) {
        if (!currentMemberId || !key.startsWith(`team:${currentMemberId}:`)) {
          nextControls[key] = value
        }
      }
      return {
        ...prev,
        build: { ...prev.build, team: nextTeam },
        teamRuntimes: nextTeamRuntimes,
        state: { ...prev.state, controls: nextControls },
      }
    })
    setTeammateEchoPlans((prev) => {
      const next = [...prev] as [TeammateEchoPlan | null, TeammateEchoPlan | null]
      next[slotIndex] = null
      return next
    })
  }, [setTeammateEchoPlans, updateOptimizerRuntime])

  const removeTeammateMainEcho = useCallback((slotIndex: 0 | 1) => {
    setTeammateEchoPlans((prev) => {
      const memberRuntime = optimizerRuntime ? materializeOptimizerSlotRuntime(optimizerRuntime, slotIndex) : null
      if (!memberRuntime) {
        return prev
      }

      const next = [...prev] as [TeammateEchoPlan | null, TeammateEchoPlan | null]
      next[slotIndex] = selectTeammateMainEcho(
        prev[slotIndex] ?? deriveTeammateEchoPlan(memberRuntime.build.echoes),
        null,
      )
      return next
    })
  }, [optimizerRuntime, setTeammateEchoPlans])

  const openResonatorPicker = (slot: OptimizerPickerSlot = 'active') => {
    resonatorPicker.show(slot)
  }

  const closeResonatorPicker = () => {
    resonatorPicker.hide()
  }

  const openWeaponPicker = (slot: OptimizerPickerSlot) => {
    weaponPicker.show(slot)
  }

  const closeWeaponPicker = () => {
    weaponPicker.hide()
  }

  const openMainEchoPicker = (target: OptimizerMainEchoPickerTarget = 'filter') => {
    if (mainEchoPickerCloseTimerRef.current !== null) {
      window.clearTimeout(mainEchoPickerCloseTimerRef.current)
      mainEchoPickerCloseTimerRef.current = null
    }

    setMainEchoPickerTarget(target)
    setMainEchoPickerClosing(false)
    setMainEchoPickerVisible(true)
    window.requestAnimationFrame(() => setMainEchoPickerOpen(true))
  }

  const closeMainEchoPicker = () => {
    setMainEchoPickerOpen(false)
    setMainEchoPickerClosing(true)

    if (mainEchoPickerCloseTimerRef.current !== null) {
      window.clearTimeout(mainEchoPickerCloseTimerRef.current)
    }

    mainEchoPickerCloseTimerRef.current = window.setTimeout(() => {
      setMainEchoPickerVisible(false)
      setMainEchoPickerClosing(false)
      setMainEchoPickerTarget('filter')
      mainEchoPickerCloseTimerRef.current = null
    }, 180)
  }

  const selectedMainEchoId = mainEchoPickerTarget === 'filter'
    ? optimizerSettings?.lockedMainEchoId ?? null
    : resolvedTeammateEchoPlans[mainEchoPickerTarget]?.mainEchoId ?? null

  useEffect(() => {
    return () => {
      if (modalOpenFrameRef.current !== null) {
        window.cancelAnimationFrame(modalOpenFrameRef.current)
      }
      if (modalCloseTimerRef.current !== null) {
        window.clearTimeout(modalCloseTimerRef.current)
      }
      if (rulesOpenFrameRef.current !== null) {
        window.cancelAnimationFrame(rulesOpenFrameRef.current)
      }
      if (rulesCloseTimerRef.current !== null) {
        window.clearTimeout(rulesCloseTimerRef.current)
      }
      if (mainEchoPickerCloseTimerRef.current !== null) {
        window.clearTimeout(mainEchoPickerCloseTimerRef.current)
      }
    }
  }, [])

  const isLoading = optimizerStatus === 'running'
  const success = optimizerStatus === 'done'
  const cancelled = optimizerStatus === 'cancelled'

  function handleRunOptimizer() {
    if (!optimizerContext || !optimizerSettings || pendingCombinations) {
      return
    }

    if (!optimizerSettings.enableGpu && !optimizerCpuHintSeen) {
      setOptimizerCpuHintSeen(true)
      openUiModal(modalContent.firstTimeOptimizer)
      return
    }

    setPageIndex(0)
    setSelectedIndex(0)
    showBasePreview()
    setProgress(createEmptyProgress())
    startOptimizer({
      resonatorId: optimizerContext.resonatorId,
      resonatorSeed: seedResonatorsById[optimizerContext.resonatorId],
      staticData: {
        gameDataRegistry: getGameData(),
        resonatorCatalogById: getResonatorCatalogById(),
        resonatorDetailsById: getResonatorDetailsById(),
        weaponsById: getWeaponsById(),
        echoCatalogById: getEchoCatalogById(),
        echoSetDefs: ECHO_SET_DEFS,
      },
      runtime: optimizerContext.runtime,
      settings: optimizerContext.settings,
      inventoryEchoes: filteredInventoryEchoEntries.map((entry) => entry.echo),
      enemyProfile,
      selectedTargetsByOwnerKey: activeTargetSelections,
      setConditionals: optimizerSetConditionals,
      rotationItems: selectedRotationItems,
    }, {
      onProgress: (nextProgress) => {
        setProgress(nextProgress)
      },
    })
  }

  function handleReset() {
    resetOptimizerPresentation()
  }

  function handleSyncLive() {
    if (isLoading) {
      return
    }

    syncOptimizerContextToLiveRuntime(optimizerResonatorId ?? undefined)
    setTeammateEchoPlans([null, null])
    resetOptimizerPresentation()
  }

  function handleHalt() {
    cancelOptimizer()
  }

  function handleEquip() {
    if (isLoading || !optimizerResults[activeResultIndex]) {
      return
    }

    equipChoiceModal.show(activeResultIndex)
  }

  const controlProps = {
    isLoading,
    pendingCombinations,
    progress,
    success,
    cancelled,
    resultLength,
    filteredEchoCount: filteredInventoryEchoEntries.length,
    combinationsLabel: shouldCountCombinations
      ? (pendingCombinations ? 'calculating...' : resolvedCombinationCount.toLocaleString())
      : '0',
    batchSize: optimizerBatchSize,
    resultsLimit: optimizerSettings?.resultsLimit ?? 256,
    keepPercent: optimizerSettings?.keepPercent ?? 0.5,
    lowMemoryMode: optimizerSettings?.lowMemoryMode ?? false,
    onResultsLimitChange: (value: number) => {
      updateOptimizerSettings((settings) => ({
        ...settings,
        resultsLimit: value,
      }))
    },
    onKeepPercentChange: (value: number) => {
      updateOptimizerSettings((settings) => ({
        ...settings,
        keepPercent: value,
      }))
    },
    onLowMemoryModeChange: (value: boolean) => {
      updateOptimizerSettings((settings) => ({
        ...settings,
        lowMemoryMode: value,
      }))
    },
    onRunOptimizer: handleRunOptimizer,
    onReset: handleReset,
    onHalt: handleHalt,
    onEquip: handleEquip,
    onGuide: () => {},
    onRules: openRulesModal,
    onClear: () => {
      resetOptimizerPresentation()
    },
  }

  return (
    <div className="calculator-stage" ref={modalRef}>
      <AppDialog
        visible={modalVisible}
        open={modalOpen}
        closing={modalClosing}
        portalTarget={modalPortalTarget}
        contentClassName="app-modal-panel optimizer-modal-panel"
        ariaLabel="Optimizer notice"
        onClose={closeUiModal}
      >
        {uiModalContent}
      </AppDialog>

      <AppDialog
        visible={rulesVisible}
        open={rulesOpen}
        closing={rulesClosing}
        portalTarget={modalPortalTarget}
        contentClassName="app-modal-panel optimizer-rules-panel"
        ariaLabel="Optimizer rules"
        onClose={closeRulesModal}
      >
        <OptimizerRules />
      </AppDialog>

      <AppDialog
        visible={equipChoiceModal.visible}
        open={equipChoiceModal.open}
        closing={equipChoiceModal.closing}
        portalTarget={modalPortalTarget}
        contentClassName="app-modal-panel confirmation-modal confirmation-modal--info"
        ariaLabel="Equip optimizer result"
        onClose={equipChoiceModal.hide}
      >
        <div className="confirmation-modal__body">
          <h2 className="confirmation-modal__title">
            Equip optimizer result
          </h2>
          <div className="confirmation-modal__message">
            Choose whether to apply this result to the optimizer sim only or to both sim and live.
          </div>
        </div>
        <div className="confirmation-modal__actions rotation-load-choice-actions">
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--cancel"
            onClick={equipChoiceModal.hide}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--confirm"
            onClick={() => {
              if (equipChoiceModal.value != null) {
                applyOptimizerResultToSimulation(equipChoiceModal.value)
              }
              equipChoiceModal.hide()
            }}
          >
            Sim
          </button>
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--confirm"
            onClick={() => {
              if (equipChoiceModal.value != null) {
                applyOptimizerResultToSimulationAndLive(equipChoiceModal.value)
              }
              equipChoiceModal.hide()
            }}
          >
            Sim & Live
          </button>
        </div>
      </AppDialog>

      <SonataSetConditionalsModal
        {...setConditionalsModal}
        portalTarget={modalPortalTarget}
        onClose={setConditionalsModal.hide}
        title="Sonata Set Config"
        setConditionals={optimizerSetConditionals}
        onSetConditionalsChange={(updater) => {
          if (!optimizerResonatorId) {
            return
          }

          updateResonatorSetConditionals(optimizerResonatorId, updater)
        }}
      />

      <div className={`optimizer-pane ${isWide ? '' : 'compact'}`}>
        {isWide ? <OptimizerControlBox isWide {...controlProps} /> : null}

        <div className="optimizer-details optimizer-details--compact">
          <Expandable
            header="Simulation Settings"
            defaultOpen
            className="optimizer-character-settings"
            triggerClassName="opt-expandable-trigger"
            triggerStyle={{ alignItems: 'center' }}
          >
            <div className="character-options-container">
              <CharacterOptionsPanel
                displayName={displayName}
                level={optimizerRuntime?.base.level ?? 90}
                sequence={optimizerRuntime?.base.sequence ?? 0}
                rarity={activeSeed?.rarity ?? 4}
                imageSrc={imageSrc}
                targetMode={targetMode}
                targetSkillId={optimizerSettings?.targetSkillId ?? null}
                targetComboId={optimizerSettings?.targetComboSourceId ?? null}
                skillOptions={skillOptions}
                skillGroups={skillGroups}
                comboOptions={comboOptions}
                enableGpu={optimizerSettings?.enableGpu ?? true}
                useSplash={isSprite}
                mainEcho={selectedMainEchoFilter}
                allowedSets={optimizerSettings?.allowedSets ?? { 3: [], 5: [] }}
                mainStatFilter={optimizerSettings?.mainStatFilter ?? []}
                selectedBonus={optimizerSettings?.selectedBonus ?? null}
                statConstraints={optimizerSettings?.statConstraints ?? {}}
                optimizerRuntime={optimizerRuntime}
                onOpenResonatorPicker={() => openResonatorPicker('active')}
                onSyncLive={handleSyncLive}
                onTargetModeChange={(value) => {
                  const nextRotationMode = value === 'combo'
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    targetMode: value,
                    rotationMode: nextRotationMode,
                  }))
                  if (rotationMode !== nextRotationMode) {
                    resetOptimizerPresentation()
                  }
                }}
                onTargetSkillChange={(value) => {
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    targetSkillId: value,
                  }))
                }}
                onTargetComboChange={(value) => {
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    targetComboSourceId: value,
                  }))
                }}
                onEnableGpuChange={(enabled) => {
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    enableGpu: enabled,
                  }))
                }}
                onOptimizerRuntimeUpdate={updateOptimizerRuntime}
                onOpenMainEchoPicker={openMainEchoPicker}
                onOpenSetConditionals={setConditionalsModal.show}
                onClearMainEchoSelection={() => {
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    lockedMainEchoId: null,
                  }))
                }}
                onAllowedSetsChange={(value) => {
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    allowedSets: value,
                  }))
                }}
                onToggleMainStat={(value) => {
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    mainStatFilter: settings.mainStatFilter.includes(value)
                      ? settings.mainStatFilter.filter((entry) => entry !== value)
                      : [...settings.mainStatFilter, value],
                  }))
                }}
                onPickBonus={(value) => {
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    selectedBonus: value,
                    mainStatFilter: settings.mainStatFilter.includes('bonus')
                      ? settings.mainStatFilter
                      : [...settings.mainStatFilter, 'bonus'],
                  }))
                }}
                onClearAllFilters={() => {
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    mainStatFilter: [],
                    selectedBonus: null,
                  }))
                }}
                onStatLimitChange={(statKey, field, value) => {
                  updateOptimizerSettings((settings) => ({
                    ...settings,
                    statConstraints: {
                      ...settings.statConstraints,
                      [statKey]: {
                        ...settings.statConstraints[statKey],
                        [field]: value,
                      },
                    },
                  }))
                }}
                setIsSprite={setIsSprite}
              />
            </div>
          </Expandable>

          <Expandable header="Simulation Team" defaultOpen className="optimizer-search-results" triggerClassName="opt-expandable-trigger" triggerStyle={{ alignItems: 'center' }}>
            <OptimizerTeamPanel
                rarity={activeSeed?.rarity ?? 4}
                displayName={displayName}
                optimizerRuntime={effectiveOptimizerRuntime}
                invalidMainEchoIds={invalidTeammateMainEchoIds}
                teammateSetPreferences={[
                  resolvedTeammateEchoPlans[0]?.setPreferences ?? [],
                  resolvedTeammateEchoPlans[1]?.setPreferences ?? [],
                ]}
                onRuntimeUpdate={updateOptimizerRuntime}
                onOpenTeammatePicker={openResonatorPicker}
                onOpenWeaponPicker={openWeaponPicker}
                onOpenTeammateMainEchoPicker={(slotIndex) => openMainEchoPicker(slotIndex)}
                onAddTeammateSetPreference={addTeammateSetPreference}
                onRemoveTeammateSetPreference={removeTeammateSetPreference}
                onSetTeammateSetPreferenceCount={setTeammateSetPreferenceCount}
                onRemoveTeammate={removeTeammate}
                onRemoveTeammateMainEcho={removeTeammateMainEcho}
            />
          </Expandable>

          <Expandable header="Simulation Results" defaultOpen className="optimizer-search-results" triggerClassName="opt-expandable-trigger" triggerStyle={{ alignItems: 'center' }}>
            <div className="results-container">
                <div
                  className={`opt-results-header${resolvedPreviewTarget.kind === 'base' ? ' is-selected' : ''}`}
                  onClick={showBasePreview}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      showBasePreview()
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="opt-results-header__titles" data-mode={targetMode}>
                    {visibleHeaderTitles.map((title) => (
                      <div key={title} className="opt-results-header__col">
                        {title}
                      </div>
                    ))}
                  </div>
                  <OptimizerRow
                    result={baseResult}
                    base
                    baseDamage={baseResult.damage}
                    rotationMode={rotationMode}
                    onClick={showBasePreview}
                  />
                </div>

                <div className={`optimizer-results app-loader-host ${isLoading ? 'running' : ''}`}>
                  {isLoading ? (
                    <AppLoaderOverlay text="Optimizing..." />
                  ) : (
                    <>
                      {visibleResults.map((result, index) => (
                        <OptimizerRow
                          key={pageStart + index}
                          result={result}
                          baseDamage={baseResult.damage}
                          rotationMode={rotationMode}
                          selected={selectedPreviewIndex === index}
                          onClick={() => showResultPreview(index)}
                        />
                      ))}

                      {optimizerError ? (
                        <div className="opt-result-row is-base">
                          <div className="opt-result-row__col">{optimizerError}</div>
                        </div>
                      ) : null}

                      {totalPages > 1 ? (
                        <div className="opt-pagination">
                          <button
                            className="opt-pagination__btn opt-pagination__btn--subtle"
                            disabled={pageIndex === 0}
                            onClick={() => {
                              setPageIndex((value) => Math.max(0, value - 1))
                              setSelectedIndex(0)
                            }}
                          >
                            ‹
                          </button>

                          {pageItems.map((item, index) =>
                            item === '...' ? (
                              <span key={`ellipsis-${index}`} className="opt-pagination__ellipsis">
                                …
                              </span>
                            ) : (
                              <button
                                key={item}
                                className={`opt-pagination__btn${item === pageIndex ? ' is-active' : ''}`}
                                onClick={() => {
                                  setPageIndex(item as number)
                                  setSelectedIndex(0)
                                }}
                              >
                                {(item as number) + 1}
                              </button>
                            ),
                          )}

                          <button
                            className="opt-pagination__btn opt-pagination__btn--subtle"
                            disabled={pageIndex >= totalPages - 1}
                            onClick={() => {
                              setPageIndex((value) => Math.min(totalPages - 1, value + 1))
                              setSelectedIndex(0)
                            }}
                          >
                            ›
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              <div className="opt-echo-preview">
                <div className="opt-echo-preview__grid">
                  {previewEchoes.map((echo, index) => (
                    <OptimizerPreviewEchoTile key={`preview-echo-${index}`} echo={echo} index={index} />
                  ))}
                </div>
              </div>
            </Expandable>
          {!isWide ? <OptimizerControlBox isWide={false} {...controlProps} /> : null}
        </div>
      </div>

      <EchoPickerModal
        visible={mainEchoPickerVisible}
        open={mainEchoPickerOpen}
        closing={mainEchoPickerClosing}
        portalTarget={modalPortalTarget}
        echoes={allEchoes}
        selectedEchoId={selectedMainEchoId}
        slotIndex={0}
        maxCost={12}
        onSelect={(echoId: string) => {
          if (mainEchoPickerTarget === 'filter') {
            updateOptimizerSettings((settings) => ({
              ...settings,
              lockedMainEchoId: echoId,
            }))
            return
          }

          setTeammateEchoPlans((prev) => {
            const memberRuntime = optimizerRuntime ? materializeOptimizerSlotRuntime(optimizerRuntime, mainEchoPickerTarget) : null
            if (!memberRuntime) {
              return prev
            }

            const next = [...prev] as [TeammateEchoPlan | null, TeammateEchoPlan | null]
            next[mainEchoPickerTarget] = selectTeammateMainEcho(
              prev[mainEchoPickerTarget] ?? deriveTeammateEchoPlan(memberRuntime.build.echoes),
              echoId,
            )
            return next
          })
        }}
        onClear={() => {
          if (mainEchoPickerTarget === 'filter') {
            updateOptimizerSettings((settings) => ({
              ...settings,
              lockedMainEchoId: null,
            }))
            return
          }

          setTeammateEchoPlans((prev) => {
            const memberRuntime = optimizerRuntime ? materializeOptimizerSlotRuntime(optimizerRuntime, mainEchoPickerTarget) : null
            if (!memberRuntime) {
              return prev
            }

            const next = [...prev] as [TeammateEchoPlan | null, TeammateEchoPlan | null]
            next[mainEchoPickerTarget] = selectTeammateMainEcho(
              prev[mainEchoPickerTarget] ?? deriveTeammateEchoPlan(memberRuntime.build.echoes),
              null,
            )
            return next
          })
        }}
        onClose={closeMainEchoPicker}
      />

      <ResonatorPickerModal
        visible={resonatorPicker.visible}
        open={resonatorPicker.open}
        closing={resonatorPicker.closing}
        portalTarget={modalPortalTarget}
        eyebrow={selectedResonatorPickerSlot === 'active' ? 'Roster' : 'Team Slots'}
        title={selectedResonatorPickerSlot === 'active' ? 'Select Resonator' : 'Select Teammate'}
        description={
          selectedResonatorPickerSlot === 'active'
            ? undefined
            : 'Occupied team members are hidden so every slot stays unique.'
        }
        resonators={eligibleOptimizerTeamResonators}
        selectedResonatorId={
          selectedResonatorPickerSlot === null
            ? null
            : selectedResonatorPickerSlot === 'active'
              ? optimizerResonatorId ?? null
              : optimizerRuntime?.build.team[selectedResonatorPickerSlot + 1] ?? null
        }
        selectionLabel={selectedResonatorPickerSlot === 'active' ? 'Active' : 'Selected'}
        summaryPrimary={{
          label: selectedResonatorPickerSlot === 'active' ? 'Current' : 'Slot',
          value:
            selectedResonatorPickerSlot === 'active'
              ? displayName
              : `Teammate ${(selectedResonatorPickerSlot ?? 0) + 1}`,
        }}
        emptyState={<p>I hope Solon Lee releases the character you're searching for.</p>}
        closeLabel="Close"
        panelWidth="regular"
        onSelect={(resonatorId) => {
          if (selectedResonatorPickerSlot === null || selectedResonatorPickerSlot === 'active') {
            switchToResonator(resonatorId)
          } else {
            applyOptimizerTeammateSelection(selectedResonatorPickerSlot, resonatorId)
          }
          closeResonatorPicker()
        }}
        onClose={closeResonatorPicker}
      />

      <WeaponPickerModal
        visible={weaponPicker.visible}
        open={weaponPicker.open}
        closing={weaponPicker.closing}
        portalTarget={modalPortalTarget}
        weapons={selectedWeaponPickerWeapons}
        selectedWeaponId={
          selectedWeaponPickerRuntime?.build.weapon.id && !isUnsetWeaponId(selectedWeaponPickerRuntime.build.weapon.id)
            ? selectedWeaponPickerRuntime.build.weapon.id
            : null
        }
        onSelect={(weaponId) => {
          if (selectedWeaponPickerSlot === null) {
            return
          }

          applyOptimizerWeaponSelection(selectedWeaponPickerSlot, weaponId)
          closeWeaponPicker()
        }}
        onClose={closeWeaponPicker}
      />
    </div>
  )
}
