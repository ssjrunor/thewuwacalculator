/*
  Author: Runor Ewhro
  Description: builds route-level context-menu entries for navigation, layout,
               and app-history actions shared by the route chrome.
*/

import { ChartNoAxesColumnIncreasing as ChartInc, LayoutPanelTop as PanelTopIcon, MapPlus, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { FaMicrochip } from 'react-icons/fa6'
import { GiSchoolBag } from 'react-icons/gi'
import { RxActivityLog as RxCtvtLog } from 'react-icons/rx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type { RouteNavLink } from '@/shared/ui/routeChromeConfig'

interface RtChrmPgsBld {
  pages: RouteNavLink[]
  isPageCur: (to: string) => boolean
  onNavigate: (to: string) => void
}

interface RtChrmBttmSc extends RtChrmPgsBld {
  canUndo: boolean
  canRedo: boolean
  undoHistory: Array<{ label: string }>
  redoHistory: Array<{ label: string }>
  onUndo: () => void
  onRedo: () => void
  onUndoTo: (index: number) => void
  onRedoTo: (index: number) => void
  optAct: boolean
  bnchAct: boolean
  onOpenInv: () => void
  onTgglOpt: () => void
  onTgglBnch: () => void
  onOpenStatus: () => void
  canReset: boolean
  onReset: () => void
}

type RtChrmCtnsBl = Omit<
  RtChrmBttmSc,
  | 'pages'
  | 'isPageCur'
  | 'onNavigate'
  | 'canUndo'
  | 'canRedo'
  | 'undoHistory'
  | 'redoHistory'
  | 'onUndo'
  | 'onRedo'
  | 'onUndoTo'
  | 'onRedoTo'
  | 'canReset'
  | 'onReset'
>

export const routeCtxBuilder = {
  routeChrome: {
    undoRedo({
      canUndo,
      canRedo,
      undoHistory,
      redoHistory,
      onUndoTo,
      onRedoTo,
    }: Pick<
      RtChrmBttmSc,
      'canUndo' | 'canRedo' | 'undoHistory' | 'redoHistory' | 'onUndoTo' | 'onRedoTo'
    >): MenuEntry[] {
      return [
        {
          id: 'routechrome-undo',
          label: 'Undo',
          icon: <Undo2 size={15} />,
          hint: 'Ctrl/Cmd+Z',
          disabled: !canUndo,
          submenu: undoHistory.map((entry, index) => ({
            id: `routechrome-undo:${index}`,
            label: entry.label,
            onSelect: () => onUndoTo(index),
          })),
        },
        {
          id: 'routechrome-redo',
          label: 'Redo',
          icon: <Redo2 size={15} />,
          hint: 'Ctrl/Cmd+Y',
          disabled: !canRedo,
          submenu: redoHistory.map((entry, index) => ({
            id: `routechrome-redo:${index}`,
            label: entry.label,
            onSelect: () => onRedoTo(index),
          })),
        },
      ]
    },
    pages({ pages, isPageCur: isPageCrrn, onNavigate }: RtChrmPgsBld): MenuEntry[] {
      return pages.map(({ to, label, Icon, iconClssName: iconClssName }) => ({
        id: `routechrome-page:${to}`,
        label,
        icon: <Icon size={15} className={iconClssName} />,
        hint: isPageCrrn(to) ? 'Current' : undefined,
        disabled: isPageCrrn(to),
        onSelect: () => onNavigate(to),
      }))
    },
    actions(args: RtChrmCtnsBl): MenuEntry[] {
      return [
        {
          id: 'routechrome-inventory',
          label: 'Inventory',
          icon: <GiSchoolBag size={15} />,
          onSelect: args.onOpenInv,
        },
        {
          id: 'routechrome-optimizer',
          label: 'Optimizer',
          icon: <FaMicrochip size={15} />,
          hint: args.optAct ? 'Current' : undefined,
          disabled: args.optAct,
          onSelect: args.onTgglOpt,
        },
        {
          id: 'routechrome-benchmark',
          label: 'Benchmark',
          icon: <ChartInc size={15} />,
          hint: args.bnchAct ? 'Current' : undefined,
          disabled: args.bnchAct,
          onSelect: args.onTgglBnch,
        },
        {
          id: 'routechrome-status',
          label: 'Status',
          icon: <RxCtvtLog size={15} />,
          onSelect: args.onOpenStatus,
        },
      ]
    },
    reset({ canReset, onReset }: Pick<RtChrmBttmSc, 'canReset' | 'onReset'>): MenuEntry {
      return {
        id: 'routechrome-reset',
        label: 'Reset',
        icon: <RotateCcw size={15} />,
        danger: true,
        disabled: !canReset,
        onSelect: onReset,
      }
    },
    bttmSctn(args: RtChrmBttmSc): MenuEntry[] {
      const undoRedoEnts = routeCtxBuilder.routeChrome.undoRedo(args)
      const pageEntries = routeCtxBuilder.routeChrome.pages(args)
      const ctnEnts = routeCtxBuilder.routeChrome.actions(args)
      const resetEntry = routeCtxBuilder.routeChrome.reset(args)

      return [
        ...undoRedoEnts,
        { type: 'separator' },
        {
          id: 'routechrome-pages-submenu',
          label: 'Navigate...',
          icon: <MapPlus size={15} />,
          submenu: pageEntries,
        },
        {
          id: 'routechrome-actions-submenu',
          label: 'App...',
          icon: <PanelTopIcon size={15} />,
          submenu: ctnEnts,
        },
        resetEntry,
      ]
    },
    calcSctn(args: RtChrmBttmSc): MenuEntry[] {
      return routeCtxBuilder.routeChrome.bttmSctn(args)
    },
  },
}
