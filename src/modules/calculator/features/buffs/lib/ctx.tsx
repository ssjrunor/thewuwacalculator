/*
  Author: Runor Ewhro
  Description: Builds context-menu entries for the buff preset modal.
*/

import {
  CheckSquare,
  Copy,
  Plus,
  SquareDashedMousePointer,
  XSquare,
} from 'lucide-react'
import type { MnlMod } from '@/domain/entities/manualBuffs.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type { BuffPresetEntry } from '@/modules/calculator/features/buffs/lib/presets.ts'

interface BuffPresetCtxTarget {
  entries: BuffPresetEntry[]
  modifiers: MnlMod[]
}

interface BuffPresetEntryCtxArgs {
  entry: BuffPresetEntry
  target: BuffPresetCtxTarget
  entrySelected: boolean
  entrySelectable: boolean
  canSelectVisible: boolean
  selectedCount: number
  onAdd: (modifiers: MnlMod[]) => void
  onCopy: (modifiers: MnlMod[]) => void
  onSelect: (entry: BuffPresetEntry) => void
  onDeselect: (entry: BuffPresetEntry) => void
  onSelectVisible: () => void
  onClearSelection: () => void
}

interface BuffPresetPaneCtxArgs {
  selectedModifiers: MnlMod[]
  canSelectVisible: boolean
  selectedCount: number
  onAddSelected: () => void
  onCopySelected: () => void
  onSelectVisible: () => void
  onClearSelection: () => void
}

function modifierHint(count: number): string {
  return `${count} ${count === 1 ? 'modifier' : 'modifiers'}`
}

export function getBuffPresetEntryCtx({
  entry,
  target,
  entrySelected,
  entrySelectable,
  canSelectVisible,
  selectedCount,
  onAdd,
  onCopy,
  onSelect,
  onDeselect,
  onSelectVisible,
  onClearSelection,
}: BuffPresetEntryCtxArgs): MenuEntry[] {
  const targetIsSelection = target.entries.length > 1 || entrySelected

  return [
    {
      id: `buff-presets:${entry.id}:add`,
      label: targetIsSelection ? 'Add Selected' : 'Add Preset',
      hint: modifierHint(target.modifiers.length),
      icon: <Plus size={15} />,
      disabled: target.modifiers.length === 0,
      onSelect: () => onAdd(target.modifiers),
    },
    {
      id: `buff-presets:${entry.id}:copy`,
      label: targetIsSelection ? 'Copy Selected' : 'Copy Preset',
      hint: modifierHint(target.modifiers.length),
      icon: <Copy size={15} />,
      disabled: target.modifiers.length === 0,
      onSelect: () => onCopy(target.modifiers),
    },
    { type: 'separator' },
    {
      id: `buff-presets:${entry.id}:select`,
      label: 'Select',
      icon: <SquareDashedMousePointer size={15} />,
      disabled: !entrySelectable || entrySelected,
      onSelect: () => onSelect(entry),
    },
    {
      id: `buff-presets:${entry.id}:deselect`,
      label: 'Deselect',
      icon: <XSquare size={15} />,
      disabled: !entrySelected,
      onSelect: () => onDeselect(entry),
    },
    {
      id: `buff-presets:${entry.id}:select-visible`,
      label: 'Select Visible',
      icon: <CheckSquare size={15} />,
      disabled: !canSelectVisible,
      onSelect: onSelectVisible,
    },
    {
      id: `buff-presets:${entry.id}:clear`,
      label: 'Clear Selection',
      icon: <XSquare size={15} />,
      disabled: selectedCount === 0,
      onSelect: onClearSelection,
    },
  ]
}

export function getBuffPresetPaneCtx({
  selectedModifiers,
  canSelectVisible,
  selectedCount,
  onAddSelected,
  onCopySelected,
  onSelectVisible,
  onClearSelection,
}: BuffPresetPaneCtxArgs): MenuEntry[] {
  return [
    {
      id: 'buff-presets:modal:add-selected',
      label: 'Add Selected',
      hint: modifierHint(selectedModifiers.length),
      icon: <Plus size={15} />,
      disabled: selectedModifiers.length === 0,
      onSelect: onAddSelected,
    },
    {
      id: 'buff-presets:modal:copy-selected',
      label: 'Copy Selected',
      hint: modifierHint(selectedModifiers.length),
      icon: <Copy size={15} />,
      disabled: selectedModifiers.length === 0,
      onSelect: onCopySelected,
    },
    { type: 'separator' },
    {
      id: 'buff-presets:modal:select-visible',
      label: 'Select Visible',
      icon: <CheckSquare size={15} />,
      disabled: !canSelectVisible,
      onSelect: onSelectVisible,
    },
    {
      id: 'buff-presets:modal:clear-selection',
      label: 'Clear Selection',
      icon: <XSquare size={15} />,
      disabled: selectedCount === 0,
      onSelect: onClearSelection,
    },
  ]
}
