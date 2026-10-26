/*
  Author: Runor Ewhro
  description: coordinates advanced rotation drafts, execution, inspection,
               comparison, history, clipboard, and saved-rotation workflows.
*/

import '@/styles/surfaces/rotation/program.css'
import '@/styles/surfaces/rotation/flat-list.css'
import '@/styles/surfaces/rotation/saved.css'
import '@/styles/surfaces/rotation/console.css'
import {
  type CSSProperties,
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronDown, ClipboardPaste, Copy, CopyPlus, FolderOpen, ListPlus, MessageSquarePlus, Pencil, Play, RotateCwSquare, Save, Scissors, Settings, Share2, SquareDashedMousePointer, Trash2 } from 'lucide-react'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger'
import {useTstStr} from '@/shared/util/toastStore.ts'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay.tsx'
import {useAppStore} from '@/application/state'
import {selEnemyProf, selWorkDrvd} from '@/application/state'
import { useSavedRotationsLease } from '@/application/hooks/useSavedRotationsLease.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { openTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { openWpnCnsl } from '@/modules/simulation/features/weapons/lib/weaponConsoleStore.ts'
import type {RotationNode} from '@/domain/gameData/contracts.ts'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import {
  editableRotMembers,
  makeConditionChoices,
  makeFeatureMeta,
  visibleRotMembers,
} from '@/modules/simulation/surfaces/rotation/shared/catalog.ts'
import {
  displayedRunMs,
  getRunFlatRows,
  type RunResult,
  withRunMetadata,
} from '@/modules/simulation/surfaces/rotation/program-editor/simulation/runProgram.ts'
import {NodeList, useNodeDrag,} from '@/modules/simulation/surfaces/rotation/program-editor/components/NodeList.tsx'
import {
  countFlatSelectedEntries,
  flatClipboardNodes as collectFlatClipboardNodes,
  flatTargetMatchesRuns,
  resolveFlatRowTarget,
  type FlatRow,
  type FlatRowTarget,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/flatRows.ts'
import type { PaletteSpec } from '@/modules/simulation/surfaces/rotation/program-editor/model/paletteSpec.ts'
import {
  type BlockActions,
  type BuildActions,
  type ConditionActions,
  type HandoffActions,
  Inspector,
  RotationTotalsPanel,
  type SelectionActions,
  type SelectionSummary,
  type StepActions,
} from '@/modules/simulation/surfaces/rotation/program-editor/components/InspectPanels.tsx'
import {Palette, type PaletteFeature} from '@/modules/simulation/surfaces/rotation/program-editor/components/Palette.tsx'
import type { SavedListPanel } from '@/modules/simulation/surfaces/rotation/program-editor/components/SavedList.tsx'
import {
  CMP_MAX,
  formatDuration,
  formatSavedTime,
  formatSavedFigure,
  makeSavedEntries,
  groupSavedEntries,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/savedRotationList.ts'
import { RotationProgramToolbar } from '@/modules/simulation/surfaces/rotation/program-editor/components/ProgramToolbar.tsx'
import { ReadInspector } from '@/modules/simulation/surfaces/rotation/program-editor/components/ReadInspector.tsx'
import { useCompareMount } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/compareRack.ts'
import { useColumnCeiling } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/useColumnCeiling'
import {
  editColumnSelection,
  fitColumnSelection,
  resizeColumnSelection,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/columnSelection'
import { resolveReadNode, type ReadNode } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/readNode.ts'
import { placeLeader } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/leaderPlacement.ts'
import type {
  RotationDamageBasis,
  RotationEditorPreferences,
} from '@/domain/entities/rotationEditorPreferences.ts'
import type {SearchNames} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/nodeSearch.ts'
import {getEchoById} from '@/data/catalog/echoCatalogService.ts'
import {StartMemberModal} from '@/modules/simulation/surfaces/rotation/program-editor/components/StartMemberModal.tsx'
import {ConfigModal} from '@/modules/simulation/surfaces/rotation/program-editor/components/ConfigModal.tsx'
import {
  type DamageDecimals,
  formatDamage,
  loopBodyItems,
  offTuneAuthoringStates,
  statCeiling,
  type PercentDisplay,
  type RegisterGroup,
  type StatKey,
  stepCount,
  stepDamageAt,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'
import {
  appendInto,
  attachFeature,
  canLiftNode,
  cloneNode,
  collectSubtrees,
  countNodes,
  detachFeature,
  type DropEdge,
  attachNote,
  addBlockSetup,
  removeBlockSetup,
  detachNote,
  duplicateNodes,
  findEnclosingLoop,
  findNode,
  insertBeside,
  insertNode,
  makeEmptyContainer,
  makeEmptyNote,
  makeStep,
  mapLoopBlocks,
  mapNode,
  moveInto,
  moveIntoMany,
  collectHeldIds,
  relocateNode,
  relocateNodes,
  removeLoopEnd,
  removeNode,
  removeSubtrees,
  setAttachedMultiplier,
  setBlockExtent,
  setBlockValue,
  setBlockUptime,
  setCondAction,
  setCondValue,
  setHandoffTo,
  offTuneResumeScope,
  setOffTuneResume,
  setStepMultiplier,
  unwrapLoop,
  updateStep,
  wrapNode,
  wrapNodes,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/treeEdit.ts'
import {
  applyRotationCleanup,
  describeRotationCleanup,
  planRotationCleanup,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/cleanup.ts'
import {
  checkinAllLoopPasses,
  checkoutAllLoopPasses,
  checkoutLoopPassById,
  isCheckoutableLoop,
  removeFromCheckedOutPass,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/passCheckout.ts'
import {
  type BuffLine,
  type EditorBlock,
  type EditorCondition,
  type EditorExecutionScope,
  type EditorHandoff,
  type EditorMember,
  type EditorNode,
  type EditorNote,
  type EditorSection,
  type EditorStep,
  isEditorBlock,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { makeConsoleModel } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/consoleModel.ts'
import type {
  CondChoice,
  ConditionEditorState,
  FeatureAttachmentState,
  FeatureMenuState,
  SkillMenuEntry,
} from '@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts'
import {RotationSkillMenu} from '@/modules/simulation/surfaces/rotation/shared/RotationSkillMenu.tsx'
import {Condition} from '@/modules/simulation/surfaces/rotation/program-editor/components/AuthoringModals.tsx'
import {getSubHitLbl, EMPTY_FEATURE_CONDS} from '@/modules/simulation/surfaces/rotation/shared/nodeTools.ts'
import { skillDisplayColor } from '@/modules/simulation/surfaces/rotation/shared/skillDisplay.ts'
import {
  isFormulaChoice,
  makeCondChange,
  makeCondValue,
} from '@/modules/simulation/surfaces/rotation/shared/conditions.ts'
import { attachedConditionChanges } from '@/domain/gameData/rotationAttached.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'
import { rotationBodiesEqual } from '@/domain/gameData/loopPasses.ts'
import {findRotNode} from '@/domain/gameData/rotationTree.ts'
import {useAppModalValue} from '@/shared/ui/useAppModal.ts'
import {useConfirm} from '@/shared/hooks/useConfirmation.ts'
import {makeAppendSource, appendRotationCopies, type AppendSource,} from '@/modules/simulation/surfaces/rotation/program-editor/model/append.ts'
import {mainPortal} from '@/shared/lib/portalTarget.ts'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal.tsx'
import type {MenuEntry} from '@/shared/ui/CtxMenu.tsx'
import {makeAddToSelectionMenu, makeSelectedNodesMenu, makeSelectionMenu, makeRowMenu,} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/contextMenus.tsx'
import {
  applyConditionChanges,
  applyFeatureConditionChanges,
  applyFeatureSelection,
  attachedWritesOf,
  buildPreambleEntries,
  openingStates,
  makeConditionNode,
  makeFeatureNode,
  makePaletteNode,
  removeAttachedWrite,
  setAttachedWriteAction,
  setAttachedWriteValue,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/nodeAuthoring.ts'
import {
  seedCondValueFor,
  standingCondValue,
  type CondAnchor,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/priorState.ts'
import {
  editedRotationItems,
  pendingSavedRotationDetails,
  prepareSavedRotationBatch,
  projectAppendedRotation,
  runEditedRotation,
  runPreparedSavedRotationBatch,
  runSavedRotationDetailBatch,
  runStoredRotation,
  savedRotationSummary,
  type SavedRotationComparisonResult,
} from '@/modules/simulation/surfaces/rotation/program-editor/simulation/simulation.ts'
import {
  blockAverageDamage,
  blockRunTotals as getBlockRunTotals,
  collectSectionSteps,
  isDisabledInTree,
  peakDamageForRun,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/nodeMetrics.ts'
import { buildBuffLines } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/nodeInspection.ts'
import {
  clampLoopRunSelections,
  collectLoopColors,
  editorLoopId,
  findNodeExecutionScope,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/executionScope.ts'
import {
  findFeatureOccurrences,
  prepareRotationNodeNavigation,
  type RotationNodeRevealRequest,
  type RotationNodeTarget,
} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/nodeNavigation.ts'
import {
  buildEditorSelectionModel,
  buildFlatEditorSelectionModel,
  carryFoldId,
  collectEditorVisualFoldIds,
} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/selection.ts'
import {type SelAct, useSel,} from '@/modules/simulation/lib/sel.tsx'
import {
  captureRotationEditSnapshot,
  commitRotationEdit,
  emptyRotationEditHistory,
  redoRotationEdit,
  refreshRotationHistoryCursor,
  restoreRotationEditSnapshot,
  rotationEditRanAt,
  rotationEditHistoryCursor,
  rotationNodeSignatures,
  rotationSimulationKey,
  rotationStaleNodeIds,
  undoRotationEdit,
} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/history.ts'
import {
  getRotationEditorSession,
  useRotationEditorSession,
} from '@/modules/simulation/surfaces/rotation/program-editor/state/editorSessionStore.ts'
import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import { useExpandableCollection } from '@/shared/ui/Expandable.tsx'
import { useImportSurface } from '@/modules/simulation/shell/imports/ImportSurface.tsx'
import { useLoadRotation, type RotationLoadMode } from '@/modules/simulation/surfaces/rotation/program-editor/saved/useLoadRotation.ts'
import { RotationShareModal } from '@/modules/simulation/surfaces/rotation/program-editor/components/ShareModal.tsx'
import { SavedRotationEditModal } from '@/modules/simulation/surfaces/rotation/program-editor/components/SavedRotationEditModal.tsx'
import {
  cloneRotationNodes,
  type SavedRotation,
} from '@/domain/entities/inventoryStorage.ts'
import { makeSourceKey } from '@/data/gameData/registry.ts'
import {
  isLiveRotEntId,
  makeLiveRotationEntry,
} from '@/engine/runtime/liveRotationEntry.ts'
import { editorNodesToRotation } from '@/modules/simulation/surfaces/rotation/program-editor/model/toRotationNodes.ts'
import { splitEditorSections } from '@/modules/simulation/surfaces/rotation/program-editor/model/sections.ts'
import { normLoopRuns } from '@/domain/gameData/rotationLoops.ts'
import {
  makeSavedRotClip,
  readRotClip,
  ROT_CLIP_KIND,
  ROT_CLIP_VER,
  type RotClipPayload,
  writeRotClip,
} from '@/modules/simulation/surfaces/rotation/shared/rotationClipboard.ts'

const ENTRANCE_MS = 1100
const INITIAL_EDITOR_CLOSED_IDS = ['preamble'] as const

function toggleComparedId(current: string[], id: string): string[] {
  if (current.includes(id)) {
    return current.filter((other) => other !== id)
  }
  return current.length >= CMP_MAX - 1 ? current : [...current, id]
}

const ROLL_MS = 420

const SELECTION_KEEP = [
  '.rte-rows',
  '.rsl',
  '.rsl-lead',
  '.rte-inspector',
  '[data-selection-keep]',
  '[role="dialog"]',
  '[role="menu"]',
  '.app-modal-panel',
].join(', ')

/** plural labels used for aggregate node counts. */
const SELECTION_KIND_LABELS: Record<EditorNode['type'], string> = {
  step: 'Steps',
  condition: 'States',
  swap: 'Swaps',
  loop: 'Loops',
  repeat: 'Repeats',
  uptime: 'Uptimes',
  setup: 'Setups',
  note: 'Notes',
}

type NodeListView = 'tree' | 'flat'
type EditorPane = 'nodes' | 'read' | 'totals' | null
const FlatList = lazy(async () => ({
  default: (await import('@/modules/simulation/surfaces/rotation/program-editor/components/FlatList.tsx')).FlatList,
}))
const SavedList = lazy(async () => ({
  default: (await import('@/modules/simulation/surfaces/rotation/program-editor/components/SavedList.tsx')).SavedList,
}))
const RotationConsole = lazy(async () => ({
  default: (await import('@/modules/simulation/surfaces/rotation/program-editor/components/RotationConsole.tsx')).RotationConsole,
}))

const EMPTY_SAVED_COMPARISONS: ReadonlyMap<string, SavedRotationComparisonResult | null> = new Map()
const EMPTY_SAVED_RUNS: ReadonlyMap<string, RunResult | null> = new Map()
const EMPTY_FLAT_ROWS: readonly FlatRow[] = []
const NO_STALE_NODES: ReadonlySet<string> = new Set()
const EMPTY_DAMAGE_TOTALS = { normal: 0, crit: 0, avg: 0 } as const
const EMPTY_SUPPORT_TOTALS = { healing: 0, shield: 0 } as const

function paneForView(view: NodeListView, pane: EditorPane): EditorPane {
  if (view === 'flat' && pane === 'nodes') return 'read'
  if (view === 'tree' && pane === 'totals') return 'read'
  return pane
}

function defaultRotationNodeTarget(
  result: RunResult | null,
  view: NodeListView,
): RotationNodeTarget | null {
  if (!result) return null
  if (view === 'flat') return getRunFlatRows(result)[0]?.target ?? null
  const firstId = buildEditorSelectionModel(result.sections, new Set()).availableIds[0]
  return firstId ? { nodeId: firstId } : null
}

export function ProgramEditor() {
  const showToast = useTstStr((state) => state.show)
  const registerRouteHistoryScope = useRtChrmMen().actions.registerHistoryScope
  const editorPreferences = useAppStore((state) => state.ui.rotationEditorPreferences)
  const setEditorPreferences = useAppStore((state) => state.setRotEditorPrefs)
  const { prepWork, actRt, partRtsById, actTgtSels } = useAppStore(selWorkDrvd)
  const invRttn = useAppStore((state) => state.library.rotations)
  const svdRotPrefs = useAppStore((state) => state.ui.savedRotationPreferences)
  const addInvRot = useAppStore((state) => state.addInvRot)
  const updInvRot = useAppStore((state) => state.updInvRot)
  const rmInvRot = useAppStore((state) => state.rmInvRot)
  const persistRotationProgram = useAppStore((state) => state.persistRotationProgram)
  const scenario = useAppStore((state) => selectedCombatScenario(state.combat))
  const buildActions = useMemo<BuildActions>(() => ({
    onResonator: (memberId) => openTeamCnsl(memberId, 'loadout', scenario.id),
    onEchoes: (memberId) => openTeamCnsl(memberId, 'echoes', scenario.id),
    onWeapon: (memberId) => openWpnCnsl(memberId, scenario.id),
  }), [scenario.id])
  const setRotPrefs = useAppStore((state) => state.setRotPrefs)
  const enemyProfile = useAppStore(selEnemyProf)
  const featMenuMdl = useAppModalValue<FeatureMenuState>()
  const condDtrMdl = useAppModalValue<ConditionEditorState>()
  const featCondDtrMdl = useAppModalValue<FeatureAttachmentState>()
  const preambleMdl = useAppModalValue<Record<string, never>>()
  const configMdl = useAppModalValue<Record<string, never>>()
  const shareMdl = useAppModalValue<
    { kind: 'saved'; entryId: string }
    | { kind: 'live'; entry: SavedRotation }
  >()
  const savedEditMdl = useAppModalValue<
    { kind: 'create' }
    | { kind: 'edit'; entryId: string }
  >()
  const { openImport } = useImportSurface()
  const loadRotation = useLoadRotation()
  const loadingSavedRef = useRef(false)
  const confirmation = useConfirm()

  const rotMembers = useMemo(
    () => (actRt ? visibleRotMembers(actRt, partRtsById) : []),
    [actRt, partRtsById],
  )
  const editableMembers = useMemo(
    () => (actRt ? editableRotMembers(rotMembers) : []),
    [actRt, rotMembers],
  )
  const condChoices = useMemo(
    () => (actRt ? makeConditionChoices(rotMembers, actRt, enemyProfile.id) : []),
    [actRt, enemyProfile.id, rotMembers],
  )
  const featMetaById = useMemo(
    () => makeFeatureMeta(rotMembers),
    [rotMembers],
  )
  const view: NodeListView = editorPreferences.view
  const damageBasis: RotationDamageBasis = editorPreferences.damageBasis
  const storedRotationItems = useMemo(
    () => actRt?.rotation.program ?? [],
    [actRt],
  )
  /*
    each owner keeps an independent session draft. runtime changes reconcile
    the last execution result without replacing authored nodes, dirty state,
    execution time, or edit history.
  */
  const sessionOwnerId = actRt?.id ?? '__rotation-editor-empty__'
  const editorSession = useRotationEditorSession(sessionOwnerId, prepWork, () => {
    const initialResult = runStoredRotation({
      runtime: actRt,
      runtimesById: partRtsById,
      targetSelections: actTgtSels,
      enemy: enemyProfile,
      members: rotMembers,
      prepWork,
    })
    const defaultTarget = defaultRotationNodeTarget(initialResult, view)
    const initialRuns = clampLoopRunSelections(initialResult?.sections ?? [], {
      ...defaultTarget?.loopRuns,
    })
    const initialSections = initialResult
      ? checkoutAllLoopPasses(initialResult.sections, initialRuns)
      : []
    const baselineItems = cloneRotationNodes(storedRotationItems)
    const initialKey = rotationSimulationKey(initialSections, baselineItems)

    return {
      result: initialResult,
      sections: initialSections,
      runsByLoopId: initialRuns,
      lastRanAt: initialResult?.ranAt ?? null,
      editHistory: emptyRotationEditHistory(),
      baselineItems,
      runBaselineKey: initialKey,
      runBaselineSigs: rotationNodeSignatures(initialSections, baselineItems),
      simulationKey: initialKey,
      runInputIdentity: prepWork,
    }
  }, (current) => {
    const nextResult = runStoredRotation({
      runtime: actRt,
      runtimesById: partRtsById,
      targetSelections: actTgtSels,
      enemy: enemyProfile,
      members: rotMembers,
      prepWork,
      items: current.baselineItems,
    })
    if (!nextResult) {
      return { ...current, result: null, runInputIdentity: prepWork }
    }

    // recalculation is not another authored run: retain its original date and
    // keep dirty/share gating exactly where the user's last run left it.
    const refreshedResult = withRunMetadata(nextResult, {
      ranAt: current.result?.ranAt ?? nextResult.ranAt,
    })
    const normalizedBaseline = splitEditorSections(current.baselineItems)
      .flatMap((section) => section.items)
    const currentItems = editedRotationItems(actRt, current.sections)

    /*
      a draft that still matches its execution baseline can accept the fully
      reprojected tree. diverged drafts retain authored nodes and history while
      only their execution result is refreshed.
    */
    if (!rotationBodiesEqual(currentItems, normalizedBaseline)) {
      return {
        ...current,
        result: refreshedResult,
        runInputIdentity: prepWork,
      }
    }

    const nextRuns = clampLoopRunSelections(refreshedResult.sections, current.runsByLoopId)
    const nextSections = checkoutAllLoopPasses(refreshedResult.sections, nextRuns)
    const snapshot = captureRotationEditSnapshot(
      nextSections,
      nextRuns,
      current.simulationKey,
      current.lastRanAt,
    )
    return {
      ...current,
      result: refreshedResult,
      sections: nextSections,
      runsByLoopId: nextRuns,
      editHistory: refreshRotationHistoryCursor(current.editHistory, snapshot),
      runInputIdentity: prepWork,
    }
  })
  const {
    result,
    sections,
    runsByLoopId,
    lastRanAt,
    editHistory,
    baselineItems: baselineRotationItems,
    runBaselineKey,
    runBaselineSigs,
    simulationKey,
    updateSession: updateEditorSession,
  } = editorSession
  const runtimeMs = displayedRunMs(result)

  const members = useMemo(() => result?.members ?? [], [result])

  const [consoleOpen, setConsoleOpen] = useState(false)
  const {
    closedIds: shutIds,
    setOpen: setEditorFoldOpen,
    toggle: toggleShut,
    collapseAll: collapseEditorFolds,
    expandAll: expandEditorFolds,
    expand: expandEditorFold,
    replaceClosed: replaceEditorClosed,
  } = useExpandableCollection<string>(INITIAL_EDITOR_CLOSED_IDS)
  const [storedSelectedId, setSelectedId] = useState<string | null>(
    () => defaultRotationNodeTarget(result, view)?.nodeId ?? null,
  )

  const savedView = editorPreferences.savedView
  const [savedSelId, setSavedSelId] = useState<string | null>(null)
  const {
    closedIds: savedShutGroupIds,
    setOpen: setSavedGroupOpen,
    collapseAll: collapseSavedGroupsById,
    expandAll: expandSavedGroupsById,
  } = useExpandableCollection<string>()
  const [savedQuery, setSavedQuery] = useState('')
  const deferredSavedQuery = useDeferredValue(savedQuery)
  const [savedPane, setSavedPane] = useState<SavedListPanel>('list')
  const [savedBatch, setSavedBatch] = useState<{
    key: string | null
    runs: ReadonlyMap<string, SavedRotationComparisonResult | null>
  }>(() => ({ key: null, runs: EMPTY_SAVED_COMPARISONS }))
  const [savedDetails, setSavedDetails] = useState<{
    key: string | null
    runs: ReadonlyMap<string, RunResult | null>
  }>({ key: null, runs: EMPTY_SAVED_RUNS })
  /** compared entry ids in selection order; the anchor is stored separately. */
  const [compareIds, setCompareIds] = useState<string[]>([])

  const [compareMode, setCompareMode] = useState(false)

  const [nodeCmpIds, setNodeCmpIds] = useState<string[]>([])
  const [nodeCmpMode, setNodeCmpMode] = useState(false)
  const showSavedRotationList = savedView !== 'off'
  useSavedRotationsLease(showSavedRotationList)

  const [drawnSaved, setDrawnSaved] = useState(showSavedRotationList)
  const [leaving, setLeaving] = useState<boolean | null>(null)
  const savedBatchPlan = useMemo(
    () => prepareSavedRotationBatch(invRttn),
    [invRttn],
  )
  const savedBatchKey = savedBatchPlan.key
  const selectedSavedEntry = useMemo(
    () => invRttn.find((entry) => entry.id === savedSelId) ?? null,
    [invRttn, savedSelId],
  )
  /** one detail batch supplies all consumers that need exact execution data. */
  const savedDetailIds = useMemo(() => {
    const ids = new Set(compareIds)
    if ((savedPane === 'read' || consoleOpen) && selectedSavedEntry) {
      ids.add(selectedSavedEntry.id)
    }
    return [...ids]
  }, [compareIds, consoleOpen, savedPane, selectedSavedEntry])
  useEffect(() => {
    const wanted = new Set(savedDetailIds)
    let canceled = false
    queueMicrotask(() => {
      if (canceled) return
      setSavedDetails((current) => {
        if (current.key !== savedBatchKey) return current
        const kept = new Map([...current.runs].filter(([id]) => wanted.has(id)))
        return kept.size === current.runs.size ? current : { ...current, runs: kept }
      })
    })
    return () => { canceled = true }
  }, [savedBatchKey, savedDetailIds])
  const savedRunsById = savedBatch.key === savedBatchKey
    ? savedBatch.runs
    : EMPTY_SAVED_COMPARISONS
  /*
    detail results are cached by saved entry and batch identity. selection
    changes reuse completed deterministic simulations.
  */
  const savedDetailRuns = savedDetails.key === savedBatchKey
    ? savedDetails.runs
    : EMPTY_SAVED_RUNS
  const selectedSavedRun = useMemo(
    () => selectedSavedEntry
      ? savedDetailRuns.get(selectedSavedEntry.id) ?? null
      : null,
    [savedDetailRuns, selectedSavedEntry],
  )
  /** exact node projections are limited to selected comparisons. */
  const compareRuns = useMemo(
    () => new Map(compareIds.map((id) => [id, savedDetailRuns.get(id) ?? null])),
    [compareIds, savedDetailRuns],
  )
  const savedSummariesById = useMemo(() => {
    const summaries = new Map<string, ReturnType<typeof savedRotationSummary>>()
    for (const [entryId, run] of savedRunsById) {
      if (run) summaries.set(entryId, savedRotationSummary(run, damageBasis))
    }
    return summaries
  }, [damageBasis, savedRunsById])
  const selectedSavedSummary = selectedSavedEntry
    ? savedSummariesById.get(selectedSavedEntry.id) ?? null
    : null
  const selectedSavedRate = useMemo(() => {
    if (!selectedSavedEntry) return null
    const avg = selectedSavedSummary?.total.avg ?? 0
    if (selectedSavedEntry.duration <= 0 || avg <= 0) {
      return `Saved ${formatSavedTime(selectedSavedEntry.updatedAt)}`
    }
    const dps = avg / selectedSavedEntry.duration
    return `${formatDuration(selectedSavedEntry.duration)} · ${formatSavedFigure(dps, editorPreferences.decimals)} DPS`
  }, [editorPreferences.decimals, selectedSavedEntry, selectedSavedSummary])
  const sharedRotationEntry = useMemo(() => {
    const target = shareMdl.value
    if (!target) return null
    return target.kind === 'live'
      ? target.entry
      : invRttn.find((entry) => entry.id === target.entryId) ?? null
  }, [invRttn, shareMdl.value])
  const editedSavedEntryId = savedEditMdl.value?.kind === 'edit'
    ? savedEditMdl.value.entryId
    : null
  const editedSavedEntry = useMemo(
    () => editedSavedEntryId
      ? invRttn.find((entry) => entry.id === editedSavedEntryId) ?? null
      : null,
    [editedSavedEntryId, invRttn],
  )
  const liveSavedRotationName = useMemo(() => {
    const names = members.map((member) => member.name)
    const base = names.length > 0 ? names.join('/') : 'Advanced'
    return `${base} Rotation ${invRttn.length + 1}`
  }, [invRttn.length, members])
  const savedRotationCount = invRttn.length
  // restore the last saved-rotation arrangement when reopening the archive.
  const [lastSavedView, setLastSavedView] = useState<'list' | 'groups'>(
    savedView === 'groups' ? 'groups' : 'list',
  )
  const exitSavedSelectionRef = useRef<() => void>(() => {})
  // only one inspector pane can be detached from the margin at a time.
  const [pane, setPaneState] = useState<EditorPane>('read')
  const setPane = useCallback((update: React.SetStateAction<EditorPane>) => {
    setPaneState((current) => paneForView(
      view,
      typeof update === 'function' ? update(current) : update,
    ))
  }, [view])
  const activePane = paneForView(view, pane)
  // persist the selected node accent for inspector elements rendered outside it.
  const [noteAccent, setNoteAccent] = useState('var(--rte-res)')
  const [revealRequest, setRevealRequest] = useState<RotationNodeRevealRequest | null>(null)
  const ghostRepeats = editorPreferences.ghostRepeats
  const showPriors = editorPreferences.showPriors
  const dockPane = editorPreferences.dockPane
  const columnCeiling = useColumnCeiling(dockPane)
  const [columnSelection, setColumnSelection] = useState(() => fitColumnSelection(
    editorPreferences.statKeys.slice(0, statCeiling(false)),
    columnCeiling,
  ))
  const currentColumns = resizeColumnSelection(columnSelection, columnCeiling)
  if (currentColumns !== columnSelection) setColumnSelection(currentColumns)
  const statKeys = currentColumns.visible
  // persisted register-group ordering.
  const groupOrder: readonly RegisterGroup[] = editorPreferences.groupOrder
  const [searchOpen, setSearchOpen] = useState(false)
  const duplicateSavedEntries = useCallback((entries: readonly SavedRotation[]) => {
    const duplicates: SavedRotation[] = []
    for (const entry of entries) {
      const duplicate = addInvRot({
        name: entry.name,
        duration: entry.duration,
        note: entry.note,
        scenario: entry.scenario,
      })
      if (duplicate) duplicates.push(duplicate)
    }
    return duplicates
  }, [addInvRot])

  const copySavedEntries = useCallback(async (
    entries: readonly SavedRotation[],
    announce = true,
  ) => {
    const payload = makeSavedRotClip(entries)
    if (!payload) return false

    const wrote = await writeRotClip(payload)
    if (!wrote) {
      showToast({ content: 'Clipboard write failed.', variant: 'error', duration: 3000 })
      return false
    }

    if (announce) {
      showToast({
        content: entries.length === 1
          ? `Copied "${entries[0]!.name}".`
          : `Copied ${entries.length} saved rotations.`,
        variant: 'success',
        duration: 2200,
      })
    }
    return true
  }, [showToast])

  const pasteSavedEntries = useCallback(async () => {
    const payload = await readRotClip()
    const entries = payload?.savedEntries ?? []
    if (entries.length === 0) {
      showToast({
        content: 'Clipboard does not contain a saved rotation.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    const duplicates = duplicateSavedEntries(entries)
    const last = duplicates.at(-1)
    if (last) setSavedSelId(last.id)
    showToast({
      content: `${duplicates.length === 1 ? `Pasted "${duplicates[0]!.name}"` : `Pasted ${duplicates.length} saved rotations`}.`,
      variant: 'success',
      duration: 2400,
    })
  }, [duplicateSavedEntries, showToast])

  const deleteSavedEntries = useCallback((entries: readonly SavedRotation[]) => {
    if (entries.length === 0) return

    confirmation.confirm({
      title: 'Delete saved rotation?',
      message: entries.length === 1
        ? `Delete "${entries[0]!.name}" from your saved rotations? This cannot be undone.`
        : `Delete ${entries.length} saved rotations? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        const removedIds = new Set(entries.map((entry) => entry.id))
        for (const entry of entries) rmInvRot(entry.id)
        setCompareIds((current) => current.filter((id) => !removedIds.has(id)))
        if (entries.some((entry) => entry.id === savedSelId)) setSavedSelId(null)
        exitSavedSelectionRef.current()
        showToast({
          content: entries.length === 1
            ? `Deleted "${entries[0]!.name}".`
            : `Deleted ${entries.length} saved rotations.`,
          variant: 'success',
          duration: 2400,
        })
      },
    })
  }, [confirmation, rmInvRot, savedSelId, showToast])

  const cutSavedEntries = useCallback(async (entries: readonly SavedRotation[]) => {
    if (entries.length === 0) return
    const wrote = await copySavedEntries(entries, false)
    if (!wrote) return

    confirmation.confirm({
      title: 'Cut saved rotation?',
      message: entries.length === 1
        ? `Delete "${entries[0]!.name}" after copying it?`
        : `Delete ${entries.length} saved rotations after copying them?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        const removedIds = new Set(entries.map((entry) => entry.id))
        for (const entry of entries) rmInvRot(entry.id)
        setCompareIds((current) => current.filter((id) => !removedIds.has(id)))
        if (entries.some((entry) => entry.id === savedSelId)) setSavedSelId(null)
        exitSavedSelectionRef.current()
        showToast({
          content: entries.length === 1
            ? `Cut "${entries[0]!.name}".`
            : `Cut ${entries.length} saved rotations.`,
          variant: 'success',
          duration: 2400,
        })
      },
    })
  }, [confirmation, copySavedEntries, rmInvRot, savedSelId, showToast])

  const duplicateSavedRotation = useCallback(() => {
    if (!selectedSavedEntry) return
    const duplicate = duplicateSavedEntries([selectedSavedEntry])[0]
    if (!duplicate) return

    setSavedSelId(duplicate.id)
    showToast({
      content: `Duplicated "${selectedSavedEntry.name}".`,
      variant: 'success',
      duration: 2400,
    })
  }, [duplicateSavedEntries, selectedSavedEntry, showToast])

  const deleteSavedRotation = useCallback(() => {
    if (!selectedSavedEntry) return
    deleteSavedEntries([selectedSavedEntry])
  }, [deleteSavedEntries, selectedSavedEntry])

  useEffect(() => {
    if (!showSavedRotationList) return

    const controller = new AbortController()
    void runPreparedSavedRotationBatch(savedBatchPlan, { signal: controller.signal })
      .then((runs) => {
        if (!controller.signal.aborted) setSavedBatch({ key: savedBatchKey, runs })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        // settle the batch empty so the list leaves its loader for the toast.
        setSavedBatch({ key: savedBatchKey, runs: EMPTY_SAVED_COMPARISONS })
        showToast({
          content: error instanceof Error ? error.message : 'Could not load saved rotation data.',
          variant: 'error',
        })
      })

    return () => controller.abort()
  }, [savedBatchKey, savedBatchPlan, showSavedRotationList, showToast])

  useEffect(() => {
    if (!showSavedRotationList || savedDetailIds.length === 0) {
      return
    }
    // run only entries missing from the current deterministic detail cache.
    const entries = pendingSavedRotationDetails(invRttn, savedDetailIds, savedDetailRuns)
    if (entries.length === 0) {
      return
    }
    const controller = new AbortController()
    void runSavedRotationDetailBatch(entries, { signal: controller.signal })
      .then((runs) => {
        if (controller.signal.aborted) {
          return
        }
        setSavedDetails((current) => {
          // discard cached details when the saved-rotation batch identity changes.
          const kept = current.key === savedBatchKey ? current.runs : EMPTY_SAVED_RUNS
          const next = new Map(kept)
          for (const [id, run] of runs) {
            next.set(id, run)
          }
          return { key: savedBatchKey, runs: next }
        })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) showToast({
          content: error instanceof Error ? error.message : 'Could not load saved rotation details.',
          variant: 'error',
        })
      })
    return () => controller.abort()
  }, [
    invRttn,
    savedBatchKey,
    savedDetailIds,
    savedDetailRuns,
    showSavedRotationList,
    showToast,
  ])

  const dockPaneTo = useCallback((next: boolean) => {
    setEditorPreferences({ dockPane: next })
    if (next) {
      // docking requires a concrete pane; the archive uses its default channel.
      if (showSavedRotationList) {
        setSavedPane((current) => current ?? 'list')
      } else {
        setPane((current) => current ?? 'read')
      }
    }
  }, [setEditorPreferences, setPane, showSavedRotationList])

  const setStatKeys = useCallback((next: readonly StatKey[]) => {
    const selection = editColumnSelection(columnSelection, next)
    setColumnSelection(selection)
    setEditorPreferences({ statKeys: [...selection.visible, ...selection.hidden] })
  }, [columnSelection, setEditorPreferences])

  const setGroupOrder = useCallback((next: readonly RegisterGroup[]) => {
    setEditorPreferences({ groupOrder: [...next] })
  }, [setEditorPreferences])
  const [shutGroups, setShutGroups] = useState<ReadonlySet<RegisterGroup>>(
    () => new Set(),
  )
  const toggleGroup = useCallback((group: RegisterGroup) => {
    setShutGroups((current) => {
      const next = new Set(current)
      if (!next.delete(group)) {
        next.add(group)
      }
      return next
    })
  }, [])
  const decimals: DamageDecimals = editorPreferences.decimals
  const percentDisplay: PercentDisplay = editorPreferences.percentDisplay
  // reuse one run for normalized per-pass totals and full execution totals.
  const fullBasis = damageBasis === 'full'
  const engineTotals = (fullBasis ? result?.fullTotals : result?.totals)
    ?? EMPTY_DAMAGE_TOTALS
  const displayedTotals = showSavedRotationList
    ? selectedSavedSummary?.total ?? EMPTY_DAMAGE_TOTALS
    : engineTotals
  const displayedSupportTotals = showSavedRotationList
    ? (selectedSavedRun
      ? (fullBasis ? selectedSavedRun.fullSummary : selectedSavedRun.summary).supportTotals
      : EMPTY_SUPPORT_TOTALS)
    : (fullBasis ? result?.fullSummary : result?.summary)?.supportTotals
      ?? EMPTY_SUPPORT_TOTALS
  const teamSummary = fullBasis ? result?.fullSummary : result?.summary
  const teamShares = useMemo(
    () => Object.fromEntries((teamSummary?.resonators ?? []).map((group) => [group.id, group.sharePct])),
    [teamSummary],
  )
  // project console data lazily from the active editor or archive run.
  const consoleRun = selectedSavedRun
  const consoleMembers = useMemo(
    () => (showSavedRotationList ? consoleRun?.members ?? [] : members),
    [consoleRun, members, showSavedRotationList],
  )
  const consoleModel = useMemo(() => {
    if (!consoleOpen) return null
    // the console and flat list share the fully expanded execution trace.
    const source = showSavedRotationList ? consoleRun : result
    const rows = getRunFlatRows(source)
    if (!rows.length) return null
    return makeConsoleModel(
      rows,
      consoleMembers,
      showSavedRotationList ? consoleRun?.sections : sections,
      showSavedRotationList ? {} : runsByLoopId,
    )
  }, [consoleMembers, consoleOpen, consoleRun, result, runsByLoopId, sections, showSavedRotationList])
  const consoleCaption = showSavedRotationList
    ? selectedSavedEntry?.name ?? 'No rotation selected'
    : 'This rotation'
  const consoleEmpty = showSavedRotationList
    ? 'Select a saved rotation above to view its timeline.'
    : 'Add a step to view the rotation timeline.'

  const deleteSelectedRef = useRef<(ids: readonly string[]) => void>(() => {})
  const copySelectedRef = useRef<(ids: readonly string[]) => void>(() => {})
  const cutSelectedRef = useRef<(ids: readonly string[]) => void>(() => {})
  const pasteSelectedRef = useRef<(ids: readonly string[]) => void>(() => {})

  const needsRotationProjection = Boolean(
    featMenuMdl.value?.nodeId || condDtrMdl.value?.nodeId || featCondDtrMdl.value?.nodeId,
  )
  const currentRotationItems = useMemo(
    () => needsRotationProjection ? editedRotationItems(actRt, sections) : [],
    [actRt, needsRotationProjection, sections],
  )
  const loopColors = useMemo(() => collectLoopColors(sections), [sections])
  const selectionModel = useMemo(
    () => buildEditorSelectionModel(sections, shutIds),
    [sections, shutIds],
  )
  const flatRows = useMemo(
    () => view === 'flat' ? getRunFlatRows(result) : EMPTY_FLAT_ROWS,
    [result, view],
  )
  const flatTraceIds = useMemo(
    () => flatRows.map((row) => row.target.nodeId),
    [flatRows],
  )
  const flatSelectionModel = useMemo(
    () => buildFlatEditorSelectionModel(sections, flatTraceIds),
    [flatTraceIds, sections],
  )
  const activeSelectionModel = view === 'flat' ? flatSelectionModel : selectionModel
  const defaultSelectedId = activeSelectionModel.availableIds[0] ?? null
  const selectedId = result && defaultSelectedId
    && (!storedSelectedId || !activeSelectionModel.availableIds.includes(storedSelectedId))
    ? defaultSelectedId
    : storedSelectedId
  /*
    the editor cursor's active resonator is authored rotation state. do not
    remember a separate focused member: doing so lets one context rotation
    leak its last member into another, and disagrees with preceding handoffs.
  */
  const activeResonatorChoice = condChoices.find(
    (choice) => choice.state.path === ACTIVE_RESONATOR_PATH,
  )
  const cursorAnchor: CondAnchor = selectedId
    ? { kind: 'after', id: selectedId }
    : { kind: 'end' }
  const standingActiveId = activeResonatorChoice
    ? String(standingCondValue(activeResonatorChoice, {
      sections,
      anchor: cursorAnchor,
      history: result?.history,
      runtimesById: partRtsById,
      activeRuntime: actRt,
    }) ?? '')
    : ''
  const focusedId = members.some((member) => member.id === standingActiveId)
    ? standingActiveId
    : members.some((member) => member.id === actRt?.id)
      ? actRt?.id ?? ''
      : members[0]?.id ?? ''
  // guard the empty-team case that array indexing cannot express in its type.
  const activeMember: EditorMember | null =
    members.find((member) => member.id === focusedId) ?? null
  const savedSelectionRows = useMemo(
    () => makeSavedEntries(
      invRttn,
      svdRotPrefs,
      deferredSavedQuery,
      savedSummariesById,
      editorPreferences.decimals,
    ),
    [
      deferredSavedQuery,
      editorPreferences.decimals,
      invRttn,
      savedSummariesById,
      svdRotPrefs,
    ],
  )
  const savedSelectionOrder = useMemo(() => (
    savedView === 'groups'
      ? groupSavedEntries(savedSelectionRows).flatMap((group) => group.takes.map((row) => row.id))
      : savedSelectionRows.map((row) => row.id)
  ), [savedSelectionRows, savedView])
  const savedSelectionItems = useMemo(
    () => savedSelectionRows.map((row) => ({ id: row.id, val: row.entry })),
    [savedSelectionRows],
  )
  const savedSelectionActions = useMemo<Array<SelAct<string, SavedRotation>>>(() => [
    {
      id: 'rotation-page-saved:copy',
      key: 'copy',
      needsSel: true,
      icon: <Copy size="1em" />,
      label: ({ count }) => `Copy (${count})`,
      title: 'Copy selection (Ctrl/Cmd+C)',
      run: async ({ vals }) => {
        await copySavedEntries(vals)
      },
    },
    {
      id: 'rotation-page-saved:cut',
      key: 'cut',
      needsSel: true,
      icon: <Scissors size="1em" />,
      label: ({ count }) => `Cut (${count})`,
      title: 'Cut selection (Ctrl/Cmd+X)',
      run: async ({ vals }) => {
        await cutSavedEntries(vals)
      },
    },
    {
      id: 'rotation-page-saved:paste',
      key: 'paste',
      label: 'Paste',
      title: 'Paste saved rotations (Ctrl/Cmd+V)',
      float: false,
      run: pasteSavedEntries,
    },
    {
      id: 'rotation-page-saved:delete',
      key: 'delete',
      needsSel: true,
      danger: true,
      icon: <Trash2 size="1em" />,
      label: ({ count }) => `Delete (${count})`,
      title: 'Delete selection (Delete / Backspace)',
      run: ({ vals }) => deleteSavedEntries(vals),
    },
  ], [copySavedEntries, cutSavedEntries, deleteSavedEntries, pasteSavedEntries])
  // clipboard shortcuts target the open saved entry only outside selection mode.
  const trackedSavedIds = useMemo(
    () => (savedSelId ? [savedSelId] : []),
    [savedSelId],
  )
  const savedSelection = useSel({
    active: showSavedRotationList,
    surfaceId: 'rotation-page-saved-selection',
    ariaLabel: 'Saved rotation selection actions',
    items: savedSelectionItems,
    ord: savedSelectionOrder,
    tracked: trackedSavedIds,
    acts: savedSelectionActions,
    bar: false,
  })
  const savedSelectionSummary = useMemo<SelectionSummary | null>(() => (
    savedSelection.selectionMode
      ? {
          count: savedSelection.selectedCount,
          tallies: savedSelection.selectedCount > 0
            ? [{ label: 'Rotations', count: savedSelection.selectedCount }]
            : [],
        }
      : null
  ), [savedSelection.selectedCount, savedSelection.selectionMode])
  // comparison accepts at most four entries and preserves selection order.
  const exitSavedSelectionMode = savedSelection.exitSelectionMode
  const compareTakes = useCallback((ids: readonly string[]) => {
    const picked = ids.slice(0, CMP_MAX)
    if (picked.length < 2) {
      showToast({
        content: 'Pick at least two saved rotations to compare.',
        variant: 'warning',
        duration: 2400,
      })
      return
    }

    const [anchor, ...rest] = picked
    setSavedSelId(anchor!)
    setCompareIds(rest)
    setCompareMode(true)
    setSavedPane('read')
    exitSavedSelectionMode()
  }, [exitSavedSelectionMode, showToast])
  // closing the comparison channel restores ordinary row activation.
  const exitCompareMode = useCallback(() => {
    setCompareMode(false)
    setCompareIds([])
  }, [])
  // enter comparison with the open entry as anchor; leaving clears the set.
  const toggleCompareMode = useCallback(() => {
    if (compareMode) {
      exitCompareMode()
      return
    }

    setCompareMode(true)
    setCompareIds([])
    setSavedPane('read')
    exitSavedSelectionMode()
  }, [compareMode, exitCompareMode, exitSavedSelectionMode])
  // the first selection becomes the anchor; later selections toggle within the cap.
  const toggleCompareEntry = useCallback((id: string) => {
    if (!savedSelId) {
      setSavedSelId(id)
      return
    }

    if (id === savedSelId) {
      return
    }

    setCompareIds((current) => toggleComparedId(current, id))
  }, [savedSelId])
  // promoting a compared entry to anchor swaps the former anchor into its slot.
  const selectSavedEntry = useCallback((id: string) => {
    setCompareIds((current) => {
      if (!current.includes(id)) {
        return current
      }

      return savedSelId
        ? current.map((other) => (other === id ? savedSelId : other))
        : current.filter((other) => other !== id)
    })
    setSavedSelId(id)
  }, [savedSelId])
  const savedSelectionBranchActions = useMemo<SelectionActions>(() => ({
    hasSelection: savedSelection.hasSelection,
    canCopy: savedSelection.hasSelection,
    canPaste: true,
    onCopy: () => void copySavedEntries(savedSelection.selectedVals),
    onCut: () => void cutSavedEntries(savedSelection.selectedVals),
    onPaste: () => void pasteSavedEntries(),
    onDuplicate: () => {
      const duplicates = duplicateSavedEntries(savedSelection.selectedVals)
      const last = duplicates.at(-1)
      if (last) setSavedSelId(last.id)
      if (duplicates.length > 0) {
        showToast({
          content: duplicates.length === 1
            ? `Duplicated "${duplicates[0]!.name}".`
            : `Duplicated ${duplicates.length} saved rotations.`,
          variant: 'success',
          duration: 2400,
        })
      }
    },
    onCompare: () => compareTakes(savedSelection.selectedIdsInOrder),
    canCompare: savedSelection.selectedCount >= 2,
    compareLabel: savedSelection.selectedCount > CMP_MAX
      ? `Compare first ${CMP_MAX}`
      : savedSelection.selectedCount >= 2
        ? `Compare ${savedSelection.selectedCount}`
        : 'Compare',
    compareHint: 'Compare',
    onSelectAll: savedSelection.selectAll,
    onClear: savedSelection.deselectAll,
    onExit: savedSelection.exitSelectionMode,
    onDelete: () => deleteSavedEntries(savedSelection.selectedVals),
  }), [
    compareTakes,
    copySavedEntries,
    cutSavedEntries,
    deleteSavedEntries,
    duplicateSavedEntries,
    pasteSavedEntries,
    savedSelection.deselectAll,
    savedSelection.exitSelectionMode,
    savedSelection.hasSelection,
    savedSelection.selectAll,
    savedSelection.selectedCount,
    savedSelection.selectedIdsInOrder,
    savedSelection.selectedVals,
    showToast,
  ])
  useEffect(() => {
    exitSavedSelectionRef.current = savedSelection.exitSelectionMode
  }, [savedSelection.exitSelectionMode])
  // register selection actions for keyboard handling without rendering a duplicate toolbar.
  const selectionActions = useMemo<Array<SelAct<string, EditorNode>>>(() => [
    {
      id: 'rotation-page:copy',
      key: 'copy',
      needsSel: true,
      label: 'Copy',
      run: ({ ids }) => copySelectedRef.current(ids),
    },
    {
      id: 'rotation-page:cut',
      key: 'cut',
      needsSel: true,
      label: 'Cut',
      run: ({ ids }) => cutSelectedRef.current(ids),
    },
    {
      id: 'rotation-page:paste',
      key: 'paste',
      label: 'Paste',
      run: ({ ids }) => pasteSelectedRef.current(ids),
    },
    {
      id: 'rotation-page:delete',
      key: 'delete',
      needsSel: true,
      danger: true,
      icon: <Trash2 size="1em" />,
      label: ({ count }) => `Delete (${count})`,
      title: 'Delete selection (Delete / Backspace)',
      run: ({ ids }) => deleteSelectedRef.current(ids),
    },
  ], [])
  const flatSelectionActions = useMemo<Array<SelAct<string, EditorNode>>>(() => [
    {
      id: 'rotation-page-flat:copy',
      key: 'copy',
      needsSel: true,
      label: 'Copy',
      run: ({ ids }) => copySelectedRef.current(ids),
    },
  ], [])
  // outside selection mode, clipboard shortcuts target the currently open node.
  const trackedNodeIds = useMemo(
    () => (selectedId ? [selectedId] : []),
    [selectedId],
  )
  const nodeSelection = useSel({
    active: Boolean(result) && !showSavedRotationList,
    surfaceId: 'rotation-page-selection',
    ariaLabel: 'Rotation selection actions',
    items: activeSelectionModel.items,
    ord: activeSelectionModel.visibleIds,
    av: activeSelectionModel.availableIds,
    allIds: activeSelectionModel.selectAllIds,
    tracked: trackedNodeIds,
    acts: view === 'flat' ? flatSelectionActions : selectionActions,
    bar: false,
  })

  const exitNodeSelectionMode = nodeSelection.exitSelectionMode

  // node comparison preserves one anchor and caps the ordered comparison set at four.
  const compareNodes = useCallback((ids: readonly string[]) => {
    const picked = ids.slice(0, CMP_MAX)
    if (picked.length < 2) {
      showToast({
        content: 'Pick at least two rows to compare.',
        variant: 'warning',
        duration: 2400,
      })
      return
    }

    const [anchor, ...rest] = picked
    setSelectedId(anchor!)
    setNodeCmpIds(rest)
    setNodeCmpMode(true)
    setPane('read')
    exitNodeSelectionMode()
  }, [exitNodeSelectionMode, setPane, setSelectedId, showToast])
  // leaving comparison restores ordinary row activation.
  const exitNodeCompare = useCallback(() => {
    setNodeCmpMode(false)
    setNodeCmpIds([])
  }, [])
  // enter comparison with the open row as its anchor.
  const toggleNodeCompare = useCallback(() => {
    if (nodeCmpMode) {
      exitNodeCompare()
      return
    }

    setNodeCmpMode(true)
    setNodeCmpIds([])
    setPane('read')
    exitNodeSelectionMode()
  }, [exitNodeCompare, exitNodeSelectionMode, nodeCmpMode, setPane])
  // toggle compared rows without exceeding the panel cap.
  const toggleNodeCompareEntry = useCallback((id: string) => {
    if (!selectedId) {
      setSelectedId(id)
      return
    }

    if (id === selectedId) {
      return
    }

    setNodeCmpIds((current) => toggleComparedId(current, id))
  }, [selectedId, setSelectedId])
  // expose whether a row is selected or disabled by a full comparison set.
  const nodeCmpMark = useCallback((id: string): 'on' | 'off' | null => {
    if (!nodeCmpMode) return null
    if (id === selectedId || nodeCmpIds.includes(id)) return 'on'
    return nodeCmpIds.length >= CMP_MAX - 1 ? 'off' : null
  }, [nodeCmpIds, nodeCmpMode, selectedId])
  const selectionSurfaceRef = useRef(showSavedRotationList)
  useEffect(() => {
    if (selectionSurfaceRef.current === showSavedRotationList) return
    selectionSurfaceRef.current = showSavedRotationList
    if (showSavedRotationList) {
      exitNodeSelectionMode()
    } else {
      exitSavedSelectionMode()
    }
  }, [exitNodeSelectionMode, exitSavedSelectionMode, showSavedRotationList])

  const selectionMode = showSavedRotationList
    ? savedSelection.selectionMode
    : nodeSelection.selectionMode
  const exitSelectionMode = showSavedRotationList
    ? savedSelection.exitSelectionMode
    : nodeSelection.exitSelectionMode
  useEffect(() => {
    if (!selectionMode) {
      return
    }

    // pointer-down runs before the activating click and cannot capture that same gesture.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target || target.closest(SELECTION_KEEP)) {
        return
      }

      exitSelectionMode()
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [exitSelectionMode, selectionMode])

  const rotationNodeById = useCallback((nodeId: string | null): RotationNode | null => (
    nodeId ? findRotNode(currentRotationItems, nodeId) : null
  ), [currentRotationItems])

  const allSteps = useMemo(
    () => collectSectionSteps(sections),
    [sections],
  )

  const selectedScope = useMemo(
    () => findNodeExecutionScope(sections, selectedId, runsByLoopId),
    [runsByLoopId, sections, selectedId],
  )
  const selectedRun = selectedScope?.kind === 'loop' ? selectedScope.run : 1

  const isDisabledOnCurrentRun = useCallback((
    node: EditorStep | EditorCondition | EditorHandoff | EditorBlock,
  ): boolean => {
    return isDisabledInTree(sections, node)
  }, [sections])

  const selectedStep = useMemo(
    () => allSteps.find((step) => step.id === selectedId) ?? null,
    [allSteps, selectedId],
  )

  const inspectorStep = useMemo(
    () => selectedStep && isDisabledOnCurrentRun(selectedStep)
      ? { ...selectedStep, disabled: true }
      : selectedStep,
    [isDisabledOnCurrentRun, selectedStep],
  )

  // build the expensive state summary only for the selected row.
  const buffs = useMemo<BuffLine[]>(() => {
    if (activePane !== 'read' || !selectedStep) {
      return []
    }
    return buildBuffLines({
      result,
      selectedStep,
      disabled: inspectorStep?.disabled,
      runtime: actRt,
      runtimesById: partRtsById,
      enemy: enemyProfile,
      run: selectedRun,
    })
  }, [
    actRt,
    result,
    enemyProfile,
    inspectorStep?.disabled,
    activePane,
    partRtsById,
    selectedRun,
    selectedStep,
  ])

  const peakDamage = useMemo(
    () => view === 'flat' ? 1 : peakDamageForRun(allSteps, sections, runsByLoopId),
    [allSteps, runsByLoopId, sections, view],
  )

  // resolve comparison inspection here because the page has the required runtimes.
  const readBuffsFor = useCallback(
    (step: EditorStep, run: number, disabled: boolean) => buildBuffLines({
      result,
      selectedStep: step,
      disabled,
      runtime: actRt,
      runtimesById: partRtsById,
      enemy: enemyProfile,
      run,
    }),
    [actRt, enemyProfile, partRtsById, result],
  )
  const nodeComparePanels = useCompareMount(nodeCmpIds)
  // comparison reads the anchor through the same projection as its peer panels.
  const nodeCmpAnchor = useMemo(() => {
    if (!nodeCmpMode || !selectedId) {
      return null
    }

    return resolveReadNode({
      id: selectedId,
      sections,
      members,
      result,
      runsByLoopId,
      totalAvg: result?.totals.avg ?? 0,
      buffsFor: readBuffsFor,
    })
  }, [members, nodeCmpMode, readBuffsFor, result, runsByLoopId, sections, selectedId])
  // retain projections for exiting panels until their mounted transition completes.
  const nodeCmpReads = useMemo(() => {
    const reads = new Map<string, ReadNode>()
    for (const { id } of nodeComparePanels) {
      const read = resolveReadNode({
        id,
        sections,
        members,
        result,
        runsByLoopId,
        totalAvg: result?.totals.avg ?? 0,
        buffsFor: readBuffsFor,
      })
      if (read) reads.set(id, read)
    }
    return reads
  }, [members, nodeComparePanels, readBuffsFor, result, runsByLoopId, sections])
  const flatSelectedRead = useMemo(() => {
    if (view !== 'flat' || nodeCmpMode || !selectedId) return null
    return resolveReadNode({
      id: selectedId,
      sections,
      members,
      result,
      runsByLoopId,
      totalAvg: result?.totals.avg ?? 0,
      buffsFor: readBuffsFor,
    })
  }, [members, nodeCmpMode, readBuffsFor, result, runsByLoopId, sections, selectedId, view])

  // folding a resonator run also folds rows under its heading.
  const setEditorFold = useCallback((id: string, open: boolean) => {
    setEditorFoldOpen(id, open)
    if (!open && !id.includes(':')) {
      setEditorFoldOpen(carryFoldId(id), false)
    }
  }, [setEditorFoldOpen])

  const editorVisualFoldIds = useMemo(
    () => collectEditorVisualFoldIds(sections),
    [sections],
  )
  const canCollapseEditor = view === 'tree'
    && [...editorVisualFoldIds].some((id) => !shutIds.has(id))
  const canExpandEditor = view === 'tree'
    && [...editorVisualFoldIds].some((id) => shutIds.has(id))
  const collapseEditor = useCallback(() => {
    collapseEditorFolds(editorVisualFoldIds)
  }, [collapseEditorFolds, editorVisualFoldIds])
  const expandEditor = useCallback(() => {
    expandEditorFolds(editorVisualFoldIds)
  }, [editorVisualFoldIds, expandEditorFolds])

  const selectRow = useCallback((_step: EditorStep | null, id: string) => {
    // promoting a compared row to anchor swaps the former anchor into its slot.
    setNodeCmpIds((current) => {
      if (!current.includes(id)) {
        return current
      }

      return selectedId
        ? current.map((other) => (other === id ? selectedId : other))
        : current.filter((other) => other !== id)
    })
    setSelectedId(id)
    if (selectedId === id) setPane('read')
  }, [selectedId, setPane, setSelectedId])

  // saved-entry inspection uses the selected entry's accent.
  const leaderAccent = showSavedRotationList
    ? savedSelectionRows.find((row) => row.id === savedSelId)?.lead.accent
      ?? (isLiveRotEntId(savedSelId)
        ? (() => {
          const lead = members.find((member) => member.id === actRt?.id)
          return lead ? ATTR_COLORS[lead.attribute] : null
        })()
        : null)
      ?? 'var(--rte-res)'
    : nodeCmpAnchor?.accent ?? flatSelectedRead?.accent ?? noteAccent

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const noteRef = useRef<HTMLElement | null>(null)
  const leaderRef = useRef<HTMLDivElement | null>(null)

  /* switch the persisted surface and own its dom transition at the action
     boundary, where both the leaving and arriving surfaces are known. */
  const showSavedRots = useCallback((next: RotationEditorPreferences['savedView']) => {
    const nextSaved = next !== 'off'
    setEditorPreferences({ savedView: next })
    if (nextSaved) {
      setNodeCmpMode(false)
      setNodeCmpIds([])
      setLastSavedView(next)
      setPane(null)
      setSavedPane((current) => current ?? 'list')
    } else {
      setCompareMode(false)
      setCompareIds([])
      setPane((current) => current ?? 'read')
    }

    if (drawnSaved === nextSaved) return

    const body = bodyRef.current
    const page = body?.closest<HTMLElement>('.rte-page') ?? null
    const noMotion = document.documentElement.classList.contains('no-entrance-anim')
    const head = page?.querySelector('.rte-bar')?.getBoundingClientRect()
    const foot = page?.querySelector('.rte-totals')?.getBoundingClientRect()
    if (!page || !body || !head || !foot || noMotion) {
      setDrawnSaved(nextSaved)
      setLeaving(null)
      return
    }

    page.style.setProperty('--rte-run', `${Math.round(foot.top - head.top)}px`)
    page.style.setProperty('--rte-held', `${Math.round(body.scrollTop)}px`)
    page.style.setProperty('--rte-roll-dir', nextSaved ? '1' : '-1')
    setLeaving(drawnSaved)
    startTransition(() => setDrawnSaved(nextSaved))
  }, [drawnSaved, setEditorPreferences, setPane])

  const loadSavedRotation = useCallback(async (mode: RotationLoadMode) => {
    if (!selectedSavedEntry || loadingSavedRef.current) return
    loadingSavedRef.current = true
    try {
      await loadRotation(selectedSavedEntry, mode)
      showSavedRots('off')
      showToast({
        content: mode === 'build'
          ? `Loaded "${selectedSavedEntry.name}" with its full build.`
          : `Loaded the steps from "${selectedSavedEntry.name}".`,
        variant: 'success',
        duration: 2600,
      })
    } catch {
      showToast({
        content: `Could not load "${selectedSavedEntry.name}". Please try again.`,
        variant: 'error',
        duration: 3000,
      })
    } finally {
      loadingSavedRef.current = false
    }
  }, [loadRotation, selectedSavedEntry, showSavedRots, showToast])

  /* measure the body-dependent transition distance after mount. a timer clears
     entry state because the final animated child count varies by active view. */
  const [entering, setEntering] = useState(() => (
    typeof document !== 'undefined'
    && !document.documentElement.classList.contains('no-entrance-anim')
  ))

  useLayoutEffect(() => {
    if (!entering) return
    const body = bodyRef.current
    const page = body?.closest<HTMLElement>('.rte-page') ?? null
    if (!page || !body) return

    page.style.setProperty('--rte-open', `${Math.round(body.getBoundingClientRect().height / 2)}px`)
    const id = window.setTimeout(() => setEntering(false), ENTRANCE_MS)
    return () => window.clearTimeout(id)
  }, [entering])

  // keep cleanup separate from the effect that mutates its own transition dependency.
  useEffect(() => {
    if (leaving === null) {
      return
    }

    const id = window.setTimeout(() => setLeaving(null), ROLL_MS)
    return () => window.clearTimeout(id)
  }, [leaving])

  // recompute inspector anchoring when its row, panel, or scroll geometry changes.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) {
      return
    }

    const place = () => {
      const pip = leaderRef.current
      if (!pip) {
        return
      }

      // resolve the anchor from the active editor or archive surface.
      const archive = showSavedRotationList
      const note = archive
        ? body.querySelector<HTMLElement>('.rte-inspector.rsl-inspector:not(.rsl-cmp)')
        : noteRef.current
      const open = archive ? savedPane === 'read' : activePane === 'read'
      const rowId = archive ? savedSelId : selectedId
      const row = rowId
        ? body.querySelector<HTMLElement>(archive
          ? `[data-rsl-row-id="${CSS.escape(rowId)}"]`
          : `[data-rte-node-id="${CSS.escape(rowId)}"]`)
        : null

      if (!open || !note || !row) {
        pip.classList.remove('is-on')
        return
      }

      const bodyBox = body.getBoundingClientRect()
      const rowBox = row.getBoundingClientRect()
      const noteBox = note.getBoundingClientRect()
      // archive scrolling changes body-relative offsets; editor-list scrolling does not.
      const spot = placeLeader({
        body: bodyBox,
        row: rowBox,
        note: noteBox,
        noteHeight: note.offsetHeight,
        scrollTop: body.scrollTop,
        scrollLeft: body.scrollLeft,
        bodyHeight: bodyBox.height,
      })

      body.style.setProperty('--rte-note-top', `${Math.round(spot.noteTop)}px`)
      body.style.setProperty('--rte-pip-left', `${Math.round(spot.pipLeft)}px`)
      pip.classList.toggle('is-on', spot.shown)
      if (!spot.shown) {
        return
      }

      body.style.setProperty('--rte-pip-top', `${Math.round(spot.pipTop)}px`)
    }

    place()

    // capture scroll at the stable body because nested scrollers are replaced.
    body.addEventListener('scroll', place, { capture: true, passive: true })

    // transition events cover anchor movement that does not trigger react rendering.
    const settled = (event: TransitionEvent) => {
      if (event.propertyName === 'margin-right' || event.propertyName === 'top') {
        place()
      }
    }
    body.addEventListener('transitionend', settled as EventListener)

    const observer = new ResizeObserver(place)
    observer.observe(body)
    const note = showSavedRotationList
      ? body.querySelector<HTMLElement>('.rte-inspector.rsl-inspector:not(.rsl-cmp)')
      : noteRef.current
    if (note) {
      observer.observe(note)
    }

    return () => {
      body.removeEventListener('scroll', place, { capture: true })
      body.removeEventListener('transitionend', settled as EventListener)
      observer.disconnect()
    }
  }, [
    compareIds,
    deferredSavedQuery,
    activePane,
    savedPane,
    savedSelId,
    savedView,
    selectedId,
    showSavedRotationList,
    shutIds,
    runsByLoopId,
  ])

  const commitPageEdit = useCallback((
    nextSections: typeof sections,
    label = 'Edit rotation',
    coalesceKey?: string,
    options?: { presentation?: boolean },
  ): boolean => {
    if (nextSections === sections) {
      return false
    }

    const nextRuns = clampLoopRunSelections(nextSections, runsByLoopId)
    const before = rotationEditHistoryCursor(editHistory, {
      runsByLoopId,
      simulationKey,
      lastRanAt,
    }) ?? captureRotationEditSnapshot(sections, runsByLoopId, simulationKey, lastRanAt)
    const after = captureRotationEditSnapshot(nextSections, nextRuns)
    const nextKey = options?.presentation
      ? simulationKey
      : rotationSimulationKey(after.sections, baselineRotationItems, { checkedIn: true })
    const nextRanAt = rotationEditRanAt(simulationKey, nextKey, lastRanAt)
    after.simulationKey = nextKey
    after.lastRanAt = nextRanAt
    if (before.simulationKey === undefined) {
      before.simulationKey = simulationKey
    }
    const nextHistory = commitRotationEdit(editHistory, {
      label,
      before,
      after,
      coalesceKey,
    })
    updateEditorSession((current) => ({
      ...current,
      editHistory: nextHistory,
      sections: nextSections,
      runsByLoopId: nextRuns,
      lastRanAt: nextRanAt,
      simulationKey: nextKey,
    }))
    setNodeCmpIds((current) => current.filter((id) => Boolean(findNode(nextSections, id))))
    return true
  }, [
    baselineRotationItems,
    editHistory,
    lastRanAt,
    runsByLoopId,
    sections,
    simulationKey,
    updateEditorSession,
  ])

  const bump = useCallback((
    next: typeof sections,
    label?: string,
    coalesceKey?: string,
  ) => {
    commitPageEdit(next, label, coalesceKey)
  }, [commitPageEdit])

  /*
    marks the first feature that resumes off-tune buildup after a tune break;
    the gauge remains unchanged between the break and this feature.
  */
  const setOffTuneResumeAt = useCallback((id: string, on: boolean) => {
    bump(
      setOffTuneResume(sections, id, on),
      on ? 'Off-Tune resumes here' : 'Off-Tune resume cleared',
    )
  }, [bump, sections])
  const offTuneAuthoring = useMemo(
    () => offTuneAuthoringStates(sections),
    [sections],
  )

  const bumpPresentation = useCallback((
    next: typeof sections,
    label?: string,
  ) => {
    commitPageEdit(next, label, undefined, { presentation: true })
  }, [commitPageEdit])

  const canClearRotation = sections.some((section) => section.children.length > 0)
  const clearRotation = () => {
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: 'This will remove all items from the current rotation.',
      confirmLabel: 'Clear',
      variant: 'danger',
      onConfirm: () => {
        const cleared = sections.map((section) => ({
          ...section,
          children: [],
          total: undefined,
        }))
        if (!commitPageEdit(cleared, 'Clear rotation')) {
          return
        }
        setSelectedId(null)
        setRevealRequest(null)
        exitNodeSelectionMode()
      },
    })
  }

  const restoreHistorySnapshot = useCallback((
    snapshot: Parameters<typeof restoreRotationEditSnapshot>[0],
    nextHistory: typeof editHistory,
  ) => {
    const restored = restoreRotationEditSnapshot(snapshot)
    updateEditorSession((current) => ({
      ...current,
      sections: restored.sections,
      runsByLoopId: clampLoopRunSelections(restored.sections, restored.runsByLoopId),
      lastRanAt: restored.lastRanAt,
      editHistory: nextHistory,
      simulationKey: snapshot.simulationKey
        ?? rotationSimulationKey(snapshot.sections, baselineRotationItems, { checkedIn: true }),
    }))
    setSelectedId((current) => current && findNode(restored.sections, current) ? current : null)
  }, [baselineRotationItems, updateEditorSession])

  const undoPageEdit = useCallback(() => {
    const result = undoRotationEdit(editHistory)
    if (!result.snapshot) {
      return
    }
    restoreHistorySnapshot(result.snapshot, result.history)
  }, [editHistory, restoreHistorySnapshot])

  const redoPageEdit = useCallback(() => {
    const result = redoRotationEdit(editHistory)
    if (!result.snapshot) {
      return
    }
    restoreHistorySnapshot(result.snapshot, result.history)
  }, [editHistory, restoreHistorySnapshot])

  const undoPageEditTo = useCallback((index: number) => {
    let cursor = editHistory
    let snapshot = null as ReturnType<typeof undoRotationEdit>['snapshot']
    for (let step = 0; step <= index; step += 1) {
      const result = undoRotationEdit(cursor)
      if (!result.snapshot) break
      cursor = result.history
      snapshot = result.snapshot
    }
    if (!snapshot) return
    restoreHistorySnapshot(snapshot, cursor)
  }, [editHistory, restoreHistorySnapshot])

  const redoPageEditTo = useCallback((index: number) => {
    let cursor = editHistory
    let snapshot = null as ReturnType<typeof redoRotationEdit>['snapshot']
    for (let step = 0; step <= index; step += 1) {
      const result = redoRotationEdit(cursor)
      if (!result.snapshot) break
      cursor = result.history
      snapshot = result.snapshot
    }
    if (!snapshot) return
    restoreHistorySnapshot(snapshot, cursor)
  }, [editHistory, restoreHistorySnapshot])

  const routeHistoryScope = useMemo(() => ({
    past: editHistory.past,
    future: editHistory.future,
    undo: undoPageEdit,
    redo: redoPageEdit,
    undoTo: undoPageEditTo,
    redoTo: redoPageEditTo,
  }), [
    editHistory.future,
    editHistory.past,
    redoPageEdit,
    redoPageEditTo,
    undoPageEdit,
    undoPageEditTo,
  ])

  useEffect(
    () => registerRouteHistoryScope(routeHistoryScope),
    [registerRouteHistoryScope, routeHistoryScope],
  )

  const simulationDirty = simulationKey !== runBaselineKey

  // compute stale signatures only for dirty drafts and against the last execution baseline.
  const staleNodeIds = useMemo(() => {
    if (!simulationDirty) return NO_STALE_NODES
    return rotationStaleNodeIds(
      rotationNodeSignatures(
        checkinAllLoopPasses(sections),
        baselineRotationItems,
        { checkedIn: true },
      ),
      runBaselineSigs,
    )
  }, [baselineRotationItems, runBaselineSigs, sections, simulationDirty])

  const runArmed = simulationDirty

  /* the archive preview is the last exact completed run, not the current
     authored tree with an older result attached. it is built only while the
     saved surface is visible or finishing its exit transition, so ordinary
     editor changes do not clone a profile or project a rotation for a hidden
     surface. sharing remains a separate projection of the current editor. */
  const savedSurfaceMounted = showSavedRotationList || drawnSaved || leaving === true
  const liveRotationEntry = useMemo(() => {
    if (
      !svdRotPrefs.showLiveRotation
      || !savedSurfaceMounted
      || !actRt
      || !scenario
      || !result
    ) return null

    const resonatorName = members.find((member) => member.id === actRt.id)?.name ?? actRt.id
    const teamName = members.length > 0
      ? members.map((member) => member.name).join('/')
      : resonatorName
    return makeLiveRotationEntry(scenario, resonatorName, {
      items: editedRotationItems(actRt, result.sections),
      lastRanAt: result.ranAt,
      name: `${teamName} Live Rotation`,
    })
  }, [actRt, members, result, savedSurfaceMounted, scenario, svdRotPrefs.showLiveRotation])
  // reuse the page's completed run for the live archive entry.
  const liveRotationSummary = useMemo(
    () => (liveRotationEntry && result ? savedRotationSummary(result, damageBasis) : null),
    [damageBasis, liveRotationEntry, result],
  )
  const liveRotationRow = useMemo(() => {
    if (!liveRotationEntry || !liveRotationSummary || !result) return null
    return {
      entry: liveRotationEntry,
      summary: liveRotationSummary,
      run: result,
      stale: simulationDirty,
    }
  }, [
    liveRotationEntry,
    liveRotationSummary,
    result,
    simulationDirty,
  ])
  const visibleLiveGroupId = useMemo(() => {
    if (!liveRotationEntry || !liveRotationSummary) return null
    const rows = makeSavedEntries(
      [liveRotationEntry],
      svdRotPrefs,
      deferredSavedQuery,
      new Map([[liveRotationEntry.id, liveRotationSummary]]),
      editorPreferences.decimals,
    )
    return rows[0]?.lead.id ?? null
  }, [
    deferredSavedQuery,
    editorPreferences.decimals,
    liveRotationEntry,
    liveRotationSummary,
    svdRotPrefs,
  ])
  const savedGroupIds = useMemo(() => new Set([
    ...savedSelectionRows.map((row) => row.lead.id),
    ...(visibleLiveGroupId ? [visibleLiveGroupId] : []),
  ]), [savedSelectionRows, visibleLiveGroupId])
  const canCollapseSavedGroups = savedView === 'groups'
    && [...savedGroupIds].some((id) => !savedShutGroupIds.has(id))
  const canExpandSavedGroups = savedView === 'groups'
    && [...savedGroupIds].some((id) => savedShutGroupIds.has(id))
  const collapseSavedGroups = useCallback(() => {
    collapseSavedGroupsById(savedGroupIds)
  }, [collapseSavedGroupsById, savedGroupIds])
  const expandSavedGroups = useCallback(() => {
    expandSavedGroupsById(savedGroupIds)
  }, [expandSavedGroupsById, savedGroupIds])
  const liveRotationSelected = Boolean(
    liveRotationEntry && savedSelId === liveRotationEntry.id,
  )
  const liveRotationRate = useMemo(() => {
    if (!liveRotationEntry) return null
    return simulationDirty
      ? 'Not saved · editor differs from this run'
      : `Not saved · run ${formatSavedTime(liveRotationEntry.updatedAt)}`
  }, [liveRotationEntry, simulationDirty])

  const shareCurrentRotation = useCallback(() => {
    if (!actRt || !scenario || lastRanAt === null) return

    const resonatorName = members.find((member) => member.id === actRt.id)?.name ?? actRt.id
    const teamName = members.length > 0
      ? members.map((member) => member.name).join('/')
      : resonatorName
    const entry = makeLiveRotationEntry(scenario, resonatorName, {
      items: editedRotationItems(actRt, sections),
      lastRanAt,
      name: `${teamName} Live Rotation`,
    })
    if (entry) shareMdl.show({ kind: 'live', entry })
  }, [actRt, lastRanAt, members, scenario, sections, shareMdl])

  const acceptProgramRunResult = useCallback((
    nextResult: RunResult,
    ranItems: RotationNode[],
  ) => {
    const ranAt = nextResult.ranAt
    const nextRuns = clampLoopRunSelections(nextResult.sections, runsByLoopId)
    const nextSections = checkoutAllLoopPasses(nextResult.sections, nextRuns)
    const snapshot = captureRotationEditSnapshot(nextSections, nextRuns, undefined, ranAt)
    const nextBaselineItems = cloneRotationNodes(ranItems)
    const nextKey = rotationSimulationKey(
      snapshot.sections,
      nextBaselineItems,
      { checkedIn: true },
    )
    snapshot.simulationKey = nextKey
    updateEditorSession((current) => ({
      ...current,
      result: nextResult,
      sections: nextSections,
      runsByLoopId: nextRuns,
      lastRanAt: ranAt,
      editHistory: refreshRotationHistoryCursor(current.editHistory, snapshot),
      baselineItems: nextBaselineItems,
      simulationKey: nextKey,
      runBaselineKey: nextKey,
      runBaselineSigs: rotationNodeSignatures(
        snapshot.sections,
        nextBaselineItems,
        { checkedIn: true },
      ),
    }))
  }, [runsByLoopId, updateEditorSession])

  const persistRanRotation = useCallback((
    ranSections: EditorSection[],
    ranAt: number,
  ): RotationNode[] | null => {
    if (!actRt) return null

    const items = editedRotationItems(actRt, ranSections)
    persistRotationProgram(items, ranAt)
    return items
  }, [actRt, persistRotationProgram])

  const applyNodeTarget = useCallback((
    target: RotationNodeTarget,
    reveal: boolean,
  ) => {
    const navigation = prepareRotationNodeNavigation({
      sections,
      runsByLoopId,
      shutIds,
      target,
      revealToken: revealRequest?.token,
    })
    if (!navigation) {
      showToast({
        content: 'That rotation node is no longer in the editor.',
        variant: 'warning',
        duration: 2400,
      })
      return
    }

    updateEditorSession((current) => ({
      ...current,
      sections: navigation.sections,
      runsByLoopId: navigation.runsByLoopId,
    }))
    setSelectedId(navigation.selectedId)
    if (reveal) {
      replaceEditorClosed(navigation.shutIds)
      setRevealRequest(navigation.revealRequest)
    }
  }, [
    replaceEditorClosed,
    revealRequest?.token,
    runsByLoopId,
    sections,
    showToast,
    shutIds,
    updateEditorSession,
  ])

  const navigateToNode = useCallback((target: RotationNodeTarget) => {
    applyNodeTarget(target, true)
  }, [applyNodeTarget])

  const selectNodeTarget = useCallback((target: RotationNodeTarget) => {
    applyNodeTarget(target, false)
  }, [applyNodeTarget])

  const selectFlatRow = useCallback((target: FlatRowTarget) => {
    setNodeCmpIds((current) => {
      if (!current.includes(target.nodeId)) return current
      return selectedId
        ? current.map((other) => (other === target.nodeId ? selectedId : other))
        : current.filter((other) => other !== target.nodeId)
    })
    selectNodeTarget(target)
    // the same authored node can appear in several loop runs.
    if (selectedId === target.nodeId && flatTargetMatchesRuns(target, runsByLoopId)) {
      setPane('read')
    }
  }, [runsByLoopId, selectNodeTarget, selectedId, setPane])

  const navigateVisibleNode = useCallback((target: RotationNodeTarget) => {
    if (view !== 'flat') {
      navigateToNode(target)
      return
    }
    const flatTarget = resolveFlatRowTarget(
      flatRows,
      target.nodeId,
      selectionModel.availableIds,
      { ...runsByLoopId, ...target.loopRuns },
    )
    if (flatTarget) navigateToNode(flatTarget)
  }, [flatRows, navigateToNode, runsByLoopId, selectionModel.availableIds, view])

  const setNodeListView = useCallback((nextView: NodeListView) => {
    if (nextView !== view && selectedId) {
      const target = nextView === 'flat'
        ? resolveFlatRowTarget(
          flatRows,
          selectedId,
          selectionModel.availableIds,
          runsByLoopId,
        )
        : { nodeId: selectedId, loopRuns: { ...runsByLoopId } }
      if (target) navigateToNode(target)
    }
    setPane((current) => {
      if (nextView === 'flat' && current === 'nodes') return 'read'
      if (nextView === 'tree' && current === 'totals') return 'read'
      return current
    })
    setEditorPreferences({ view: nextView })
  }, [flatRows, navigateToNode, runsByLoopId, selectedId, selectionModel.availableIds, setEditorPreferences, setPane, view])

  const runRotation = useCallback(() => {
    const nextResult = runEditedRotation({
      runtime: actRt,
      runtimesById: partRtsById,
      targetSelections: actTgtSels,
      enemy: enemyProfile,
      members: rotMembers,
      sections,
      prepWork,
    })
    if (!nextResult) {
      return
    }

    const ranItems = persistRanRotation(sections, nextResult.ranAt)
    if (!ranItems) return
    acceptProgramRunResult(nextResult, ranItems)
    const nodeCount = countNodes(nextResult.sections.flatMap((section) => section.children)).nodes
    showToast({
      content: `Ran ${nodeCount} nodes in ${displayedRunMs(nextResult)} ms.`,
      variant: 'success',
      duration: 2600,
    })
  }, [
    acceptProgramRunResult,
    actRt,
    actTgtSels,
    enemyProfile,
    partRtsById,
    persistRanRotation,
    prepWork,
    rotMembers,
    sections,
    showToast,
  ])

  // cleanup evidence is valid only while the draft still matches its completed run.
  const cleanupPlan = useMemo(
    () => {
      if (simulationDirty) return null

      const availableSources = new Set<string>()
      for (const member of rotMembers) {
        availableSources.add(makeSourceKey({ type: 'resonator', id: member.id }))
        const weaponId = member.runtime.build.weapon.id
        if (weaponId && weaponId !== '0') {
          availableSources.add(makeSourceKey({ type: 'weapon', id: weaponId }))
        }
        for (const echo of member.runtime.build.echoes) {
          if (!echo) continue
          availableSources.add(makeSourceKey({ type: 'echo', id: echo.id }))
          availableSources.add(makeSourceKey({ type: 'echoSet', id: String(echo.set) }))
        }
      }
      /* enemy condition states use the synthetic `target` source, while
         authored enemy packages use the selected catalog/custom id. */
      availableSources.add(makeSourceKey({ type: 'enemy', id: 'target' }))
      availableSources.add(makeSourceKey({ type: 'enemy', id: enemyProfile.id }))

      return planRotationCleanup(sections, { availableSources })
    },
    [enemyProfile.id, rotMembers, sections, simulationDirty],
  )

  // apply one cleanup plan atomically; removals can change whether later writes are inert.
  const cleanupRotation = useCallback(() => {
    if (!cleanupPlan || cleanupPlan.targets.length === 0) return

    const openedSections = sections
    const openedSimulationKey = simulationKey
    const openedRunBaselineKey = runBaselineKey
    const plannedCount = cleanupPlan.targets.length

    confirmation.confirm({
      title: 'Clean up rotation?',
      message: `This removes ${describeRotationCleanup(cleanupPlan)}`,
      confirmLabel: 'Clean up',
      variant: 'danger',
      onConfirm: () => {
        const current = getRotationEditorSession(sessionOwnerId)
        if (
          !current
          || current.sections !== openedSections
          || current.simulationKey !== openedSimulationKey
          || current.runBaselineKey !== openedRunBaselineKey
        ) {
          showToast({
            content: 'The rotation changed while the sweep was waiting. Run it again before sweeping.',
            variant: 'warning',
            duration: 3000,
          })
          return
        }

        const swept = applyRotationCleanup(openedSections, cleanupPlan)
        if (!commitPageEdit(swept, 'Clean up rotation')) return

        setSelectedId((current) => (
          current && !findNode(swept, current) ? null : current
        ))
        exitNodeSelectionMode()
        showToast({
          content: `Swept ${plannedCount} ${plannedCount === 1 ? 'row' : 'rows'}.`,
          variant: 'success',
          duration: 2400,
        })
      },
    })
  }, [
    cleanupPlan,
    commitPageEdit,
    confirmation,
    exitNodeSelectionMode,
    runBaselineKey,
    sections,
    sessionOwnerId,
    showToast,
    simulationKey,
  ])

  const appendSources = useMemo<AppendSource[]>(
    () => (actRt ? makeAppendSource({ runtime: actRt, saved: invRttn }) : []),
    [actRt, invRttn],
  )

  /*
    project appended nodes to add editor display metadata to the local tree.
    appending does not persist a program or record a completed run.
  */
  const appendRotation = useCallback((entry: AppendSource) => {
    const appended = appendRotationCopies(entry.items)
    const appendedIds = new Set(appended.map((node) => node.id))
    const projectedSections = projectAppendedRotation({
      runtime: actRt,
      runtimesById: partRtsById,
      targetSelections: actTgtSels,
      enemy: enemyProfile,
      members: rotMembers,
      sections,
      append: appended,
      prepWork,
    })
    if (projectedSections.length === 0) {
      return
    }

    /*
      the simulation projection appends the source at the main-section tail so
      its nodes receive the same display metadata as ordinary additions. move
      those projected editor nodes into the authored tree through insertNode,
      which gives append the same after-selection and setup/loop guardrails as
      the palette.
    */
    const projected = collectSubtrees(projectedSections, appendedIds).filter(canLiftNode)
    if (projected.length === 0) {
      return
    }

    let nextSections = sections
    let anchor = selectedId
    for (const node of projected) {
      nextSections = insertNode(nextSections, node, anchor, 'main')
      anchor = node.id
    }

    if (!commitPageEdit(nextSections, `Append ${entry.label}`)) {
      return
    }

    setSelectedId(projected.at(-1)?.id ?? null)
    showToast({
      content: `Appended ${entry.label}.`,
      variant: 'success',
      duration: 2600,
    })
  }, [
    actRt,
    actTgtSels,
    commitPageEdit,
    enemyProfile,
    partRtsById,
    prepWork,
    rotMembers,
    selectedId,
    sections,
    setSelectedId,
    showToast,
  ])

  const appendOptions = useMemo(
    () => appendSources.map((entry) => ({ value: entry.value, label: entry.label })),
    [appendSources],
  )

  const preambleStates = useMemo(
    () => openingStates(condChoices),
    [condChoices],
  )
  const openingStateCount = preambleStates.length

  const generatePreamble = useCallback((startId: string) => {
    const nextSections = sections.map((section) => (
      section.id === 'preamble'
        ? {
          ...section,
          children: buildPreambleEntries({
            condChoices,
            existing: section.children,
            activeId: actRt?.id ?? startId,
            startId,
          }),
        }
        : section
    ))
    bump(nextSections, 'Generate preamble')
    expandEditorFold('preamble')
    preambleMdl.hide()
    showToast({
      content: `Opened with ${openingStateCount} ${openingStateCount === 1 ? 'state' : 'states'}.`,
      variant: 'success',
      duration: 2400,
    })
  }, [actRt?.id, bump, condChoices, expandEditorFold, openingStateCount, preambleMdl, sections, showToast])

  const featureNodeFor = useCallback((entry: PaletteFeature): EditorStep => {
    return makeFeatureNode(entry, focusedId, rotMembers)
  }, [focusedId, rotMembers])

  // seed new conditions from the standing value, or max when the state is currently zero.
  const seedCondValueAt = useCallback((choice: CondChoice, anchor: CondAnchor) => (
    seedCondValueFor(choice, {
      sections,
      anchor,
      history: result?.history,
      runtimesById: partRtsById,
      activeRuntime: actRt,
    })
  ), [actRt, partRtsById, result, sections])

  const standingCondValueAt = useCallback((choice: CondChoice, anchor: CondAnchor) => (
    standingCondValue(choice, {
      sections,
      anchor,
      history: result?.history,
      runtimesById: partRtsById,
      activeRuntime: actRt,
    })
  ), [actRt, partRtsById, result, sections])

  const paletteNodeFor = useCallback((
    payload: PaletteSpec,
    anchor: CondAnchor,
  ): EditorStep | EditorCondition | EditorHandoff | null => {
    const node = makePaletteNode(
      payload,
      focusedId,
      condChoices,
      (choice) => seedCondValueAt(choice, anchor),
      (choice) => standingCondValueAt(choice, anchor),
      rotMembers,
    )
    if (!node) {
      showToast({
        content: 'That condition is no longer available.',
        variant: 'warning',
        duration: 2400,
      })
    }
    return node
  }, [condChoices, focusedId, rotMembers, seedCondValueAt, showToast, standingCondValueAt])

  // advance the insertion anchor so consecutive additions retain their order.
  const addFeatureNode = useCallback((entry: PaletteFeature) => {
    const node = featureNodeFor(entry)
    bump(insertNode(sections, node, selectedId, 'main'), `Add ${entry.label}`)
    setSelectedId(node.id)
    showToast({ content: `Added ${entry.label}.`, variant: 'success', duration: 2000 })
  }, [bump, featureNodeFor, sections, selectedId, showToast, setSelectedId])

  const addConditionNode = useCallback((choice: CondChoice) => {
    const anchor: CondAnchor = selectedId
      ? { kind: 'after', id: selectedId }
      : { kind: 'end' }
    const node = makeConditionNode(
      choice,
      focusedId,
      seedCondValueAt(choice, anchor),
      standingCondValueAt(choice, anchor),
    )
    bump(insertNode(sections, node, selectedId, 'main'), `Add ${choice.label}`)
    setSelectedId(node.id)
    showToast({ content: `Added ${choice.label}.`, variant: 'success', duration: 2000 })
  }, [
    bump,
    focusedId,
    sections,
    seedCondValueAt,
    selectedId,
    showToast,
    standingCondValueAt,
    setSelectedId,
  ])

  const addContainerNode = useCallback((type: 'loop' | 'repeat') => {
    const node = makeEmptyContainer(sections, type, focusedId)
    bump(insertNode(sections, node, selectedId, 'main'), `Add ${type}`)
    setSelectedId(node.id)
  }, [bump, focusedId, sections, selectedId, setSelectedId])

  const addNoteNode = useCallback(() => {
    const node = makeEmptyNote(sections)
    bumpPresentation(insertNode(sections, node, selectedId, 'main'), 'Add note')
    setSelectedId(node.id)
    setPane('read')
  }, [bumpPresentation, sections, selectedId, setPane, setSelectedId])

  // drag selected rows in execution order.
  const selectionDrag = useMemo(() => ({
    mode: nodeSelection.selectionMode,
    ids: nodeSelection.selectedIdSet,
    inOrder: activeSelectionModel.availableIds.filter((id) => nodeSelection.selectedIdSet.has(id)),
    holds: collectHeldIds(sections, nodeSelection.selectedIdSet),
  }), [
    activeSelectionModel.availableIds,
    nodeSelection.selectedIdSet,
    nodeSelection.selectionMode,
    sections,
  ])

  // record a multi-row relocation as one history entry.
  const moveNodes = useCallback((ids: readonly string[], targetId: string, edge: DropEdge) => {
    const next = relocateNodes(sections, new Set(ids), targetId, edge)
    if (next === sections) {
      return
    }
    bump(next, `Move ${ids.length} nodes`)
  }, [bump, sections])

  const moveNode = useCallback((id: string, targetId: string, edge: DropEdge) => {
    const next = relocateNode(sections, id, targetId, edge)
    // identity return means the relocation was invalid or a no-op.
    if (next === sections) {
      return
    }
    bump(next, 'Move node')
  }, [bump, sections])

  // pointer drops use their explicit target.
  const insertFromPalette = useCallback(
    (spec: PaletteSpec, targetId: string, edge: DropEdge) => {
      const node = paletteNodeFor(spec, { kind: edge, id: targetId })
      if (!node) {
        return
      }
      const next = insertBeside(sections, node, targetId, edge)
      if (next === sections) {
        return
      }

      bump(next, `Add ${spec.label}`)
      setSelectedId(node.id)
      showToast({ content: `Added ${spec.label}.`, variant: 'success', duration: 2000 })
    },
    [bump, paletteNodeFor, sections, showToast, setSelectedId],
  )

  const dropOut = useCallback((id: string) => {
    const node = findNode(sections, id)
    if (!node) {
      return
    }

    const nextSections = (
      node.type === 'loop'
        ? unwrapLoop(sections, node.loopId ?? node.id)
        : removeNode(sections, id)
    )
    bump(nextSections, 'Remove node')
    setSelectedId((current) => (current === id ? null : current))
    showToast({
      content: `Removed ${
        node.type === 'swap'
          ? 'the resonator switch'
          : node.type === 'note'
            ? node.label ?? 'note'
            : node.label
      }.`,
      variant: 'default',
      duration: 2200,
    })
  }, [bump, sections, showToast, setSelectedId])

  const notReady = useCallback((what: string) => {
    showToast({ content: `${what} is not wired up yet.`, variant: 'warning', duration: 2400 })
  }, [showToast])

  // route inspector feature edits through the same canonical node operations.
  /**
   * inside a checked-out loop body, delete removes the node from this pass only:
   * seed the template if needed, remove from `children`, and check in the forked
   * pass. never call plain removeNode on checkoutable loops — that
   * can wipe the only copy when pass state was not seeded.
   */
  const deleteNodeAtView = useCallback((
    current: typeof sections,
    id: string,
  ): typeof sections => {
    const node = findNode(current, id)
    if (!node) {
      return current
    }
    if (node.type === 'loop') {
      return unwrapLoop(current, node.loopId ?? node.id)
    }
    const loop = findEnclosingLoop(current, id)
    if (loop && isCheckoutableLoop(loop)) {
      return removeFromCheckedOutPass(current, editorLoopId(loop), id)
    }
    return removeNode(current, id)
  }, [])

  const deleteSelected = useCallback((ids: readonly string[]) => {
    let next = sections
    for (const id of ids) {
      next = deleteNodeAtView(next, id)
    }
    if (next !== sections) {
      setSelectedId((current) => (
        current && !findNode(next, current) ? null : current
      ))
      bump(next)
    }
    exitNodeSelectionMode()
  }, [bump, deleteNodeAtView, exitNodeSelectionMode, sections])

  /*
    keep editor nodes for exact after-row placement, and write their canonical
    rotation node form to the shared clipboard at the same time. tree, flat and
    sequence surfaces therefore exchange one payload without making the flat
    execution projection into another authored format.
  */
  const [clipboard, setClipboard] = useState<{
    ownerId: string
    nodes: EditorNode[]
  } | null>(null)

  const makeEditorClipboardPayload = useCallback((items: RotationNode[]): RotClipPayload | null => {
    if (!actRt || items.length === 0) return null
    return {
      kind: ROT_CLIP_KIND,
      version: ROT_CLIP_VER,
      source: 'rotation',
      resonatorId: actRt.id,
      resName: members.find((member) => member.id === actRt.id)?.name ?? actRt.id,
      items: cloneRotationNodes(items),
    }
  }, [actRt, members])

  const storeClipboard = useCallback((nodes: readonly EditorNode[]): number => {
    // mint each occurrence before serialization. repeated loop rows point at
    // one authored node, but a flattened copy is an unrolled list and every
    // item in that list needs its own rotation identity.
    const copiedNodes = nodes.map((node) => cloneNode(node))
    const items = editorNodesToRotation(copiedNodes, baselineRotationItems)
    if (nodes.length === 0 || items.length === 0) return 0

    setClipboard({ ownerId: sessionOwnerId, nodes: copiedNodes })
    const payload = makeEditorClipboardPayload(items)
    if (payload) void writeRotClip(payload)
    return items.length
  }, [baselineRotationItems, makeEditorClipboardPayload, sessionOwnerId])

  /** resolve whole authored subtrees in tree order. */
  const liftNodes = useCallback((ids: ReadonlySet<string>): EditorNode[] => {
    return collectSubtrees(sections, ids).filter(canLiftNode)
  }, [sections])

  const copyNodes = useCallback((ids: ReadonlySet<string>) => {
    const nodes = liftNodes(ids)
    if (nodes.length === 0 || storeClipboard(nodes) === 0) return

    showToast({
      content: `Copied ${nodes.length} ${nodes.length === 1 ? 'row' : 'rows'}.`,
      variant: 'success',
      duration: 2000,
    })
  }, [liftNodes, showToast, storeClipboard])

  const cutNodes = useCallback((ids: ReadonlySet<string>) => {
    const nodes = liftNodes(ids)
    if (nodes.length === 0 || storeClipboard(nodes) === 0) return

    const next = removeSubtrees(sections, nodes.map((node) => node.id))
    setSelectedId((current) => (
      current && !findNode(next, current) ? null : current
    ))
    bump(next)
    exitNodeSelectionMode()
    showToast({
      content: `Cut ${nodes.length} ${nodes.length === 1 ? 'row' : 'rows'}.`,
      variant: 'success',
      duration: 2000,
    })
  }, [bump, exitNodeSelectionMode, liftNodes, sections, showToast, storeClipboard])

  // advance the anchor after each paste so copied row order is preserved.
  const pasteNodes = useCallback(async (afterId: string | null) => {
    /*
      rich editor nodes contain source projection and inspection state. they
      are safe for exact same-draft placement, but crossing to another
      context-resonator rotation must rebuild them from the canonical shared
      rotation node payload against that destination's runtime.
    */
    if (!clipboard || clipboard.ownerId !== sessionOwnerId) {
      const payload = await readRotClip()
      if (!payload?.items.length) {
        showToast({
          content: 'There are no rotation entries on the clipboard.',
          variant: 'warning',
          duration: 2200,
        })
        return
      }

      const appended = appendRotationCopies(payload.items)
      const appendedIds = new Set(appended.map((node) => node.id))
      const projectedSections = projectAppendedRotation({
        runtime: actRt,
        runtimesById: partRtsById,
        targetSelections: actTgtSels,
        enemy: enemyProfile,
        members: rotMembers,
        sections,
        append: appended,
        prepWork,
      })
      const pasted = collectSubtrees(projectedSections, appendedIds).filter(canLiftNode)
      if (pasted.length === 0) {
        showToast({
          content: 'Those rotation entries could not be pasted here.',
          variant: 'warning',
          duration: 2200,
        })
        return
      }

      let next = sections
      let anchor = afterId
      for (const node of pasted) {
        next = insertNode(next, node, anchor, 'main')
        anchor = node.id
      }
      bump(next)
      return
    }

    let next = sections
    let anchor = afterId

    for (const node of clipboard.nodes) {
      const copy = cloneNode(node)
      next = insertNode(next, copy, anchor, 'main')
      anchor = copy.id
    }

    bump(next)
  }, [
    actRt,
    actTgtSels,
    bump,
    clipboard,
    enemyProfile,
    partRtsById,
    prepWork,
    rotMembers,
    sessionOwnerId,
    sections,
    showToast,
  ])

  const clipActionsFor = useCallback((id: string) => {
    const node = id ? findNode(sections, id) : null
    return {
      canCopy: node ? canLiftNode(node) : false,
      canPaste: true,
      onCopy: () => copyNodes(new Set([id])),
      onCut: () => cutNodes(new Set([id])),
      onPaste: () => {
        void pasteNodes(id || null)
      },
      onDuplicate: () => bump(duplicateNodes(sections, new Set([id]))),
    }
  }, [bump, copyNodes, cutNodes, pasteNodes, sections])

  // count selected rows before collapsing descendants of selected containers.
  const selectionSummary = useMemo<SelectionSummary | null>(() => {
    if (!nodeSelection.selectionMode) {
      return null
    }

    const counts = new Map<string, number>()
    if (view === 'flat') {
      const selectedEntries = countFlatSelectedEntries(flatRows, nodeSelection.selectedIdSet)
      if (selectedEntries.hits > 0) counts.set('Steps', selectedEntries.hits)
      if (selectedEntries.states > 0) counts.set('States', selectedEntries.states)
      return {
        count: selectedEntries.entries,
        tallies: [...counts]
          .map(([label, tally]) => ({ label, count: tally }))
          .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
      }
    }

    for (const item of activeSelectionModel.items) {
      if (!item.val || !nodeSelection.selectedIdSet.has(item.id)) {
        continue
      }

      const label = SELECTION_KIND_LABELS[item.val.type]
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }

    return {
      count: nodeSelection.selectedIdSet.size,
      tallies: [...counts]
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    }
  }, [activeSelectionModel.items, flatRows, nodeSelection.selectedIdSet, nodeSelection.selectionMode, view])

  const selectionClipTargets = useMemo(
    () => collectSubtrees(sections, nodeSelection.selectedIdSet),
    [nodeSelection.selectedIdSet, sections],
  )

  const flatClipboardNodes = useMemo(() => {
    return collectFlatClipboardNodes(flatRows, nodeSelection.selectedIdSet)
  }, [flatRows, nodeSelection.selectedIdSet])

  const copyFlatNodes = useCallback(() => {
    const copied = storeClipboard(flatClipboardNodes)
    if (copied === 0) return
    showToast({
      content: `Copied ${copied} ${copied === 1 ? 'entry' : 'entries'}.`,
      variant: 'success',
      duration: 2000,
    })
  }, [flatClipboardNodes, showToast, storeClipboard])

  const selectionBranchActions = useMemo<SelectionActions>(() => ({
    hasSelection: nodeSelection.hasSelection,
    onCompare: () => compareNodes(nodeSelection.selectedIdsInOrder),
    canCompare: nodeSelection.selectedCount >= 2,
    compareLabel: nodeSelection.selectedCount > CMP_MAX
      ? `Compare first ${CMP_MAX}`
      : nodeSelection.selectedCount >= 2
        ? `Compare ${nodeSelection.selectedCount}`
        : 'Compare',
    compareHint: 'Compare',
    // refuse the whole selection if any selected node cannot be lifted.
    canCopy: selectionClipTargets.length > 0 && selectionClipTargets.every(canLiftNode),
    canPaste: true,
    onLoopify: () => bump(wrapNodes(sections, nodeSelection.selectedIdSet, 'loop')),
    onBlockify: () => bump(wrapNodes(sections, nodeSelection.selectedIdSet, 'repeat')),
    onCopy: () => copyNodes(nodeSelection.selectedIdSet),
    onCut: () => cutNodes(nodeSelection.selectedIdSet),
    onPaste: () => {
      void pasteNodes(selectionClipTargets.at(-1)?.id ?? null)
    },
    onDuplicate: () => bump(duplicateNodes(sections, nodeSelection.selectedIdSet)),
    onSelectAll: nodeSelection.selectAll,
    onClear: nodeSelection.deselectAll,
    onExit: nodeSelection.exitSelectionMode,
    onDelete: () => deleteSelectedRef.current([...nodeSelection.selectedIdSet]),
  }), [
    bump,
    compareNodes,
    copyNodes,
    cutNodes,
    nodeSelection.deselectAll,
    nodeSelection.exitSelectionMode,
    nodeSelection.hasSelection,
    nodeSelection.selectAll,
    nodeSelection.selectedCount,
    nodeSelection.selectedIdsInOrder,
    nodeSelection.selectedIdSet,
    pasteNodes,
    sections,
    selectionClipTargets,
  ])

  const flatSelectionBranchActions = useMemo<SelectionActions>(() => ({
    hasSelection: nodeSelection.hasSelection,
    onCompare: () => compareNodes(nodeSelection.selectedIdsInOrder),
    canCompare: nodeSelection.selectedCount >= 2,
    compareLabel: nodeSelection.selectedCount > CMP_MAX
      ? `Compare first ${CMP_MAX}`
      : nodeSelection.selectedCount >= 2
        ? `Compare ${nodeSelection.selectedCount}`
        : 'Compare',
    compareHint: 'Compare',
    canCopy: flatClipboardNodes.length > 0,
    canPaste: false,
    onCopy: copyFlatNodes,
    onSelectAll: nodeSelection.selectAll,
    onClear: nodeSelection.deselectAll,
    onExit: nodeSelection.exitSelectionMode,
  }), [
    compareNodes,
    copyFlatNodes,
    flatClipboardNodes.length,
    nodeSelection.deselectAll,
    nodeSelection.exitSelectionMode,
    nodeSelection.hasSelection,
    nodeSelection.selectAll,
    nodeSelection.selectedCount,
    nodeSelection.selectedIdsInOrder,
  ])

  useEffect(() => {
    deleteSelectedRef.current = deleteSelected
    copySelectedRef.current = view === 'flat'
      ? () => copyFlatNodes()
      : (ids) => copyNodes(new Set(ids))
    cutSelectedRef.current = (ids) => cutNodes(new Set(ids))
    pasteSelectedRef.current = () => {
      void pasteNodes(selectionClipTargets.at(-1)?.id ?? selectedId)
    }
  }, [copyFlatNodes, copyNodes, cutNodes, deleteSelected, pasteNodes, selectedId, selectionClipTargets, view])

  const setLoopRun = useCallback((loopId: string, run: number) => {
    updateEditorSession((current) => {
      const nextRuns = clampLoopRunSelections(current.sections, {
        ...current.runsByLoopId,
        [loopId]: run,
      })
      return {
        ...current,
        sections: checkoutLoopPassById(
          current.sections,
          loopId,
          nextRuns[loopId] ?? run,
        ),
        runsByLoopId: nextRuns,
      }
    })
  }, [updateEditorSession])

  const editScopeFor = useCallback((id: string): EditorExecutionScope | null => {
    return findNodeExecutionScope(sections, id, runsByLoopId, 'edit')
  }, [runsByLoopId, sections])

  const actionScopeFor = useCallback((id: string) => {
    const scope = editScopeFor(id)
    return {
      scope,
      scopeColor: scope?.kind === 'loop' ? loopColors.get(scope.loopId) : undefined,
    }
  }, [editScopeFor, loopColors])

  const toggleEnabled = useCallback((
    id: string,
    globalToggle: (current: typeof sections) => typeof sections,
  ) => {
    void id
    bump(globalToggle(sections))
  }, [bump, sections])

  const attachedWrites = useMemo(
    () => attachedWritesOf(selectedStep, condChoices),
    [condChoices, selectedStep],
  )

  const actions = useMemo<StepActions>(() => {
    const id = selectedStep?.id ?? ''
    const featureId = selectedStep?.featureId
    const book = result?.features
    const previousId = featureId ? book?.previous[featureId] : undefined
    const adjacentId = featureId ? book?.adjacent[featureId] : undefined
    const nameOf = (value: string | undefined) => (value && book ? book.label(value) : null)
    const entryFor = (featureId: string | undefined): SkillMenuEntry | null => {
      const member = rotMembers.find((candidate) => candidate.id === selectedStep?.memberId)
      const feature = member?.features.find((candidate) => candidate.id === featureId)
      const skill = member?.skills.find((candidate) => candidate.id === feature?.skillId)
      return member && feature && skill ? {
        featureId: feature.id,
        resonatorId: member.id,
        resName: member.name,
        featureLabel: feature.label,
        feature,
        skill,
        variant: feature.variant ?? 'skill',
        hitIndex: feature.hitIndex,
      } : null
    }

    return {
      ...actionScopeFor(id),
      previousLabel: nameOf(previousId),
      adjacentLabel: nameOf(adjacentId),
      onReplacePrevious: () => {
        const entry = entryFor(previousId)
        if (entry) {
          bump(applyFeatureSelection(sections, id, entry, rotMembers))
        }
      },
      onAddAdjacent: () => {
        if (!adjacentId || !book || !selectedStep) {
          return
        }
        const entry = entryFor(adjacentId)
        if (!entry) return
        const node = makeFeatureNode({
          label: book.label(adjacentId),
          featureId: entry.featureId,
          resonatorId: entry.resonatorId,
          tab: entry.skill.tab,
          color: skillDisplayColor(entry.skill),
          aggregationType: entry.skill.aggregationType,
        }, selectedStep.memberId, rotMembers)
        bump(insertBeside(sections, node, id, 'after'))
      },
      onReplaceAdjacent: () => {
        const entry = entryFor(adjacentId)
        if (entry) {
          bump(applyFeatureSelection(sections, id, entry, rotMembers))
        }
      },
      onEdit: () => {
        if (id) {
          featMenuMdl.show({
            mode: 'edit',
            nodeId: id,
            actMemId: selectedStep?.memberId ?? focusedId,
          })
        }
      },
      onSetCondition: () => {
        if (id) {
          featCondDtrMdl.show({ nodeId: id })
        }
      },
      // attach a newly identified feature node and defer its projection to the next run.
      onAttachFeature: () => {
        if (id) {
          featMenuMdl.show({
            mode: 'add',
            nodeId: id,
            actMemId: selectedStep?.memberId ?? focusedId,
          })
        }
      },
      onDetachFeature: (childId) => {
        if (id) {
          bump(detachFeature(sections, id, childId))
        }
      },
      onAttachedMultiplier: (childId, value) => {
        if (id) {
          bump(setAttachedMultiplier(sections, id, childId, value), undefined, `attached-multiplier:${id}:${childId}`)
        }
      },
      attachedFeatures: selectedStep?.attached ?? [],
      onNegInstances: (value) => {
        if (!id) return
        bump(updateStep(sections, id, (step) => ({
          ...step,
          negativeEffectInstances: Math.max(1, Math.floor(value)),
          negSeriesEdited: true,
        })), undefined, `negative-instances:${id}`)
      },
      onNegStableWidth: (value) => {
        if (!id) return
        bump(updateStep(sections, id, (step) => ({
          ...step,
          negativeEffectStableWidth: Math.max(1, Math.floor(value)),
          negSeriesEdited: true,
        })), undefined, `negative-width:${id}`)
      },
      attached: attachedWrites,
      onSetAttachedValue: (index, value) => {
        bump(setAttachedWriteValue(sections, id, index, value, condChoices), undefined, `attached-value:${id}:${index}`)
      },
      onSetAttachedAction: (index, action) => {
        bump(setAttachedWriteAction(sections, id, index, action, condChoices))
      },
      onRemoveAttached: (index) => {
        bump(removeAttachedWrite(sections, id, index, condChoices))
      },
      onMultiplier: (value) => {
        bump(setStepMultiplier(sections, id, value), undefined, `multiplier:${id}`)
      },
      ...clipActionsFor(id),
      onToggleEnabled: () => {
        toggleEnabled(
          id,
          (current) => updateStep(current, id, (step) => ({ ...step, disabled: !step.disabled })),
        )
      },
      onDelete: () => {
        setSelectedId(null)
        bump(deleteNodeAtView(sections, id))
      },
    }
  }, [
    bump,
    actionScopeFor,
    attachedWrites,
    condChoices,
    deleteNodeAtView,
    result,
    rotMembers,
    featCondDtrMdl,
    featMenuMdl,
    focusedId,
    sections,
    selectedStep,
    setSelectedId,
    toggleEnabled,
    clipActionsFor,
  ])

  const selectedCondition = useMemo(() => {
    const node = findNode(sections, selectedId)
    return node?.type === 'condition' ? node : null
  }, [sections, selectedId])

  const inspectorCondition = useMemo(
    () => selectedCondition && isDisabledOnCurrentRun(selectedCondition)
      ? { ...selectedCondition, disabled: true }
      : selectedCondition,
    [isDisabledOnCurrentRun, selectedCondition],
  )

  const selectedHandoff = useMemo(() => {
    const node = findNode(sections, selectedId)
    return node?.type === 'swap' ? node : null
  }, [sections, selectedId])

  const inspectorHandoff = useMemo(
    () => selectedHandoff && isDisabledOnCurrentRun(selectedHandoff)
      ? { ...selectedHandoff, disabled: true }
      : selectedHandoff,
    [isDisabledOnCurrentRun, selectedHandoff],
  )

  // handoff history is the shared active-resonator path history.
  const history = useMemo(() => {
    const path = selectedHandoff ? ACTIVE_RESONATOR_PATH : selectedCondition?.path
    return path ? result?.history.get(path) ?? [] : []
  }, [result, selectedCondition, selectedHandoff])

  const handoffActions = useMemo<HandoffActions>(() => {
    const id = selectedHandoff?.id ?? ''
    return {
      ...actionScopeFor(id),
      onSetTo: (memberId) => bump(setHandoffTo(sections, id, memberId)),
      onEdit: () => {
        if (id) {
          condDtrMdl.show({ mode: 'edit', nodeId: id })
        }
      },
      ...clipActionsFor(id),
      onToggleEnabled: () => {
        toggleEnabled(
          id,
          (current) => mapNode(current, id, (node) =>
            node.type === 'swap' ? { ...node, disabled: !node.disabled } : node,
          ),
        )
      },
      onDelete: () => {
        setSelectedId(null)
        bump(deleteNodeAtView(sections, id))
      },
    }
  }, [
    bump,
    actionScopeFor,
    deleteNodeAtView,
    condDtrMdl,
    sections,
    selectedHandoff,
    setSelectedId,
    toggleEnabled,
    clipActionsFor,
  ])

  const featureOccurrences = useMemo(
    () => activePane === 'read' && selectedStep?.featureId
      ? findFeatureOccurrences(sections, selectedStep.featureId)
      : [],
    [activePane, sections, selectedStep],
  )

  // changing a modifier's stat preserves its authored value and replaces only the path.
  const modifierChoices = useMemo(
    () => condChoices.filter(isFormulaChoice),
    [condChoices],
  )

  const modifierOptions = useMemo(
    () => modifierChoices.map((choice) => ({ value: choice.state.id, label: choice.label })),
    [modifierChoices],
  )

  const condActions = useMemo<ConditionActions>(() => {
    const id = selectedCondition?.id ?? ''
    return {
      ...actionScopeFor(id),
      onSetModifier: (choiceId) => {
        const choice = modifierChoices.find((entry) => entry.state.id === choiceId)
        if (!choice || !id) {
          return
        }

        const authored = selectedCondition?.writeValue ?? makeCondValue(choice.state)
        const change = selectedCondition?.writeAction === 'add'
          ? makeCondChange(choice, 'add', Number(authored) || 0)
          : makeCondChange(choice, 'set', authored)
        const result = applyConditionChanges(
          sections,
          id,
          [change],
          {
            condChoices,
            focusedId,
            fallbackResId: focusedId,
          },
        )
        bump(result.sections)
        setSelectedId(result.selectedId)
      },
      onSetValue: (value) => bump(setCondValue(sections, id, value), undefined, `condition-value:${id}`),
      onSetAction: (action) => bump(setCondAction(
        sections,
        id,
        action,
      )),
      onEdit: () => {
        if (id) {
          condDtrMdl.show({ mode: 'edit', nodeId: id })
        }
      },
      ...clipActionsFor(id),
      onToggleEnabled: () => {
        toggleEnabled(
          id,
          (current) => mapNode(current, id, (node) =>
            node.type === 'condition' ? { ...node, disabled: !node.disabled } : node,
          ),
        )
      },
      onDelete: () => {
        setSelectedId(null)
        bump(deleteNodeAtView(sections, id))
      },
    }
  }, [
    bump,
    actionScopeFor,
    deleteNodeAtView,
    condDtrMdl,
    condChoices,
    focusedId,
    modifierChoices,
    sections,
    selectedCondition,
    setSelectedId,
    toggleEnabled,
    clipActionsFor,
  ])

  const selectedBlock = useMemo(() => {
    const node = findNode(sections, selectedId)
    // setup branches project data from the corresponding uptime node.
    return node && (node.type === 'loop' || node.type === 'repeat' || node.type === 'uptime')
      ? node
      : null
  }, [sections, selectedId])

  const selectedNote = useMemo<EditorNote | null>(() => {
    if (!selectedId) {
      return null
    }
    const standalone = collectSubtrees(sections, new Set([selectedId]))[0]
    return standalone?.type === 'note' ? standalone : null
  }, [sections, selectedId])

  const inspectorBlock = useMemo(
    () => selectedBlock && isDisabledOnCurrentRun(selectedBlock)
      ? { ...selectedBlock, disabled: true }
      : selectedBlock,
    [isDisabledOnCurrentRun, selectedBlock],
  )

  // aggregate all projected segments that belong to one selected loop.
  const selectedBlockBody = useMemo(() => {
    if (!selectedBlock) {
      return []
    }
    return selectedBlock.type === 'loop'
      ? loopBodyItems(sections, selectedBlock.loopId ?? selectedBlock.id)
      : selectedBlock.children
  }, [sections, selectedBlock])

  // preserve per-pass loop damage separately from its normalized total.
  const blockRunTotals = useMemo(() => {
    return getBlockRunTotals(selectedBlock)
  }, [selectedBlock])

  // normalize loop damage by authored run count to match canonical rotation totals.
  const blockFigure = useMemo(() => {
    return blockAverageDamage(selectedBlock, selectedRun, blockRunTotals)
  }, [blockRunTotals, selectedBlock, selectedRun])

  // notes mutate authored metadata only and cannot recursively own other notes.
  const noteHost = inspectorStep ?? inspectorCondition ?? inspectorHandoff ?? inspectorBlock ?? null
  const attachedNoteActions = (() => {
    if (!noteHost || noteHost.type === 'setup') {
      return null
    }
    const hostId = noteHost.id
    return {
      note: noteHost.attachedNote ?? null,
      onAdd: () => bumpPresentation(attachNote(sections, hostId, makeEmptyNote(sections)), 'Add note'),
      onLabel: (label: string) => {
        const noteId = noteHost.attachedNote?.id
        if (noteId) {
          bumpPresentation(mapNode(sections, noteId, (entry) => (
            entry.type === 'note' ? { ...entry, label: label.trim() || 'Note' } : entry
          )), 'Rename note')
        }
      },
      onWrite: (text: string) => {
        const noteId = noteHost.attachedNote?.id
        if (!noteId) {
          return
        }
        bumpPresentation(mapNode(sections, noteId, (entry) => (
          entry.type === 'note' ? { ...entry, text } : entry
        )), 'Edit note')
      },
      onColor: (color: string | undefined) => {
        const noteId = noteHost.attachedNote?.id
        if (noteId) {
          bumpPresentation(mapNode(sections, noteId, (entry) => (
            entry.type === 'note' ? { ...entry, color } : entry
          )), 'Recolour note')
        }
      },
      onRemove: () => bumpPresentation(detachNote(sections, hostId), 'Remove note'),
    }
  })()

  const standaloneNoteActions = (() => {
    if (!selectedNote) {
      return null
    }
    const id = selectedNote.id
    return {
      note: selectedNote,
      onAdd: () => {},
      onLabel: (label: string) => bumpPresentation(mapNode(sections, id, (entry) => (
        entry.type === 'note' ? { ...entry, label: label.trim() || 'Note' } : entry
      )), 'Rename note'),
      onWrite: (text: string) => bumpPresentation(mapNode(sections, id, (entry) => (
        entry.type === 'note' ? { ...entry, text } : entry
      )), 'Edit note'),
      onColor: (color: string | undefined) => bumpPresentation(mapNode(sections, id, (entry) => (
        entry.type === 'note' ? { ...entry, color } : entry
      )), 'Recolour note'),
      onRemove: () => {
        setSelectedId(null)
        bumpPresentation(deleteNodeAtView(sections, id), 'Delete note')
      },
      nodeActions: clipActionsFor(id),
    }
  })()

  // resolve searchable owner text from the row's resonator identity.
  const searchNames = useMemo((): SearchNames => {
    const memberName = (id: string) =>
      members.find((member) => member.id === id)?.name ?? ''
    return {
      member: memberName,
      owner: (node) => {
        const owner = 'owner' in node ? node.owner : undefined
        if (!owner) {
          return ''
        }
        if (owner.kind === 'echo') {
          const echo = members
            .flatMap((member) => member.echoes ?? [])
            .find((entry) => entry?.id === owner.echoId)
          return echo?.name ?? getEchoById(owner.echoId)?.name ?? 'Echo'
        }
        return memberName(owner.memberId)
      },
    }
  }, [members])

  const readout = useMemo(() => {
    if (inspectorStep) {
      return {
        name: inspectorStep.label,
        value: inspectorStep.disabled ? null : stepDamageAt(inspectorStep, selectedRun),
        color: inspectorStep.aggregationType && inspectorStep.aggregationType !== 'damage'
          ? inspectorStep.color
          : undefined,
      }
    }

    if (inspectorBlock) {
      return {
        name: inspectorBlock.label,
        value: inspectorBlock.disabled ? null : blockFigure,
      }
    }

    if (inspectorCondition) {
      return { name: inspectorCondition.label, value: null }
    }

    if (selectedNote) {
      return { name: selectedNote.label ?? 'Note', value: null }
    }

    return null
  }, [
    blockFigure,
    inspectorBlock,
    inspectorCondition,
    inspectorStep,
    selectedNote,
    selectedRun,
  ])

  // reuse inspector operations for row context actions.
  const rowCtxMenu = useCallback((node: EditorNode): MenuEntry[] => {
    if (nodeSelection.selectionMode) {
      return nodeSelection.selectedIdSet.has(node.id)
        ? makeSelectedNodesMenu(selectionBranchActions, nodeSelection.selectedCount)
        : makeAddToSelectionMenu(() => nodeSelection.addToSelection(node.id), selectionBranchActions)
    }
    const resume = node.type === 'step' ? offTuneResumeScope(sections, node.id) : null
    return makeRowMenu({
    node,
    canLift: canLiftNode(node),
    onLoopify: () => bump(wrapNode(sections, node.id, 'loop')),
    onBlockify: () => bump(wrapNode(sections, node.id, 'repeat')),
    onRemoveEnd: () => {
      if (node.type !== 'loop') {
        return
      }
      bump(removeLoopEnd(sections, node.loopId ?? node.id))
    },
    onToggleEnabled: () => {
      toggleEnabled(
        node.id,
        (current) => node.type === 'loop'
          ? mapLoopBlocks(current, node.loopId ?? node.id, (entry) => ({ ...entry, disabled: !node.disabled }))
          : mapNode(current, node.id, (entry) => (
            entry.type === 'note' ? entry : { ...entry, disabled: !entry.disabled }
          )),
      )
    },
    onDelete: () => {
      setSelectedId(null)
      bump(deleteNodeAtView(sections, node.id))
    },
    edit: {
      ...clipActionsFor(node.id),
      copy: { disabled: !canLiftNode(node), onSelect: () => copyNodes(new Set([node.id])) },
      cut: { disabled: !canLiftNode(node), onSelect: () => cutNodes(new Set([node.id])) },
      paste: {
        disabled: false,
        onSelect: () => {
          void pasteNodes(node.id)
        },
      },
      duplicate: {
        disabled: !canLiftNode(node),
        onSelect: () => bump(duplicateNodes(sections, new Set([node.id]))),
      },
      select: { onSelect: () => nodeSelection.addToSelection(node.id) },
    },
    ...(resume
      ? {
        offTuneResume: {
          marked: resume.marked,
          onSelect: () => setOffTuneResumeAt(node.id, !resume.marked),
        },
      }
      : {}),
  })
  }, [
    bump,
    clipActionsFor,
    copyNodes,
    cutNodes,
    deleteNodeAtView,
    nodeSelection,
    pasteNodes,
    sections,
    selectionBranchActions,
    setSelectedId,
    setOffTuneResumeAt,
    toggleEnabled,
  ])

  const flatRowCtxMenu = useCallback((row: FlatRow): MenuEntry[] => {
    const target = row.target
    if (nodeSelection.selectionMode) {
      return nodeSelection.selectedIdSet.has(target.nodeId)
        ? makeSelectedNodesMenu(flatSelectionBranchActions, nodeSelection.selectedCount)
        : makeAddToSelectionMenu(() => nodeSelection.addToSelection(target.nodeId), flatSelectionBranchActions)
    }
    const copies = collectFlatClipboardNodes([row], new Set([target.nodeId]))
    return [
      { id: `rotation:flat:${target.nodeId}:inspect`, label: 'Inspect this run', icon: <FolderOpen size="1em" />, onSelect: () => selectFlatRow(target) },
      { id: `rotation:flat:${target.nodeId}:copy`, label: 'Copy', icon: <Copy size="1em" />, disabled: copies.length === 0, onSelect: () => {
        const copied = storeClipboard(copies)
        if (copied > 0) showToast({ content: `Copied ${copied} ${copied === 1 ? 'entry' : 'entries'}.`, variant: 'success', duration: 2000 })
      } },
      { id: `rotation:flat:${target.nodeId}:select`, label: 'Select', icon: <SquareDashedMousePointer size="1em" />, onSelect: () => nodeSelection.addToSelection(target.nodeId) },
    ]
  }, [flatSelectionBranchActions, nodeSelection, selectFlatRow, showToast, storeClipboard])

  const pickCtxMenu = useCallback((label: string, add: () => void): MenuEntry[] => makeSelectionMenu({
    label,
    hasSelection: Boolean(selectedId),
    onAdd: add,
    onAddAtEnd: () => {
      setSelectedId(null)
      add()
    },
  }), [selectedId, setSelectedId])

  const blockActions = useMemo<BlockActions>(() => {
    const id = selectedBlock?.id ?? ''
    return {
      ...actionScopeFor(id),
      onEdit: () => notReady(`The ${selectedBlock?.type ?? 'block'} editor`),
      onAddSetup: () => {
        if (selectedBlock?.type === 'repeat') bump(addBlockSetup(sections, selectedBlock.id))
      },
      onRemoveSetup: () => {
        if (selectedBlock?.type !== 'repeat') {
          return
        }
        const next = removeBlockSetup(sections, selectedBlock.id)
        if (next === sections) {
          return
        }
        bump(next, 'Remove setup')
      },
      onRemoveEnd: () => {
        if (selectedBlock?.type !== 'loop' || selectedBlock.noEnd) {
          return
        }
        bump(removeLoopEnd(sections, selectedBlock.loopId ?? selectedBlock.id))
      },
      onRename: (label) => {
        if (!selectedBlock || selectedBlock.type === 'setup') {
          return
        }

        const fallback = selectedBlock.type === 'loop'
          ? 'Loop'
          : selectedBlock.type === 'uptime'
            ? 'Uptime'
            : 'Repeat'
        const next = label.trim() || fallback
        bumpPresentation(selectedBlock.type === 'loop'
          ? mapLoopBlocks(
            sections,
            selectedBlock.loopId ?? selectedBlock.id,
            (node) => ({ ...node, label: next, labelEdited: true }),
          )
          : mapNode(sections, selectedBlock.id, (node) => (
            isEditorBlock(node) ? { ...node, label: next, labelEdited: true } : node
          )), 'Rename block')
      },
      onColor: (color) => {
        if (selectedBlock?.type === 'loop') {
          bumpPresentation(mapLoopBlocks(
            sections,
            selectedBlock.loopId ?? selectedBlock.id,
            (node) => ({ ...node, color, colorEdited: true }),
          ), 'Recolour loop')
        } else if (selectedBlock?.type === 'repeat' || selectedBlock?.type === 'uptime') {
          bumpPresentation(mapNode(sections, selectedBlock.id, (node) => (
            isEditorBlock(node) ? { ...node, color, colorEdited: true } : node
          )), 'Recolour block')
        }
      },
      onValue: (value) => {
        const runs = normLoopRuns(value)
        if (selectedBlock?.type !== 'loop' || runs >= selectedBlock.runs) {
          bump(setBlockValue(sections, id, runs), undefined, `block-runs:${id}`)
          return
        }

        const removed = selectedBlock.runs - runs
        const firstRemoved = runs + 1
        const removedRange = removed === 1
          ? `Run ${firstRemoved}`
          : `Runs ${firstRemoved}-${selectedBlock.runs}`
        confirmation.confirm({
          title: `Remove ${removed} loop ${removed === 1 ? 'run' : 'runs'}?`,
          message: `${removedRange} and ${
            removed === 1 ? 'its' : 'their'
          } authored nodes will be discarded. Re-added runs will inherit from Run ${runs}.`,
          confirmLabel: removed === 1 ? 'Remove run' : 'Remove runs',
          variant: 'danger',
          onConfirm: () => {
            bump(
              setBlockValue(sections, id, runs),
              `Reduce ${selectedBlock.label} to ${runs} runs`,
            )
          },
        })
      },
      onUptime: (value) => {
        bump(setBlockUptime(sections, id, value), undefined, `uptime:${id}`)
      },
      onToggleShut: () => toggleShut(id),
      ...clipActionsFor(id),
      onToggleEnabled: () => {
        toggleEnabled(
          id,
          (current) => selectedBlock?.type === 'loop'
            ? mapLoopBlocks(
              current,
              selectedBlock.loopId ?? selectedBlock.id,
              (node) => ({ ...node, disabled: !selectedBlock.disabled }),
            )
            : mapNode(current, id, (node) =>
              node.type === 'note'
                || node.type === 'step'
                || node.type === 'condition'
                || node.type === 'swap'
                ? node
                : { ...node, disabled: !node.disabled },
            ),
        )
      },
      onDelete: () => {
        setSelectedId(null)
        bump(
          selectedBlock?.type === 'loop'
            ? unwrapLoop(sections, selectedBlock.loopId ?? selectedBlock.id)
            : removeNode(sections, id),
        )
      },
    }
  }, [
    bump,
    bumpPresentation,
    actionScopeFor,
    confirmation,
    notReady,
    sections,
    selectedBlock,
    toggleShut,
    setSelectedId,
    toggleEnabled,
    clipActionsFor,
  ])

  // container drops append into the named block and support otherwise empty containers.
  const dropInto = useCallback((
    containerId: string,
    payload: PaletteSpec | string | readonly string[],
  ) => {
    if (typeof payload === 'string') {
      const next = moveInto(sections, payload, containerId)
      if (next !== sections) {
        bump(next, 'Move node into block')
      }
      return
    }

    if (!('kind' in payload)) {
      const next = moveIntoMany(sections, new Set(payload), containerId)
      if (next !== sections) {
        bump(next, 'Move ' + payload.length + ' nodes into container')
      }
      return
    }

    const node = paletteNodeFor(payload, { kind: 'end', id: containerId })
    if (!node) {
      return
    }
    const next = appendInto(sections, node, containerId)
    if (next === sections) {
      return
    }

    bump(next, `Add ${payload.label}`)
    setSelectedId(node.id)
    showToast({ content: `Added ${payload.label}.`, variant: 'success', duration: 2000 })
  }, [bump, paletteNodeFor, sections, setSelectedId, showToast])

  // resizing a block changes authored containment and therefore records an edit.
  const moveExtent = useCallback((
    blockId: string,
    targetId: string,
    placement: 'after' | 'inside' = 'after',
  ) => {
    const next = setBlockExtent(sections, blockId, targetId, placement)
    if (next === sections) {
      return
    }
    bump(next)
  }, [bump, sections])

  const drag = useNodeDrag({
    members,
    disabled: nodeSelection.selectionMode,
    selection: selectionDrag,
    onMove: moveNode,
    onMoveMany: moveNodes,
    onInsert: insertFromPalette,
    onInto: dropInto,
    onRemove: dropOut,
    onExtent: moveExtent,
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        runRotation()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runRotation])

  if (!activeMember || !result) {
    return (
      <div className="simulation-stage rte-page">
        <p className="rte-empty">No team is set up, so there is no rotation to open.</p>
      </div>
    )
  }

  const portalTarget = mainPortal()
  const featureEditNode = featMenuMdl.value?.nodeId
    ? rotationNodeById(featMenuMdl.value.nodeId)
    : null
  const conditionEditNode = condDtrMdl.value?.nodeId
    ? rotationNodeById(condDtrMdl.value.nodeId)
    : null
  const featureConditionNode = featCondDtrMdl.value?.nodeId
    ? rotationNodeById(featCondDtrMdl.value.nodeId)
    : null
  const defaultFeatureMemberId = featMenuMdl.value?.actMemId ?? selectedStep?.memberId ?? activeMember.id
  const showFeatureSubHits =
    featMenuMdl.value?.mode === 'edit' && featureEditNode?.type === 'feature'
      ? featMetaById[featureEditNode.featureId]?.variant === 'subHit'
      : false

  const saveFeature = (entry: SkillMenuEntry) => {
    const nodeId = featMenuMdl.value?.nodeId
    const label = entry.variant === 'subHit' ? getSubHitLbl(entry) : entry.skill.label
    if (featMenuMdl.value?.mode === 'edit' && nodeId) {
      bump(applyFeatureSelection(sections, nodeId, entry, rotMembers))
      setSelectedId(nodeId)
    } else if (featMenuMdl.value?.mode === 'add' && nodeId) {
      // add mode attaches the selected feature to the node that opened the menu.
      const child = {
        ...makeStep(label, entry.resonatorId),
        featureId: entry.featureId,
        kindLabel: entry.skill.tab,
        element: entry.skill.element,
        color: skillDisplayColor(entry.skill),
        aggregationType: entry.skill.aggregationType,
      }
      bump(attachFeature(sections, nodeId, child))
      setSelectedId(nodeId)
    }
    featMenuMdl.hide()
  }

  const saveCondition = (changes: Parameters<typeof applyConditionChanges>[2]) => {
    const nodeId = condDtrMdl.value?.nodeId
    if (condDtrMdl.value?.mode !== 'edit' || !nodeId) {
      condDtrMdl.hide()
      return
    }

    const previous = findNode(sections, nodeId)
    const previousCondition = previous?.type === 'condition' ? previous : null
    const result = applyConditionChanges(sections, nodeId, changes, {
      condChoices,
      focusedId,
      fallbackResId: previousCondition?.owner.kind === 'member'
        ? previousCondition.owner.memberId
        : activeMember.id,
    })

    bump(result.sections)
    setSelectedId(result.selectedId)
    condDtrMdl.hide()
  }

  // keep the leaving surface mounted until its transition completes.
  const bankUp = drawnSaved || leaving === true
  const sheetUp = !drawnSaved || leaving === false
  const sideMarks = view === 'flat'
    ? ([
      ['totals', 'totals', 'Totals: aggregate rotation damage'],
      ['read', 'details', 'Details for the selected execution entry'],
    ] as const)
    : ([
      ['nodes', 'add', 'Skill list: steps and conditions to add'],
      ['read', 'details', 'Details for the selected rotation item'],
    ] as const)

  const saveFeatureCondition = (changes: Parameters<typeof applyFeatureConditionChanges>[2]) => {
    const nodeId = featCondDtrMdl.value?.nodeId
    if (!nodeId) {
      featCondDtrMdl.hide()
      return
    }

    bump(applyFeatureConditionChanges(sections, nodeId, changes, condChoices))
    setSelectedId(nodeId)
    featCondDtrMdl.hide()
  }

  const getSavedContextItems = (id: string, live: boolean): MenuEntry[] => {
    if (!live && savedSelection.selectionMode) {
      return savedSelection.selectedIdSet.has(id)
        ? makeSelectedNodesMenu(savedSelectionBranchActions, savedSelection.selectedCount)
        : makeAddToSelectionMenu(() => savedSelection.addToSelection(id), savedSelectionBranchActions)
    }
    if (live) return [{
      id: 'saved-rotation:live:open', label: 'Open live rotation',
      icon: <FolderOpen size="1em" />, onSelect: () => selectSavedEntry(id),
    }]
    const entry = invRttn.find((candidate) => candidate.id === id)
    if (!entry) return []
    return [
      { id: `saved-rotation:${id}:open`, label: 'Open details', icon: <FolderOpen size="1em" />, onSelect: () => { selectSavedEntry(id); setSavedPane('read') } },
      { id: `saved-rotation:${id}:rename`, label: 'Rename', icon: <Pencil size="1em" />, onSelect: () => savedEditMdl.show({ kind: 'edit', entryId: id }) },
      { id: `saved-rotation:${id}:duplicate`, label: 'Duplicate', icon: <CopyPlus size="1em" />, onSelect: () => {
        const duplicate = duplicateSavedEntries([entry])[0]
        if (duplicate) setSavedSelId(duplicate.id)
      } },
      { id: `saved-rotation:${id}:share`, label: 'Share or export', icon: <Share2 size="1em" />, onSelect: () => shareMdl.show({ kind: 'saved', entryId: id }) },
      { type: 'separator' },
      { id: `saved-rotation:${id}:copy`, label: 'Copy', icon: <Copy size="1em" />, onSelect: () => { void copySavedEntries([entry]) } },
      { id: `saved-rotation:${id}:cut`, label: 'Cut', icon: <Scissors size="1em" />, onSelect: () => { void cutSavedEntries([entry]) } },
      { id: `saved-rotation:${id}:paste`, label: 'Paste', icon: <ClipboardPaste size="1em" />, onSelect: () => { void pasteSavedEntries() } },
      { type: 'separator' },
      { id: `saved-rotation:${id}:delete`, label: 'Delete', icon: <Trash2 size="1em" />, danger: true, onSelect: () => deleteSavedEntries([entry]) },
    ]
  }

  return (
    <div
      className={`simulation-stage rte-page${consoleOpen ? ' is-console-open' : ''}${
        drag.leaving ? ' is-leaving' : ''
      }${dockPane ? ' is-docked' : ''}${
        (showSavedRotationList ? savedSelection.selectionMode : nodeSelection.selectionMode)
          ? ' selection-mode'
          : ''
      }${
        entering ? ' is-entering' : ''
      }${
        leaving !== null ? ' is-layered is-rolling' : ''
      }`}
      {...drag.discard}
      {...(showSavedRotationList ? savedSelection.surfaceProps : nodeSelection.surfaceProps)}
    >
      <RotationProgramToolbar
        surface={showSavedRotationList ? 'saved' : 'editor'}
        lastSavedView={lastSavedView}
        onSurface={showSavedRots}
        editor={{
          comparing: nodeCmpMode,
          // comparison requires an existing anchor row.
          canCompare: Boolean(selectedId),
          onCompare: toggleNodeCompare,
          canUndo: editHistory.past.length > 0,
          canRedo: editHistory.future.length > 0,
          canClear: canClearRotation,
          canSave: Boolean(actRt),
          canShare: Boolean(actRt && scenario && lastRanAt !== null),
          canCollapse: canCollapseEditor,
          canExpand: canExpandEditor,
          selectionMode: nodeSelection.selectionMode,
          appendOptions,
          onUndo: undoPageEdit,
          onRedo: redoPageEdit,
          onClear: clearRotation,
          onSave: () => savedEditMdl.show({ kind: 'create' }),
          onShare: shareCurrentRotation,
          onCollapse: collapseEditor,
          onExpand: expandEditor,
          onPreamble: () => preambleMdl.show({}),
          onAddLoop: () => addContainerNode('loop'),
          onAddBlock: () => addContainerNode('repeat'),
          onAddNote: addNoteNode,
          onToggleSelection: nodeSelection.selectionMode
            ? nodeSelection.exitSelectionMode
            : nodeSelection.enterSelectionMode,
          onAppend: (value) => {
            const entry = appendSources.find((source) => source.value === value)
            if (entry) appendRotation(entry)
          },
          cleanCount: cleanupPlan?.targets.length ?? null,
          onClean: cleanupRotation,
        }}
        saved={{
          prefs: svdRotPrefs,
          view: savedView === 'groups' ? 'groups' : 'list',
          query: savedQuery,
          count: savedRotationCount,
          selectedRate: savedSelection.selectionMode
            ? null
            : selectedSavedRate ?? (liveRotationSelected ? liveRotationRate : null),
          selectedName: savedSelection.selectionMode
            ? savedSelection.selectedCount > 0
              ? `${savedSelection.selectedCount} saved rotation${savedSelection.selectedCount === 1 ? '' : 's'}`
              : null
            : selectedSavedEntry?.name
              ?? (liveRotationSelected ? liveRotationEntry?.name ?? null : null),
          selectionMode: savedSelection.selectionMode,
          canLoad: !savedSelection.selectionMode && Boolean(selectedSavedEntry),
          canEdit: !savedSelection.selectionMode && Boolean(selectedSavedEntry),
          canDuplicate: savedSelection.selectionMode
            ? savedSelection.hasSelection
            : Boolean(selectedSavedEntry),
          canShare: savedSelection.selectionMode
            ? savedSelection.selectedCount === 1
            : Boolean(selectedSavedEntry),
          canDelete: savedSelection.selectionMode
            ? savedSelection.hasSelection
            : Boolean(selectedSavedEntry),
          canCollapse: canCollapseSavedGroups,
          canExpand: canExpandSavedGroups,
          comparing: compareMode,
          canCompare: savedRotationCount + (liveRotationRow ? 1 : 0) >= 2,
          onPrefs: (patch) => setRotPrefs((current) => ({ ...current, ...patch })),
          onView: (next) => showSavedRots(next),
          onQuery: setSavedQuery,
          onImport: openImport,
          onPaste: () => void pasteSavedEntries(),
          onLoad: loadSavedRotation,
          onEdit: () => {
            if (selectedSavedEntry) {
              savedEditMdl.show({ kind: 'edit', entryId: selectedSavedEntry.id })
            }
          },
          onCompare: toggleCompareMode,
          onToggleSelection: () => {
            if (savedSelection.selectionMode) {
              savedSelection.exitSelectionMode()
            } else {
              // selection and comparison are mutually exclusive row-click modes.
              setCompareMode(false)
              setCompareIds([])
              savedSelection.enterSelectionMode()
            }
          },
          onDuplicate: savedSelection.selectionMode
            ? () => savedSelectionBranchActions.onDuplicate?.()
            : duplicateSavedRotation,
          onShare: () => {
            const entry = savedSelection.selectionMode
              ? savedSelection.selectedVals[0] ?? null
              : selectedSavedEntry
            if (entry) shareMdl.show({ kind: 'saved', entryId: entry.id })
          },
          onDelete: () => {
            if (savedSelection.selectionMode) {
              deleteSavedEntries(savedSelection.selectedVals)
            } else {
              deleteSavedRotation()
            }
          },
          onCollapse: collapseSavedGroups,
          onExpand: expandSavedGroups,
        }}
        search={{
          open: searchOpen,
          onOpenChange: setSearchOpen,
          sections,
          names: searchNames,
          runsByLoopId,
          onPick: navigateVisibleNode,
          stale: simulationDirty,
          readout,
          decimals,
          totalMs: runtimeMs,
          canScrollTo: Boolean(selectedId && readout),
          onScrollTo: () => {
            if (selectedId) navigateVisibleNode({ nodeId: selectedId })
          },
        }}
        display={{
          teamShares,
          statKeys,
          onStatKeys: setStatKeys,
          onDockPane: dockPaneTo,
          onSettings: () => configMdl.show({}),
        }}
        run={{ dirty: simulationDirty, armed: runArmed, onRun: runRotation }}
      />

      <ContextTrigger
        asChild
        ariaLabel="Rotation editor actions"
        getItems={(event) => {
          const target = event.target
          if (bankUp || (target instanceof Element && target.closest('button, input, select, textarea, [role="button"], [role="option"]'))) return []
          if (nodeSelection.selectionMode) return makeSelectedNodesMenu(
            view === 'flat' ? flatSelectionBranchActions : selectionBranchActions,
            nodeSelection.selectedCount,
          )
          return [
            { id: 'rotation:blank:add-loop', label: 'Add loop', icon: <RotateCwSquare size="1em" />, disabled: nodeSelection.selectionMode, onSelect: () => addContainerNode('loop') },
            { id: 'rotation:blank:add-block', label: 'Add block', icon: <ListPlus size="1em" />, disabled: nodeSelection.selectionMode, onSelect: () => addContainerNode('repeat') },
            { id: 'rotation:blank:add-note', label: 'Add note', icon: <MessageSquarePlus size="1em" />, disabled: nodeSelection.selectionMode, onSelect: addNoteNode },
            { type: 'separator' },
            { id: 'rotation:blank:paste', label: 'Paste', icon: <ClipboardPaste size="1em" />, onSelect: () => { void pasteNodes(selectedId) } },
            { id: 'rotation:blank:run', label: 'Run rotation', icon: <Play size="1em" />, disabled: !actRt, onSelect: runRotation },
            { id: 'rotation:blank:save', label: 'Save rotation', icon: <Save size="1em" />, disabled: !actRt, onSelect: () => savedEditMdl.show({ kind: 'create' }) },
            { id: 'rotation:blank:settings', label: 'Rotation settings', icon: <Settings size="1em" />, onSelect: () => configMdl.show({}) },
          ]
        }}
      >
      <div className="rte-body"
        ref={bodyRef}
        style={{ '--rte-note-res': leaderAccent } as CSSProperties}
      >
        <i className="rte-leader" ref={leaderRef} aria-hidden="true" />

        {/* key by surface identity so transitions do not remount the leaving tree. */}
        {bankUp ? (
          <div className={`rte-surface ${leaving === true ? 'is-going' : 'is-coming'}`}>
          <Suspense fallback={<AppLoaderOverlay text="Loading saved rotations..." />}><SavedList
            entries={invRttn}
            live={liveRotationRow}
            prefs={svdRotPrefs}
            view={savedView === 'groups' ? 'groups' : 'list'}
            selectedId={savedSelId}
            onSelect={selectSavedEntry}
            getContextItems={getSavedContextItems}
            panel={savedPane}
            dockPanel={dockPane}
            onPanelChange={setSavedPane}
            // reuse the page's completed run for the live saved-surface entry.
            selectedRun={liveRotationSelected ? result : selectedSavedRun}
            summariesById={savedSummariesById}
            loading={savedBatch.key !== savedBatchKey}
            query={deferredSavedQuery}
            shutGroupIds={savedShutGroupIds}
            onGroupOpenChange={setSavedGroupOpen}
            compare={{
              mode: compareMode,
              ids: compareIds,
              runsById: compareRuns,
              full: compareIds.length >= CMP_MAX - 1,
              onToggle: toggleCompareEntry,
              onExit: exitCompareMode,
            }}
            selection={{
              mode: savedSelection.selectionMode,
              selectedIds: savedSelection.selectedIdSet,
              summary: savedSelectionSummary,
              actions: savedSelectionBranchActions,
              buildClickCapture: (id) => savedSelection.buildClickCapture(id, {
                onCapture: () => setSavedPane('read'),
              }),
            }}
          /></Suspense>
          </div>
        ) : null}

        {sheetUp ? (
          <div className={`rte-surface ${leaving === false ? 'is-going' : 'is-coming'}`}>
        {view === 'flat' ? (
          <Suspense fallback={<AppLoaderOverlay text="Loading rotation steps..." />}><FlatList
            rows={flatRows}
            members={members}
            statKeys={statKeys}
            groupOrder={groupOrder}
            shutGroups={shutGroups}
            onToggleGroup={toggleGroup}
            decimals={decimals}
            percentDisplay={percentDisplay}
            selectedId={selectedId}
            runsByLoopId={runsByLoopId}
            selectionMode={nodeSelection.selectionMode}
            selectedIds={nodeSelection.selectedIdSet}
            compareMode={nodeCmpMode}
            compareMark={nodeCmpMark}
            onCompareToggle={toggleNodeCompareEntry}
            onSelect={selectFlatRow}
            onAddSelection={nodeSelection.addToSelection}
            onRangeSelection={nodeSelection.addRangeToSelection}
            onToggleSelection={nodeSelection.toggleSelection}
            rowMenu={flatRowCtxMenu}
            onOffTuneResume={setOffTuneResumeAt}
            offTuneAuthoring={offTuneAuthoring}
            revealRequest={revealRequest}
          /></Suspense>
        ) : (
        <NodeList
          sections={sections}
          members={members}
          runsByLoopId={runsByLoopId}
          peakDamage={peakDamage}
          selectedId={selectedId}
          selectionMode={nodeSelection.selectionMode}
          compareMode={nodeCmpMode}
          compareMark={nodeCmpMark}
          onCompareToggle={toggleNodeCompareEntry}
          selectedIds={nodeSelection.selectedIdSet}
          revealRequest={revealRequest}
          shutIds={shutIds}
          staleIds={staleNodeIds}
          ghostRepeats={ghostRepeats}
          showPriors={showPriors}
          onOpenChange={setEditorFold}
          onSelect={selectRow}
          onAddSelection={nodeSelection.addToSelection}
          onRangeSelection={nodeSelection.addRangeToSelection}
          onToggleSelection={nodeSelection.toggleSelection}
          onRunChange={setLoopRun}
          statKeys={statKeys}
          groupOrder={groupOrder}
          shutGroups={shutGroups}
          onToggleGroup={toggleGroup}
          decimals={decimals}
          percentDisplay={percentDisplay}
          rowMenu={rowCtxMenu}
          onOffTuneResume={setOffTuneResumeAt}
          offTuneAuthoring={offTuneAuthoring}
          drag={drag}
        />
        )}

        {view === 'tree' ? <Palette
          onAddFeature={addFeatureNode}
          onAddCondition={addConditionNode}
          pickMenu={pickCtxMenu}
          disabled={nodeSelection.selectionMode}
          open={activePane === 'nodes'}
        /> : null}

        {nodeCmpAnchor ? (
          <aside
            ref={noteRef}
            className={`rte-inspector${activePane === 'read' ? ' is-out' : ''}`}
            inert={activePane !== 'read'}
            aria-label={`${nodeCmpAnchor.label}, comparison details`}
            style={{
              '--rte-res': nodeCmpAnchor.accent,
              ...(nodeCmpAnchor.step?.aggregationType
                && nodeCmpAnchor.step.aggregationType !== 'damage'
                ? { '--avg': nodeCmpAnchor.accent }
                : {}),
            } as CSSProperties}
          >
            <ReadInspector
              node={nodeCmpAnchor}
              decimals={decimals}
              percentDisplay={percentDisplay}
            />
          </aside>
        ) : view === 'flat' && !selectionSummary ? (
          flatSelectedRead ? (
            <aside
              ref={noteRef}
              className={`rte-inspector${activePane === 'read' ? ' is-out' : ''}`}
              inert={activePane !== 'read'}
              aria-label={`${flatSelectedRead.label}, details`}
              style={{
                '--rte-res': flatSelectedRead.accent,
                ...(flatSelectedRead.step?.aggregationType
                  && flatSelectedRead.step.aggregationType !== 'damage'
                  ? { '--avg': flatSelectedRead.accent }
                  : {}),
              } as CSSProperties}
            >
              <ReadInspector
                node={flatSelectedRead}
                decimals={decimals}
                percentDisplay={percentDisplay}
              />
            </aside>
          ) : null
        ) : (
        <Inspector
          open={activePane === 'read'}
          panelRef={noteRef}
          onAccent={setNoteAccent}
          noteActions={standaloneNoteActions ?? attachedNoteActions}
          note={selectedNote}
          step={inspectorStep}
          condition={inspectorCondition}
          block={inspectorBlock}
          handoff={inspectorHandoff}
          blockRunTotals={blockRunTotals}
          blockShut={selectedBlock ? shutIds.has(selectedBlock.id) : false}
          blockTotal={inspectorBlock?.disabled ? 0 : blockFigure}
          blockBody={selectedBlockBody}
          blockSteps={stepCount(selectedBlockBody)}
          blockActions={blockActions}
          handoffActions={handoffActions}
          selection={selectionSummary}
          selectionActions={view === 'flat' ? flatSelectionBranchActions : selectionBranchActions}
          history={history}
          modifierOptions={modifierOptions}
          featureOccurrences={featureOccurrences}
          runsByLoopId={runsByLoopId}
          loopColors={loopColors}
          run={selectedRun}
          member={activeMember}
          members={members}
          buildActions={buildActions}
          buffs={buffs}
          summary={fullBasis ? result.fullSummary : result.summary}
          // normalize row share against the per-pass rotation total.
          totalAvg={result.totals.avg}
          decimals={decimals}
          actions={actions}
          condActions={condActions}
          onRunChange={(nextRun) => {
            if (selectedScope?.kind === 'loop') {
              setLoopRun(selectedScope.loopId, nextRun)
            }
          }}
          onNavigateNode={navigateToNode}
          showTotalsView={view !== 'flat'}
        />
        )}

        {view === 'flat' ? (
          <RotationTotalsPanel
            open={activePane === 'totals'}
            summary={fullBasis ? result.fullSummary : result.summary}
            members={members}
            buildActions={buildActions}
            decimals={decimals}
          />
        ) : null}

        {nodeComparePanels.map(({ id, index, leaving }) => {
          const read = nodeCmpReads.get(id)
          if (!read) {
            return null
          }

          return (
            <aside
              key={id}
              className={[
                'rte-inspector rte-cmp',
                activePane === 'read' ? 'is-out' : '',
                leaving ? 'is-leaving' : '',
              ].filter(Boolean).join(' ')}
              inert={leaving || activePane !== 'read'}
              aria-label={`${read.label}, compared`}
              style={{
                '--rte-res': read.accent,
                ...(read.step?.aggregationType
                  && read.step.aggregationType !== 'damage'
                  ? { '--avg': read.accent }
                  : {}),
                '--rte-cmp-k': index + 1,
              } as React.CSSProperties}
            >
              <ReadInspector
                node={read}
                decimals={decimals}
                percentDisplay={percentDisplay}
              />
            </aside>
          )
        })}

        <div className="rte-marks" role="group" aria-label="Side notes">
          {sideMarks.map(([channel, label, hint]) => (
            <button
              key={channel}
              type="button"
              className={`rte-mark rte-mark--${channel}`}
              aria-pressed={activePane === channel}
              title={hint}
              onClick={() => {
  // closing the inspector channel also exits comparison mode.
                if (channel === 'read' && nodeCmpMode) {
                  exitNodeCompare()
                }
                setPane((current) => (
                  current === channel && !dockPane ? null : channel
                ))
              }}
            >
              {label}
            </button>
          ))}
        </div>
        </div>
        ) : null}
      </div>
      </ContextTrigger>

      {leaving !== null ? <i className="rte-roller" aria-hidden="true" /> : null}

      <div className="rte-totals">
        <div className="rte-cell rte-cell--hero">
          <span className="rte-cell__lbl">average</span>
          <b className="rte-cell__val">{formatDamage(displayedTotals.avg, decimals)}</b>
        </div>

        <div className="rte-cell">
          <span className="rte-cell__lbl">normal</span>
          <b className="rte-cell__val">{formatDamage(displayedTotals.normal, decimals)}</b>
        </div>
        <div className="rte-cell">
          <span className="rte-cell__lbl">crit</span>
          <b className="rte-cell__val">{formatDamage(displayedTotals.crit, decimals)}</b>
        </div>
        {displayedSupportTotals.healing !== 0 ? (
          <div className="rte-cell rte-cell--healing">
            <span className="rte-cell__lbl">heal</span>
            <b className="rte-cell__val">{formatDamage(displayedSupportTotals.healing, decimals)}</b>
          </div>
        ) : null}
        {displayedSupportTotals.shield !== 0 ? (
          <div className="rte-cell rte-cell--shield">
            <span className="rte-cell__lbl">shield</span>
            <b className="rte-cell__val">{formatDamage(displayedSupportTotals.shield, decimals)}</b>
          </div>
        ) : null}

        <span className="rte-cell rte-cell--bay" aria-hidden="true" />

        <div className="rte-cell">
          <span className="rte-cell__lbl">{showSavedRotationList ? 'saved' : 'ran in'}</span>
          <b className="rte-cell__val">
            {showSavedRotationList ? savedRotationCount : `${runtimeMs} ms`}
          </b>
        </div>


        <button
          type="button" className="rte-cnstoggle"
          aria-expanded={consoleOpen}
          aria-controls="rte-console-panel"
          onClick={() => setConsoleOpen((open) => !open)}
        >
          timeline
          <ChevronDown className="rte-cnstoggle__chev" size="0.7rem" aria-hidden="true" />
        </button>
      </div>

      <div className="rte-cns" id="rte-console-panel">
        {consoleOpen ? <Suspense fallback={<AppLoaderOverlay mode="inline" text="Loading timeline..." />}><RotationConsole
          model={consoleModel}
          members={consoleMembers}
          decimals={decimals}
          selectedId={showSavedRotationList ? null : selectedId}
          onSelect={showSavedRotationList ? undefined : navigateVisibleNode}
          caption={consoleCaption}
          emptyNote={consoleEmpty}
        /></Suspense> : null}
      </div>

      <ConfirmHost control={confirmation} portalTarget={portalTarget} />

      <ConfigModal
        key={showSavedRotationList ? 'saved-config' : 'rotation-config'}
        state={{
          visible: configMdl.visible,
          open: configMdl.open,
          closing: configMdl.closing,
        }}
        settings={{
          view,
          onView: setNodeListView,
          ghostRepeats,
          onGhostRepeats: (value) => setEditorPreferences({ ghostRepeats: value }),
          showPriors,
          onShowPriors: (value) => setEditorPreferences({ showPriors: value }),
          statKeys,
          onStatKeys: setStatKeys,
          groupOrder,
          onGroupOrder: setGroupOrder,
          dockPane,
          onDockPane: dockPaneTo,
          damageBasis,
          onDamageBasis: (value) => setEditorPreferences({ damageBasis: value }),
          decimals,
          onDecimals: (value) => setEditorPreferences({ decimals: value }),
        }}
        onClose={configMdl.hide}
      />

      <RotationShareModal
        visible={shareMdl.visible}
        open={shareMdl.open}
        closing={shareMdl.closing}
        entry={sharedRotationEntry}
        onClose={shareMdl.hide}
      />

      <SavedRotationEditModal
        key={savedEditMdl.value?.kind === 'edit'
          ? `edit:${savedEditMdl.value.entryId}`
          : savedEditMdl.value?.kind ?? 'closed'}
        visible={savedEditMdl.visible}
        open={savedEditMdl.open}
        closing={savedEditMdl.closing}
        mode={savedEditMdl.value?.kind ?? 'create'}
        initial={editedSavedEntry ?? {
          name: liveSavedRotationName,
          duration: 0,
          note: '',
        }}
        onClose={savedEditMdl.hide}
        onSave={(changes) => {
          const mode = savedEditMdl.value?.kind
          if (mode === 'edit') {
            if (!editedSavedEntry) {
              showToast({
                content: 'That saved rotation no longer exists.',
                variant: 'error',
                duration: 2600,
              })
              return
            }
            updInvRot(editedSavedEntry.id, changes)
          } else if (mode === 'create' && actRt) {
            const scenarioSnapshot = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
            scenarioSnapshot.program = {
              ...scenarioSnapshot.program,
              program: editedRotationItems(actRt, sections),
            }
            const saved = addInvRot({
              ...changes,
              scenario: scenarioSnapshot,
            })
            if (saved) setSavedSelId(saved.id)
          } else {
            return
          }
          savedEditMdl.hide()
          showToast({
            content: mode === 'edit'
              ? `Updated "${changes.name}".`
              : `Saved "${changes.name}".`,
            variant: 'success',
            duration: 2400,
          })
        }}
      />

      <StartMemberModal
        visible={preambleMdl.visible}
        open={preambleMdl.open}
        closing={preambleMdl.closing}
        portalTarget={portalTarget}
        members={members}
        activeId={activeMember.id}
        states={preambleStates}
        onClose={preambleMdl.hide}
        onConfirm={generatePreamble}
      />

      <RotationSkillMenu
        key={featMenuMdl.value ? `${featMenuMdl.value.mode}:${featMenuMdl.value.nodeId ?? 'new'}` : 'skill-menu:closed'}
        visible={featMenuMdl.visible}
        open={featMenuMdl.open}
        closing={featMenuMdl.closing}
        portalTarget={portalTarget}
        members={editableMembers}
        actMemId={defaultFeatureMemberId}
        defShowSubwy={showFeatureSubHits}
        onActMemChng={(resonatorId) =>
          featMenuMdl.update((prev) => ({ ...prev, actMemId: resonatorId }))
        }
        onClose={featMenuMdl.hide}
        onSlctSkll={saveFeature}
      />

      <Condition
        key={condDtrMdl.value ? `${condDtrMdl.value.mode}:${condDtrMdl.value.nodeId ?? 'new'}` : 'condition-editor:closed'}
        visible={condDtrMdl.visible}
        open={condDtrMdl.open}
        closing={condDtrMdl.closing}
        portalTarget={portalTarget}
        choices={condChoices}
        ntlChng={conditionEditNode?.type === 'condition' ? conditionEditNode.changes : EMPTY_FEATURE_CONDS}
        featureLabel="Edit Condition"
        eyebrow="Rotation Conditions"
        emptyText="Select states from the picker to add a condition to the rotation list."
        onClose={condDtrMdl.hide}
        onSave={saveCondition}
        seedValue={(choice) => seedCondValueAt(
          choice,
          condDtrMdl.value?.nodeId
            ? { kind: 'before', id: condDtrMdl.value.nodeId }
            : { kind: 'end' },
        )}
      />

      <Condition
        key={featCondDtrMdl.value?.nodeId ?? 'feature-condition-editor:closed'}
        visible={featCondDtrMdl.visible}
        open={featCondDtrMdl.open}
        closing={featCondDtrMdl.closing}
        portalTarget={portalTarget}
        choices={condChoices}
        ntlChng={
          featureConditionNode?.type === 'feature'
            ? attachedConditionChanges(featureConditionNode)
            : EMPTY_FEATURE_CONDS
        }
        featureLabel={
          featureConditionNode?.type === 'feature'
            ? featMetaById[featureConditionNode.featureId]?.label ?? featureConditionNode.featureId
            : 'Feature'
        }
        onClose={featCondDtrMdl.hide}
        onSave={saveFeatureCondition}
        seedValue={(choice) => seedCondValueAt(
          choice,
          featCondDtrMdl.value?.nodeId
            ? { kind: 'before', id: featCondDtrMdl.value.nodeId }
            : { kind: 'end' },
        )}
      />
    </div>
  )
}
