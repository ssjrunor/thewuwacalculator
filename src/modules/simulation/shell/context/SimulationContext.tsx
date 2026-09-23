/*
  Author: Runor Ewhro
  Description: Provides canonical Simulation workspace state and mutations to nested surfaces.
*/

import { createContext as mkCtx, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { LeftPaneView } from '@/domain/entities/appState.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type { SkillTabKey } from '@/domain/entities/resonator.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { useAppStore } from '@/application/state'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { RES_MENU, getResDtls } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { ResPckr } from '@/modules/simulation/features/resonator/Picker.tsx'
import { useSkllData } from '@/modules/simulation/features/resonator/SkillDataHost.tsx'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import { skillTab } from '@/modules/simulation/shell/context/skillData.ts'
import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import { SquareArrowUpRight as SqrRrwUpRght } from 'lucide-react'
import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import { simulationMenuBuilder } from '@/modules/simulation/shell/context-menu/simulationContextBuilders.tsx'
import { withDefResMg } from '@/shared/lib/imageFallback.ts'

interface SkllDataTgt {
  resonatorId: string
  tab: SkillTabKey
}

interface SimulationContextValue {
  openResPckr: () => void
  openSkllData: (target: SkllDataTgt) => void
  getSkillData: (entry: Pick<FeatureResult, 'resonatorId' | 'skill'>) => SkllDataTgt | null
  builders: {
    simulation: {
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

interface SimulationProviderProps {
  children: ReactNode
  actResId: string | null
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

const simulationContext = mkCtx<SimulationContextValue | null>(null)

export function SimulationProvider({
  children,
  actResId: actResId,
}: SimulationProviderProps) {
  const theme = useAppStore((state) => state.ui.theme)
  const backgroundTextMode = useAppStore((state) => state.ui.backgroundTextMode)
  const leftPaneView = useAppStore((state) => state.ui.leftPaneView)
  const showSubHits = useAppStore((state) => state.ui.showSubHits)
  const openLeftPane = useAppStore((state) => state.openLeftView)
  const setShowSubHi = useAppStore((state) => state.setSubHits)
  const swtcToRes = useAppStore((state) => state.swRes)
  const rtChrmMenu = useRtChrmMen()
  const queue = useResQStr((state) => state.queue)
  const picker = useAppModal()

  // points it at a target.
  const skillData = useSkllData()

  const openResPckr = useCallback(() => {
    picker.show()
  }, [picker])

  const getSkllDataT = useCallback((entry: Pick<FeatureResult, 'resonatorId' | 'skill'>): SkllDataTgt | null => {
    const details = getResDtls(entry.resonatorId)
    const tab = skillTab(entry, details)
    return tab ? { resonatorId: entry.resonatorId, tab } : null
  }, [])

  const curResName = actResId ? seedRsntById[actResId]?.name ?? actResId : 'None'
  const toolbarIconTheme = (
    theme === 'background'
      ? backgroundTextMode === 'dark'
      : theme === 'dark'
  ) ? 'dark' : 'light'
  const swtcToEnts = useMemo<MenuEntry[]>(() => {

    const queueEntries = queue.map((entry) => ({
      id: `workspace-switch:${entry.id}`,
      label: entry.name,
      art: seedRsntById[entry.id]?.sprite || seedRsntById[entry.id]?.profile,
      icon: <span style={{ width: '16px', height: '16px' }} className="rotation-node-member-icon" title={seedRsntById[entry.id]?.name}>
              <img src={seedRsntById[entry.id]?.profile} alt="" onError={withDefResMg} />
            </span>,
      onSelect: () => swtcToRes(entry.id),
    }))

    return [
      ...queueEntries,
      {
        id: 'main-switch:picker',
        label: 'See all resonators',
        icon: <SqrRrwUpRght size="1em" />,
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
          src={`/assets/app/icons/${toolbarIconTheme}/${option.id}.png`}
          alt=""
          loading="lazy"
      />,
      hint: leftPaneView === option.id ? 'Current' : undefined,
      disabled: leftPaneView === option.id,
      onSelect: () => {
        openLeftPane(option.id)
      },
    }))
  ), [leftPaneView, openLeftPane, toolbarIconTheme])

  const simulationMoreEntries = useMemo(() => simulationMenuBuilder.simulation.more({
    swtcToNtrs: swtcToEnts,
    paneEntries,
    showSubHits,
    onToggleSubHits: () => setShowSubHi(!showSubHits),
  }), [paneEntries, setShowSubHi, showSubHits, swtcToEnts])

  const rtMoreEnts = useMemo(
    () => rtChrmMenu.builders.routeChrome.simulationSection(),
    [rtChrmMenu.builders.routeChrome],
  )

  const moreEntries = useMemo<MenuEntry[]>(() => {
    // Simulation-local "more" actions come first, with route-wide actions
    // appended after a separator when both groups exist.
    if (simulationMoreEntries.length === 0) {
      return rtMoreEnts
    }

    if (rtMoreEnts.length === 0) {
      return simulationMoreEntries
    }

    return [
      ...simulationMoreEntries,
      { type: 'separator' },
      ...rtMoreEnts,
    ]
  }, [rtMoreEnts, simulationMoreEntries])

  const builders = useMemo<SimulationContextValue['builders']>(() => ({
    simulation: {
      workspace: () => simulationMenuBuilder.simulation.workspace({
        swtcToNtrs: swtcToEnts,
        paneEntries,
        showSubHits,
        onToggleSubHits: () => setShowSubHi(!showSubHits),
      }),
      more: () => moreEntries,
      damage: {
        row: ({ rowId, subHitsVis: subHitsVis, hasSubHitReq: hasSubHitRow, onTgglFrml: onTgglFrml, onTgglSubHwm: onTgglSubHit, onOpenSklleu: onOpenSkllDa }) =>
          simulationMenuBuilder.simulation.damage.row({
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
        pane: ({ items }) => simulationMenuBuilder.simulation.rotation.pane({
          items,
          moreEntries,
        }),
        item: ({ items }) => simulationMenuBuilder.simulation.rotation.item({
          items,
          moreEntries,
        }),
      },
      optimizer: {
        pane: ({ items }) => simulationMenuBuilder.simulation.optimizer.main({
          items,
          moreEntries,
        }),
      },
      manualBuffs: {
        pane: (args) => simulationMenuBuilder.simulation.manualBuffs.pane({
          ...args,
          moreEntries,
        }),
        item: (args) => simulationMenuBuilder.simulation.manualBuffs.item({
          ...args,
          moreEntries,
        }),
      },
      echo: {
        pane: (args) => simulationMenuBuilder.simulation.echo.pane(args),
        emptySlot: (args) => simulationMenuBuilder.simulation.echo.emptySlot(args),
        slot: (args) => simulationMenuBuilder.simulation.echo.slot(args),
        invCard: (args) => simulationMenuBuilder.simulation.echo.invCard(args),
        invBld: (args) => simulationMenuBuilder.simulation.echo.invMk(args),
        readOnly: (args) => simulationMenuBuilder.simulation.echo.readOnly(args),
      },
    },
    routeChrome: rtChrmMenu.builders.routeChrome,
  }), [
    moreEntries,
    paneEntries,
    rtChrmMenu.builders.routeChrome,
    setShowSubHi,
    swtcToEnts,
    showSubHits,
  ])

  const value = useMemo<SimulationContextValue>(() => ({
    openResPckr: openResPckr,
    openSkllData: skillData.open,
    getSkillData: getSkllDataT,
    builders,
  }), [builders, getSkllDataT, openResPckr, skillData.open])

  return (
    <simulationContext.Provider value={value}>
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
    </simulationContext.Provider>
  )
}

export function useOptionalSimulationContext(): SimulationContextValue | null {
  return useContext(simulationContext)
}
