/*
  Author: Runor Ewhro
  Description: Renders the tree node surface for the calculator rotation flow.
*/

import type {ResRuntime} from "@/domain/entities/runtime.ts";
import type {RotationNode} from "@/domain/gameData/contracts.ts";
import type {
  CondChoice, CondDtrStt, FeatCondStt, FeatMenuStt,
  FeatureMeta, NegFfctCnfgS,
  RotBrnc,
  RotDragArea, RotDropTgt, EditConfig, RotNsrtTgt
} from "@/modules/calculator/features/rotation/lib/types.ts";
import type {RotLoopMrkrI} from "@/modules/calculator/features/rotation/lib/loops.ts";
import type {RotBlckType} from "@/modules/calculator/features/rotation/lib/transforms.ts";
import type {SimResult} from "@/engine/pipeline/types.ts";
import {canNsrtNodeI, getBrncLngt} from "@/modules/calculator/features/rotation/lib/tree.ts";
import * as React from "react";
import type {MenuEntry} from "@/shared/ui/CtxMenu.tsx";
import {getNegFfctTt} from "@/domain/gameData/negativeEffects.ts";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight as RightChevrons,
  Infinity as InfinityIcon,
  Pencil, Plus,
  Power,
  PowerOff,
  Trash2, RefreshCw, Play, Square, RotateCcw, TextQuote
} from "lucide-react";
import {PiPlusBold} from "react-icons/pi";
import {GrLinkDown} from "react-icons/gr";
import {
  fmtCondChng,
  fmtWhenCondL,
  getCondChoice
} from "@/modules/calculator/features/rotation/lib/conditions.tsx";
import {NlnAddMenu, NodeDeets, RotVls } from "./NodeDeets.tsx";
import {
  getFeatLblCl,
  getNodeMemIc,
  getNodeTotals,
  getTrnsDragM,
  dsblByWhen,
  isEntryNode,
  makeNodeId,
  withEditMenu,
} from "@/modules/calculator/features/rotation/lib/utils.ts";
import {withDefIconM, withDefResMg} from "@/shared/lib/imageFallback.ts";

export function TreeNode({
                           portalTarget,
                           runtime,
                           runtimesById,
                           treeItems,
                           node,
                           depth,
                           parentId,
                           branch,
                           index,
                           resultMap,
                           featMetaById: ftrMetaById,
                           djcnFeatById: djcnFtrById,
                           prvsFeatById: prvsFtrById,
                           condChoices: condChoices,
                           loopInfoById: loopInfoByNo,
                           loopLabelById: loopLabelById,
                           collapsedIds,
                           defFeatMemId: defaultMember,
                           draggedId,
                           draggedNode,
                           dragOverKey,
                           dragOverArea,
                           onDragStart,
                           onDragEnd,
                           onDragOverNode: onDragOverTr,
                           onMoveNode,
                           onToggleClosed: onTgglCllp,
                           onDeleteNode,
                           onOpenFeatMenu: onOpenFtrMen,
                           onOpenNegConfig: onOpenNgtvFf,
                           onOpenCondition: onOpenCndtDt,
                           onOpenFeatCond: onOpenFtrCnd,
                           onOpenBlock: onOpenBlckPc,
                           onOpenLoop: onOpenLoopDt,
                           onOpenWhen: onOpenWhenDt,
                           buildCtxMenu: bldCtxMenuTm,
                           getEditConfig: getEditCtxMe,
                           onUpdateNode,
                           onNsrtNodeAt: onNsrtNodeAt,
                           onLpfyNode: onLpfyNode,
                           onBlckNode: onBlckNode,
                           selMode: selectMode,
                           selectedIds,
                           onAddSel: onAddSlct,
                           onRngSel: onRngSlct,
                           onTgglSel: onTgglSlct,
                         }: {
  portalTarget: HTMLElement | null
  runtime: ResRuntime
  runtimesById: Record<string, ResRuntime>
  treeItems: RotationNode[]
  node: RotationNode
  depth: number
  parentId: string | null
  branch: RotBrnc
  index: number
  resultMap: Map<string, SimResult['perSkill']>
  featMetaById: Record<string, FeatureMeta>
  djcnFeatById: Record<string, string | undefined>
  prvsFeatById: Record<string, string | undefined>
  condChoices: CondChoice[]
  loopInfoById: Record<string, RotLoopMrkrI>
  loopLabelById: ReadonlyMap<string, string>
  collapsedIds: Record<string, boolean>
  defFeatMemId: string
  draggedId: string | null
  draggedNode: RotationNode | null
  dragOverKey: string | null
  dragOverArea: RotDragArea | null
  onDragStart: (nodeId: string) => void
  onDragEnd: () => void
  onDragOverNode: (key: string | null, area: RotDragArea | null) => void
  onMoveNode: (drggNodeId: string, target: RotDropTgt) => void
  onToggleClosed: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onOpenFeatMenu: (state: FeatMenuStt) => void
  onOpenNegConfig: (state: NegFfctCnfgS) => void
  onOpenCondition: (state: CondDtrStt) => void
  onOpenFeatCond: (state: FeatCondStt) => void
  onOpenBlock: (target: RotNsrtTgt) => void
  onOpenLoop: (target: RotNsrtTgt) => void
  onOpenWhen: (nodeId: string) => void
  buildCtxMenu: (items: MenuEntry[]) => MenuEntry[]
  getEditConfig: (target: RotNsrtTgt, node: RotationNode) => EditConfig
  onUpdateNode: (nodeId: string, updater: (node: RotationNode) => RotationNode) => void
  onNsrtNodeAt: (target: RotDropTgt, node: RotationNode) => void
  onLpfyNode: (nodeId: string) => void
  onBlckNode: (nodeId: string, type: RotBlckType) => void
  selMode: boolean
  selectedIds: ReadonlySet<string>
  onAddSel: (nodeId: string) => void
  onRngSel: (nodeId: string) => void
  onTgglSel: (nodeId: string) => void
}) {
  const collapsed = collapsedIds[node.id] ?? false
  const totals = getNodeTotals(node, resultMap)
  // drag keys encode the current branch position instead of only the node id so dropping between repeated child lists
  // can target the exact insertion seam.
  const dragKey = `${parentId ?? 'root'}:${branch}:${index}`
  const isDragOver = dragOverKey === dragKey
  const dragArea: RotDragArea = branch === 'setup' ? 'block-setup' : branch === 'items' ? 'block-items' : 'root'
  const disabled = 'enabled' in node ? !(node.enabled ?? true) : false
  const dsplDsbl = disabled || dsblByWhen(node, resultMap)
  const tglNodeOn = (current: RotationNode): RotationNode =>
    'enabled' in current ? { ...current, enabled: !(current.enabled ?? true) } : current
  const canDropDrggN = canNsrtNodeI(draggedNode, branch)
  const addBlwTgt: RotNsrtTgt = {
    parentId,
    branch,
    index: index + 1,
  }
  const llwAddFeatBl = branch !== 'setup'
  const llwAddBlckBl = branch !== 'setup'
  const selected = selectedIds.has(node.id)
  const condChc =
    node.type === 'condition'
      ? condChoices.find(
        (choice) =>
          choice.resonatorId === (node.changes[0]?.resonatorId ?? node.resonatorId) &&
          choice.state.path === node.changes[0]?.path,
      )
      : null
  const nodeWhen = 'when' in node ? node.when : undefined
  const whenCondChps = fmtWhenCondL(nodeWhen?.condition, condChoices)
  // loop-based when chips are derived from the desc map so deleted or unresolved loop ids can still render a safe
  // fallback instead of breaking the whole node row.
  const whenLoopChps = (nodeWhen?.loops ?? []).map((rule) => {
    const label = loopLabelById.get(rule.loopId) ?? 'Loop'
    return `${label}: ${rule.runs.map((run) => `#${run}`).join(', ')}`
  })
  const whenChips = [...whenCondChps, ...whenLoopChps]
  const viewWhenChps = () => whenChips.map((label, chipIndex) => (
    <span key={`when:${chipIndex}:${label}`} className="rotation-condition-chip">
      {label}
    </span>
  ))

  // these handlers are shared by every node shape so selection mode, transparent drag previews, and branch-aware
  // drop validation stay consistent across features, conditions, loops, and blocks.
  const shrdDragPrps = {
    draggable: !selectMode && draggedId !== node.id,
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
      if (selectMode) {
        return
      }

      event.stopPropagation()
      event.dataTransfer.effectAllowed = 'move'
      const dragImage = getTrnsDragM()
      if (dragImage) {
        event.dataTransfer.setDragImage(dragImage, 0, 0)
      }
      onDragStart(node.id)
    },
    onDragEnd,
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      if (!canDropDrggN) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onDragOverTr(dragKey, dragArea)
    },
    onDragLeave: () => onDragOverTr(null, null),
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      if (!canDropDrggN) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      if (!draggedId || draggedId === node.id) {
        return
      }

      onMoveNode(draggedId, {
        parentId,
        branch,
        index,
        key: dragKey,
      })
    },
  }
  const getCardProps = (items: MenuEntry[], ariaLabel: string) => ({
    // node cards treat shift-click as range selection in both normal and selection mode; meta/ctrl-click only starts
    // additive selection outside explicit selection mode.
    depth,
    disabled: dsplDsbl,
    selected,
    selMode: selectMode,
    focusItem: true,
    isDragOver,
    isDragging: draggedId === node.id,
    ...shrdDragPrps,
    onClick: selectMode
      ? (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.defaultPrevented) {
          return
        }

        if (event.shiftKey) {
          event.preventDefault()
          event.stopPropagation()
          onRngSlct(node.id)
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onTgglSlct(node.id)
      }
      : (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.defaultPrevented) {
          return
        }

        if (event.shiftKey) {
          event.preventDefault()
          event.stopPropagation()
          onRngSlct(node.id)
          return
        }

        if (!(event.metaKey || event.ctrlKey)) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onAddSlct(node.id)
      },
    ctxMenuTms: bldCtxMenuTm(withEditMenu(
      items,
      getEditCtxMe({ parentId, branch, index }, node),
    )),
    ctxMenuArigs: ariaLabel,
  })
  // inline add menus are disabled inside setup branches where nested features or blocks would change uptime semantics.
  const addBlwMenuTm = (actMemId: string): MenuEntry[] => [
    {
      id: 'add-feature-below',
      label: 'Feature',
      hint: 'Skill step',
      disabled: !llwAddFeatBl,
      onSelect: () =>
        onOpenFtrMen({
          mode: 'add',
          actMemId: actMemId,
          target: addBlwTgt,
        }),
    },
    {
      id: 'add-condition-below',
      label: 'Condition',
      hint: 'State change',
      onSelect: () => onOpenCndtDt({ mode: 'add', target: addBlwTgt }),
    },
    {
      id: 'add-block-below',
      label: 'Block',
      hint: 'Repeat or uptime',
      disabled: !llwAddBlckBl,
      onSelect: () => onOpenBlckPc(addBlwTgt),
    },
    {
      id: 'add-loop-below',
      label: 'Loop',
      hint: 'Start/end marker',
      disabled: !llwAddBlckBl,
      onSelect: () => onOpenLoopDt(addBlwTgt),
    },
  ]
  // wrap actions reuse the current node as the selected payload, then delegate the structural rewrite to the pane-level
  // transform helpers so the tree renderer stays focused on presentation and dispatch.
  const wrapMenuTms: MenuEntry[] = [
    {
      id: 'loopify-node',
      label: 'Loopify',
      icon: <RotateCcw size={15} />,
      disabled: !llwAddBlckBl,
      onSelect: () => onLpfyNode(node.id),
    },
    {
      id: 'blockify-node',
      label: 'Blockify...',
      icon: <TextQuote size={15} />,
      disabled: !llwAddBlckBl,
      submenu: [
        {
          id: 'blockify-repeat',
          label: 'Repeat',
          onSelect: () => onBlckNode(node.id, 'repeat'),
        },
        {
          id: 'blockify-uptime',
          label: 'Uptime',
          onSelect: () => onBlckNode(node.id, 'uptime'),
        },
      ],
    },
  ]

  if (node.type === 'feature') {
    const meta = ftrMetaById[node.featureId]
    const orphaned = !meta
    // adjacent and previous ids are precomputed by the pane from the source feature list; this component only decides
    // which quick-swap actions are legal for the rendered node.
    const djcnFeatId = djcnFtrById[node.featureId]
    const prvsFeatId = prvsFtrById[node.featureId]
    const memberIcon = getNodeMemIc(node, runtime, ftrMetaById, condChoices)
    const isNegFfctFea = meta?.tab === 'negativeEffect'
    const usesFxdNegFf = Boolean(meta?.fixedStacks)
    const negFfctTtrb = getNegFfctTt(meta?.archetype)
    const ttchChng = node.changes ?? []
    // context-menu items mirror the primary edit actions so mouse, keyboard,
    // and touch paths expose the same mutation model.
    const featCtxMenuT = ([
      prvsFeatId
        ? {
          id: 'replace-previous',
          label: 'Prev. Replace',
          icon: <ChevronsLeft size={15} />,
          onSelect: () =>
            onUpdateNode(node.id, (current) =>
              current.type === 'feature'
                ? {
                  ...current,
                  featureId: prvsFeatId,
                  resonatorId: current.resonatorId ?? meta?.resonatorId ?? runtime.id,
                }
                : current,
            ),
        }
        : null,
      djcnFeatId
        ? {
          id: 'add-adjacent',
          label: 'Adj. Add',
          icon: <ChevronsDown size={15} />,
          onSelect: () =>
            onNsrtNodeAt(
              {
                parentId,
                branch,
                index: index + 1,
                key: `${parentId ?? 'root'}:${branch}:${index + 1}:adjacent`,
              },
              {
                id: makeNodeId('rotation:feature'),
                type: 'feature',
                resonatorId: node.resonatorId ?? meta?.resonatorId ?? runtime.id,
                featureId: djcnFeatId,
                multiplier: 1,
                enabled: true,
              },
            ),
        }
        : null,
      djcnFeatId
        ? {
          id: 'replace-adjacent',
          label: 'Adj. Replace',
          icon: <RightChevrons size={15} />,
          onSelect: () =>
            onUpdateNode(node.id, (current) =>
              current.type === 'feature'
                ? {
                  ...current,
                  featureId: djcnFeatId,
                  resonatorId: current.resonatorId ?? meta?.resonatorId ?? runtime.id,
                }
                : current,
            ),
        }
        : null,
      prvsFeatId || djcnFeatId ? { type: 'separator' as const } : null,
      {
        id: 'edit-feature',
        label: 'Edit feature',
        icon: <Pencil size={15} />,
        onSelect: () =>
          onOpenFtrMen({
            mode: 'edit',
            nodeId: node.id,
            actMemId: node.resonatorId ?? runtime.id,
          }),
      },
      isNegFfctFea && !usesFxdNegFf
        ? {
          id: 'configure-negative-effect',
          label: 'Configure negative effect series',
          hint: negFfctTtrb ?? 'DOT',
          onSelect: () => onOpenNgtvFf({ nodeId: node.id }),
        }
        : null,
      {
        id: 'set-feature-condition',
        label: 'Set/Add Condition',
        icon: <PiPlusBold />,
        onSelect: () => onOpenFtrCnd({ nodeId: node.id }),
      },
      {
        id: 'set-when',
        label: 'When',
        icon: <InfinityIcon size={15} />,
        onSelect: () => onOpenWhenDt(node.id),
      },
      {
        id: 'add-below',
        label: 'Add below...',
        icon: <GrLinkDown size={15} />,
        submenu: addBlwMenuTm(node.resonatorId ?? meta?.resonatorId ?? defaultMember),
      },
      ...wrapMenuTms,
      { type: 'separator' as const },
      {
        id: 'toggle-enabled',
        label: disabled ? 'Enable feature' : 'Disable feature',
        icon: disabled ? <PowerOff size={15} /> : <Power size={15} />,
        onSelect: () => onUpdateNode(node.id, tglNodeOn),
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: <Trash2 size={15} />,
        danger: true,
        onSelect: () => onDeleteNode(node.id),
      },
    ] as Array<MenuEntry | null>).filter((item): item is MenuEntry => item !== null)

    if (orphaned) {
      return (
        <>
          <NodeDeets {...getCardProps([
            ...wrapMenuTms,
            { type: 'separator' },
            {
              id: 'delete',
              label: 'Delete',
              icon: <Trash2 size={15} />,
              danger: true,
              onSelect: () => onDeleteNode(node.id),
            },
          ], 'Invalid feature actions')}>
            <article className="rotation-item rotation-item--orphaned">
              <div className="rotation-entry-main">
                <span className="entry-name rotation-skill-name">Invalid Feature</span>
              </div>
              <div className="rotation-node-actions">
                <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          </NodeDeets>
        </>
      )
    }

    return (
      <>
        <NodeDeets {...getCardProps(featCtxMenuT, 'Feature actions')}>
          <article className="rotation-item">
            <div className="rotation-header">
              <div className="rotation-entry-main">
              <span
                className="entry-name rotation-skill-name"
                style={{ color: getFeatLblCl(meta) }}
              >
                {meta?.label ?? node.featureId}
              </span>
              </div>
              <div className="rotation-node-actions">
                {prvsFeatId ? (
                  <button
                    type="button"
                    className="block-icon-button"
                    title="Replace with previous skill"
                    onClick={() =>
                      onUpdateNode(node.id, (current) =>
                        current.type === 'feature'
                          ? {
                            ...current,
                            featureId: prvsFeatId,
                            resonatorId: current.resonatorId ?? meta?.resonatorId ?? runtime.id,
                          }
                          : current,
                      )
                    }
                  >
                    <ChevronsLeft size={15} />
                  </button>
                ) : null}
                {djcnFeatId ? (
                  <>
                    <button
                      type="button"
                      className="block-icon-button"
                      title="Add adjacent skill"
                      onClick={() =>
                        onNsrtNodeAt(
                          {
                            parentId,
                            branch,
                            index: index + 1,
                            key: `${parentId ?? 'root'}:${branch}:${index + 1}:adjacent`,
                          },
                          {
                            id: makeNodeId('rotation:feature'),
                            type: 'feature',
                            resonatorId: node.resonatorId ?? meta?.resonatorId ?? runtime.id,
                            featureId: djcnFeatId,
                            multiplier: 1,
                            enabled: true,
                          },
                        )
                      }
                    >
                      <ChevronsDown size={15} />
                    </button>
                    <button
                      type="button"
                      className="block-icon-button"
                      title="Replace with adjacent skill"
                      onClick={() =>
                        onUpdateNode(node.id, (current) =>
                          current.type === 'feature'
                            ? {
                              ...current,
                              featureId: djcnFeatId,
                              resonatorId: current.resonatorId ?? meta?.resonatorId ?? runtime.id,
                            }
                            : current,
                        )
                      }
                    >
                      <RightChevrons size={15} />
                    </button>
                  </>
                ) : null}

                {isNegFfctFea && !usesFxdNegFf ? (
                  <button
                    type="button"
                    className="block-icon-button rotation-negative-effect-button"
                    title="Configure negative effect series"
                    onClick={() => onOpenNgtvFf({ nodeId: node.id })}
                  >
                    {negFfctTtrb ? (
                      <img
                        src={`/assets/attributes/attributes alt/${negFfctTtrb}.webp`}
                        alt=""
                        aria-hidden="true"
                        className="rotation-negative-effect-button__icon"
                        onError={withDefIconM}
                      />
                    ) : (
                      <span className="entry-detail-text">DOT</span>
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="block-icon-button"
                  onClick={() => onOpenFtrCnd({ nodeId: node.id })}
                  aria-label="Set/Add Condition"
                  title="Set/Add Condition"
                >
                  <PiPlusBold />
                </button>
                <button
                  type="button"
                  className="block-icon-button"
                  onClick={() => onOpenWhenDt(node.id)}
                  aria-label="When"
                  title="When"
                >
                  <InfinityIcon size={15} />
                </button>

                <button
                  type="button"
                  className="block-icon-button"
                  title="Edit feature"
                  onClick={() =>
                    onOpenFtrMen({
                      mode: 'edit',
                      nodeId: node.id,
                      actMemId: node.resonatorId ?? runtime.id,
                    })
                  }
                >
                  <Pencil size={15} />
                </button>
                <NlnAddMenu
                  portalTarget={portalTarget}
                  allowFeature={llwAddFeatBl}
                  llwCond
                  allowBlock={llwAddBlckBl}
                  allowLoop={llwAddBlckBl}
                  onAddFeature={() =>
                    onOpenFtrMen({
                      mode: 'add',
                      actMemId: node.resonatorId ?? meta?.resonatorId ?? defaultMember,
                      target: addBlwTgt,
                    })
                  }
                  onAddCond={() => onOpenCndtDt({ mode: 'add', target: addBlwTgt })}
                  onAddBlock={() => onOpenBlckPc(addBlwTgt)}
                  onAddLoop={() => onOpenLoopDt(addBlwTgt)}
                />
                <button
                  type="button"
                  className="block-icon-button power"
                  title={disabled ? 'Enable feature' : 'Disable feature'}
                  onClick={() => onUpdateNode(node.id, tglNodeOn)}
                >
                  {disabled ? <PowerOff size={16} /> : <Power size={16} />}
                </button>
                <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                  <Trash2 size={15} />
                </button>
                {memberIcon ? (
                  <span className="rotation-node-member-icon" title={memberIcon.name}>
                  <img src={memberIcon.profile} alt="" onError={withDefResMg} />
                </span>
                ) : null}
              </div>
            </div>
            <div className="rotation-footer">
              <RotVls totals={totals} ggrgType={meta?.ggrgType} />
              <div className="rotation-inline-field ui-inline-field">
                <span className="entry-detail-text rotation-skill-type-label">{meta?.skillTypeLabel ?? 'Feature'}</span>
                <span className="rotation-multiplier-symbol">×</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="resonator-level-input"
                  value={Math.max(1, Math.floor(node.multiplier ?? 1))}
                  onChange={(event) => {
                    const nextValue = Math.max(1, Math.floor(Number(event.target.value) || 1))
                    onUpdateNode(node.id, (current) =>
                      current.type === 'feature'
                        ? {
                          ...current,
                          multiplier: nextValue,
                        }
                        : current,
                    )
                  }}
                />
              </div>
            </div>
            {ttchChng.length > 0 || whenChips.length > 0 ? (
              <div className="rotation-condition-list">
                {ttchChng.map((change, changeIndex) => (
                  <span key={`${change.path}:${changeIndex}`} className="rotation-condition-chip">
                  {fmtCondChng(
                    change,
                    getCondChoice(condChoices, change, node.resonatorId ?? meta?.resonatorId ?? runtime.id),
                  )}
                </span>
                ))}
                {viewWhenChps()}
              </div>
            ) : null}
          </article>
        </NodeDeets>
      </>
    )
  }

  if (node.type === 'condition') {
    const displayChange = node.changes[0]
    const memberIcon = getNodeMemIc(node, runtime, ftrMetaById, condChoices)
    // conditions can outlive their catalog state after data updates; keep the row deletable but do not attempt to
    // render controls for an unknown path.
    const rphnCond = displayChange && !condChc

    if (rphnCond) {
      return (
        <>
          <NodeDeets {...getCardProps([
            ...wrapMenuTms,
            { type: 'separator' },
            {
              id: 'delete',
              label: 'Delete',
              icon: <Trash2 size={15} />,
              danger: true,
              onSelect: () => onDeleteNode(node.id),
            },
          ], 'Invalid condition actions')}>
            <div className="rotation-item rotation-condition rotation-item--orphaned">
              <div className="rotation-entry-main">
                <span className="entry-name">Invalid Condition</span>
              </div>
              <div className="rotation-node-actions">
                <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </NodeDeets>
        </>
      )
    }

    const condCtxMenuT: MenuEntry[] = [
      {
        id: 'edit-condition',
        label: 'Edit condition',
        icon: <Pencil size={15} />,
        onSelect: () => onOpenCndtDt({ mode: 'edit', nodeId: node.id }),
      },
      {
        id: 'set-when',
        label: 'When',
        icon: <InfinityIcon size={15} />,
        onSelect: () => onOpenWhenDt(node.id),
      },
      {
        id: 'add-below',
        label: 'Add below',
        icon: <GrLinkDown size={15} />,
        submenu: addBlwMenuTm(node.resonatorId ?? condChc?.resonatorId ?? defaultMember),
      },
      ...wrapMenuTms,
      { type: 'separator' },
      {
        id: 'toggle-enabled',
        label: disabled ? 'Enable condition' : 'Disable condition',
        icon: disabled ? <PowerOff size={15} /> : <Power size={15} />,
        onSelect: () => onUpdateNode(node.id, tglNodeOn),
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: <Trash2 size={15} />,
        danger: true,
        onSelect: () => onDeleteNode(node.id),
      },
    ]

    return (
      <>
        <NodeDeets {...getCardProps(condCtxMenuT, 'Condition actions')}>
          <div className="rotation-item rotation-condition">
            <div className="rotation-header">
              <div className="rotation-entry-main">
                <span className="entry-name">{fmtCondChng(displayChange, condChc) ?? node.label ?? condChc?.label ?? 'Condition'}</span>
              </div>
              <div className="rotation-node-actions">
                <button
                  type="button"
                  className="block-icon-button"
                  title="Edit condition"
                  onClick={() => onOpenCndtDt({ mode: 'edit', nodeId: node.id })}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="block-icon-button"
                  title="When"
                  onClick={() => onOpenWhenDt(node.id)}
                >
                  <InfinityIcon size={15} />
                </button>
                <NlnAddMenu
                  portalTarget={portalTarget}
                  allowFeature={llwAddFeatBl}
                  llwCond
                  allowBlock={llwAddBlckBl}
                  allowLoop={llwAddBlckBl}
                  onAddFeature={() =>
                    onOpenFtrMen({
                      mode: 'add',
                      actMemId: node.resonatorId ?? condChc?.resonatorId ?? defaultMember,
                      target: addBlwTgt,
                    })
                  }
                  onAddCond={() => onOpenCndtDt({ mode: 'add', target: addBlwTgt })}
                  onAddBlock={() => onOpenBlckPc(addBlwTgt)}
                  onAddLoop={() => onOpenLoopDt(addBlwTgt)}
                />
                <button
                  type="button"
                  className="block-icon-button power"
                  title={disabled ? 'Enable condition' : 'Disable condition'}
                  onClick={() => onUpdateNode(node.id, tglNodeOn)}
                >
                  {disabled ? <PowerOff size={16} /> : <Power size={16} />}
                </button>
                <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                  <Trash2 size={15} />
                </button>
                {memberIcon ? (
                  <span className="rotation-node-member-icon" title={memberIcon.name}>
                  <img src={memberIcon.profile} alt="" onError={withDefResMg} />
                </span>
                ) : null}
              </div>
            </div>
            {whenChips.length > 0 ? (
              <div className="rotation-condition-list">
                {viewWhenChps()}
              </div>
            ) : null}
          </div>
        </NodeDeets>
      </>
    )
  }

  if (node.type === 'loop') {
    const loopInfo = loopInfoByNo[node.id]
    // a start without an explicit end wraps to itself; the desc communicates that it is both the start and end of the
    // repeated segment.
    const loopHasOwnEn = node.kind === 'start' && !loopInfo?.endNode
    const loopDisabled = !((loopInfo?.startNode.enabled ?? node.enabled) ?? true)
    const loopColor = loopInfo?.color ?? (node.kind === 'start' ? node.color : undefined) ?? '#f59e0b'
    const loopLabel = node.kind === 'start'
      ? node.label ?? loopInfo?.label ?? 'Loop'
      : loopInfo?.label ?? 'Loop end'
    const loopRuns = loopInfo?.runs ?? (node.kind === 'start' ? Math.max(1, Math.floor(node.runs ?? 1)) : 1)
    const loopCtxMenuT: MenuEntry[] = [
      {
        id: 'edit-loop',
        label: 'Edit loop',
        icon: <Pencil size={15} />,
        onSelect: () => onOpenLoopDt(addBlwTgt),
      },
      ...(node.kind === 'start'
        ? [{
          id: 'set-when',
          label: 'When',
          icon: <InfinityIcon size={15} />,
          onSelect: () => onOpenWhenDt(node.id),
        } satisfies MenuEntry]
        : []),
      {
        id: 'add-below',
        label: 'Add below',
        icon: <GrLinkDown size={15} />,
        submenu: addBlwMenuTm(defaultMember),
      },
      ...wrapMenuTms,
      { type: 'separator' },
      {
        id: 'toggle-enabled',
        label: loopDisabled ? 'Enable loop' : 'Disable loop',
        icon: loopDisabled ? <PowerOff size={15} /> : <Power size={15} />,
        onSelect: () => onUpdateNode(node.id, (current) => (
          current.type === 'loop'
            ? { ...current, enabled: loopDisabled }
            : current
        )),
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: <Trash2 size={15} />,
        danger: true,
        onSelect: () => onDeleteNode(node.id),
      },
    ]

    return (
      <>
        <NodeDeets {...getCardProps(loopCtxMenuT, 'Loop actions')} disabled={loopDisabled}>
          <article className="rotation-item rotation-loop-marker" style={{ '--rotation-loop-color': loopColor } as React.CSSProperties}>
            <div className="rotation-header">
              <div className="rotation-entry-main">
                <span className="rotation-loop-marker__title">
                  <span className="rotation-loop-marker__badge">
                    {node.kind === 'start' ? loopHasOwnEn ? <RotateCcw /> : <Play fill="currentColor"/> : <Square fill="currentColor"/>}
                    {node.kind === 'start' ? loopHasOwnEn ? 'Start / End' : 'start' : 'end'}
                  </span>
                  <span className="entry-name rotation-loop-marker__name">{loopLabel}</span>
                </span>
              </div>
              <div className="rotation-node-actions">
                {node.kind === 'start' ? (
                  <button
                    type="button"
                    className="block-icon-button"
                    title="When"
                    onClick={() => onOpenWhenDt(node.id)}
                  >
                    <InfinityIcon size={15} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="block-icon-button"
                  title="Edit loop"
                  onClick={() => onOpenLoopDt(addBlwTgt)}
                >
                  <Pencil size={15} />
                </button>
                <NlnAddMenu
                  portalTarget={portalTarget}
                  allowFeature={llwAddFeatBl}
                  llwCond
                  allowBlock={llwAddBlckBl}
                  allowLoop={llwAddBlckBl}
                  onAddFeature={() =>
                    onOpenFtrMen({
                      mode: 'add',
                      actMemId: defaultMember,
                      target: addBlwTgt,
                    })
                  }
                  onAddCond={() => onOpenCndtDt({ mode: 'add', target: addBlwTgt })}
                  onAddBlock={() => onOpenBlckPc(addBlwTgt)}
                  onAddLoop={() => onOpenLoopDt(addBlwTgt)}
                />
                <button
                  type="button"
                  className="block-icon-button power"
                  title={loopDisabled ? 'Enable loop' : 'Disable loop'}
                  onClick={() => onUpdateNode(node.id, (current) => (
                    current.type === 'loop'
                      ? { ...current, enabled: loopDisabled }
                      : current
                  ))}
                >
                  {loopDisabled ? <PowerOff size={16} /> : <Power size={16} />}
                </button>
                <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            {loopInfo ? (
              <div className="rotation-footer">
                <RotVls totals={loopInfo.totals} />
                <span className="rotation-loop-marker__badge" aria-label="Runs">
                  <RefreshCw />
                  <span className="rotation-loop-marker__runs-label">
                    {loopRuns === 1 ? 'once' : `${loopRuns} times`}
                  </span>
                </span>
              </div>
            ) : null}
            {whenChips.length > 0 ? (
              <div className="rotation-condition-list">
                {viewWhenChps()}
              </div>
            ) : null}
          </article>
        </NodeDeets>
      </>
    )
  }

  const tmsBrncKey = `${node.id}:items:end`
  const stpBrncKey = `${node.id}:setup:end`
  const nextDepth = depth + 1
  const memberIcon = getNodeMemIc(node, runtime, ftrMetaById, condChoices)
  const drggEntNode = isEntryNode(draggedNode) ? draggedNode : null
  const canDropIntoS = canNsrtNodeI(draggedNode, 'setup')
  const stpDragKeys = (node.type === 'uptime' ? node.setup ?? [] : []).map((_, childIndex) => `${node.id}:setup:${childIndex}`)
  const tmsDragKeys = node.items.map((_, childIndex) => `${node.id}:items:${childIndex}`)
  // branch drag matching includes both the terminal insert slot and every child
  // seam so nested positions resolve back to the owning branch.
  const isStpBrncDra =
    dragOverArea === 'block-setup' &&
    (dragOverKey === stpBrncKey || stpDragKeys.includes(dragOverKey ?? ''))
  const isTmsBrncDra =
    dragOverArea === 'block-items' &&
    (dragOverKey === tmsBrncKey || tmsDragKeys.includes(dragOverKey ?? ''))
  const viewDrggPlch = (plchKey: string) =>
    drggEntNode ? (
      <div key={plchKey} className="rotation-drop-indicator" />
    ) : null
  const blckCtxMenuT: MenuEntry[] = [
    {
      id: 'toggle-collapse',
      label: collapsed ? 'Expand block' : 'Collapse block',
      icon: collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />,
      onSelect: () => onTgglCllp(node.id),
    },
    {
      id: 'set-when',
      label: 'When',
      icon: <InfinityIcon size={15} />,
      onSelect: () => onOpenWhenDt(node.id),
    },
    {
      id: 'add-below',
      label: 'Add below...',
      icon: <GrLinkDown size={15} />,
      submenu: addBlwMenuTm(node.resonatorId ?? defaultMember),
    },
    ...wrapMenuTms,
    { type: 'separator' },
    {
      id: 'toggle-enabled',
      label: disabled ? 'Enable block' : 'Disable block',
      icon: disabled ? <PowerOff size={15} /> : <Power size={15} />,
      onSelect: () => onUpdateNode(node.id, tglNodeOn),
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size={15} />,
      danger: true,
      onSelect: () => onDeleteNode(node.id),
    },
  ]

  return (
    <>
      <NodeDeets {...getCardProps(blckCtxMenuT, 'Block actions')}>
        <div
          className={`rotation-item rotation-block ${isStpBrncDra || isTmsBrncDra ? 'drag-hovered' : ''} ${collapsed && isTmsBrncDra ? 'drag-over' : ''}`}
          onDragOver={collapsed ? (event) => {
            event.preventDefault()
            event.stopPropagation()
            onDragOverTr(tmsBrncKey, 'block-items')
          } : undefined}
          onDragLeave={collapsed ? () => onDragOverTr(null, null) : undefined}
          onDrop={collapsed ? (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!draggedId) {
              return
            }

            onMoveNode(draggedId, {
              parentId: node.id,
              branch: 'items',
              index: getBrncLngt(treeItems, node.id, 'items'),
              key: tmsBrncKey,
            })
          } : undefined}
        >
          <div className="block-header">
            <div className="rotation-entry-main">
              <h4 className="entry-name">{node.type === 'repeat' ? 'Repeat' : 'Uptime'}</h4>
            </div>
            <div className="rotation-node-actions">
              {node.type === 'repeat' ? (
                <div className="rotation-inline-field ui-inline-field">
                  <span className="rotation-multiplier-symbol">×</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="resonator-level-input"
                    value={Math.max(1, Math.floor(typeof node.times === 'number' ? node.times : 1))}
                    onChange={(event) => {
                      const nextValue = Math.max(1, Math.floor(Number(event.target.value) || 1))
                      onUpdateNode(node.id, (current) =>
                        current.type === 'repeat'
                          ? {
                            ...current,
                            times: nextValue,
                          }
                          : current,
                      )
                    }}
                  />
                </div>
              ) : (
                <div className="rotation-inline-field ui-inline-field">
                  <span className="rotation-multiplier-text">Uptime</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="resonator-level-input"
                    value={Math.round((typeof node.ratio === 'number' ? node.ratio : 1) * 100)}
                    onChange={(event) => {
                      const nextValue = Math.max(0, Math.min(100, Math.floor(Number(event.target.value) || 0))) / 100
                      onUpdateNode(node.id, (current) =>
                        current.type === 'uptime'
                          ? {
                            ...current,
                            ratio: nextValue,
                          }
                          : current,
                      )
                    }}
                  />
                </div>
              )}
              <button type="button" className="rotation-collapse-button" onClick={() => onTgglCllp(node.id)}>
                {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
              <button
                type="button"
                className="block-icon-button"
                title="When"
                onClick={() => onOpenWhenDt(node.id)}
              >
                <InfinityIcon size={15} />
              </button>
              <NlnAddMenu
                portalTarget={portalTarget}
                allowFeature={llwAddFeatBl}
                llwCond
                allowBlock={llwAddBlckBl}
                allowLoop={llwAddBlckBl}
                onAddFeature={() =>
                  onOpenFtrMen({
                    mode: 'add',
                    actMemId: node.resonatorId ?? defaultMember,
                    target: addBlwTgt,
                  })
                }
                onAddCond={() => onOpenCndtDt({ mode: 'add', target: addBlwTgt })}
                onAddBlock={() => onOpenBlckPc(addBlwTgt)}
                onAddLoop={() => onOpenLoopDt(addBlwTgt)}
              />
              <button
                type="button"
                className="block-icon-button power"
                title={disabled ? 'Enable block' : 'Disable block'}
                onClick={() => onUpdateNode(node.id, tglNodeOn)}
              >
                {disabled ? <PowerOff size={16} /> : <Power size={16} />}
              </button>
              <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                <Trash2 size={15} />
              </button>
              {memberIcon ? (
                <span className="rotation-node-member-icon" title={memberIcon.name}>
                <img src={memberIcon.profile} alt="" onError={withDefResMg} />
              </span>
              ) : null}
            </div>
          </div>

          {!collapsed ? (
            <div className="block-body expanded">
              {node.type === 'uptime' ? (
                <div
                  className={`rotation-block-setup ${isStpBrncDra ? 'drag-over' : ''}`}
                  onDragOver={(event) => {
                    if (!canDropIntoS) {
                      return
                    }

                    event.preventDefault()
                    event.stopPropagation()
                    onDragOverTr(stpBrncKey, 'block-setup')
                  }}
                  onDragLeave={() => onDragOverTr(null, null)}
                  onDrop={(event) => {
                    if (!canDropIntoS) {
                      return
                    }

                    event.preventDefault()
                    event.stopPropagation()
                    if (!draggedId) {
                      return
                    }
                    onMoveNode(draggedId, {
                      parentId: node.id,
                      branch: 'setup',
                      index: getBrncLngt(treeItems, node.id, 'setup'),
                      key: stpBrncKey,
                    })
                  }}
                >
                  <div className="rotation-block-section-header">
                    <div className="rotation-block-section-title">Setup</div>
                    <div className="rotation-toolbar-group compact">
                      <button
                        type="button"
                        className="rotation-button mini"
                        onClick={() => onOpenCndtDt({ mode: 'add', target: { parentId: node.id, branch: 'setup' } })}
                      >
                        <Plus size={14} />
                        Condition
                      </button>
                    </div>
                  </div>
                  {node.setup?.length ? (
                    node.setup.map((child, childIndex) => {
                      const childDragKey = `${node.id}:setup:${childIndex}`
                      return (
                        <React.Fragment key={child.id}>
                          {dragOverKey === childDragKey ? viewDrggPlch(`setup-preview:${child.id}`) : null}
                          <TreeNode
                            portalTarget={portalTarget}
                            runtime={runtime}
                            runtimesById={runtimesById}
                            treeItems={treeItems}
                            node={child}
                            depth={nextDepth}
                            parentId={node.id}
                            branch="setup"
                            index={childIndex}
                            resultMap={resultMap}
                            featMetaById={ftrMetaById}
                            djcnFeatById={djcnFtrById}
                            prvsFeatById={prvsFtrById}
                            condChoices={condChoices}
                            loopInfoById={loopInfoByNo}
                            loopLabelById={loopLabelById}
                            collapsedIds={collapsedIds}
                            defFeatMemId={defaultMember}
                            draggedId={draggedId}
                            draggedNode={draggedNode}
                            dragOverKey={dragOverKey}
                            dragOverArea={dragOverArea}
                            onDragStart={onDragStart}
                            onDragEnd={onDragEnd}
                            onDragOverNode={onDragOverTr}
                            onMoveNode={onMoveNode}
                            onToggleClosed={onTgglCllp}
                            onDeleteNode={onDeleteNode}
                            onOpenFeatMenu={onOpenFtrMen}
                            onOpenNegConfig={onOpenNgtvFf}
                            onOpenCondition={onOpenCndtDt}
                            onOpenFeatCond={onOpenFtrCnd}
                            onOpenBlock={onOpenBlckPc}
                            onOpenLoop={onOpenLoopDt}
                            onOpenWhen={onOpenWhenDt}
                            buildCtxMenu={bldCtxMenuTm}
                            getEditConfig={getEditCtxMe}
                            onUpdateNode={onUpdateNode}
                            onNsrtNodeAt={onNsrtNodeAt}
                            onLpfyNode={onLpfyNode}
                            onBlckNode={onBlckNode}
                            selMode={selectMode}
                            selectedIds={selectedIds}
                            onAddSel={onAddSlct}
                            onRngSel={onRngSlct}
                            onTgglSel={onTgglSlct}
                          />
                        </React.Fragment>
                      )
                    })
                  ) : (
                    <div className="soft-empty compact">No setup conditions.</div>
                  )}
                  {dragOverKey === stpBrncKey ? viewDrggPlch(`setup-preview:${node.id}:end`) : null}
                </div>
              ) : null}

              <div
                className={`block-entries-list ${isTmsBrncDra ? 'drag-over' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onDragOverTr(tmsBrncKey, 'block-items')
                }}
                onDragLeave={() => onDragOverTr(null, null)}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!draggedId) {
                    return
                  }
                  onMoveNode(draggedId, {
                    parentId: node.id,
                    branch: 'items',
                    index: getBrncLngt(treeItems, node.id, 'items'),
                    key: tmsBrncKey,
                  })
                }}
              >
                <div className="rotation-block-section-header">
                  <div className="rotation-block-section-title">Items</div>
                  <div className="rotation-toolbar-group compact">
                    <button
                      type="button"
                      className="rotation-button mini"
                      onClick={() =>
                        onOpenFtrMen({
                          mode: 'add',
                          actMemId: defaultMember,
                          target: { parentId: node.id, branch: 'items' },
                        })
                      }
                    >
                      <Plus size={14} />
                      Feature
                    </button>
                    <button
                      type="button"
                      className="rotation-button mini"
                      onClick={() => onOpenCndtDt({ mode: 'add', target: { parentId: node.id, branch: 'items' } })}
                    >
                      <Plus size={14} />
                      Condition
                    </button>
                    <button
                      type="button"
                      className="rotation-button mini"
                      onClick={() => onOpenBlckPc({ parentId: node.id, branch: 'items' })}
                    >
                      <Plus size={14} />
                      Block
                    </button>
                    <button
                      type="button"
                      className="rotation-button mini"
                      onClick={() => onOpenLoopDt({ parentId: node.id, branch: 'items' })}
                    >
                      <Plus size={14} />
                      Loop
                    </button>
                  </div>
                </div>

                {node.items.length ? (
                  node.items.map((child, childIndex) => {
                    const childDragKey = `${node.id}:items:${childIndex}`
                    return (
                      <React.Fragment key={child.id}>
                        {dragOverKey === childDragKey ? viewDrggPlch(`items-preview:${child.id}`) : null}
                        <TreeNode
                          portalTarget={portalTarget}
                          runtime={runtime}
                          runtimesById={runtimesById}
                          treeItems={treeItems}
                          node={child}
                          depth={nextDepth}
                          parentId={node.id}
                          branch="items"
                          index={childIndex}
                          resultMap={resultMap}
                          featMetaById={ftrMetaById}
                          djcnFeatById={djcnFtrById}
                          prvsFeatById={prvsFtrById}
                          condChoices={condChoices}
                          loopInfoById={loopInfoByNo}
                          loopLabelById={loopLabelById}
                          collapsedIds={collapsedIds}
                          defFeatMemId={defaultMember}
                          draggedId={draggedId}
                          draggedNode={draggedNode}
                          dragOverKey={dragOverKey}
                          dragOverArea={dragOverArea}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                          onDragOverNode={onDragOverTr}
                          onMoveNode={onMoveNode}
                          onToggleClosed={onTgglCllp}
                          onDeleteNode={onDeleteNode}
                          onOpenFeatMenu={onOpenFtrMen}
                          onOpenNegConfig={onOpenNgtvFf}
                          onOpenCondition={onOpenCndtDt}
                          onOpenFeatCond={onOpenFtrCnd}
                          onOpenBlock={onOpenBlckPc}
                          onOpenLoop={onOpenLoopDt}
                          onOpenWhen={onOpenWhenDt}
                          buildCtxMenu={bldCtxMenuTm}
                          getEditConfig={getEditCtxMe}
                          onUpdateNode={onUpdateNode}
                          onNsrtNodeAt={onNsrtNodeAt}
                          onLpfyNode={onLpfyNode}
                          onBlckNode={onBlckNode}
                          selMode={selectMode}
                          selectedIds={selectedIds}
                          onAddSel={onAddSlct}
                          onRngSel={onRngSlct}
                          onTgglSel={onTgglSlct}
                        />
                      </React.Fragment>
                    )
                  })
                ) : (
                  <div className="soft-empty compact">No items in this block.</div>
                )}
                {dragOverKey === tmsBrncKey ? viewDrggPlch(`items-preview:${node.id}:end`) : null}
              </div>
            </div>
          ) : null}

          <div className="block-footer rotation-values">
            <RotVls totals={totals} />
          </div>
          {whenChips.length > 0 ? (
            <div className="rotation-condition-list">
              {viewWhenChps()}
            </div>
          ) : null}
        </div>
      </NodeDeets>
    </>
  )
}
