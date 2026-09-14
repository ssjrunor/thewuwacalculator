/*
  Author: Runor Ewhro
  Description: Builds context-menu entries for evaluation resonator selection.
*/

import { ArrowRightLeft, Clipboard, Copy, Scissors, SquareDashedMousePointer, Trash2 } from 'lucide-react'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'

interface GetEvaluationStageCtx {
  canDeleteAll: boolean
  onPaste: () => void
  onDeleteAll: () => void
}

interface GetEvaluationTargetCtx {
  id: string
  isActive: boolean
  isSelectionPicked: boolean
  onSwitch: () => void
  onDelete: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onSelect: () => void
}

export function getEvaluationStageCtx({
  canDeleteAll,
  onPaste,
  onDeleteAll,
}: GetEvaluationStageCtx): MenuEntry[] {
  return [
    {
      id: 'evaluation-stage:paste',
      label: 'Paste',
      icon: <Clipboard size="1em" />,
      onSelect: onPaste,
    },
    {
      id: 'evaluation-stage:delete-all',
      label: 'Delete All',
      icon: <Trash2 size="1em" />,
      danger: true,
      disabled: !canDeleteAll,
      onSelect: onDeleteAll,
    },
  ]
}

export function getEvaluationTargetCtx({
  id,
  isActive,
  isSelectionPicked,
  onSwitch,
  onDelete,
  onCut,
  onCopy,
  onPaste,
  onSelect,
}: GetEvaluationTargetCtx): MenuEntry[] {
  return [
    {
      id: `evaluation-target:${id}:switch`,
      label: 'Open Context',
      icon: <ArrowRightLeft size="1em" />,
      disabled: isActive,
      onSelect: onSwitch,
    },
    {
      id: `evaluation-target:${id}:delete`,
      label: 'Delete',
      icon: <Trash2 size="1em" />,
      danger: true,
      onSelect: onDelete,
    },
    { type: 'separator' },
    {
      id: `evaluation-target:${id}:cut`,
      label: 'Cut',
      icon: <Scissors size="1em" />,
      onSelect: onCut,
    },
    {
      id: `evaluation-target:${id}:copy`,
      label: 'Copy',
      icon: <Copy size="1em" />,
      onSelect: onCopy,
    },
    {
      id: `evaluation-target:${id}:paste`,
      label: 'Paste',
      icon: <Clipboard size="1em" />,
      onSelect: onPaste,
    },
    {
      id: `evaluation-target:${id}:select`,
      label: isSelectionPicked ? 'Deselect' : 'Select',
      icon: <SquareDashedMousePointer size="1em" />,
      onSelect,
    },
  ]
}
