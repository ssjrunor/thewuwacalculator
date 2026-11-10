/*
  Author: Runor Ewhro
  description: orchestrates the shared roster, rail, evaluation, and profile
               behavior for modulation, optimizer, showcase, and the temporary
               legacy evaluation view.
*/

import { EvaluationSummaryContext } from '@/modules/simulation/model/evaluationSummaryContext'
import { useEvaluationSummary } from '@/modules/simulation/model/useBuildEvaluation'
import { Suspense, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BuildWorkspacePresentation } from './BuildWorkspacePresentation'
import { useShowcaseAnalysis } from '@/modules/simulation/surfaces/showcase/useShowcaseAnalysis'
import type { ShowcaseAnalysisInput } from '@/engine/evaluation/showcaseAnalysis'
import { computeShowcaseStats } from '@/engine/evaluation/showcaseStats'
import { useAppStore } from '@/application/state'
import { useInventoryUiStore } from '@/application/state/inventoryUiStore'
import { useOptimizerRunStore } from '@/application/state/optimizerRunStore'
import {
  selActResId,
  selWorkDrvd,
} from '@/application/state'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { getResonator, type ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import type { WorkspaceSurface } from '@/shared/lib/appRoutes'
import {
  flattenScenarioRouting,
  projectScenarioUiRuntimes,
} from '@/engine/runtime/scenarioRuntime.ts'
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { useEchoSrfcM } from '@/modules/simulation/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { parseEchoClip, pasteEchoes, readEchoClip, type EchoClipPayload } from '@/modules/simulation/features/echoes/lib/clipboard.ts'
import { qpEchoAtSlot } from '@/modules/simulation/features/echoes/lib/equip.ts'
import { openEchoCnsl } from '@/modules/simulation/features/echoes/lib/echoConsoleStore.ts'

import { ATTR_COLORS } from '@/modules/simulation/model/display'
import {
  FULL_EVALUATION_REPORT_OPTIONS,
  MODULATION_SUMMARY_REPORT_OPTIONS,
  useEvaluationReport,
  useSuggestionsRailScore,
} from '@/modules/simulation/model/useBuildEvaluation.ts'
import { useEvaluationTarget } from '@/modules/simulation/model/useEvaluationTarget.ts'
import { useStableEvaluationInputs } from '@/modules/simulation/model/useStableEvaluationInputs.ts'
import {
  applyEvaluationAsm,
  applyEvaluationMapAsm,
  makeEvaluationEnemy,
} from '@/engine/evaluation/evaluationAssumptions.ts'
import { getTuneStrainMaxForTeam } from '@/engine/gameData/tuneStrain.ts'
import {
  getBuildEvaluationGrade,
  getBuildEvaluationTone,
} from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { makeStatsView } from '@/modules/simulation/model/statsView.ts'
import { getMaxEchoSc } from '@/engine/evaluation/echoScoring.ts'
import { makeEvaluationKey } from '@/engine/evaluation/buildEvaluationKey.ts'
import { peekEvaluationReport } from '@/engine/evaluation/buildEvaluationClient.ts'
import { useEchoScores } from '@/application/hooks/useEchoScoringRevision.ts'
import { getBuildStats } from '@/engine/pipeline/buildStats.ts'
import { mkPrepWork, type PrepWork } from '@/engine/pipeline/preparedWorkspace.ts'
import { selLiveRun } from '@/modules/simulation/model/selectors.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { scheduleAfterSettled } from '@/shared/lib/scheduleAfterSettled.ts'
import {
  cacheEchoMainStatScoringFromEvaluation,
  prepareEchoMainStatScoring,
} from '@/engine/evaluation/echoMainStatProfile.ts'
import { resResBaseSt } from '@/data/catalog/resonatorSeedService.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { isDtblVntTgt } from '@/shared/lib/isEditableEventTarget.ts'
import { lastWorkspaceClipboardText } from '@/shared/lib/workspaceClipboardCache.ts'
import { useImportLanding } from '@/modules/simulation/features/echoes/lib/importLanding.ts'
import { useConfirm } from '@/shared/hooks/useConfirmation.ts'
import { mainPortal } from '@/shared/lib/portalTarget'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal'
import type { EvaluationBuildSnapshot } from '@/engine/evaluation/buildEvaluation.ts'
import { Clipboard, Copy } from 'lucide-react'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import {
  EVALUATION_RAIL_ENTER_MS, EVALUATION_RAIL_EXIT_MS,
  type EvaluationEchoSelection, type CssVars,
  buildSonataPlan,
  preloadEvaluationRailImages, scheduleEvaluationTargetWork,
} from '@/modules/simulation/workspace/ui.tsx'

import {
  type Entry as RosterEntry,
} from '@/modules/simulation/workspace/roster/List.tsx'
import { type BuildRailModel } from '@/modules/simulation/workspace/BuildRail.tsx'
import { makeRailModel as buildRailModel } from '@/modules/simulation/workspace/railModel.ts'
import { makeEntries } from '@/modules/simulation/workspace/roster/model.ts'
import { useResonatorProfileOps } from '@/modules/simulation/workspace/useResonatorProfileOps.ts'
import { parseProfClip, readProfClip } from '@/modules/simulation/workspace/profileClipboard.ts'
import { ModulationReport } from '@/modules/simulation/surfaces/modulation/ModulationReport.tsx'
import type { MemberAnalysisSource } from '@/modules/simulation/surfaces/modulation/lib/memberSim.ts'
import { ScoreWarning } from '@/modules/simulation/workspace/ScoreWarning.tsx'
import { getEvaluationStageCtx } from '@/modules/simulation/workspace/context.tsx'
import { makeEchoSlot } from '@/modules/simulation/workspace/echoSlot.ts'
import { useWorkspaceEchoActions } from '@/modules/simulation/workspace/useWorkspaceEchoActions.ts'
import { optimizerPane, suggestionsPane } from '@/modules/simulation/shell/surfaceChunks.ts'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'

const EMPTY_ECHO_LOADOUT: Array<EchoInstance | null> = []
const EMPTY_RUNTIME_MAP: Record<string, ResRuntime> = Object.freeze({})
const EMPTY_TARGETS: Record<string, string | null> = Object.freeze({})
function reportSourceIdentity(
  selectedScenarioId: string,
  targetScenarioId: string,
  memberId: string | null,
  runtime: ResRuntime | null,
  runtimesById: Record<string, ResRuntime>,
  targetSelections: Record<string, string | null>,
): string | null {
  return runtime ? makeEvaluationKey({
    selectedScenarioId, targetScenarioId, memberId,
    runtime, runtimesById, targetSelections,
  }) : null
}
// start report construction after the 460ms drawer transition. its worker and
// lazy module work then run after the animation.
const REPORT_ASIDE_WORK_DELAY_MS = 500

const EmbeddedOptimizer = optimizerPane.Mount
const EmbeddedSuggestions = suggestionsPane.Mount
function useSettledLiveRun(work: PrepWork | null, ownerKey: string): {
  simulation: SimResult | null
  ready: boolean
} {
  const [completed, setCompleted] = useState<{
    ownerKey: string
    work: PrepWork
    simulation: SimResult | null
  } | null>(null)

  /* eslint-disable react-hooks/set-state-in-effect -- releases a different member's result at the idle-work boundary. */
  useEffect(() => {
    setCompleted((previous) => work && previous?.ownerKey === ownerKey ? previous : null)
    if (!work) return undefined
    return scheduleAfterSettled(() => {
      setCompleted({ ownerKey, work, simulation: selLiveRun(work) })
    })
  }, [ownerKey, work])
  /* eslint-enable react-hooks/set-state-in-effect */

  return {
    simulation: completed?.ownerKey === ownerKey ? completed.simulation : null,
    ready: Boolean(work && completed?.ownerKey === ownerKey && completed.work === work),
  }
}

export function BuildWorkspaceSurface({ page }: { page: WorkspaceSurface }) {
  const showToast = useTstStr((state) => state.show)
  const confirmation = useConfirm()
  const portalTarget = mainPortal()
  const [reportOpen, setReportOpen] = useState(false)
  const [reportWorkReady, setReportWorkReady] = useState(false)
  const reportWorkTimer = useRef<number | null>(null)
  const clearReportWorkTimer = useCallback(() => {
    if (reportWorkTimer.current == null) return
    window.clearTimeout(reportWorkTimer.current)
    reportWorkTimer.current = null
  }, [])
  const closeEvaluationReport = useCallback(() => {
    clearReportWorkTimer()
    setReportWorkReady(false)
    setReportOpen(false)
  }, [clearReportWorkTimer])
  const openEvaluationReport = useCallback(() => {
    clearReportWorkTimer()
    setReportWorkReady(false)
    setReportOpen(true)

    const reduceMotion = document.documentElement.classList.contains('reduce-animation')
      || document.documentElement.classList.contains('no-entrance-anim')
    if (reduceMotion) {
      setReportWorkReady(true)
      return
    }

    reportWorkTimer.current = window.setTimeout(() => {
      reportWorkTimer.current = null
      setReportWorkReady(true)
    }, REPORT_ASIDE_WORK_DELAY_MS)
  }, [clearReportWorkTimer])
  const actResId = useAppStore(selActResId)
  const scenarioLibrary = useAppStore((state) => state.combat)
  const themeMode = useAppStore((state) => state.ui.theme)
  const backgroundTextMode = useAppStore((state) => state.ui.backgroundTextMode)
  const isDarkTheme = themeMode === 'background' ? backgroundTextMode === 'dark' : themeMode === 'dark'
  const animatedPortraits = useAppStore((state) => state.ui.preferences.animatedRailPortraits)
  const optimizerRunning = useOptimizerRunStore((state) => state.status === 'running')
  const inventoryOpen = useInventoryUiStore((state) => state.open)
  const { prepWork, actRt: runtime, partRtsById, actTgtSels } = useAppStore(selWorkDrvd)
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

  const analysisActive = !inventoryOpen
  const [captureAction, setCaptureAction] = useState<'download' | 'clipboard' | null>(null)

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
  const railScenarioIdRef = useRef(selectedScenarioId)
  const boardRef = useRef<HTMLDivElement | null>(null)

  // derive route context actions from the same canonical roster model used by chrome.
  const roster = useMemo<RosterEntry[]>(
    () => makeEntries(scenarioLibrary),
    [scenarioLibrary],
  )
  const rosterOps = useResonatorProfileOps(roster, confirmation)

  const railSeed = railResId ? seedRsntById[railResId] ?? null : null

  // modulation member inspection is local and does not mutate shared profile selection.
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
  const railTargets = useMemo(
    () => railScenarioId === selectedScenarioId
      ? actTgtSels
      : railScenario ? flattenScenarioRouting(railScenario) : {},
    [actTgtSels, railScenario, railScenarioId, selectedScenarioId],
  )
  const selectedMemberId = scenarioLibrary.scenariosById[selectedScenarioId]?.team.members
    .find((member) => member.resonatorId === railRuntime?.id)?.id ?? null
  const railSourceKey = useMemo(() => reportSourceIdentity(
    selectedScenarioId, railScenarioId, selectedMemberId,
    railRuntime, railPartRtsById, railTargets,
  ), [
    railPartRtsById, railRuntime, railScenarioId, railTargets,
    selectedMemberId, selectedScenarioId,
  ])
  const cachedRailReport = analysisActive && !isShowcase && !isOptimizer && !isSuggestions && railSourceKey
    ? peekEvaluationReport(railSourceKey, MODULATION_SUMMARY_REPORT_OPTIONS)
    : undefined

  useLayoutEffect(() => {
    if (reportTargetScenarioId === railScenarioId) return undefined
    if (cachedRailReport !== undefined) {
      // an exact recent result satisfies the target change without restarting the worker.
      setReportTargetScenarioId(railScenarioId)
      return undefined
    }
    if (railPhase !== 'idle') return undefined
    return scheduleEvaluationTargetWork(() => {
      startTransition(() => setReportTargetScenarioId(railScenarioId))
    })
  }, [cachedRailReport, railPhase, railScenarioId, reportTargetScenarioId])

  useEffect(() => {
    setModulationMemberId(null)
  }, [railScenarioId])

  // resolve a pending member only after the requested scenario context becomes
  // active. the same resonator may belong to multiple scenario teams.
  const seatAsk = useImportLanding((state) => state.seatAsk)
  useEffect(() => {
    if (!isModulation || !seatAsk || railResId !== seatAsk.contextId) return
    if (!modulationRoster.some((mate) => mate.id === seatAsk.memberId)) return
    setModulationMemberId(seatAsk.memberId)
    useImportLanding.getState().takeSeat()
  }, [isModulation, modulationRoster, railResId, seatAsk])

  useEffect(() => {
    useImportLanding.getState().setSeat(isModulation && railResId && modulationMemberId
      ? { contextId: railResId, memberId: modulationMemberId }
      : null)
  }, [isModulation, modulationMemberId, railResId])
  useEffect(() => () => useImportLanding.getState().setSeat(null), [])

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
  // showcase selects its displayed member immediately; deferred report selection
  // must not hold back the stat sheet or its independent damage request.
  const reportRuntime = isShowcase ? railRuntime : reportProjection?.subjectRuntime ?? null
  const reportParticipants = isShowcase ? railPartRtsById : reportProjection?.runtimesById ?? EMPTY_RUNTIME_MAP
  const reportTargetResId = reportRuntime?.id ?? null
  const nextEvaluationInputs = useMemo(() => ({
    runtime: reportRuntime ? applyEvaluationAsm(reportRuntime) : null,
    runtimesById: applyEvaluationMapAsm(reportParticipants),
    targetSelections: isShowcase ? railTargets : reportTargetScenarioId === selectedScenarioId
      ? actTgtSels
      : reportScenario ? flattenScenarioRouting(reportScenario) : {},
  }), [
    actTgtSels,
    isShowcase,
    railTargets,
    reportParticipants,
    reportRuntime,
    reportScenario,
    reportTargetScenarioId,
    selectedScenarioId,
  ])
  // live enemy and progression writes replace the scenario projection even
  // though evaluation policy ignores the enemy and maxes progression. preserve
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
  // hash the source state, before deferred simulation, to retrieve a report
  // from an unchanged prior visit. the worker's full payload key still guards
  // every cold run and refresh.
  const reportMemberId = scenarioLibrary.scenariosById[selectedScenarioId]?.team.members
    .find((member) => member.resonatorId === reportRuntime?.id)?.id ?? null
  const reportSourceKey = useMemo(() => (
    reportTargetScenarioId === railScenarioId
    && reportRuntime === railRuntime
    && reportParticipants === railPartRtsById
    && reportTargets === railTargets
      ? railSourceKey
      : reportSourceIdentity(
        selectedScenarioId, reportTargetScenarioId, reportMemberId,
        reportRuntime, reportParticipants, reportTargets,
      )
  ), [
    railPartRtsById, railRuntime, railScenarioId, railSourceKey, railTargets,
    reportMemberId, reportParticipants, reportRuntime, reportTargetScenarioId,
    reportTargets, selectedScenarioId,
  ])
  const cachedCurrentReport = reportSourceKey === railSourceKey
    ? cachedRailReport
    : analysisActive && !isShowcase && !isOptimizer && !isSuggestions && reportSourceKey
      ? peekEvaluationReport(reportSourceKey, MODULATION_SUMMARY_REPORT_OPTIONS)
      : undefined
  const needsReportSimulation = cachedCurrentReport === undefined || (isModulation && reportOpen)
  const reportCalculationEnabled = analysisActive
    && !isShowcase && !isSuggestions && !isOptimizer && needsReportSimulation
  const showcaseStats = useMemo(() => isShowcase && evaluationRuntime
    ? computeShowcaseStats({ runtime: evaluationRuntime, runtimesById: evaluationReportRuntimesById, enemy: evaluationEnemy, selectedTargets: reportTargets })
    : null, [evaluationEnemy, evaluationReportRuntimesById, evaluationRuntime, isShowcase, reportTargets])
  const reportTarget = useEvaluationTarget({
    targetRuntime: reportCalculationEnabled ? evaluationRuntime : null,
    targetSeed: reportCalculationEnabled ? reportSeed : null,
    targetSelections: isSuggestions ? EMPTY_TARGETS : reportTargets,
    // evaluation scoring uses normalized runtime and enemy assumptions.
    baseRuntimesById: isSuggestions ? EMPTY_RUNTIME_MAP : evaluationReportRuntimesById,
    enemy: evaluationEnemy,
    deferHeavyWork: reportCalculationEnabled,
  })
  const showcaseInput = useMemo<ShowcaseAnalysisInput | null>(() => {
    if (!isShowcase || !evaluationRuntime || !railRuntime || !railScenario) return null
    const member = railScenario.team.members.find((entry) => entry.resonatorId === railRuntime.id)
    if (!member) return null
    const graph = railScenarioId === selectedScenarioId ? prepWork.combatGraph : null
    const participants = graph ? Object.values(graph.participants) : []
    return {
      scenarioId: railScenario.id, memberId: member.id,
      evaluation: { runtime: evaluationRuntime, runtimesById: evaluationReportRuntimesById, enemy: evaluationEnemy, selectedTargets: reportTargets },
      live: { runtime: railRuntime, runtimesById: railPartRtsById, enemy: railScenario.target, selectedTargets: railTargets,
        graph: graph ? {
          memberIdByResonatorId: Object.fromEntries(participants.map((entry) => [entry.resonatorId, entry.memberId])),
          targetsByRes: Object.fromEntries(participants.map((entry) => [entry.resonatorId, entry.slot.routing.selectedTargetsByOwnerKey])),
          environmentBuffsByMemberId: graph.environmentBuffsByMemberId,
          environmentTargetModifiers: graph.environmentTargetModifiers,
        } : undefined,
      },
      setConds: member.local.setConditionals,
    }
  }, [evaluationEnemy, evaluationReportRuntimesById, evaluationRuntime, isShowcase, railPartRtsById, railRuntime, railScenario, railScenarioId, railTargets, reportTargets, prepWork.combatGraph, selectedScenarioId])
  const showcaseAnalysis = useShowcaseAnalysis(showcaseInput, analysisActive)
  const reportRuntimesById = reportTarget.runtimesById
  const simulation = reportTarget.simulation
  const echoRuntime = isModulation ? modulationRuntime ?? railRuntime : railRuntime
  const echoSeed = (isModulation && echoRuntime ? seedRsntById[echoRuntime.id] ?? null : null)
    ?? railSeed
  const echoLoadout = echoRuntime?.build.echoes ?? EMPTY_ECHO_LOADOUT
  const echoScoringWork = useMemo(() => {
    if (isShowcase || !echoRuntime || !echoSeed || !railScenario) return null
    if (echoRuntime.id === railRuntime?.id && railScenarioId === selectedScenarioId) {
      return prepWork
    }
    return mkPrepWork({
      revision: railScenario.revision,
      runtime: echoRuntime,
      seed: echoSeed,
      enemy: railScenario.target,
      prtcRntmById: railPartRtsById,
      activeTarget: railTargets,
      combatGraph: railScenarioId === selectedScenarioId ? prepWork.combatGraph : null,
    })
  }, [
    isShowcase,
    echoRuntime,
    echoSeed,
    prepWork,
    railPartRtsById,
    railRuntime?.id,
    railScenario,
    railScenarioId,
    railTargets,
    selectedScenarioId,
  ])
  const { simulation: echoScoringSimulation, ready: echoScoringSimulationReady } =
    useSettledLiveRun(echoScoringWork, `${railScenarioId}:${echoRuntime?.id ?? ''}`)
  const modulationAnalysisSource = useMemo<MemberAnalysisSource | null>(() => (
    railScenario && railRuntime
      ? {
          scenario: railScenario,
          subjectRuntime: railRuntime,
          runtimesById: railPartRtsById,
          selectedTargets: railTargets,
          workspace: echoScoringWork,
          simulation: echoScoringSimulation,
        }
      : null
  ), [
    echoScoringSimulation,
    echoScoringWork,
    railPartRtsById,
    railRuntime,
    railScenario,
    railTargets,
  ])

  const loadoutSlots = useMemo(
    () => echoLoadout.map((echo) => (echo ? makeEchoSlot(echo) : null)),
    [echoLoadout],
  )
  // a resonator with no substat weights has nothing to score against, so the
  // slots fall back to the crit value they rolled
  const echoScores = useEchoScores(isShowcase ? null : echoRuntime?.id, echoLoadout)
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
  // loadout actions use the same member runtime as individual echo slots.
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
  const pasteEchoAt = useCallback((slotIndex: number, payload: EchoClipPayload) => {
    if (!echoRuntime) return
    const result = pasteEchoes(echoLoadout, payload, slotIndex)
    if (result.pastedCount > 0) setEchoLoadout(result.nextEchoes)
    showToast({
      content: result.pastedCount === 0
        ? 'Nothing valid to paste here.'
        : result.skippedCount > 0
          ? `Pasted ${result.pastedCount} echo${result.pastedCount === 1 ? '' : 'es'} (${result.skippedCount} skipped).`
          : `Pasted ${result.pastedCount} echo${result.pastedCount === 1 ? '' : 'es'}.`,
      variant: result.pastedCount === 0 ? 'warning' : 'success',
      duration: result.pastedCount === 0 ? 3200 : 2400,
    })
  }, [echoLoadout, echoRuntime, setEchoLoadout, showToast])
  const pasteWorkspaceItem = useCallback(async (slotIndex?: number, pastedText?: string) => {
    // a stage paste can receive either workspace clipboard type. read the text
    // once so both parsers inspect the same system clipboard value.
    let raw: string | null = pastedText ?? null
    if (raw == null) {
      try {
        raw = await navigator.clipboard?.readText() ?? null
      } catch { /* fall back to the same-session clipboard caches below. */ }
    }
    raw ??= lastWorkspaceClipboardText()

    const profile = raw == null ? await readProfClip() : parseProfClip(raw)
    if (profile) {
      await rosterOps.paste(profile)
      return
    }

    const echo = raw == null ? await readEchoClip() : parseEchoClip(raw)
    if (echo && echoRuntime) {
      const firstEmpty = echoLoadout.findIndex((entry) => entry == null)
      pasteEchoAt(slotIndex ?? (firstEmpty >= 0 ? firstEmpty : 0), echo)
      return
    }

    showToast({
      content: 'Clipboard does not contain an Echo or resonator profile for this workspace.',
      variant: 'warning',
      duration: 3200,
    })
  }, [echoLoadout, echoRuntime, pasteEchoAt, rosterOps, showToast])
  const stageContextItems = useMemo(() => getEvaluationStageCtx({
    onPaste: () => { void pasteWorkspaceItem() },
  }), [pasteWorkspaceItem])
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isDtblVntTgt(event.target) || inventoryOpen
        || document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) {
        return
      }

      const raw = event.clipboardData?.getData('text/plain') ?? ''
      if (!raw || (!parseProfClip(raw) && !parseEchoClip(raw))) return
      event.preventDefault()
      void pasteWorkspaceItem(undefined, raw)
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [inventoryOpen, pasteWorkspaceItem])
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
  }, {
    id: 'evaluation-echo:paste',
    key: 'paste' as const,
    icon: <Clipboard size="1em" />,
    label: 'Paste',
    title: 'Paste a workspace item (Ctrl/Cmd+V)',
    float: false,
    run: async ({ ids }: { ids: string[] }) => {
      const selectedSlot = ids.length > 0 ? Number(ids[0]?.split(':').at(-1)) : null
      const firstEmpty = echoLoadout.findIndex((echo) => echo == null)
      await pasteWorkspaceItem(selectedSlot != null && Number.isInteger(selectedSlot)
        ? selectedSlot : firstEmpty >= 0 ? firstEmpty : 0)
    },
  }], [copyEchoesToClipboard, echoLoadout, pasteWorkspaceItem, showToast])
  const evaluationEchoSelection = useSel({
    surfaceId: `evaluation:${echoRuntime?.id ?? 'unknown'}:echoes`,
    ariaLabel: 'Evaluation echo selection actions',
    noun: { one: 'echo', many: 'echoes' },
    items: evaluationEchoItems,
    acts: evaluationEchoActions,
    active: captureAction == null,
  })
  const focusEvaluationEchoSurface = evaluationEchoSelection.focusSurface
  const addEvaluationEchoToSelection = evaluationEchoSelection.addToSelection
  const evaluationEchoSelectionMode = evaluationEchoSelection.selectionMode
  const getEvaluationSelectionItems = evaluationEchoSelection.contextItemsFor
  const getEvaluationEchoId = useCallback(
    (slotIndex: number) => `evaluation:${echoRuntime?.id ?? 'unknown'}:echo:${slotIndex}`,
    [echoRuntime?.id],
  )
  const getEvaluationEchoItems = useCallback((itemId: string, echo: EchoInstance) => (
    evaluationEchoSelectionMode ? getEvaluationSelectionItems(itemId) : [...buildReadOnlyMenu({
      id: itemId,
      echo,
      onSelect: () => {
        focusEvaluationEchoSurface()
        addEvaluationEchoToSelection(itemId)
      },
    }), {
      id: `${itemId}:paste`,
      label: 'Paste',
      icon: <Clipboard size="1em" />,
      onSelect: () => { void pasteWorkspaceItem(Number(itemId.split(':').at(-1))) },
    }]
  ), [addEvaluationEchoToSelection, buildReadOnlyMenu, evaluationEchoSelectionMode, focusEvaluationEchoSurface, getEvaluationSelectionItems, pasteWorkspaceItem])
  const getEmptyEvaluationEchoItems = useCallback((slotIndex: number) => evaluationEchoSelectionMode ? getEvaluationSelectionItems() : [{
    id: `evaluation-echo:empty:${slotIndex}:paste`,
    label: 'Paste',
    icon: <Clipboard size="1em" />,
    onSelect: () => { void pasteWorkspaceItem(slotIndex) },
  }], [evaluationEchoSelectionMode, getEvaluationSelectionItems, pasteWorkspaceItem])
  const echoSelection = useMemo<EvaluationEchoSelection>(() => ({
    selectionMode: evaluationEchoSelection.selectionMode,
    isSelected: evaluationEchoSelection.isSelected,
    buildClickCapture: evaluationEchoSelection.buildClickCapture,
    getId: getEvaluationEchoId,
    getItems: getEvaluationEchoItems,
    getEmptyItems: getEmptyEvaluationEchoItems,
    surfaceProps: evaluationEchoSelection.surfaceProps,
  }), [
    evaluationEchoSelection.buildClickCapture,
    evaluationEchoSelection.isSelected,
    evaluationEchoSelection.selectionMode,
    evaluationEchoSelection.surfaceProps,
    getEvaluationEchoId,
    getEvaluationEchoItems,
    getEmptyEvaluationEchoItems,
  ])

  const echoActions = useWorkspaceEchoActions({
    resonatorId: echoRuntime?.id,
    echoLoadout,
    editable: true,
    canSaveEcho,
    onEchoLoadoutChange: setEchoLoadout,
  })

  const { report, error } = useEvaluationReport({
    runtime: evaluationRuntime,
    simulation,
    enemy: evaluationEnemy,
    runtimesById: reportRuntimesById,
    enabled: analysisActive && !isShowcase && !isSuggestions && !isOptimizer,
    clearOnDisable: isShowcase || isSuggestions || isOptimizer,
    identityKey: reportTargetScenarioId,
    sourceKey: reportSourceKey,
    reportOptions: MODULATION_SUMMARY_REPORT_OPTIONS,
  })

  const { report: detailReport, loading: detailReportLoading } = useEvaluationReport({
    runtime: evaluationRuntime,
    simulation,
    enemy: evaluationEnemy,
    runtimesById: reportRuntimesById,
    enabled: analysisActive && isModulation && reportOpen && reportWorkReady,
    identityKey: reportTargetScenarioId,
    reportOptions: FULL_EVALUATION_REPORT_OPTIONS,
    cacheResult: false,
    clearOnDisable: true,
  })
  const optimizerSummary = useEvaluationSummary({
    runtime: evaluationRuntime, enemy: evaluationEnemy,
    runtimesById: evaluationReportRuntimesById,
    identityKey: reportTargetScenarioId,
    enabled: analysisActive && isOptimizer,
  })
  const suggestionsPercent = useSuggestionsRailScore({
    runtime: evaluationRuntime,
    enemy: evaluationEnemy,
    runtimesById: evaluationReportRuntimesById,
    identityKey: reportTargetScenarioId,
    enabled: analysisActive && isSuggestions,
  })

  useEffect(() => {
    closeEvaluationReport()
  }, [closeEvaluationReport, reportTargetScenarioId, evaluationRuntime?.id])

  useEffect(() => {
    if (inventoryOpen) closeEvaluationReport()
  }, [closeEvaluationReport, inventoryOpen])

  useEffect(() => clearReportWorkTimer, [clearReportWorkTimer])

  useEffect(() => {
    if (!analysisActive || !echoScoringSimulationReady || !echoRuntime || !echoSeed || !railScenario || !echoScoringSimulation) {
      return undefined
    }
    const member = railScenario.team.members.find((entry) => entry.resonatorId === echoRuntime.id)
    if (!member) return undefined

    const input = {
      scenarioId: railScenario.id,
      memberId: member.id,
      runtime: echoRuntime,
      seed: echoSeed,
      enemy: railScenario.target,
      runtimesById: railPartRtsById,
      selectedTargets: railTargets,
      setConds: member.local.setConditionals,
      simulation: echoScoringSimulation,
    }
    const reportMatchesEcho = reportTargetScenarioId === railScenarioId
      && evaluationRuntime?.id === echoRuntime.id

    if (reportMatchesEcho) {
      if (!report || cacheEchoMainStatScoringFromEvaluation(input, report)) {
        return undefined
      }
    }

    const timer = window.setTimeout(() => {
      void prepareEchoMainStatScoring(input).catch((nextError) => {
        console.error('Failed to prepare Echo main-stat scoring.', nextError)
      })
    }, 320)

    return () => window.clearTimeout(timer)
  }, [
    analysisActive,
    echoScoringSimulationReady,
    echoRuntime,
    echoScoringSimulation,
    echoSeed,
    evaluationRuntime?.id,
    railPartRtsById,
    railScenario,
    railScenarioId,
    railTargets,
    report,
    reportTargetScenarioId,
  ])

  const accent = railSeed ? ATTR_COLORS[railSeed.attribute] ?? '#6b7cff' : '#6b7cff'
  const dockResId = isModulation ? modulationMemberId : railResId
  const dockRuntime = isModulation ? modulationRuntime : railRuntime
  const dockMember = isModulation
    ? modulationRoster.find((member) => member.id === modulationMemberId) ?? null
    : null
  const dockAccent = dockMember ? ATTR_COLORS[dockMember.attribute] ?? accent : accent
  const reportMatchesRail = reportTargetScenarioId === railScenarioId
  // keep completed readings visible while this scenario is being reevaluated.
  // a cache hit retains the same report; a fresh result replaces it together.
  const visibleReport = reportMatchesRail ? report : null
  const score = isShowcase ? (showcaseAnalysis?.percent != null ? showcaseAnalysis.percent * 100 : null)
    : isOptimizer ? (optimizerSummary?.percent != null && reportMatchesRail ? optimizerSummary.percent * 100 : null)
    : isSuggestions ? (suggestionsPercent != null && reportMatchesRail ? suggestionsPercent * 100 : null)
      : visibleReport ? visibleReport.evaluation.percent * 100 : null
  const showcaseAvgDamage = isShowcase
    ? showcaseAnalysis?.userDamage ?? null
    : null
  const grade = getBuildEvaluationGrade(score)
  const tone = score != null ? getBuildEvaluationTone(score).color : accent

  const activeBuild: EvaluationBuildSnapshot | null = visibleReport?.evaluation.builds.active ?? null
  const referenceBuild: EvaluationBuildSnapshot | null = visibleReport?.evaluation.builds.referenceBuild ?? null
  const maximumBuild: EvaluationBuildSnapshot | null = visibleReport?.evaluation.builds.maximumBuild ?? null

  const showcaseBuild = useMemo(() => {
    if (!isShowcase || !railRuntime) return null
    const buildSeed = seedRsntById[railRuntime.id] ?? null
    const buildStats = buildSeed ? getBuildStats(railRuntime, resResBaseSt(buildSeed, railRuntime.base.level)) : null
    const buildStatsView = buildStats ? makeStatsView(railRuntime, buildStats) : null
    const finalStats = isShowcase ? showcaseStats : simulation?.finalStats
    const combatStatsView =
      evaluationRuntime?.id === railRuntime.id && finalStats
        ? makeStatsView(evaluationRuntime, finalStats)
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
  }, [evaluationRuntime, isShowcase, railRuntime, showcaseStats, simulation])

  const railModel = useMemo<BuildRailModel>(() => buildRailModel(railResId, {
    actResId: railResId,
    runtime: railRuntime,
    partRtsById: railPartRtsById,
    initRtsById: railPartRtsById,
  }), [railPartRtsById, railResId, railRuntime])

  const incomingRailModel = useMemo(() => buildRailModel(actResId, {
    actResId,
    runtime,
    partRtsById,
    initRtsById: partRtsById,
  }), [actResId, partRtsById, runtime])
  const incomingRailAssetUrls = useMemo(() => {
    return [
      { src: incomingRailModel.portraitSrc, selector: '.wk-portrait-img' },
      { src: incomingRailModel.attrIcon, selector: '.wk-portrait-elem, .showcase-detail-id-attr' },
      { src: incomingRailModel.weaponIcon, selector: '.wk-weapon-icon, .showcase-detail-bloom-gun' },
    ].filter((asset): asset is { src: string; selector: string } => Boolean(asset.src))
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
      const assets = incomingRailAssetUrls.map(({ src, selector }) => ({
        src, width: boardRef.current?.querySelector(selector)?.getBoundingClientRect().width ?? 0,
      }))
      void preloadEvaluationRailImages(assets).then(commitRail)
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

  return (
    <>
      <ScoreWarning active={score != null} />
      <div className="simulation-stage">
      <div className={`simulation-workspace${isOptimizer ? ' opt-lab' : ''}${isSuggestions ? ' sgl-lab' : ''}`} style={{ '--resonator-accent': accent, '--grade': tone } as CssVars}>
        {!isShowcase && error ? <div className="wk-notice wk-notice--error">{error.message}</div> : null}

        {runtime ? (
            <BuildWorkspacePresentation
              boardRef={boardRef} page={page} isDarkTheme={isDarkTheme}
              stageContextItems={stageContextItems} onCaptureChange={setCaptureAction}
              railProps={{ isShowcase, railPhase, railResId, scenarioId: railScenarioId, railModel,
                animatedPortraits: animatedPortraits && !pauseRailPortrait,
                onAnimatedPortraitsChange: pauseRailPortrait ? undefined : setAnimatedPortraits,
                editable: true, onRuntimeUpdate: updateRailRuntime,
                score, grade, tone, showcaseBuild, showcaseAvgDamage,
                onEchoOpen: openEchoSlot, echoSelection,
              }}
              dockProps={{ resId: dockResId, runtime: dockRuntime, scenarioId: railScenarioId, page, accent: dockAccent, onRuntimeUpdate: updateRailRuntime }}
            >

              {isOptimizer ? (
                <Suspense fallback={(
                  <AppLdrVrly
                    mode="centered" className="app-loader-fallback--route"
                    text="Loading optimizer..."
                  />
                )}>
                  <EvaluationSummaryContext value={optimizerSummary}><EmbeddedOptimizer /></EvaluationSummaryContext>
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
                  modulationRuntime={modulationRuntime}
                  modulationActRt={railRuntime}
                  modulationAnalysisSource={modulationAnalysisSource}
                  modulationRoster={modulationRoster}
                  modulationMemberId={modulationMemberId}
                  onModulationMember={setModulationMemberId}
                  modulationDark={isDarkTheme}
                  onModulationUpdate={updateModulationRuntime}
                  report={visibleReport}
                  detailReport={reportWorkReady ? detailReport : null}
                  detailReportReady={reportWorkReady}
                  detailReportLoading={detailReportLoading}
                  reportOpen={reportOpen}
                  onReportOpen={openEvaluationReport}
                  onReportClose={closeEvaluationReport}
                  activeBuild={activeBuild}
                  referenceBuild={referenceBuild}
                  maximumBuild={maximumBuild}
                  score={score}
                  grade={grade}
                  tone={tone}
                  reportRuntime={evaluationRuntime}
                  echoSelection={echoSelection}
                  echoActions={echoActions}
                  echoScores={echoScores}
                  loadoutSlots={loadoutSlots}
                  sourceEchoes={echoLoadout}
                  onEchoOpen={openEchoSlot}
                  echoRuntime={echoRuntime}
                  echoScenarioId={railScenarioId}
                  echoResonatorName={echoSeed?.name}
                  echoEditable
                  canSaveEcho={canSaveEcho}
                  onEchoLoadout={setEchoLoadout}
                />
              ) : null}
            </BuildWorkspacePresentation>
        ) : null}
      </div>
      </div>
      <ConfirmHost control={confirmation} portalTarget={portalTarget} />
    </>
  )
}
