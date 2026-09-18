/*
  Author: Runor Ewhro
  Description: Orchestrates the shared roster, rail, evaluation, and profile
               behavior for Modulation, Optimizer, Showcase, and the temporary
               legacy Evaluation view.
*/

import { Suspense, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/domain/state/store.ts'
import {
  selActResId,
  selVrvwDrvd,
} from '@/domain/state/selectors.ts'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { getResonator, type ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import {
  flattenScenarioRouting,
  projectScenarioUiRuntimes,
} from '@/domain/state/scenarioRuntime.ts'
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { useEchoSrfcM } from '@/modules/simulation/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/simulation/features/echoes/lib/equip.ts'
import { openEchoCnsl } from '@/modules/simulation/features/echoes/lib/echoConsoleStore.ts'
import {
  copyBuildCard,
  downloadBuildCard,
  renderBuildCardPng,
} from '@/modules/simulation/showcase/captureBuildCard.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE } from '@/domain/entities/preferences'
import { useEvaluationReport } from '@/modules/simulation/model/useBuildEvaluation.ts'
import { useEvaluationTarget } from '@/modules/simulation/model/useEvaluationTarget.ts'
import { useStableEvaluationInputs } from '@/modules/simulation/model/useStableEvaluationInputs.ts'
import {
  applyEvaluationAsm,
  applyEvaluationMapAsm,
  makeEvaluationEnemy,
} from '@/modules/simulation/model/evaluationAssumptions.ts'
import { getTuneStrainMaxForTeam } from '@/domain/gameData/tuneStrain.ts'
import {
  getBuildEvaluationGrade,
  getBuildEvaluationTone,
} from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { makeStatsTree, makeStatsView } from '@/modules/simulation/model/statsView.ts'
import { getMaxEchoSc } from '@/data/scoring/echoScoring.ts'
import { useEchoScores } from '@/data/scoring/useEchoScoringRevision.ts'
import { getBuildStats } from '@/engine/pipeline/buildStats.ts'
import { resResBaseSt } from '@/domain/services/resonatorSeedService.ts'
import { useAppModal } from '@/shared/ui/useAppModal'
import { useMediaQuery } from '@/app/hooks/useMediaQuery'
import { ImageUploadModal } from '@/shared/ui/ImageUploadModal'
import { resolveImageRef } from '@/shared/lib/imageUpload.ts'
import type { StoredImage } from '@/shared/lib/imageUpload.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useConfirm } from '@/app/hooks/useConfirmation.ts'
import { mainPortal } from '@/shared/lib/portalTarget'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal'
import type { EvaluationBuildSnapshot } from '@/data/scoring/buildEvaluation.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { Copy } from 'lucide-react'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import {
  EVALUATION_RAIL_ENTER_MS, EVALUATION_RAIL_EXIT_MS,
  type EvaluationEchoSelection, type CssVars, type DetailBuildKey,
  buildSonataPlan, getEvaluationSpinePlacement,
  preloadEvaluationRailImages, scheduleEvaluationTargetWork,
} from '@/modules/simulation/workspace/ui.tsx'
import { ShowcaseCssEditorDock, ShowcaseCustomizePanel } from '@/modules/simulation/showcase/Customize.tsx'
import { buildTextSlotVars, collectCardFontFamilies, splitHoistedCss } from '@/modules/simulation/showcase/cardStyleVars.ts'
import { buildCardExport, parseCardImport, type CardExportTarget } from '@/modules/simulation/showcase/cardTransfer.ts'
import { readAppFile, xprtAppFile } from '@/shared/lib/fileCodec.ts'
import { ensureGoogleFamily } from '@/modules/calibration/model/typography.ts'
import {
  type BuildRosterEntry,
} from '@/modules/simulation/workspace/BuildRoster.tsx'
import { BuildRail, type BuildRailModel } from '@/modules/simulation/workspace/BuildRail.tsx'
import { RailDock } from '@/modules/simulation/workspace/RailDock.tsx'
import { makeRailModel as buildRailModel } from '@/modules/simulation/workspace/railModel.ts'
import { makeRosterEntries } from '@/modules/simulation/workspace/rosterModel.ts'
import { useResonatorProfileOps } from '@/modules/simulation/workspace/useResonatorProfileOps.ts'
import {
  BuildWorkspaceBoard,
  BuildWorkspaceRailSlot,
  BuildWorkspaceWorkspace,
} from '@/modules/simulation/workspace/BuildWorkspaceLayout.tsx'
import { ModulationReport } from '@/modules/simulation/modulation/ModulationReport.tsx'
import { NarrowEvaluationBanner } from '@/modules/simulation/workspace/NarrowEvaluationBanner.tsx'
import { getEvaluationStageCtx } from '@/modules/simulation/workspace/context.tsx'
import { makeEchoSlot } from '@/modules/simulation/workspace/echoSlot.ts'
import { useWorkspaceEchoActions } from '@/modules/simulation/workspace/useWorkspaceEchoActions.ts'
import { optimizerPane, suggestionsPane } from '@/app/nav/routeChunks.ts'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'

const EMPTY_ECHO_LOADOUT: Array<EchoInstance | null> = []
const EMPTY_RUNTIME_MAP: Record<string, ResRuntime> = Object.freeze({})

export type BuildWorkspaceSurfacePage = 'modulation' | 'optimizer' | 'showcase' | 'suggestions'

const EmbeddedOptimizer = optimizerPane.Mount
const EmbeddedSuggestions = suggestionsPane.Mount

export function BuildWorkspaceSurface({ page }: { page: BuildWorkspaceSurfacePage }) {
  const showToast = useTstStr((state) => state.show)
  const confirmation = useConfirm()
  const portalTarget = mainPortal()
  const [detailBuildKey, setDetailBuildKey] = useState<DetailBuildKey>('active')
  const actResId = useAppStore(selActResId)
  const scenarioLibrary = useAppStore((state) => state.combat)
  const showAllStates = useAppStore((state) => state.ui.preferences.showEvaluationStates)
  const themeMode = useAppStore((state) => state.ui.theme)
  const backgroundTextMode = useAppStore((state) => state.ui.backgroundTextMode)
  const isDarkTheme = themeMode === 'background' ? backgroundTextMode === 'dark' : themeMode === 'dark'
  const animatedPortraits = useAppStore((state) => state.ui.preferences.animatedRailPortraits)
  const optimizerRunning = useAppStore((state) => state.optimizer.status === 'running')
  const { actRt: runtime, partRtsById, actTgtSels } = useAppStore(selVrvwDrvd)
  const updateScenarioRuntime = useAppStore((state) => state.updScenarioResRt)
  const setAnimatedPortraits = useAppStore((state) => state.setAnimatedRailPortraits)
  const selectedScenarioId = scenarioLibrary.selectedScenarioId
  const [reportTargetScenarioId, setReportTargetScenarioId] = useState(selectedScenarioId)
  const [railScenarioId, setRailScenarioId] = useState(selectedScenarioId)
  const [railPhase, setRailPhase] = useState<'idle' | 'out' | 'in'>('idle')
  const isShowcase = page === 'showcase'
  const isModulation = page === 'modulation'
  const isOptimizer = page === 'optimizer'
  const isSuggestions = page === 'suggestions'
  const pauseRailPortrait = isOptimizer && optimizerRunning

  const isNarrow = useMediaQuery('(max-width: 80rem)')
  const surfacePhase = 'idle' as const
  const [captureAction, setCaptureAction] = useState<'download' | 'clipboard' | null>(null)

  // Showcase customization persists independently for each resonator.
  const showcaseCards = useAppStore((state) => state.ui.preferences.showcaseCards)
  const patchShowcaseCardStyle = useAppStore((state) => state.patchShowcaseCardStyle)
  const toggleShowcaseHide = useAppStore((state) => state.toggleShowcaseHide)
  const patchShowcaseCardHidden = useAppStore((state) => state.patchShowcaseCardHidden)
  const resetShowcaseCard = useAppStore((state) => state.resetShowcaseCard)
  const showcaseLayout = useAppStore((state) => state.ui.preferences.showcaseLayout)
  const setShowcaseLayout = useAppStore((state) => state.setShowcaseLayout)
  const railScenario = scenarioLibrary.scenariosById[railScenarioId] ?? null
  const railProjection = useMemo(() => {
    if (!railScenario) return null
    if (railScenarioId === selectedScenarioId && runtime) {
      return { subjectRuntime: runtime, runtimesById: partRtsById }
    }
    return projectScenarioUiRuntimes(railScenario)
  }, [partRtsById, railScenario, railScenarioId, runtime, selectedScenarioId])
  const railRuntime = railProjection?.subjectRuntime ?? null
  const railPartRtsById = railProjection?.runtimesById ?? EMPTY_RUNTIME_MAP
  const railResId = railRuntime?.id ?? null
  const cardConfig = (railResId && showcaseCards[railResId]) || null
  const cardStyle = cardConfig?.style ?? DEF_SHOWCASE_CARD_STYLE
  const cardHidden = cardConfig?.hidden ?? DEF_SHOWCASE_HIDE
  const [tuneResetKey, setTuneResetKey] = useState(0)
  const [editMode, setEditMode] = useState<'portrait' | 'backdrop' | null>(null)

  const [cssExpanded, setCssExpanded] = useState(false)
  const [tuneDrawerOpen, setTuneDrawerOpen] = useState(false)
  // Session uploads are deliberately kept outside persisted preferences.
  const [sessionImages, setSessionImages] = useState<Record<string, { portrait?: string; backdrop?: string }>>({})
  const [uploadTarget, setUploadTarget] = useState<'portrait' | 'backdrop'>('portrait')
  const uploadModal = useAppModal()
  // Session images override persisted refs; IndexedDB refs resolve through the URL cache.
  const sessionForRail = railResId ? sessionImages[railResId] : undefined
  const portraitRef = sessionForRail?.portrait ?? cardStyle.portraitImage
  const backdropRef = sessionForRail?.backdrop ?? cardStyle.backdropImage
  // Resolve direct refs synchronously; only IndexedDB blobs require asynchronous hydration.
  const [idbImageUrls, setIdbImageUrls] = useState<Record<string, string>>({})
  const idbImageUrlsRef = useRef(idbImageUrls)
  idbImageUrlsRef.current = idbImageUrls
  const resolveRefSync = useCallback(
    (ref: string | null): string | null => {
      if (!ref) return null
      if (ref.startsWith('upload:')) return idbImageUrls[ref] ?? null
      return ref
    },
    [idbImageUrls],
  )
  const resolvedPortrait = resolveRefSync(portraitRef)
  const resolvedBackdrop = resolveRefSync(backdropRef)

  useEffect(() => {
    const pending = [portraitRef, backdropRef].filter(
      (ref): ref is string => !!ref && ref.startsWith('upload:') && !idbImageUrlsRef.current[ref],
    )
    if (pending.length === 0) return undefined
    let cancelled = false
    void Promise.all(
      pending.map(async (ref) => [ref, (await resolveImageRef(ref))?.url] as const),
    ).then((pairs) => {
      if (cancelled) return
      setIdbImageUrls((prev) => {
        const next = { ...prev }
        for (const [ref, url] of pairs) if (url) next[ref] = url
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [portraitRef, backdropRef])

  useEffect(() => () => {
    for (const url of Object.values(idbImageUrlsRef.current)) URL.revokeObjectURL(url)
  }, [])

  const handlePickImage = useCallback((target: 'portrait' | 'backdrop') => {
    setUploadTarget(target)
    uploadModal.show()
  }, [uploadModal])

  const handleApplyImage = useCallback((result: StoredImage, credit: string) => {
    if (!railResId) return
    const creditValue = credit.trim() || null
    const creditPatch = uploadTarget === 'portrait'
      ? { portraitCredit: creditValue }
      : { backdropCredit: creditValue }
    if (result.persisted) {
      patchShowcaseCardStyle(
        railResId,
        uploadTarget === 'portrait'
          ? { portraitImage: result.ref, ...creditPatch }
          : { backdropImage: result.ref, ...creditPatch },
      )
      setSessionImages((prev) => {
        const current = prev[railResId]
        if (!current) return prev
        return { ...prev, [railResId]: { ...current, [uploadTarget]: undefined } }
      })
    } else {
      // Credits remain persisted even when the selected image is session-only.
      patchShowcaseCardStyle(railResId, creditPatch)
      setSessionImages((prev) => ({
        ...prev,
        [railResId]: { ...prev[railResId], [uploadTarget]: result.ref },
      }))
    }
    setEditMode(uploadTarget)
  }, [railResId, uploadTarget, patchShowcaseCardStyle])

  // Reset all persisted and session fields owned by one image group.
  const handleResetGroup = useCallback((group: 'portrait' | 'backdrop') => {
    if (!railResId) return
    if (group === 'portrait') {
      patchShowcaseCardStyle(railResId, {
        portraitImage: null,
        portraitCredit: null,
        portraitX: null,
        portraitY: null,
        portraitScale: null,
        maskTop: null,
        maskRight: null,
        maskBottom: null,
        maskLeft: null,
        maskTopSharp: null,
        maskRightSharp: null,
        maskBottomSharp: null,
        maskLeftSharp: null,
      })
      patchShowcaseCardHidden(railResId, { portraitCredit: false })
    } else {
      patchShowcaseCardStyle(railResId, {
        backdropImage: null,
        backdropCredit: null,
        backdropX: null,
        backdropY: null,
        backdropScale: null,
        backdropBlur: null,
        backdropOpacity: null,
      })
      patchShowcaseCardHidden(railResId, { backdropCredit: false })
    }
    setSessionImages((prev) => {
      const current = prev[railResId]
      if (!current) return prev
      return { ...prev, [railResId]: { ...current, [group]: undefined } }
    })
    setEditMode(null)
  }, [railResId, patchShowcaseCardStyle, patchShowcaseCardHidden])

  const handleExportTarget = useCallback(async (target: CardExportTarget) => {
    const { raw, filename, mime } = buildCardExport(target, cardStyle, cardHidden)

    if (mime === 'application/json') {
      await xprtAppFile(filename, raw)
      return
    }
    const blob = new Blob([raw], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }, [cardStyle, cardHidden])

  const handleImportFile = useCallback(async (file: File) => {
    if (!railResId) return
    try {
      const result = parseCardImport(file.name, await readAppFile(file))
      if (result.stylePatch) patchShowcaseCardStyle(railResId, result.stylePatch)
      if (result.hiddenPatch) patchShowcaseCardHidden(railResId, result.hiddenPatch)
      showToast({ content: `Imported ${result.label}.`, variant: 'success' })
    } catch (error) {
      showToast({ content: error instanceof Error ? error.message : 'That card file could not be imported.', variant: 'error' })
    }
  }, [railResId, patchShowcaseCardStyle, patchShowcaseCardHidden, showToast])
  const railScenarioIdRef = useRef(selectedScenarioId)
  const buildCardRef = useRef<HTMLElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const mainStackRef = useRef<HTMLDivElement | null>(null)

  // Derive route context actions from the same canonical roster model used by chrome.
  const roster = useMemo<BuildRosterEntry[]>(
    () => makeRosterEntries(scenarioLibrary),
    [scenarioLibrary],
  )
  const rosterOps = useResonatorProfileOps(roster)

  const stageContextItems = useMemo(() => getEvaluationStageCtx({
    canDeleteAll: roster.length > 0,
    onPaste: () => {
      void rosterOps.paste()
    },
    onDeleteAll: () => {
      rosterOps.remove(roster.map((entry) => entry.id), {
        title: 'Remove all context resonators?',
        message: 'This will remove every scenario represented by the context roster. Build Lab will create a default fallback scenario.',
        successMessage: `Removed ${roster.length} context resonators from Build Lab.`,
      })
    },
  }), [roster, rosterOps])

  useEffect(() => {
    if (reportTargetScenarioId === railScenarioId || railPhase !== 'idle') {
      return undefined
    }

    return scheduleEvaluationTargetWork(() => {
      startTransition(() => {
        setReportTargetScenarioId(railScenarioId)
      })
    })
  }, [railPhase, railScenarioId, reportTargetScenarioId])

  const railSeed = railResId ? seedRsntById[railResId] ?? null : null

  // Modulation member inspection is local and does not mutate shared profile selection.
  const [progResId, setModulationMemberId] = useState<string | null>(null)
  const modulationRoster = useMemo<ResView[]>(() => {
    if (!railRuntime) return []

    const ids = [railRuntime.id, ...railRuntime.build.team.filter(Boolean)] as string[]
    return Array.from(new Set(ids)).flatMap((memberId) => {
      const view = getResonator(memberId)
      return view ? [view] : []
    })
  }, [railRuntime])
  const modulationMemberId = progResId && modulationRoster.some((mate) => mate.id === progResId)
    ? progResId
    : railResId
  const modulationRuntime = modulationMemberId ? railPartRtsById[modulationMemberId] ?? null : null

  useEffect(() => {
    setModulationMemberId(null)
  }, [railScenarioId])

  const updateModulationRuntime = useCallback((updater: (prev: ResRuntime) => ResRuntime) => {
    if (!modulationMemberId) return
    updateScenarioRuntime(railScenarioId, modulationMemberId, updater)
  }, [modulationMemberId, railScenarioId, updateScenarioRuntime])

  const updateRailRuntime = useCallback((
    resonatorId: string,
    updater: (prev: ResRuntime) => ResRuntime,
  ) => {
    updateScenarioRuntime(railScenarioId, resonatorId, updater)
  }, [railScenarioId, updateScenarioRuntime])

  const reportScenario = scenarioLibrary.scenariosById[reportTargetScenarioId] ?? null
  const reportProjection = useMemo(() => {
    if (!reportScenario) return null
    if (reportTargetScenarioId === selectedScenarioId && runtime) {
      return { subjectRuntime: runtime, runtimesById: partRtsById }
    }
    return projectScenarioUiRuntimes(reportScenario)
  }, [partRtsById, reportScenario, reportTargetScenarioId, runtime, selectedScenarioId])
  const reportRuntime = reportProjection?.subjectRuntime ?? null
  const reportTargetResId = reportRuntime?.id ?? null
  const nextEvaluationInputs = useMemo(() => ({
    runtime: reportRuntime ? applyEvaluationAsm(reportRuntime) : null,
    runtimesById: applyEvaluationMapAsm(reportProjection?.runtimesById ?? {}),
    targetSelections: reportTargetScenarioId === selectedScenarioId
      ? actTgtSels
      : reportScenario ? flattenScenarioRouting(reportScenario) : {},
  }), [
    actTgtSels,
    reportProjection?.runtimesById,
    reportRuntime,
    reportScenario,
    reportTargetScenarioId,
    selectedScenarioId,
  ])
  // Live enemy and progression writes replace the scenario projection even
  // though evaluation policy ignores the enemy and maxes progression. Preserve
  // the normalized identity so those writes do not restart report rendering.
  const evaluationInputs = useStableEvaluationInputs(nextEvaluationInputs)
  const evaluationRuntime = evaluationInputs.runtime
  const evaluationReportRuntimesById = evaluationInputs.runtimesById
  const reportSeed = reportTargetResId ? seedRsntById[reportTargetResId] ?? null : null
  const evaluationTuneStrain = useMemo(
    () => getTuneStrainMaxForTeam(evaluationRuntime),
    [evaluationRuntime],
  )
  const evaluationEnemy = useMemo(
    () => makeEvaluationEnemy(evaluationTuneStrain),
    [evaluationTuneStrain],
  )
  const reportTargets = evaluationInputs.targetSelections
  const reportTarget = useEvaluationTarget({
    targetRuntime: evaluationRuntime,
    targetSeed: reportSeed,
    targetSelections: reportTargets,
    // Evaluation scoring has its own normalized runtime/enemy assumptions, so
    // it must not reuse the live active prep even when evaluating the active resonator.
    activeResId: null,
    activeRuntimesById: evaluationReportRuntimesById,
    initializedRuntimesById: evaluationReportRuntimesById,
    enemy: evaluationEnemy,
    showAllStates,
    deferHeavyWork: true,
  })
  const reportRuntimesById = reportTarget.runtimesById
  const simulation = reportTarget.simulation
  const reportStateGroups = reportTarget.stateGroups
  const echoRuntime = isModulation ? modulationRuntime ?? railRuntime : railRuntime
  const echoSeed = (isModulation && echoRuntime ? seedRsntById[echoRuntime.id] ?? null : null)
    ?? railSeed
  const echoLoadout = echoRuntime?.build.echoes ?? EMPTY_ECHO_LOADOUT
  const loadoutSlots = useMemo(
    () => echoLoadout.map((echo) => (echo ? makeEchoSlot(echo) : null)),
    [echoLoadout],
  )
  // a resonator with no substat weights has nothing to score against, so the
  // slots fall back to the crit value they rolled
  const echoScores = useEchoScores(echoRuntime?.id, echoLoadout)
  const equipEvaluationEcho = useCallback((echo: EchoInstance, slotIndex: number) => {
    const resonatorId = echoRuntime?.id
    if (!resonatorId) return

    updateRailRuntime(resonatorId, (curRt) => ({
      ...curRt,
      build: {
        ...curRt.build,
        echoes: qpEchoAtSlot(curRt.build.echoes, echo, slotIndex),
      },
    }))
  }, [echoRuntime?.id, updateRailRuntime])
  // the head writes the loadout whole (forge, save all, unequip all) through the
  // same runtime the slots do, so progression lands on the member being tuned
  const setEchoLoadout = useCallback((echoes: Array<EchoInstance | null>) => {
    const resonatorId = echoRuntime?.id
    if (!resonatorId) return

    updateRailRuntime(resonatorId, (curRt) => ({
      ...curRt,
      build: { ...curRt.build, echoes },
    }))
  }, [echoRuntime?.id, updateRailRuntime])

  const openEchoSlot = useCallback((slotIndex: number) => {
    const resonatorId = echoRuntime?.id
    if (!resonatorId) return
    openEchoCnsl(resonatorId, slotIndex, railScenarioId)
  }, [echoRuntime?.id, railScenarioId])

  const echoSurfaceMenu = useEchoSrfcM({
    clpbSrcResId: echoRuntime?.id ?? 'unknown',
    clipSourceName: echoSeed?.name ?? echoRuntime?.id ?? 'No Resonator',
    currentEchoes: echoLoadout,
    onQpEchoAtjg: equipEvaluationEcho,
  })
  const { buildReadOnlyMenu, canSaveEcho, copyEchoesToClipboard } = echoSurfaceMenu
  const evaluationEchoItems = useMemo(
    () => echoLoadout
      .map((echo, index) => (echo ? { id: `evaluation:${echoRuntime?.id ?? 'unknown'}:echo:${index}`, val: echo } : null))
      .filter((item): item is { id: string; val: EchoInstance } => Boolean(item)),
    [echoLoadout, echoRuntime?.id],
  )
  const evaluationEchoActions = useMemo(() => [{
    id: 'evaluation-echo:copy',
    key: 'copy' as const,
    needsSel: true,
    icon: <Copy size="1em" />,
    label: ({ count }: { count: number }) => `Copy (${count})`,
    title: 'Copy selected echoes (Ctrl/Cmd+C)',
    run: async ({ vals }: { vals: EchoInstance[] }) => {
      const wrote = await copyEchoesToClipboard(vals)
      if (wrote) {
        showToast({
          content: `Copied ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
          variant: 'success',
          duration: 2200,
        })
      }
    },
  }], [copyEchoesToClipboard, showToast])
  const evaluationEchoSelection = useSel({
    surfaceId: `evaluation:${echoRuntime?.id ?? 'unknown'}:echoes`,
    ariaLabel: 'Evaluation echo selection actions',
    noun: { one: 'echo', many: 'echoes' },
    items: evaluationEchoItems,
    acts: evaluationEchoActions,
    active: captureAction == null && surfacePhase === 'idle',
  })
  const focusEvaluationEchoSurface = evaluationEchoSelection.focusSurface
  const addEvaluationEchoToSelection = evaluationEchoSelection.addToSelection
  const getEvaluationEchoId = useCallback(
    (slotIndex: number) => `evaluation:${echoRuntime?.id ?? 'unknown'}:echo:${slotIndex}`,
    [echoRuntime?.id],
  )
  const getEvaluationEchoItems = useCallback((itemId: string, echo: EchoInstance) => (
    buildReadOnlyMenu({
      id: itemId,
      echo,
      onSelect: () => {
        focusEvaluationEchoSurface()
        addEvaluationEchoToSelection(itemId)
      },
    })
  ), [addEvaluationEchoToSelection, buildReadOnlyMenu, focusEvaluationEchoSurface])
  const echoSelection = useMemo<EvaluationEchoSelection>(() => ({
    selectionMode: evaluationEchoSelection.selectionMode,
    isSelected: evaluationEchoSelection.isSelected,
    buildClickCapture: evaluationEchoSelection.buildClickCapture,
    getId: getEvaluationEchoId,
    getItems: getEvaluationEchoItems,
    surfaceProps: evaluationEchoSelection.surfaceProps,
  }), [
    evaluationEchoSelection.buildClickCapture,
    evaluationEchoSelection.isSelected,
    evaluationEchoSelection.selectionMode,
    evaluationEchoSelection.surfaceProps,
    getEvaluationEchoId,
    getEvaluationEchoItems,
  ])

  const echoActions = useWorkspaceEchoActions({
    resonatorId: echoRuntime?.id,
    echoLoadout,
    editable: true,
    canSaveEcho,
    onEchoLoadoutChange: setEchoLoadout,
  })

  // Showcase only consumes the normalized score and live damage. Avoid
  // generating upgrade rows, target snapshots, feature breakdowns, and stat
  // tables that are never rendered on that surface.
  const reportOptions = useMemo(() => isShowcase ? {
    sections: {
      rotationFeatures: false,
      upgradePaths: false,
      echoStatsTable: false,
      evaluationTargets: false,
    },
  } : undefined, [isShowcase])

  const { report, loading, error } = useEvaluationReport({
    runtime: evaluationRuntime,
    simulation,
    enemy: evaluationEnemy,
    runtimesById: reportRuntimesById,
    enabled: surfacePhase === 'idle',
    identityKey: reportTargetScenarioId,
    reportOptions,
  })

  const overviewStatsTree = useMemo(
    () => simulation?.finalStats ? makeStatsTree(simulation.finalStats) : [],
    [simulation],
  )

  useLayoutEffect(() => {
    if (isShowcase) return undefined
    const board = boardRef.current
    const stack = mainStackRef.current
    if (!board || !stack) return undefined

    let frame = 0
    const updateInset = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        stack.style.setProperty('--workspace-stack-stick-top', `${board.clientHeight - stack.offsetHeight}px`)
      })
    }
    const observer = new ResizeObserver(updateInset)
    observer.observe(board)
    observer.observe(stack)
    updateInset()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [isShowcase, report])

  const accent = railSeed ? ATTR_COLORS[railSeed.attribute] ?? '#6b7cff' : '#6b7cff'
  const dockResId = isModulation ? modulationMemberId : railResId
  const dockRuntime = isModulation ? modulationRuntime : railRuntime
  const dockMember = isModulation
    ? modulationRoster.find((member) => member.id === modulationMemberId) ?? null
    : null
  const dockAccent = dockMember ? ATTR_COLORS[dockMember.attribute] ?? accent : accent
  const reportMatchesRail = reportTargetScenarioId === railScenarioId
  // Keep completed readings visible while this scenario is being reevaluated.
  // A cache hit retains the same report; a fresh result replaces it together.
  const visibleReport = reportMatchesRail ? report : null
  const scoreMatchesRail = reportMatchesRail
  const score = visibleReport ? visibleReport.evaluation.percent * 100 : null
  const showcaseAvgDamage = isShowcase && scoreMatchesRail
    ? visibleReport?.evaluation.userDamage ?? null
    : null
  const grade = getBuildEvaluationGrade(score)
  const tone = score != null ? getBuildEvaluationTone(score).color : accent

  const activeBuild: EvaluationBuildSnapshot | null = visibleReport?.evaluation.builds.active ?? null
  const referenceBuild: EvaluationBuildSnapshot | null = visibleReport?.evaluation.builds.referenceBuild ?? null
  const maximumBuild: EvaluationBuildSnapshot | null = visibleReport?.evaluation.builds.maximumBuild ?? null

  const showcaseBuild = useMemo(() => {
    if (!railRuntime) return null
    const buildSeed = seedRsntById[railRuntime.id] ?? null
    const buildStats = buildSeed ? getBuildStats(railRuntime, resResBaseSt(buildSeed, railRuntime.base.level)) : null
    const buildStatsView = buildStats ? makeStatsView(railRuntime, buildStats) : null
    const combatStatsView =
      evaluationRuntime?.id === railRuntime.id && simulation?.finalStats
        ? makeStatsView(evaluationRuntime, simulation.finalStats)
        : null
    return {
      combatStatsView,
      buildStatsView,
      charId: railRuntime.id,
      hasWeights: getMaxEchoSc(railRuntime.id) > 0,
      echoes: railRuntime.build.echoes,
      sonataSets: buildSonataPlan(railRuntime.build.echoes).map((entry) => ({
        setId: entry.id,
        pieces: entry.count,
        icon: entry.icon,
        name: getSntSetNam(entry.id),
      })),
    }
  }, [evaluationRuntime, railRuntime, simulation])

  const railModel = useMemo<BuildRailModel>(() => buildRailModel(railResId, {
    actResId: railResId,
    runtime: railRuntime,
    partRtsById: railPartRtsById,
    initRtsById: railPartRtsById,
  }), [railPartRtsById, railResId, railRuntime])

  // Convert neutral-at-50 controls into offsets around canonical spine placement.
  const showcasePlacement = useMemo(() => {
    const base = getEvaluationSpinePlacement(railResId)
    return {
      x: base.x - (((cardStyle.portraitX ?? 50) - 50) / 50) * 800,
      y: base.y - (((cardStyle.portraitY ?? 50) - 50) / 50) * 800,
      scale: base.scale * (0.5 + (cardStyle.portraitScale ?? 50) / 100),
    }
  }, [railResId, cardStyle.portraitX, cardStyle.portraitY, cardStyle.portraitScale])

  const backdropStyle = useMemo<CssVars>(() => {
    return {
      ...(cardStyle.backdropOpacity != null ? { '--asset-base-opacity': cardStyle.backdropOpacity / 100 } : {}),
      ...(cardStyle.backdropBlur != null
        ? { '--asset-base-filter': `blur(${((cardStyle.backdropBlur / 100) * 20).toFixed(1)}px) saturate(1.3)` }
        : {}),
      ...(resolvedBackdrop ? { backgroundImage: `url("${resolvedBackdrop}")` } : {}),
      ...(cardStyle.backdropScale != null ? { backgroundSize: `${cardStyle.backdropScale * 3}%` } : {}),
      ...(cardStyle.backdropX != null || cardStyle.backdropY != null
        ? { backgroundPosition: `${cardStyle.backdropX ?? 50}% ${cardStyle.backdropY ?? 28}%` }
        : {}),
    }
  }, [
    cardStyle.backdropOpacity,
    cardStyle.backdropBlur,
    resolvedBackdrop,
    cardStyle.backdropScale,
    cardStyle.backdropX,
    cardStyle.backdropY,
  ])
  const captureBuildCard = useCallback(async (action: 'download' | 'clipboard') => {
    const card = buildCardRef.current
    if (!card || !isShowcase || captureAction) return

    setCaptureAction(action)
    try {
      const png = renderBuildCardPng(card)
      if (action === 'clipboard') {
        await copyBuildCard(png)
        showToast({ content: 'Build card copied to clipboard.', variant: 'success' })
      } else {
        downloadBuildCard(await png, railModel.seed?.name ?? 'build')
        showToast({ content: 'Build card captured.', variant: 'success' })
      }
    } catch (error) {
      showToast({
        content: error instanceof Error ? error.message : 'Build card capture failed.',
        variant: 'error',
      })
    } finally {
      setCaptureAction(null)
    }
  }, [captureAction, isShowcase, railModel.seed?.name, showToast])
  const incomingRailModel = useMemo(() => buildRailModel(actResId, {
    actResId,
    runtime,
    partRtsById,
    initRtsById: partRtsById,
  }), [actResId, partRtsById, runtime])
  const incomingRailAssetUrls = useMemo(() => {
    return [
      incomingRailModel.portraitSrc,
      incomingRailModel.attrIcon,
      incomingRailModel.weaponIcon,
      ...incomingRailModel.sonataSets.map((set) => set.icon),
      ...incomingRailModel.teamSupports.flatMap((mate) => [
        getAttributeIconSrc(mate.attribute),
        mate.weaponIcon,
        mate.sprite,
        ...mate.sets.map((set) => set.icon),
      ]),
    ].filter((url): url is string => Boolean(url))
  }, [incomingRailModel])

  useEffect(() => {
    railScenarioIdRef.current = railScenarioId
  }, [railScenarioId])

  useEffect(() => {
    if (selectedScenarioId === railScenarioIdRef.current) {
      return undefined
    }

    let canceled = false

    const commitRail = () => {
      if (canceled) return
      railScenarioIdRef.current = selectedScenarioId
      setRailScenarioId(selectedScenarioId)
      setRailPhase('in')
    }

    if (typeof window === 'undefined') {
      commitRail()
      return undefined
    }

    const phaseHandle = window.setTimeout(() => {
      setRailPhase('out')
    }, 0)
    const exitHandle = window.setTimeout(() => {
      void preloadEvaluationRailImages(incomingRailAssetUrls).then(commitRail)
    }, EVALUATION_RAIL_EXIT_MS)

    return () => {
      canceled = true
      window.clearTimeout(phaseHandle)
      window.clearTimeout(exitHandle)
    }
  }, [incomingRailAssetUrls, selectedScenarioId])

  useEffect(() => {
    if (railPhase !== 'in' || typeof window === 'undefined') {
      return undefined
    }
    const handle = window.setTimeout(() => {
      setRailPhase('idle')
    }, EVALUATION_RAIL_ENTER_MS)
    return () => window.clearTimeout(handle)
  }, [railPhase, railScenarioId])

  const maskVars = useMemo<CssVars>(() => ({
    ...(cardStyle.maskTop != null ? { '--mask-top': `${cardStyle.maskTop}%` } : {}),
    ...(cardStyle.maskRight != null ? { '--mask-right': `${cardStyle.maskRight}%` } : {}),
    ...(cardStyle.maskBottom != null ? { '--mask-bottom': `${cardStyle.maskBottom}%` } : {}),
    ...(cardStyle.maskLeft != null ? { '--mask-left': `${cardStyle.maskLeft}%` } : {}),
    ...(cardStyle.maskTopSharp != null ? { '--mask-top-sharp': cardStyle.maskTopSharp / 100 } : {}),
    ...(cardStyle.maskRightSharp != null ? { '--mask-right-sharp': cardStyle.maskRightSharp / 100 } : {}),
    ...(cardStyle.maskBottomSharp != null ? { '--mask-bottom-sharp': cardStyle.maskBottomSharp / 100 } : {}),
    ...(cardStyle.maskLeftSharp != null ? { '--mask-left-sharp': cardStyle.maskLeftSharp / 100 } : {}),
  }), [
    cardStyle.maskTop, cardStyle.maskRight, cardStyle.maskBottom, cardStyle.maskLeft,
    cardStyle.maskTopSharp, cardStyle.maskRightSharp, cardStyle.maskBottomSharp, cardStyle.maskLeftSharp,
  ])

  // Convert semantic text-role overrides into the CSS-variable contract.
  const textSlotVars = useMemo(() => buildTextSlotVars(cardStyle.textSlots ?? {}), [cardStyle.textSlots])

  // Hoist at-rules that are invalid inside @scope and scope the remaining declarations.
  const customCssParts = useMemo(
    () => (cardStyle.customCss ? splitHoistedCss(cardStyle.customCss) : null),
    [cardStyle.customCss],
  )
  const scopedCustomCss = useMemo(
    () => isShowcase && customCssParts
      ? `${customCssParts.hoisted}\n@scope (.workspace-rail-wrapper, .workspace-rail) to (.workspace-tune) {\n${customCssParts.scoped}\n}`
      : null,
    [customCssParts, isShowcase],
  )
  const railStyle = useMemo<CssVars>(() => ({
    '--resonator-accent': isShowcase ? cardStyle.accent ?? railModel.accent : railModel.accent,
    ...(isShowcase && cardStyle.surface ? { '--bg': cardStyle.surface } : {}),
    ...(isShowcase && cardStyle.text ? { '--text': cardStyle.text } : {}),
    ...(isShowcase && (cardStyle.surface != null || cardStyle.opacity != null)
      ? {
          '--rail-glass': `color-mix(in srgb, var(--bg) ${cardStyle.opacity ?? 82}%, transparent)`,
          '--rail-glass-2': `color-mix(in srgb, var(--bg) ${Math.round((cardStyle.opacity ?? 82) * 0.67)}%, transparent)`,
        }
      : {}),
    ...(isShowcase && cardStyle.displayFont ? { '--display-font': cardStyle.displayFont } : {}),
    ...(isShowcase && cardStyle.monoFont ? { '--mono-font': cardStyle.monoFont } : {}),
    ...maskVars,
    ...(isShowcase ? textSlotVars : {}),
  }), [
    cardStyle.accent,
    cardStyle.displayFont,
    cardStyle.monoFont,
    cardStyle.opacity,
    cardStyle.surface,
    cardStyle.text,
    isShowcase,
    maskVars,
    railModel.accent,
    textSlotVars,
  ])

  // Persisted font stacks require their external family stylesheets to be rehydrated.
  useEffect(() => {
    if (!isShowcase) return
    const families = collectCardFontFamilies({
      displayFont: cardStyle.displayFont,
      monoFont: cardStyle.monoFont,
      textSlots: cardStyle.textSlots ?? {},
    })
    for (const family of families) ensureGoogleFamily(family)
  }, [isShowcase, cardStyle.displayFont, cardStyle.monoFont, cardStyle.textSlots])

  const evaluationBanner = !isShowcase && isNarrow ? (
    <NarrowEvaluationBanner
      portraitSrc={railModel.portraitSrc}
      spriteCss={railModel.spriteCss}
      backdropSrc={resolvedBackdrop ?? railModel.portraitSrc}
    />
  ) : null

  return (
    <>
      <div className="simulation-stage">
      <div className={`simulation-workspace${isOptimizer ? ' opt-lab' : ''}${isSuggestions ? ' sgl-lab' : ''}`} style={{ '--resonator-accent': accent, '--grade': tone } as CssVars}>
        {!isShowcase && error ? <div className="workspace-notice workspace-notice--error">{error.message}</div> : null}

        {runtime ? (
          <ContextTrigger
            asChild
            ariaLabel="Build Lab stage actions"
            items={stageContextItems}
          >
            <BuildWorkspaceBoard
              ref={boardRef}
              page={page}
              data-css-expanded={isShowcase && cssExpanded ? 'true' : undefined}
            >
            {isShowcase && cssExpanded ? (
              <ShowcaseCssEditorDock
                value={cardStyle.customCss ?? ''}
                isDark={isDarkTheme}
                onChange={(value) => {
                  if (railResId) patchShowcaseCardStyle(railResId, { customCss: value || null })
                }}
                onClose={() => {
                  setCssExpanded(false)
                  setTuneDrawerOpen(false)
                }}
              />
            ) : null}
            <BuildWorkspaceWorkspace>
              <BuildWorkspaceRailSlot>
                <BuildRail
                  buildCardRef={buildCardRef}
                  isShowcase={isShowcase}
                  customCss={scopedCustomCss}
                  railPhase={railPhase}
                  editMode={editMode}
                  railResId={railResId}
                  scenarioId={railScenarioId}
                  railModel={railModel}
                  cardHidden={cardHidden}
                  railStyle={railStyle}
                  backdropStyle={backdropStyle}
                  statsColumn={cardStyle.statsColumn ?? 'build'}
                  portraitCredit={cardStyle.portraitCredit}
                  backdropCredit={cardStyle.backdropCredit}
                  resolvedPortrait={resolvedPortrait}
                  animatedPortraits={animatedPortraits && !pauseRailPortrait}
                  onAnimatedPortraitsChange={pauseRailPortrait ? undefined : setAnimatedPortraits}
                  editable
                  onRuntimeUpdate={updateRailRuntime}
                  surfacePhase={surfacePhase}
                  showcasePlacement={showcasePlacement}
                  score={score}
                  grade={grade}
                  tone={tone}
                  showcaseBuild={showcaseBuild}
                  showcaseAvgDamage={showcaseAvgDamage}
                  onEchoOpen={openEchoSlot}
                  echoSelection={echoSelection}
                  autoImageContrast={cardStyle.text == null}
                  layout={showcaseLayout}
                />
                <RailDock
                  anchorRef={buildCardRef}
                  resId={dockResId}
                  runtime={dockRuntime}
                  scenarioId={railScenarioId}
                  page={page}
                  accent={dockAccent}
                  onRuntimeUpdate={updateRailRuntime}
                />
                {isShowcase && (
                  <ShowcaseCustomizePanel
                    key={tuneResetKey}
                    layout={showcaseLayout}
                    onLayoutChange={setShowcaseLayout}
                    accent={cardStyle.accent ?? railModel.accent}
                    surface={cardStyle.surface ?? '#0c111a'}
                    text={cardStyle.text ?? '#eef2f7'}
                    cardOpacity={cardStyle.opacity ?? 82}
                    portraitX={cardStyle.portraitX ?? 50}
                    portraitY={cardStyle.portraitY ?? 50}
                    portraitScale={cardStyle.portraitScale ?? 50}
                    maskTop={cardStyle.maskTop ?? 0}
                    maskRight={cardStyle.maskRight ?? 0}
                    maskBottom={cardStyle.maskBottom ?? 45}
                    maskLeft={cardStyle.maskLeft ?? 0}
                    maskTopSharp={cardStyle.maskTopSharp ?? 0}
                    maskRightSharp={cardStyle.maskRightSharp ?? 0}
                    maskBottomSharp={cardStyle.maskBottomSharp ?? 0}
                    maskLeftSharp={cardStyle.maskLeftSharp ?? 0}
                    portraitImage={resolvedPortrait}
                    backdropImage={resolvedBackdrop}
                    backdropX={cardStyle.backdropX ?? 50}
                    backdropY={cardStyle.backdropY ?? 28}
                    backdropScale={cardStyle.backdropScale ?? 50}
                    backdropBlur={cardStyle.backdropBlur ?? 30}
                    backdropOpacity={cardStyle.backdropOpacity ?? 67}
                    statsColumn={cardStyle.statsColumn ?? 'build'}
                    portraitCredit={cardStyle.portraitCredit ?? ''}
                    backdropCredit={cardStyle.backdropCredit ?? ''}
                    textSlots={cardStyle.textSlots ?? {}}
                    customCss={cardStyle.customCss ?? ''}
                    editMode={editMode}
                    onEdit={(group) => setEditMode((prev) => (prev === group ? null : group))}
                    hidden={cardHidden}
                    onToggleHidden={(key) => {
                      if (railResId) toggleShowcaseHide(railResId, key)
                    }}
                    onStyleChange={(patch) => {
                      if (railResId) patchShowcaseCardStyle(railResId, patch)
                    }}
                    onPickImage={handlePickImage}
                    onResetGroup={handleResetGroup}
                    onReset={() => {
                      if (railResId) resetShowcaseCard(railResId)
                      setEditMode(null)
                      setTuneResetKey((key) => key + 1)
                    }}
                    onCapture={captureBuildCard}
                    captureAction={captureAction}
                    capturing={captureAction != null || surfacePhase !== 'idle'}
                    onExport={handleExportTarget}
                    onImportFile={handleImportFile}
                    docked={cssExpanded}
                    drawerOpen={tuneDrawerOpen}
                    onToggleDrawer={() => setTuneDrawerOpen((open) => !open)}
                    onExpandCss={() => {
                      setCssExpanded((on) => !on)
                      setTuneDrawerOpen(false)
                    }}
                    surfacePhase={surfacePhase}
                  />
                )}
                {isShowcase && (
                  <ImageUploadModal
                    state={uploadModal.dialogProps}
                    title={uploadTarget === 'portrait' ? 'Portrait image' : 'Backdrop image'}
                    initialCredit={(uploadTarget === 'portrait' ? cardStyle.portraitCredit : cardStyle.backdropCredit) ?? ''}
                    onClose={uploadModal.hide}
                    onApply={handleApplyImage}
                  />
                )}
              </BuildWorkspaceRailSlot>

              {isOptimizer ? (
                <Suspense fallback={(
                  <AppLdrVrly
                    mode="centered" className="app-loader-fallback--route"
                    text="Loading optimizer..."
                  />
                )}>
                  <EmbeddedOptimizer variant="embedded" />
                </Suspense>
              ) : null}

              {isSuggestions ? (
                <Suspense fallback={(
                  <AppLdrVrly
                    mode="centered" className="app-loader-fallback--route"
                    text="Loading suggestions..."
                  />
                )}>
                  <EmbeddedSuggestions />
                </Suspense>
              ) : null}

              {!isOptimizer && !isSuggestions && !isShowcase ? (
                <ModulationReport
                  phase={surfacePhase}
                  modulation={isModulation}
                  modulationRuntime={modulationRuntime}
                  modulationActRt={railRuntime}
                  modulationScenario={railScenario}
                  modulationRoster={modulationRoster}
                  modulationMemberId={modulationMemberId}
                  onModulationMember={setModulationMemberId}
                  modulationDark={isDarkTheme}
                  onModulationUpdate={updateModulationRuntime}
                  loading={loading || !reportMatchesRail}
                  report={visibleReport}
                  activeBuild={activeBuild}
                  referenceBuild={referenceBuild}
                  maximumBuild={maximumBuild}
                  score={score}
                  grade={grade}
                  tone={tone}
                  banner={evaluationBanner}
                  detailBuildKey={detailBuildKey}
                  setDetailBuildKey={setDetailBuildKey}
                  mainStackRef={mainStackRef}
                  stateGroups={reportStateGroups}
                  reportRuntime={evaluationRuntime}
                  reportRuntimesById={reportRuntimesById}
                  enemyId={evaluationEnemy.id}
                  echoSelection={echoSelection}
                  echoActions={echoActions}
                  echoScores={echoScores}
                  loadoutSlots={loadoutSlots}
                  sourceEchoes={echoLoadout}
                  onEchoOpen={openEchoSlot}
                  overviewStatsTree={overviewStatsTree}
                  echoRuntime={echoRuntime}
                  echoResonatorName={echoSeed?.name}
                  echoEditable
                  canSaveEcho={canSaveEcho}
                  onEchoLoadout={setEchoLoadout}
                />
              ) : null}
            </BuildWorkspaceWorkspace>
            </BuildWorkspaceBoard>
          </ContextTrigger>
        ) : null}
      </div>
      </div>
      <ConfirmHost control={confirmation} portalTarget={portalTarget} />
    </>
  )
}
