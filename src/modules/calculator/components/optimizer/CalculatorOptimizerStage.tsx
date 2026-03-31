import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { RotationNode } from '@/domain/gameData/contracts'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { LiquidSelectOption, LiquidSelectOptionGroup } from '@/shared/ui/LiquidSelect'
import { getSonataSetIcon, getSonataSetName } from '@/data/gameData/catalog/sonataSets'
import { getEchoSetDef } from '@/data/gameData/echoSets/effects'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService'
import { buildRuntimeParticipantLookup } from '@/domain/state/runtimeAdapters'
import { useAppStore } from '@/domain/state/store'
import {
  selectActiveResonatorId,
  selectActiveTargetSelections,
  selectEnemyProfile,
  selectOptimizerContext,
} from '@/domain/state/selectors'
import { compileOptimizerPayload } from '@/engine/optimizer/rebuild/compiler'
import { applyKeepPercentFilter, buildOptimizerStatWeightMap } from '@/engine/optimizer/rebuild/filter'
import {
  evaluatePreparedOptimizerBaseline,
  evaluateOptimizerBagResultStats,
  resolveOptimizerResultEchoes,
} from '@/engine/optimizer/rebuild/materialize'
import { compileOptimizerTargetContext } from '@/engine/optimizer/rebuild/target/context'
import { listOptimizerTargets } from '@/engine/optimizer/rebuild/target/skills'
import { countOptimizerCombinationsByMode } from '@/engine/optimizer/count'
import type { OptimizerBagResultRef, OptimizerProgress } from '@/engine/optimizer/types'
import { seedResonatorsById } from '@/modules/calculator/model/seedData'
import { AppDialog } from '@/shared/ui/AppDialog'
import { Expandable } from '@/shared/ui/Expandable'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'
import { EchoPickerModal } from '@/modules/calculator/components/workspace/panes/left/modals/EchoPickerModal'
import { ResonatorPickerModal } from '@/modules/calculator/components/resonator/modals/ResonatorPickerModal'
import { CharacterOptionsPanel } from '@/modules/calculator/components/optimizer/ResonatorOptionsPanel.tsx'
import { OptimizerControlBox } from '@/modules/calculator/components/optimizer/OptimizerControlBox'
import { OptimizerRow, type OptimizerDisplayRow, type OptimizerDisplaySetEntry } from '@/modules/calculator/components/optimizer/OptimizerRow'
import { OptimizerRules } from '@/modules/calculator/components/optimizer/OptimizerRules'
import { HEADER_TITLES } from '@/modules/calculator/components/optimizer/mockData'
import { formatStatKeyLabel, formatStatKeyValue, toTitle } from '@/modules/calculator/model/overviewStats'
import { modalContent } from '@/modules/calculator/components/optimizer/OptimizerModals'
import { RESONATOR_MENU } from '@/modules/calculator/model/resonator'

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

const OPTIMIZER_SKILL_TAB_ORDER = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'tuneBreak',
  'negativeEffect',
] as const

const OPTIMIZER_SKILL_TAB_LABELS: Record<string, string> = {
  normalAttack: 'Normal Attack',
  resonanceSkill: 'Resonance Skill',
  forteCircuit: 'Forte Circuit',
  resonanceLiberation: 'Resonance Liberation',
  introSkill: 'Intro Skill',
  outroSkill: 'Outro Skill',
  tuneBreak: 'Tune Break',
  negativeEffect: 'Negative Effects',
}

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

function normalizeEchoLoadout(echoes: ReadonlyArray<EchoInstance | null | undefined>): Array<EchoInstance | null> {
  const out: Array<EchoInstance | null> = [null, null, null, null, null]
  for (let index = 0; index < out.length; index += 1) {
    out[index] = echoes[index] ?? null
  }
  return out
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
  const updateOptimizerSettings = useAppStore((state) => state.updateOptimizerSettings)
  const switchToResonator = useAppStore((state) => state.switchToResonator)
  const startOptimizer = useAppStore((state) => state.startOptimizer)
  const cancelOptimizer = useAppStore((state) => state.cancelOptimizer)
  const clearOptimizerResults = useAppStore((state) => state.clearOptimizerResults)
  const applyOptimizerResult = useAppStore((state) => state.applyOptimizerResult)

  useEffect(() => {
    ensureOptimizerContext()
  }, [activeResonatorId, ensureOptimizerContext])

  const optimizerResonatorId = optimizerContext?.resonatorId ?? activeResonatorId
  const optimizerRuntime = optimizerContext?.runtime ?? null
  const optimizerSettings = optimizerContext?.settings ?? null
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
  const [resonatorPickerVisible, setResonatorPickerVisible] = useState(false)
  const [resonatorPickerOpen, setResonatorPickerOpen] = useState(false)
  const [resonatorPickerClosing, setResonatorPickerClosing] = useState(false)
  const [mainEchoPickerVisible, setMainEchoPickerVisible] = useState(false)
  const [mainEchoPickerOpen, setMainEchoPickerOpen] = useState(false)
  const [mainEchoPickerClosing, setMainEchoPickerClosing] = useState(false)
  const [progress, setProgress] = useState<OptimizerProgress>(() => createEmptyProgress())

  const modalRef = useRef<HTMLDivElement>(null)
  const modalOpenFrameRef = useRef<number | null>(null)
  const modalCloseTimerRef = useRef<number | null>(null)
  const rulesOpenFrameRef = useRef<number | null>(null)
  const rulesCloseTimerRef = useRef<number | null>(null)
  const resonatorPickerCloseTimerRef = useRef<number | null>(null)
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

  const visibleSkills = useMemo(() => {
    if (!optimizerRuntime) {
      return []
    }

    return listOptimizerTargets(optimizerRuntime)
  }, [optimizerRuntime])

  const targetableSkills = visibleSkills

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
        label: OPTIMIZER_SKILL_TAB_LABELS[tab],
        options: grouped.get(tab) ?? [],
      }))
      .filter((group) => group.options.length > 0)
  }, [targetableSkills])

  const comboOptions = useMemo<LiquidSelectOption<string>[]>(() => {
    if (!optimizerRuntime || !optimizerResonatorId) {
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
  }, [displayName, inventoryRotations, optimizerResonatorId, optimizerRuntime])

  const selectedRotationItems = useMemo<RotationNode[] | null>(() => {
    if (!optimizerRuntime || !optimizerResonatorId) {
      return null
    }

    const selectedSourceId = optimizerSettings?.targetComboSourceId
    if (!selectedSourceId) {
      return optimizerRuntime.rotation.personalItems
    }

    if (selectedSourceId === `live:${optimizerResonatorId}`) {
      return optimizerRuntime.rotation.personalItems
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

    return optimizerRuntime.rotation.personalItems
  }, [
    inventoryRotations,
    optimizerResonatorId,
    optimizerRuntime,
    optimizerSettings?.targetComboSourceId,
  ])

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

      if (allowedMainStatKeys.size > 0 && !allowedMainStatKeys.has(echo.mainStats.primary.key)) {
        return false
      }

      return true
    })
  }, [inventoryEchoEntries, optimizerSettings])

  const allEchoes = useMemo(() => listEchoes(), [])

  const preparedTargetSkill = useMemo(() => {
    const resonatorId = optimizerResonatorId
    const targetSkillId = optimizerSettings?.targetSkillId
    if (
      !resonatorId ||
      !optimizerRuntime ||
      !targetSkillId ||
      rotationMode
    ) {
      return null
    }

    return compileOptimizerTargetContext({
      runtime: optimizerRuntime,
      resonatorId,
      skillId: targetSkillId,
      enemy: enemyProfile,
      runtimesById: buildRuntimeParticipantLookup(optimizerRuntime),
      selectedTargetsByOwnerKey: activeTargetSelections,
    })
  }, [
    activeTargetSelections,
    enemyProfile,
    optimizerResonatorId,
    optimizerRuntime,
    optimizerSettings,
    rotationMode,
  ])

  const optimizerWeightMap = useMemo(() => {
    if (
      !optimizerRuntime ||
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
      level: optimizerRuntime.base.level,
      combat: optimizerRuntime.state.combat,
    })
  }, [
    enemyProfile,
    optimizerRuntime,
    optimizerSettings,
    preparedTargetSkill,
    rotationMode,
  ])

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

  const equippedEchoes = useMemo(
    () => normalizeEchoLoadout(optimizerRuntime?.build.echoes ?? []).filter(
      (echo): echo is EchoInstance => echo != null,
    ),
    [optimizerRuntime?.build.echoes],
  )

  const baselinePreparedPayload = useMemo(() => {
    if (
      !optimizerResonatorId ||
      !optimizerRuntime ||
      !optimizerSettings ||
      (!rotationMode && !optimizerSettings.targetSkillId) ||
      equippedEchoes.length === 0
    ) {
      return null
    }

    return compileOptimizerPayload({
      resonatorId: optimizerResonatorId,
      runtime: optimizerRuntime,
      settings: optimizerSettings,
      inventoryEchoes: equippedEchoes,
      enemyProfile,
      selectedTargetsByOwnerKey: activeTargetSelections,
      rotationItems: rotationMode ? selectedRotationItems : undefined,
    })
  }, [
    activeTargetSelections,
    enemyProfile,
    equippedEchoes,
    optimizerResonatorId,
    optimizerRuntime,
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

  const baseResult = useMemo<OptimizerDisplayRow>(() => {
    if (!optimizerRuntime) {
      return buildPlaceholderResult()
    }

    const summary = summarizeEchoLoadout(optimizerRuntime.build.echoes)

    return {
      damage: baselineEvaluation?.damage ?? 0,
      cost: summary.cost,
      sets: summary.sets,
      mainEchoIcon: summary.mainEchoIcon,
      stats: baselineEvaluation?.stats ?? null,
    }
  }, [baselineEvaluation, optimizerRuntime])

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
  }, [
    inventoryEchoesByUid,
    optimizerResults,
    optimizerResolutionPayload,
    optimizerResultEchoes,
    pageEnd,
    pageStart,
  ])
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
      return normalizeEchoLoadout(optimizerRuntime?.build.echoes ?? [])
    }

    const entry = optimizerResults[resolvedPreviewTarget.index]
    if (!entry) {
      return normalizeEchoLoadout(optimizerRuntime?.build.echoes ?? [])
    }

    if (hasLegacyOptimizerResultEntry(entry)) {
      return normalizeEchoLoadout(entry.uids.map((uid) => inventoryEchoesByUid.get(uid) ?? null))
    }

    return normalizeEchoLoadout(resolveOptimizerResultEchoes(optimizerResultEchoes, entry))
  }, [
    inventoryEchoesByUid,
    optimizerResultEchoes,
    optimizerResults,
    optimizerRuntime,
    resolvedPreviewTarget,
  ])

  const showBasePreview = () => {
    setPreviewTarget({ kind: 'base' })
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

  const openResonatorPicker = () => {
    if (resonatorPickerCloseTimerRef.current !== null) {
      window.clearTimeout(resonatorPickerCloseTimerRef.current)
      resonatorPickerCloseTimerRef.current = null
    }

    setResonatorPickerClosing(false)
    setResonatorPickerVisible(true)
    window.requestAnimationFrame(() => setResonatorPickerOpen(true))
  }

  const closeResonatorPicker = () => {
    setResonatorPickerOpen(false)
    setResonatorPickerClosing(true)

    if (resonatorPickerCloseTimerRef.current !== null) {
      window.clearTimeout(resonatorPickerCloseTimerRef.current)
    }

    resonatorPickerCloseTimerRef.current = window.setTimeout(() => {
      setResonatorPickerVisible(false)
      setResonatorPickerClosing(false)
      resonatorPickerCloseTimerRef.current = null
    }, 180)
  }

  const openMainEchoPicker = () => {
    if (mainEchoPickerCloseTimerRef.current !== null) {
      window.clearTimeout(mainEchoPickerCloseTimerRef.current)
      mainEchoPickerCloseTimerRef.current = null
    }

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
      mainEchoPickerCloseTimerRef.current = null
    }, 180)
  }

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
      runtime: optimizerContext.runtime,
      settings: optimizerContext.settings,
      inventoryEchoes: filteredInventoryEchoEntries.map((entry) => entry.echo),
      enemyProfile,
      selectedTargetsByOwnerKey: activeTargetSelections,
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
    resetOptimizerPresentation()
  }

  function handleHalt() {
    cancelOptimizer()
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
    onEquip: () => applyOptimizerResult(activeResultIndex),
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

      <div className={`optimizer-pane ${isWide ? '' : 'compact'}`}>
        {isWide ? <OptimizerControlBox isWide {...controlProps} /> : null}

        <div className="optimizer-details optimizer-details--compact">
          <Expandable
            header="Character Settings"
            defaultOpen
            className="optimizer-character-settings"
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
                onOpenResonatorPicker={openResonatorPicker}
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

          <Expandable header="Results" defaultOpen className="optimizer-search-results">
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
        </div>

        {!isWide ? <OptimizerControlBox isWide={false} {...controlProps} /> : null}
      </div>

      <EchoPickerModal
        visible={mainEchoPickerVisible}
        open={mainEchoPickerOpen}
        closing={mainEchoPickerClosing}
        portalTarget={modalPortalTarget}
        echoes={allEchoes}
        selectedEchoId={optimizerSettings?.lockedMainEchoId ?? null}
        slotIndex={0}
        maxCost={12}
        onSelect={(echoId: string) => {
          updateOptimizerSettings((settings) => ({
            ...settings,
            lockedMainEchoId: echoId,
          }))
        }}
        onClear={() => {
          updateOptimizerSettings((settings) => ({
            ...settings,
            lockedMainEchoId: null,
          }))
        }}
        onClose={closeMainEchoPicker}
      />

      <ResonatorPickerModal
        visible={resonatorPickerVisible}
        open={resonatorPickerOpen}
        closing={resonatorPickerClosing}
        portalTarget={modalPortalTarget}
        eyebrow="Roster"
        title="Select Resonator"
        resonators={RESONATOR_MENU}
        selectedResonatorId={optimizerResonatorId ?? null}
        selectionLabel="Active"
        summaryPrimary={{
          label: 'Current',
          value: displayName,
        }}
        emptyState={<p>I hope Solon Lee releases the character you're searching for.</p>}
        closeLabel="Close"
        panelWidth="regular"
        onSelect={(resonatorId) => {
          switchToResonator(resonatorId)
          closeResonatorPicker()
        }}
        onClose={closeResonatorPicker}
      />
    </div>
  )
}
