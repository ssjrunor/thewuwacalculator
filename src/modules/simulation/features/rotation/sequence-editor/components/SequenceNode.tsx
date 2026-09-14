/*
  Author: Runor Ewhro
  Description: Renders feature and repeat nodes in a rotation sequence.
*/

import type { DragEvent, MouseEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Scissors,
  Trash2,
  WrapText,
} from 'lucide-react'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { NumberInput } from '@/modules/simulation/features/controls/NumberInput.tsx'
import { SequenceNodeDetails, InlineAddMenu, SequenceNodeTotals } from './SequenceNodeDetails.tsx'
import type {
  FeatureMeta,
  FeatureMenuState,
} from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import type {
  RotationDropTarget,
  RotationInsertTarget,
} from '@/domain/gameData/rotationTree.ts'
import type { RotationSequenceNode } from '../model/sequence.ts'
import {
  getFeatLblCl,
  getNodeTotals,
  getTrnsDragM,
} from '@/modules/simulation/features/rotation/shared/nodeTools.ts'
import { makeNodeId } from '@/domain/gameData/rotationNodeId.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'

interface SequenceNodeProps {
  runtime: ResRuntime
  node: RotationSequenceNode
  depth: number
  parentId: string | null
  index: number
  resultMap: Map<string, SimResult['perSkill']>
  featMetaById: Record<string, FeatureMeta>
  adjacentFeatureById: Record<string, string | undefined>
  previousFeatureById: Record<string, string | undefined>
  collapsedIds: Record<string, boolean>
  draggedId: string | null
  draggedNode: RotationSequenceNode | null
  dragOverKey: string | null
  selectedIds: ReadonlySet<string>
  selectionMode: boolean
  portalTarget: HTMLElement | null
  onDragStart: (nodeId: string) => void
  onDragEnd: () => void
  onDragOver: (key: string | null) => void
  onMoveNode: (nodeId: string, target: RotationDropTarget) => void
  onInsertNode: (target: RotationInsertTarget, node: RotationSequenceNode) => void
  onToggleCollapsed: (nodeId: string) => void
  onUpdateNode: (nodeId: string, updater: (node: RotationNode) => RotationNode) => void
  onDeleteNode: (nodeId: string) => void
  onDuplicateNode: (nodeId: string) => void
  onCopyNode: (nodeId: string) => void
  onCutNode: (nodeId: string) => void
  onPasteAt: (target: RotationInsertTarget) => void
  onWrapNode: (nodeId: string) => void
  onOpenFeature: (state: FeatureMenuState) => void
  onAddRepeat: (target: RotationInsertTarget) => void
  onAddSelection: (nodeId: string) => void
  onRangeSelection: (nodeId: string) => void
  onToggleSelection: (nodeId: string) => void
}

export function SequenceNode(props: SequenceNodeProps) {
  const {
    runtime,
    node,
    depth,
    parentId,
    index,
    resultMap,
    featMetaById,
    adjacentFeatureById,
    previousFeatureById,
    collapsedIds,
    draggedId,
    draggedNode,
    dragOverKey,
    selectedIds,
    selectionMode,
    portalTarget,
    onDragStart,
    onDragEnd,
    onDragOver,
    onMoveNode,
    onInsertNode,
    onToggleCollapsed,
    onUpdateNode,
    onDeleteNode,
    onDuplicateNode,
    onCopyNode,
    onCutNode,
    onPasteAt,
    onWrapNode,
    onOpenFeature,
    onAddRepeat,
    onAddSelection,
    onRangeSelection,
    onToggleSelection,
  } = props

  const branch = parentId ? 'items' as const : 'root' as const
  const collapsed = collapsedIds[node.id] ?? false
  const disabled = !(node.enabled ?? true)
  const selected = selectedIds.has(node.id)
  const dragKey = `${parentId ?? 'root'}:${branch}:${index}`
  const addBelow: RotationInsertTarget = { parentId, branch, index: index + 1 }
  const canDrop = draggedNode != null

  const sharedDragProps = {
    draggable: !selectionMode && draggedId !== node.id,
    onDragStart: (event: DragEvent<HTMLDivElement>) => {
      if (selectionMode) return
      event.stopPropagation()
      event.dataTransfer.effectAllowed = 'move'
      const dragImage = getTrnsDragM()
      if (dragImage) event.dataTransfer.setDragImage(dragImage, 0, 0)
      onDragStart(node.id)
    },
    onDragEnd,
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!canDrop) return
      event.preventDefault()
      event.stopPropagation()
      onDragOver(dragKey)
    },
    onDragLeave: () => onDragOver(null),
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (!draggedId || draggedId === node.id) return
      event.preventDefault()
      event.stopPropagation()
      onMoveNode(draggedId, { parentId, branch, index, key: dragKey })
    },
  }

  const selectionClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    if (event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      onRangeSelection(node.id)
      return
    }
    if (selectionMode) {
      event.preventDefault()
      event.stopPropagation()
      onToggleSelection(node.id)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      event.stopPropagation()
      onAddSelection(node.id)
    }
  }

  const toggleEnabled = () => onUpdateNode(node.id, (current) => (
    current.type === 'feature' || current.type === 'repeat'
      ? { ...current, enabled: !(current.enabled ?? true) }
      : current
  ))

  const addMenu: MenuEntry[] = [
    {
      id: 'add-feature-below',
      label: 'Feature',
      icon: <Plus size="1em" />,
      onSelect: () => onOpenFeature({ mode: 'add', actMemId: runtime.id, target: addBelow }),
    },
    {
      id: 'add-repeat-below',
      label: 'Repeat',
      icon: <RefreshCw size="1em" />,
      onSelect: () => onAddRepeat(addBelow),
    },
  ]

  const editMenu: MenuEntry[] = [
    {
      id: 'add-below',
      label: 'Add below',
      icon: <Plus size="1em" />,
      submenu: addMenu,
    },
    {
      id: 'wrap-repeat',
      label: 'Wrap in repeat',
      icon: <WrapText size="1em" />,
      onSelect: () => onWrapNode(node.id),
    },
    { type: 'separator' },
    { id: 'copy', label: 'Copy', icon: <Copy size="1em" />, onSelect: () => onCopyNode(node.id) },
    { id: 'cut', label: 'Cut', icon: <Scissors size="1em" />, onSelect: () => onCutNode(node.id) },
    { id: 'paste', label: 'Paste below', icon: <Plus size="1em" />, onSelect: () => onPasteAt(addBelow) },
    { id: 'duplicate', label: 'Duplicate', icon: <Copy size="1em" />, onSelect: () => onDuplicateNode(node.id) },
    {
      id: 'select',
      label: selected ? 'Selected' : 'Select',
      disabled: selected,
      onSelect: () => onAddSelection(node.id),
    },
    { type: 'separator' },
    {
      id: 'toggle-enabled',
      label: disabled ? 'Enable' : 'Disable',
      icon: disabled ? <PowerOff size="1em" /> : <Power size="1em" />,
      onSelect: toggleEnabled,
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size="1em" />,
      danger: true,
      onSelect: () => onDeleteNode(node.id),
    },
  ]

  const cardProps = {
    depth,
    disabled,
    selected,
    selMode: selectionMode,
    focusItem: true,
    isDragOver: dragOverKey === dragKey,
    isDragging: draggedId === node.id,
    onClick: selectionClick,
    ctxMenuTms: editMenu,
    ctxMenuArigs: node.type === 'feature' ? 'Feature actions' : 'Repeat actions',
    ...sharedDragProps,
  }

  if (node.type === 'feature') {
    const meta = featMetaById[node.featureId]
    const totals = getNodeTotals(node, resultMap)
    const previousFeatureId = previousFeatureById[node.featureId]
    const adjacentFeatureId = adjacentFeatureById[node.featureId]

    const replaceFeature = (featureId: string) => onUpdateNode(node.id, (current) => (
      current.type === 'feature' ? { ...current, featureId } : current
    ))
    const addAdjacent = () => {
      if (!adjacentFeatureId) return
      onInsertNode({
        parentId,
        branch,
        index: index + 1,
      }, {
        id: makeNodeId('rotation:feature'),
        type: 'feature',
        resonatorId: runtime.id,
        featureId: adjacentFeatureId,
        multiplier: 1,
        enabled: true,
      })
    }

    const featureMenu: MenuEntry[] = [
      ...(previousFeatureId ? [{
        id: 'replace-previous',
        label: 'Previous feature',
        icon: <ChevronsLeft size="1em" />,
        onSelect: () => replaceFeature(previousFeatureId),
      } satisfies MenuEntry] : []),
      ...(adjacentFeatureId ? [{
        id: 'add-adjacent',
        label: 'Add next feature',
        icon: <ChevronsDown size="1em" />,
        onSelect: addAdjacent,
      } satisfies MenuEntry, {
        id: 'replace-adjacent',
        label: 'Next feature',
        icon: <ChevronsRight size="1em" />,
        onSelect: () => replaceFeature(adjacentFeatureId),
      } satisfies MenuEntry] : []),
      {
        id: 'edit-feature',
        label: 'Change feature',
        icon: <Pencil size="1em" />,
        onSelect: () => onOpenFeature({ mode: 'edit', actMemId: runtime.id, nodeId: node.id }),
      },
      ...editMenu,
    ]

    if (!meta) {
      return (
        <SequenceNodeDetails {...cardProps} ctxMenuTms={editMenu}>
          <article className="rotation-item rotation-item--orphaned">
            <div className="rotation-entry-main">
              <span className="entry-name rotation-skill-name">Invalid Feature</span>
            </div>
            <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
              <Trash2 size=".6em" />
            </button>
          </article>
        </SequenceNodeDetails>
      )
    }

    return (
      <SequenceNodeDetails {...cardProps} ctxMenuTms={featureMenu}>
        <article className="rotation-item">
          <div className="rotation-header">
            <div className="rotation-entry-main">
              <span className="entry-name rotation-skill-name" style={{ color: getFeatLblCl(meta) }}>
                {meta.label}
              </span>
            </div>
            <div className="rotation-node-actions">
              {previousFeatureId ? (
                <button type="button" className="block-icon-button" title="Previous feature" onClick={() => replaceFeature(previousFeatureId)}>
                  <ChevronsLeft size=".6em" />
                </button>
              ) : null}
              {adjacentFeatureId ? (
                <>
                  <button type="button" className="block-icon-button" title="Add next feature" onClick={addAdjacent}>
                    <ChevronsDown size=".6em" />
                  </button>
                  <button type="button" className="block-icon-button" title="Next feature" onClick={() => replaceFeature(adjacentFeatureId)}>
                    <ChevronsRight size=".6em" />
                  </button>
                </>
              ) : null}
              <button
                type="button" className="block-icon-button"
                title="Change feature"
                onClick={() => onOpenFeature({ mode: 'edit', actMemId: runtime.id, nodeId: node.id })}
              >
                <Pencil size=".6em" />
              </button>
              <InlineAddMenu
                portalTarget={portalTarget}
                onAddFeature={() => onOpenFeature({ mode: 'add', actMemId: runtime.id, target: addBelow })}
                onAddRepeat={() => onAddRepeat(addBelow)}
              />
              <button type="button" className="block-icon-button power" title={disabled ? 'Enable' : 'Disable'} onClick={toggleEnabled}>
                {disabled ? <PowerOff size=".6em" /> : <Power size=".6em" />}
              </button>
              <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                <Trash2 size=".6em" />
              </button>
            </div>
          </div>
          <div className="rotation-footer">
            <SequenceNodeTotals totals={totals} ggrgType={meta.ggrgType} />
            <div className="rotation-inline-field ui-inline-field">
              <span className="entry-detail-text rotation-skill-type-label">{meta.skillTypeLabel}</span>
              <span className="rotation-multiplier-symbol">×</span>
              <NumberInput
                min={1}
                step={1}
                value={Math.max(1, Math.floor(node.multiplier ?? 1))}
                onChange={(value) => onUpdateNode(node.id, (current) => (
                  current.type === 'feature'
                    ? { ...current, multiplier: Math.max(1, Math.floor(value || 1)) }
                    : current
                ))}
              />
            </div>
          </div>
        </article>
      </SequenceNodeDetails>
    )
  }

  const bodyKey = `${node.id}:items:end`
  const bodyTarget: RotationInsertTarget = { parentId: node.id, branch: 'items' }
  const bodyDragOver = dragOverKey === bodyKey
  const totals = getNodeTotals(node, resultMap)
  const repeatMenu: MenuEntry[] = [
    {
      id: 'toggle-collapse',
      label: collapsed ? 'Expand' : 'Collapse',
      icon: collapsed ? <ChevronRight size="1em" /> : <ChevronDown size="1em" />,
      onSelect: () => onToggleCollapsed(node.id),
    },
    ...editMenu,
  ]

  return (
    <SequenceNodeDetails {...cardProps} ctxMenuTms={repeatMenu}>
      <article
        className={`rotation-item rotation-block${bodyDragOver ? ' drag-hovered' : ''}`}
      >
        <div className="block-header">
          <div className="rotation-entry-main">
            <span className="entry-name">{node.label ?? 'Repeat'}</span>
          </div>
          <div className="rotation-node-actions">
            <div className="rotation-inline-field ui-inline-field">
              <span className="rotation-multiplier-symbol">×</span>
              <NumberInput
                min={1}
                step={1}
                value={node.times}
                onChange={(value) => onUpdateNode(node.id, (current) => (
                  current.type === 'repeat'
                    ? { ...current, times: Math.max(1, Math.floor(value || 1)) }
                    : current
                ))}
              />
            </div>
            <button type="button" className="rotation-collapse-button" title={collapsed ? 'Expand' : 'Collapse'} onClick={() => onToggleCollapsed(node.id)}>
              {collapsed ? <ChevronRight size="1em" /> : <ChevronDown size="1em" />}
            </button>
            <InlineAddMenu
              portalTarget={portalTarget}
              onAddFeature={() => onOpenFeature({ mode: 'add', actMemId: runtime.id, target: bodyTarget })}
              onAddRepeat={() => onAddRepeat(bodyTarget)}
            />
            <button type="button" className="block-icon-button power" title={disabled ? 'Enable' : 'Disable'} onClick={toggleEnabled}>
              {disabled ? <PowerOff size=".6em" /> : <Power size=".6em" />}
            </button>
            <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
              <Trash2 size=".6em" />
            </button>
          </div>
        </div>

        {collapsed ? null : (
          <div className="block-body expanded">
            <div
              className={`rotation-block-items${bodyDragOver ? ' drag-over' : ''}`}
              onDragOver={(event) => {
                if (!draggedNode) return
                event.preventDefault()
                event.stopPropagation()
                onDragOver(bodyKey)
              }}
              onDragLeave={() => onDragOver(null)}
              onDrop={(event) => {
                if (!draggedId) return
                event.preventDefault()
                event.stopPropagation()
                onMoveNode(draggedId, {
                  parentId: node.id,
                  branch: 'items',
                  index: node.items.length,
                  key: bodyKey,
                })
              }}
            >
              {node.items.length > 0 ? node.items.map((child, childIndex) => (
          <SequenceNode
                  {...props}
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  parentId={node.id}
                  index={childIndex}
                />
              )) : (
                <div className="soft-empty">Add a feature or another repeat.</div>
              )}
            </div>
          </div>
        )}
        <div className="rotation-footer">
          <SequenceNodeTotals totals={totals} />
        </div>
      </article>
    </SequenceNodeDetails>
  )
}
