/*
  Author: Runor Ewhro
  Description: Owns pane behavior and state transitions for the sequence editor module.
*/

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavX } from '@/app/nav/useNavX'
import {
  Copy,
  ListChecks,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Trash2,
  WrapText,
} from 'lucide-react'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { AdvancedRotationMigration } from '@/domain/state/advancedRotationMigration.ts'
import { cloneRotationNodes } from '@/domain/entities/inventoryStorage.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { listResRttn } from '@/domain/services/gameDataService.ts'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { useAppModalValue } from '@/shared/ui/useAppModal.ts'
import { useConfirm } from '@/app/hooks/useConfirmation.ts'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal.tsx'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { bodyPortal, mainPortal } from '@/shared/lib/portalTarget.ts'
import { SIMULATION_ROUTES } from '@/shared/lib/appRoutes'
import { RotationSkillMenu } from '@/modules/simulation/features/rotation/shared/RotationSkillMenu.tsx'
import { SequenceNode } from './components/SequenceNode.tsx'
import { ProgramMigrationModal } from './components/ProgramMigrationModal.tsx'
import { SequenceDragPreview } from './components/SequenceNodeDetails.tsx'
import type {
  FeatureMenuState,
  FeatureMeta,
} from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import type {
  RotationDropTarget,
  RotationInsertTarget,
} from '@/domain/gameData/rotationTree.ts'
import {
  collectRotationSubtrees,
  isRotationSequence,
  isRotationSequenceNode,
  makeRotationRepeatMeta,
  type RotationSequenceNode,
} from './model/sequence.ts'
import {
  readRotClip,
  ROT_CLIP_KIND,
  ROT_CLIP_VER,
  writeRotClip,
  type RotClipPayload,
} from '@/modules/simulation/features/rotation/shared/rotationClipboard.ts'
import {
  collectRotIds,
  indexRotNodes,
  removeRotNodes,
  findRotNode,
  moveRotNode,
  insertRotNode,
  insertRotNodes,
  removeRotNode,
  mapRotGroups,
  updateRotNode,
} from '@/domain/gameData/rotationTree.ts'
import { blckRotTms, dupRotTms } from './model/transforms.ts'
import {
  makeBlockNode,
} from '@/modules/simulation/features/rotation/shared/nodeTools.ts'
import { makeNodeId } from '@/domain/gameData/rotationNodeId.ts'
import {
  adjacentFeatures,
  presentRotMembers,
  priorFeatures,
  makeFeatureMeta,
} from '@/modules/simulation/features/rotation/shared/catalog.ts'
import { useSel, type SelAct } from '@/modules/simulation/lib/sel.tsx'
import { useAppStore } from '@/domain/state/store.ts'

const ROTATION_SELECTION_SCOPE = 'rotation-pane-selection'
const ENTRANCE_WINDOW_MS = 900

function collectVisibleNodes(
  items: readonly RotationNode[],
  collapsedIds: Readonly<Record<string, boolean>>,
): string[] {
  const visibleIds: string[] = []

  const visit = (node: RotationNode): void => {
    visibleIds.push(node.id)
    if (collapsedIds[node.id]) return

    if (node.type === 'repeat') {
      node.items.forEach(visit)
    } else if (node.type === 'uptime') {
      node.setup?.forEach(visit)
      node.items.forEach(visit)
    }
  }

  items.forEach(visit)
  return visibleIds
}

interface RotationSequenceEditorProps {
  runtime: ResRuntime
  simulation: SimResult | null
  onRtPdt: (updater: (runtime: ResRuntime) => ResRuntime) => void
}

export function RotationSequenceEditor({
  runtime,
  simulation,
  onRtPdt,
}: RotationSequenceEditorProps) {
  const seed = seedRsntById[runtime.id]
  const navigate = useNavX()
  const portalTarget = mainPortal()
  const confirmation = useConfirm()
  const showToast = useTstStr((state) => state.show)
  const featureMenu = useAppModalValue<FeatureMenuState>()
  const migrationModal = useAppModalValue<AdvancedRotationMigration[]>()
  const showMigrationModal = migrationModal.show
  const migrateAdvancedRotations = useAppStore(
    (state) => state.migrateAdvancedRotations,
  )
  const acknowledgeAdvancedRotationMigrations = useAppStore(
    (state) => state.acknowledgeAdvancedRotationMigrations,
  )
  const setRotationEditorPreferences = useAppStore((state) => state.setRotEditorPrefs)
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({})
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null)
  const [entranceSettled, setEntranceSettled] = useState(false)

  useEffect(() => {
    const migrations = migrateAdvancedRotations()
    if (migrations.length > 0) {
      showMigrationModal(migrations)
    }
  }, [migrateAdvancedRotations, showMigrationModal])

  const authoredItems = runtime.rotation.sequence
  const supportsCompactEditor = useMemo(
    () => isRotationSequence(authoredItems, runtime.id),
    [authoredItems, runtime.id],
  )
  const items = useMemo<RotationSequenceNode[]>(
    () => isRotationSequence(authoredItems, runtime.id) ? authoredItems : [],
    [authoredItems, runtime.id],
  )
  const acknowledgeMigrations = useCallback(() => {
    acknowledgeAdvancedRotationMigrations(
      (migrationModal.value ?? []).map((migration) => migration.savedRotation.id),
    )
    migrationModal.hide()
  }, [acknowledgeAdvancedRotationMigrations, migrationModal])

  useEffect(() => {
    const timer = window.setTimeout(() => setEntranceSettled(true), ENTRANCE_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const members = useMemo(
    () => presentRotMembers(runtime),
    [runtime],
  )
  const featureMetaById = useMemo<Record<string, FeatureMeta>>(
    () => makeFeatureMeta(members),
    [members],
  )
  const adjacentFeatureById = useMemo(() => adjacentFeatures(members), [members])
  const previousFeatureById = useMemo(() => priorFeatures(members), [members])
  const resultMap = useMemo(() => {
    const map = new Map<string, SimResult['perSkill']>()
    for (const entry of simulation?.rotation.sequence.entries ?? []) {
      if (!entry.nodeId) continue
      const current = map.get(entry.nodeId) ?? []
      current.push(entry)
      map.set(entry.nodeId, current)
    }
    return map
  }, [simulation])

  const updateItems = useCallback((updater: (items: RotationNode[]) => RotationNode[]) => {
    onRtPdt((previous) => ({
      ...previous,
      rotation: {
        ...previous.rotation,
        sequence: updater(previous.rotation.sequence),
      },
    }))
  }, [onRtPdt])

  const clearDrag = useCallback(() => {
    setDraggedId(null)
    setDragOverKey(null)
    setDragPointer(null)
  }, [])

  useEffect(() => {
    if (!draggedId) {
      document.body.style.cursor = ''
      return
    }

    const handleDrag = (event: globalThis.DragEvent) => {
      if (event.clientX === 0 && event.clientY === 0) return
      setDragPointer({ x: event.clientX, y: event.clientY })
    }

    document.body.style.cursor = 'grabbing'
    window.addEventListener('dragover', handleDrag)
    return () => {
      document.body.style.cursor = ''
      window.removeEventListener('dragover', handleDrag)
    }
  }, [draggedId])

  const allNodeIds = useMemo(() => collectRotIds(items), [items])
  const visibleNodeIds = useMemo(
    () => collectVisibleNodes(items, collapsedIds),
    [collapsedIds, items],
  )
  const nodesById = useMemo(() => indexRotNodes(items), [items])
  const selectionItems = useMemo(
    () => allNodeIds.map((id) => ({ id, val: nodesById.get(id) })).filter(
      (entry): entry is { id: string; val: RotationNode } => Boolean(entry.val),
    ),
    [allNodeIds, nodesById],
  )

  const copySelectionRef = useRef<() => Promise<void>>(async () => {})
  const cutSelectionRef = useRef<() => Promise<void>>(async () => {})
  const deleteSelectionRef = useRef<() => void>(() => {})
  const wrapSelectionRef = useRef<() => void>(() => {})
  const pasteRootRef = useRef<() => Promise<void>>(async () => {})
  const selectionActions = useMemo<Array<SelAct<string, RotationNode>>>(() => [
    {
      id: 'rotation-copy',
      label: 'Copy',
      icon: <Copy size="1em" />,
      key: 'copy',
      needsSel: true,
      run: () => copySelectionRef.current(),
    },
    {
      id: 'rotation-cut',
      label: 'Cut',
      icon: <Scissors size="1em" />,
      key: 'cut',
      needsSel: true,
      run: () => cutSelectionRef.current(),
    },
    {
      id: 'rotation-wrap',
      label: 'Repeat',
      icon: <WrapText size="1em" />,
      needsSel: true,
      run: () => wrapSelectionRef.current(),
    },
    {
      id: 'rotation-paste',
      label: 'Paste',
      icon: <Plus size="1em" />,
      key: 'paste',
      float: false,
      run: () => pasteRootRef.current(),
    },
    {
      id: 'rotation-delete',
      label: 'Delete',
      icon: <Trash2 size="1em" />,
      key: 'delete',
      needsSel: true,
      danger: true,
      run: () => deleteSelectionRef.current(),
    },
  ], [])

  const selection = useSel({
    active: supportsCompactEditor,
    surfaceId: ROTATION_SELECTION_SCOPE,
    ariaLabel: 'Rotation selection actions',
    items: selectionItems,
    ord: visibleNodeIds,
    av: allNodeIds,
    allIds: items.map((node) => node.id),
    acts: selectionActions,
  })

  const makeClipboardPayload = useCallback((items: RotationNode[]): RotClipPayload => ({
    kind: ROT_CLIP_KIND,
    version: ROT_CLIP_VER,
    source: 'rotation',
    resonatorId: runtime.id,
    resName: seed?.name ?? runtime.id,
    items: cloneRotationNodes(items),
  }), [runtime.id, seed?.name])

  const copyNodes = useCallback(async (items: RotationSequenceNode[]) => {
    if (items.length === 0) return
    const written = await writeRotClip(makeClipboardPayload(items))
    showToast({
      content: written
        ? `Copied ${items.length} item${items.length === 1 ? '' : 's'}.`
        : 'The rotation could not be copied.',
      variant: written ? 'success' : 'warning',
      duration: 2200,
    })
  }, [makeClipboardPayload, showToast])

  const selectedSubtrees = useCallback(() => (
    collectRotationSubtrees(items, selection.selectedIdSet)
  ), [items, selection.selectedIdSet])

  const copySelection = useCallback(async () => {
    await copyNodes(selectedSubtrees())
  }, [copyNodes, selectedSubtrees])

  const cutSelection = useCallback(async () => {
    const selected = selectedSubtrees()
    if (selected.length === 0) return
    if (!await writeRotClip(makeClipboardPayload(selected))) return
    updateItems((items) => removeRotNodes(items, selection.selectedIdSet))
    selection.exitSelectionMode()
    showToast({
      content: `Cut ${selected.length} item${selected.length === 1 ? '' : 's'}.`,
      variant: 'success',
      duration: 2200,
    })
  }, [makeClipboardPayload, selectedSubtrees, selection, showToast, updateItems])

  const deleteSelection = useCallback(() => {
    if (!selection.hasSelection) return
    updateItems((items) => removeRotNodes(items, selection.selectedIdSet))
    selection.exitSelectionMode()
  }, [selection, updateItems])

  const wrapIds = useCallback((ids: ReadonlySet<string>) => {
    if (ids.size === 0) return
    updateItems((items) => {
      if (!isRotationSequence(items, runtime.id)) return items
      const meta = makeRotationRepeatMeta(items)
      return mapRotGroups(items, ids, (nodes) => blckRotTms(nodes, 'repeat', {
        label: meta.label,
        color: meta.color,
      }))
    })
  }, [runtime.id, updateItems])

  const wrapSelection = useCallback(() => {
    wrapIds(selection.selectedIdSet)
    selection.exitSelectionMode()
  }, [selection, wrapIds])

  const pasteAt = useCallback(async (target: RotationInsertTarget) => {
    const payload = await readRotClip()
    if (!payload || !isRotationSequence(payload.items, runtime.id)) {
      showToast({
        content: 'Only features and repeat blocks can be pasted here.',
        variant: 'warning',
        duration: 2800,
      })
      return
    }

    const pasted = cloneRotationNodes(payload.items, { freshIds: true })
    updateItems((items) => insertRotNodes(items, target, pasted))
    showToast({
      content: `Pasted ${pasted.length} item${pasted.length === 1 ? '' : 's'}.`,
      variant: 'success',
      duration: 2200,
    })
  }, [runtime.id, showToast, updateItems])

  useEffect(() => {
    copySelectionRef.current = copySelection
    cutSelectionRef.current = cutSelection
    deleteSelectionRef.current = deleteSelection
    wrapSelectionRef.current = wrapSelection
    pasteRootRef.current = () => pasteAt({ parentId: null, branch: 'root' })
  }, [copySelection, cutSelection, deleteSelection, pasteAt, wrapSelection])

  const nodeIdsForAction = useCallback((nodeId: string): ReadonlySet<string> => (
    selection.selectionMode && selection.selectedIdSet.has(nodeId)
      ? selection.selectedIdSet
      : new Set([nodeId])
  ), [selection.selectedIdSet, selection.selectionMode])

  const addRepeat = useCallback((target: RotationInsertTarget) => {
    updateItems((items) => {
      if (!isRotationSequence(items, runtime.id)) return items
      const meta = makeRotationRepeatMeta(items)
      return insertRotNode(items, target, makeBlockNode('repeat', {
        label: meta.label,
        color: meta.color,
      }))
    })
  }, [runtime.id, updateItems])

  const updateNode = useCallback((nodeId: string, updater: (node: RotationNode) => RotationNode) => {
    updateItems((items) => updateRotNode(items, nodeId, updater))
  }, [updateItems])

  const deleteNode = useCallback((nodeId: string) => {
    const ids = nodeIdsForAction(nodeId)
    updateItems((items) => ids.size === 1 ? removeRotNode(items, nodeId) : removeRotNodes(items, ids))
    if (selection.selectionMode) selection.exitSelectionMode()
  }, [nodeIdsForAction, selection, updateItems])

  const duplicateNode = useCallback((nodeId: string) => {
    const ids = nodeIdsForAction(nodeId)
    updateItems((items) => dupRotTms(items, ids))
    if (selection.selectionMode) selection.exitSelectionMode()
  }, [nodeIdsForAction, selection, updateItems])

  const copyNode = useCallback((nodeId: string) => {
    const ids = nodeIdsForAction(nodeId)
    void copyNodes(collectRotationSubtrees(items, ids))
  }, [copyNodes, nodeIdsForAction, items])

  const cutNode = useCallback(async (nodeId: string) => {
    const ids = nodeIdsForAction(nodeId)
    const nodes = collectRotationSubtrees(items, ids)
    if (nodes.length === 0 || !await writeRotClip(makeClipboardPayload(nodes))) return
    updateItems((items) => removeRotNodes(items, ids))
    if (selection.selectionMode) selection.exitSelectionMode()
  }, [makeClipboardPayload, nodeIdsForAction, items, selection, updateItems])

  const wrapNode = useCallback((nodeId: string) => {
    wrapIds(nodeIdsForAction(nodeId))
    if (selection.selectionMode) selection.exitSelectionMode()
  }, [nodeIdsForAction, selection, wrapIds])

  const insertNode = useCallback((target: RotationInsertTarget, node: RotationSequenceNode) => {
    updateItems((items) => insertRotNode(items, target, node))
  }, [updateItems])

  const moveNode = useCallback((nodeId: string, target: RotationDropTarget) => {
    if (!nodeId) return
    updateItems((items) => moveRotNode(items, nodeId, target))
    clearDrag()
  }, [clearDrag, updateItems])

  const addRootFeature = useCallback(() => {
    featureMenu.show({
      mode: 'add',
      actMemId: runtime.id,
      target: { parentId: null, branch: 'root' },
    })
  }, [featureMenu, runtime.id])

  const loadPreset = useCallback(() => {
    if (!seed) return
    const preset = seed.rotations?.[0] ?? listResRttn(seed.id)[0]
    if (!preset || !isRotationSequence(preset.items, runtime.id)) {
      showToast({
        content: 'This resonator does not have a compatible preset.',
        variant: 'warning',
        duration: 2800,
      })
      return
    }

    const apply = () => updateItems(() => cloneRotationNodes(preset.items))
    if (items.length === 0) {
      apply()
      return
    }
    confirmation.confirm({
      title: 'Load rotation preset?',
      message: 'This replaces the current rotation.',
      confirmLabel: 'Load',
      variant: 'danger',
      onConfirm: apply,
    })
  }, [confirmation, items.length, runtime.id, seed, showToast, updateItems])

  const clearRotation = useCallback(() => {
    confirmation.confirm({
      title: 'Clear rotation?',
      message: 'This removes every feature and repeat block.',
      confirmLabel: 'Clear',
      variant: 'danger',
      onConfirm: () => updateItems(() => []),
    })
  }, [confirmation, updateItems])

  const editedFeature = featureMenu.value?.nodeId
    ? findRotNode(items, featureMenu.value.nodeId)
    : null
  const showSubHits = editedFeature?.type === 'feature'
    ? featureMetaById[editedFeature.featureId]?.variant === 'subHit'
    : false
  const dragged = draggedId ? findRotNode(items, draggedId) : null
  const draggedNode: RotationSequenceNode | null = dragged && isRotationSequenceNode(dragged, runtime.id)
    ? dragged as RotationSequenceNode
    : null
  const draggedFeature = draggedNode?.type === 'feature' ? draggedNode : null
  const draggedRepeat = draggedNode?.type === 'repeat' ? draggedNode : null
  const rootDropKey = 'sequence:root:end'
  const rootContextItems: MenuEntry[] = supportsCompactEditor ? [
    { id: 'add-feature', label: 'Feature', icon: <Plus size="1em" />, onSelect: addRootFeature },
    {
      id: 'add-repeat',
      label: 'Repeat',
      icon: <RefreshCw size="1em" />,
      onSelect: () => addRepeat({ parentId: null, branch: 'root' }),
    },
    { type: 'separator' },
    { id: 'paste', label: 'Paste', icon: <Plus size="1em" />, onSelect: () => void pasteAt({ parentId: null, branch: 'root' }) },
    { id: 'select', label: 'Select', icon: <ListChecks size="1em" />, onSelect: selection.enterSelectionMode },
    { type: 'separator' },
    { id: 'preset', label: 'Preset', icon: <RotateCcw size="1em" />, onSelect: loadPreset },
    { id: 'clear', label: 'Clear', icon: <Trash2 size="1em" />, danger: true, onSelect: clearRotation },
  ] : []

  const dragPortal = bodyPortal()
  const showDragPreview = Boolean(
    draggedNode && dragPointer && (dragPointer.x !== 0 || dragPointer.y !== 0),
  )

  return (
    <ContextTrigger asChild ariaLabel="Rotation actions" items={rootContextItems}>
      <section
        className={`calc-pane rotation-pane${selection.selectionMode ? ' selection-mode' : ''}${entranceSettled ? ' entrance-settled' : ''}`}
        {...selection.focusProps}
      >
        <header className="echoes-pane-header rotation-pane-header">
          <div className="echoes-pane-title weapon-effect__bar">
            <span className="weapon-effect__sigil" aria-hidden="true" />
            <span className="weapon-effect__titles">
              <span className="weapon-effect__tag">Sequence</span>
              <span className="weapon-effect__name">Rotation</span>
            </span>
          </div>
        </header>

        {supportsCompactEditor ? (
          <>
            <div className="pane-section rotation-pane-controls">
              <div className="rotation-toolbar">
                <div className="rotation-toolbar-group">
                  <button type="button" className="rotation-button" onClick={addRootFeature}>
                    <Plus size="0.875rem" />
                    Feature
                  </button>
                  <button type="button" className="rotation-button" onClick={() => addRepeat({ parentId: null, branch: 'root' })}>
                    <Plus size="0.875rem" />
                    Repeat
                  </button>
                </div>
                <div className="rotation-toolbar-group">
                  <button type="button" className="rotation-button" onClick={selection.enterSelectionMode}>
                    <ListChecks size="0.875rem" />
                    Select
                  </button>
                  <button type="button" className="rotation-button" onClick={loadPreset}>
                    <RotateCcw size="0.875rem" />
                    Preset
                  </button>
                  <button type="button" className="rotation-button clear" disabled={items.length === 0} onClick={clearRotation}>
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <div className="rotation-entries-list">
              <div
                className={`rotation-list-container${dragOverKey === rootDropKey ? ' drag-over' : ''}`}
                {...selection.scopeProps}
                onDragOver={(event) => {
                  if (!draggedNode) return
                  event.preventDefault()
                  setDragOverKey(rootDropKey)
                }}
                onDragLeave={() => setDragOverKey(null)}
                onDrop={(event) => {
                  if (!draggedId) return
                  event.preventDefault()
                  moveNode(draggedId, {
                    parentId: null,
                    branch: 'root',
                    index: items.length,
                    key: rootDropKey,
                  })
                }}
              >
                {items.length > 0 ? items.map((node, index) => (
                  <SequenceNode
                    key={node.id}
                    runtime={runtime}
                    node={node}
                    depth={0}
                    parentId={null}
                    index={index}
                    resultMap={resultMap}
                    featMetaById={featureMetaById}
                    adjacentFeatureById={adjacentFeatureById}
                    previousFeatureById={previousFeatureById}
                    collapsedIds={collapsedIds}
                    draggedId={draggedId}
                    draggedNode={draggedNode}
                    dragOverKey={dragOverKey}
                    selectedIds={selection.selectedIdSet}
                    selectionMode={selection.selectionMode}
                    portalTarget={portalTarget}
                    onDragStart={setDraggedId}
                    onDragEnd={clearDrag}
                    onDragOver={setDragOverKey}
                    onMoveNode={moveNode}
                    onInsertNode={insertNode}
                    onToggleCollapsed={(nodeId) => setCollapsedIds((previous) => ({
                      ...previous,
                      [nodeId]: !(previous[nodeId] ?? false),
                    }))}
                    onUpdateNode={updateNode}
                    onDeleteNode={deleteNode}
                    onDuplicateNode={duplicateNode}
                    onCopyNode={copyNode}
                    onCutNode={(nodeId) => void cutNode(nodeId)}
                    onPasteAt={(target) => void pasteAt(target)}
                    onWrapNode={wrapNode}
                    onOpenFeature={featureMenu.show}
                    onAddRepeat={addRepeat}
                    onAddSelection={selection.addToSelection}
                    onRangeSelection={selection.addRangeToSelection}
                    onToggleSelection={selection.toggleSelection}
                  />
                )) : (
                  <div className="soft-empty">Add a feature to begin the rotation.</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="pane-section">
            <div className="soft-empty">
              This rotation contains advanced entries and cannot be edited in this pane.
            </div>
          </div>
        )}

        <RotationSkillMenu
          key={featureMenu.value ? `${featureMenu.value.mode}:${featureMenu.value.nodeId ?? 'new'}` : 'skill-menu:closed'}
          visible={featureMenu.visible}
          open={featureMenu.open}
          closing={featureMenu.closing}
          portalTarget={portalTarget}
          members={members}
          actMemId={runtime.id}
          defShowSubwy={showSubHits}
          onActMemChng={() => {}}
          onClose={featureMenu.hide}
          onSlctSkll={(entry) => {
            if (featureMenu.value?.mode === 'edit' && featureMenu.value.nodeId) {
              updateNode(featureMenu.value.nodeId, (current) => current.type === 'feature'
                ? { ...current, featureId: entry.featureId, resonatorId: runtime.id }
                : current)
            } else {
              insertNode(featureMenu.value?.target ?? { parentId: null, branch: 'root' }, {
                id: makeNodeId('rotation:feature'),
                type: 'feature',
                resonatorId: runtime.id,
                featureId: entry.featureId,
                multiplier: 1,
                enabled: true,
              })
            }
            featureMenu.hide()
          }}
        />

        <ProgramMigrationModal
          visible={migrationModal.visible}
          open={migrationModal.open}
          closing={migrationModal.closing}
          portalTarget={portalTarget}
          migrations={migrationModal.value ?? []}
          onClose={acknowledgeMigrations}
          onViewSaved={() => {
            setRotationEditorPreferences({ savedView: 'list' })
            acknowledgeMigrations()
            navigate(SIMULATION_ROUTES.rotation)
          }}
        />

        <ConfirmHost control={confirmation} portalTarget={portalTarget} />

        {showDragPreview && dragPortal && dragPointer ? createPortal(
          <div
            className={`rotation-drag-overlay${draggedRepeat ? ' over-block' : ''}`}
            style={{ left: dragPointer.x + 18, top: dragPointer.y + 12 }}
          >
            {draggedFeature ? (
              <SequenceDragPreview
                node={draggedFeature}
                resultMap={resultMap}
                featMetaById={featureMetaById}
              />
            ) : draggedRepeat ? (
              <article className="rotation-item rotation-block rotation-drag-preview ui-surface-card ui-surface-card--inner">
                <div className="block-header">
                  <div className="rotation-entry-main">
                    <span className="entry-name">{draggedRepeat.label ?? 'Repeat'}</span>
                    <span className="rotation-entry-sub">
                      {draggedRepeat.times}× · {draggedRepeat.items.length} item{draggedRepeat.items.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </article>
            ) : null}
          </div>,
          dragPortal,
        ) : null}
      </section>
    </ContextTrigger>
  )
}
