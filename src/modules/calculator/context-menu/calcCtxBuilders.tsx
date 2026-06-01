/*
  Author: Runor Ewhro
  Description: Builds calculator-specific context-menu entries for panes,
               selections, inventory actions, and rotation/editor workflows.
*/

import {
  ArrowRightLeft as RrwRghtLeft, BadgePercent, BookText,
  CheckSquare,
  Clipboard,
  Copy,
  CopyPlus,
  Eye,
  FileImage,
  FileText,
  ListChevronsDownUp as ListChvrDown,
  ListChevronsUpDown as ListChvrUpDo,
  ListCollapse,
  Milestone,
  PackageOpen,
  Pencil,
  Save,
  Scissors,
  Search,
  SquareDashedMousePointer as SqrDshdMsPnt,
  Trash2,
  XSquare,
} from 'lucide-react'
import { IoArchive } from 'react-icons/io5'
import type { ReactNode } from 'react'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'

interface CalcMoreBldr {
  swtcToNtrs: MenuEntry[]
  paneEntries: MenuEntry[]
  showSubHits: boolean
  onToggleSubHits: () => void
}

interface CalcDmgRowBl {
  rowId: string
  subHitsVis: boolean
  hasSubHitReq: boolean
  onTgglFrml: () => void
  onTgglSubHwm: () => void
  onOpenSklleu?: () => void
  moreEntries: MenuEntry[]
}

interface CalcRotBldrA {
  items: MenuEntry[]
  moreEntries: MenuEntry[]
}

interface CalcMnlBuffP {
  canSelectAny: boolean
  selMode: boolean
  onPaste: () => void
  onSelectAll: () => void
  onDeselectAll: () => void
  moreEntries: MenuEntry[]
}

interface CalcMnlBuffI {
  modifierId: string
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSelect: () => void
  moreEntries: MenuEntry[]
}

interface CalcEchoSlot {
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
}

interface CalcEchoMpty {
  slotIndex: number
  canSelectAny: boolean
  selMode: boolean
  onSelectEcho: () => void
  onOpenInv: () => void
  onPaste: () => void
  onSelectAll: () => void
  onDeselectAll: () => void
}

interface CalcEchoPane {
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
}

interface CalcInvEchoB {
  entryId: string
  equipEntries: MenuEntry[]
  previewNode?: ReactNode
  onEdit: () => void
  onRemove: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onSelect: () => void
}

interface CalcInvMkBld {
  entryId: string
  onEquip: () => void
  onRename: () => void
  onRemove: () => void
}

interface CalcReadOnly {
  id: string
  canSave: boolean
  equipEntries: MenuEntry[]
  onSave: () => void
  onCopy: () => void
  onSelect: () => void
}

function ppndMoreMenu(
    items: MenuEntry[],
    moreEntries: MenuEntry[],
    id: string,
): MenuEntry[] {
  // feature-specific menus append route/workspace entries through one consistent "more" submenu instead of duplicating
  // global actions in every builder.
  if (moreEntries.length === 0) {
    return items
  }

  return [
    ...items,
    ...(items.length > 0 ? [{ type: 'separator' as const }] : []),
    {
      id,
      label: 'More...',
      icon: <ListCollapse size={15} />,
      submenu: moreEntries,
    },
  ]
}

export const calcBuilder = {
  calculator: {
    more({
           swtcToNtrs: swtcToNtrs,
           paneEntries,
           showSubHits,
           onToggleSubHits: onTgglShowSu,
         }: CalcMoreBldr): MenuEntry[] {
      return [
        {
          id: 'main-switch-to',
          label: 'Switch to...',
          icon: <RrwRghtLeft size={15} />,
          submenu: swtcToNtrs,
        },
        {
          id: 'main-open-pane',
          label: 'Open pane...',
          icon: <Milestone size={15} />,
          submenu: paneEntries,
        },
        {
          id: 'main-show-subhits',
          label: showSubHits ? 'Hide Sub-Hits' : 'Show Sub-Hits',
          icon: showSubHits ? <ListChvrDown size={15} /> : <ListChvrUpDo size={15} />,
          onSelect: onTgglShowSu,
        },
      ]
    },

    workspace(args: CalcMoreBldr): MenuEntry[] {
      return calcBuilder.calculator.more(args)
    },

    damage: {
      row({
            rowId,
            subHitsVis: subHitsVis,
            hasSubHitReq: hasSubHitRow,
            onTgglFrml: onTgglFrml,
            onTgglSubHwm: onTgglSubHit,
            onOpenSklleu: onOpenSkllDa,
            moreEntries,
          }: CalcDmgRowBl): MenuEntry[] {
        // damage rows always keep formula access first; optional skill data and global more actions are appended after
        // row-local visibility controls.
        return ppndMoreMenu([
          {
            id: `formula:${rowId}`,
            label: 'See Formula',
            icon: <BadgePercent size={15} />,
            onSelect: onTgglFrml,
          },
          {
            id: `subhits:${rowId}`,
            label: subHitsVis ? 'Hide Subhits' : 'Show Subhits',
            disabled: !hasSubHitRow,
            icon: subHitsVis ? <ListChvrDown size={15} /> : <ListChvrUpDo size={15} />,
            onSelect: onTgglSubHit,
          },
          ...(onOpenSkllDa ? [{
            icon: <BookText size={15} />,
            id: `skill-data:${rowId}`,
            label: 'See Skill Data',
            onSelect: onOpenSkllDa,
          } satisfies MenuEntry] : []),
        ], moreEntries, `more:${rowId}`)
      },
    },

    rotation: {
      pane({ items, moreEntries }: CalcRotBldrA): MenuEntry[] {
        return ppndMoreMenu(items, moreEntries, 'main-more')
      },

      item({ items, moreEntries }: CalcRotBldrA): MenuEntry[] {
        return ppndMoreMenu(items, moreEntries, 'main-item-more')
      },
    },

    optimizer: {
      main({ items, moreEntries }: CalcRotBldrA): MenuEntry[] {
        return ppndMoreMenu(items, moreEntries, 'main-more')
      },
    },

    manualBuffs: {
      pane({
             canSelectAny,
             selMode: selectMode,
             onPaste,
             onSelectAll,
             onDeselectAll: onDeselectAll,
             moreEntries,
           }: CalcMnlBuffP): MenuEntry[] {
        // pane-level manual-buff menus own paste/select-all actions because they do not need a specific modifier row.
        return ppndMoreMenu([
          {
            id: 'manual-buffs:pane:paste',
            label: 'Paste',
            icon: <Clipboard size={15} />,
            onSelect: onPaste,
          },
          {
            id: 'manual-buffs:pane:select-all',
            label: 'Select All',
            icon: <CheckSquare size={15} />,
            disabled: !canSelectAny,
            onSelect: onSelectAll,
          },
          {
            id: 'manual-buffs:pane:deselect-all',
            label: 'Deselect All',
            icon: <XSquare size={15} />,
            disabled: !selectMode,
            onSelect: onDeselectAll,
          },
        ], moreEntries, 'manual-buffs:pane:more')
      },

      item({
             modifierId,
             onCopy,
             onCut,
             onPaste,
             onDuplicate,
             onDelete,
             onSelect,
             moreEntries,
           }: CalcMnlBuffI): MenuEntry[] {
        // item menus intentionally expose both clipboard and selection actions so right-clicking a row can bootstrap
        // multi-select workflows.
        return ppndMoreMenu([
          {
            id: `manual-buffs:${modifierId}:copy`,
            label: 'Copy',
            icon: <Copy size={15} />,
            onSelect: onCopy,
          },
          {
            id: `manual-buffs:${modifierId}:cut`,
            label: 'Cut',
            icon: <Scissors size={15} />,
            onSelect: onCut,
          },
          {
            id: `manual-buffs:${modifierId}:paste`,
            label: 'Paste',
            icon: <Clipboard size={15} />,
            onSelect: onPaste,
          },
          {
            id: `manual-buffs:${modifierId}:duplicate`,
            label: 'Duplicate',
            icon: <CopyPlus size={15} />,
            onSelect: onDuplicate,
          },
          {
            id: `manual-buffs:${modifierId}:delete`,
            label: 'Delete',
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: onDelete,
          },
          {
            id: `manual-buffs:${modifierId}:select`,
            label: 'Select',
            icon: <SqrDshdMsPnt size={15} />,
            onSelect,
          },
        ], moreEntries, `manual-buffs:${modifierId}:more`)
      },
    },

    echo: {
      pane({
             curBldSvd: crrnBldSvd,
             canSaveAll,
             canNqpAll: canNqpAll,
             canSelectAny,
             selMode: selectMode,
             onOpenInv: onOpenInv,
             onImportEcho,
             onSaveBuild,
             onSaveAll,
             onUnequipAll,
             onPaste,
             onSelectAll,
             onDeselectAll: onDeselectAll,
           }: CalcEchoPane): MenuEntry[] {
        return [
          {
            id: 'echo-pane:open-inventory',
            label: 'Open Inventory',
            icon: <PackageOpen size={15} />,
            onSelect: onOpenInv,
          },
          { type: 'separator' },
          {
            id: 'echo-pane:import-echo',
            label: 'Import Echo',
            icon: <FileImage size={15} />,
            onSelect: onImportEcho,
          },
          {
            id: 'echo-pane:save-build',
            label: crrnBldSvd ? 'Build Saved' : 'Save Build',
            icon: <Save size={15} />,
            disabled: crrnBldSvd,
            onSelect: onSaveBuild,
          },
          {
            id: 'echo-pane:save-all',
            label: 'Save All',
            icon: <IoArchive size={15} />,
            disabled: !canSaveAll,
            onSelect: onSaveAll,
          },
          {
            id: 'echo-pane:unequip-all',
            label: 'Unequip All',
            icon: <Trash2 size={15} />,
            danger: true,
            disabled: !canNqpAll,
            onSelect: onUnequipAll,
          },
          { type: 'separator' },
          {
            id: 'echo-pane:paste',
            label: 'Paste',
            icon: <Clipboard size={15} />,
            onSelect: onPaste,
          },
          {
            id: 'echo-pane:select-all',
            label: 'Select All',
            icon: <CheckSquare size={15} />,
            disabled: !canSelectAny,
            onSelect: onSelectAll,
          },
          {
            id: 'echo-pane:deselect-all',
            label: 'Deselect All',
            icon: <XSquare size={15} />,
            disabled: !selectMode,
            onSelect: onDeselectAll,
          },
        ]
      },

      emptySlot({
                  slotIndex,
                  canSelectAny,
                  selMode: selectMode,
                  onSelectEcho,
                  onOpenInv: onOpenInv,
                  onPaste,
                  onSelectAll,
                  onDeselectAll: onDeselectAll,
                }: CalcEchoMpty): MenuEntry[] {
        return [
          {
            id: `echo-slot:${slotIndex}:select-echo`,
            label: 'Select Echo',
            icon: <SqrDshdMsPnt size={15} />,
            onSelect: onSelectEcho,
          },
          {
            id: `echo-slot:${slotIndex}:open-inventory`,
            label: 'Open Inventory',
            icon: <PackageOpen size={15} />,
            onSelect: onOpenInv,
          },
          {
            id: `echo-slot:${slotIndex}:paste`,
            label: 'Paste',
            icon: <Clipboard size={15} />,
            onSelect: onPaste,
          },
          { type: 'separator' },
          {
            id: `echo-slot:${slotIndex}:select-all`,
            label: 'Select All',
            icon: <CheckSquare size={15} />,
            disabled: !canSelectAny,
            onSelect: onSelectAll,
          },
          {
            id: `echo-slot:${slotIndex}:deselect-all`,
            label: 'Deselect All',
            icon: <XSquare size={15} />,
            disabled: !selectMode,
            onSelect: onDeselectAll,
          },
        ]
      },

      slot({
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
             onSelect,
             onFindInInv: onFindInInv,
             onToggleDesc,
           }: CalcEchoSlot): MenuEntry[] {
        return [
          {
            id: `echo-slot:${slotIndex}:save`,
            label: 'Save',
            icon: <Save size={15} />,
            disabled: !canSave,
            onSelect: onSave,
          },
          {
            id: `echo-slot:${slotIndex}:remove`,
            label: 'Remove',
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: onRemove,
          },
          ...(onToggleDesc ? [{
            id: `echo-slot:${slotIndex}:desc`,
            label: descVisible ? 'Hide Desc' : 'Show Desc',
            icon: <FileText size={15} />,
            onSelect: onToggleDesc,
          } satisfies MenuEntry] : []),
          {
            id: `echo-slot:${slotIndex}:edit`,
            label: 'Edit Echo',
            icon: <Pencil size={15} />,
            onSelect: onEdit,
          },
          {
            id: `echo-slot:${slotIndex}:change`,
            label: 'Change Echo',
            icon: <RrwRghtLeft size={15} />,
            onSelect: onChange,
          },
          ...(onFindInInv ? [
            { type: 'separator' as const },
            {
              id: `echo-slot:${slotIndex}:find-in-inventory`,
              label: 'Find in Inventory',
              icon: <Search size={15} />,
              onSelect: onFindInInv,
            } satisfies MenuEntry,
          ] : []),
          { type: 'separator' },
          {
            id: `echo-slot:${slotIndex}:cut`,
            label: 'Cut',
            icon: <Scissors size={15} />,
            onSelect: onCut,
          },
          {
            id: `echo-slot:${slotIndex}:copy`,
            label: 'Copy',
            icon: <Copy size={15} />,
            onSelect: onCopy,
          },
          {
            id: `echo-slot:${slotIndex}:paste`,
            label: 'Paste',
            icon: <Clipboard size={15} />,
            onSelect: onPaste,
          },
          {
            id: `echo-slot:${slotIndex}:select`,
            label: 'Select',
            icon: <SqrDshdMsPnt size={15} />,
            onSelect: onSelect,
          },
        ]
      },

      invCard({
                      entryId,
                      equipEntries,
                      previewNode,
                      onEdit,
                      onRemove,
                      onCopy,
                      onCut,
                      onPaste,
                      onSelect,
                    }: CalcInvEchoB): MenuEntry[] {
        return [
          ...(previewNode ? [{
            id: `inventory-echo:${entryId}:preview`,
            label: 'See Stats',
            icon: <Eye size={15} />,
            preview: previewNode,
            onSelect: () => {},
          }] : []),
          {
            id: `inventory-echo:${entryId}:edit`,
            label: 'Edit Echo',
            icon: <Pencil size={15} />,
            onSelect: onEdit,
          },
          {
            id: `inventory-echo:${entryId}:equip`,
            label: 'Equip...',
            icon: <RrwRghtLeft size={15} />,
            disabled: equipEntries.length === 0,
            submenu: equipEntries.length > 0 ? equipEntries : undefined,
          },
          {
            id: `inventory-echo:${entryId}:remove`,
            label: 'Remove',
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: onRemove,
          },
          { type: 'separator' },
          {
            id: `inventory-echo:${entryId}:cut`,
            label: 'Cut',
            icon: <Scissors size={15} />,
            onSelect: onCut,
          },
          {
            id: `inventory-echo:${entryId}:copy`,
            label: 'Copy',
            icon: <Copy size={15} />,
            onSelect: onCopy,
          },
          {
            id: `inventory-echo:${entryId}:paste`,
            label: 'Paste',
            icon: <Clipboard size={15} />,
            onSelect: onPaste,
          },
          {
            id: `inventory-echo:${entryId}:select`,
            label: 'Select',
            icon: <SqrDshdMsPnt size={15} />,
            onSelect: onSelect,
          },
        ]
      },

      invMk({
                       entryId,
                       onEquip,
                       onRename,
                       onRemove,
                     }: CalcInvMkBld): MenuEntry[] {
        return [
          {
            id: `inventory-build:${entryId}:equip`,
            label: 'Equip',
            icon: <RrwRghtLeft size={15} />,
            onSelect: onEquip,
          },
          {
            id: `inventory-build:${entryId}:rename`,
            label: 'Rename',
            icon: <Pencil size={15} />,
            onSelect: onRename,
          },
          {
            id: `inventory-build:${entryId}:remove`,
            label: 'Delete',
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: onRemove,
          },
        ]
      },

      readOnly({
                 id,
                 canSave,
                 equipEntries,
                 onSave,
                 onCopy,
                 onSelect,
               }: CalcReadOnly): MenuEntry[] {
        return [
          {
            id: `readonly-echo:${id}:save`,
            label: 'Save',
            icon: <Save size={15} />,
            disabled: !canSave,
            onSelect: onSave,
          },
          {
            id: `readonly-echo:${id}:equip`,
            label: 'Equip to...',
            icon: <RrwRghtLeft size={15} />,
            disabled: equipEntries.length === 0,
            submenu: equipEntries.length > 0 ? equipEntries : undefined,
          },
          { type: 'separator' },
          {
            id: `readonly-echo:${id}:copy`,
            label: 'Copy',
            icon: <Copy size={15} />,
            onSelect: onCopy,
          },
          {
            id: `readonly-echo:${id}:select`,
            label: 'Select',
            icon: <SqrDshdMsPnt size={15} />,
            onSelect,
          },
        ]
      },
    },
  },
}
