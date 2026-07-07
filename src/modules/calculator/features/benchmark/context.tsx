/*
  Author: Runor Ewhro
  Description: Builds context-menu entries for benchmark resonator selection.
*/

import { ArrowRightLeft, Clipboard, Copy, Eye, Scissors, SquareDashedMousePointer, Trash2 } from 'lucide-react'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'

interface GetBenchStageCtx {
  canDeleteAll: boolean
  onPaste: () => void
  onDeleteAll: () => void
}

interface GetBenchTargetCtx {
  id: string
  isActive: boolean
  isSelectedTarget: boolean
  isSelectionPicked: boolean
  onInspect: () => void
  onSwitch: () => void
  onDelete: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onSelect: () => void
}

export function getBenchStageCtx({
  canDeleteAll,
  onPaste,
  onDeleteAll,
}: GetBenchStageCtx): MenuEntry[] {
  return [
    {
      id: 'benchmark-stage:paste',
      label: 'Paste',
      icon: <Clipboard size={15} />,
      onSelect: onPaste,
    },
    {
      id: 'benchmark-stage:delete-all',
      label: 'Delete All',
      icon: <Trash2 size={15} />,
      danger: true,
      disabled: !canDeleteAll,
      onSelect: onDeleteAll,
    },
  ]
}

export function getBenchTargetCtx({
  id,
  isActive,
  isSelectedTarget,
  isSelectionPicked,
  onInspect,
  onSwitch,
  onDelete,
  onCut,
  onCopy,
  onPaste,
  onSelect,
}: GetBenchTargetCtx): MenuEntry[] {
  return [
    {
      id: `benchmark-target:${id}:inspect`,
      label: 'Inspect',
      icon: <Eye size={15} />,
      disabled: isSelectedTarget,
      onSelect: onInspect,
    },
    {
      id: `benchmark-target:${id}:switch`,
      label: 'Switch',
      icon: <ArrowRightLeft size={15} />,
      disabled: isActive,
      onSelect: onSwitch,
    },
    {
      id: `benchmark-target:${id}:delete`,
      label: 'Delete',
      icon: <Trash2 size={15} />,
      danger: true,
      onSelect: onDelete,
    },
    { type: 'separator' },
    {
      id: `benchmark-target:${id}:cut`,
      label: 'Cut',
      icon: <Scissors size={15} />,
      onSelect: onCut,
    },
    {
      id: `benchmark-target:${id}:copy`,
      label: 'Copy',
      icon: <Copy size={15} />,
      onSelect: onCopy,
    },
    {
      id: `benchmark-target:${id}:paste`,
      label: 'Paste',
      icon: <Clipboard size={15} />,
      onSelect: onPaste,
    },
    {
      id: `benchmark-target:${id}:select`,
      label: isSelectionPicked ? 'Deselect' : 'Select',
      icon: <SquareDashedMousePointer size={15} />,
      onSelect,
    },
  ]
}
