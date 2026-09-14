/*
  Author: Runor Ewhro
  Description: The app's one roster. It is mounted by the chrome rather than by
               a page, so every working surface is looking at the same column in
               the same DOM: moving between them scrolls nothing, rebuilds
               nothing, and leaves the subject exactly where it was standing.

               Everything the column can do to a resonator travels with it,
               because picking, adding, copying and removing one are facts about
               the roster and not about whichever surface is reading it.
*/

import { useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Copy, Scissors, Trash2 } from 'lucide-react'
import { isSimulationSurfaceRoute } from '@/shared/lib/appRoutes'
import { useAppStore } from '@/domain/state/store.ts'
import { selContextResonatorId } from '@/domain/state/selectors.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { getResonator } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { openTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { toTitle } from '@/shared/lib/format'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import { getEvaluationTargetCtx } from '@/modules/simulation/workspace/context.tsx'
import { BuildRoster, type RosterReads } from './BuildRoster.tsx'
import type { CapsuleMate } from './RosterCapsule.tsx'
import { makeAttrGroups, makeRosterEntries } from './rosterModel.ts'
import { useResonatorProfileOps } from './useResonatorProfileOps.ts'
import { useRosterAdd } from './useRosterAdd.tsx'

export function RosterColumn() {
  const { pathname } = useLocation()
  /* the only thing the surface gets to say about the column: what it wants read
     off it. it is a prop and not a mount, so the page can change its mind
     without the column being taken down. */
  const reads: RosterReads = isSimulationSurfaceRoute(pathname, 'rotation') ? 'rotation' : 'build'
  const scenarioLibrary = useAppStore((state) => state.combat)
  const contextResId = useAppStore(selContextResonatorId)
  const selectContextResonator = useAppStore((state) => state.selectContextResonator)

  const roster = useMemo(() => makeRosterEntries(scenarioLibrary), [scenarioLibrary])
  const scenario = useMemo(() => selectedCombatScenario(scenarioLibrary), [scenarioLibrary])

  /* the lead's two teammates, for its capsule. the console they open is the
     same one the team pane and the toolbar open, scoped to the lead's own
     scenario so it never edits somebody else's copy of a member. */
  const mates = useMemo<CapsuleMate[]>(() => {
    const lead = contextScenarioMember(scenario)
    return scenario.team.members
      .filter((member) => member.id !== lead.id)
      .map((member) => {
        const res = getResonator(member.resonatorId)
        return {
          id: member.resonatorId,
          name: res?.name ?? toTitle(member.resonatorId),
          profile: res?.profile ?? res?.sprite ?? '/assets/game/default.webp',
          accent: ATTR_COLORS[res?.attribute ?? 'aero'],
        }
      })
  }, [scenario])
  const openMember = useCallback((resonatorId: string) => {
    openTeamCnsl(resonatorId, 'loadout', scenario.id)
  }, [scenario.id])
  const groups = useMemo(() => makeAttrGroups(roster), [roster])
  const ops = useResonatorProfileOps(roster)
  const rosterAdd = useRosterAdd()

  const selectionItems = useMemo(() => roster.map(({ id }) => ({ id })), [roster])

  const selectionActions = useMemo(() => [
    {
      id: 'roster:copy',
      key: 'copy' as const,
      needsSel: true,
      icon: <Copy size="1em" />,
      label: ({ count }: { count: number }) => `Copy (${count})`,
      title: 'Copy selected resonators (Ctrl/Cmd+C)',
      run: async ({ ids }: { ids: string[] }) => {
        await ops.copy(ids)
      },
    },
    {
      id: 'roster:cut',
      key: 'cut' as const,
      needsSel: true,
      icon: <Scissors size="1em" />,
      label: ({ count }: { count: number }) => `Cut (${count})`,
      title: 'Cut selected resonators (Ctrl/Cmd+X)',
      run: async ({ ids }: { ids: string[] }) => {
        await ops.cut(ids)
      },
    },
    {
      id: 'roster:delete',
      key: 'delete' as const,
      needsSel: true,
      icon: <Trash2 size="1em" />,
      danger: true,
      label: ({ count }: { count: number }) => `Delete (${count})`,
      title: 'Delete selected resonators (Delete)',
      run: ({ ids }: { ids: string[] }) => {
        ops.remove(ids)
      },
    },
    {
      id: 'roster:paste',
      key: 'paste' as const,
      float: false,
      label: 'Paste',
      run: () => {
        void ops.paste()
      },
    },
  ], [ops])

  const selection = useSel({
    surfaceId: 'roster',
    ariaLabel: 'Roster selection actions',
    items: selectionItems,
    acts: selectionActions,
  })

  const getItems = useCallback((resonatorId: string) => {
    if (!ops.rosterById.has(resonatorId)) return []
    const selectionIds = selection.selectionMode && selection.isSelected(resonatorId)
      ? selection.selectedIdsInOrder
      : [resonatorId]

    return getEvaluationTargetCtx({
      id: resonatorId,
      isActive: contextResId === resonatorId,
      isSelectionPicked: selection.isSelected(resonatorId),
      onSwitch: () => selectContextResonator(resonatorId),
      onDelete: () => ops.remove(selectionIds),
      onCut: () => { void ops.cut(selectionIds) },
      onCopy: () => { void ops.copy(selectionIds) },
      onPaste: () => { void ops.paste() },
      onSelect: () => {
        selection.focusSurface()
        selection.toggleSelection(resonatorId)
      },
    })
  }, [contextResId, ops, selectContextResonator, selection])

  return (
    <>
      <BuildRoster
        roster={roster}
        groups={groups}
        contextResId={contextResId}
        reads={reads}
        mates={mates}
        onOpenMember={openMember}
        onContextChange={selectContextResonator}
        onAddResonator={rosterAdd.open}
        selection={{
          selectionMode: selection.selectionMode,
          isSelected: selection.isSelected,
          buildClickCapture: selection.buildClickCapture,
          getItems,
          surfaceProps: selection.surfaceProps,
        }}
      />
      {rosterAdd.portal}
    </>
  )
}
