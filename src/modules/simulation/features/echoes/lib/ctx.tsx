/*
  Author: Runor Ewhro
  Description: Provides echo-surface context shared between panes, menus, and
               clipboard actions so those features can coordinate selection and
               inventory behavior.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'

interface EchoPaneMenu {
  pane: (args: {
    curBldSvd: boolean
    canSaveAll: boolean
    canNqpAll: boolean
    canSelectAny: boolean
    selMode: boolean
    onOpenInv: () => void
    onImportEcho: () => void
    onSaveBuild: () => void
    onSaveAll: () => void
    onUnequipAll: () => void
    onPaste: () => void
    onSelectAll: () => void
    onDeselectAll: () => void
  }) => MenuEntry[]
  emptySlot: (args: {
    slotIndex: number
    canSelectAny: boolean
    selMode: boolean
    onSelectEcho: () => void
    onOpenInv: () => void
    onPaste: () => void
    onSelectAll: () => void
    onDeselectAll: () => void
  }) => MenuEntry[]
  slot: (args: {
    slotIndex: number
    canSave: boolean
    descVisible: boolean
    onSave: () => void
    onRemove: () => void
    onEdit: () => void
    onChange: () => void
    onCopy: () => void
    onCut: () => void
    onPaste: () => void
    onSelect: () => void
    onFindInInv?: () => void
    onToggleDesc?: () => void
  }) => MenuEntry[]
}

interface GetEchoSlotC {
  menu: EchoPaneMenu
  slotIndex: number
  echo: EchoInstance
  canSave: boolean
  descVisible: boolean
  hasDesc: boolean
  onSave: () => void
  onRemove: () => void
  onEdit: () => void
  onChange: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onSel: () => void
  onFind: () => void
  onToggleDesc: () => void
}

interface GetEchoMptyC {
  menu: EchoPaneMenu
  slotIndex: number
  canSel: boolean
  mode: boolean
  onPick: () => void
  onOpenInv: () => void
  onPaste: () => void
  onAll: () => void
  onNone: () => void
}

interface GetEchoPaneC {
  menu: EchoPaneMenu
  saved: boolean
  canSaveAll: boolean
  canNqpAll: boolean
  canSel: boolean
  mode: boolean
  onOpenInv: () => void
  onImport: () => void
  onSaveBuild: () => void
  onSaveAll: () => void
  onUnequipAll: () => void
  onPaste: () => void
  onAll: () => void
  onNone: () => void
}

export function getEchoSlotC({
  menu,
  slotIndex,
  echo,
  canSave,
  descVisible,
  hasDesc,
  onSave,
  onRemove,
  onEdit,
  onChange,
  onCopy,
  onCut,
  onPaste,
  onSel,
  onFind,
  onToggleDesc,
}: GetEchoSlotC): MenuEntry[] {
  return menu.slot({
    slotIndex,
    canSave,
    descVisible,
    onSave,
    onRemove,
    onEdit,
    onChange,
    onCopy,
    onCut,
    onPaste,
    onSelect: () => {
      void echo
      onSel()
    },
    onFindInInv: onFind,
    ...(slotIndex === 0 && hasDesc ? { onToggleDesc } : {}),
  })
}

export function getEchoMptyC({
  menu,
  slotIndex,
  canSel,
  mode,
  onPick,
  onOpenInv,
  onPaste,
  onAll,
  onNone,
}: GetEchoMptyC): MenuEntry[] {
  return menu.emptySlot({
    slotIndex,
    canSelectAny: canSel,
    selMode: mode,
    onSelectEcho: onPick,
    onOpenInv: onOpenInv,
    onPaste,
    onSelectAll: onAll,
    onDeselectAll: onNone,
  })
}

export function getEchoPaneC({
  menu,
  saved,
  canSaveAll,
  canNqpAll: canNqpAll,
  canSel,
  mode,
  onOpenInv,
  onImport,
  onSaveBuild,
  onSaveAll,
  onUnequipAll,
  onPaste,
  onAll,
  onNone,
}: GetEchoPaneC): MenuEntry[] {
  return menu.pane({
    curBldSvd: saved,
    canSaveAll,
    canNqpAll: canNqpAll,
    canSelectAny: canSel,
    selMode: mode,
    onOpenInv: onOpenInv,
    onImportEcho: onImport,
    onSaveBuild,
    onSaveAll,
    onUnequipAll,
    onPaste,
    onSelectAll: onAll,
    onDeselectAll: onNone,
  })
}
