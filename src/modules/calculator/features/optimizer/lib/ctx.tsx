/*
  Author: Runor Ewhro
  Description: Builds optimizer surface context values and option helpers used
               by the split optimizer controls, result panes, and menus.
*/

import type { SelectOption, SelectGroup } from '@/shared/ui/LiquidSelect'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { Cpu, Crosshair, Eraser, Image as ImageIcon, Play, RotateCcw, Square, SquareArrowUpRight as SqrRrwUpRght } from 'lucide-react'

interface GetOptCtxArg {
  pane: (args: { items: MenuEntry[] }) => MenuEntry[]
  targetMode: 'skill' | 'combo'
  skillGroups: SelectGroup<string>[]
  comboOptions: SelectOption<string>[]
  tgtSkllId: string | null
  tgtCmbId: string | null
  enableGpu: boolean
  // combo target mode requires a rotation with feature nodes; when false the
  // target-mode submenu only offers skill.
  comboAvailable: boolean
  isSprite: boolean
  isLoading: boolean
  pending: boolean
  onPickRes: () => void
  onTargetMode: (value: 'skill' | 'combo') => void
  onSkill: (value: string) => void
  onCombo: (value: string) => void
  onGpu: (value: boolean) => void
  onSprite: (value: boolean) => void
  onSync: () => void
  onRun: () => void
  onHalt: () => void
  onReset: () => void
  onClear: () => void
}

export function getOptCtx({
  pane,
  targetMode,
  skillGroups,
  comboOptions,
  tgtSkllId: trgtSkllId,
  tgtCmbId: trgtCmbId,
  enableGpu,
  comboAvailable,
  isSprite,
  isLoading,
  pending,
  onPickRes,
  onTargetMode,
  onSkill,
  onCombo,
  onGpu,
  onSprite,
  onSync,
  onRun,
  onHalt,
  onReset,
  onClear,
}: GetOptCtxArg): MenuEntry[] {
  const targetItems: MenuEntry[] = targetMode === 'combo'
    ? comboOptions.map((option) => ({
        id: `optimizer-menu:combo:${option.value}`,
        label: option.label,
        disabled: trgtCmbId === option.value,
        onSelect: () => onCombo(option.value),
      }))
    : skillGroups.flatMap((group, index) => {
        const items: MenuEntry[] = [{
          id: `optimizer-menu:skill-group:${group.label}`,
          label: group.label,
          submenu: group.options.map((option) => ({
            id: `optimizer-menu:skill:${option.value}`,
            label: option.label,
            disabled: trgtSkllId === option.value,
            onSelect: () => onSkill(option.value),
          })),
        }]

        if (index < skillGroups.length - 1) {
          items.push({ type: 'separator' })
        }

        return items
      })

  return pane({
    items: [
      {
        id: 'optimizer-menu:switch-resonator',
        label: 'Switch Resonator...',
        icon: <SqrRrwUpRght size={15} />,
        onSelect: onPickRes,
      },
      // combo mode needs a rotation with feature nodes; without one only skill
      // applies, so the target-mode submenu is hidden rather than offering a
      // single forced choice.
      ...(comboAvailable ? [{
        id: 'optimizer-menu:target-mode',
        label: 'Target Mode...',
        icon: <Crosshair size={15} />,
        submenu: [
          {
            id: 'optimizer-menu:target-mode:skill',
            label: 'Skill',
            disabled: targetMode === 'skill',
            onSelect: () => onTargetMode('skill'),
          },
          {
            id: 'optimizer-menu:target-mode:combo',
            label: 'Combo',
            disabled: targetMode === 'combo',
            onSelect: () => onTargetMode('combo'),
          },
        ],
      }] : []),
      {
        id: 'optimizer-menu:compute-mode',
        label: 'Compute Mode...',
        icon: <Cpu size={15} />,
        submenu: [
          {
            id: 'optimizer-menu:compute-mode:gpu',
            label: 'GPU',
            disabled: enableGpu,
            onSelect: () => onGpu(true),
          },
          {
            id: 'optimizer-menu:compute-mode:cpu',
            label: 'CPU',
            disabled: !enableGpu,
            onSelect: () => onGpu(false),
          },
        ],
      },
      {
        id: 'optimizer-menu:portrait-mode',
        label: 'Portrait Mode...',
        icon: <ImageIcon size={15} />,
        submenu: [
          {
            id: 'optimizer-menu:portrait-mode:sprite',
            label: 'Sprite',
            disabled: isSprite,
            onSelect: () => onSprite(true),
          },
          {
            id: 'optimizer-menu:portrait-mode:profile',
            label: 'Profile',
            disabled: !isSprite,
            onSelect: () => onSprite(false),
          },
        ],
      },
      {
        id: 'optimizer-menu:target',
        label: 'Target...',
        icon: <Crosshair size={15} />,
        disabled: targetItems.length === 0,
        submenu: targetItems,
      },
      { type: 'separator' },
      {
        id: 'optimizer-menu:sync-live',
        label: 'Sync Live',
        icon: <RotateCcw size={15} />,
        disabled: isLoading,
        onSelect: onSync,
      },
      {
        id: 'optimizer-menu:run',
        label: 'Run',
        icon: <Play size={15} />,
        disabled: isLoading || pending,
        onSelect: onRun,
      },
      {
        id: 'optimizer-menu:halt',
        label: 'Halt',
        icon: <Square size={15} />,
        onSelect: onHalt,
      },
      {
        id: 'optimizer-menu:reset',
        label: 'Reset',
        icon: <RotateCcw size={15} />,
        onSelect: onReset,
      },
      {
        id: 'optimizer-menu:clear',
        label: 'Clear',
        icon: <Eraser size={15} />,
        onSelect: onClear,
      },
    ],
  })
}
