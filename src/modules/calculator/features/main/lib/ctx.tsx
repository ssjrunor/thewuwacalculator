/* eslint-disable react-refresh/only-export-features */

/*
  Author: Runor Ewhro
  Description: Binds calculator-wide menu builders, modal state, and shared
               actions so split calculator panes can reuse one central context.
*/

import { createContext as mkCtx, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LeftPaneView } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type { SkillTabKey } from '@/domain/entities/resonator.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'
import { RES_MENU, getResDtls } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { ResPckr } from '@/modules/calculator/features/resonator/Picker.tsx'
import { SkillData } from '@/modules/calculator/features/resonator/SkillData.tsx'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import { skillTab } from '@/modules/calculator/features/main/lib/skillData.ts'
import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import { SquareArrowUpRight as SqrRrwUpRght } from 'lucide-react'
import { useRtChrmMen } from '@/shared/context-menu/RouteCtx.tsx'
import { calcBuilder } from '@/modules/calculator/context-menu/calcCtxBuilders.tsx'
import { withDefResMg } from '@/shared/lib/imageFallback.ts'

interface SkllDataTgt {
  resonatorId: string
  tab: SkillTabKey
}

interface CalcCtxValue {
  openResPckr: () => void
  openSkllData: (target: SkllDataTgt) => void
  getSkillData: (entry: Pick<FeatureResult, 'resonatorId' | 'skill'>) => SkllDataTgt | null
  builders: {
    calculator: {
      workspace: () => MenuEntry[]
      more: () => MenuEntry[]
      damage: {
        row: (args: {
          rowId: string
          subHitsVis: boolean
          hasSubHitReq: boolean
          onTgglFrml: () => void
          onTgglSubHwm: () => void
          onOpenSklleu?: () => void
        }) => MenuEntry[]
      }
      rotation: {
        pane: (args: { items: MenuEntry[] }) => MenuEntry[]
        item: (args: { items: MenuEntry[] }) => MenuEntry[]
      }
      optimizer: {
        pane: (args: { items: MenuEntry[] }) => MenuEntry[]
      }
      manualBuffs: {
        pane: (args: {
          canSelectAny: boolean
          selMode: boolean
          onPaste: () => void
          onSelectAll: () => void
          onDeselectAll: () => void
        }) => MenuEntry[]
        item: (args: {
          modifierId: string
          onCopy: () => void
          onCut: () => void
          onPaste: () => void
          onDuplicate: () => void
          onDelete: () => void
          onSelect: () => void
        }) => MenuEntry[]
      }
      echo: {
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
        invBld: (args: {
          entryId: string
          onEquip: () => void
          onRename: () => void
          onRemove: () => void
        }) => MenuEntry[]
        readOnly: (args: {
          id: string
          canSave: boolean
          equipEntries: MenuEntry[]
          onSave: () => void
          onCopy: () => void
          onSelect: () => void
        }) => MenuEntry[]
      }
    }
    routeChrome: ReturnType<typeof useRtChrmMen>['builders']['routeChrome']
  }
}

interface CalcWorkProv {
  children: ReactNode
  actResId: string | null
  actRt: ResRuntime | null
  prtcRntmById: Record<string, ResRuntime>
}

const WORKPANEPTNS: Array<{ id: LeftPaneView; label: string }> = [
  { id: 'resonators', label: 'Resonators' },
  { id: 'weapon', label: 'Weapon' },
  { id: 'echoes', label: 'Echoes' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'teams', label: 'Team Buffs' },
  { id: 'enemy', label: 'Enemy' },
  { id: 'buffs', label: 'Custom Bonuses' },
  { id: 'rotations', label: 'Rotation' },
]

const calcCtx = mkCtx<CalcCtxValue | null>(null)

// binds calculator-wide actions and menu builders once so individual panes only ask for the menus they need.
export function CalcProv({
  children,
  actResId: actResId,
  actRt: actRt,
  prtcRntmById: partRntmById,
}: CalcWorkProv) {
  const ui = useAppStore((state) => state.ui)
  const openLeftPane = useAppStore((state) => state.openLeftView)
  const setShowSubHi = useAppStore((state) => state.setSubHits)
  const swtcToRes = useAppStore((state) => state.swRes)
  const rtChrmMenu = useRtChrmMen()
  const queue = useResQStr((state) => state.queue)
  const picker = useAppModal()
  const skillData = useAppModal()
  const [skllDataTrgt, setSkllDataT] = useState<SkllDataTgt | null>(null)

  const openResPckr = useCallback(() => {
    picker.show()
  }, [picker])

  const openSkllData = useCallback((target: SkllDataTgt) => {
    setSkllDataT(target)
    skillData.show()
  }, [skillData])

  const clsSkllData = useCallback(() => {
    skillData.hide(() => {
      setSkllDataT(null)
    })
  }, [skillData])

  const getSkllDataT = useCallback((entry: Pick<FeatureResult, 'resonatorId' | 'skill'>): SkllDataTgt | null => {
    const details = getResDtls(entry.resonatorId)
    const tab = skillTab(entry, details)
    return tab ? { resonatorId: entry.resonatorId, tab } : null
  }, [])

  const curResName = actResId ? seedRsntById[actResId]?.name ?? actResId : 'None'
  const skllDataRt = skllDataTrgt
    ? partRntmById[skllDataTrgt.resonatorId]
      ?? (actRt?.id === skllDataTrgt.resonatorId ? actRt : null)
    : null

  const swtcToEnts = useMemo<MenuEntry[]>(() => {
    // surface the recent queue first so the right-click path mirrors the
    // primary resonator-switching affordances used elsewhere in the app.
    const queueEntries = queue.map((entry) => ({
      id: `workspace-switch:${entry.id}`,
      label: entry.name,
      icon: <span style={{ width: '16px', height: '16px' }}
          className="rotation-node-member-icon" title={seedRsntById[entry.id]?.name}>
              <img src={seedRsntById[entry.id]?.profile} alt="" onError={withDefResMg} />
            </span>,
      onSelect: () => swtcToRes(entry.id),
    }))

    return [
      ...queueEntries,
      {
        id: 'main-switch:picker',
        label: 'See all resonators',
        icon: <SqrRrwUpRght size={15} />,
        onSelect: openResPckr,
      },
    ]
  }, [openResPckr, queue, swtcToRes])

  const paneEntries = useMemo<MenuEntry[]>(() => (
    WORKPANEPTNS.map((option) => ({
      id: `workspace-pane:${option.id}`,
      label: option.label,
      icon: <img
          style={{ width: '15px', height: '15px' }}
          src={`/assets/icons/${ui.theme === 'dark' ? 'dark' : 'light'}/${option.id}.png`}
          alt=""
          className="toolbar-icon-image"
          loading="lazy"
      />,
      hint: ui.leftPaneView === option.id ? 'Current' : undefined,
      disabled: ui.leftPaneView === option.id,
      onSelect: () => {
        openLeftPane(option.id)
      },
    }))
  ), [openLeftPane, ui.leftPaneView, ui.theme])

  const calcMoreEnts = useMemo(() => calcBuilder.calculator.more({
    swtcToNtrs: swtcToEnts,
    paneEntries,
    showSubHits: ui.showSubHits,
    onToggleSubHits: () => setShowSubHi(!ui.showSubHits),
  }), [paneEntries, setShowSubHi, swtcToEnts, ui.showSubHits])

  const rtMoreEnts = useMemo(
    () => rtChrmMenu.builders.routeChrome.clclSec(),
    [rtChrmMenu.builders.routeChrome],
  )

  const moreEntries = useMemo<MenuEntry[]>(() => {
    // calculator-local "more" actions come first, with route-wide actions
    // appended after a separator when both groups exist.
    if (calcMoreEnts.length === 0) {
      return rtMoreEnts
    }

    if (rtMoreEnts.length === 0) {
      return calcMoreEnts
    }

    return [
      ...calcMoreEnts,
      { type: 'separator' },
      ...rtMoreEnts,
    ]
  }, [calcMoreEnts, rtMoreEnts])

  const builders = useMemo<CalcCtxValue['builders']>(() => ({
    calculator: {
      workspace: () => calcBuilder.calculator.workspace({
        swtcToNtrs: swtcToEnts,
        paneEntries,
        showSubHits: ui.showSubHits,
        onToggleSubHits: () => setShowSubHi(!ui.showSubHits),
      }),
      more: () => moreEntries,
      damage: {
        row: ({ rowId, subHitsVis: subHitsVis, hasSubHitReq: hasSubHitRow, onTgglFrml: onTgglFrml, onTgglSubHwm: onTgglSubHit, onOpenSklleu: onOpenSkllDa }) =>
          calcBuilder.calculator.damage.row({
            rowId,
            subHitsVis: subHitsVis,
            hasSubHitReq: hasSubHitRow,
            onTgglFrml: onTgglFrml,
            onTgglSubHwm: onTgglSubHit,
            onOpenSklleu: onOpenSkllDa,
            moreEntries,
          }),
      },
      rotation: {
        pane: ({ items }) => calcBuilder.calculator.rotation.pane({
          items,
          moreEntries,
        }),
        item: ({ items }) => calcBuilder.calculator.rotation.item({
          items,
          moreEntries,
        }),
      },
      optimizer: {
        pane: ({ items }) => calcBuilder.calculator.optimizer.main({
          items,
          moreEntries,
        }),
      },
      manualBuffs: {
        pane: (args) => calcBuilder.calculator.manualBuffs.pane({
          ...args,
          moreEntries,
        }),
        item: (args) => calcBuilder.calculator.manualBuffs.item({
          ...args,
          moreEntries,
        }),
      },
      echo: {
        pane: (args) => calcBuilder.calculator.echo.pane(args),
        emptySlot: (args) => calcBuilder.calculator.echo.emptySlot(args),
        slot: (args) => calcBuilder.calculator.echo.slot(args),
        invCard: (args) => calcBuilder.calculator.echo.invCard(args),
        invBld: (args) => calcBuilder.calculator.echo.invMk(args),
        readOnly: (args) => calcBuilder.calculator.echo.readOnly(args),
      },
    },
    routeChrome: rtChrmMenu.builders.routeChrome,
  }), [
    moreEntries,
    paneEntries,
    rtChrmMenu.builders.routeChrome,
    setShowSubHi,
    swtcToEnts,
    ui.showSubHits,
  ])

  const value = useMemo<CalcCtxValue>(() => ({
    openResPckr: openResPckr,
    openSkllData: openSkllData,
    getSkillData: getSkllDataT,
    builders,
  }), [builders, getSkllDataT, openResPckr, openSkllData])

  return (
    <calcCtx.Provider value={value}>
      {children}
      <ResPckr
        visible={picker.visible}
        open={picker.open}
        closing={picker.closing}
        portalTarget={mainPortal()}
        eyebrow="Roster"
        title="Select Resonator"
        resonators={RES_MENU}
        selResId={actResId}
        selLbl="Active"
        smmrPrmr={{
          label: 'Current',
          value: curResName,
        }}
        emptyState={<p>I hope Solon Lee releases the character you're searching for.</p>}
        closeLabel="Close"
        panelWidth="regular"
        onClose={picker.hide}
        onSelect={(resonatorId) => {
          swtcToRes(resonatorId)
          picker.hide()
        }}
      />
      <SkillData
        key={`${skllDataTrgt?.resonatorId ?? 'none'}:${skllDataTrgt?.tab ?? 'none'}`}
        visible={skillData.visible}
        open={skillData.open}
        closing={skillData.closing}
        portalTarget={mainPortal()}
        resonatorId={skllDataTrgt?.resonatorId ?? null}
        runtime={skllDataRt}
        requestedTab={skllDataTrgt?.tab ?? null}
        onClose={clsSkllData}
      />
    </calcCtx.Provider>
  )
}

export function usePtnlCalcC(): CalcCtxValue | null {
  return useContext(calcCtx)
}
