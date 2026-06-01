/*
  Author: Runor Ewhro
  Description: Hosts inventory-layer shared context so nested panels and modals
               can coordinate inventory view state without prop drilling.
*/

import type { ReactNode } from 'react'
import type { InvEchoEnt } from '@/domain/entities/inventoryStorage.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'

interface InvMenu {
  invCard: (args: {
    entryId: string
    equipEntries: MenuEntry[]
    previewNode?: ReactNode
    onEdit: () => void
    onRemove: () => void
    onCopy: () => void
    onCut: () => void
    onPaste: () => void
    onSelect: () => void
  }) => MenuEntry[]
}

export interface InvFit {
  fits: boolean
  selected: boolean
  preview: ReactNode
}

interface GetInvEchoCt {
  menu: InvMenu
  entry: InvEchoEnt
  fits: InvFit[]
  previewNode?: ReactNode
  onEquip: (slotIndex: number) => void
  onEdit: () => void
  onRemove: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onSel: () => void
}

export function getInvEchoCt({
  menu,
  entry,
  fits,
  previewNode,
  onEquip,
  onEdit,
  onRemove,
  onCopy,
  onCut,
  onPaste,
  onSel,
}: GetInvEchoCt): MenuEntry[] {
  const equipEntries = fits
    .map((fit, index) => fit.fits ? {
      id: `inventory-echo:${entry.id}:equip:${index}`,
      label: `Slot ${index + 1}`,
      hint: fit.selected ? 'Current' : undefined,
      preview: fit.preview,
      onSelect: () => onEquip(index),
    } : null)
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return menu.invCard({
    entryId: entry.id,
    equipEntries,
    previewNode,
    onEdit,
    onRemove,
    onCopy,
    onCut,
    onPaste,
    onSelect: onSel,
  })
}
