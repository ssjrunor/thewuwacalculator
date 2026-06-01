/*
  Author: Runor Ewhro
  Description: Provides overview-surface context for copy, selection, and
               menu actions shared by overview subsections.
*/

import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { ArrowRightLeft as RrwRghtLeft, Clipboard, Copy, Eye, Scissors, SquareDashedMousePointer as SqrDshdMsPnt, Trash2 } from 'lucide-react'

interface GetOvStgCtxA {
  canDelAll: boolean
  onPaste: () => void
  onDelAll: () => void
}

interface GetOvDashCtx {
  canSwitch: boolean
  onSwitch: () => void
  onDel: () => void
}

interface GetOvPillCtx {
  id: string
  isActive: boolean
  isPicked: boolean
  isSel: boolean
  onInspect: () => void
  onSwitch: () => void
  onDel: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onSel: () => void
}

export function getOvStgCtx({
  canDelAll,
  onPaste,
  onDelAll,
}: GetOvStgCtxA): MenuEntry[] {
  return [
    {
      id: 'overview-stage:paste',
      label: 'Paste',
      icon: <Clipboard size={15} />,
      onSelect: onPaste,
    },
    {
      id: 'overview-stage:delete-all',
      label: 'Delete All',
      icon: <Trash2 size={15} />,
      danger: true,
      disabled: !canDelAll,
      onSelect: onDelAll,
    },
  ]
}

export function getOvDashCtx({
  canSwitch,
  onSwitch,
  onDel,
}: GetOvDashCtx): MenuEntry[] {
  return [
    {
      id: 'overview-dashboard:switch',
      label: 'Switch',
      icon: <RrwRghtLeft size={15} />,
      disabled: !canSwitch,
      onSelect: onSwitch,
    },
    {
      id: 'overview-dashboard:delete',
      label: 'Delete',
      icon: <Trash2 size={15} />,
      danger: true,
      onSelect: onDel,
    },
  ]
}

export function getOvPillCtx({
  id,
  isActive,
  isPicked,
  isSel,
  onInspect,
  onSwitch,
  onDel,
  onCut,
  onCopy,
  onPaste,
  onSel,
}: GetOvPillCtx): MenuEntry[] {
  return [
    {
      id: `overview-pill:${id}:inspect`,
      label: 'Inspect',
      icon: <Eye size={15} />,
      disabled: isPicked,
      onSelect: onInspect,
    },
    {
      id: `overview-pill:${id}:switch`,
      label: 'Switch',
      icon: <RrwRghtLeft size={15} />,
      disabled: isActive,
      onSelect: onSwitch,
    },
    {
      id: `overview-pill:${id}:delete`,
      label: 'Delete',
      icon: <Trash2 size={15} />,
      danger: true,
      onSelect: onDel,
    },
    { type: 'separator' },
    {
      id: `overview-pill:${id}:cut`,
      label: 'Cut',
      icon: <Scissors size={15} />,
      onSelect: onCut,
    },
    {
      id: `overview-pill:${id}:copy`,
      label: 'Copy',
      icon: <Copy size={15} />,
      onSelect: onCopy,
    },
    {
      id: `overview-pill:${id}:paste`,
      label: 'Paste',
      icon: <Clipboard size={15} />,
      onSelect: onPaste,
    },
    {
      id: `overview-pill:${id}:select`,
      label: isSel ? 'Deselect' : 'Select',
      icon: <SqrDshdMsPnt size={15} />,
      onSelect: onSel,
    },
  ]
}
