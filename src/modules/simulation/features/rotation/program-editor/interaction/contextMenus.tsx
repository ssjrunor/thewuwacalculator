/*
  Author: Runor Ewhro
  Description: Owns context menus behavior and state transitions for the interaction module.
*/

import { Ban, CopyPlus, ListEnd, Power, RotateCcw, TextQuote, Trash2, Unlink } from 'lucide-react'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type { EditConfig } from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import { withEditMenu } from '@/modules/simulation/features/rotation/shared/nodeTools.ts'
import type { EditorNode } from '@/modules/simulation/features/rotation/program-editor/model/program.ts'

export interface RowCtxActions {
  node: EditorNode
  /** false for a piece of a loop, which is not a node of its own to act on */
  canLift: boolean
  onLoopify: () => void
  onBlockify: () => void
  onRemoveEnd: () => void
  onToggleEnabled: () => void
  onDelete: () => void
  edit: EditConfig
}

export function makeRowMenu(actions: RowCtxActions): MenuEntry[] {
  const { node } = actions
  if (node.type === 'setup') {
    return []
  }

  if (node.type === 'note') {
    return withEditMenu([{
      id: `rte-ctx:${node.id}:delete`,
      label: 'Delete note',
      icon: <Trash2 size="1em" />,
      danger: true,
      onSelect: actions.onDelete,
    }], actions.edit)
  }

  const isLoop = node.type === 'loop'

  return withEditMenu([
    ...(isLoop
      ? [{
        id: `rte-ctx:${node.id}:remove-end`,
        label: 'Remove end',
        hint: 'Runs back around to its own start',
        icon: <Unlink size="1em" />,
        disabled: Boolean(node.noEnd),
        onSelect: actions.onRemoveEnd,
      } satisfies MenuEntry]
      : []),
    {
      id: `rte-ctx:${node.id}:loopify`,
      label: 'Loopify',
      icon: <RotateCcw size="1em" />,
      disabled: !actions.canLift,
      onSelect: actions.onLoopify,
    },
    {
      id: `rte-ctx:${node.id}:blockify`,
      label: 'Blockify',
      icon: <TextQuote size="1em" />,
      disabled: !actions.canLift,
      onSelect: actions.onBlockify,
    },
    { type: 'separator' },
    {
      id: `rte-ctx:${node.id}:enabled`,
      label: node.disabled ? 'Enable' : 'Disable',
      icon: node.disabled ? <Power size="1em" /> : <Ban size="1em" />,
      onSelect: actions.onToggleEnabled,
    },
    {
      id: `rte-ctx:${node.id}:delete`,
      label: 'Delete',
      icon: <Trash2 size="1em" />,
      danger: true,
      onSelect: actions.onDelete,
    },
  ], actions.edit)
}

interface PickCtxActions {
  /** what the tile stands for, named so the menu can say what it adds */
  label: string
  /** where a plain press would put it, which is after whatever is selected */
  hasSelection: boolean
  onAdd: () => void
  onAddAtEnd: () => void
}

/**
 * What a palette tile offers. Pressing one already adds it after the selected
 * row, so the menu's own job is to offer the other place it could go.
 */
export function makeSelectionMenu(actions: PickCtxActions): MenuEntry[] {
  return [
    {
      id: 'rte-pick:add',
      label: `Add ${actions.label}`,
      hint: actions.hasSelection ? 'After the selected row' : 'At the end',
      icon: <CopyPlus size="1em" />,
      onSelect: actions.onAdd,
    },
    {
      id: 'rte-pick:add-end',
      label: 'Add at the end',
      icon: <ListEnd size="1em" />,
      disabled: !actions.hasSelection,
      onSelect: actions.onAddAtEnd,
    },
  ]
}
